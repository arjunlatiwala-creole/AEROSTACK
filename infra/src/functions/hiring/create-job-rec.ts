import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

const TABLE = process.env.HIRING_JOB_RECS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_JOB_RECS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const body = JSON.parse(event.body ?? "{}");

        if (!body.title || !body.department) {
            return err("title and department are required", 400);
        }

        const now = new Date().toISOString();
        const jobRecId = randomUUID();

        const jobRec = {
            jobRecId,
            title: body.title.trim(),
            department: body.department.trim(),
            location: body.location?.trim() ?? "Remote",
            jobType: body.jobType ?? "full-time",
            description: body.description?.trim() ?? "",
            requirements: body.requirements ?? [],
            responsibilities: body.responsibilities ?? [],
            salaryRange: body.salaryRange?.trim() ?? null,
            status: "open",
            ownerId: body.ownerId ?? null,
            createdAt: now,
            updatedAt: now,
        };

        await ddbClient.send(new PutCommand({ TableName: TABLE, Item: jobRec }));

        return ok(jobRec, 201);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error creating job rec:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
