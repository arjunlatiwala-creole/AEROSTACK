import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { createHmac } from "node:crypto";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;
const HMAC_SECRET = process.env.WEBHOOK_HMAC_SECRET ?? "";

if (!TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");

/**
 * Generates a shareable link for a document (any visibility).
 * For public docs: returns the plain slug URL.
 * For internal/restricted: returns a token-authenticated URL.
 *
 * Route: GET /documents/{documentId}/share-link
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const doc = docResult.Item;
    const slug = doc.slug as string;
    const isSigned = (doc.tags as string[] ?? []).some((t) => ["signed", "esign", "e-sign"].includes(t.toLowerCase()));
    const effectiveVisibility = isSigned ? "restricted" : doc.visibility as string;
    const currentVersion = doc.current_version as number;

    // Use API_BASE_URL env var, or construct from the request
    const apiBase = process.env.API_BASE_URL
      ?? `https://${event.requestContext?.domainName}`;

    let shareUrl: string;

    if (effectiveVisibility === "public") {
      shareUrl = `${apiBase}/public/docs/${slug}/v${currentVersion}`;
    } else if (effectiveVisibility === "restricted") {
      // For restricted docs, generate per-email token
      // The email query param tells us who to generate the link for
      const targetEmail = event.queryStringParameters?.email;
      if (!targetEmail) {
        // Return base URL without token — frontend will append per-user tokens
        const token = createHmac("sha256", HMAC_SECRET)
          .update(documentId)
          .digest("hex")
          .slice(0, 32);
        shareUrl = `${apiBase}/public/docs/${slug}/v${currentVersion}?token=${token}`;
      } else {
        const token = createHmac("sha256", HMAC_SECRET)
          .update(`${documentId}:${targetEmail.toLowerCase()}`)
          .digest("hex")
          .slice(0, 32);
        shareUrl = `${apiBase}/public/docs/${slug}/v${currentVersion}?token=${token}&email=${encodeURIComponent(targetEmail.toLowerCase())}`;
      }
    } else {
      // Internal: generic token — any team member with the link can view
      const token = createHmac("sha256", HMAC_SECRET)
        .update(documentId)
        .digest("hex")
        .slice(0, 32);
      shareUrl = `${apiBase}/public/docs/${slug}/v${currentVersion}?token=${token}`;
    }

    return ok({
      share_url: shareUrl,
      visibility: doc.visibility as string,
      slug,
      version: currentVersion,
      document_id: documentId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error generating share link:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
