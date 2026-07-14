import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import {
	ScoreEffortInputSchema,
	ScoreOutcomeInputSchema,
} from "src/shared/validation/loop.schema";
import { z } from "zod";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("score-loop", context);
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
	const updatedBy = resolveActorEmail(event, body.updated_by);

	const isEffort = body.effort_score !== undefined;
	const isOutcome = body.outcome_score !== undefined;

	try {
		if (isEffort) {
			const input = ScoreEffortInputSchema.parse({ ...body, loop_id: loopId });
			await repo.scoreEffort(loopId, input.effort_score, updatedBy);
		} else if (isOutcome) {
			const input = ScoreOutcomeInputSchema.parse({ ...body, loop_id: loopId });
			await repo.scoreOutcome({
				loop_id: loopId,
				outcome_score: input.outcome_score,
				contributors: input.contributors,
				lesson: input.lesson,
				updated_by: updatedBy,
			});
		} else {
			logger.warn("Missing score parameters", { body });
			return err("Must provide effort_score or outcome_score", 400);
		}

		return ok({ success: true });
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
