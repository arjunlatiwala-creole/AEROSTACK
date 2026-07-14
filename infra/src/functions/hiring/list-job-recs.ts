import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_JOB_RECS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_JOB_RECS_TABLE_NAME is required");
}

/**
 * Authenticated list — returns all job recs (any status) for admin.
 */
const _handler: APIGatewayProxyHandlerV2 = async () => {
    try {
        let items: Record<string, unknown>[] = [];
        let lastKey: Record<string, unknown> | undefined;

        do {
            const result = await ddbClient.send(
                new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }),
            );
            if (result.Items) items.push(...(result.Items as Record<string, unknown>[]));
            lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        // Sort newest first
        items.sort((a, b) => {
            const aDate = a.createdAt as string;
            const bDate = b.createdAt as string;
            return bDate.localeCompare(aDate);
        });

        return ok({ jobRecs: items, count: items.length });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error listing job recs:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
