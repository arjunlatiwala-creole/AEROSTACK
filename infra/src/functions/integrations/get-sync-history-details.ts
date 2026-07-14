import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { IntegrationSyncDetailsRepository } from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

interface QueryParams {
	entity_type?: string;
	operation?: "create" | "update" | "delete" | "skip";
	status?: "success" | "failure";
	limit?: string;
	nextToken?: string;
}

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("get-sync-details", context);

	const syncId = event.pathParameters?.syncId;

	if (!syncId) {
		logger.warn("Missing sync_id in path parameters");
		return err("Missing required path parameter: sync_id", 400);
	}

	const queryParams = (event.queryStringParameters || {}) as QueryParams;
	const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : 100;
	const nextToken = queryParams.nextToken;
	const entityType = queryParams.entity_type;
	const status = queryParams.status;

	if (limit < 1 || limit > 200) {
		logger.warn("Invalid limit", { limit });
		return err("Limit must be between 1 and 200", 400);
	}

	try {
		const repo = new IntegrationSyncDetailsRepository(
			ddbClient,
			process.env.INTEGRATION_SYNC_DETAILS_TABLE_NAME!,
		);

		let result: any;

		if (status === "failure") {
			result = await repo.getFailedSyncDetails(syncId, { limit, nextToken });
		} else if (entityType) {
			result = await repo.getSyncDetailsByEntityType(syncId, entityType, {
				limit,
				nextToken,
			});
		} else {
			result = await repo.getSyncDetailsBySyncId(syncId, { limit, nextToken });
		}

		const filteredItems = result.items;

		logger.info("Sync details fetched successfully", {
			sync_id: syncId,
			count: filteredItems.length,
			hasMore: result.hasMore,
			filters: { entity_type: entityType, status },
		});

		return ok({
			sync_id: syncId,
			items: filteredItems,
			nextToken: result.nextToken,
			hasMore: result.hasMore,
		});
	} catch (e: any) {
		logger.error("Failed to fetch sync details", {
			sync_id: syncId,
			error: e.message,
			stack: e.stack,
		});
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
