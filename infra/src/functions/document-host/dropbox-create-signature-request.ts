/**
 * POST /documents/{documentId}/sign/envelopes
 *
 * Creates a Dropbox Sign signature request from a stored document and returns embedded
 * signing ceremony details. Everything stays within Aerostack — the caller renders
 * the signing experience using the hellosign-embedded SDK.
 *
 * Required env vars:
 *   DROPBOX_SIGN_CLIENT_ID       – Client ID for embedded signing
 *   DROPBOX_SIGN_API_KEY_SECRET  – Secrets Manager secret name holding the API key
 *   DROPBOX_SIGN_BASE_URL        – e.g. https://api.hellosign.com/v3
 *   DROPBOX_SIGN_TEST_MODE       – "true" or "false"
 *   DOCUMENT_BUCKET_NAME         – S3 bucket where documents are stored
 *   DOCUMENTS_TABLE_NAME         – DynamoDB table for document metadata
 *   DOCUSIGN_ENVELOPES_TABLE     – DynamoDB table for envelope tracking (reused)
 *   FRONTEND_URL                 – Return URL after signing
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { extractUser } from "./doc-auth";
import { createSignLinkToken } from "./sign-link-token";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME!;
const ENVELOPES_TABLE = process.env.DOCUSIGN_ENVELOPES_TABLE!; // Reuse the envelopes table
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;
const DS_CLIENT_ID = process.env.DROPBOX_SIGN_CLIENT_ID!;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET!;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL!;
const DS_TEST_MODE = process.env.DROPBOX_SIGN_TEST_MODE === "true";
const FRONTEND_URL = process.env.FRONTEND_URL!;
const FROM_EMAIL = process.env.SIGNATURE_FROM_EMAIL ?? "noreply@aerostack.enterprise.io";

const smClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
const sesClient = new SESClient({});

async function getApiKey(): Promise<string> {
  const res = await smClient.send(
    new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET }),
  );
  return res.SecretString!.trim();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const user = extractUser(event);
    const documentId = event.pathParameters?.documentId;
    if (!documentId) return err("documentId is required", 400);

    const body = JSON.parse(event.body ?? "{}");
    const {
      signers,
      email_subject,
      email_body,
      intake_form_fields,
      notify_emails,
    } = body as {
      signers: Array<{ name: string; email: string; role_label: string }>;
      email_subject?: string;
      email_body?: string;
      intake_form_fields?: Array<{
        id: string;
        label: string;
        type: "text" | "email" | "tel" | "date" | "textarea";
        required?: boolean;
        placeholder?: string;
      }>;
      notify_emails?: string[];
    };

    if (!signers || signers.length < 1) {
      return err("At least one signer is required", 400);
    }
    if (signers.length > 10) {
      return err("Maximum 10 signers per envelope", 400);
    }
    for (const s of signers) {
      if (!s.name || !s.email || !s.role_label) {
        return err("Each signer must have name, email, and role_label", 400);
      }
    }

    // 1. Fetch document metadata
    const docRes = await ddbClient.send(
      new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: documentId } }),
    );
    const doc = docRes.Item;
    if (!doc || doc.is_deleted) return err("Document not found", 404);

    if (doc.current_version === 0) {
      return err("Document has no uploaded file yet. Please upload a file first.", 400);
    }

    // Only admins or the document owner can initiate signing
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = doc.owner_email?.toLowerCase() === user.email.toLowerCase();
    if (!isAdmin && !isOwner) {
      return err("Only the document owner or an admin can initiate signing", 403);
    }

    // 2. Look up the current version's s3_key
    const versionRes = await ddbClient.send(
      new GetCommand({
        TableName: VERSIONS_TABLE,
        Key: { document_id: documentId, version_number: doc.current_version },
      }),
    );
    const s3Key = versionRes.Item?.s3_key as string | undefined;
    if (!s3Key) return err("Document file not found in storage", 400);

    const s3Res = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }),
    );
    const fileBytes = Buffer.from(await s3Res.Body!.transformToByteArray());
    const mimeType = (doc.mime_type as string) ?? "application/pdf";
    
    const extByMime: Record<string, string> = {
      "application/pdf": "pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-excel": "xls",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "text/plain": "txt",
      "text/html": "html",
    };
    const fileExtension = extByMime[mimeType] ?? "pdf";
    const baseName = (doc.title as string).replace(/[^A-Za-z0-9._-]+/g, "_") || "document";
    const docName = `${baseName}.${fileExtension}`;

    // Inject text tags dynamically if it's a PDF and there are coordinate markers
    let modifiedPdfBytes = fileBytes;
    if (mimeType === "application/pdf") {
      let fieldMarkers: any[] = (body as { field_markers?: any[] }).field_markers ?? [];
      
      // If no markers provided in request body, fall back to default NDA coordinates
      if (fieldMarkers.length === 0) {
        const titleLower = String(doc.title ?? "").toLowerCase();
        const slugLower = String(doc.slug ?? "").toLowerCase();
        if (
          titleLower.includes("nda") ||
          titleLower.includes("mnda") ||
          slugLower.includes("nda") ||
          slugLower.includes("mnda")
        ) {
          fieldMarkers = [
            // recipient 1 (enterprise) - Right column, Page 3
            { field_id: "__signature__", page: 3, x: 370, y: 75, width: 150, height: 30, recipient_id: "1" },
            { field_id: "__date__", page: 3, x: 350, y: 118, width: 100, height: 20, recipient_id: "1" },
            // recipient 2 (Counterparty) - Left column, Page 3
            { field_id: "__signature__", page: 3, x: 110, y: 75, width: 150, height: 30, recipient_id: "2" },
            { field_id: "__date__", page: 3, x: 95, y: 118, width: 100, height: 20, recipient_id: "2" },
            { field_id: "counterparty_name", page: 3, x: 95, y: 177, width: 180, height: 20, recipient_id: "2" },
            { field_id: "counterparty_title", page: 3, x: 95, y: 148, width: 180, height: 20, recipient_id: "2" },
            { field_id: "counterparty_company", page: 3, x: 80, y: 219, width: 180, height: 20, recipient_id: "2" },
            // recipient 2 (Counterparty) - Page 1
            { field_id: "counterparty_company", page: 1, x: 115, y: 673, width: 220, height: 16, recipient_id: "2" },
            { field_id: "effective_date", page: 1, x: 355, y: 699, width: 100, height: 16, recipient_id: "2" },
          ];
        }
      }

      if (fieldMarkers.length > 0) {
        try {
          const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
          const pdfDoc = await PDFDocument.load(fileBytes);
          const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
          
          for (const marker of fieldMarkers) {
            const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, marker.page - 1));
            const page = pdfDoc.getPage(pageIdx);
            
            const signerIdx = parseInt(marker.recipient_id ?? "1", 10);
            
            let tagText = "";
            if (marker.field_id === "__signature__") {
              tagText = `[sig|req|signer${signerIdx}]`;
            } else if (marker.field_id === "__date__") {
              tagText = `[date|req|signer${signerIdx}]`;
            } else if (marker.field_id === "__name__") {
              tagText = `[text|req|signer${signerIdx}|Name]`;
            } else {
              const label = marker.field_id.replace(/[^A-Za-z0-9]/g, "_");
              tagText = `[text|req|signer${signerIdx}|${label}]`;
            }
            
            // Draw the text tag in white color (invisible) at the marker's coordinate.
            // Dropbox Sign scans the PDF text layer to detect these fields.
            page.drawText(tagText, {
              x: marker.x,
              y: marker.y,
              size: 8,
              font: font,
              color: rgb(1, 1, 1),
            });
          }
          
          modifiedPdfBytes = Buffer.from(await pdfDoc.save());
          console.log(`[DROPBOX-CREATE-REQUEST] Successfully injected ${fieldMarkers.length} text tags into the PDF.`);
        } catch (err) {
          console.error("[DROPBOX-CREATE-REQUEST] Failed to inject text tags into PDF:", err);
        }
      }
    }

    // 3. Build multipart/form-data payload helper for Dropbox Sign
    //
    // We use `signature_request/create_embedded` exclusively. That endpoint
    // does NOT send the initial "Please sign this document" email to signers
    // — Aerostack sends its own invite via SES. The only remaining Dropbox email
    // is the "you signed" confirmation, which is toggled OFF in the Dropbox
    // Sign API App dashboard (Options → Email Preferences → uncheck "Email
    // signers when a document is completed").
    const buildFormData = () => {
      const fd = new FormData();
      fd.append("client_id", DS_CLIENT_ID);
      fd.append("test_mode", DS_TEST_MODE ? "1" : "0");
      fd.append("title", doc.title || "Document");
      // subject/message aren't shown to signers in the embedded flow, but
      // Dropbox records them on the request for dashboard searchability.
      fd.append("subject", email_subject ?? `Please sign: ${doc.title}`);
      fd.append("message", email_body ?? `You have been requested to review and sign the document: ${doc.title}`);
      fd.append("use_text_tags", "1");
      fd.append("hide_text_tags", "1");

      // Add signers in order
      signers.forEach((s, idx) => {
        fd.append(`signers[${idx}][name]`, s.name);
        fd.append(`signers[${idx}][email_address]`, s.email);
        fd.append(`signers[${idx}][order]`, String(idx));
      });

      const fileBlob = new Blob([modifiedPdfBytes], { type: mimeType });
      fd.append("files[0]", fileBlob, docName);
      return fd;
    };

    // 4. Create signature request via Dropbox Sign API
    //
    // We exclusively use `signature_request/create_embedded` — this endpoint
    // does NOT send the "Please Sign this Document" initial email to signers.
    // Aerostack sends its own invitations via SES. The `send` endpoint would
    // trigger Dropbox emails to signers, which we don't want.
    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

    const response = await fetch(`${DS_BASE_URL}/signature_request/create_embedded`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
      body: buildFormData(),
    });

    const responseData: any = await response.json();

    if (!response.ok) {
      console.error("[DROPBOX-CREATE-REQUEST] create_embedded failed:", responseData);
      throw new Error(`Dropbox Sign error: ${JSON.stringify(responseData.error || responseData)}`);
    }

    console.log(`[DROPBOX-CREATE-REQUEST] Created request ${responseData.signature_request?.signature_request_id} via create_embedded`);

    const sigReq = responseData.signature_request;
    const dsEnvelopeId = sigReq.signature_request_id;
    const dsSignatures = sigReq.signatures || [];

    // 5. Generate Aerostack magic-link tokens for each signer
    const now = new Date().toISOString();
    const enrichedSigners = signers.map((s, idx) => {
      const recipientId = String(idx + 1);
      const dsSig = dsSignatures.find(
        (sig: any) => sig.signer_email_address?.toLowerCase() === s.email.toLowerCase()
      ) || dsSignatures[idx];
      const signatureId = dsSig?.signature_id;

      const token = createSignLinkToken({
        envelope_id: dsEnvelopeId,
        document_id: documentId,
        signer_email: s.email,
        recipient_id: recipientId,
      });
      const signLink = `${FRONTEND_URL}/sign/${dsEnvelopeId}?token=${encodeURIComponent(token)}`;
      return {
        ...s,
        recipient_id: recipientId,
        signature_id: signatureId,
        status: "sent",
        sign_link: signLink,
      };
    });

    // 6. Store request tracking record
    const cleanedNotifyEmails = (notify_emails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const cleanedFormFields = (intake_form_fields ?? []).filter(
      (f) => f.id && f.label && f.type,
    );

    const envelopeRecord = {
      envelope_id: dsEnvelopeId,
      document_id: documentId,
      org_id: doc.org_id,
      created_by: user.email,
      created_at: now,
      updated_at: now,
      status: "sent",
      signers: enrichedSigners,
      email_subject: email_subject ?? `Please sign: ${doc.title}`,
      email_body: email_body ?? `You have been requested to review and sign the document: ${doc.title}`,
      intake_form_fields: cleanedFormFields,
      intake_form_responses: {},
      notify_emails: cleanedNotifyEmails,
      active_recipient_id: "1",
      field_markers: (body as { field_markers?: unknown[] }).field_markers ?? [],
      certificate_stored: false,
    };

    await ddbClient.send(
      new PutCommand({ TableName: ENVELOPES_TABLE, Item: envelopeRecord }),
    );

    // Tag the original document as sent for signature
    try {
      const docTags = (doc.tags ?? []) as string[];
      if (!docTags.some((t: string) => ["signed", "esign", "e-sign", "esign-sent"].includes(t.toLowerCase()))) {
        await ddbClient.send(
          new UpdateCommand({
            TableName: DOCS_TABLE,
            Key: { document_id: documentId },
            UpdateExpression: "SET tags = :t",
            ExpressionAttributeValues: { ":t": [...docTags, "esign-sent"] },
          }),
        );
      }
    } catch (tagErr) {
      console.error("[DROPBOX-CREATE-REQUEST] Failed to tag document as esign-sent:", tagErr);
    }

    // Grant view access to each signer
    const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME!;
    const { randomUUID } = await import("node:crypto");
    for (const signer of enrichedSigners) {
      if (signer.email) {
        try {
          await ddbClient.send(
            new PutCommand({
              TableName: ACCESS_TABLE,
              Item: {
                access_id: randomUUID(),
                document_id: documentId,
                grantee_type: "person",
                grantee_id: signer.email.trim().toLowerCase(),
                permission: "view",
                granted_by: user.email,
                granted_at: now,
              },
            }),
          );
        } catch (accessErr) {
          console.error(`[DROPBOX-CREATE-REQUEST] Failed to grant access to ${signer.email}:`, accessErr);
        }
      }
    }

    // 7. Send invitation email to the first signer
    const firstSigner = enrichedSigners[0];
    let firstEmailFailed = false;
    try {
      await sendSigningInviteEmail({
        to: firstSigner.email,
        signerName: firstSigner.name,
        documentTitle: doc.title as string,
        senderEmail: user.email,
        subject: envelopeRecord.email_subject,
        messageBody: envelopeRecord.email_body,
        signLink: firstSigner.sign_link,
      });
    } catch (e) {
      firstEmailFailed = true;
      console.warn(`[DROPBOX-CREATE-REQUEST] Failed to email ${firstSigner.email}:`, e);
    }

    return ok({
      envelope_id: dsEnvelopeId,
      document_id: documentId,
      status: "sent",
      active_recipient_id: "1",
      signers: enrichedSigners.map((s) => ({
        name: s.name,
        email: s.email,
        role_label: s.role_label,
        recipient_id: s.recipient_id,
        signature_id: s.signature_id,
        sign_link: s.sign_link,
        email_sent: s.recipient_id === "1" ? !firstEmailFailed : false,
        is_active: s.recipient_id === "1",
      })),
      created_at: now,
      ...(firstEmailFailed ? { email_warnings: [firstSigner.email] } : {}),
    }, 201);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DROPBOX-CREATE-REQUEST] Error:", error);
    return err(message, 500);
  }
};

interface SigningInviteEmail {
  to: string;
  signerName: string;
  documentTitle: string;
  senderEmail: string;
  subject: string;
  messageBody: string;
  signLink: string;
}

async function sendSigningInviteEmail(opts: SigningInviteEmail): Promise<void> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 18px; margin: 0; color: #059669;">📝 Signature requested on Aerostack</h1>
      </div>
      <p style="margin: 0 0 12px 0;">Hi ${escapeHtml(opts.signerName)},</p>
      <p style="margin: 0 0 16px 0; white-space: pre-wrap;">${escapeHtml(opts.messageBody)}</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Document</div>
        <div style="font-weight: 600;">${escapeHtml(opts.documentTitle)}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 12px;">Sent by</div>
        <div>${escapeHtml(opts.senderEmail)}</div>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${opts.signLink}" style="display: inline-block; background: #059669; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">Review &amp; Sign</a>
      </div>
      <p style="font-size: 12px; color: #64748b; text-align: center; margin: 24px 0 0 0;">
        Or paste this link into your browser:<br>
        <span style="word-break: break-all;">${opts.signLink}</span>
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px 0;">
      <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
        This link expires in 14 days. Signing is powered by Dropbox Sign and produces a legally-binding PKI certificate stored in Aerostack.
      </p>
    </div>
  `;

  const text = `Hi ${opts.signerName},

${opts.messageBody}

Document: ${opts.documentTitle}
Sent by: ${opts.senderEmail}

Review & sign: ${opts.signLink}

This link expires in 14 days.`;

  await sesClient.send(
    new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: opts.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    }),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
