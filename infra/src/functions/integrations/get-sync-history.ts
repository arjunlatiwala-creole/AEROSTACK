import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { IntegrationSyncHistoryRepository } from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

interface QueryParams {
	limit?: string;
	nextToken?: string;
}

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("get-sync-history", context);

	const integrationId = event.pathParameters?.integrationId;

	if (!integrationId) {
		logger.warn("Missing integration_id in path parameters");
		return err("Missing required path parameter: integration_id", 400);
	}

	const queryParams = (event.queryStringParameters || {}) as QueryParams;
	const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : 50;
	const nextToken = queryParams.nextToken;

	if (limit < 1 || limit > 100) {
		logger.warn("Invalid limit", { limit });
		return err("Limit must be between 1 and 100", 400);
	}

	try {
		const repo = new IntegrationSyncHistoryRepository(
			ddbClient,
			process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME!,
		);

		const result = await repo.getSyncHistoryByIntegrationId(integrationId, {
			limit,
			nextToken,
		});

		logger.info("Sync history fetched successfully", {
			integration_id: integrationId,
			count: result.items.length,
			hasMore: result.hasMore,
		});

		return ok({
			integration_id: integrationId,
			items: result.items,
			nextToken: result.nextToken,
			hasMore: result.hasMore,
		});
	} catch (e: any) {
		logger.error("Failed to fetch sync history", {
			integration_id: integrationId,
			error: e.message,
			stack: e.stack,
		});
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
