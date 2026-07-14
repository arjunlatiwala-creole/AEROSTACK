import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { LoopListParamsSchema } from "src/shared/validation/loop.schema";
import { withPermissions } from "../shared/permission-middleware";

/* ------------------------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------------------------ */

async function getTotalLoopsCount(
  loopRepo: LoopRepository,
  baseParams: any,
): Promise<number> {
  let total = 0;
  let lastKey: string | undefined;

  do {
    const res = await loopRepo.list({
      ...baseParams,
      limit: 100,
      last_key: lastKey,
    });

    total += res.count;
    lastKey = res.lastKey;
  } while (lastKey);

  return total;
}

/* ------------------------------------------------------------------ */
/* HANDLER */
/* ------------------------------------------------------------------ */

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("list-loops", context);
  const query = event.queryStringParameters || {};

  try {
    const params = LoopListParamsSchema.parse({
      ...query,
      last_key: query.nextCursor || undefined, // map nextCursor → last_key internally
    });

    const pageSize = params.limit ?? 50;

    const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);

    logger.info("Listing loops with pagination", { params });

    // Fetch page
    const result = await repo.list(params);

    // Fetch total in parallel
    const totalPromise = getTotalLoopsCount(repo, {
      ...params,
      last_key: undefined, // reset cursor for full scan
    });

    const total = await totalPromise;

    return ok({
      items: result.items,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasMore: !!result.lastKey && result.items.length === pageSize,

      nextCursor: result.lastKey || null,
      count: result.items.length,
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
