// Aerostack V2 - RevOps Focused Types
// Flexible pipeline tracking with dynamic fields and lifecycle stages

// =============================================
// Enums (matching PostgreSQL)
// =============================================

export type DealPhase =
  | 'LEAD'              // Early prospect
  | 'DEVELOPING'        // Qualified, being worked
  | 'ACTIVELY_FUNDING'  // In negotiation/closing
  | 'CLOSED_WON'        // Won (last 30d)
  | 'CLOSED_LOST'       // Lost (last 30d)
  | 'LAUNCHED';         // Launched/live (last 30d)

export type HealthStatus =
  | 'GREEN'    // Healthy, on track
  | 'YELLOW'   // Needs attention
  | 'ORANGE'   // At risk, blocked
  | 'RED';     // Critical, lost

export type EventType =
  | 'PHASE_CHANGE'
  | 'STAGE_CHANGE'
  | 'FIELD_UPDATE'
  | 'NOTE_ADDED'
  | 'HEALTH_CHANGE'
  | 'OWNER_CHANGE'
  | 'CREATED'
  | 'ARCHIVED';

export type FieldType = 
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'boolean'
  | 'url';

// =============================================
// Core Entities
// =============================================

export interface Person {
  person_id: string;
  name: string;
  email: string;
  company?: string;
  role_title?: string;
  phone?: string;
  linkedin_url?: string;
  
  // Internal team fields
  is_internal: boolean;
  team_area?: string;
  
  // Flexible
  tags: string[];
  custom_fields: Record<string, any>;
  
  created_at: string;
  updated_at: string;
}

export interface Deal {
  deal_id: string;
  
  // Basic Info
  name: string;
  description?: string;
  company?: string;
  
  // Lifecycle
  phase: DealPhase;
  stage?: string;
  health_status: HealthStatus;
  
  // Ownership
  owner_id?: string;
  contact_id?: string;
  
  // Financials
  amount?: number;
  currency: string;
  expected_close_date?: string;
  actual_close_date?: string;
  
  // Priority & Scoring
  priority?: number;
  confidence_score?: number;
  
  // Integration Links
  hubspot_deal_id?: string;
  jira_key?: string;
  
  // Flexible Fields
  tags: string[];
  custom_fields: Record<string, any>;
  
  // Metadata
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface DealEvent {
  event_id: string;
  deal_id: string;
  event_type: EventType;
  
  actor_id?: string;
  description?: string;
  
  before_value?: Record<string, any>;
  after_value?: Record<string, any>;
  
  created_at: string;
}

export interface DealNote {
  note_id: string;
  deal_id: string;
  author_id?: string;
  
  content: string;
  note_type?: string;
  
  created_at: string;
  updated_at: string;
}

export interface StageDefinition {
  stage_id: string;
  stage_name: string;
  phase: DealPhase;
  sort_order: number;
  
  required_fields?: string[];
  color?: string;
  description?: string;
}

export interface FieldDefinition {
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  
  options?: any[]; // For select fields
  
  is_required: boolean;
  validation_rule?: string;
  
  placeholder?: string;
  help_text?: string;
  
  created_at: string;
}

// =============================================
// Extended/Joined Types
// =============================================

export interface DealWithRelations extends Deal {
  owner_name?: string;
  owner_email?: string;
  contact_name?: string;
  contact_email?: string;
  contact_company?: string;
  
  // Recent activity
  recent_events?: DealEvent[];
  recent_notes?: DealNote[];
}

export interface DealsByPhase {
  phase: DealPhase;
  deal_count: number;
  total_amount: number;
  avg_confidence: number;
  green_count: number;
  yellow_count: number;
  orange_count: number;
  red_count: number;
}

export interface DealPipelineView {
  phase: DealPhase;
  phase_label: string;
  deals: DealWithRelations[];
  metrics: {
    count: number;
    total_value: number;
    health_distribution: Record<HealthStatus, number>;
  };
}

// =============================================
// API Request/Response Types
// =============================================

export interface CreateDealRequest {
  name: string;
  description?: string;
  company?: string;
  
  phase?: DealPhase;
  stage?: string;
  
  owner_email?: string;
  contact_email?: string;
  
  amount?: number;
  currency?: string;
  expected_close_date?: string;
  
  priority?: number;
  confidence_score?: number;
  
  tags?: string[];
  custom_fields?: Record<string, any>;
  
  // HubSpot integration
  hubspot_deal_id?: string;
}

export interface UpdateDealRequest {
  deal_id: string;
  
  name?: string;
  description?: string;
  company?: string;
  
  phase?: DealPhase;
  stage?: string;
  health_status?: HealthStatus;
  
  owner_email?: string;
  contact_email?: string;
  
  amount?: number;
  currency?: string;
  expected_close_date?: string;
  actual_close_date?: string;
  
  priority?: number;
  confidence_score?: number;
  
  tags?: string[];
  custom_fields?: Record<string, any>;
}

export interface AddDealNoteRequest {
  deal_id: string;
  content: string;
  note_type?: string;
  author_email?: string;
}

export interface MoveDealPhaseRequest {
  deal_id: string;
  new_phase: DealPhase;
  new_stage?: string;
  reason?: string;
}

export interface UpdateDealHealthRequest {
  deal_id: string;
  health_status: HealthStatus;
  reason?: string;
}

export interface DealListParams {
  phase?: DealPhase;
  stage?: string;
  health_status?: HealthStatus;
  owner_email?: string;
  tag?: string;
  company?: string;
  
  // Date filters
  created_after?: string;
  created_before?: string;
  close_date_after?: string;
  close_date_before?: string;
  
  // Pagination
  page?: number;
  page_size?: number;
  
  // Sorting
  sort_by?: 'created_at' | 'updated_at' | 'expected_close_date' | 'amount' | 'priority';
  sort_order?: 'asc' | 'desc';
}

export interface CreateFieldDefinitionRequest {
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options?: any[];
  is_required?: boolean;
  validation_rule?: string;
  placeholder?: string;
  help_text?: string;
}

export interface CreateStageDefinitionRequest {
  stage_name: string;
  phase: DealPhase;
  sort_order: number;
  required_fields?: string[];
  color?: string;
  description?: string;
}

// =============================================
// HubSpot Integration Types
// =============================================

export interface SyncHubSpotDealRequest {
  hubspot_deal_id: string;
  create_if_not_exists?: boolean;
}

export interface HubSpotDealMapping {
  deal_id: string;
  hubspot_deal_id: string;
  last_synced_at: string;
  sync_status: 'synced' | 'pending' | 'error';
  error_message?: string;
}

// =============================================
// Dashboard/Visualization Types
// =============================================

export interface RevOpsDashboard {
  phases: DealPipelineView[];
  summary: {
    total_deals: number;
    total_pipeline_value: number;
    deals_by_phase: Record<DealPhase, number>;
    health_distribution: Record<HealthStatus, number>;
  };
  recent_activity: DealEvent[];
}

export interface DealActivityTimeline {
  deal_id: string;
  deal_name: string;
  events: Array<{
    event_id: string;
    event_type: EventType;
    description: string;
    actor_name?: string;
    created_at: string;
  }>;
}

// =============================================
// React Flow Types (for workflow visualization)
// =============================================

export interface FlowNode {
  id: string;
  type: 'deal' | 'stage' | 'phase';
  position: { x: number; y: number };
  data: {
    label: string;
    deal?: DealWithRelations;
    health?: HealthStatus;
    phase?: DealPhase;
    stage?: string;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'step' | 'smoothstep';
}

export interface PipelineFlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// =============================================
// Constants
// =============================================

export const DEAL_PHASES: DealPhase[] = [
  'LEAD',
  'DEVELOPING',
  'ACTIVELY_FUNDING',
  'CLOSED_WON',
  'CLOSED_LOST',
  'LAUNCHED'
];

export const HEALTH_STATUSES: HealthStatus[] = [
  'GREEN',
  'YELLOW',
  'ORANGE',
  'RED'
];

export const PHASE_LABELS: Record<DealPhase, string> = {
  'LEAD': 'Leads',
  'DEVELOPING': 'Developing Deals',
  'ACTIVELY_FUNDING': 'Actively Funding Deals',
  'CLOSED_WON': 'Closed Won (Last 30d)',
  'CLOSED_LOST': 'Closed Lost (Last 30d)',
  'LAUNCHED': 'Launched (Last 30d)'
};

export const HEALTH_COLORS: Record<HealthStatus, string> = {
  'GREEN': '#4CAF50',
  'YELLOW': '#FFEB3B',
  'ORANGE': '#FF9800',
  'RED': '#F44336'
};

export const PHASE_COLORS: Record<DealPhase, string> = {
  'LEAD': '#E8F5E9',
  'DEVELOPING': '#FFF9C4',
  'ACTIVELY_FUNDING': '#FFE082',
  'CLOSED_WON': '#C8E6C9',
  'CLOSED_LOST': '#FFCDD2',
  'LAUNCHED': '#BBDEFB'
};

// =============================================
// Utility Types
// =============================================

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ApiSuccess<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

