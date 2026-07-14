import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";

const TABLE = process.env.HIRING_JOB_RECS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_JOB_RECS_TABLE_NAME is required");
}

/**
 * Public endpoint — no auth. Returns a single open job by ID.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const jobRecId = event.pathParameters?.jobRecId;
        if (!jobRecId) {
            return err("jobRecId is required", 400);
        }

        const result = await ddbClient.send(
            new GetCommand({ TableName: TABLE, Key: { jobRecId } }),
        );

        if (!result.Item || result.Item.status !== "open") {
            return err("Job not found or no longer accepting applications", 404);
        }

        const job = {
            jobRecId: result.Item.jobRecId,
            title: result.Item.title,
            department: result.Item.department,
            location: result.Item.location,
            jobType: result.Item.jobType,
            description: result.Item.description,
            requirements: result.Item.requirements,
            responsibilities: result.Item.responsibilities,
            salaryRange: result.Item.salaryRange,
            createdAt: result.Item.createdAt,
        };

        return ok(job);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error getting public job:", error);
        return err("Failed to load job", 500);
    }
};
