import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");

/**
 * Manually triggers a sync for a Canva or Drive document.
 * Route: POST /documents/{documentId}/sync
 *
 * For Canva docs, the body may include:
 *   { fileData: "<base64>", fileMime: "image/png" }
 * when the client-side fetch is used (server can't bypass Cloudflare).
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;
    if (!documentId) return err("documentId path parameter is required", 400);

    const docResult = await ddbClient.send(
      new GetCommand({ TableName: TABLE, Key: { document_id: documentId } }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const doc = docResult.Item;
    const provider = doc.source_provider as string;

    if (provider === "manual") {
      return err("Manual documents don't support sync", 400);
    }

    if (provider === "google_drive") {
      const { syncFromDrive } = await import("./sync-from-drive");
      const result = await syncFromDrive(doc as Record<string, unknown>);
      if (!result.success) return ok({ synced: false, error: result.error });
      return ok({ synced: !result.skipped, version: result.version_number, skipped: result.skipped });
    }

    if (provider === "canva") {
      // Check if the client sent file data (browser-side fetch)
      let body: { fileData?: string; fileMime?: string } = {};
      if (event.body) {
        try {
          body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
        } catch { /* ignore parse errors */ }
      }

      const docWithFileData = { ...doc } as Record<string, unknown>;
      if (body.fileData) {
        docWithFileData._fileData = body.fileData;
        docWithFileData._fileMime = body.fileMime ?? "image/png";
      }

      const { syncFromCanva } = await import("./sync-from-canva");
      const result = await syncFromCanva(docWithFileData);
      if (!result.success) {
        return ok({
          synced: false,
          error: result.error,
        });
      }
      return ok({ synced: !result.skipped, version: result.version_number, skipped: result.skipped });
    }

    return err(`Unknown provider: ${provider}`, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error triggering sync:", error);
    return err(message, 500);
  }
};

export const handler: APIGatewayProxyHandlerV2 = _handler;
