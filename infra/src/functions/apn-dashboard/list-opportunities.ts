import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { APNRepository } from "src/repos/apn.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { z } from "zod";
import { withPermissions } from "../shared/permission-middleware";

const ListParamsSchema = z.object({
	limit: z.coerce.number().min(1).max(100).optional().default(20),
	last_key: z.string().optional().nullable(),
	stage: z.string().optional(),
	status: z.string().optional(),
});

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("list-opportunities", context);
	const query = event.queryStringParameters || {};

	try {
		const params = ListParamsSchema.parse(query);

		const repo = new APNRepository(
			ddbClient,
			process.env.PARTNER_OPPORTUNITIES_TABLE_NAME!,
			process.env.PARTNER_ENGAGEMENTS_TABLE_NAME!,
			process.env.PARTNER_ENGAGEMENT_INVITATIONS_TABLE_NAME!,
		);

		logger.info("Listing APN opportunities", { params });

		const result = await repo.listOpportunities({
			limit: params.limit,
			last_key: params.last_key,
			stage: params.stage,
			status: params.status,
		});

		return ok({
			items: result.items,
			pageSize: result.pageSize,
			total: result.total,
			totalPages: result.totalPages,
			hasMore: result.hasMore,
			nextCursor: result.nextCursor,
			count: result.count,
		});
	} catch (e: any) {
		if (e.name === "ZodError") {
			logger.warn("Invalid query parameters", {
				errors: e.errors,
				query,
			});
			return err("Invalid query parameters", 400);
		}

		logger.error("Internal Server Error", {
			error: e.message,
			stack: e.stack,
		});
		return err("Internal Server Error", 500);
	}
};

export const handler = withPermissions(_handler);
