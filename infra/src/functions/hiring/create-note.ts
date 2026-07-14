import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

const TABLE = process.env.HIRING_NOTES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_NOTES_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const body = JSON.parse(event.body ?? "{}");
        if (!body.content) {
            return err("content is required", 400);
        }

        const now = new Date().toISOString();
        const noteId = `${now}_${randomUUID().slice(0, 8)}`;

        const note = {
            candidateId,
            noteId,
            authorId: body.authorId ?? "system",
            authorName: body.authorName ?? "System",
            noteType: body.noteType ?? "general",
            content: body.content,
            createdAt: now,
        };

        await ddbClient.send(new PutCommand({ TableName: TABLE, Item: note }));

        return ok(note, 201);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error creating note:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
