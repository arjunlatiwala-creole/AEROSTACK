import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const body = JSON.parse(event.body ?? "{}");

        if (!body.name || !body.email) {
            return err("name and email are required", 400);
        }

        const VALID_REFERRAL_TYPES = ["personal", "network", "stranger"];
        const referralType = body.referralType && VALID_REFERRAL_TYPES.includes(body.referralType)
            ? body.referralType
            : null;

        const now = new Date().toISOString();
        const candidateId = randomUUID();

        const candidate = {
            candidateId,
            name: body.name,
            email: body.email.toLowerCase(),
            phone: body.phone ?? null,
            source: body.source ?? "direct",
            referredBy: body.referredBy ?? null,
            referralType,
            jobRecId: body.jobRecId ?? "general",
            stage: "SUBMISSION",
            stageHistory: [
                {
                    stage: "SUBMISSION",
                    enteredAt: now,
                    actor: body.submittedBy ?? "system",
                },
            ],
            exitReason: null,
            recycleDate: null,
            ndaSigned: false,
            ndaSignedAt: null,
            teamFitScore: null,
            teamFitInterviewer: null,
            skillsFitScore: null,
            skillsFitInterviewer: null,
            proposalSentAt: null,
            offerSentAt: null,
            deelEmployeeId: null,
            googleWorkspaceEmail: null,
            onboardingAssigned: false,
            ownerId: body.ownerId ?? null,
            resumeUrl: body.resumeUrl ?? null,
            notes: body.notes ?? null,
            createdAt: now,
            updatedAt: now,
        };

        await ddbClient.send(
            new PutCommand({ TableName: TABLE, Item: candidate }),
        );

        return ok(candidate, 201);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error creating candidate:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
