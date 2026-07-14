// Aerostack RevOps Productivity — canonical shared types
// Source PRD: docs/inputs/PRD-Aerostack-RevOps-Productivity-v0.1.md
// Every record carries tenant_id (single-tenant today, customer-deployable later).

export type HealthColor = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

/** Consolidated server-aggregated RevOps dashboard summary (Phase 1). */
export interface RevOpsSummary {
  tenant_id: string;
  as_of: string; // ISO timestamp
  total_pipeline_value_cents: number;
  total_active_deals: number;
  deals_by_phase: Record<string, number>;
  health_distribution: Record<HealthColor, number>;
  win_rate_pct: number; // closed_won / (closed_won + closed_lost)
  pipeline_coverage_ratio: number; // open_pipeline / period_target
  data_classification: 'INTERNAL';
}

/**
 * Per-rep productivity rollup (Phase 1).
 * NOTE: enterprise does NOT use sales quotas. Reps are measured on MBO outcome
 * targets + OKRs (sourced from hiring/comp docs), so okr_attainment_pct is
 * outcome attainment vs MBO/OKR — NOT a quota percentage.
 */
export interface RepProductivity {
  rep_email: string;
  tenant_id: string;
  period: string; // e.g. "2026-Q2"
  open_pipeline_cents: number;
  closed_won_cents: number;
  win_rate_pct: number;
  avg_sales_cycle_days: number;
  velocity_score: number; // reuse common/src/utils/velocity.ts weighting
  mbo_targets: MboTarget[];
  okr_attainment_pct: number | null;
  activity_count: number | null; // null until activity ingest (Phase 4)
  data_classification: 'INTERNAL';
}

export interface MboTarget {
  id: string;
  outcome: string;
  target: number;
  unit: string;
}

/** Cadence-state overlay (Phase 2) — a SEPARATE field on a loop overlay record.
 *  DO NOT expand LoopStatusEnum. */
export type CadenceState =
  | 'in_flight'
  | 'managed'
  | 'handoff'
  | 'blocked'
  | 'at_risk'
  | 'correction';

export interface LoopCadenceOverlay {
  loop_id: string;
  tenant_id: string;
  cadence_state: CadenceState;
  block: 1 | 2 | 3 | 4; // which RevOps meeting block surfaces it
  last_decision_ref: string | null; // adaptLoop adaptation_id / comment id
  data_classification: 'INTERNAL';
}

/** MEDPIC as a structured 6-dimension object (Phase 2) — NOT overloaded BANT-C. */
export interface MedpicScore {
  deal_id: string;
  tenant_id: string;
  metrics: number | null;
  economic_buyer: number | null;
  decision_criteria: number | null;
  decision_process: number | null;
  identify_pain: number | null;
  champion: number | null;
  composite: number; // weighted 0–100; <60 flags in Block 1
  data_classification: 'INTERNAL';
}

/** Forecast entry per deal (Phase 3). */
export interface ForecastEntry {
  deal_id: string;
  tenant_id: string;
  rep_email: string;
  category: 'commit' | 'best_case' | 'pipeline' | 'omitted';
  amount_cents: number;
  close_date: string;
  days_in_stage: number;
  stalled: boolean; // days_in_stage > threshold
  data_classification: 'INTERNAL';
}

export interface RevOpsConfig {
  tenant_id: string;
  customerName: string;
  features: {
    reps: boolean;
    forecast: boolean;
    alerts: boolean;
    activityIngest: boolean;
  };
  fiscal_periods: string[];
  stalled_days_threshold: number; // default 30
  coverage_target_multiplier: number; // default 3.0
}

export const DEFAULT_REVOPS_TENANT_ID = 'enterprise-internal';
export const DEFAULT_STALLED_DAYS_THRESHOLD = 30;
export const DEFAULT_COVERAGE_TARGET_MULTIPLIER = 3.0;
