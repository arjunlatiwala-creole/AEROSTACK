import { randomUUID } from "node:crypto";
import type {
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopFinancialRepository } from "src/repos/loop-financial.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import {
    type CreateLoopFinancialInput,
    CreateLoopFinancialInputSchema,
} from "src/shared/validation/loop-financial.schema";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
    event: APIGatewayProxyEvent,
    context: Context,
): Promise<APIGatewayProxyResult> => {
    const logger = createLogger("create-loop-financial", context);

    let body: any;

    try {
        body = JSON.parse(event.body || "{}");
    } catch (e) {
        logger.error("Failed to parse JSON", { error: e });
        return err("Invalid JSON", 400);
    }

    let input: CreateLoopFinancialInput;
    try {
        input = CreateLoopFinancialInputSchema.parse(body);
    } catch (e) {
        logger.warn("Validation error", { error: e });
        return err("Validation Error", 400);
    }

    const now = new Date().toISOString();

    try {
        const financial = {
            financial_id: randomUUID(),
            loop_id: input.loop_id,
            budget_usd: input.budget_usd,
            actual_spend_usd: input.actual_spend_usd,
            revenue_generated_usd: input.revenue_generated_usd,
            cost_center: input.cost_center,
            fiscal_period: input.fiscal_period,
            notes: input.notes,
            created_at: now,
            updated_at: now,
        };

        const repo = new LoopFinancialRepository(
            ddbClient,
            process.env.LOOP_FINANCIALS_TABLE_NAME!,
        );

        await repo.create(financial);
        logger.info("Loop financial created", { financial_id: financial.financial_id });

        return ok(financial, 201);
    } catch (e: any) {
        logger.error("Internal Server Error", { error: e.message, stack: e.stack });
        return err("Internal Server Error");
    }
};

export const handler = withPermissions(_handler);