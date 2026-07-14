import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";

const logger = createLogger("UpsertPersonInformation");
const ddb = ddbClient;

const PERSON_INFO_TABLE = process.env.PERSON_INFORMATION_TABLE_NAME;

const getEmailFromEvent = (event: any) => {
  const claims =
    event.requestContext?.authorizer?.claims ||
    event.requestContext?.authorizer?.jwt?.claims;

  return claims?.email || claims?.["cognito:username"] || null;
};

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!PERSON_INFO_TABLE) {
      logger.error("Missing environment variables", {
        PERSON_INFORMATION_TABLE_NAME: false,
      });
      return err("Missing environment variables", 500);
    }

    let payload: any = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch (parseError) {
      return err("Invalid JSON body", 400);
    }

    const email =
      getEmailFromEvent(event) ||
      (process.env.AWS_SAM_LOCAL === "true" ? payload.email : null);
    if (!email) return err("User not authenticated", 401);

    const now = new Date().toISOString();
    const name =
      payload.name ||
      `${payload.given_name || ""} ${payload.family_name || ""}`.trim();

    const updateRes = await ddb.send(
      new UpdateCommand({
        TableName: PERSON_INFO_TABLE,
        Key: { email },
        UpdateExpression:
          "SET #name = :name, given_name = :given_name, family_name = :family_name, alternate_email = :alternate_email, employment_status = :employment_status, job_title = :job_title, title = :title, #level = :level, start_date = :start_date, direct_reports = :direct_reports, addresses = :addresses, updated_at = :updated_at, created_at = if_not_exists(created_at, :created_at)",
        ExpressionAttributeNames: {
          "#name": "name",
          "#level": "level",
        },
        ExpressionAttributeValues: {
          ":name": name || null,
          ":given_name": payload.given_name || null,
          ":family_name": payload.family_name || null,
          ":alternate_email": payload.alternate_email || null,
          ":employment_status": payload.employment_status || "active",
          ":job_title": payload.job_title || null,
          ":title": payload.title || null,
          ":level":
            typeof payload.level === "number"
              ? payload.level
              : Number(payload.level || 0),
          ":start_date": payload.start_date || null,
          ":direct_reports": Array.isArray(payload.direct_reports)
            ? payload.direct_reports
            : [],
          ":addresses": Array.isArray(payload.addresses)
            ? payload.addresses
            : [],
          ":updated_at": now,
          ":created_at": now,
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    logger.info("Person information upserted", { email });
    return ok(updateRes.Attributes || { email });
  } catch (error: any) {
    logger.error("Error upserting person information", {
      message: error.message,
    });
    return err(error.message || "Internal server error", 500);
  }
};

export const handler = withPermissions(_handler);
