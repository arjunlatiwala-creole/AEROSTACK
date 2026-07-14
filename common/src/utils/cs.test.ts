import { describe, expect, it } from 'vitest';
import { computeSla, isResolutionBreached, slaPaused, slaTargets } from './cs-sla';
import { computeAccountHealth, scoreToColor } from './cs-health';
import type { AccountHealthInputs } from '../types/customer-success';

describe('slaTargets', () => {
  it('P0 runs round-the-clock with 1h response / 4h resolution', () => {
    const t = slaTargets('P0');
    expect(t.roundTheClock).toBe(true);
    expect(t.firstResponseMs).toBe(60 * 60 * 1000);
    expect(t.resolutionMs).toBe(4 * 60 * 60 * 1000);
  });

  it('P3 resolution is best-effort (null)', () => {
    expect(slaTargets('P3').resolutionMs).toBeNull();
  });
});

describe('computeSla', () => {
  it('computes due times offset from open', () => {
    const opened = '2026-06-28T12:00:00.000Z';
    const { sla_first_response_due, sla_resolution_due } = computeSla('P0', opened);
    expect(sla_first_response_due).toBe('2026-06-28T13:00:00.000Z');
    expect(sla_resolution_due).toBe('2026-06-28T16:00:00.000Z');
  });

  it('leaves resolution null for P3 best-effort', () => {
    expect(computeSla('P3', '2026-06-28T12:00:00.000Z').sla_resolution_due).toBeNull();
  });
});

describe('slaPaused', () => {
  it('pauses only while waiting on the customer', () => {
    expect(slaPaused('waiting')).toBe(true);
    expect(slaPaused('open')).toBe(false);
    expect(slaPaused('in_progress')).toBe(false);
  });
});

describe('isResolutionBreached', () => {
  it('is breached when now exceeds due', () => {
    expect(
      isResolutionBreached('2026-06-28T16:00:00.000Z', '2026-06-28T17:00:00.000Z'),
    ).toBe(true);
  });

  it('is not breached when paused time pushes the due time out', () => {
    // due 16:00, now 17:00, but 2h of paused (waiting) time => effective due 18:00
    expect(
      isResolutionBreached(
        '2026-06-28T16:00:00.000Z',
        '2026-06-28T17:00:00.000Z',
        2 * 60 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it('never breaches a best-effort (null) target', () => {
    expect(isResolutionBreached(null, '2030-01-01T00:00:00.000Z')).toBe(false);
  });
});

describe('scoreToColor', () => {
  it('bands scores into colors', () => {
    expect(scoreToColor(85)).toBe('GREEN');
    expect(scoreToColor(65)).toBe('YELLOW');
    expect(scoreToColor(45)).toBe('ORANGE');
    expect(scoreToColor(10)).toBe('RED');
  });
});

describe('computeAccountHealth', () => {
  const full: AccountHealthInputs = {
    delivery_health: 90,
    cost_trend: 80,
    security_posture: 70,
    compliance_readiness: 60,
    support_health: 100,
    engagement_recency: 50,
    commercial_health: 40,
  };

  it('computes the weighted composite across all inputs', () => {
    const r = computeAccountHealth(full);
    // 90*.25 + 100*.20 + 80*.15 + 70*.15 + 60*.10 + 40*.10 + 50*.05 = 77.5
    expect(r.score).toBe(77.5);
    expect(r.health).toBe('YELLOW');
    expect(r.contributing).toHaveLength(7);
  });

  it('renormalizes weights when inputs are missing', () => {
    const r = computeAccountHealth({
      delivery_health: 100,
      cost_trend: null,
      security_posture: null,
      compliance_readiness: null,
      support_health: 50,
      engagement_recency: null,
      commercial_health: null,
    });
    // delivery .25 + support .20 = .45 total weight
    // (100*.25 + 50*.20) / .45 = 35/.45 = 77.78 -> 77.8
    expect(r.score).toBeCloseTo(77.8, 1);
    expect(r.contributing).toEqual(['delivery_health', 'support_health']);
  });

  it('fails safe to RED/0 when no inputs are present', () => {
    const r = computeAccountHealth({
      delivery_health: null,
      cost_trend: null,
      security_posture: null,
      compliance_readiness: null,
      support_health: null,
      engagement_recency: null,
      commercial_health: null,
    });
    expect(r.score).toBe(0);
    expect(r.health).toBe('RED');
  });

  it('clamps out-of-range input values', () => {
    const r = computeAccountHealth({
      delivery_health: 150, // clamps to 100
      cost_trend: null,
      security_posture: null,
      compliance_readiness: null,
      support_health: null,
      engagement_recency: null,
      commercial_health: null,
    });
    expect(r.score).toBe(100);
  });
});
