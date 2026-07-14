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

const parseBoolean = (value?: string): boolean | undefined => {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
};

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("list-integrations", context);

	const query = event.queryStringParameters || {};

	const limit = query.limit ? Number(query.limit) : 50;
	const nextToken = query.nextToken;
	const integration_type = query.integration_type;
	const status = query.status;
	const enabled = parseBoolean(query.enabled);

	try {
		const repo = new IntegrationRepository(
			ddbClient,
			process.env.INTEGRATIONS_TABLE_NAME!,
		);

		const result = await repo.listIntegrations({
			limit,
			nextToken,
			integration_type,
			status,
			enabled,
		});

		return ok(result);
	} catch (e: any) {
		logger.error("Failed to list integrations", {
			error: e.message,
			stack: e.stack,
		});
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
