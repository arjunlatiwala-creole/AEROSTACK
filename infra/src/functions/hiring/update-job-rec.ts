import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_JOB_RECS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_JOB_RECS_TABLE_NAME is required");
}

const ALLOWED_FIELDS = [
    "title",
    "department",
    "location",
    "jobType",
    "description",
    "requirements",
    "responsibilities",
    "salaryRange",
    "status",
    "ownerId",
];

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const jobRecId = event.pathParameters?.jobRecId;
        if (!jobRecId) {
            return err("jobRecId path parameter is required", 400);
        }

        const body = JSON.parse(event.body ?? "{}");
        const now = new Date().toISOString();

        const expressionParts: string[] = ["#updatedAt = :now"];
        const names: Record<string, string> = { "#updatedAt": "updatedAt" };
        const values: Record<string, unknown> = { ":now": now };

        for (const field of ALLOWED_FIELDS) {
            if (body[field] !== undefined) {
                const placeholder = `#f_${field}`;
                const valuePlaceholder = `:v_${field}`;
                expressionParts.push(`${placeholder} = ${valuePlaceholder}`);
                names[placeholder] = field;
                values[valuePlaceholder] = body[field];
            }
        }

        const result = await ddbClient.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { jobRecId },
                UpdateExpression: `SET ${expressionParts.join(", ")}`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ReturnValues: "ALL_NEW",
                ConditionExpression: "attribute_exists(jobRecId)",
            }),
        );

        return ok(result.Attributes);
    } catch (error: unknown) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
            return err("Job rec not found", 404);
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error updating job rec:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
