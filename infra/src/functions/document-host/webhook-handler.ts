import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME;

if (!DOCS_TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");
if (!VERSIONS_TABLE) throw new Error("DOCUMENT_VERSIONS_TABLE_NAME is required");
if (!BUCKET) throw new Error("DOCUMENT_BUCKET_NAME is required");

/**
 * Webhook handler for Canva and Google Drive file change notifications.
 * Route: POST /documents/webhook/{provider}
 *
 * This is a public endpoint — authentication is via HMAC signature
 * verification specific to each provider.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const provider = event.pathParameters?.provider;

    if (!provider || !["canva", "google_drive"].includes(provider)) {
      return err("Invalid provider. Must be canva or google_drive", 400);
    }

    const body = JSON.parse(event.body ?? "{}");
    const sourceId = extractSourceId(provider, body);

    console.log(`[WEBHOOK] Incoming webhook from provider=${provider}`, {
      headers: event.headers,
      body,
      sourceId,
    });

    if (!sourceId) {
      console.error(`[WEBHOOK] Could not extract source_id from payload`, { provider, body });
      return err("Unable to extract source_id from webhook payload", 400);
    }

    // Look up document by source_provider + source_id
    const docResult = await ddbClient.send(
      new QueryCommand({
        TableName: DOCS_TABLE,
        IndexName: "GSI_Source",
        KeyConditionExpression:
          "source_provider = :p AND source_id = :s",
        ExpressionAttributeValues: {
          ":p": provider,
          ":s": sourceId,
        },
        Limit: 1,
      }),
    );

    if (!docResult.Items || docResult.Items.length === 0) {
      console.log(`[WEBHOOK] No document registered for source_id=${sourceId}, provider=${provider} — ignoring`);
      return ok({ message: "No document registered for this source_id" });
    }

    const document = docResult.Items[0];
    const documentId = document.document_id as string;

    console.log(`[WEBHOOK] 🔔 Change detected! document=${documentId}, title="${document.title as string}", provider=${provider}, source_id=${sourceId}`);

    // Fetch and sync the file from the provider
    if (provider === "google_drive") {
      console.log(`[WEBHOOK] Triggering Google Drive sync for document=${documentId}...`);
      const { syncFromDrive } = await import("./sync-from-drive");
      const result = await syncFromDrive(document);

      if (!result.success) {
        console.error(`[WEBHOOK] ❌ Sync failed for document=${documentId}:`, result.error);
        return ok({
          message: "Webhook received but sync failed",
          document_id: documentId,
          error: result.error,
        });
      }

      if (result.skipped) {
        console.log(`[WEBHOOK] File unchanged for document=${documentId}, no new version created`);
      } else {
        console.log(`[WEBHOOK] ✅ Sync successful! document=${documentId}, new version=${result.version_number}`);
      }

      return ok({
        message: result.skipped ? "File unchanged, no new version" : "File synced successfully",
        document_id: documentId,
        provider,
        source_id: sourceId,
        version_number: result.version_number,
      });
    }

    // Canva sync
    if (provider === "canva") {
      console.log(`[WEBHOOK] Triggering Canva sync for document=${documentId}...`);
      const { syncFromCanva } = await import("./sync-from-canva");
      const result = await syncFromCanva(document);

      if (!result.success) {
        console.error(`[WEBHOOK] ❌ Canva sync failed for document=${documentId}:`, result.error);
        return ok({
          message: "Webhook received but Canva sync failed",
          document_id: documentId,
          error: result.error,
        });
      }

      if (result.skipped) {
        console.log(`[WEBHOOK] Canva design unchanged for document=${documentId}, no new version`);
      } else {
        console.log(`[WEBHOOK] ✅ Canva sync successful! document=${documentId}, new version=${result.version_number}`);
      }

      return ok({
        message: result.skipped ? "Design unchanged, no new version" : "Canva design synced successfully",
        document_id: documentId,
        provider,
        source_id: sourceId,
        version_number: result.version_number,
      });
    }

    // Unknown provider fallback
    console.log(`[WEBHOOK] Unhandled provider=${provider} for document=${documentId}`);
    return ok({
      message: "Webhook received",
      document_id: documentId,
      provider,
      source_id: sourceId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing webhook:", error);
    return err(message, 500);
  }
};

function extractSourceId(
  provider: string,
  body: Record<string, unknown>,
): string | undefined {
  switch (provider) {
    case "canva":
      // Canva webhook payload has design_id
      return (body.design_id ?? body.id) as string | undefined;
    case "google_drive":
      // Google Drive push notification has resourceId in headers
      // or fileId in the body
      return (body.fileId ?? body.resourceId) as string | undefined;
    default:
      return undefined;
  }
}
