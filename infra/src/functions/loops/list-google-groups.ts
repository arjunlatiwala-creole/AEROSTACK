import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { listAllGoogleGroups } from "src/shared/google-directory-client";

const _handler = async (
  _event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("list-google-groups", context);

  if (!process.env.GOOGLE_SA_SECRET_NAME) {
    logger.warn("GOOGLE_SA_SECRET_NAME not configured — returning empty list");
    return ok([]);
  }

  try {
    const groups = await listAllGoogleGroups();
    // Sort by name for stable dropdown ordering.
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return ok(groups);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to list Google groups", { error: message });
    return err(message, 502);
  }
};

export const handler = withPermissions(_handler);
