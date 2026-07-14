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

interface CompletionRecord {
  loop_id: string;
  title: string;
  owner_email: string;
  owner_name?: string;
  status: string;
  target_completion_date?: string;
  actual_completion_date?: string;
  outcome_score?: number;
  created_at: string;
  last_reminder_sent?: string;
}

interface GroupedRequirement {
  title: string;
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  overdue: number;
  records: CompletionRecord[];
}

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("get-learning-completion", context);

  const loopsTableName = process.env.LOOPS_TABLE_NAME;
  const deelPeopleTableName = process.env.DEEL_PEOPLE_TABLE_NAME;

  if (!loopsTableName || !deelPeopleTableName) {
    logger.error("Missing required environment variables");
    return err("Internal Server Error", 500);
  }

  try {
    const loopRepo = new LoopRepository(ddbClient, loopsTableName);
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Fetch all OAL and PRO-DEV loops
    const allLoops: any[] = [];
    let lastKey: string | undefined;

    // Fetch OAL loops
    do {
      const res = await loopRepo.list({
        category: "OAL",
        limit: 100,
        last_key: lastKey,
      });
      allLoops.push(...res.items);
      lastKey = res.lastKey;
    } while (lastKey);

    // Fetch PRO-DEV loops
    lastKey = undefined;
    do {
      const res = await loopRepo.list({
        category: "PRO-DEV",
        limit: 100,
        last_key: lastKey,
      });
      allLoops.push(...res.items);
      lastKey = res.lastKey;
    } while (lastKey);

    // Fetch ONBOARDING loops
    lastKey = undefined;
    do {
      const res = await loopRepo.list({
        category: "ONBOARDING",
        limit: 100,
        last_key: lastKey,
      });
      allLoops.push(...res.items);
      lastKey = res.lastKey;
    } while (lastKey);

    // Fetch COMMS_FLUENCY loops
    lastKey = undefined;
    do {
      const res = await loopRepo.list({
        category: "COMMS_FLUENCY",
        limit: 100,
        last_key: lastKey,
      });
      allLoops.push(...res.items);
      lastKey = res.lastKey;
    } while (lastKey);

    // Fetch Deel person names for all owner emails
    const ownerEmails = [...new Set(allLoops.map((l) => l.owner_email).filter(Boolean))];
    const nameMap = await fetchPersonNames(deelPeopleTableName, ownerEmails);

    // Group loops by title (bulk-assigned loops share the same title)
    const grouped = new Map<string, CompletionRecord[]>();

    for (const loop of allLoops) {
      const title = loop.title;
      if (!grouped.has(title)) {
        grouped.set(title, []);
      }

      // Get completed date from progress_history where status is COMPLETED
      // Only show if current status IS completed (loop can go backwards)
      let completedDate: string | undefined;
      if (loop.status === "COMPLETED") {
        completedDate = loop.actual_completion_date;
        if (!completedDate && loop.progress_history && Array.isArray(loop.progress_history)) {
          const completedEntry = [...loop.progress_history]
            .reverse()
            .find((entry: any) => entry.status === "COMPLETED");
          if (completedEntry) {
            completedDate = completedEntry.changed_at;
          }
        }
      }

      grouped.get(title)!.push({
        loop_id: loop.loop_id,
        title: loop.title,
        owner_email: loop.owner_email,
        owner_name: nameMap.get(loop.owner_email),
        status: loop.status,
        target_completion_date: loop.target_completion_date,
        actual_completion_date: completedDate,
        outcome_score: loop.outcome_score,
        created_at: loop.created_at,
        last_reminder_sent: loop.last_reminder_sent,
      });
    }

    // Build grouped requirements (only include titles with 2+ people — bulk assignments)
    const requirements: GroupedRequirement[] = [];

    for (const [title, records] of grouped.entries()) {
      // Include all titles (even single assignments) for full visibility
      const completed = records.filter((r) => r.status === "COMPLETED").length;
      const inProgress = records.filter(
        (r) => r.status === "IN_PROGRESS" || r.status === "IN_QA_REVIEW",
      ).length;
      const overdue = records.filter(
        (r) =>
          r.status !== "COMPLETED" &&
          r.target_completion_date &&
          r.target_completion_date !== "9999-12-31" &&
          new Date(r.target_completion_date) < startOfToday,
      ).length;
      const notStarted = records.filter(
        (r) => r.status === "BACKLOG" || r.status === "DELAY_INCOMPLETED",
      ).length;

      requirements.push({
        title,
        total: records.length,
        completed,
        in_progress: inProgress,
        not_started: notStarted,
        overdue,
        records,
      });
    }

    // Sort: most people first, then by overdue count
    requirements.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.overdue - a.overdue;
    });

    return ok({ requirements });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Internal Server Error", { error: message });
    return err("Internal Server Error", 500);
  }
};

async function fetchPersonNames(
  tableName: string,
  emails: string[],
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  const uniqueEmails = [...new Set(emails)];

  await Promise.all(
    uniqueEmails.map(async (email) => {
      try {
        const result = await ddbClient.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "GSI_Email",
            KeyConditionExpression: "email = :email",
            ExpressionAttributeValues: { ":email": email },
            ProjectionExpression: "email, given_name, family_name",
            Limit: 1,
          }),
        );
        const person = result.Items?.[0];
        if (person) {
          const name = [person.given_name, person.family_name]
            .filter(Boolean)
            .join(" ");
          if (name) nameMap.set(email, name);
        }
      } catch {
        // Skip failures silently
      }
    }),
  );

  return nameMap;
}

export const handler = withPermissions(_handler);
