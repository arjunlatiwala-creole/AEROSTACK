import { z } from "zod";
import { LoopCategoryEnum, LoopTypeEnum } from "./loop.schema";

export const BulkAssignInputSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    category: LoopCategoryEnum.default("OAL"),
    loop_type: LoopTypeEnum.default("KEY_RESULT"),
    target_completion_date: z
      .string()
      .min(1, "Target completion date is required"),
    priority: z.number().int().min(1).max(5).optional().default(3),
    tags: z.array(z.string()).optional(),
    /**
     * everyone — union of all users (person table) + deel-people, deduped.
     * specific — explicit list of recipient emails.
     * group    — one or more Google Workspace group emails; members are
     *            resolved server-side, deduped, and assigned.
     */
    assign_to: z.enum(["everyone", "specific", "group"]),
    recipient_emails: z.array(z.string().email()).optional(),
    group_emails: z.array(z.string().email()).optional(),
    assigned_by: z.string().optional(),
    /**
     * When true, the API resolves recipients and returns the count
     * without creating loops or sending emails. Used by the UI to show
     * an accurate confirmation prompt before committing the assignment.
     */
    dry_run: z.boolean().optional(),
    /** Optional Moodle course to link this bulk assignment to. */
    moodle_course_id: z.number().int().positive().optional(),
    moodle_course_name: z.string().optional(),
    moodle_course_url: z.string().url().optional(),
  })
  .refine(
    (data) => {
      if (data.assign_to === "specific") {
        return (data.recipient_emails ?? []).length > 0;
      }
      return true;
    },
    {
      message: "recipient_emails is required when assign_to is 'specific'",
      path: ["recipient_emails"],
    },
  )
  .refine(
    (data) => {
      if (data.assign_to === "group") {
        return (data.group_emails ?? []).length > 0;
      }
      return true;
    },
    {
      message: "group_emails is required when assign_to is 'group'",
      path: ["group_emails"],
    },
  );

export type BulkAssignInput = z.infer<typeof BulkAssignInputSchema>;

export const BulkAssignResponseSchema = z.object({
  created_count: z.number(),
  failed_count: z.number(),
  loop_ids: z.array(z.string()),
  failures: z
    .array(
      z.object({
        email: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
  /**
   * Emails that successfully had a learning loop created. These are the
   * recipients we attempted to email; presence here means the loop is
   * persisted regardless of email delivery outcome.
   */
  assigned_emails: z.array(z.string()).optional(),
  /**
   * Emails that we successfully handed off to SES. Empty if SES failed.
   */
  emailed_emails: z.array(z.string()).optional(),
  /** Present when SES rejected the batch send. */
  email_delivery_error: z.string().optional(),
  /** Present on dry_run responses — the resolved unique recipient count. */
  resolved_count: z.number().optional(),
  /** Per-source counts (best-effort) for "everyone" dry_run results. */
  source_counts: z
    .object({
      deel: z.number().optional(),
      person_table: z.number().optional(),
      google_workspace: z.number().optional(),
    })
    .optional(),
  /** Per-group resolution detail for "group" dry_run results. */
  group_counts: z
    .array(
      z.object({
        email: z.string(),
        member_count: z.number(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  /** Full deduped recipient list (only included on dry_run). */
  resolved_emails: z.array(z.string()).optional(),
  dry_run: z.boolean().optional(),
});

export type BulkAssignResponse = z.infer<typeof BulkAssignResponseSchema>;
