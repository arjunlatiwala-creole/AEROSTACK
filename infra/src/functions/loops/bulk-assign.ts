import { randomUUID } from "node:crypto";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { BulkAssignInputSchema } from "src/shared/validation/bulk-assign.schema";
import { sendEmail } from "src/functions/shared/email";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";
import {
  listAllGoogleGroups,
  listGroupMemberEmails,
} from "src/shared/google-directory-client";

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("bulk-assign-loops", context);

  const loopsTableName = process.env.LOOPS_TABLE_NAME;
  const deelPeopleTableName = process.env.DEEL_PEOPLE_TABLE_NAME;
  const personTableName = process.env.PERSON_TABLE_NAME;
  if (!loopsTableName || !deelPeopleTableName) {
    logger.error("Missing required environment variables");
    return err("Internal Server Error", 500);
  }

  try {
    let body: unknown;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return err("Invalid JSON", 400);
    }

    logger.info("Received bulk-assign request", { body });

    const parsed = BulkAssignInputSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("Validation error", { errors: parsed.error.issues });
      return err(
        `Validation Error: ${parsed.error.issues.map((e) => e.message).join(", ")}`,
        400,
      );
    }

    const input = parsed.data;
    const assignedBy = resolveActorEmail(event, input.assigned_by);
    const now = new Date().toISOString();

    // Resolve recipient emails based on assign_to mode.
    let recipientEmails: string[] = [];
    let sourceCounts:
      | {
          deel?: number;
          person_table?: number;
          google_workspace?: number;
        }
      | undefined;
    let groupCounts:
      | Array<{ email: string; member_count: number; error?: string }>
      | undefined;

    if (input.assign_to === "everyone") {
      // Union of:
      //   - deel-people emails
      //   - person-table emails (platform users)
      //   - all Google Workspace group members (when Directory is configured)
      // Dedupe case-insensitive.
      const [deelEmails, personEmails, googleEmails] = await Promise.all([
        fetchAllPeopleEmails(deelPeopleTableName, logger),
        personTableName
          ? fetchAllPersonTableEmails(personTableName, logger)
          : Promise.resolve<string[]>([]),
        process.env.GOOGLE_SA_SECRET_NAME
          ? fetchAllGoogleWorkspaceEmails(logger)
          : Promise.resolve<string[]>([]),
      ]);

      const merged = new Set<string>();
      for (const e of [...deelEmails, ...personEmails, ...googleEmails]) {
        if (e) merged.add(e.toLowerCase());
      }
      recipientEmails = Array.from(merged);
      sourceCounts = {
        deel: deelEmails.length,
        person_table: personEmails.length,
        google_workspace: googleEmails.length,
      };

      logger.info("Resolved 'everyone' recipients", {
        ...sourceCounts,
        unique: recipientEmails.length,
      });
    } else if (input.assign_to === "group") {
      const groupEmails = input.group_emails ?? [];
      const merged = new Set<string>();
      const groupFailures: { email: string; reason: string }[] = [];
      groupCounts = [];

      for (const groupEmail of groupEmails) {
        try {
          const members = await listGroupMemberEmails(groupEmail);
          for (const m of members) merged.add(m.toLowerCase());
          groupCounts.push({
            email: groupEmail,
            member_count: members.length,
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Unknown error";
          logger.warn(`Failed to resolve group ${groupEmail}`, {
            error: message,
          });
          groupFailures.push({ email: groupEmail, reason: message });
          groupCounts.push({
            email: groupEmail,
            member_count: 0,
            error: message,
          });
        }
      }
      recipientEmails = Array.from(merged);

      logger.info("Resolved 'group' recipients", {
        groups: groupEmails.length,
        unique: recipientEmails.length,
        groupFailures: groupFailures.length,
      });

      if (recipientEmails.length === 0 && groupFailures.length > 0) {
        return err(
          `Failed to resolve group members: ${groupFailures
            .map((f) => `${f.email} (${f.reason})`)
            .join("; ")}`,
          502,
        );
      }
    } else {
      // specific
      const merged = new Set<string>();
      for (const e of input.recipient_emails ?? []) {
        merged.add(e.toLowerCase());
      }
      recipientEmails = Array.from(merged);
    }

    if (recipientEmails.length === 0) {
      return err("No recipients found to assign", 400);
    }

    if (input.dry_run) {
      logger.info("Dry-run bulk assign — returning resolved count only", {
        assignTo: input.assign_to,
        recipientCount: recipientEmails.length,
      });
      return ok(
        {
          created_count: 0,
          failed_count: 0,
          loop_ids: [],
          resolved_count: recipientEmails.length,
          source_counts: sourceCounts,
          group_counts: groupCounts,
          resolved_emails: recipientEmails,
          dry_run: true,
        },
        200,
      );
    }

    logger.info("Bulk assigning learning loops", {
      assignTo: input.assign_to,
      recipientCount: recipientEmails.length,
      title: input.title,
      assignedBy,
    });

    const repo = new LoopRepository(ddbClient, loopsTableName);
    const loopIds: string[] = [];
    const failures: { email: string; reason: string }[] = [];

    // Create a loop for each recipient
    for (const email of recipientEmails) {
      try {
        const loopId = randomUUID();
        const targetDate = input.target_completion_date;

        await repo.create({
          loop_id: loopId,
          title: input.title,
          description: input.description,
          category: input.category,
          pillar: "SKILLS",
          loop_type: input.loop_type,
          status: "BACKLOG",
          phase: "PROJECTION",
          priority: input.priority,
          target_completion_date: targetDate,
          owner_email: email,
          tags: input.tags ?? [],
          created_at: now,
          updated_at: now,
          updated_by: assignedBy,
          // Moodle integration fields (stored as metadata when provided)
          ...(input.moodle_course_id !== undefined && {
            moodle_course_id: input.moodle_course_id,
          }),
          ...(input.moodle_course_name && {
            moodle_course_name: input.moodle_course_name,
          }),
          ...(input.moodle_course_url && {
            moodle_course_url: input.moodle_course_url,
          }),
          progress_history: [
            {
              status: "BACKLOG",
              changed_at: now,
              comment: `Bulk assigned by ${assignedBy}${input.moodle_course_name ? ` (Moodle: ${input.moodle_course_name})` : ""}`,
            },
          ],
        });
        loopIds.push(loopId);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unknown error";
        logger.warn(`Failed to create loop for ${email}`, { error: message });
        failures.push({ email, reason: message });
      }
    }

    // Send notification emails (batch, non-blocking)
    const successEmails = recipientEmails.filter(
      (email) => !failures.some((f) => f.email === email),
    );

    let emailedEmails: string[] = [];
    let emailDeliveryError: string | undefined;

    if (successEmails.length > 0) {
      // Send one individual email per recipient — no Cc/Bcc, each person
      // gets their own private notification.
      const failedSends: string[] = [];

      for (const email of successEmails) {
        try {
          await sendEmail({
            to: [email],
            subject: `New Learning Assignment: ${input.title}`,
            html: buildAssignmentEmailHtml(
              input.title,
              input.description,
              assignedBy,
              input.target_completion_date,
              input.moodle_course_name,
              input.moodle_course_url,
            ),
            text: `You have been assigned a new learning requirement: "${input.title}". Assigned by: ${assignedBy}${
              input.moodle_course_url ? ` — Course link: ${input.moodle_course_url}` : ""
            }`,
          });
          emailedEmails.push(email);
        } catch (emailErr) {
          const message =
            emailErr instanceof Error ? emailErr.message : "Unknown";
          logger.warn(`Failed to send email to ${email}`, { error: message });
          failedSends.push(email);
        }
      }

      if (failedSends.length > 0) {
        emailDeliveryError = `Failed to deliver to ${failedSends.length} recipient(s)`;
      }

      logger.info("Bulk-assign email delivery complete", {
        attempted: successEmails.length,
        delivered: emailedEmails.length,
        failed: failedSends.length,
      });
    }

    logger.info("Bulk assignment complete", {
      created: loopIds.length,
      failed: failures.length,
      emailed: emailedEmails.length,
    });

    // ── Moodle enrollment (best-effort, non-blocking) ──────────────────────
    let moodleEnrolledCount = 0;
    let moodleNotFoundEmails: string[] = [];
    let moodleCreatedEmails: string[] = [];
    if (input.moodle_course_id !== undefined && successEmails.length > 0) {
      try {
        const result = await enrollUsersInMoodle(
          input.moodle_course_id,
          successEmails,
          logger,
        );
        moodleEnrolledCount = result.enrolled;
        moodleNotFoundEmails = result.notFound;
        moodleCreatedEmails = result.created;
        logger.info(`Moodle enrollment complete`, {
          courseId: input.moodle_course_id,
          enrolled: moodleEnrolledCount,
          created: moodleCreatedEmails,
          notFound: moodleNotFoundEmails,
        });
      } catch (moodleErr) {
        logger.warn("Moodle enrollment failed (non-fatal)", {
          error: moodleErr instanceof Error ? moodleErr.message : String(moodleErr),
        });
      }
    }

    return ok(
      {
        created_count: loopIds.length,
        failed_count: failures.length,
        loop_ids: loopIds,
        failures: failures.length > 0 ? failures : undefined,
        assigned_emails: successEmails,
        emailed_emails: emailedEmails,
        email_delivery_error: emailDeliveryError,
        ...(input.moodle_course_id !== undefined && {
          moodle_enrolled_count: moodleEnrolledCount,
          moodle_not_found_emails: moodleNotFoundEmails.length > 0 ? moodleNotFoundEmails : undefined,
          moodle_created_emails: moodleCreatedEmails.length > 0 ? moodleCreatedEmails : undefined,
        }),
      },
      201,
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Internal Server Error", { error: message });
    return err("Internal Server Error", 500);
  }
};

/**
 * Derives a username from an email address.
 * e.g. "john.doe@company.com" → "john.doe"
 */
function emailToUsername(email: string): string {
  return email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ".")
    .slice(0, 100);
}

/**
 * Splits an email prefix into firstname + lastname best-effort.
 * "john.doe" → { firstname: "John", lastname: "Doe" }
 * "johndoe"  → { firstname: "Johndoe", lastname: "User" }
 */
function emailToName(email: string): { firstname: string; lastname: string } {
  const prefix = email.split("@")[0];
  const parts = prefix.split(/[._-]/);
  if (parts.length >= 2) {
    return {
      firstname: parts[0].charAt(0).toUpperCase() + parts[0].slice(1),
      lastname:  parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" "),
    };
  }
  return {
    firstname: prefix.charAt(0).toUpperCase() + prefix.slice(1),
    lastname: "User",
  };
}

/**
 * Looks up Moodle user IDs by email (core_user_get_users_by_field).
 * For any emails NOT found in Moodle, auto-provisions accounts via
 * core_user_create_users (Moodle sends a welcome email to the new user).
 * Then enrolls everyone into the course (enrol_manual_enrol_users, role 5 = Student).
 */
async function enrollUsersInMoodle(
  courseId: number,
  emails: string[],
  logger: ReturnType<typeof createLogger>,
): Promise<{ enrolled: number; notFound: string[]; created: string[] }> {
  const moodleUrl =
    process.env.MOODLE_URL?.replace(/\/$/, "") ?? "https://enterprise.moodlecloud.com";
  const moodleToken = process.env.MOODLE_TOKEN;

  logger.info("Moodle enrollment start", {
    courseId,
    emailCount: emails.length,
    hasToken: !!moodleToken,
    moodleUrl,
  });

  if (!moodleToken) {
    logger.warn("MOODLE_TOKEN not set — skipping enrollment");
    return { enrolled: 0, notFound: emails, created: [] };
  }
  if (emails.length === 0) return { enrolled: 0, notFound: [], created: [] };

  // ── Step 1: email → Moodle userId ──────────────────────────────────────
  const foundEmailSet = new Set<string>();
  const moodleUserIds: number[] = [];
  const BATCH = 50;

  const lookupByEmail = async (batch: string[]) => {
    const params = new URLSearchParams({
      wstoken: moodleToken,
      wsfunction: "core_user_get_users_by_field",
      moodlewsrestformat: "json",
      field: "email",
    });
    batch.forEach((email, idx) => params.set(`values[${idx}]`, email));

    const res = await fetch(`${moodleUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const rawBody = await res.text();
    logger.info("Moodle user lookup raw response", { status: res.status, body: rawBody.slice(0, 300) });
    if (!res.ok) return;
    const users = JSON.parse(rawBody) as Array<{ id: number; email: string }> | { exception?: string };
    if (Array.isArray(users)) {
      for (const u of users) {
        moodleUserIds.push(u.id);
        if (u.email) foundEmailSet.add(u.email.toLowerCase());
      }
    } else {
      logger.warn("Moodle user lookup returned error object", { data: users });
    }
  };

  for (let i = 0; i < emails.length; i += BATCH) {
    try { await lookupByEmail(emails.slice(i, i + BATCH)); }
    catch (e) { logger.warn("Moodle user lookup threw", { error: e instanceof Error ? e.message : String(e) }); }
  }

  let notFound = emails.filter((e) => !foundEmailSet.has(e.toLowerCase()));
  logger.info("Moodle user ID resolution complete", { found: moodleUserIds.length, notFound, of: emails.length });

  // ── Step 1b: auto-create accounts for emails not in Moodle ─────────────
  const created: string[] = [];
  if (notFound.length > 0) {
    logger.info("Auto-provisioning Moodle accounts for missing users", { notFound });

    const createParams = new URLSearchParams({
      wstoken: moodleToken,
      wsfunction: "core_user_create_users",
      moodlewsrestformat: "json",
    });

    notFound.forEach((email, idx) => {
      const { firstname, lastname } = emailToName(email);
      const username = emailToUsername(email);
      createParams.set(`users[${idx}][username]`, username);
      createParams.set(`users[${idx}][email]`, email);
      createParams.set(`users[${idx}][firstname]`, firstname);
      createParams.set(`users[${idx}][lastname]`, lastname);
      createParams.set(`users[${idx}][auth]`, "manual");
      // createpassword=1 → Moodle auto-generates a password and emails it to the user
      createParams.set(`users[${idx}][createpassword]`, "1");
    });

    try {
      const res = await fetch(`${moodleUrl}/webservice/rest/server.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: createParams.toString(),
      });
      const rawBody = await res.text();
      logger.info("Moodle create users raw response", { status: res.status, body: rawBody.slice(0, 500) });

      const result = JSON.parse(rawBody) as
        | Array<{ id: number; username: string }>
        | { exception?: string; message?: string; errorcode?: string };

      if (Array.isArray(result) && result.length > 0) {
        logger.info(`Moodle: created ${result.length} new accounts`, { result });

        // Re-lookup by email to get their IDs (create only returns username)
        const newlyCreated: string[] = [];
        try { await lookupByEmail(notFound); } catch { /* non-fatal */ }

        for (const email of notFound) {
          if (foundEmailSet.has(email.toLowerCase())) {
            created.push(email);
            newlyCreated.push(email);
          }
        }
        logger.info("Re-lookup after creation", { newlyCreated });
      } else if (!Array.isArray(result)) {
        logger.warn("Moodle create users returned error", { data: result });
      }
    } catch (e) {
      logger.warn("Moodle create users threw exception", { error: e instanceof Error ? e.message : String(e) });
    }

    // Update notFound — remove any that got created
    notFound = emails.filter((e) => !foundEmailSet.has(e.toLowerCase()));
  }

  if (moodleUserIds.length === 0) {
    logger.warn("No Moodle user IDs to enroll after lookup + creation", { notFound });
    return { enrolled: 0, notFound, created };
  }

  // ── Step 2: enrol in course ─────────────────────────────────────────────
  const enrollParams = new URLSearchParams({
    wstoken: moodleToken,
    wsfunction: "enrol_manual_enrol_users",
    moodlewsrestformat: "json",
  });
  moodleUserIds.forEach((userId, idx) => {
    enrollParams.set(`enrolments[${idx}][roleid]`, "5"); // 5 = Student
    enrollParams.set(`enrolments[${idx}][userid]`, String(userId));
    enrollParams.set(`enrolments[${idx}][courseid]`, String(courseId));
  });

  logger.info("Moodle: calling enrol_manual_enrol_users", { userIds: moodleUserIds, courseId });

  try {
    const res = await fetch(`${moodleUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: enrollParams.toString(),
    });
    const body = await res.text();
    logger.info("Moodle enrollment raw response", { status: res.status, body: body.slice(0, 500) });

    if (!res.ok) {
      logger.warn("Moodle enrol call HTTP error", { status: res.status });
      return { enrolled: 0, notFound, created };
    }

    if (body && body !== "null") {
      const parsed = JSON.parse(body) as { exception?: string; message?: string; errorcode?: string };
      if (parsed?.exception) {
        logger.warn("Moodle enrollment API exception", { exception: parsed.exception, message: parsed.message, errorcode: parsed.errorcode });
        return { enrolled: 0, notFound, created };
      }
    }
  } catch (e) {
    logger.warn("Moodle enrollment threw exception", { error: e instanceof Error ? e.message : String(e) });
    return { enrolled: 0, notFound, created };
  }

  logger.info(`Moodle: successfully enrolled ${moodleUserIds.length} users in course ${courseId}`, { notFound, created });
  return { enrolled: moodleUserIds.length, notFound, created };
}

async function fetchAllPeopleEmails(
  tableName: string,
  logger: ReturnType<typeof createLogger>,
): Promise<string[]> {
  const emails: string[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "email",
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      if (item.email && typeof item.email === "string") {
        emails.push(item.email);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  logger.info(`Fetched ${emails.length} deel-people emails`);
  return emails;
}

/**
 * Scans the platform `person` table and returns every email address found.
 * The `person` table is keyed by personId and stores Cognito-linked records
 * (some of which include an `email` attribute, others don't). We project only
 * the `email` attribute and skip anything that isn't a string.
 */
async function fetchAllPersonTableEmails(
  tableName: string,
  logger: ReturnType<typeof createLogger>,
): Promise<string[]> {
  const emails: string[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddbClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "email",
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      if (item.email && typeof item.email === "string") {
        emails.push(item.email);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  logger.info(`Fetched ${emails.length} person-table emails`);
  return emails;
}

/**
 * Lists every group in the Workspace domain and unions all member emails.
 * Uses includeDerivedMembership via listGroupMemberEmails so nested groups
 * resolve to user emails. On failure, returns an empty list and logs —
 * "everyone" must not break if Google Directory is misconfigured or
 * temporarily unreachable.
 */
async function fetchAllGoogleWorkspaceEmails(
  logger: ReturnType<typeof createLogger>,
): Promise<string[]> {
  try {
    const groups = await listAllGoogleGroups();
    const merged = new Set<string>();
    let groupFailures = 0;

    for (const group of groups) {
      try {
        const members = await listGroupMemberEmails(group.email);
        for (const m of members) merged.add(m.toLowerCase());
      } catch (e: unknown) {
        groupFailures += 1;
        const message = e instanceof Error ? e.message : "Unknown error";
        logger.warn(`Failed to resolve Workspace group ${group.email}`, {
          error: message,
        });
      }
    }

    logger.info(
      `Fetched ${merged.size} Google Workspace member emails from ${groups.length} groups`,
      { groupFailures },
    );
    return Array.from(merged);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.warn(
      "Skipping Google Workspace expansion for 'everyone' — listAllGoogleGroups failed",
      { error: message },
    );
    return [];
  }
}

function buildAssignmentEmailHtml(
  title: string,
  description: string | undefined,
  assignedBy: string,
  targetDate: string | undefined,
  moodleCourseName?: string,
  moodleCourseUrl?: string,
): string {
  return `
    <div style="background:#f3f4f6;padding:32px 16px;font-family:sans-serif;">
      <div style="background:#ffffff;border-radius:12px;max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #e5e7eb;">

        <!-- Header -->
        <div style="background:#185FA5;padding:28px 32px 24px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.08em;color:#B5D4F4;text-transform:uppercase;">Aerostack Learning</p>
          <h1 style="margin:0;font-size:22px;font-weight:600;color:#E6F1FB;line-height:1.3;">New learning assignment</h1>
        </div>

        <!-- Body -->
        <div style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
            You've been assigned a new learning requirement. Please review the details below.
          </p>

          <!-- Assignment card -->
          <div style="border:1px solid #e5e7eb;border-left:3px solid #185FA5;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;background:#f9fafb;">
            <p style="margin:0 0 6px;font-size:17px;font-weight:600;color:#111827;">${title}</p>
            ${description ? `<p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">${description}</p>` : ""}
          </div>

          <!-- Meta grid -->
          <div style="display:grid;grid-template-columns:1fr${targetDate ? " 1fr" : ""};gap:12px;margin-bottom:28px;">
            <div style="background:#f3f4f6;border-radius:8px;padding:14px 16px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Assigned by</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${assignedBy}</p>
            </div>
            ${
              targetDate
                ? `
            <div style="background:#f3f4f6;border-radius:8px;padding:14px 16px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">Target completion</p>
              <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${targetDate}</p>
            </div>`
                : ""
            }
          </div>

          ${moodleCourseUrl ? `
          <!-- Moodle CTA -->
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${moodleCourseUrl}" target="_blank" style="display:inline-block;background:#185FA5;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">Open Moodle Course${moodleCourseName ? ` — ${moodleCourseName}` : ""}</a>
          </div>` : ""}

          <!-- CTA -->
        </div>

        <!-- Footer -->
        <div style="border-top:1px solid #e5e7eb;padding:16px 32px;background:#f9fafb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
            Log in to Aerostack to view and track your learning progress.
          </p>
        </div>

      </div>
    </div>
  `;
}

export const handler = withPermissions(_handler);
