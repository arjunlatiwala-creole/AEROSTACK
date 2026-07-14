import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

/** Fields that can be updated directly (not stage — use advance-stage). */
const ALLOWED_FIELDS = [
    "name",
    "email",
    "phone",
    "source",
    "referredBy",
    "jobRecId",
    "ownerId",
    "resumeUrl",
    "ndaSigned",
    "ndaSignedAt",
    "teamFitScore",
    "teamFitInterviewer",
    "skillsFitScore",
    "skillsFitInterviewer",
    "proposalSentAt",
    "offerSentAt",
    "deelEmployeeId",
    "googleWorkspaceEmail",
    "onboardingAssigned",
    "notes",
];

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
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
                Key: { candidateId },
                UpdateExpression: `SET ${expressionParts.join(", ")}`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ReturnValues: "ALL_NEW",
                ConditionExpression: "attribute_exists(candidateId)",
            }),
        );

        return ok(result.Attributes);
    } catch (error: unknown) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
            return err("Candidate not found", 404);
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error updating candidate:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
