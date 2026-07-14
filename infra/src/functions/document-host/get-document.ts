import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

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

    const result = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!result.Item || result.Item.is_deleted) {
      return err("Document not found", 404);
    }

    return ok(result.Item);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error getting document:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
