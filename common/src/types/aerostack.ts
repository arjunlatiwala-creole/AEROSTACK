// Aerostack V1 TypeScript Types
// Shared type definitions for AgentiCo Aerostack prioritization system

// =============================================
// Shared enums (matching PostgreSQL enums)
// =============================================

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

export type Pillar =
  | "REVOPS"
  | "TECHOPS"
  | "ADMINOPS"
  | "CROSS"
  | "SKILLS"
  | "INTERNAL";

export type OwnershipRole = "OUTCOME_OWNER" | "CONTRIBUTOR";

export type VisibilityFlag = "PUBLIC" | "INTERNAL";

// =============================================
// Core entities (matching database tables)
// =============================================

export interface Person {
  person_id: string;
  name: string;
  email: string;
  role_title?: string;
  area?: Pillar;
  level_numeric?: number;
  created_at: string;
  updated_at: string;
}

export interface Loop {
  loop_id: string;
  title: string;
  description?: string;
  category: LoopCategory;
  pillar: Pillar;
  loop_type: LoopType;
  status: LoopStatus;
  phase: LoopPhase;
  priority: number; // 1..5
  contributors?: any | string[];
  start_date?: string;
  target_completion_date?: string;
  actual_completion_date?: string;
  effort_score?: number; // 1..5
  outcome_score?: number; // 1..5
  loop_score?: number; // effort*outcome
  jira_key?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  updated_by?: string;
}

export interface LoopOwnership {
  ownership_id: string;
  loop_id: string;
  person_id: string;
  role: OwnershipRole;
  credit_share: number; // 1.0 for owner, 0.25..0.50 for contributors
}

export interface Lesson {
  lesson_id: string;
  loop_id: string;
  abstract: string; // <=280 chars
  tags: string[];
  reuse_notes?: string;
  created_at: string;
}

export interface ResumeItem {
  resume_item_id: string;
  person_id: string;
  loop_id: string;
  title: string;
  category: LoopCategory;
  score?: number;
  date_completed?: string;
  visibility: VisibilityFlag;
  accreditation: boolean;
  public_blurb?: string;
}

export interface LoopChange {
  change_id: string;
  loop_id: string;
  change_type: "ADAPTATION" | "HANDOFF";
  why: string;
  what?: string;
  old_target_date?: string;
  new_target_date: string;
  follow_on_loop_id?: string;
  created_at: string;
}

export interface AdaptationRecord {
  why: string;
  what?: string;
  previous_target_date: string;
  new_target_date: string;
  adapted_at: string;
  follow_on_loop_id?: string;
}

export interface VelocitySnapshot {
  snapshot_id: string;
  person_id: string;
  window_start: string;
  window_end: string;
  velocity_score: number;
  created_at: string;
}

// =============================================
// Extended entities (with joins/computed fields)
// =============================================

export interface LoopWithOwnership extends Loop {
  owner_name?: string;
  owner_email?: string;
  contributors?: string[];
}

export interface LoopTabular {
  loop_id: string;
  title: string;
  category: LoopCategory;
  pillar: Pillar;
  loop_type: LoopType;
  status: LoopStatus;
  phase: LoopPhase;
  priority: number;
  target_completion_date?: string;
  effort_score?: number;
  outcome_score?: number;
  loop_score?: number;
  tags: string[];
  owner_name?: string;
  owner_email?: string;
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

export interface LearningLoop {
  loop_id: string;
  title: string;
  category: LoopCategory;
  status: LoopStatus;
  outcome_score?: number;
  abstract?: string;
  lesson_tags?: string[];
  owner_name?: string;
}

export interface PersonDashboard {
  person_id: string;
  name: string;
  email: string;
  area?: Pillar;
  active_loops: number;
  avg_score?: number;
  completed_loops: number;
  velocity_score?: number;
}

// =============================================
// API contracts
// =============================================

export interface CreateLoopRequest {
  loop_id?: string;
  title: string;
  description?: string;
  loop_type: LoopType;
  category: LoopCategory;
  owner_email: string;
  target_completion_date?: string;
  priority?: number;
  status?: LoopStatus;
  contributors?: Array<{ email: string; share: number }>;
  tags?: string[];
  jira_key?: string;
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface CreateLoopResponse {
  loop_id: string;
  pillar: Pillar;
  jira_key?: string;
}

export interface UpdateLoopRequest {
  loop_id: string;
  title?: string;
  description?: string;
  phase?: LoopPhase;
  status?: LoopStatus;
  priority?: number;
  owner_email?: string;
  tags?: string[];
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface ScoreEffortRequest {
  loop_id: string;
  effort_score: number;
  updated_by?: string;
}

export interface ScoreOutcomeRequest {
  loop_id: string;
  outcome_score: number;
  contributors?: Array<{ email: string; share: number }>;
  lesson?: { abstract: string; tags?: string[]; reuse_notes?: string };
  updated_by?: string;
}

export interface AddTagsRequest {
  loop_id: string;
  tags: string[];
}

export interface AdaptLoopRequest {
  loop_id: string;
  why: string;
  what?: string;
  new_target_completion_date: string; // ISO date
  create_follow_on?: boolean;
  follow_on_title?: string;
  follow_on_priority?: number;
  adaptations?: AdaptationRecord[];
  updated_by?: string;
}

export interface CreatePersonRequest {
  name: string;
  email: string;
  role_title?: string;
  area?: Pillar;
  level_numeric?: number;
}

// List/filter interfaces
export interface LoopListParams {
  owner_email?: string;
  category?: LoopCategory;
  pillar?: Pillar;
  tag?: string;
  phase?: LoopPhase;
  status?: LoopStatus;
  priority_min?: number;
  priority_max?: number;
  priority_eq?: number;
  due_before?: string;
  due_after?: string;
  page?: number;
  page_size?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total_count: number;
  next_cursor?: string;
}

// Error handling
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// =============================================
// Category → Pillar mapping
// =============================================

export const CATEGORY_PILLAR_MAP: Record<LoopCategory, Pillar> = {
  ENG: "TECHOPS",
  MSP: "TECHOPS",
  GTM: "REVOPS",
  BD: "REVOPS",
  "OPS:Finance": "ADMINOPS",
  "OPS:HR": "ADMINOPS",
  "OPS:SalesOps": "REVOPS",
  "PRO-DEV": "CROSS",
  ADVISORY: "CROSS",
  OAL: "SKILLS",
  ONBOARDING: "SKILLS",
  COMMS_FLUENCY: "SKILLS",
  "INT:PRODUCT": "INTERNAL",
  "INT:AUTO": "INTERNAL",
  "INT:INFRA": "INTERNAL",
  "INT:DOCS": "INTERNAL",
};

// =============================================
// Utility types and constants
// =============================================

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

export const PILLARS: Pillar[] = [
  "REVOPS",
  "TECHOPS",
  "ADMINOPS",
  "CROSS",
  "INTERNAL",
];

export const PRIORITIES = [1, 2, 3, 4, 5] as const;
export const SCORES = [1, 2, 3, 4, 5] as const;

// =============================================
// Slack integration types
// =============================================

export interface SlackModalNewLoop {
  trigger_id: string;
  callback_id: string;
  title: string;
  description?: string;
  loop_type: LoopType;
  category: LoopCategory;
  owner_email: string;
  target_completion_date?: string;
  priority: number;
  tags: string;
  jira_key?: string;
}

export interface SlackModalScoreLoop {
  trigger_id: string;
  callback_id: string;
  loop_id: string;
  outcome_score: number;
  contributors: string; // JSON string of contributors
  lesson_abstract?: string;
  lesson_tags?: string;
  lesson_reuse_notes?: string;
}

// =============================================
// Jira integration types
// =============================================

export interface JiraEpic {
  key: string;
  summary: string;
  status: string;
  project: string;
  aerostack_loop_id?: string;
  aerostack_category?: LoopCategory;
  aerostack_pillar?: Pillar;
  target_completion_date?: string;
}

export interface JiraWebhookPayload {
  webhookEvent: string;
  issue: {
    key: string;
    fields: {
      summary: string;
      status: { name: string };
      issuetype: { name: string };
      customfield_aerostack_loop_id?: string;
    };
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string;
      toString: string;
    }>;
  };
}

// =============================================
// Velocity calculation types
// =============================================

export interface VelocityWindow {
  window_start: string;
  window_end: string;
  average_score: number;
  weight: number; // 0.5, 0.3, or 0.2
}

export interface VelocityCalculation {
  person_id: string;
  windows: VelocityWindow[];
  velocity_score: number;
  msp_consistency_floor?: number;
}

// =============================================
// Frontend state types
// =============================================

export interface LoopsState {
  loops: Loop[];
  loading: boolean;
  error: string | null;
  filters: LoopListParams;
  selectedLoop: Loop | null;
}

export interface PeopleState {
  people: Person[];
  loading: boolean;
  error: string | null;
  selectedPerson: Person | null;
}

export interface DashboardState {
  activeView: "org" | "opportunities" | "delivery" | "learning" | "person";
  refreshing: boolean;
  lastRefresh: string | null;
}

// =============================================
// Integrations data (HubSpot, Jira, HR)
// =============================================

export interface HubspotDeal {
  deal_id: string;
  name: string;
  amount: number;
  currency?: string;
  stage: string; // e.g., 'closed-won', 'proposal', etc.
  close_date?: string; // ISO date
  owner_email?: string;
  company?: string;
  created_at: string;
  updated_at: string;
}

export interface LoopDealLink {
  id: string;
  loop_id: string;
  deal_id: string;
  created_at: string;
}

export interface JiraIssue {
  issue_id: string;
  key: string;
  issue_type: string; // Epic, Story, etc.
  status: string; // To Do, In Progress, Done
  summary: string;
  aerostack_loop_id?: string;
  target_completion_date?: string;
  created_at: string;
  updated_at: string;
}

export interface PersonCost {
  id: string;
  person_id: string;
  month: string; // YYYY-MM
  total_cost_usd: number; // salary+benefits allocation
  created_at: string;
}

export interface PersonRoi {
  person_id: string;
  email: string;
  window_start: string;
  window_end: string;
  influenced_revenue_usd: number;
  cost_usd: number;
  roi: number; // influenced_revenue / cost (0 if cost=0)
}

export interface TagCloudItem {
  tag: string;
  count: number;
}

// Back-compat aliases and requests for HubSpot service
export type HubSpotDeal = HubspotDeal;
export interface HubSpotDealListParams {
  limit?: number;
  after?: string;
  properties?: string[];
  pipeline?: string;
  dealstage?: string;
}
export interface HubSpotSearchRequest {
  propertyName: string;
  operator: string;
  value: string;
}
export interface LinkDealToLoopRequest {
  loop_id: string;
  deal_id: string;
}

// =============================================
// Beacon-Focus-Perspex-Move (BFPM) System Types
// =============================================

export interface BeaconSession {
  beacon_id: string;
  session_id: string;
  statement: string;
  tags: string[];
  timeframe: string;
  confidence: number;
  context_vector?: string; // embedding reference
  created_at: string;
}

export interface FocusSession {
  focus_id: string;
  session_id: string;
  beacon_id?: string;
  challenge_text: string;
  tags: string[];
  created_at: string;
}

export interface PerspexInput {
  input_id: string;
  session_id: string;
  participant_id: string;
  top3: string[];
  risk: string;
  level?: "individual" | "systemic" | "strategic";
  created_at: string;
}

export interface PerspexSummary {
  summary_id: string;
  session_id: string;
  focus_id?: string;
  beacon_id?: string;
  common_ground: string[];
  tensions: string[];
  merged_challenge: string;
  generalized_risks: string[];
  created_at: string;
}

export interface ActionPlan {
  plan_id: string;
  session_id: string;
  summary_id?: string;
  objectives: string[];
  owners: string[];
  timeframe: string;
  support_level: "low" | "medium" | "high";
  linked_beacon?: string;
  created_at: string;
}

export interface BfpmSession {
  session_id: string;
  title: string;
  session_type: "strategic" | "tactical" | "operational";
  status: "beacon" | "focus" | "perspex" | "move" | "completed";
  participants: string[]; // participant IDs or emails
  created_at: string;
  updated_at: string;
}

// API Request/Response types
export interface CreateBeaconRequest {
  session_id: string;
  participant_inputs: string[];
  timeframe?: string;
  session_type?: "strategic" | "tactical" | "operational";
}

export interface CreateBeaconResponse {
  beacon_id: string;
  statement: string;
  tags: string[];
  timeframe: string;
  confidence: number;
}

export interface CreateFocusRequest {
  session_id: string;
  beacon_id?: string;
  participant_statements: string[];
}

export interface CreateFocusResponse {
  focus_id: string;
  challenge_text: string;
  tags: string[];
}

export interface CreatePerspexInputRequest {
  session_id: string;
  participant_id: string;
  top3: string[];
  risk: string;
}

export interface CreatePerspexSummaryRequest {
  session_id: string;
  focus_id?: string;
  beacon_id?: string;
}

export interface CreatePerspexSummaryResponse {
  summary_id: string;
  common_ground: string[];
  tensions: string[];
  merged_challenge: string;
  generalized_risks: string[];
}

export interface CreateActionPlanRequest {
  session_id: string;
  summary_id?: string;
  timeframe: string;
  support_level: "low" | "medium" | "high";
}

export interface CreateActionPlanResponse {
  plan_id: string;
  objectives: string[];
  owners: string[];
  timeframe: string;
  support_level: string;
}

// =============================================
// MCP (Model Context Protocol) Types
// =============================================

export interface McpServer {
  server_id: string;
  name: string;
  description: string;
  protocol_version: string; // e.g., "1.0.0"
  endpoint: string; // URL or stdio command
  connection_type: "http" | "stdio" | "websocket";
  status: "connected" | "disconnected" | "error" | "initializing";
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    sampling?: boolean;
  };
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
  last_ping?: string;
}

export interface McpTool {
  tool_id: string;
  server_id: string;
  name: string;
  description: string;
  input_schema: Record<string, any>; // JSON Schema
  category?: string; // e.g., "integration", "data", "communication"
  tags?: string[];
  usage_count?: number;
  avg_duration_ms?: number;
  success_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface McpToolCall {
  call_id: string;
  tool_id: string;
  server_id: string;
  caller_type: "human" | "agent" | "system";
  caller_id: string; // user email or agent ID
  input: Record<string, any>;
  output?: Record<string, any>;
  status: "pending" | "success" | "error" | "timeout";
  error_message?: string;
  duration_ms?: number;
  created_at: string;
  completed_at?: string;
}

export interface McpConnection {
  connection_id: string;
  server_id: string;
  agent_id?: string; // Which agent is using this connection
  session_id?: string;
  status: "active" | "idle" | "closed";
  established_at: string;
  last_activity: string;
}

export interface McpResource {
  resource_id: string;
  server_id: string;
  uri: string; // MCP resource URI
  name: string;
  description?: string;
  mime_type?: string;
  size_bytes?: number;
  metadata?: Record<string, any>;
}

// API Request/Response types
export interface RegisterMcpServerRequest {
  name: string;
  description: string;
  endpoint: string;
  connection_type: "http" | "stdio" | "websocket";
  auth?: {
    type: "bearer" | "api_key" | "none";
    credentials?: string;
  };
  metadata?: Record<string, any>;
}

export interface RegisterMcpServerResponse {
  server_id: string;
  status: "registered" | "error";
  capabilities?: McpServer["capabilities"];
  tools?: McpTool[];
}

export interface CallMcpToolRequest {
  tool_id: string;
  input: Record<string, any>;
  caller_type: "human" | "agent";
  caller_id: string;
  timeout_ms?: number;
}

export interface CallMcpToolResponse {
  call_id: string;
  output: Record<string, any>;
  duration_ms: number;
  status: "success" | "error";
  error_message?: string;
}

export interface ListMcpServersParams {
  status?: McpServer["status"];
  connection_type?: McpServer["connection_type"];
  has_capability?: keyof McpServer["capabilities"];
}

export interface ListMcpToolsParams {
  server_id?: string;
  category?: string;
  tag?: string;
  search?: string; // Search in name/description
}

// =============================================
// Financial & PM Tracking Types
// =============================================

export interface LoopFinancials {
  financial_id: string;
  loop_id: string;
  budget_usd?: number; // Planned budget
  actual_spend_usd?: number; // Actual spend
  revenue_generated_usd?: number; // Revenue attributed
  cost_center?: string;
  fiscal_period?: string; // e.g., "2025-Q1"
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFinancialSummary {
  loop_id: string;
  title: string;
  loop_type: LoopType;
  category: LoopCategory;
  total_budget_usd: number;
  total_actual_usd: number;
  total_revenue_usd: number;
  variance_usd: number; // budget - actual
  roi_percent?: number; // (revenue - actual) / actual * 100
  status: LoopStatus;
  owner_email?: string;
}

export interface OkrFinancialRollup {
  objective_loop_id: string;
  objective_title: string;
  total_budget_usd: number;
  total_actual_usd: number;
  total_revenue_usd: number;
  key_results: Array<{
    kr_loop_id: string;
    kr_title: string;
    budget_usd: number;
    actual_usd: number;
    revenue_usd: number;
  }>;
  health_status: "on_track" | "at_risk" | "over_budget" | "complete";
}

// =============================================
// Engineering Board Types (Cross-Customer)
// =============================================

export type EngWorkType =
  | "ASSESSMENT"
  | "AI_FEATURE"
  | "CN_TASK"
  | "MSP_TASK"
  | "INFRASTRUCTURE"
  | "SECURITY";

export interface EngineeringWorkItem {
  work_id: string;
  title: string;
  work_type: EngWorkType;
  description?: string;
  customer_name?: string; // Optional - can be internal work
  loop_id?: string; // Link to parent Loop/OKR
  priority: number; // 1-5
  status: "backlog" | "todo" | "in_progress" | "review" | "done" | "blocked";
  assigned_to?: string; // person_id or email
  effort_estimate?: number; // story points or hours
  tags: string[];
  external_id?: string; // Linear, Jira, Motion ID
  external_system?: "linear" | "motion" | "jira";
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface EngineeringBoardView {
  board_name: string;
  work_type_filter?: EngWorkType[];
  columns: Array<{
    status: EngineeringWorkItem["status"];
    items: EngineeringWorkItem[];
    wip_limit?: number;
  }>;
  summary: {
    total_items: number;
    by_status: Record<string, number>;
    by_work_type: Record<EngWorkType, number>;
    by_customer: Record<string, number>;
  };
}

export interface EngWorkAggregation {
  work_type: EngWorkType;
  total_count: number;
  in_progress_count: number;
  completed_count: number;
  total_effort: number;
  customers_affected: string[];
  linked_okrs: string[]; // loop_ids
}

// =============================================
// Slack Integration Types (Enhanced)
// =============================================

export interface SlackWorkflowTrigger {
  trigger_id: string;
  workflow_type:
    | "loop_complete"
    | "deal_won"
    | "eng_blocked"
    | "budget_alert"
    | "okr_at_risk";
  channel_id: string;
  conditions: Record<string, any>;
  message_template: string;
  enabled: boolean;
  created_at: string;
}

export interface SlackNotification {
  notification_id: string;
  trigger_type: SlackWorkflowTrigger["workflow_type"];
  channel_id: string;
  message: string;
  metadata: Record<string, any>;
  sent_at: string;
  ts?: string; // Slack message timestamp
}

// =============================================
// Linear/Motion Integration Types
// =============================================

export interface LinearIntegrationConfig {
  api_key: string;
  team_id: string;
  workspace_id?: string;
  sync_enabled: boolean;
  sync_direction: "linear_to_aerostack" | "aerostack_to_linear" | "bidirectional";
  project_mappings: Array<{
    linear_project_id: string;
    aerostack_loop_id: string;
    work_type: EngWorkType;
  }>;
}

export interface MotionIntegrationConfig {
  api_key: string;
  workspace_id: string;
  sync_enabled: boolean;
  auto_create_tasks: boolean;
  task_mappings: Array<{
    motion_project_id: string;
    aerostack_loop_id: string;
    work_type: EngWorkType;
  }>;
}

export interface ExternalWorkSync {
  sync_id: string;
  system: "linear" | "motion" | "jira";
  external_id: string; // Issue/Task ID in external system
  aerostack_work_id: string; // EngineeringWorkItem ID
  last_synced_at: string;
  sync_status: "synced" | "pending" | "conflict" | "error";
  error_message?: string;
}

// =============================================
// API Request/Response Types
// =============================================

export interface CreateFinancialsRequest {
  loop_id: string;
  budget_usd?: number;
  actual_spend_usd?: number;
  revenue_generated_usd?: number;
  cost_center?: string;
  fiscal_period?: string;
  notes?: string;
}

export interface UpdateFinancialsRequest {
  financial_id: string;
  budget_usd?: number;
  actual_spend_usd?: number;
  revenue_generated_usd?: number;
  notes?: string;
}

export interface CreateEngWorkRequest {
  title: string;
  work_type: EngWorkType;
  description?: string;
  customer_name?: string;
  loop_id?: string;
  priority: number;
  assigned_to?: string;
  effort_estimate?: number;
  tags?: string[];
  external_id?: string;
  external_system?: "linear" | "motion" | "jira";
}

export interface UpdateEngWorkRequest {
  work_id: string;
  status?: EngineeringWorkItem["status"];
  assigned_to?: string;
  priority?: number;
  tags?: string[];
}

export interface GetOkrFinancialsRequest {
  objective_loop_id: string;
  include_key_results?: boolean;
}

export interface GetEngBoardRequest {
  work_type_filter?: EngWorkType[];
  customer_filter?: string;
  status_filter?: EngineeringWorkItem["status"][];
  assigned_to?: string;
}

export interface SyncExternalWorkRequest {
  system: "linear" | "motion" | "jira";
  project_id?: string;
  sync_direction: "pull" | "push" | "bidirectional";
}

// =============================================
// People Ops & Deel Integration Types
// =============================================

export type EmploymentStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "ONBOARDING"
  | "OFFBOARDING"
  | "TERMINATED";
export type EmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACTOR"
  | "CONSULTANT"
  | "INTERN";
export type DepartmentType =
  | "ENGINEERING"
  | "PRODUCT"
  | "DESIGN"
  | "SALES"
  | "MARKETING"
  | "OPERATIONS"
  | "FINANCE"
  | "HR"
  | "EXECUTIVE";

// Enhanced Person with Deel data
export interface PersonEnhanced extends Person {
  // Deel integration fields
  deel_employee_id?: string;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  department: DepartmentType;
  manager_id?: string;
  manager_email?: string;
  start_date?: string;
  end_date?: string;
  location?: string;
  country?: string;
  timezone?: string;
  salary_currency?: string;
  salary_amount?: number;

  // Additional HR fields
  pronouns?: string;
  bio?: string;
  skills: string[];
  certifications?: string[];
  emergency_contact?: string;

  // Performance & Goals
  current_okrs?: string[]; // loop_ids
  performance_reviews?: string[]; // review_ids
  goals_this_quarter?: string[];

  // Access & Permissions
  access_level?: "BASIC" | "ADVANCED" | "ADMIN" | "OWNER";
  permissions?: string[];

  // Sync tracking
  last_deel_sync?: string;
  deel_sync_status?: "synced" | "pending" | "error";
}

// Deel API response types
export interface DeelEmployee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  department: string;
  employment_type: string;
  status: string;
  start_date: string;
  manager_id?: string;
  location: {
    country: string;
    city?: string;
    timezone?: string;
  };
  compensation?: {
    amount: number;
    currency: string;
    frequency: string;
  };
  team?: string;
  seniority_level?: string;
}

export interface DeelOrgChart {
  employees: DeelEmployee[];
  hierarchy: Array<{
    employee_id: string;
    manager_id?: string;
    direct_reports: string[];
    level: number;
  }>;
  departments: Record<
    DepartmentType,
    {
      head_id?: string;
      member_count: number;
      members: string[];
    }
  >;
}

// Performance & Goals
export interface PerformanceReview {
  review_id: string;
  person_id: string;
  reviewer_id: string;
  review_period: string; // e.g., "2025-Q1"
  status: "DRAFT" | "SUBMITTED" | "COMPLETED";

  // Ratings
  overall_rating?: number; // 1-5
  technical_rating?: number;
  collaboration_rating?: number;
  leadership_rating?: number;

  // Feedback
  strengths?: string;
  areas_for_improvement?: string;
  goals_next_period?: string;

  // Manager notes
  manager_notes?: string;
  promotion_recommended?: boolean;

  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface PersonGoal {
  goal_id: string;
  person_id: string;
  title: string;
  description?: string;
  goal_type: "CAREER" | "SKILL" | "PROJECT" | "LEARNING";
  target_date?: string;
  progress_percent: number; // 0-100
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  linked_loops?: string[]; // loop_ids
  milestones?: Array<{
    milestone: string;
    completed: boolean;
    completed_at?: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface OrgChartNode {
  person_id: string;
  name: string;
  email: string;
  title: string;
  department: DepartmentType;
  manager_id?: string;
  direct_reports: string[];
  level: number; // 0 = CEO, 1 = VP, 2 = Director, etc.
  employment_status: EmploymentStatus;
}

// People Ops Dashboard types
export interface PeopleOpsDashboard {
  total_employees: number;
  by_status: Record<EmploymentStatus, number>;
  by_department: Record<DepartmentType, number>;
  by_type: Record<EmploymentType, number>;
  by_location: Record<string, number>;

  recent_hires: PersonEnhanced[];
  upcoming_reviews: PerformanceReview[];
  pending_goals: PersonGoal[];

  org_chart: OrgChartNode[];

  // Metrics
  average_tenure_days?: number;
  turnover_rate_percent?: number;
  headcount_trend?: Array<{
    month: string;
    count: number;
  }>;
}

export interface PersonDashboardEnhanced extends PersonDashboard {
  // Employment info
  title: string;
  department: DepartmentType;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  manager_name?: string;
  direct_reports?: PersonEnhanced[];

  // Goals & Performance
  current_goals: PersonGoal[];
  completed_goals_count: number;
  upcoming_reviews: PerformanceReview[];

  // Work summary
  loops_owned: Loop[];
  loops_contributing: Loop[];
  engineering_work: EngineeringWorkItem[];

  // Financial impact
  influenced_revenue?: number;
  projects_completed_value?: number;

  // Access & permissions
  access_level: string;
  permissions: string[];
}

// API Request/Response types
export interface SyncDeelEmployeesRequest {
  force_refresh?: boolean;
  employee_ids?: string[]; // Sync specific employees only
}

export interface SyncDeelEmployeesResponse {
  synced_count: number;
  updated_count: number;
  new_count: number;
  errors: Array<{
    employee_id: string;
    error: string;
  }>;
  last_sync_at: string;
}

export interface CreatePerformanceReviewRequest {
  person_id: string;
  reviewer_id: string;
  review_period: string;
  overall_rating?: number;
  technical_rating?: number;
  collaboration_rating?: number;
  leadership_rating?: number;
  strengths?: string;
  areas_for_improvement?: string;
  goals_next_period?: string;
  manager_notes?: string;
}

export interface CreatePersonGoalRequest {
  person_id: string;
  title: string;
  description?: string;
  goal_type: "CAREER" | "SKILL" | "PROJECT" | "LEARNING";
  target_date?: string;
  linked_loops?: string[];
  milestones?: Array<{
    milestone: string;
    completed: boolean;
  }>;
}

export interface UpdatePersonGoalRequest {
  goal_id: string;
  progress_percent?: number;
  status?: PersonGoal["status"];
  milestones?: Array<{
    milestone: string;
    completed: boolean;
    completed_at?: string;
  }>;
}

export interface GetOrgChartRequest {
  root_person_id?: string; // Start from specific person
  max_depth?: number; // How many levels down
  department_filter?: DepartmentType;
}

export interface GetPersonDashboardEnhancedRequest {
  person_id?: string;
  email?: string;
  include_direct_reports?: boolean;
  include_work_items?: boolean;
}

// =============================================
// Unified Integrations Management Types
// =============================================

export type IntegrationType =
  | "deel"
  | "linear"
  | "motion"
  | "slack"
  | "hubspot"
  | "jira";
export type IntegrationStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "configuring";
export type SyncStatus = "idle" | "syncing" | "success" | "error";

export interface IntegrationConfig {
  integration_id: string;
  integration_type: IntegrationType;
  name: string;
  description: string;
  status: IntegrationStatus;
  enabled: boolean;

  // API Configuration
  api_key?: string;
  api_secret?: string;
  webhook_url?: string;
  oauth_token?: string;

  // Sync Configuration
  sync_enabled: boolean;
  sync_frequency?: "manual" | "hourly" | "daily" | "weekly";
  last_sync_at?: string;
  next_sync_at?: string;
  sync_status?: SyncStatus;

  // Settings
  settings: Record<string, any>;

  // Metadata
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface IntegrationSyncHistory {
  sync_id: string;
  integration_type: IntegrationType;
  sync_type: "manual" | "scheduled" | "webhook";
  status: "success" | "partial" | "error";

  started_at: string;
  completed_at?: string;
  duration_ms?: number;

  records_synced: number;
  records_created: number;
  records_updated: number;
  records_failed: number;

  errors: Array<{
    record_id?: string;
    error_message: string;
    error_code?: string;
  }>;

  metadata?: Record<string, any>;
}

export interface IntegrationHealthCheck {
  integration_type: IntegrationType;
  is_healthy: boolean;
  status: IntegrationStatus;
  last_check_at: string;

  checks: Array<{
    check_name: string;
    passed: boolean;
    message?: string;
  }>;

  recommendations?: string[];
}

export interface IntegrationsOverview {
  total_integrations: number;
  connected_count: number;
  error_count: number;

  integrations: Array<{
    type: IntegrationType;
    name: string;
    status: IntegrationStatus;
    enabled: boolean;
    last_sync?: string;
    sync_status?: SyncStatus;
    error_message?: string;
  }>;

  recent_syncs: IntegrationSyncHistory[];
  health_checks: IntegrationHealthCheck[];
}

// Specific Integration Settings

export interface DeelIntegrationSettings {
  api_key: string;
  sync_frequency: "manual" | "daily";
  sync_employment_status: boolean;
  sync_compensation: boolean;
  sync_org_chart: boolean;
  auto_create_users: boolean;
  department_mapping?: Record<string, DepartmentType>;
}

export interface LinearIntegrationSettings {
  api_key: string;
  team_id: string;
  workspace_id?: string;
  sync_direction: "linear_to_aerostack" | "aerostack_to_linear" | "bidirectional";
  auto_create_work_items: boolean;
  project_mappings: Array<{
    linear_project_id: string;
    aerostack_loop_id: string;
    work_type: EngWorkType;
  }>;
}

export interface MotionIntegrationSettings {
  api_key: string;
  workspace_id: string;
  auto_create_tasks: boolean;
  sync_assignees: boolean;
  task_mappings: Array<{
    motion_project_id: string;
    aerostack_loop_id: string;
    work_type: EngWorkType;
  }>;
}

export interface SlackIntegrationSettings {
  webhook_url: string;
  bot_token?: string;
  app_token?: string;
  default_channel: string;
  notification_channels: Record<string, string>; // event_type -> channel_id
  enable_commands: boolean;
  enable_notifications: boolean;
  enable_workflows: boolean;
}

export interface HubSpotIntegrationSettings {
  api_key: string;
  portal_id?: string;
  sync_deals: boolean;
  sync_companies: boolean;
  sync_contacts: boolean;
  pipeline_mapping?: Record<string, string>;
}

export interface JiraIntegrationSettings {
  api_key: string;
  domain: string; // e.g., "yourcompany.atlassian.net"
  email: string;
  project_key: string;
  sync_epics: boolean;
  sync_stories: boolean;
  epic_to_loop_mapping: boolean;
}

// API Request/Response Types

export interface SaveIntegrationConfigRequest {
  integration_type: IntegrationType;
  enabled?: boolean;
  sync_enabled?: boolean;
  sync_frequency?: string;
  settings: Record<string, any>;
}

export interface TriggerSyncRequest {
  integration_type: IntegrationType;
  sync_type?: "full" | "incremental";
  options?: Record<string, any>;
}

export interface TriggerSyncResponse {
  sync_id: string;
  integration_type: IntegrationType;
  status: "started" | "queued";
  estimated_duration_seconds?: number;
}

export interface GetSyncHistoryRequest {
  integration_type?: IntegrationType;
  limit?: number;
  status_filter?: "success" | "partial" | "error";
  since?: string; // ISO date
}

export interface TestIntegrationRequest {
  integration_type: IntegrationType;
  settings: Record<string, any>;
}

export interface TestIntegrationResponse {
  success: boolean;
  message: string;
  details?: Record<string, any>;
  errors?: string[];
}


// =============================================
// Accredited Learning & Certification Types
// =============================================

/** How a requirement was assigned */
export type AccreditationAssignmentType =
  | "MANDATORY"       // Required for all employees (e.g., AWS Partner Training)
  | "ONBOARDING"      // Required during onboarding window
  | "REMEDIAL"        // Assigned to address a gap
  | "ELECTIVE"        // Self-selected or manager-recommended
  | "AD_HOC";         // One-off request from leadership

/** Completion status of an individual assignment */
export type AccreditationStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EXPIRED"         // Cert lapsed / deadline passed
  | "WAIVED";         // Explicitly waived by admin

/** A defined accreditation requirement (org-level template) */
export interface AccreditationRequirement {
  requirement_id: string;
  title: string;
  description?: string;
  provider: string;                    // e.g., "AWS", "Google", "Salesforce"
  provider_program?: string;           // e.g., "AWS Partner Training", "Skillbuilder"
  category: string;                    // e.g., "Cloud Foundations", "Security", "AI/ML"
  assignment_type: AccreditationAssignmentType;
  is_active: boolean;                  // Can be deactivated without deleting
  modules: AccreditationModule[];      // Individual modules/courses within this requirement
  deadline_days?: number;              // Days from assignment to complete (null = no deadline)
  recurrence_months?: number;          // Re-certification interval (null = one-time)
  applies_to: "ALL" | "DEPARTMENT" | "ROLE" | "INDIVIDUAL";
  applies_to_filter?: string[];        // Department names, role titles, or emails
  created_at: string;
  updated_at: string;
  created_by: string;
}

/** A single module/course within a requirement */
export interface AccreditationModule {
  module_id: string;
  title: string;
  description?: string;
  external_url?: string;               // Link to Skillbuilder, Coursera, etc.
  estimated_hours?: number;
  sort_order: number;
}

/** An individual person's assignment to a requirement */
export interface AccreditationAssignment {
  assignment_id: string;
  requirement_id: string;
  person_email: string;
  person_name?: string;
  assignment_type: AccreditationAssignmentType;
  status: AccreditationStatus;
  assigned_at: string;
  deadline?: string;                   // ISO date
  started_at?: string;
  completed_at?: string;
  completion_evidence?: string;        // URL to screenshot, certificate PDF, etc.
  completion_verified_by?: string;     // Admin who verified
  module_progress: AccreditationModuleProgress[];
  notes?: string;
  last_nudge_at?: string;             // Last time a reminder was sent
  created_at: string;
  updated_at: string;
}

/** Progress on a single module within an assignment */
export interface AccreditationModuleProgress {
  module_id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  completed_at?: string;
  evidence_url?: string;
}

/** Compliance flag for a person's learning goal status */
export interface LearningGoalCompliance {
  person_email: string;
  person_name: string;
  has_active_goal: boolean;
  days_without_active_goal: number;
  is_compliant: boolean;               // false if no active goal for 15+ days
  active_assignments: number;
  completed_assignments: number;
  overdue_assignments: number;
  next_deadline?: string;
}

/** Org-level accreditations dashboard summary */
export interface AccreditationsDashboard {
  total_employees: number;
  compliant_count: number;
  non_compliant_count: number;
  compliance_rate: number;             // 0-100
  requirements: AccreditationRequirement[];
  by_requirement: AccreditationRequirementSummary[];
  non_compliant_people: LearningGoalCompliance[];
  recent_completions: AccreditationAssignment[];
}

/** Summary stats for a single requirement across the org */
export interface AccreditationRequirementSummary {
  requirement_id: string;
  title: string;
  provider: string;
  assignment_type: AccreditationAssignmentType;
  total_assigned: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
  overdue_count: number;
  completion_rate: number;             // 0-100
}

/** Person's accreditation profile (for their dashboard) */
export interface PersonAccreditationProfile {
  person_email: string;
  person_name: string;
  compliance: LearningGoalCompliance;
  assignments: AccreditationAssignment[];
  requirements_map: Record<string, AccreditationRequirement>;  // requirement_id -> requirement
}
