import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

/* ------------------------------------------------------------------ */
/* HELPER FUNCTIONS */
/* ------------------------------------------------------------------ */

/**
 * Get total count of learning loops
 */
// async function getTotalLearningLoopsCount(
//     loopRepo: LoopRepository,
// ): Promise<number> {
//     let totalCount = 0;
//     let lastKey: string | undefined;

//     do {
//         const result = await loopRepo.list({
//             category: "LEARNING",
//             limit: 100,
//             last_key: lastKey,
//         });

//         totalCount += result.count;
//         lastKey = result.lastKey;
//     } while (lastKey);

//     return totalCount;
// }

async function getTotalLearningLoopsCount(
  loopRepo: LoopRepository,
  category: "OAL" | "PRO-DEV" | "ONBOARDING" | "COMMS_FLUENCY",
): Promise<number> {
  let totalCount = 0;
  let lastKey: string | undefined;

  do {
    const result = await loopRepo.list({
      category,
      limit: 100,
      last_key: lastKey,
    });

    totalCount += result.count;
    lastKey = result.lastKey;
  } while (lastKey);

  return totalCount;
}
/**
 * Fetch Deel person by email (checks both email and alternate_email)
 */
async function fetchDeelPersonByEmail(
  deelPeopleTableName: string,
  emails: string[],
  logger: ReturnType<typeof createLogger>,
): Promise<Map<string, any>> {
  const result = new Map<string, any>();

  // Remove duplicates
  const uniqueEmails = [...new Set(emails)];

  // Query all emails in parallel
  await Promise.all(
    uniqueEmails.map(async (email) => {
      try {
        const queryResult = await ddbClient.send(
          new QueryCommand({
            TableName: deelPeopleTableName,
            IndexName: "GSI_Email",
            KeyConditionExpression: "email = :email",
            ExpressionAttributeValues: { ":email": email },
            Limit: 1,
          }),
        );

        if (queryResult.Items?.length) {
          result.set(email, queryResult.Items[0]);
        }
      } catch (error: any) {
        logger.warn(`Error fetching Deel person for ${email}`, {
          error: error.message,
        });
      }
    }),
  );

  return result;
}
/* ------------------------------------------------------------------ */
/* MAIN HANDLER */
/* ------------------------------------------------------------------ */

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("get-learning-loops-with-people", context);

  const loopsTableName = process.env.LOOPS_TABLE_NAME;
  const deelPeopleTableName = process.env.DEEL_PEOPLE_TABLE_NAME;

  if (!loopsTableName || !deelPeopleTableName) {
    logger.error("Missing required environment variables");
    return err("Internal Server Error", 500);
  }

  try {
    const limitParam = event.queryStringParameters?.limit;
    const cursor = event.queryStringParameters?.nextCursor;

    const rawCategory = event.queryStringParameters?.category?.toUpperCase();
    let categoryFilter: "OAL" | "PRO-DEV" | "ONBOARDING" | "COMMS_FLUENCY" | null = null;
    if (rawCategory) {
      if (rawCategory === "OAL" || rawCategory === "LEARNING") {
        categoryFilter = "OAL";
      } else if (rawCategory === "PRO-DEV" || rawCategory === "LND") {
        categoryFilter = "PRO-DEV";
      } else if (rawCategory === "ONBOARDING" || rawCategory === "SKILLS_CERT") {
        categoryFilter = "ONBOARDING";
      } else if (rawCategory === "COMMS_FLUENCY") {
        categoryFilter = "COMMS_FLUENCY";
      }
    }

    const limit = limitParam ? Number(limitParam) : 50;
    if (limitParam && (Number.isNaN(limit) || limit <= 0)) {
      return err("Invalid limit parameter", 400);
    }

    logger.info("Fetching learning loops", {
      limit,
      hasCursor: !!cursor,
      category: categoryFilter || "ALL",
    });

    const loopRepo = new LoopRepository(ddbClient, loopsTableName);

    let loops: any[] = [];
    let lastKey: string | undefined;

    // Fetch loops based on category filter
    if (categoryFilter) {
      const res = await loopRepo.list({
        category: categoryFilter,
        limit,
        last_key: cursor,
      });
      loops = res.items;
      lastKey = res.lastKey;
    } else {
      // For merged categories, use timestamp-based pagination
      let timestampCursor: string | undefined;
      let lastProcessedId: string | undefined;

      if (cursor) {
        try {
          const cursorData = JSON.parse(
            Buffer.from(cursor, "base64").toString(),
          );
          timestampCursor = cursorData.timestamp;
          lastProcessedId = cursorData.lastId; // Track last ID to handle duplicate timestamps
        } catch (e) {
          logger.warn("Invalid cursor format", { cursor });
        }
      }

      // Fetch more items than needed to account for filtering
      const fetchLimit = limit * 3;

      const [learning, lnd, skills, fluency] = await Promise.all([
        loopRepo.list({
          category: "OAL",
          limit: fetchLimit,
        }),
        loopRepo.list({
          category: "PRO-DEV",
          limit: fetchLimit,
        }),
        loopRepo.list({
          category: "ONBOARDING",
          limit: fetchLimit,
        }),
        loopRepo.list({
          category: "COMMS_FLUENCY",
          limit: fetchLimit,
        }),
      ]);

      // Merge and sort
      let allItems = [
        ...learning.items,
        ...lnd.items,
        ...skills.items,
        ...fluency.items,
      ].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime(),
      );

      // Filter by timestamp cursor if it exists
      if (timestampCursor) {
        const cursorTime = new Date(timestampCursor).getTime();
        allItems = allItems.filter((item) => {
          const itemTime = new Date(item.created_at || 0).getTime();
          // Include items older than cursor timestamp
          // OR items with same timestamp but different ID (not yet processed)
          return (
            itemTime < cursorTime ||
            (itemTime === cursorTime && item.loop_id !== lastProcessedId)
          );
        });
      }

      // Take only the requested limit
      loops = allItems.slice(0, limit);

      // Set next cursor to the created_at and ID of the last item
      if (loops.length === limit && allItems.length > limit) {
        const lastItem = loops[loops.length - 1];
        const compositeCursor = {
          timestamp: lastItem.created_at,
          lastId: lastItem.loop_id,
        };
        lastKey = Buffer.from(JSON.stringify(compositeCursor)).toString(
          "base64",
        );
      }
    }
    // Extract all owner emails
    const ownerEmails = loops
      .map((loop) => loop.owner_email)
      .filter((email): email is string => Boolean(email));

    // Batch fetch all Deel people in parallel
    const deelPeopleMap = await fetchDeelPersonByEmail(
      deelPeopleTableName,
      ownerEmails,
      logger,
    );

    // Map loops with their corresponding Deel person data
    const results = loops.map((loop) => ({
      loop_data: loop,
      deel_person: loop.owner_email
        ? deelPeopleMap.get(loop.owner_email) || null
        : null,
    }));

    // Calculate total count based on category filter
    // Note: This is still expensive. Consider caching this value.
    const total = categoryFilter
      ? await getTotalLearningLoopsCount(loopRepo, categoryFilter as any)
      : (
          await Promise.all([
            getTotalLearningLoopsCount(loopRepo, "OAL"),
            getTotalLearningLoopsCount(loopRepo, "PRO-DEV"),
            getTotalLearningLoopsCount(loopRepo, "ONBOARDING"),
            getTotalLearningLoopsCount(loopRepo, "COMMS_FLUENCY"),
          ])
        ).reduce((a, b) => a + b, 0);

    return ok({
      items: results,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: !!lastKey,
      nextCursor: lastKey || null,
      count: results.length,
    });
  } catch (e: any) {
    logger.error("Internal Server Error", {
      error: e.message,
      stack: e.stack,
    });
    return err("Internal Server Error", 500);
  }
};

export const handler = withPermissions(_handler);
