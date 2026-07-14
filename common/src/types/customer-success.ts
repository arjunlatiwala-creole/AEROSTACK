// Aerostack Customer Success — canonical shared types
// Source PRD: docs/inputs/PRD-Aerostack-Customer-Success-v0.1.md
// CS holds prepared customer data: tenant_id is load-bearing on every record.

export type HealthColor = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

/* ----------------------------- CS-1: Tickets ----------------------------- */

export type TicketPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TicketStatus =
  | 'open'
  | 'waiting' // SLA clock pauses (on customer)
  | 'in_progress'
  | 'resolved'
  | 'closed';

export interface SupportTicket {
  tenant_id: string;
  ticket_id: string;
  account_id: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_email: string | null;
  sla_first_response_due: string | null;
  sla_resolution_due: string | null;
  sla_breached: boolean;
  data_classification: 'CONFIDENTIAL';
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  tenant_id: string;
  ticket_id: string;
  ts: string;
  author_email: string;
  body: string;
  internal_only: boolean; // true = enterprise-ops note the customer never sees
  data_classification: 'CONFIDENTIAL';
}

/* -------------------- CS-2: Tier-0 data provider seams ------------------- */

export interface CostSpend {
  raw_spend_cents: number; // Cost Explorer = source of truth
  committed_savings_cents: number | null; // Archera
  coverage_pct: number | null;
}
export interface CostDataProvider {
  getSpend(tenant_id: string, period: string): Promise<CostSpend>;
}

export interface Posture {
  posture: HealthColor;
  tier: 'base' | 'upwind';
  findings_count: number;
}
export interface PostureProvider {
  getPosture(tenant_id: string): Promise<Posture>;
}

export interface ComplianceStatus {
  status: 'on_track' | 'gaps' | 'at_risk';
  soc2_coverage_pct: number;
  evidence_progress_pct: number;
}
export interface ComplianceProvider {
  getComplianceStatus(tenant_id: string): Promise<ComplianceStatus>;
}

/* ------------------ CS-3: Account + composite health --------------------- */

export interface AccountHealthInputs {
  delivery_health: number | null; // 25%
  cost_trend: number | null; // 15%
  security_posture: number | null; // 15%
  compliance_readiness: number | null; // 10%
  support_health: number | null; // 20%
  engagement_recency: number | null; // 5%
  commercial_health: number | null; // 10%
}

export interface Account {
  account_id: string; // keyed to HubSpot companyId
  tenant_id: string;
  company_name: string;
  csm_email: string | null;
  segment: 'smb' | 'mid' | 'enterprise';
  arr_cents: number | null;
  health: HealthColor; // composite
  health_inputs: AccountHealthInputs;
  data_classification: 'CONFIDENTIAL';
  created_at: string;
  updated_at: string;
}

export const ACCOUNT_HEALTH_WEIGHTS = {
  delivery_health: 0.25,
  support_health: 0.2,
  cost_trend: 0.15,
  security_posture: 0.15,
  compliance_readiness: 0.1,
  commercial_health: 0.1,
  engagement_recency: 0.05,
} as const;

/* ----------------------- CS-4: Renewals + CSAT --------------------------- */

export interface Renewal {
  renewal_id: string;
  account_id: string;
  tenant_id: string;
  renewal_date: string;
  term_months: number;
  arr_cents: number;
  status: 'upcoming' | 'in_progress' | 'won' | 'lost' | 'at_risk';
  risk_reason: string | null;
  data_classification: 'CONFIDENTIAL';
}

export interface CsatResponse {
  response_id: string;
  account_id: string;
  tenant_id: string;
  contact_email: string; // customer PII -> RESTRICTED in storage/logs
  score: number; // 1–5 CSAT
  nps: number | null; // 0–10 NPS, when collected
  comment: string | null;
  collected_at: string;
  data_classification: 'CONFIDENTIAL';
}

/* ------------------ CS-5: Success plans + escalations -------------------- */

export interface SuccessPlan {
  plan_id: string;
  account_id: string;
  tenant_id: string;
  objectives: {
    title: string;
    status: 'open' | 'in_progress' | 'done';
    due_date: string;
  }[];
  last_qbr_date: string | null;
  next_qbr_date: string | null;
  data_classification: 'CONFIDENTIAL';
}

export interface Escalation {
  escalation_id: string;
  account_id: string;
  tenant_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  owner_email: string;
  status: 'open' | 'mitigating' | 'resolved';
  opened_at: string;
  resolved_at: string | null;
  data_classification: 'CONFIDENTIAL';
}

/* ------------------------------ Config ----------------------------------- */

export interface CSConfig {
  tenant_id: string;
  deployment_mode: 'enterprise_saas' | 'dedicated' | 'customer_account';
  customerName: string;
  features: {
    tickets: boolean;
    cost: boolean;
    security: boolean;
    compliance: boolean;
    renewals: boolean;
    csat: boolean;
    successPlans: boolean;
    escalations: boolean;
  };
  health_weights: typeof ACCOUNT_HEALTH_WEIGHTS;
  security_tier: 'base' | 'upwind';
  customer_view: { enabled: boolean; domain: string };
  csat_cadence_days: number;
}
