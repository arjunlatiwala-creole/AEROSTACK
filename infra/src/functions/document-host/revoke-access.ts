import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { extractUser, canModifyDocument } from "./doc-auth";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME;

if (!DOCS_TABLE) {
  throw new Error("DOCUMENTS_TABLE_NAME is required");
}
if (!ACCESS_TABLE) {
  throw new Error("DOCUMENT_ACCESS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;
    const accessId = event.pathParameters?.accessId;

    if (!documentId || !accessId) {
      return err("documentId and accessId path parameters are required", 400);
    }

    // Verify access record exists
    const existing = await ddbClient.send(
      new GetCommand({
        TableName: ACCESS_TABLE,
        Key: { document_id: documentId, access_id: accessId },
      }),
    );

    if (!existing.Item) {
      return err("Access record not found", 404);
    }

    // Verify document exists and check ownership
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const user = extractUser(event);
    if (!canModifyDocument(user, docResult.Item)) {
      return err("You can only manage sharing for your own documents", 403);
    }

    if (docResult.Item.source_provider !== "manual") {
      return err("Revoking access is only supported for manually uploaded documents.", 400);
    }

    await ddbClient.send(
      new DeleteCommand({
        TableName: ACCESS_TABLE,
        Key: { document_id: documentId, access_id: accessId },
      }),
    );

    return ok({ message: "Access revoked", access_id: accessId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error revoking access:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
