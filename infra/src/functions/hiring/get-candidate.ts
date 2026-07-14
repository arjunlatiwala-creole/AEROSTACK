import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const CANDIDATES_TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;
const NOTES_TABLE = process.env.HIRING_NOTES_TABLE_NAME;

if (!CANDIDATES_TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const result = await ddbClient.send(
            new GetCommand({
                TableName: CANDIDATES_TABLE,
                Key: { candidateId },
            }),
        );

        if (!result.Item) {
            return err("Candidate not found", 404);
        }

        let notes: Record<string, unknown>[] = [];
        if (NOTES_TABLE) {
            const notesResult = await ddbClient.send(
                new QueryCommand({
                    TableName: NOTES_TABLE,
                    KeyConditionExpression: "candidateId = :cid",
                    ExpressionAttributeValues: { ":cid": candidateId },
                    ScanIndexForward: false,
                }),
            );
            notes = (notesResult.Items ?? []) as Record<string, unknown>[];
        }

        return ok({ ...result.Item, notes });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error getting candidate:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
