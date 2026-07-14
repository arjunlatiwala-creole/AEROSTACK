import { randomUUID } from "node:crypto";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { IntegrationRepository } from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import {
	type CreateIntegrationInput,
	CreateIntegrationInputSchema,
	type Integration,
} from "src/shared/validation/integrations.schema";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("create-integration", context);

	let body: unknown;
	try {
		body = JSON.parse(event.body || "{}");
	} catch (e) {
		logger.warn("Invalid JSON body", { error: e });
		return err("Invalid JSON", 400);
	}

	let input: CreateIntegrationInput;
	try {
		// Validate everything except system-generated fields
		input = CreateIntegrationInputSchema.parse(body);
	} catch (e: any) {
		logger.warn("Validation error", { errors: e.errors || e.message });
		return err("Validation Error", 400);
	}

	const now = new Date().toISOString();

	const integration: Integration = {
		...input,
		integration_id: randomUUID(),
		status: "connected",
		auth_status: false,
		secrets_arn: "",
		auth_expires_at: "",
		last_sync_at: "",
		next_sync_at: "",
		total_syncs: 0,
		successful_syncs: 0,
		failed_syncs: 0,
		consecutive_failures: 0,
		created_at: now,
		updated_at: now,
		created_by: event.requestContext.authorizer?.claims?.sub ?? "system",
		updated_by: event.requestContext.authorizer?.claims?.sub ?? "system",
		settings: input.settings ?? {},
	};

	try {
		const repo = new IntegrationRepository(
			ddbClient,
			process.env.INTEGRATIONS_TABLE_NAME!,
		);

		const created = await repo.createIntegration(integration);

		logger.info("Integration created", {
			integration_id: created.integration_id,
		});

		return ok(created, 201);
	} catch (e: any) {
		logger.error("Failed to create integration", {
			error: e.message,
			stack: e.stack,
		});

		if (e.message?.includes("already exists")) {
			return err(e.message, 409);
		}

		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
