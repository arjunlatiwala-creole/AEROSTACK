import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

/**
 * Allowed stage transitions.
 * Key = current stage, Value = array of valid next stages.
 */
const STAGE_TRANSITIONS: Record<string, string[]> = {
    SUBMISSION: ["REFERRAL", "FIRST_TOUCH"],
    REFERRAL: ["FIRST_TOUCH"],
    FIRST_TOUCH: ["QUALIFIED", "NDA", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    QUALIFIED: ["NDA", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    NDA: ["TEAM_FIT", "SKILLS_FIT"],
    TEAM_FIT: ["SKILLS_FIT", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    SKILLS_FIT: ["TEAM_FIT", "PROPOSAL", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    PROPOSAL: ["NEGOTIATION"],
    NEGOTIATION: ["DEEL_SETUP", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    DEEL_SETUP: ["JOB_OFFER"],
    JOB_OFFER: ["SIGNING", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    SIGNING: ["GOOGLE_WORKSPACE_CREATION", "NEGOTIATION", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    GOOGLE_WORKSPACE_CREATION: ["ONBOARDING_ASSIGNED"],
    ONBOARDING_ASSIGNED: ["HIRED"],
    REFER_OUT: ["FIRST_TOUCH"],
    RECYCLE: ["FIRST_TOUCH"],
    BLACKBALLED: [],
};

const EXIT_STAGES = new Set(["REFER_OUT", "RECYCLE", "BLACKBALLED", "HIRED"]);

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const body = JSON.parse(event.body ?? "{}");
        const targetStage: string | undefined = body.stage;
        const actor: string = body.actor ?? "system";

        if (!targetStage) {
            return err("stage is required in request body", 400);
        }

        // Fetch current candidate
        const current = await ddbClient.send(
            new GetCommand({ TableName: TABLE, Key: { candidateId } }),
        );

        if (!current.Item) {
            return err("Candidate not found", 404);
        }

        const currentStage = current.Item.stage as string;

        if (EXIT_STAGES.has(currentStage) && !STAGE_TRANSITIONS[currentStage]?.includes(targetStage)) {
            return err(`Candidate is in terminal stage: ${currentStage}. Allowed: ${(STAGE_TRANSITIONS[currentStage] ?? []).join(", ")}`, 400);
        }

        const allowed = STAGE_TRANSITIONS[currentStage];
        if (!allowed?.includes(targetStage)) {
            return err(
                `Cannot transition from ${currentStage} to ${targetStage}. Allowed: ${(allowed ?? []).join(", ")}`,
                400,
            );
        }

        const now = new Date().toISOString();
        const stageHistory = [
            ...((current.Item.stageHistory as unknown[]) ?? []),
            { stage: targetStage, enteredAt: now, actor },
        ];

        const updateExpr =
            "SET #stage = :stage, #stageHistory = :history, #updatedAt = :now" +
            (targetStage === "RECYCLE" && body.recycleDate
                ? ", #recycleDate = :recycleDate"
                : "") +
            (EXIT_STAGES.has(targetStage) && targetStage !== "HIRED"
                ? ", #exitReason = :exitReason"
                : "");

        const names: Record<string, string> = {
            "#stage": "stage",
            "#stageHistory": "stageHistory",
            "#updatedAt": "updatedAt",
        };
        const values: Record<string, unknown> = {
            ":stage": targetStage,
            ":history": stageHistory,
            ":now": now,
        };

        if (targetStage === "RECYCLE" && body.recycleDate) {
            names["#recycleDate"] = "recycleDate";
            values[":recycleDate"] = body.recycleDate;
        }
        if (EXIT_STAGES.has(targetStage) && targetStage !== "HIRED") {
            names["#exitReason"] = "exitReason";
            values[":exitReason"] = targetStage.toLowerCase().replace("_", "-");
        }

        const result = await ddbClient.send(
            new UpdateCommand({
                TableName: TABLE,
                Key: { candidateId },
                UpdateExpression: updateExpr,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
                ReturnValues: "ALL_NEW",
            }),
        );

        return ok(result.Attributes);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error advancing stage:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
