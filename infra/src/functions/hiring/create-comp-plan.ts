import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

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

        const body = JSON.parse(event.body ?? "{}");

        // Check if comp plan already exists for this candidate
        const existing = await ddbClient.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: "GSI_Candidate",
                KeyConditionExpression: "candidateId = :cid",
                ExpressionAttributeValues: { ":cid": candidateId },
                Limit: 1,
            }),
        );

        if (existing.Items && existing.Items.length > 0) {
            return err("Comp plan already exists for this candidate. Use PUT to update.", 409);
        }

        const now = new Date().toISOString();
        const compPlanId = randomUUID();

        const compPlan = {
            compPlanId,
            candidateId,
            status: "draft",

            // Candidate context
            candidateName: body.candidateName ?? "",
            jobTitle: body.jobTitle ?? "",
            department: body.department ?? "",
            startDate: body.startDate ?? null,
            countryCode: body.countryCode ?? "US",

            // Block 1: Base Salary
            baseSalary: body.baseSalary ?? 0,
            baseCurrency: body.baseCurrency ?? "USD",
            baseFrequency: body.baseFrequency ?? "annually",

            // Block 2: Variable / Commissions
            variableType: body.variableType ?? "percentage",
            variableAmount: body.variableAmount ?? 0,
            variableFrequency: body.variableFrequency ?? "annually",
            variableDescription: body.variableDescription ?? "",

            // Block 3: MBOs / Goals
            mboTargetAmount: body.mboTargetAmount ?? 0,
            mboFrequency: body.mboFrequency ?? "annually",
            mboDescription: body.mboDescription ?? "",

            // Block 4: Equity
            equityShares: body.equityShares ?? 0,
            equityType: body.equityType ?? "stock_options",
            equityVestingMonths: body.equityVestingMonths ?? 48,
            equityCliffMonths: body.equityCliffMonths ?? 12,
            equityStrikePrice: body.equityStrikePrice ?? 0,

            // Block 5: Profits Interest
            profitsInterestPercent: body.profitsInterestPercent ?? 0,
            profitsInterestVestingMonths: body.profitsInterestVestingMonths ?? 48,
            profitsInterestCliffMonths: body.profitsInterestCliffMonths ?? 12,

            // Block 6: Benefits
            healthBenefits: body.healthBenefits ?? false,
            healthEmployerContribution: body.healthEmployerContribution ?? 0,
            ptoDays: body.ptoDays ?? 0,
            otherBenefits: body.otherBenefits ?? "",

            // Calculated totals (computed on save)
            totalAnnualComp: 0,
            totalMonthlyComp: 0,
            totalPackageValue: 0,

            // Notes
            notes: body.notes ?? "",

            createdAt: now,
            updatedAt: now,
        };

        // Calculate totals
        const baseAnnual =
            compPlan.baseFrequency === "annually"
                ? compPlan.baseSalary
                : compPlan.baseSalary * 12;

        const variableAnnual =
            compPlan.variableType === "percentage"
                ? baseAnnual * (compPlan.variableAmount / 100)
                : compPlan.variableFrequency === "annually"
                    ? compPlan.variableAmount
                    : compPlan.variableFrequency === "quarterly"
                        ? compPlan.variableAmount * 4
                        : compPlan.variableAmount * 12;

        const mboAnnual =
            compPlan.mboFrequency === "annually"
                ? compPlan.mboTargetAmount
                : compPlan.mboFrequency === "quarterly"
                    ? compPlan.mboTargetAmount * 4
                    : compPlan.mboTargetAmount * 12;

        compPlan.totalAnnualComp = baseAnnual + variableAnnual + mboAnnual;
        compPlan.totalMonthlyComp = compPlan.totalAnnualComp / 12;
        compPlan.totalPackageValue =
            compPlan.totalAnnualComp +
            compPlan.equityShares * compPlan.equityStrikePrice;

        await ddbClient.send(
            new PutCommand({ TableName: TABLE, Item: compPlan }),
        );

        return ok(compPlan, 201);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error creating comp plan:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
