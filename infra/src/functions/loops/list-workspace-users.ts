import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { listAllGoogleGroups, listGroupMemberEmails } from "src/shared/google-directory-client";

/** Cached across warm invocations — 10 min TTL. */
let cachedEmails: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const _handler = async (
  _event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("list-workspace-users", context);

  if (!process.env.GOOGLE_SA_SECRET_NAME) {
    return ok([]);
  }

  // Return cache if fresh
  if (cachedEmails && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return ok(cachedEmails);
  }

  try {
    const groups = await listAllGoogleGroups();
    const merged = new Set<string>();
    for (const group of groups) {
      try {
        const members = await listGroupMemberEmails(group.email);
        for (const m of members) merged.add(m.toLowerCase());
      } catch {
        // skip failed groups
      }
    }
    cachedEmails = Array.from(merged).sort();
    cacheTimestamp = Date.now();

    logger.info(`Resolved ${cachedEmails.length} workspace user emails`);
    return ok(cachedEmails);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to list workspace users", { error: message });
    return err(message, 502);
  }
};

export const handler = withPermissions(_handler);
