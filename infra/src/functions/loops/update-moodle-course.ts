import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { withPermissions } from "../shared/permission-middleware";

interface UpdateMoodleCourseInput {
  courseId: number;
  fullname?: string;
  summary?: string;
  hours?: string | number;
  categoryid?: number;
  startdate?: number;
  enddate?: number;
}

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("update-moodle-course", context);

  const moodleUrl =
    process.env.MOODLE_URL?.replace(/\/$/, "") ??
    "https://enterprise.moodlecloud.com";
  const moodleToken = process.env.MOODLE_TOKEN;

  if (!moodleToken) {
    logger.error("Missing MOODLE_TOKEN environment variable");
    return err("Moodle integration is not configured — MOODLE_TOKEN missing", 503);
  }

  try {
    if (!event.body) {
      return err("Missing request body", 400);
    }

    const body = JSON.parse(event.body) as UpdateMoodleCourseInput;
    const { courseId, fullname, summary, hours, categoryid, startdate, enddate } = body;

    if (!courseId) {
      return err("Missing courseId", 400);
    }

    logger.info("Updating Moodle course", { courseId, fullname, summary, hours, categoryid, startdate, enddate });

    // Construct Moodle REST API URLSearchParams
    const updateParams = new URLSearchParams({
      wstoken: moodleToken,
      wsfunction: "core_course_update_courses",
      moodlewsrestformat: "json",
      "courses[0][id]": String(courseId),
    });

    if (fullname !== undefined) {
      updateParams.set("courses[0][fullname]", fullname);
    }
    if (summary !== undefined) {
      updateParams.set("courses[0][summary]", summary);
    }
    if (hours !== undefined) {
      updateParams.set("courses[0][customfields][0][shortname]", "hours");
      updateParams.set("courses[0][customfields][0][value]", hours === null ? "" : String(hours));
    }
    if (categoryid !== undefined) {
      updateParams.set("courses[0][categoryid]", String(categoryid));
    }
    if (startdate !== undefined) {
      updateParams.set("courses[0][startdate]", String(startdate));
    }
    if (enddate !== undefined) {
      updateParams.set("courses[0][enddate]", String(enddate));
    }

    const res = await fetch(`${moodleUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: updateParams.toString(),
    });

    if (!res.ok) {
      logger.error("Moodle API returned non-2xx status", {
        status: res.status,
        statusText: res.statusText,
      });
      return err(`Moodle API error: ${res.statusText}`, 502);
    }

    const rawBody = await res.text();
    logger.info("Moodle update course response", { body: rawBody });

    // Moodle returns empty or Warnings array, or Exception if error.
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === "object" && parsed.exception) {
          logger.error("Moodle returned error exception", { parsed });
          return err(parsed.message || "Moodle exception occurred", 500);
        }
      } catch {
        // Non-JSON response, ignore
      }
    }

    logger.info("Moodle course updated successfully", { courseId });
    return ok({ success: true }, 200);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to update Moodle course", { error: message });
    return err("Failed to update course in Moodle", 500);
  }
};

export const handler = withPermissions(_handler);
