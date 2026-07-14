import { randomUUID } from "node:crypto";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { AdaptLoopInputSchema } from "src/shared/validation/loop.schema";
import { z } from "zod";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("adapt-loop", context);
	const { loopId } = event.pathParameters ?? {};

	if (!loopId) {
		logger.warn("Missing loopId");
		return err("Missing loopId", 400);
	}

	let body: any;
	try {
		body = JSON.parse(event.body || "{}");
	} catch (e) {
		logger.error("Failed to parse JSON", { error: e });
		return err("Invalid JSON", 400);
	}

	const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);

	try {
		const input = AdaptLoopInputSchema.parse({
			...body,
			loop_id: loopId,
		});

		const original = await repo.getById(loopId);
		if (!original) {
			logger.warn("Loop not found", { loopId });
			return err("Loop not found", 404);
		}

		const adaptationRecord = {
			why: input.why,
			what: input.what,
			previous_target_date: original.target_completion_date || "",
			new_target_date: input.new_target_completion_date,
			adapted_at: new Date().toISOString(),
		};

		let newLoopId: string | undefined;

		if (input.create_follow_on && input.follow_on_title) {
			const now = new Date().toISOString();
			const newLoop = {
				...original,
				loop_id: randomUUID(),
				title: input.follow_on_title,
				priority: input.follow_on_priority ?? original.priority,
				created_at: now,
				updated_at: now,
				status: "BACKLOG" as const,
				phase: "PROJECTION" as const,
				effort_score: undefined,
				outcome_score: undefined,
				loop_score: undefined,
				weighted_score: undefined,
				contributors: undefined,
				lesson: undefined,
				adaptations: undefined,
				description: input.what
					? `Follow-on from ${original.title}.\n\nReason: ${input.why}\n\nChanges: ${input.what}`
					: `Follow-on from ${original.title}.\n\nReason: ${input.why}`,
			};

			await repo.create(newLoop as any);
			newLoopId = newLoop.loop_id;
			(adaptationRecord as any).follow_on_loop_id = newLoopId;
		}

		const baseAdaptations = input.adaptations ?? original.adaptations ?? [];
		const updatedAdaptations = [...baseAdaptations, adaptationRecord];

		await repo.update({
			loop_id: loopId,
			target_completion_date: input.new_target_completion_date,
			phase: "ADAPTATION",
			adaptations: updatedAdaptations,
			updated_by: resolveActorEmail(event, body.updated_by),
		});

		logger.info("Loop adapted", { loopId, followOnId: newLoopId });
		return ok({
			success: true,
			follow_on_loop_id: newLoopId,
			adaptation_recorded: true,
		});
	} catch (e: any) {
		if (e instanceof z.ZodError) {
			logger.warn("Validation error", { errors: e.issues });
			return err("Validation Error", 400);
		}
		logger.error("Internal Server Error", { error: e.message, stack: e.stack });
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);
