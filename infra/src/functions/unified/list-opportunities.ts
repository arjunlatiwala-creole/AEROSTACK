import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { z } from "zod";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import {
	buildPipelineFromDeals,
	deriveHealth,
	getPhaseLabel,
	mapStageToPhase,
} from "../shared/deal-phases";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const logger = createLogger("list-unified-opportunities");

const UNIFIED_TABLE = process.env.UNIFIED_OPPORTUNITIES_TABLE_NAME!;

const ListParamsSchema = z.object({
	limit: z.coerce.number().min(1).max(100).optional().default(20),
	cursor: z.string().optional().nullable(),
	source: z.enum(["hubspot", "apn-ace"]).optional(),
});

function decodeCursor(cursor?: string | null): Record<string, any> | undefined {
	if (!cursor) return undefined;
	try {
		return JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
	} catch {
		return undefined;
	}
}

function encodeCursor(lastKey?: Record<string, any>): string | null {
	if (!lastKey) return null;
	return Buffer.from(JSON.stringify(lastKey), "utf-8").toString("base64");
}

/** Format a unified table item to match the deals-list deal shape */
function formatUnifiedDeal(item: any) {
	const firstContact = item.contacts?.[0];

	return {
		id: item.opportunityId ?? null,
		source: item.source ?? null,
		name: item.title ?? null,
		amount: item.amount ?? null,
		pipeline: item.pipeline ?? null,
		pipeline_name: item.pipeline ?? null,
		stage: item.stage ?? null,
		stage_name: item.stage ?? null,
		createdate: item.createdAt ?? null,
		lastmodifieddate: item.updatedAt ?? null,
		companyName: item.companyName ?? null,
		contactName: firstContact
			? [firstContact.firstName, firstContact.lastName]
					.filter(Boolean)
					.join(" ") || null
			: null,
		contactEmail: firstContact?.email ?? null,
	};
}

async function getGlobalSummary(source?: string) {
	let lastKey: any;

	let total_deals = 0;
	let total_pipeline_value = 0;
	let active_deals = 0;

	const deals_by_phase: Record<string, number> = {};
	const health_distribution: Record<string, number> = {};

	do {
		let result;

		if (source) {
			result = await ddbClient.send(
				new QueryCommand({
					TableName: UNIFIED_TABLE,
					IndexName: "GSI_Source",
					KeyConditionExpression: "#src = :src",
					ExpressionAttributeNames: { "#src": "source" },
					ExpressionAttributeValues: { ":src": source },
					ProjectionExpression: "stage, amount",
					ExclusiveStartKey: lastKey,
				}),
			);
		} else {
			result = await ddbClient.send(
				new ScanCommand({
					TableName: UNIFIED_TABLE,
					ProjectionExpression: "stage, amount",
					ExclusiveStartKey: lastKey,
				}),
			);
		}

		for (const item of result.Items ?? []) {
			total_deals++;

			const amount = Number(item.amount ?? 0);
			total_pipeline_value += amount;

			const phase = mapStageToPhase(item.stage);
			const health = deriveHealth(item.stage, amount);

			deals_by_phase[phase] = (deals_by_phase[phase] || 0) + 1;
			health_distribution[health] = (health_distribution[health] || 0) + 1;

			if (phase === "ACTIVELY_FUNDING" || phase === "DEVELOPING") {
				active_deals++;
			}
		}

		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	logger.info(`Completed global summary scan. Total: ${total_deals}`);
	return {
		total_deals,
		total_pipeline_value,
		active_deals,
		deals_by_phase,
		health_distribution,
	};
}

const _handler = async (
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
	try {
		const auth = authorizeUser(event, UserRole.ENGINEER);
		if (isAuthError(auth)) return auth.error;

		const query = event.queryStringParameters || {};
		const params = ListParamsSchema.parse(query);

		let items: any[];
		let lastEvaluatedKey: Record<string, any> | undefined;

		if (params.source) {
			const result = await ddbClient.send(
				new QueryCommand({
					TableName: UNIFIED_TABLE,
					IndexName: "GSI_Source",
					KeyConditionExpression: "#src = :src",
					ExpressionAttributeNames: { "#src": "source" },
					ExpressionAttributeValues: { ":src": params.source },
					Limit: params.limit,
					ExclusiveStartKey: decodeCursor(params.cursor),
					ScanIndexForward: false,
				}),
			);
			items = result.Items ?? [];
			lastEvaluatedKey = result.LastEvaluatedKey;
		} else {
			const result = await ddbClient.send(
				new ScanCommand({
					TableName: UNIFIED_TABLE,
					Limit: params.limit,
					ExclusiveStartKey: decodeCursor(params.cursor),
				}),
			);
			items = result.Items ?? [];
			lastEvaluatedKey = result.LastEvaluatedKey;
		}

		const nextCursor = encodeCursor(lastEvaluatedKey);

		/* -------- format + enrich with phase + health -------- */
		const enrichedDeals = items.map((item) => {
			const formatted = formatUnifiedDeal(item);
			const amount = Number(formatted.amount || 0);
			const phase = mapStageToPhase(formatted.stage_name);
			const health_status = deriveHealth(formatted.stage_name, amount);

			return {
				...formatted,
				phase,
				phase_label: getPhaseLabel(phase),
				health_status,
			};
		});

		const { pipeline } = buildPipelineFromDeals(enrichedDeals);

		/* -------- global summary -------- */
		const summary = await getGlobalSummary(params.source);

		return ok({
			deals: enrichedDeals,
			pipeline,
			total_deals: summary.total_deals,
			total_pipeline_value: summary.total_pipeline_value,
			total_active_deals:
				(summary.deals_by_phase.ACTIVELY_FUNDING || 0) +
				(summary.deals_by_phase.DEVELOPING || 0),
			health_distribution: summary.health_distribution,
			pageSize: params.limit,
			totalPages: Math.ceil(summary.total_deals / params.limit),
			hasMore: !!lastEvaluatedKey,
			nextCursor,
		});
	} catch (e: any) {
		if (e.name === "ZodError") {
			return err("Invalid query parameters", 400);
		}
		logger.error("Failed to list unified opportunities", { error: e });
		return err("Internal Server Error", 500);
	}
};
export const handler = withPermissions(_handler);
