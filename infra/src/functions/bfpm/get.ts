import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResult } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const logger = createLogger("GetSessionHandler");
const ddb = ddbClient;

const _handler = async (event: any): Promise<APIGatewayProxyResult> => {
  logger.info("Get session handler called");

  const authResult = authorizeUser(event, UserRole.ENGINEER);
  if (isAuthError(authResult)) return authResult.error;

  const sessionsTable = process.env.BFPM_SESSIONS_TABLE_NAME;
  const dataTable = process.env.BFPM_DATA_TABLE_NAME;
  if (!sessionsTable || !dataTable) {
    return err("Server configuration error", 500);
  }

  try {
    const sessionId = event.pathParameters?.sessionId;


    /**
     * GET /bfpm/session/{sesssionId}
     */
    if (sessionId) {
      const result = await ddb.send(
        new QueryCommand({
          TableName: sessionsTable,
          KeyConditionExpression: "sessionId = :sid",
          ExpressionAttributeValues: {
            ":sid": sessionId,
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        return err("Session not found", 404);
      }
      const dataResult = await ddb.send(
        new GetCommand({
          TableName: dataTable,
          Key: { sessionId },
        })
      );
      return ok({
        data: {
          sessions: result.Items,
          data: dataResult.Item || {},
        },
      });
    }

    const queryParams = event.queryStringParameters || {};
    const limit = queryParams.limit
      ? parseInt(queryParams.limit, 10)
      : 100;

    // Decode lastEvaluatedKey if provided (from previous request)
    let exclusiveStartKey: Record<string, any> | undefined;
    if (queryParams.lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(queryParams.lastEvaluatedKey, "base64").toString("utf-8")
        );
      } catch (error) {
        logger.warn("Invalid lastEvaluatedKey format", { error });
        return err("Invalid lastEvaluatedKey format", 400);
      }
    }

    // Validate limit
    if (isNaN(limit) || limit < 1 || limit > 101) {
      return err("Limit must be between 1 and 1000", 400);
    }

    /**
     * GET /bfpm/session
     */
    const result = await ddb.send(
      new ScanCommand({
        TableName: sessionsTable,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey
      })
    );

    const mergedItems = await Promise.all(
      (result.Items || []).map(async (session) => {
        const dataResult = await ddb.send(
          new GetCommand({
            TableName: dataTable,
            Key: { sessionId: session.sessionId },
          })
        );
        return {
          ...session,
          data: dataResult.Item || {},
        };
      })
    );

    // result.LastEvaluatedKey exists if DynamoDB has more items
    let nextCursor: string | null = null;
    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString("base64");
    }

    // return ok(mergedItems);
    return ok({
      mergedItems,
      limit,
      lastEvaluatedKey: nextCursor,  // ← This comes from result.LastEvaluatedKey
      hasMore: !!result.LastEvaluatedKey,  // ← True if more items exist
    });
  } catch (error: any) {
    logger.error("Failed to fetch session(s)", { error });
    return err("Failed to fetch sessions", 500);
  }
};
export const handler = withPermissions(_handler);
