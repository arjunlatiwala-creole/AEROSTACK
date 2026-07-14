import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const TABLE = process.env.HIRING_COMP_PLANS_TABLE_NAME;

if (!TABLE) {
    throw new Error("HIRING_COMP_PLANS_TABLE_NAME is required");
}

const ALLOWED_FIELDS = [
    "candidateName",
    "jobTitle",
    "department",
    "startDate",
    "countryCode",
    "status",
    "baseSalary",
    "baseCurrency",
    "baseFrequency",
    "variableType",
    "variableAmount",
    "variableFrequency",
    "variableDescription",
    "mboTargetAmount",
    "mboFrequency",
    "mboDescription",
    "equityShares",
    "equityType",
    "equityVestingMonths",
    "equityCliffMonths",
    "equityStrikePrice",
    "profitsInterestPercent",
    "profitsInterestVestingMonths",
    "profitsInterestCliffMonths",
    "healthBenefits",
    "healthEmployerContribution",
    "ptoDays",
    "otherBenefits",
    "notes",
];

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const body = JSON.parse(event.body ?? "{}");

        // Find existing comp plan
        const existing = await ddbClient.send(
            new QueryCommand({
                TableName: TABLE,
                IndexName: "GSI_Candidate",
                KeyConditionExpression: "candidateId = :cid",
                ExpressionAttributeValues: { ":cid": candidateId },
                Limit: 1,
            }),
        );

        if (!existing.Items || existing.Items.length === 0) {
            return err("No comp plan found for this candidate", 404);
        }

        const current = existing.Items[0] as Record<string, unknown>;
        const now = new Date().toISOString();

        // Merge allowed fields
        for (const field of ALLOWED_FIELDS) {
            if (body[field] !== undefined) {
                current[field] = body[field];
            }
        }
        current.updatedAt = now;

        // Recalculate totals
        const baseSalary = current.baseSalary as number;
        const baseFrequency = current.baseFrequency as string;
        const variableType = current.variableType as string;
        const variableAmount = current.variableAmount as number;
        const variableFrequency = current.variableFrequency as string;
        const mboTargetAmount = current.mboTargetAmount as number;
        const mboFrequency = current.mboFrequency as string;
        const equityShares = current.equityShares as number;
        const equityStrikePrice = current.equityStrikePrice as number;

        const baseAnnual =
            baseFrequency === "annually" ? baseSalary : baseSalary * 12;

        const variableAnnual =
            variableType === "percentage"
                ? baseAnnual * (variableAmount / 100)
                : variableFrequency === "annually"
                    ? variableAmount
                    : variableFrequency === "quarterly"
                        ? variableAmount * 4
                        : variableAmount * 12;

        const mboAnnual =
            mboFrequency === "annually"
                ? mboTargetAmount
                : mboFrequency === "quarterly"
                    ? mboTargetAmount * 4
                    : mboTargetAmount * 12;

        current.totalAnnualComp = baseAnnual + variableAnnual + mboAnnual;
        current.totalMonthlyComp = (current.totalAnnualComp as number) / 12;
        current.totalPackageValue =
            (current.totalAnnualComp as number) + equityShares * equityStrikePrice;

        await ddbClient.send(
            new PutCommand({ TableName: TABLE, Item: current }),
        );

        return ok(current);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error updating comp plan:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
