import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

function calculateScores(loop: any) {
  const effort = Number(loop.effort_score) || 0;
  const outcome = Number(loop.outcome_score) || 0;
  const priority = Number(loop.priority);

  const loop_score = effort * outcome || undefined;

  const weighted_score =
    loop_score && priority ? loop_score * (6 - priority) : undefined;

  return { loop_score, weighted_score };
}

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("get-loop", context);
  const { loopId } = event.pathParameters ?? {};

  if (!loopId) {
    logger.warn("Missing loopId");
    return err("Missing loopId", 400);
  }

  try {
    const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);
    const record = await repo.getById(loopId);

    if (!record) {
      logger.info("Loop not found", { loopId });
      return err("Not found", 404);
    }

    // return ok(record);
    const { loop_score, weighted_score } = calculateScores(record);

    return ok({
      ...record,
      loop_score,
      weighted_score,
    });
  } catch (e: any) {
    logger.error("Internal Server Error", { error: e.message, stack: e.stack });
    return err("Internal Server Error");
  }
};

export const handler = withPermissions(_handler);
