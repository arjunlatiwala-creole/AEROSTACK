import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddbClient } from "src/shared/dynamodb-client";
import { err } from "../shared/response";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME;
const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

if (!DOCS_TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");
if (!VERSIONS_TABLE) throw new Error("DOCUMENT_VERSIONS_TABLE_NAME is required");
if (!BUCKET) throw new Error("DOCUMENT_BUCKET_NAME is required");

const s3 = new S3Client({});
const SIGNED_TAGS = ["signed", "esign", "e-sign"];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const rawSlug = event.pathParameters?.slug ?? event.pathParameters?.proxy;
    if (!rawSlug) return err("slug path parameter is required", 400);

    // Extract version from path (e.g., "user@email.com/my-doc/v2")
    let slug = rawSlug;
    let requestedVersion: number | undefined;
    const versionMatch = rawSlug.match(/^(.+)\/v(\d+)$/);
    if (versionMatch) {
      slug = versionMatch[1];
      requestedVersion = parseInt(versionMatch[2], 10);
    }

    // Look up document by slug
    const docResult = await ddbClient.send(
      new QueryCommand({
        TableName: DOCS_TABLE,
        IndexName: "GSI_Slug",
        KeyConditionExpression: "slug = :s",
        ExpressionAttributeValues: { ":s": slug },
        Limit: 1,
      }),
    );

    if (!docResult.Items || docResult.Items.length === 0) {
      return err("Document not found", 404);
    }

    const document = docResult.Items[0];
    if (document.is_deleted) return err("Document not found", 404);

    // ─── Access Control ───
    const isDocSigned = (document.tags as string[] ?? []).some((t) => SIGNED_TAGS.includes(t.toLowerCase()));
    const effectiveVisibility = isDocSigned ? "restricted" : document.visibility;

    if (effectiveVisibility !== "public") {
      const token = event.queryStringParameters?.token;
      const email = event.queryStringParameters?.email;

      if (!token) {
        return renderAccessDeniedPage(document);
      }

      const { createHmac } = await import("node:crypto");
      const hmacSecret = process.env.WEBHOOK_HMAC_SECRET ?? "";

      if (effectiveVisibility === "restricted") {
        if (email) {
          const expectedToken = createHmac("sha256", hmacSecret)
            .update(`${document.document_id as string}:${email.toLowerCase()}`)
            .digest("hex")
            .slice(0, 32);

          if (token !== expectedToken) {
            return renderAccessDeniedPage(document);
          }

          // Verify email has access
          if (ACCESS_TABLE) {
            const accessResult = await ddbClient.send(
              new QueryCommand({
                TableName: ACCESS_TABLE,
                KeyConditionExpression: "document_id = :did",
                FilterExpression: "grantee_id = :gid",
                ExpressionAttributeValues: {
                  ":did": document.document_id as string,
                  ":gid": email.toLowerCase(),
                },
              }),
            );

            if (!accessResult.Items || accessResult.Items.length === 0) {
              return renderAccessDeniedPage(document);
            }
          }
        } else {
          // Generic token for owner/admin
          const expectedToken = createHmac("sha256", hmacSecret)
            .update(document.document_id as string)
            .digest("hex")
            .slice(0, 32);

          if (token !== expectedToken) {
            return renderAccessDeniedPage(document);
          }
        }
      } else {
        // Internal
        const expectedToken = createHmac("sha256", hmacSecret)
          .update(document.document_id as string)
          .digest("hex")
          .slice(0, 32);

        if (token !== expectedToken) {
          return renderAccessDeniedPage(document);
        }
      }
    }

    // ─── Serve the file inline ───
    const currentVersion = requestedVersion ?? (document.current_version as number);
    if (currentVersion === 0) return err("Document has no uploaded versions", 404);

    const versionResult = await ddbClient.send(
      new GetCommand({
        TableName: VERSIONS_TABLE,
        Key: {
          document_id: document.document_id as string,
          version_number: currentVersion,
        },
      }),
    );

    if (!versionResult.Item) return err("Version not found", 404);

    let s3Key = versionResult.Item.s3_key as string;
    let mimeType = (document.mime_type as string) ?? "application/octet-stream";

    // If document is signed, look for a completed signature envelope and serve the signed PDF instead
    const isSigned = (document.tags as string[] ?? []).some((t) => SIGNED_TAGS.includes(t.toLowerCase()));

    if (isSigned && process.env.DOCUSIGN_ENVELOPES_TABLE) {
      const envelopesRes = await ddbClient.send(
        new QueryCommand({
          TableName: process.env.DOCUSIGN_ENVELOPES_TABLE,
          IndexName: "GSI_DocumentId",
          KeyConditionExpression: "document_id = :did",
          ExpressionAttributeValues: { ":did": document.document_id as string },
        })
      );
      if (envelopesRes.Items && envelopesRes.Items.length > 0) {
        const completed = envelopesRes.Items
          .filter((e) => e.status === "completed" && e.signed_pdf_key)
          .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];
        if (completed && completed.signed_pdf_key) {
          s3Key = completed.signed_pdf_key;
          mimeType = "application/pdf";
        }
      }
    }

    // Generate presigned URL with inline disposition
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ResponseContentDisposition: "inline",
      ResponseContentType: mimeType,
    });
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    // Render inline viewer HTML page instead of redirecting
    // This ensures the document is always shown inline, never downloaded
    const browserNative = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
    const isNativeInline = browserNative.includes(mimeType);

    const title = document.title as string;
    const ownerEmail = document.owner_email as string;

    if (isNativeInline) {
      // PDF/images: embed in an iframe/img in a full-page HTML
      const viewHtml = renderInlineViewerPage(title, ownerEmail, presignedUrl, mimeType);
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" },
        body: viewHtml,
      };
    }

    // Office docs: use Google Docs Viewer
    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(presignedUrl)}&embedded=true`;
    const viewHtml = renderInlineViewerPage(title, ownerEmail, viewerUrl, mimeType);
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" },
      body: viewHtml,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error serving public document:", error);
    return err(message, 500);
  }
};


/**
 * Renders an HTML page that shows the document inline (no download).
 */
function renderInlineViewerPage(
  title: string,
  ownerEmail: string,
  contentUrl: string,
  mimeType: string,
): string {
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  const contentHtml = isImage
    ? `<img src="${contentUrl}" alt="${title}" style="max-width:100%;max-height:90vh;object-fit:contain;" />`
    : isPdf
      ? `<iframe src="${contentUrl}" style="width:100%;height:calc(100vh - 60px);border:none;"></iframe>`
      : `<iframe src="${contentUrl}" style="width:100%;height:calc(100vh - 60px);border:none;"></iframe>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Aerostack Document</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .header { background: #fff; border-bottom: 1px solid #e0e0e0; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 16px; font-weight: 600; color: #333; }
    .header .owner { font-size: 12px; color: #888; }
    .content { width: 100%; display: flex; justify-content: center; align-items: flex-start; }
    .content img { margin-top: 20px; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <span class="owner">by ${ownerEmail}</span>
  </div>
  <div class="content">
    ${contentHtml}
  </div>
</body>
</html>`;
}

/**
 * Renders an HTML "Access Denied" page with a "Request Access" button.
 */
function renderAccessDeniedPage(document: Record<string, unknown>) {
  const title = document.title as string;
  const ownerEmail = document.owner_email as string;
  const visibility = document.visibility as string;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Denied — ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 48px; max-width: 420px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; color: #333; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 24px; line-height: 1.5; }
    .doc-title { font-size: 14px; font-weight: 500; color: #333; background: #f0f0f0; padding: 8px 16px; border-radius: 6px; margin-bottom: 24px; }
    .btn { display: inline-block; background: #f59e0b; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; }
    .btn:hover { background: #d97706; }
    .owner-info { font-size: 12px; color: #999; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>You need access</h1>
    <p class="subtitle">This document is ${visibility}. You need permission from the owner to view it.</p>
    <div class="doc-title">${title}</div>
    <a class="btn" href="mailto:${ownerEmail}?subject=Request access to: ${encodeURIComponent(title)}&body=Hi, I'd like access to the document "${encodeURIComponent(title)}". Could you please share it with me?">
      Request Access
    </a>
    <p class="owner-info">Owner: ${ownerEmail}</p>
  </div>
</body>
</html>`;

  return {
    statusCode: 403,
    headers: {
      "Content-Type": "text/html",
      "Access-Control-Allow-Origin": "*",
    },
    body: html,
  };
}
