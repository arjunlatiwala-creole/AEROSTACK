import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const secretsClient = new SecretsManagerClient({});

const CANDIDATES_TABLE = process.env.HIRING_CANDIDATES_TABLE_NAME;
const COMP_PLANS_TABLE = process.env.HIRING_COMP_PLANS_TABLE_NAME;
const DEEL_SECRET_NAME = process.env.DEEL_SECRET_NAME;
const DEEL_API_BASE = "https://api.letsdeel.com/rest/v2";

/** enterprise Deel org constants */
const Enterprise_LEGAL_ENTITY_ID = "242b1336-ff58-49a7-b232-022981bea8f7";
const Enterprise_TEAM_ID = "e0201faf-8ead-4340-ba33-dca67a3affb9"; // Will Group

if (!CANDIDATES_TABLE || !COMP_PLANS_TABLE || !DEEL_SECRET_NAME) {
    throw new Error(
        "HIRING_CANDIDATES_TABLE_NAME, HIRING_COMP_PLANS_TABLE_NAME, and DEEL_SECRET_NAME are required",
    );
}

async function getDeelToken(): Promise<string> {
    const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: DEEL_SECRET_NAME }),
    );
    if (!response.SecretString) {
        throw new Error("Deel secret not found");
    }
    const secret = JSON.parse(response.SecretString);
    return secret.DEEL_API_TOKEN || secret.token;
}

/**
 * Determine pay scale from frequency.
 * Deel expects: weekly, biweekly, semimonthly, monthly
 */
function toDeelScale(frequency: string): string {
    switch (frequency) {
        case "monthly":
            return "monthly";
        case "semimonthly":
            return "semimonthly";
        case "biweekly":
            return "biweekly";
        default:
            return "semimonthly";
    }
}

/**
 * Create a contractor (pay-as-you-go time-based) contract in Deel.
 * Matches the Deel POST /rest/v2/contracts schema exactly.
 */
async function createContractorContract(
    token: string,
    candidate: Record<string, unknown>,
    compPlan: Record<string, unknown>,
    payScale: string,
): Promise<Record<string, unknown>> {
    const nameParts = (candidate.name as string).split(" ");
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || firstName;
    const jobTitle = (compPlan.jobTitle as string) || "Contractor";

    const monthlyAmount =
        (compPlan.baseFrequency as string) === "annually"
            ? (compPlan.baseSalary as number) / 12
            : (compPlan.baseSalary as number);

    const amount = Math.round(monthlyAmount * 100) / 100;
    const currencyCode = (compPlan.baseCurrency as string) ?? "USD";
    const startDate =
        (compPlan.startDate as string) ?? new Date().toISOString().split("T")[0];

    // Payload matches Deel POST /rest/v2/contracts schema exactly
    const payload = {
        data: {
            meta: {
                documents_required: true,
            },
            title: `${firstName} ${lastName} - ${jobTitle}`,
            job_title: { name: jobTitle },
            client: {
                team: { id: Enterprise_TEAM_ID },
                legal_entity: { id: Enterprise_LEGAL_ENTITY_ID },
            },
            worker: {
                first_name: firstName,
                last_name: lastName,
                expected_email: candidate.email as string,
            },
            type: "pay_as_you_go_time_based",
            start_date: startDate,
            scope_of_work:
                (compPlan.notes as string) || `${jobTitle} at enterprise`,
            compensation_details: {
                amount,
                currency_code: currencyCode,
                scale: "monthly",
                frequency: "monthly",
                cycle_end: 15,
                cycle_end_type: "DAY_OF_MONTH",
                payment_due_days: 7,
                payment_due_type: "REGULAR",
            },
            notice_period: 10,
            country_code: (compPlan.countryCode as string) || "US",
        },
    };

    const response = await fetch(`${DEEL_API_BASE}/contracts`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
        console.error("Deel API error:", JSON.stringify(data));
        const errors = data.errors ?? data.message ?? data;
        throw new Error(
            `Deel API error (${response.status}): ${JSON.stringify(errors)}`,
        );
    }

    return data as Record<string, unknown>;
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const candidateId = event.pathParameters?.candidateId;
        if (!candidateId) {
            return err("candidateId path parameter is required", 400);
        }

        const body = JSON.parse(event.body ?? "{}");
        const contractType: string = body.contractType ?? "contractor";
        const payScale: string = body.payScale ?? "semimonthly";

        // Fetch candidate
        const candidateResult = await ddbClient.send(
            new GetCommand({
                TableName: CANDIDATES_TABLE,
                Key: { candidateId },
            }),
        );

        if (!candidateResult.Item) {
            return err("Candidate not found", 404);
        }

        const candidate = candidateResult.Item;

        // Check candidate is at DEEL_SETUP stage
        if (candidate.stage !== "DEEL_SETUP") {
            return err(
                `Candidate must be at DEEL_SETUP stage. Current: ${candidate.stage}`,
                400,
            );
        }

        // Check if already pushed to Deel
        if (candidate.deelEmployeeId) {
            return err(
                `Candidate already has a Deel contract: ${candidate.deelEmployeeId}`,
                409,
            );
        }

        // Fetch comp plan
        const compPlanResult = await ddbClient.send(
            new QueryCommand({
                TableName: COMP_PLANS_TABLE,
                IndexName: "GSI_Candidate",
                KeyConditionExpression: "candidateId = :cid",
                ExpressionAttributeValues: { ":cid": candidateId },
                Limit: 1,
            }),
        );

        if (!compPlanResult.Items || compPlanResult.Items.length === 0) {
            return err("No comp plan found. Create a comp plan before pushing to Deel.", 400);
        }

        const compPlan = compPlanResult.Items[0];

        // Get Deel token
        const token = await getDeelToken();

        let deelResponse: Record<string, unknown>;

        if (contractType === "contractor") {
            deelResponse = await createContractorContract(
                token,
                candidate,
                compPlan,
                payScale,
            );
        } else {
            // For global_payroll / direct employee — use the same contractor
            // endpoint for now. Full GP integration requires additional Deel
            // setup (payroll entity, tax forms, etc.) that varies by country.
            // Will can switch to GP flow once the base integration is proven.
            deelResponse = await createContractorContract(
                token,
                candidate,
                compPlan,
                payScale,
            );
        }

        // Extract Deel contract ID
        const deelData = deelResponse.data as Record<string, unknown> | undefined;
        const deelContractId = (deelData?.id as string) ?? "unknown";

        // Update candidate with Deel contract ID
        const now = new Date().toISOString();
        await ddbClient.send(
            new UpdateCommand({
                TableName: CANDIDATES_TABLE,
                Key: { candidateId },
                UpdateExpression:
                    "SET deelEmployeeId = :did, updatedAt = :now",
                ExpressionAttributeValues: {
                    ":did": deelContractId,
                    ":now": now,
                },
            }),
        );

        return ok({
            deelContractId,
            deelResponse: deelData,
            message: "Contract created in Deel successfully",
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error creating Deel contract:", error);
        return err(message, 500);
    }
};

export const handler = withPermissions(_handler);
