import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) {
  throw new Error("DOCUMENTS_TABLE_NAME is required");
}

const DEFAULT_LIMIT = 20;

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const params = event.queryStringParameters ?? {};
    const orgFilter = params.org_id;
    const visibilityFilter = params.visibility;
    const limit = Math.min(Number(params.limit) || DEFAULT_LIMIT, 100);
    const cursor = params.cursor;

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64").toString("utf-8"),
        );
      } catch {
        return err("Invalid cursor", 400);
      }
    }

    let items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    if (orgFilter) {
      const filterParts: string[] = ["is_deleted = :f"];
      const orgExprValues: Record<string, unknown> = { ":o": orgFilter, ":f": false };

      if (visibilityFilter) {
        filterParts.push("visibility = :v");
        orgExprValues[":v"] = visibilityFilter;
      }

      const result = await ddbClient.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI_OrgId",
          KeyConditionExpression: "org_id = :o",
          FilterExpression: filterParts.join(" AND "),
          ExpressionAttributeValues: orgExprValues,
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items = (result.Items ?? []) as Record<string, unknown>[];
      lastEvaluatedKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } else {
      const filterParts: string[] = ["is_deleted = :f"];
      const exprValues: Record<string, unknown> = { ":f": false };

      if (visibilityFilter) {
        filterParts.push("visibility = :v");
        exprValues[":v"] = visibilityFilter;
      }

      const result = await ddbClient.send(
        new ScanCommand({
          TableName: TABLE,
          FilterExpression: filterParts.join(" AND "),
          ExpressionAttributeValues: exprValues,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items = (result.Items ?? []) as Record<string, unknown>[];
      lastEvaluatedKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    }

    const nextCursor = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
      : null;

    return ok({
      documents: items,
      count: items.length,
      nextCursor,
      hasMore: !!nextCursor,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error listing documents:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
