import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { IntegrationRepository } from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("get-integration", context);

	const integrationId = event.pathParameters?.integrationId;

	if (!integrationId) {
		return err("integration_id is required", 400);
	}

	try {
		const repo = new IntegrationRepository(
			ddbClient,
			process.env.INTEGRATIONS_TABLE_NAME!,
		);

		const integration = await repo.getIntegrationById(integrationId);

		if (!integration) {
			return err("Integration not found", 404);
		}

		return ok(integration);
	} catch (e: any) {
		logger.error("Failed to get integration", {
			error: e.message,
			stack: e.stack,
		});
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
