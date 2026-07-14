import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { extractUser, canModifyDocument } from "./doc-auth";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) {
  throw new Error("DOCUMENTS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const existing = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!existing.Item || existing.Item.is_deleted) {
      return err("Document not found", 404);
    }

    // Ownership check: admin/superadmin can delete any, others only their own
    const user = extractUser(event);
    if (!canModifyDocument(user, existing.Item)) {
      return err("You can only delete your own documents", 403);
    }

    // Soft delete
    await ddbClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
        UpdateExpression: "SET is_deleted = :d, updated_at = :now",
        ExpressionAttributeValues: {
          ":d": true,
          ":now": new Date().toISOString(),
        },
      }),
    );

    // Stop Drive watch if this was a google_drive document
    const channelId = existing.Item.drive_watch_channel_id as string | undefined;
    const resourceId = existing.Item.drive_watch_resource_id as string | undefined;
    if (channelId && resourceId) {
      try {
        const ownerEmail = (existing.Item.owner_email as string) ?? (existing.Item.org_id as string);
        const { stopWatch } = await import("./drive-watch");
        await stopWatch(channelId, resourceId, ownerEmail);
        console.log(`[DELETE] Drive watch stopped: channelId=${channelId}`);
      } catch (watchErr) {
        console.warn(`[DELETE] Failed to stop Drive watch (will expire naturally):`, watchErr);
      }
    }

    return ok({ message: "Document deleted", document_id: documentId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error deleting document:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
