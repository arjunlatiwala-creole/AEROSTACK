import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_COMP_PLANS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_COMP_PLANS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const result = await ddbClient.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: "GSI_Candidate",
                KeyConditionExpression: "candidateId = :cid",
                ExpressionAttributeValues: { ":cid": candidateId },
                Limit: 1,
            }),
        );

        if (!result.Items || result.Items.length === 0) {
            return ok(null);
        }

        return ok(result.Items[0]);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error getting comp plan:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
