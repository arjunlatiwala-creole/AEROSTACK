import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";

const TABLE = process.env.HIRING_JOB_RECS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_JOB_RECS_TABLE_NAME is required");
}

/**
 * Public endpoint — no auth. Returns only open jobs.
 * Strips internal fields (ownerId, etc.).
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
    try {
        const result = await ddbClient.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: "GSI_Status",
                KeyConditionExpression: "#status = :open",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: { ":open": "open" },
                ScanIndexForward: false,
            }),
        );

        const jobs = (result.Items ?? []).map((item) => ({
            jobRecId: item.jobRecId,
            title: item.title,
            department: item.department,
            location: item.location,
            jobType: item.jobType,
            description: item.description,
            requirements: item.requirements,
            responsibilities: item.responsibilities,
            salaryRange: item.salaryRange,
            createdAt: item.createdAt,
        }));

        return ok({ jobs, count: jobs.length });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error listing public jobs:", error);
        return err("Failed to load jobs", 500);
    }
};
