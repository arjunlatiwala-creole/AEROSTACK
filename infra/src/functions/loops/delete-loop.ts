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
  type DeleteLoopInput,
  DeleteLoopInputSchema,
} from "src/shared/validation/loop.schema";
import { withPermissions } from "../shared/permission-middleware";

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("delete-loop", context);

  try {
    const { loopId } = event.pathParameters ?? {};

    if (!loopId) {
      return err("loopId is required in path", 400);
    }

    let input: DeleteLoopInput;
    try {
      input = DeleteLoopInputSchema.parse({
        loop_id: loopId,
      });
    } catch (e: any) {
      logger.warn("Validation error", { errors: e.errors || e.message });
      return err("Validation Error", 400);
    }

    try {
      const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);

      const existing = await repo.getById(input.loop_id);
      if (!existing) {
        return err("Loop not found", 404);
      }

      await repo.delete(input.loop_id);

      logger.info("Loop deleted", { loopId: input.loop_id });
      return ok({
        message: "Loop deleted successfully",
        loopId: input.loop_id,
      });
    } catch (e: any) {
      logger.error("Internal Server Error", {
        error: e.message,
        stack: e.stack,
      });
      return err("Internal Server Error", 500);
    }
  } catch (e: any) {
    logger.error("Unexpected error in handler", {
      error: e.message,
      stack: e.stack,
    });
    return err("Internal Server Error", 500);
  }
};

export const handler = withPermissions(_handler);
