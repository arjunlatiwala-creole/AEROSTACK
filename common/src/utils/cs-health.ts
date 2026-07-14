// Aerostack Customer Success — composite account health (CS-3)
// The cross-tier churn signal no single tool produces. Pure + testable.
// Source PRD: PRD-Aerostack-Customer-Success-v0.1.md §6 (CS-3).

import {
  ACCOUNT_HEALTH_WEIGHTS,
  type AccountHealthInputs,
  type HealthColor,
} from '../types/customer-success';

export interface CompositeHealthResult {
  /** 0–100 weighted score across available inputs. */
  score: number;
  /** Banded color. */
  health: HealthColor;
  /** Inputs that were present and contributed. */
  contributing: (keyof AccountHealthInputs)[];
}

/**
 * Map a 0–100 composite score to a health color band.
 *   >= 80 GREEN · >= 60 YELLOW · >= 40 ORANGE · else RED
 */
export function scoreToColor(score: number): HealthColor {
  if (score >= 80) return 'GREEN';
  if (score >= 60) return 'YELLOW';
  if (score >= 40) return 'ORANGE';
  return 'RED';
}

/**
 * Compute the 7-input weighted composite health. Each input is a 0–100 number
 * or null. Missing (null) inputs are excluded and the remaining weights are
 * renormalized so the score always spans 0–100. If no inputs are present the
 * account reads RED with score 0 (fail-safe: unknown health is not "healthy").
 */
export function computeAccountHealth(
  inputs: AccountHealthInputs,
  weights: typeof ACCOUNT_HEALTH_WEIGHTS = ACCOUNT_HEALTH_WEIGHTS,
): CompositeHealthResult {
  const keys = Object.keys(weights) as (keyof AccountHealthInputs)[];

  let weightedSum = 0;
  let totalWeight = 0;
  const contributing: (keyof AccountHealthInputs)[] = [];

  for (const key of keys) {
    const value = inputs[key];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const clamped = Math.max(0, Math.min(100, value));
    const weight = weights[key];
    weightedSum += clamped * weight;
    totalWeight += weight;
    contributing.push(key);
  }

  if (totalWeight === 0) {
    return { score: 0, health: 'RED', contributing: [] };
  }

  const score = Math.round((weightedSum / totalWeight) * 10) / 10;
  return { score, health: scoreToColor(score), contributing };
}
