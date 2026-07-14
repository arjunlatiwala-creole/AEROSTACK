export type LoopCategory =
  | "ENG"
  | "MSP"
  | "GTM"
  | "BD"
  | "OPS:Finance"
  | "OPS:HR"
  | "OPS:SalesOps"
  | "PRO-DEV"
  | "ADVISORY"
  | "OAL"
  | "ONBOARDING"
  | "COMMS_FLUENCY"
  | "INT:PRODUCT"
  | "INT:AUTO"
  | "INT:INFRA"
  | "INT:DOCS";

export type LoopType = "OBJECTIVE" | "KEY_RESULT";

export type LoopStatus =
  | "BACKLOG"
  | "IN_PROGRESS"
  | "IN_QA_REVIEW"
  | "COMPLETED"
  | "DELAY_INCOMPLETED";

export type LoopPhase =
  | "PROJECTION"
  | "ASSERTION"
  | "FOCUS"
  | "FEEDBACK"
  | "ADAPTATION";

export type LoopPillar =
  | "REVOPS"
  | "TECHOPS"
  | "ADMINOPS"
  | "CROSS"
  | "SKILLS"
  | "INTERNAL";

export const LOOP_CATEGORIES: LoopCategory[] = [
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
];

export const LOOP_TYPES: LoopType[] = ["OBJECTIVE", "KEY_RESULT"];

export const LOOP_STATUSES: LoopStatus[] = [
  "BACKLOG",
  "IN_PROGRESS",
  "IN_QA_REVIEW",
  "COMPLETED",
  "DELAY_INCOMPLETED",
];

export const LOOP_PHASES: LoopPhase[] = [
  "PROJECTION",
  "ASSERTION",
  "FOCUS",
  "FEEDBACK",
  "ADAPTATION",
];

export const LOOP_PILLARS: LoopPillar[] = [
  "REVOPS",
  "TECHOPS",
  "ADMINOPS",
  "CROSS",
  "INTERNAL",
];

export const PRIORITIES = [1, 2, 3, 4, 5] as const;

export interface Contributor {
  email: string;
  share: number; // min: 0, max: 1
}

export interface Lesson {
  abstract: string; // max: 280 chars
  tags?: string[];
  reuse_notes?: string;
}

export interface AdaptationRecord {
  why: string;
  what?: string;
  previous_target_date: string;
  new_target_date: string;
  adapted_at: string;
  follow_on_loop_id?: string;
}

export interface StatusHistoryRecord {
  status: LoopStatus;
  changed_at: string;
  comment?: string;
}

export interface TaskComment {
  comment_id: string;
  author_email: string;
  author_name?: string;
  content: string;
  mentions?: string[]; // @mentioned emails
  attachments?: TaskCommentAttachment[];
  created_at: string;
}

export interface TaskCommentAttachment {
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number; // bytes
}

export interface Loop {
  loop_id: string;

  title: string;
  description?: string;

  category: LoopCategory;
  pillar: LoopPillar;
  loop_type: LoopType;

  status: LoopStatus;
  phase: LoopPhase;
  priority: number;

  start_date?: string;
  target_completion_date?: string;
  actual_completion_date?: string;
  created_at: string;
  updated_at: string;
  updated_by?: string;

  effort_score?: number;
  outcome_score?: number;
  loop_score?: number;
  weighted_score?: number;

  owner_email: string;
  owner_name?: string;
  contributors?: Contributor[];

  lesson?: Lesson;

  adaptations?: AdaptationRecord[];

  progress_history?: StatusHistoryRecord[];

  comments?: TaskComment[];

  tags: string[]; // default: []
  jira_key?: string;
}

export interface CreateLoopInput {
  loop_id?: string;
  title: string; // min: 1
  description?: string;
  loop_type: LoopType;
  category: LoopCategory;
  owner_email: string; // email format
  target_completion_date?: string;
  priority?: number; // int 1-5
  status?: LoopStatus;
  status_comment: string; // required comment for initial status
  tags?: string[];
  jira_key?: string;
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface UpdateLoopInput {
  loop_id: string;
  title?: string; // min: 1
  description?: string;
  phase?: LoopPhase;
  status?: LoopStatus;
  status_comment?: string; // required when updating status
  priority?: number; // int 1-5
  owner_email?: string; // email format
  tags?: string[];
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface ScoreEffortInput {
  loop_id: string;
  effort_score: number; // int 1-5
  updated_by?: string;
}

export interface ScoreOutcomeInput {
  loop_id: string;
  outcome_score: number; // int 1-5
  contributors?: Contributor[];
  lesson?: Lesson;
  updated_by?: string;
}

export interface AdaptLoopInput {
  loop_id: string;
  why: string;
  what?: string;
  new_target_completion_date: string;
  create_follow_on?: boolean;
  follow_on_title?: string;
  follow_on_priority?: number; // int 1-5
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface LoopListParams {
  category?: LoopCategory;
  status?: LoopStatus;
  phase?: LoopPhase;
  loop_type?: LoopType;
  owner_email?: string;
  priority?: number;
  target_before?: string;
  sort_by?: "priority" | "target_date" | "created_at" | "updated_at"; // default: "updated_at"
  sort_order?: "asc" | "desc"; // default: "desc"
  limit?: number;
  last_key?: string;
}

export interface LoopListResponse {
  data: Loop[];
  meta: {
    total: number;
    limit: number;
    last_key: string | null;
  };
}

export interface DeliveryStatus {
  loop_id: string;
  title: string;
  category: LoopCategory;
  status: LoopStatus;
  phase: LoopPhase;
  target_completion_date?: string;
  tags: string[];
  owner_name?: string;
}

export interface OpportunityPrioritization {
  loop_id: string;
  title: string;
  category: LoopCategory;
  priority: number;
  target_completion_date?: string;
  loop_score?: number;
  weighted_score?: number;
  owner_name?: string;
}

export interface LearningLoop {
  loop_id: string;
  title: string;
  category: LoopCategory;
  status: LoopStatus;
  outcome_score?: number;
  owner_name?: string;
  abstract?: string;
  lesson_tags?: string[];
}

export type LoopFormData = CreateLoopInput;
export type LoopUpdateFormData = Partial<UpdateLoopInput>;

export interface AddCommentInput {
  loop_id: string;
  content: string;
  author_email: string;
  author_name?: string;
  mentions?: string[];
  attachments?: TaskCommentAttachment[];
}

export const SCORE_LABELS: Record<number, string> = {
  1: "Significant Miss",
  2: "Minor Miss",
  3: "Met Expectation",
  4: "Exceeded",
  5: "Exceptional",
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Nice to Have",
};

export const STATUS_COLORS: Record<LoopStatus, string> = {
  BACKLOG: "slate",
  IN_PROGRESS: "blue",
  IN_QA_REVIEW: "amber",
  COMPLETED: "green",
  DELAY_INCOMPLETED: "red",
};

export const PHASE_COLORS: Record<LoopPhase, string> = {
  PROJECTION: "purple",
  ASSERTION: "blue",
  FOCUS: "orange",
  FEEDBACK: "yellow",
  ADAPTATION: "green",
};

export const PILLAR_COLORS: Record<LoopPillar, string> = {
  REVOPS: "blue",
  TECHOPS: "green",
  ADMINOPS: "purple",
  CROSS: "orange",
  INTERNAL: "gray",
  SKILLS: "teal",
};

// =============================================
// Bulk Assignment Types
// =============================================

// =============================================
// Moodle Integration Types
// =============================================

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
  lang?: string;
  overviewfiles?: Array<{ filename: string; fileurl: string }>;
  /** Number of Aerostack loops linked to this course (returned by get-moodle-courses) */
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

export interface BulkAssignInput {
  title: string;
  description?: string;
  category: LoopCategory;
  loop_type: LoopType;
  target_completion_date: string;
  priority?: number;
  tags?: string[];
  assign_to: "everyone" | "specific" | "group";
  recipient_emails?: string[];
  group_emails?: string[];
  assigned_by?: string;
  /** When true, the API resolves and counts recipients without creating loops. */
  dry_run?: boolean;
  /** Optional Moodle course ID — when provided the loop is linked to that course. */
  moodle_course_id?: number;
  /** Moodle course full name for display / loop title fallback. */
  moodle_course_name?: string;
  /** Direct URL to the Moodle course. */
  moodle_course_url?: string;
}

export interface BulkAssignResponse {
  created_count: number;
  failed_count: number;
  loop_ids: string[];
  failures?: Array<{ email: string; reason: string }>;
  /** Recipients that successfully had a learning loop created. */
  assigned_emails?: string[];
  /** Recipients we successfully handed off to the email provider. */
  emailed_emails?: string[];
  /** Present when the email provider rejected the batch. */
  email_delivery_error?: string;
  /** Present on dry_run responses — the resolved unique recipient count. */
  resolved_count?: number;
  /** Per-source counts (best-effort) for "everyone" dry_run results. */
  source_counts?: {
    deel?: number;
    person_table?: number;
    google_workspace?: number;
  };
  /** Per-group resolution detail for "group" dry_run results. */
  group_counts?: Array<{
    email: string;
    member_count: number;
    error?: string;
  }>;
  /** Full deduped recipient list (only included on dry_run). */
  resolved_emails?: string[];
  dry_run?: boolean;
  /** Number of users successfully enrolled in Moodle (present when moodle_course_id was set). */
  moodle_enrolled_count?: number;
  /** Emails that could not be enrolled in Moodle because no matching Moodle account was found. */
  moodle_not_found_emails?: string[];
  /** Emails for which a new Moodle account was auto-created (they will receive a Moodle welcome email). */
  moodle_created_emails?: string[];
}

export interface GoogleWorkspaceGroup {
  email: string;
  name: string;
}
