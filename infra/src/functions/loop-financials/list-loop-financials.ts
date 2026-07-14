import type {
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopFinancialRepository } from "src/repos/loop-financial.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
    event: APIGatewayProxyEvent,
    context: Context,
): Promise<APIGatewayProxyResult> => {
    const logger = createLogger("list-loop-financials", context);
    const query = event.queryStringParameters || {};
    const repo = new LoopFinancialRepository(
        ddbClient,
        process.env.LOOP_FINANCIALS_TABLE_NAME!,
    );

    try {
        const limit = query.limit ? parseInt(query.limit) : undefined;
        const lastKey = query.last_key;
        let result: { items: any[]; lastKey?: string } = { items: [] };

        if (query.loop_id) {
            // List by loop_id
            result = await repo.listByLoopId(query.loop_id, limit, lastKey);
        } else if (query.fiscal_period) {
            // List by fiscal period
            result = await repo.listByFiscalPeriod(query.fiscal_period, limit, lastKey);
        } else {
            // List all
            result = await repo.listAll(limit, lastKey);
        }

        return ok(result);
    } catch (e: any) {
        logger.error("Internal Server Error", { error: e.message, stack: e.stack });
        return err("Internal Server Error");
    }
};

export const handler = withPermissions(_handler);