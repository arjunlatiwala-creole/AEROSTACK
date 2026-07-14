import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { ddbClient } from "src/shared/dynamodb-client";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

export interface MoodleCourse {
  id: number;
  fullname: string;
  shortname: string;
  summary: string;
  summaryformat: number;
  categoryid: number;
  categoryname?: string;
  visible: number;
  startdate: number;
  enddate: number;
  timecreated: number;
  timemodified: number;
  enrolledusercount?: number;
  completionhascriteria?: boolean;
  lang?: string;
  overviewfiles?: Array<{ filename: string; fileurl: string }>;
  /** Aerostack-side: count of loops linked to this Moodle course */
  aerostack_assigned_count?: number;
  customfields?: Array<{
    name: string;
    shortname: string;
    type: string;
    valueraw: any;
    value: string | null;
  }>;
  sections_count?: number;
  sections?: MoodleSection[];
}

export interface MoodleSection {
  id: number;
  name: string;
  summary: string;
  section: number;
  visible: number;
}

const _handler = async (
  _event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("get-moodle-courses", context);

  // MOODLE_URL falls back to the known production instance if not overridden via env
  const moodleUrl =
    process.env.MOODLE_URL?.replace(/\/$/, "") ??
    "https://enterprise.moodlecloud.com";
  const moodleToken = process.env.MOODLE_TOKEN;

  if (!moodleToken) {
    logger.error("Missing MOODLE_TOKEN environment variable");
    return err("Moodle integration is not configured — MOODLE_TOKEN missing", 503);
  }

  try {
    // ── 1. Fetch courses from Moodle ──────────────────────────────────────
    const url = new URL(`${moodleUrl}/webservice/rest/server.php`);
    url.searchParams.set("wstoken", moodleToken);
    url.searchParams.set("wsfunction", "core_course_get_courses");
    url.searchParams.set("moodlewsrestformat", "json");

    logger.info("Fetching Moodle courses", { moodleUrl });

    const response = await fetch(url.toString());
    if (!response.ok) {
      logger.error("Moodle API returned non-2xx status", {
        status: response.status,
        statusText: response.statusText,
      });
      return err(`Moodle API error: ${response.statusText}`, 502);
    }

    const data = (await response.json()) as
      | MoodleCourse[]
      | { exception?: string; message?: string };

    if (!Array.isArray(data)) {
      const errData = data as { exception?: string; message?: string };
      logger.error("Moodle returned error payload", { data: errData });
      return err(errData.message ?? "Failed to fetch courses from Moodle", 502);
    }

    // Filter out site-level "course" (id=1, shortname=site)
    const courses = (data as MoodleCourse[]).filter(
      (c) => c.id !== 1 && c.shortname !== "site",
    );

    // Fetch categories to map categoryid to categoryname
    const categoryMap = new Map<number, string>();
    try {
      const catUrl = new URL(`${moodleUrl}/webservice/rest/server.php`);
      catUrl.searchParams.set("wstoken", moodleToken);
      catUrl.searchParams.set("wsfunction", "core_course_get_categories");
      catUrl.searchParams.set("moodlewsrestformat", "json");
      const catRes = await fetch(catUrl.toString());
      if (catRes.ok) {
        const catData = await catRes.json();
        if (Array.isArray(catData)) {
          for (const cat of catData) {
            if (cat && cat.id !== undefined && cat.name !== undefined) {
              categoryMap.set(cat.id, cat.name);
            }
          }
        }
      }
    } catch (catErr) {
      logger.warn("Failed to fetch Moodle categories", {
        error: catErr instanceof Error ? catErr.message : String(catErr),
      });
    }

    // Map categoryname onto each course
    for (const course of courses) {
      if (course.categoryid !== undefined) {
        course.categoryname = categoryMap.get(course.categoryid);
      }
    }

    // ── 2. Fetch additional course details (enrollments and sections) ────
    if (courses.length > 0) {
      logger.info(`Fetching details for ${courses.length} courses`);
      const CONCURRENCY = 15;
      for (let i = 0; i < courses.length; i += CONCURRENCY) {
        const batch = courses.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (course) => {
            const promises: Promise<void>[] = [];

            // 2.1 Fetch enrollment count if missing
            if (course.enrolledusercount === undefined) {
              const fetchEnrollment = async () => {
                try {
                  const euUrl = new URL(`${moodleUrl}/webservice/rest/server.php`);
                  euUrl.searchParams.set("wstoken", moodleToken);
                  euUrl.searchParams.set("wsfunction", "core_enrol_get_enrolled_users");
                  euUrl.searchParams.set("moodlewsrestformat", "json");
                  euUrl.searchParams.set("courseid", String(course.id));
                  euUrl.searchParams.set("options[0][name]", "userfields");
                  euUrl.searchParams.set("options[0][value]", "id");

                  const r = await fetch(euUrl.toString());
                  if (!r.ok) return;
                  const users = await r.json() as unknown[] | { exception?: string };
                  if (Array.isArray(users)) {
                    course.enrolledusercount = users.length;
                  }
                } catch {
                  // Non-fatal
                }
              };
              promises.push(fetchEnrollment());
            }

            // 2.2 Fetch section details
            const fetchSections = async () => {
              try {
                const secUrl = new URL(`${moodleUrl}/webservice/rest/server.php`);
                secUrl.searchParams.set("wstoken", moodleToken);
                secUrl.searchParams.set("wsfunction", "core_course_get_contents");
                secUrl.searchParams.set("moodlewsrestformat", "json");
                secUrl.searchParams.set("courseid", String(course.id));

                const r = await fetch(secUrl.toString());
                if (!r.ok) return;
                const sections = await r.json() as any[] | { exception?: string };
                if (Array.isArray(sections)) {
                  // Filter out empty placeholder sections that have no summary, no modules, and no custom name
                  const activeSections = sections.filter((s: any) => {
                    const hasSummary = s.summary && s.summary.trim() !== "" && s.summary !== "<p><br></p>";
                    const hasModules = s.modules && s.modules.length > 0;
                    
                    const nameClean = (s.name || "").trim().toLowerCase();
                    const hasCustomName = nameClean !== "" && 
                                          nameClean !== "new section" && 
                                          nameClean !== "general" &&
                                          !nameClean.startsWith("topic ") &&
                                          !nameClean.startsWith("week ");

                    return hasSummary || hasModules || hasCustomName;
                  });

                  course.sections = activeSections.map((s: any) => ({
                    id: Number(s.id),
                    name: String(s.name || ""),
                    summary: String(s.summary || ""),
                    section: Number(s.section ?? 0),
                    visible: Number(s.visible ?? 1),
                  }));
                  course.sections_count = activeSections.length;
                }
              } catch {
                // Non-fatal
              }
            };
            promises.push(fetchSections());

            await Promise.all(promises);
          }),
        );
      }
    }

    // ── 2. Count Aerostack assignments per moodle_course_id ───────────────────
    const loopsTableName = process.env.LOOPS_TABLE_NAME;
    if (loopsTableName) {
      try {
        const ddb = ddbClient;
        const scan = await ddb.send(
          new ScanCommand({
            TableName: loopsTableName,
            FilterExpression: "attribute_exists(moodle_course_id)",
            ProjectionExpression: "moodle_course_id",
          }),
        );

        const countMap = new Map<number, number>();
        for (const raw of scan.Items ?? []) {
          const item = raw as { moodle_course_id?: number };
          if (item.moodle_course_id !== undefined) {
            countMap.set(
              item.moodle_course_id,
              (countMap.get(item.moodle_course_id) ?? 0) + 1,
            );
          }
        }

        for (const course of courses) {
          course.aerostack_assigned_count = countMap.get(course.id) ?? 0;
        }

        logger.info("Aerostack assignment counts merged", {
          courseCount: courses.length,
        });
      } catch (scanErr) {
        // Non-fatal — return courses without Aerostack counts
        logger.warn("Failed to fetch Aerostack assignment counts", {
          error:
            scanErr instanceof Error ? scanErr.message : String(scanErr),
        });
      }
    }

    logger.info(`Fetched ${courses.length} Moodle courses`);
    return ok({ courses }, 200);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to fetch Moodle courses", { error: message });
    return err("Failed to fetch courses from Moodle", 502);
  }
};

export const handler = withPermissions(_handler);
