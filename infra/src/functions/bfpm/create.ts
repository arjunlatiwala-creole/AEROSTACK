import { randomUUID } from "node:crypto";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResult } from "aws-lambda";

import {
  ActionPlanSchema,
  BeaconSessionSchema,
  BfpmSessionSchema,
  FocusSessionSchema,
  PerspexInputSchema,
  PerspexSummarySchema,
} from "src/shared/validation/bfpm.schema";

import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { ddbClient } from "src/shared/dynamodb-client";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const logger = createLogger("BfpmHandler");
const ddb = ddbClient;

/**
 * Session workflow transitions
 */
const STATUS_TRANSITION: Record<string, string> = {
  beacon: "focus",
  focus: "perspex",
  "perspex-input": "perspex",
  "perspex-summary": "move",
  "action-plan": "completed",
};

/**
 * Fetch session (composite key table)
 */
const getSessionById = async (tableName: string, sessionId: string) => {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "sessionId = :sid",
      ExpressionAttributeValues: {
        ":sid": sessionId,
      },
      Limit: 1,
      ScanIndexForward: false,
    })
  );

  return result.Items?.[0];
};

/**
 * Update session status safely
 */
const updateSessionStatus = async (
  tableName: string,
  session: { sessionId: string; createdAt: string },
  nextStatus: string,
  updatedAt: string
) => {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
      },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": nextStatus,
        ":updatedAt": updatedAt,
      },
    })
  );
};

const _handler = async (event: any): Promise<APIGatewayProxyResult> => {
  logger.info("BFPM resource accessed");

  const authResult = authorizeUser(event, UserRole.ENGINEER);
  if (isAuthError(authResult)) {
    return authResult.error;
  }

  const { user } = authResult;
  logger.info(
    `BFPM resource accessed by user=${user.username}, role=${user.role}`
  );

  const sessionsTable = process.env.BFPM_SESSIONS_TABLE_NAME;
  const dataTable = process.env.BFPM_DATA_TABLE_NAME;

  if (!sessionsTable || !dataTable) {
    logger.error("Missing table configuration");
    return err("Server configuration error", 500);
  }

  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return err("Invalid JSON body", 400);
  }

  const path = event.path.replace(/^\/|\/$/g, "");
  const resource = path.split("/").pop() || "";
  const sessionId = event.queryStringParameters?.sessionId;
  const now = new Date().toISOString();

  try {
    switch (resource) {
      /**
       * CREATE SESSION
       */
      case "session": {
        const newSession = BfpmSessionSchema.parse({
          sessionId: randomUUID(),
          createdAt: now,
          ...body,
        });

        await ddb.send(
          new PutCommand({
            TableName: sessionsTable,
            Item: newSession,
          })
        );

        await ddb.send(
          new PutCommand({
            TableName: dataTable,
            Item: {
              sessionId: newSession.sessionId,
              perspexInputs: [],
            },
          })
        );

        return ok(newSession, 201);
      }

      /**
       * SESSION STEPS
       */
      case "beacon":
      case "focus":
      case "perspex-input":
      case "perspex-summary":
      case "action-plan": {
        if (!sessionId) return err("sessionId is required", 400);

        const dataRecord = await ddb.send(
          new GetCommand({
            TableName: dataTable,
            Key: { sessionId },
          })
        );

        if (!dataRecord.Item) return err("Session not found", 404);

        let updateExpression = "";
        let expressionValues: any = {};
        let parsedItem: any;

        switch (resource) {
          case "beacon":
            parsedItem = BeaconSessionSchema.parse({
              beaconId: randomUUID(),
              createdAt: now,
              sessionId,
              ...body,
            });
            updateExpression = "SET beacon = :val";
            expressionValues = { ":val": parsedItem };
            break;

          case "focus":
            parsedItem = FocusSessionSchema.parse({
              focusId: randomUUID(),
              createdAt: now,
              sessionId,
              ...body,
            });
            updateExpression = "SET focus = :val";
            expressionValues = { ":val": parsedItem };
            break;

          case "perspex-input":
            parsedItem = PerspexInputSchema.parse({
              inputId: randomUUID(),
              createdAt: now,
              sessionId,
              ...body,
            });
            updateExpression =
              "SET perspexInputs = list_append(if_not_exists(perspexInputs, :empty), :new)";
            expressionValues = {
              ":new": [parsedItem],
              ":empty": [],
            };
            break;

          case "perspex-summary":
            parsedItem = PerspexSummarySchema.parse({
              summaryId: randomUUID(),
              createdAt: now,
              sessionId,
              ...body,
            });
            updateExpression = "SET perspexSummary = :val";
            expressionValues = { ":val": parsedItem };
            break;

          case "action-plan":
            parsedItem = ActionPlanSchema.parse({
              planId: randomUUID(),
              createdAt: now,
              sessionId,
              ...body,
            });
            updateExpression = "SET actionPlan = :val";
            expressionValues = { ":val": parsedItem };
            break;
        }

        await ddb.send(
          new UpdateCommand({
            TableName: dataTable,
            Key: { sessionId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionValues,
          })
        );

        const nextStatus = STATUS_TRANSITION[resource];
        if (nextStatus) {
          const session = await getSessionById(sessionsTable, sessionId);
          if (!session) return err("Session not found", 404);

          await updateSessionStatus(
            sessionsTable,
            session as any,
            nextStatus,
            now
          );
        }

        return ok(parsedItem, 201);
      }

      default:
        return err("Route not found", 404);
    }
  } catch (error: any) {
    if (error?.issues) {
      logger.warn("Validation failed", { error });
      return err("Invalid payload", 400);
    }

    logger.error("Handler failed", { error });
    return err("Failed to process", 500);
  }
};
export const handler = withPermissions(_handler);
