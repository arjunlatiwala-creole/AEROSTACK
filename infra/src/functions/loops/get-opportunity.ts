// import type {
//   APIGatewayProxyEvent,
//   APIGatewayProxyResult,
//   Context,
// } from "aws-lambda";
// import { QueryCommand } from "@aws-sdk/lib-dynamodb";
// import { createLogger } from "src/functions/shared/logger";
// import { err, ok } from "src/functions/shared/response";
// import { LoopRepository } from "src/repos/loop.repository";
// import { ddbClient } from "src/shared/dynamodb-client";

// /* ------------------------------------------------------------------ */
// /* HELPER FUNCTIONS */
// /* ------------------------------------------------------------------ */

// async function fetchDeelPeopleByEmails(
//   deelPeopleTableName: string,
//   emails: string[],
//   logger: ReturnType<typeof createLogger>,
// ): Promise<Map<string, any>> {
//   const result = new Map<string, any>();
//   const uniqueEmails = [...new Set(emails)];

//   await Promise.all(
//     uniqueEmails.map(async (email) => {
//       try {
//         const queryResult = await ddbClient.send(
//           new QueryCommand({
//             TableName: deelPeopleTableName,
//             IndexName: "GSI_Email",
//             KeyConditionExpression: "email = :email",
//             ExpressionAttributeValues: { ":email": email },
//             Limit: 1,
//           }),
//         );

//         if (queryResult.Items?.length) {
//           result.set(email, queryResult.Items[0]);
//         }
//       } catch (error: any) {
//         logger.warn(`Error fetching Deel person for ${email}`, {
//           error: error.message,
//         });
//       }
//     }),
//   );

//   return result;
// }

// /**
//  * Total count for opportunity loops
//  */
// async function getTotalOpportunityLoopsCount(
//   loopRepo: LoopRepository,
// ): Promise<number> {
//   let totalCount = 0;
//   let lastKey: string | undefined;

//   do {
//     const result = await loopRepo.list({
//       limit: 100,
//       last_key: lastKey,
//     });

//     const filtered = result.items.filter(
//       (l: any) =>
//         ["BD", "GTM", "ADVISORY"].includes(l.category) &&
//         (l.status === "BACKLOG" || l.status === "IN_PROGRESS"),
//     );

//     totalCount += filtered.length;
//     lastKey = result.lastKey;
//   } while (lastKey);

//   return totalCount;
// }

// /* ------------------------------------------------------------------ */
// /* MAIN HANDLER */
// /* ------------------------------------------------------------------ */

// export const handler = async (
//   event: APIGatewayProxyEvent,
//   context: Context,
// ): Promise<APIGatewayProxyResult> => {
//   const logger = createLogger(
//     "get-opportunity-prioritization-with-people",
//     context,
//   );

//   const loopsTableName = process.env.LOOPS_TABLE_NAME;
//   const deelPeopleTableName = process.env.DEEL_PEOPLE_TABLE_NAME;

//   if (!loopsTableName || !deelPeopleTableName) {
//     logger.error("Missing required environment variables");
//     return err("Internal Server Error", 500);
//   }

//   try {
//     const limitParam = event.queryStringParameters?.limit;
//     const cursor = event.queryStringParameters?.nextCursor;

//     const limit = limitParam ? Number(limitParam) : 50;
//     if (limitParam && (Number.isNaN(limit) || limit <= 0)) {
//       return err("Invalid limit parameter", 400);
//     }

//     logger.info("Fetching opportunity loops", {
//       limit,
//       hasCursor: !!cursor,
//     });

//     const loopRepo = new LoopRepository(ddbClient, loopsTableName);

//     let loops: any[] = [];
//     let lastKey: string | undefined;

//     /* ---------------- MERGED PAGINATION ---------------- */
//     let timestampCursor: string | undefined;
//     let lastProcessedId: string | undefined;

//     if (cursor) {
//       try {
//         const cursorData = JSON.parse(Buffer.from(cursor, "base64").toString());
//         timestampCursor = cursorData.timestamp;
//         lastProcessedId = cursorData.lastId;
//       } catch (e) {
//         logger.warn("Invalid cursor format", { cursor });
//       }
//     }

//     const fetchLimit = limit * 4;

//     const all = await loopRepo.list({
//       limit: fetchLimit,
//     });

//     let allItems = all.items.filter(
//       (l: any) =>
//         ["BD", "GTM", "ADVISORY"].includes(l.category) &&
//         (l.status === "BACKLOG" || l.status === "IN_PROGRESS"),
//     );
//     allItems = allItems.map((l: any) => {
//       const effort = Number(l.effort_score ?? 0);
//       const outcome = Number(l.outcome_score ?? 0);
//       const priority = Number(l.priority ?? null);

//       const loop_score = effort > 0 && outcome > 0 ? effort * outcome : null;

//       const weighted_score =
//         loop_score != null && priority != null
//           ? loop_score * (6 - priority)
//           : null;

//       return {
//         ...l,
//         loop_score,
//         weighted_score,
//       };
//     });
//     allItems.sort(
//       (a, b) =>
//         (b.weighted_score ?? -Infinity) - (a.weighted_score ?? -Infinity),
//     );

//     if (timestampCursor) {
//       const cursorTime = new Date(timestampCursor).getTime();
//       allItems = allItems.filter((item) => {
//         const itemTime = new Date(item.created_at || 0).getTime();
//         return (
//           itemTime < cursorTime ||
//           (itemTime === cursorTime && item.loop_id !== lastProcessedId)
//         );
//       });
//     }

//     loops = allItems.slice(0, limit);

//     const hasMoreItems = allItems.length > limit;

//     // Take only the requested number of items
//     loops = allItems.slice(0, limit);

//     // Set cursor if there are more items available
//     if (hasMoreItems) {
//       const lastItem = loops[loops.length - 1];
//       const compositeCursor = {
//         timestamp: lastItem.created_at,
//         lastId: lastItem.loop_id,
//       };
//       lastKey = Buffer.from(JSON.stringify(compositeCursor)).toString("base64");
//     }

//     /* ---------------- DEEL JOIN ---------------- */
//     const ownerEmails = loops
//       .map((loop) => loop.owner_email)
//       .filter((email): email is string => Boolean(email));

//     const deelPeopleMap = await fetchDeelPeopleByEmails(
//       deelPeopleTableName,
//       ownerEmails,
//       logger,
//     );

//     const results = loops.map((loop) => ({
//       loop_data: loop,
//       deel_person: loop.owner_email
//         ? deelPeopleMap.get(loop.owner_email) || null
//         : null,
//       weighted_score:
//         loop.loop_score != null && loop.priority != null
//           ? loop.loop_score * (6 - loop.priority)
//           : null,
//     }));

//     /* ---------------- TOTAL COUNT ---------------- */
//     const total = await getTotalOpportunityLoopsCount(loopRepo);

//     return ok({
//       items: results,
//       pageSize: limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       hasMore: !!lastKey,
//       nextCursor: lastKey || null,
//       count: results.length,
//     });
//   } catch (e: any) {
//     logger.error("Internal Server Error", {
//       error: e.message,
//       stack: e.stack,
//     });
//     return err("Internal Server Error", 500);
//   }
// };
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";

/* ------------------------------------------------------------------ */
/* HELPER FUNCTIONS */
/* ------------------------------------------------------------------ */

async function fetchDeelPeopleByEmails(
  deelPeopleTableName: string,
  emails: string[],
  logger: ReturnType<typeof createLogger>,
): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const uniqueEmails = [...new Set(emails)];

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

/**
 * Total count for opportunity loops
 * (expensive – cache in prod)
 */
async function getTotalOpportunityLoopsCount(
  loopRepo: LoopRepository,
  categories: string[] = ["BD", "GTM", "ADVISORY"],
): Promise<number> {
  let totalCount = 0;
  let lastKey: string | undefined;

  do {
    const result = await loopRepo.list({
      limit: 100,
      last_key: lastKey,
    });

    const filtered = result.items.filter(
      (l: any) =>
        categories.includes(l.category) &&
        (l.status === "BACKLOG" || l.status === "IN_PROGRESS"),
    );

    totalCount += filtered.length;
    lastKey = result.lastKey;
  } while (lastKey);

  return totalCount;
}
/* ------------------------------------------------------------------ */
/* MAIN HANDLER */
/* ------------------------------------------------------------------ */

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger(
    "get-opportunity-prioritization-with-people",
    context,
  );

  const loopsTableName = process.env.LOOPS_TABLE_NAME;
  const deelPeopleTableName = process.env.DEEL_PEOPLE_TABLE_NAME;

  if (!loopsTableName || !deelPeopleTableName) {
    logger.error("Missing required environment variables");
    return err("Internal Server Error", 500);
  }

  try {
    const limitParam = event.queryStringParameters?.limit;
    const cursor = event.queryStringParameters?.nextCursor;
    // const categoryParam = event.queryStringParameters?.category; // ADD THIS

    const limit = limitParam ? Number(limitParam) : 50;
    if (limitParam && (Number.isNaN(limit) || limit <= 0)) {
      return err("Invalid limit parameter", 400);
    }
    const categoryParam = event.queryStringParameters?.category;

    const validCategories = ["BD", "GTM", "ADVISORY"];
    let categories = validCategories; // Default to all categories

    if (categoryParam) {
      // Support "ALL" keyword
      if (categoryParam.trim().toUpperCase() === "ALL") {
        categories = validCategories;
      } else {
        const requestedCategories = categoryParam
          .split(",")
          .map((c) => c.trim().toUpperCase());
        const invalidCategories = requestedCategories.filter(
          (c) => !validCategories.includes(c),
        );

        if (invalidCategories.length > 0) {
          return err(`Invalid category: ${invalidCategories.join(", ")}`, 400);
        }

        categories = requestedCategories;
      }
    }
    // // Validate category parameter
    // const validCategories = ["BD", "GTM", "ADVISORY"];
    // let categories = validCategories; // Default to all categories

    // if (categoryParam) {
    //   const requestedCategories = categoryParam
    //     .split(",")
    //     .map((c) => c.trim().toUpperCase());
    //   const invalidCategories = requestedCategories.filter(
    //     (c) => !validCategories.includes(c),
    //   );

    //   if (invalidCategories.length > 0) {
    //     return err(`Invalid category: ${invalidCategories.join(", ")}`, 400);
    //   }

    //   categories = requestedCategories;
    // }

    logger.info("Fetching opportunity loops", {
      limit,
      hasCursor: !!cursor,
      categories,
    });

    const loopRepo = new LoopRepository(ddbClient, loopsTableName);

    let loops: any[] = [];
    let lastKey: string | undefined;

    /* ---------------- MERGED PAGINATION ---------------- */

    let lastProcessedId: string | undefined;
    let cursorCategories: string[] | undefined;

    if (cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, "base64").toString());
        lastProcessedId = cursorData.lastId;
        cursorCategories = cursorData.categories;

        // Validate cursor matches current filter
        if (
          JSON.stringify(cursorCategories?.sort()) !==
          JSON.stringify(categories.sort())
        ) {
          logger.warn(
            "Cursor categories don't match current filter, resetting pagination",
          );
          lastProcessedId = undefined; // Reset pagination
        }
      } catch (e) {
        logger.warn("Invalid cursor format", { cursor });
      }
    }

    // Fetch ALL matching items (or enough to paginate)
    let allItems: any[] = [];
    let dbLastKey: string | undefined;
    const fetchLimit = 100; // Reasonable batch size

    // Keep fetching until we have enough items or no more items exist
    do {
      const res = await loopRepo.list({
        limit: fetchLimit,
        last_key: dbLastKey,
      });

      const filtered = res.items.filter(
        (l: any) =>
          categories.includes(l.category) && // FILTER BY SELECTED CATEGORIES
          (l.status === "BACKLOG" || l.status === "IN_PROGRESS"),
      );

      allItems = allItems.concat(filtered);
      dbLastKey = res.lastKey;

      // If we have enough items for this page + next, we can stop
      if (allItems.length >= limit * 2) {
        break;
      }
    } while (dbLastKey);

    // Compute scores
    allItems = allItems.map((l: any) => {
      const effort = Number(l.effort_score ?? 0);
      const outcome = Number(l.outcome_score ?? 0);
      const priority = Number(l.priority ?? null);

      const loop_score = effort > 0 && outcome > 0 ? effort * outcome : null;

      const weighted_score =
        loop_score != null && priority != null
          ? loop_score * (6 - priority)
          : null;

      return {
        ...l,
        loop_score,
        weighted_score,
      };
    });

    // Sort by weighted_score desc
    allItems.sort(
      (a, b) =>
        (b.weighted_score ?? -Infinity) - (a.weighted_score ?? -Infinity),
    );

    // Cursor filter - find where we left off and continue from there
    if (lastProcessedId) {
      const lastProcessedIndex = allItems.findIndex(
        (item) => item.loop_id === lastProcessedId,
      );

      if (lastProcessedIndex !== -1) {
        // Start from the next item after the last one we returned
        allItems = allItems.slice(lastProcessedIndex + 1);
      }
    }

    // Check if there are more items BEFORE slicing
    const hasMoreItems = allItems.length > limit || !!dbLastKey;

    // Slice page
    loops = allItems.slice(0, limit);

    // Build next cursor if there are more items
    if (hasMoreItems && loops.length > 0) {
      const lastItem = loops[loops.length - 1];
      const compositeCursor = {
        lastId: lastItem.loop_id,
        categories, // INCLUDE CATEGORIES IN CURSOR
      };
      lastKey = Buffer.from(JSON.stringify(compositeCursor)).toString("base64");
    }

    /* ---------------- DEEL JOIN ---------------- */

    const ownerEmails = loops
      .map((loop) => loop.owner_email)
      .filter((email): email is string => Boolean(email));

    const deelPeopleMap = await fetchDeelPeopleByEmails(
      deelPeopleTableName,
      ownerEmails,
      logger,
    );

    const results = loops.map((loop) => ({
      loop_data: loop,
      deel_person: loop.owner_email
        ? deelPeopleMap.get(loop.owner_email) || null
        : null,
      weighted_score: loop.weighted_score,
    }));
    /* ---------------- TOTAL COUNT ---------------- */

    const total = await getTotalOpportunityLoopsCount(loopRepo, categories);

    return ok({
      items: results,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: !!lastKey,
      nextCursor: lastKey || null,
      count: results.length,
      appliedFilters: { categories }, // Let frontend know what filters are active
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
