import { z } from "zod";

export const LoopCategoryEnum = z.enum([
  "ENG",
  "MSP",
  "GTM",
  "BD",
  "OPS:Finance",
  "OPS:HR",
  "OPS:SalesOps",
  "PRO-DEV",
  "ADVISORY",
  "OAL",
  "ONBOARDING",
  "COMMS_FLUENCY",
  "INT:PRODUCT",
  "INT:AUTO",
  "INT:INFRA",
  "INT:DOCS",
]);

export const LoopTypeEnum = z.enum(["OBJECTIVE", "KEY_RESULT"]);

export const LoopStatusEnum = z.enum([
  "BACKLOG",
  "IN_PROGRESS",
  "IN_QA_REVIEW",
  "COMPLETED",
  "DELAY_INCOMPLETED",
]);

export const LoopPhaseEnum = z.enum([
  "PROJECTION",
  "ASSERTION",
  "FOCUS",
  "FEEDBACK",
  "ADAPTATION",
]);

export const LoopPillarEnum = z.enum([
  "REVOPS",
  "TECHOPS",
  "ADMINOPS",
  "CROSS",
  "SKILLS",
  "INTERNAL",
]);

export const ContributorSchema = z.object({
  email: z.email(),
  share: z.number().min(0).max(1),
});

export const LessonSchema = z.object({
  abstract: z.string().max(280),
  tags: z.array(z.string()).optional(),
  reuse_notes: z.string().optional(),
});

export const AdaptationRecordSchema = z.object({
  why: z.string(),
  what: z.string().optional(),
  previous_target_date: z.string(),
  new_target_date: z.string(),
  adapted_at: z.string(),
  follow_on_loop_id: z.string().optional(),
});

export type AdaptationRecord = z.infer<typeof AdaptationRecordSchema>;

export const StatusHistoryRecordSchema = z.object({
  status: LoopStatusEnum,
  changed_at: z.string(),
  comment: z.string().optional(),
});

export type StatusHistoryRecord = z.infer<typeof StatusHistoryRecordSchema>;

export const TaskCommentAttachmentSchema = z.object({
  file_name: z.string(),
  file_url: z.string().url(),
  file_type: z.string(),
  file_size: z.number().positive(),
});

export const TaskCommentSchema = z.object({
  comment_id: z.string(),
  author_email: z.string().email(),
  author_name: z.string().optional(),
  content: z.string().min(1).max(5000),
  mentions: z.array(z.string().email()).optional(),
  attachments: z.array(TaskCommentAttachmentSchema).optional(),
  created_at: z.string(),
});

export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const LoopSchema = z.object({
  loop_id: z.string(),

  title: z.string().min(1),
  description: z.string().optional(),

  category: LoopCategoryEnum,
  pillar: LoopPillarEnum,
  loop_type: LoopTypeEnum,

  status: LoopStatusEnum,
  phase: LoopPhaseEnum,
  priority: z.number().int().min(1).max(5),

  start_date: z.string().optional(),
  target_completion_date: z.string().optional(),
  actual_completion_date: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  updated_by: z.string().optional(),
  last_reminder_sent: z.string().optional(),

  effort_score: z.number().int().min(1).max(5).optional(),
  outcome_score: z.number().int().min(1).max(5).optional(),
  loop_score: z.number().optional(),
  weighted_score: z.number().optional(),

  owner_email: z.email(),
  owner_name: z.string().optional(),
  contributors: z.array(ContributorSchema).optional(),

  lesson: LessonSchema.optional(),

  adaptations: z.array(AdaptationRecordSchema).optional(),
  progress_history: z.array(StatusHistoryRecordSchema).optional(),
  comments: z.array(TaskCommentSchema).optional(),

  tags: z.array(z.string()).default([]),
  // jira_key: z.string().optional(),
});

export type Loop = z.infer<typeof LoopSchema>;
export type Contributor = z.infer<typeof ContributorSchema>;
export type Lesson = z.infer<typeof LessonSchema>;

export const CreateLoopInputSchema = z.object({
  loop_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  loop_type: LoopTypeEnum,
  category: LoopCategoryEnum,
  owner_email: z.email(),
  target_completion_date: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  status: LoopStatusEnum.optional(),
  contributors: z.array(ContributorSchema).optional(),
  tags: z.array(z.string()).optional(),
  status_comment: z.string().optional(), // Optional - required only on create (frontend enforces)
  // jira_key: z.string().optional(),
  adaptations: z.array(AdaptationRecordSchema).optional(),
  updated_by: z.string().optional(),
});

export type CreateLoopInput = z.infer<typeof CreateLoopInputSchema>;

export const UpdateLoopInputSchema = z
  .object({
    loop_id: z.string().optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    phase: LoopPhaseEnum.optional(),
    status: LoopStatusEnum.optional(),
    status_comment: z.string().optional(), // Will be validated as required if status is present
    priority: z.number().int().min(1).max(5).optional(),
    owner_email: z.email().optional(),
    tags: z.array(z.string()).optional(),
    // Category and type
    loop_type: LoopTypeEnum.optional(),
    category: LoopCategoryEnum.optional(),
    pillar: LoopPillarEnum.optional(),
    // Dates
    start_date: z.string().optional(),
    target_completion_date: z.string().optional(),
    actual_completion_date: z.string().optional(),
    // Scores
    effort_score: z.number().int().min(1).max(5).optional(),
    outcome_score: z.number().int().min(1).max(5).optional(),
    updated_by: z.string().optional(),
    // Contributors and lesson
    contributors: z.array(ContributorSchema).optional(),
    lesson: LessonSchema.optional(),
    // Jira integration
    // jira_key: z.string().optional(),
  })
  .refine(
    (data) => {
      // If status is provided, status_comment must also be provided
      if (
        data.status &&
        (!data.status_comment || data.status_comment.trim().length === 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message: "status_comment is required when updating status",
      path: ["status_comment"],
    },
  );

export type UpdateLoopInput = z.infer<typeof UpdateLoopInputSchema>;

export const ScoreEffortBodySchema = z.object({
  effort_score: z.number().int().min(1).max(5),
  updated_by: z.string().optional(),
});

export const ScoreEffortInputSchema = ScoreEffortBodySchema.extend({
  loop_id: z.string(),
});

export type ScoreEffortInput = z.infer<typeof ScoreEffortInputSchema>;

export const ScoreOutcomeBodySchema = z.object({
  outcome_score: z.number().int().min(1).max(5),
  contributors: z.array(ContributorSchema).optional(),
  lesson: LessonSchema.optional(),
  updated_by: z.string().optional(),
});

export const ScoreOutcomeInputSchema = ScoreOutcomeBodySchema.extend({
  loop_id: z.string(),
});

export type ScoreOutcomeInput = z.infer<typeof ScoreOutcomeInputSchema>;

export const ScoreBodySchema = z.union([
  ScoreEffortBodySchema,
  ScoreOutcomeBodySchema,
]);

export const AdaptLoopBodySchema = z.object({
  why: z.string(),
  what: z.string().optional(),
  new_target_completion_date: z.string(),
  create_follow_on: z.boolean().optional(),
  follow_on_title: z.string().optional(),
  follow_on_priority: z.number().int().min(1).max(5).optional(),
  adaptations: z.array(AdaptationRecordSchema).optional(),
  updated_by: z.string().optional(),
});

export const AdaptLoopInputSchema = AdaptLoopBodySchema.extend({
  loop_id: z.string(),
});

export type AdaptLoopInput = z.infer<typeof AdaptLoopInputSchema>;

export const DeliveryStatusSchema = LoopSchema.pick({
  loop_id: true,
  title: true,
  category: true,
  status: true,
  phase: true,
  target_completion_date: true,
  tags: true,
  owner_name: true,
});

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const OpportunityPrioritizationSchema = LoopSchema.pick({
  loop_id: true,
  title: true,
  category: true,
  priority: true,
  target_completion_date: true,
  loop_score: true,
  weighted_score: true,
  owner_name: true,
});

export type OpportunityPrioritization = z.infer<
  typeof OpportunityPrioritizationSchema
>;

export const LearningLoopSchema = LoopSchema.pick({
  loop_id: true,
  title: true,
  category: true,
  status: true,
  outcome_score: true,
  owner_name: true,
}).extend({
  abstract: z.string().optional(),
  lesson_tags: z.array(z.string()).optional(),
});

export type LearningLoop = z.infer<typeof LearningLoopSchema>;

export const LoopListParamsSchema = z
  .object({
    category: LoopCategoryEnum.optional(),
    status: LoopStatusEnum.optional(),
    phase: LoopPhaseEnum.optional(),
    loop_type: LoopTypeEnum.optional(),
    owner_email: z.email().optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    target_before: z.string().optional(),

    sort_by: z
      .enum(["priority", "target_date", "created_at", "updated_at"])
      .optional()
      .default("updated_at"),
    sort_order: z.enum(["asc", "desc"]).optional().default("desc"),

    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    last_key: z.string().optional(),
  })
  .transform((data) => {
    const cleaned: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned as LoopListParams;
  });

export type LoopCategory = z.infer<typeof LoopCategoryEnum>;
export type LoopPhase = z.infer<typeof LoopPhaseEnum>;
export type LoopStatus = z.infer<typeof LoopStatusEnum>;
export type LoopType = z.infer<typeof LoopTypeEnum>;

export type LoopListParams = {
  category?: LoopCategory;
  status?: LoopStatus;
  phase?: LoopPhase;
  loop_type?: LoopType;
  owner_email?: string;
  priority?: number;
  target_before?: string;
  sort_by?: "priority" | "target_date" | "created_at" | "updated_at";
  sort_order?: "asc" | "desc";
  limit?: number;
  last_key?: string;
};

export const DeleteLoopInputSchema = z.object({
  loop_id: z.string(),
});

export type DeleteLoopInput = z.infer<typeof DeleteLoopInputSchema>;
