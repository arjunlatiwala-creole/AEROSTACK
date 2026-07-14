import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

const DEFAULT_LIMIT = 20;

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const params = event.queryStringParameters ?? {};
        const stageFilter = params.stage;
        const jobRecFilter = params.jobRecId;
        const limit = Math.min(Number(params.limit) || DEFAULT_LIMIT, 100);
        const cursor = params.cursor; // base64-encoded LastEvaluatedKey

        let exclusiveStartKey: Record<string, unknown> | undefined;
        if (cursor) {
            try {
                exclusiveStartKey = JSON.parse(
                    Buffer.from(cursor, "base64").toString("utf-8"),
                );
            } catch {
                return err("Invalid cursor", 400);
            }
        }

        let items: Record<string, unknown>[] = [];
        let lastEvaluatedKey: Record<string, unknown> | undefined;

        if (stageFilter) {
            const result = await ddbClient.send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: "GSI_Stage",
                    KeyConditionExpression: "stage = :s",
                    ExpressionAttributeValues: { ":s": stageFilter },
                    ScanIndexForward: false,
                    Limit: limit,
                    ExclusiveStartKey: exclusiveStartKey,
                }),
            );
            items = (result.Items ?? []) as Record<string, unknown>[];
            lastEvaluatedKey = result.LastEvaluatedKey as
                | Record<string, unknown>
                | undefined;
        } else if (jobRecFilter) {
            const result = await ddbClient.send(
                new QueryCommand({
                    TableName: TABLE,
                    IndexName: "GSI_JobRec",
                    KeyConditionExpression: "jobRecId = :j",
                    ExpressionAttributeValues: { ":j": jobRecFilter },
                    ScanIndexForward: false,
                    Limit: limit,
                    ExclusiveStartKey: exclusiveStartKey,
                }),
            );
            items = (result.Items ?? []) as Record<string, unknown>[];
            lastEvaluatedKey = result.LastEvaluatedKey as
                | Record<string, unknown>
                | undefined;
        } else {
            const result = await ddbClient.send(
                new ScanCommand({
                    TableName: TABLE,
                    Limit: limit,
                    ExclusiveStartKey: exclusiveStartKey,
                }),
            );
            items = (result.Items ?? []) as Record<string, unknown>[];
            lastEvaluatedKey = result.LastEvaluatedKey as
                | Record<string, unknown>
                | undefined;
        }

        const nextCursor = lastEvaluatedKey
            ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
            : null;

        return ok({
            candidates: items,
            count: items.length,
            nextCursor,
            hasMore: !!nextCursor,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error listing candidates:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
