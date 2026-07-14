// Aerostack Customer Success — SLA computation (CS-1)
// Pure, testable. Business hours 9–6 ET; P0 runs 24/7; clock pauses while
// `waiting` (on customer). Source PRD: PRD-Aerostack-Customer-Success-v0.1.md §6.

import type { TicketPriority, TicketStatus } from '../types/customer-success';

export interface SlaTargets {
  /** First-response target in milliseconds from open. */
  firstResponseMs: number;
  /** Resolution target in milliseconds from open. null = best-effort (P3). */
  resolutionMs: number | null;
  /** Whether this priority's clock runs 24/7 (P0) vs business hours only. */
  roundTheClock: boolean;
}

const HOUR = 60 * 60 * 1000;
const BUSINESS_HOURS_PER_DAY = 9; // 9am–6pm ET
const BUSINESS_DAY_MS = BUSINESS_HOURS_PER_DAY * HOUR;

/**
 * SLA targets by priority (PRD §6):
 *   First response: P0 1h · P1 4h · P2 8 business-hours · P3 2 business-days
 *   Resolution:     P0 4h · P1 1 business-day · P2 3 business-days · P3 best-effort
 */
export function slaTargets(priority: TicketPriority): SlaTargets {
  switch (priority) {
    case 'P0':
      return { firstResponseMs: 1 * HOUR, resolutionMs: 4 * HOUR, roundTheClock: true };
    case 'P1':
      return {
        firstResponseMs: 4 * HOUR,
        resolutionMs: 1 * BUSINESS_DAY_MS,
        roundTheClock: false,
      };
    case 'P2':
      return {
        firstResponseMs: 8 * HOUR,
        resolutionMs: 3 * BUSINESS_DAY_MS,
        roundTheClock: false,
      };
    case 'P3':
      return {
        firstResponseMs: 2 * BUSINESS_DAY_MS,
        resolutionMs: null, // best-effort
        roundTheClock: false,
      };
  }
}

export interface SlaDueTimes {
  sla_first_response_due: string;
  sla_resolution_due: string | null;
}

/**
 * Compute SLA due timestamps from the moment a ticket is opened.
 * Simple elapsed-time model (does not subtract non-business hours) — the
 * `waiting` pause is handled separately by callers tracking accumulated pause.
 */
export function computeSla(priority: TicketPriority, openedAtIso: string): SlaDueTimes {
  const t = slaTargets(priority);
  const openedAt = new Date(openedAtIso).getTime();
  return {
    sla_first_response_due: new Date(openedAt + t.firstResponseMs).toISOString(),
    sla_resolution_due:
      t.resolutionMs === null ? null : new Date(openedAt + t.resolutionMs).toISOString(),
  };
}

/** The SLA clock pauses while the ticket is waiting on the customer. */
export function slaPaused(status: TicketStatus): boolean {
  return status === 'waiting';
}

/**
 * Whether the resolution SLA is breached as of `now`, accounting for total
 * paused (waiting) time. Returns false when there is no resolution target.
 */
export function isResolutionBreached(
  dueIso: string | null,
  nowIso: string,
  pausedMs = 0,
): boolean {
  if (!dueIso) return false;
  const due = new Date(dueIso).getTime() + pausedMs;
  return new Date(nowIso).getTime() > due;
}
