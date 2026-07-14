import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("get-deel-people-count", context);
  const tableName = process.env.DEEL_PEOPLE_TABLE_NAME;

  if (!tableName) {
    logger.error("Missing DEEL_PEOPLE_TABLE_NAME");
    return err("Internal Server Error", 500);
  }

  try {
    let count = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await ddbClient.send(
        new ScanCommand({
          TableName: tableName,
          Select: "COUNT",
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
      count += result.Count ?? 0;
      lastEvaluatedKey = result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    return ok({ count });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to count people", { error: message });
    return err("Internal Server Error", 500);
  }
};

export const handler = withPermissions(_handler);
