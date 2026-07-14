import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME;

if (!TABLE) {
  throw new Error("DOCUMENT_VERSIONS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const result = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "document_id = :d",
        ExpressionAttributeValues: { ":d": documentId },
        ScanIndexForward: false, // newest first
      }),
    );

    return ok({
      versions: result.Items ?? [],
      count: result.Items?.length ?? 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error getting versions:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
