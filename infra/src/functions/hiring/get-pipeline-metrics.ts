import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

const ACTIVE_STAGES = [
    "SUBMISSION",
    "REFERRAL",
    "FIRST_TOUCH",
    "QUALIFIED",
    "NDA",
    "TEAM_FIT",
    "SKILLS_FIT",
    "PROPOSAL",
    "NEGOTIATION",
    "DEEL_SETUP",
    "JOB_OFFER",
    "SIGNING",
    "GOOGLE_WORKSPACE_CREATION",
    "ONBOARDING_ASSIGNED",
    "HIRED",
];

const EXIT_STAGES = ["REFER_OUT", "RECYCLE", "BLACKBALLED"];

const _handler: APIGatewayProxyHandlerV2 = async () => {
    try {
        let items: Record<string, unknown>[] = [];
        let lastKey: Record<string, unknown> | undefined;

        do {
            const result = await ddbClient.send(
                new ScanCommand({
                    TableName: TABLE,
                    ExclusiveStartKey: lastKey,
                }),
            );
            if (result.Items) items.push(...(result.Items as Record<string, unknown>[]));
            lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        const byStage: Record<string, number> = {};
        for (const stage of [...ACTIVE_STAGES, ...EXIT_STAGES]) {
            byStage[stage] = 0;
        }
        for (const item of items) {
            const stage = item.stage as string;
            byStage[stage] = (byStage[stage] ?? 0) + 1;
        }

        const totalActive = ACTIVE_STAGES.reduce(
            (sum, s) => sum + (byStage[s] ?? 0),
            0,
        );
        const totalExited = EXIT_STAGES.reduce(
            (sum, s) => sum + (byStage[s] ?? 0),
            0,
        );

        return ok({
            totalCandidates: items.length,
            totalActive,
            totalExited,
            totalHired: byStage["HIRED"] ?? 0,
            byStage,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error getting pipeline metrics:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
