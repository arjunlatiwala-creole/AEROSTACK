/* ------------------------------------------------------------------ */
/* RevOps Productivity — pure aggregation helpers                       */
/* Self-contained (no cross-package dep) so the handler stays bundle-   */
/* friendly and the math is unit-testable in isolation.                 */
/* Source PRD: docs/inputs/PRD-Aerostack-RevOps-Productivity-v0.1.md         */
/* ------------------------------------------------------------------ */

export type HealthColor = "GREEN" | "YELLOW" | "ORANGE" | "RED";

/**
 * Consolidated server-aggregated RevOps dashboard summary (Phase 1).
 * Mirrors common/src/types/revops-productivity.ts RevOpsSummary. Kept infra-
 * local so the handler stays bundle-friendly without a cross-package import.
 */
export interface RevOpsSummary {
  tenant_id: string;
  as_of: string;
  total_pipeline_value_cents: number;
  total_active_deals: number;
  deals_by_phase: Record<string, number>;
  health_distribution: Record<HealthColor, number>;
  win_rate_pct: number;
  pipeline_coverage_ratio: number;
  data_classification: "INTERNAL";
}

export interface PhaseAggregates {
  deals_by_phase: Record<string, number>;
  health_distribution: Record<string, number>;
  total_pipeline_value: number;
  active_deals: number;
}

/**
 * Win rate as a percentage (0–100), rounded to 1 decimal.
 * win_rate = closed_won / (closed_won + closed_lost).
 * Returns 0 when there are no closed deals (avoids divide-by-zero).
 */
export function computeWinRatePct(
  closedWon: number,
  closedLost: number,
): number {
  const denom = closedWon + closedLost;
  if (denom <= 0) return 0;
  return Math.round((closedWon / denom) * 1000) / 10;
}

/**
 * Pipeline coverage ratio = open_pipeline / period_target.
 * period_target derives from closed-won run-rate * coverage_target_multiplier
 * when an explicit target is not supplied. Returns 0 when the target is
 * non-positive (cannot compute a meaningful ratio).
 */
export function computePipelineCoverageRatio(
  openPipelineValue: number,
  periodTarget: number,
): number {
  if (periodTarget <= 0) return 0;
  return Math.round((openPipelineValue / periodTarget) * 100) / 100;
}

/**
 * Derive a default period target from closed-won value and the configured
 * coverage multiplier. If nothing has closed yet, fall back to the open
 * pipeline itself so coverage reads as ~1.0 rather than 0.
 */
export function deriveDefaultPeriodTarget(
  closedWonValue: number,
  openPipelineValue: number,
  coverageTargetMultiplier: number,
): number {
  if (closedWonValue > 0) return closedWonValue * coverageTargetMultiplier;
  return openPipelineValue > 0 ? openPipelineValue : 0;
}

/** Convert a dollar (or unit) amount to integer cents, guarding NaN. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

/**
 * Open pipeline = total pipeline value minus closed (won + lost) value.
 * Used as the numerator for coverage.
 */
export function computeOpenPipelineValue(
  totalPipelineValue: number,
  closedWonValue: number,
  closedLostValue: number,
): number {
  const open = totalPipelineValue - closedWonValue - closedLostValue;
  return open > 0 ? open : 0;
}

/** Normalize a health distribution map into the fixed 4-color shape. */
export function normalizeHealthDistribution(
  raw: Record<string, number>,
): Record<HealthColor, number> {
  return {
    GREEN: raw.GREEN ?? 0,
    YELLOW: raw.YELLOW ?? 0,
    ORANGE: raw.ORANGE ?? 0,
    RED: raw.RED ?? 0,
  };
}
