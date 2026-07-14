import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { APIGatewayProxyHandler } from "aws-lambda";
import {
	authorizeUser,
	isAuthError,
	UserRole,
} from "src/functions/shared/auth-utils";
import { err, ok } from "src/functions/shared/response";
import { withPermissions } from "../../../shared/permission-middleware";

const eb = new EventBridgeClient({});

const _handler: APIGatewayProxyHandler = async (event) => {
	const auth = authorizeUser(event, UserRole.ENGINEER);
	if (isAuthError(auth)) return auth.error;

	const body = JSON.parse(event.body ?? "{}");
	const integration_id = body.integration_id;
	const integration_type = event.pathParameters?.integration_type;

	if (!integration_id || !integration_type) {
		return err("integration_id and integration_type required", 400);
	}

	await eb.send(
		new PutEventsCommand({
			Entries: [
				{
					Source: "manual.sync",
					DetailType: "Manual Sync Requested",
					Detail: JSON.stringify({
						integration_id,
						integration_type,
						triggered_by: auth.user.email,
						requested_at: new Date().toISOString(),
					}),
				},
			],
		}),
	);

	return ok({ success: true });
};

export const handler = withPermissions(_handler);
