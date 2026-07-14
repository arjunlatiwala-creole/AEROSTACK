import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { randomUUID } from "node:crypto";

/**
 * Public endpoint — no Cognito auth, no withPermissions.
 * Candidates submit their own applications here.
 * Basic validation only; rate limiting handled at API Gateway level.
 */

const TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_CANDIDATES_TABLE_NAME is required");
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const body = JSON.parse(event.body ?? "{}");

        // Validate required fields
        if (!body.name || typeof body.name !== "string" || body.name.trim().length < 2) {
            return err("A valid name is required (at least 2 characters)", 400);
        }
        if (!body.email || !EMAIL_REGEX.test(body.email)) {
            return err("A valid email address is required", 400);
        }

        const email = body.email.trim().toLowerCase();

        // Check for duplicate email (prevent spam re-submissions)
        const existing = await ddbClient.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: "GSI_Email",
                KeyConditionExpression: "email = :e",
                ExpressionAttributeValues: { ":e": email },
                Limit: 1,
            }),
        );

        if (existing.Items && existing.Items.length > 0) {
            const existingCandidate = existing.Items[0];
            const stage = existingCandidate.stage as string;
            // Allow re-application only if previously blackballed
            if (stage !== "BLACKBALLED") {
                return err(
                    "An application with this email already exists. If you believe this is an error, please contact us.",
                    409,
                );
            }
        }

        const now = new Date().toISOString();
        const candidateId = randomUUID();

        const candidate = {
            candidateId,
            name: body.name.trim(),
            email,
            phone: body.phone?.trim() ?? null,
            source: body.source ?? "website",
            referredBy: body.referredBy?.trim() ?? null,
            referralType: body.referralType ?? null,
            jobRecId: body.jobRecId ?? "general",
            stage: "SUBMISSION",
            stageHistory: [
                {
                    stage: "SUBMISSION",
                    enteredAt: now,
                    actor: "self-application",
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
            ownerId: null,
            resumeUrl: null,
            resumeS3Key: body.resumeS3Key?.trim() ?? null,
            notes: body.message?.trim() ?? null,
            linkedinUrl: body.linkedinUrl?.trim() ?? null,
            createdAt: now,
            updatedAt: now,
        };

        await ddbClient.send(
            new PutCommand({ TableName: TABLE, Item: candidate }),
        );

        return ok(
            {
                candidateId,
                message: "Application submitted successfully. We will be in touch.",
            },
            201,
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error submitting public application:", error);
        return err("Something went wrong. Please try again later.", 500);
    }
};
