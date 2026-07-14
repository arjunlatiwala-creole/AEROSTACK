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
	const logger = createLogger("update-integration", context);

	const integrationId = event.pathParameters?.integrationId;

	if (!integrationId) {
		return err("integrationId is required", 400);
	}

	if (!event.body) {
		return err("Request body is required", 400);
	}

	let payload: Record<string, any>;
	try {
		payload = JSON.parse(event.body);
	} catch {
		return err("Invalid JSON body", 400);
	}

	const IMMUTABLE_FIELDS = ["integration_id", "created_at", "type"];

	for (const field of IMMUTABLE_FIELDS) {
		if (field in payload) {
			return err(`Field '${field}' cannot be updated`, 400);
		}
	}

	try {
		const repo = new IntegrationRepository(
			ddbClient,
			process.env.INTEGRATIONS_TABLE_NAME!,
		);

		const updated = await repo.updateIntegration(integrationId, {
			...payload,
		});

		if (!updated) {
			return err("Integration not found", 404);
		}

		return ok(updated);
	} catch (e: any) {
		logger.error("Failed to update integration", {
			error: e.message,
			stack: e.stack,
			integrationId,
		});
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
