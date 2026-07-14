import { fetchAuthSession } from "aws-amplify/auth";

/**
 * Client for the Aerostack Modules API (RevOps Productivity + Customer Success),
 * served by Aerostack-ModulesApiStack. Falls back to the main base URL host with a
 * /modules hint if the dedicated var is unset.
 */
const MODULES_API_URL: string =
  (import.meta as any).env?.VITE_MODULES_API_URL?.replace(/\/$/, "") || "";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString() ?? "";
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!MODULES_API_URL) throw new Error("VITE_MODULES_API_URL is not configured");
  const headers = { ...(await authHeaders()), ...(init.headers || {}) };
  const res = await fetch(`${MODULES_API_URL}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `API ${res.status} for ${path}`);
  }
  return (json?.data ?? json) as T;
}

/* ----------------------------- RevOps ----------------------------- */
export interface RevOpsSummary {
  tenant_id: string;
  as_of: string;
  total_pipeline_value_cents: number;
  total_active_deals: number;
  deals_by_phase: Record<string, number>;
  health_distribution: Record<string, number>;
  win_rate_pct: number;
  pipeline_coverage_ratio: number;
}
export interface RepRow {
  rep_email: string;
  period: string;
  open_pipeline_cents: number;
  closed_won_cents: number;
  win_rate_pct: number;
  avg_sales_cycle_days: number;
}
export interface ForecastEntry {
  deal_id: string;
  rep_email: string | null;
  category: string;
  amount_cents: number;
  close_date: string | null;
  days_in_stage: number;
  stalled: boolean;
}
export interface RevOpsAlert {
  type: string;
  deal_id?: string;
  rep_email?: string | null;
  days_in_stage?: number;
  amount_cents?: number;
  coverage_ratio?: number;
}

export interface CadenceOverlay {
  loop_id: string;
  cadence_state: string;
  block: number;
  last_decision_ref?: string | null;
}

export const revopsApi = {
  // The consolidated dashboard lives on the main API (hubspot path); reps/forecast/alerts on modules.
  reps: (period?: string) =>
    req<{ reps: RepRow[]; period: string; count: number }>(
      `/revops/reps${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    ),
  forecast: () => req<{ forecast: ForecastEntry[]; count: number }>(`/revops/forecast`),
  alerts: () => req<{ alerts: RevOpsAlert[]; count: number }>(`/revops/alerts`),
  cadence: () =>
    req<{ tenant_id: string; blocks: Record<string, CadenceOverlay[]>; overlay_count: number }>(
      `/revops/cadence`,
    ),
};

/* ------------------------- Customer Success ----------------------- */
export interface SupportTicket {
  ticket_id: string;
  account_id: string | null;
  subject: string;
  priority: string;
  status: string;
  assignee_email: string | null;
  sla_breached: boolean;
  created_at: string;
  updated_at: string;
}
export interface CsAccount {
  account_id: string;
  company_name: string;
  csm_email: string | null;
  segment: string;
  arr_cents: number | null;
  health: string;
  health_score?: number;
}

export const csApi = {
  tickets: (status?: string) =>
    req<{ tickets: SupportTicket[]; count: number }>(
      `/cs/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  createTicket: (body: { subject: string; priority?: string; account_id?: string }) =>
    req<SupportTicket>(`/cs/tickets`, { method: "POST", body: JSON.stringify(body) }),
  accounts: () => req<{ accounts: CsAccount[]; count: number }>(`/cs/accounts`),
  seedAccounts: () => req<{ seeded: number }>(`/cs/accounts/seed`, { method: "POST" }),
  escalations: () => req<{ escalations: any[]; count: number }>(`/cs/escalations`),
  renewals: () => req<{ renewals: any[]; count: number }>(`/cs/renewals`),
  csatTrends: (accountId?: string) =>
    req<{ count: number; avg_csat: number | null; series: any[] }>(
      `/cs/csat/trends${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`,
    ),
};

/** The consolidated RevOps dashboard summary is on the main Aerostack API. */
const MAIN_API_URL: string =
  (import.meta as any).env?.VITE_BASE_URL?.replace(/\/$/, "") || "";
export async function fetchRevOpsSummary(): Promise<RevOpsSummary> {
  const headers = await authHeaders();
  const res = await fetch(`${MAIN_API_URL}/hubspot/revops-dashboard`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.error || `API ${res.status}`);
  return (json?.data ?? json) as RevOpsSummary;
}

export const centsToUsd = (c: number | null | undefined): string =>
  c == null ? "—" : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
