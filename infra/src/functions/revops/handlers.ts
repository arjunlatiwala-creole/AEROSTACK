import { GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, GivenRole, isAuthError, UserRole } from "../shared/auth-utils";
import { deriveHealth, mapStageToPhase } from "../shared/deal-phases";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";
import {
  computeOpenPipelineValue,
  computePipelineCoverageRatio,
  computeWinRatePct,
  deriveDefaultPeriodTarget,
  toCents,
} from "./aggregations";

/* ------------------------------------------------------------------ */
/* RevOps Productivity — reps / forecast / alerts / mbo / cadence      */
/* Additive. Reuses deals mirror + deal-phases. tenant_id on records.  */
/* ------------------------------------------------------------------ */

const dealTable = process.env.DEALS_TABLE_NAME!;
const mboTable = process.env.REVOPS_MBO_TABLE_NAME!;
const cadenceTable = process.env.REVOPS_CADENCE_TABLE_NAME!;
const loopsTable = process.env.LOOPS_TABLE_NAME || "";
const TENANT = process.env.REVOPS_TENANT_ID || "enterprise-internal";
const COVERAGE_MULT = Number(process.env.COVERAGE_TARGET_MULTIPLIER || "3.0");
const STALLED_DAYS = Number(process.env.STALLED_DAYS_THRESHOLD || "30");

function normStage(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim().toLowerCase().replace(/[-_]/g, " ");
  if (s === "closed lost") return "Closed Lost";
  if (s === "closed won") return "Closed Won";
  return raw.trim();
}

async function scanAll(table: string, projection?: string): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any;
  do {
    const res = await ddbClient.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey, ...(projection ? { ProjectionExpression: projection } : {}) }),
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function callerEmail(event: any): string | null {
  const c = event.requestContext?.authorizer?.claims || event.requestContext?.authorizer?.jwt?.claims;
  return c?.email || c?.["cognito:username"] || null;
}
function callerRole(event: any): string {
  const c = event.requestContext?.authorizer?.claims || {};
  return c["givenRole"] || c["custom:role"] || "";
}
function isPrivileged(role: string): boolean {
  return [GivenRole.ADMIN, GivenRole.SUPER_ADMIN].map(String).includes(role) || role.toLowerCase() === "admin";
}
function daysBetween(a: string, b: number): number {
  const t = Date.parse(a);
  if (Number.isNaN(t)) return 0;
  return Math.floor((b - t) / 86_400_000);
}

interface RepRow {
  rep_email: string;
  tenant_id: string;
  period: string;
  open_pipeline_cents: number;
  closed_won_cents: number;
  win_rate_pct: number;
  avg_sales_cycle_days: number;
  velocity_score: number;
  mbo_targets: any[];
  okr_attainment_pct: number | null;
  activity_count: number | null;
  data_classification: "INTERNAL";
}

/** Build per-rep rollups from the deals mirror. */
async function buildRepRows(period: string): Promise<Record<string, RepRow>> {
  const deals = await scanAll(dealTable);
  const byRep: Record<string, any> = {};
  for (const d of deals) {
    const owner = d.ownerEmail || d.owner_email;
    if (!owner) continue;
    const amount = Number(d.amount ?? 0);
    const stage = normStage(d.dealstageName);
    const phase = mapStageToPhase(stage);
    const r = (byRep[owner] ??= { won: 0, lost: 0, wonVal: 0, lostVal: 0, totalVal: 0, cycleSum: 0, cycleN: 0 });
    r.totalVal += amount;
    if (phase === "CLOSED_WON") { r.won++; r.wonVal += amount; }
    else if (phase === "CLOSED_LOST") { r.lost++; r.lostVal += amount; }
    if (d.createdAt && d.closedate && phase === "CLOSED_WON") {
      const days = (Date.parse(d.closedate) - Date.parse(d.createdAt)) / 86_400_000;
      if (days > 0) { r.cycleSum += days; r.cycleN++; }
    }
  }
  const rows: Record<string, RepRow> = {};
  for (const [email, r] of Object.entries<any>(byRep)) {
    const open = computeOpenPipelineValue(r.totalVal, r.wonVal, r.lostVal);
    rows[email] = {
      rep_email: email,
      tenant_id: TENANT,
      period,
      open_pipeline_cents: toCents(open),
      closed_won_cents: toCents(r.wonVal),
      win_rate_pct: computeWinRatePct(r.won, r.lost),
      avg_sales_cycle_days: r.cycleN ? Math.round(r.cycleSum / r.cycleN) : 0,
      velocity_score: 0, // reserved for loops-based velocity join
      mbo_targets: [],
      okr_attainment_pct: null,
      activity_count: null,
      data_classification: "INTERNAL",
    };
  }
  return rows;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/* ----------------------------- /revops/reps ----------------------- */
const _listReps: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-listReps");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const period = event.queryStringParameters?.period || currentPeriod();
    const rows = await buildRepRows(period);

    // merge MBO targets
    try {
      const mbos = await scanAll(mboTable);
      for (const m of mbos) {
        if (rows[m.rep_email]) {
          rows[m.rep_email].mbo_targets = m.mbo_targets ?? [];
          rows[m.rep_email].okr_attainment_pct = m.okr_attainment_pct ?? null;
        }
      }
    } catch { /* mbo table may be empty */ }

    // RBAC: Seller sees only own row.
    const role = callerRole(event);
    const me = callerEmail(event);
    let out = Object.values(rows);
    if (!isPrivileged(role) && me) out = out.filter((r) => r.rep_email === me);
    return ok({ reps: out, period, count: out.length });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

const _getRep: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-getRep");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const email = event.pathParameters?.email;
    if (!email) return err("rep email required", 400);
    const role = callerRole(event);
    const me = callerEmail(event);
    if (!isPrivileged(role) && me && me !== email) return err("Forbidden", 403);
    const period = event.queryStringParameters?.period || currentPeriod();
    const rows = await buildRepRows(period);
    const row = rows[email];
    if (!row) return err("Rep not found", 404);
    return ok(row);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* --------------------------- /revops/forecast --------------------- */
const _forecast: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-forecast");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const deals = await scanAll(dealTable);
    const now = Date.now();
    const entries = deals
      .map((d) => {
        const amount = Number(d.amount ?? 0);
        const stage = normStage(d.dealstageName);
        const phase = mapStageToPhase(stage);
        if (phase === "CLOSED_WON" || phase === "CLOSED_LOST") return null;
        const daysInStage = d.updatedAt ? daysBetween(d.updatedAt, now) : (d.createdAt ? daysBetween(d.createdAt, now) : 0);
        let category: "commit" | "best_case" | "pipeline" | "omitted" = "pipeline";
        if (phase === "PROPOSED") category = "commit";
        else if (phase === "ACTIVELY_FUNDING") category = "best_case";
        else if (phase === "LEAD") category = "omitted";
        return {
          deal_id: d.dealId,
          tenant_id: TENANT,
          rep_email: d.ownerEmail || d.owner_email || null,
          category,
          amount_cents: toCents(amount),
          close_date: d.closedate || null,
          days_in_stage: daysInStage,
          stalled: daysInStage > STALLED_DAYS,
          data_classification: "INTERNAL",
        };
      })
      .filter(Boolean);
    return ok({ forecast: entries, count: entries.length, stalled_days_threshold: STALLED_DAYS });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ---------------------------- /revops/alerts ---------------------- */
const _alerts: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-alerts");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const deals = await scanAll(dealTable);
    const now = Date.now();
    const alerts: any[] = [];
    let openValue = 0, wonValue = 0;
    for (const d of deals) {
      const amount = Number(d.amount ?? 0);
      const stage = normStage(d.dealstageName);
      const phase = mapStageToPhase(stage);
      if (phase === "CLOSED_WON") wonValue += amount;
      else if (phase !== "CLOSED_LOST") openValue += amount;
      const ref = d.updatedAt || d.createdAt;
      const daysInStage = ref ? daysBetween(ref, now) : 0;
      if (phase !== "CLOSED_WON" && phase !== "CLOSED_LOST" && daysInStage > STALLED_DAYS) {
        alerts.push({
          type: "stalled_deal",
          deal_id: d.dealId,
          rep_email: d.ownerEmail || d.owner_email || null,
          days_in_stage: daysInStage,
          amount_cents: toCents(amount),
          health: deriveHealth(stage, amount),
          tenant_id: TENANT,
        });
      }
    }
    const target = deriveDefaultPeriodTarget(wonValue, openValue, COVERAGE_MULT);
    const coverage = computePipelineCoverageRatio(openValue, target);
    if (coverage < COVERAGE_MULT) {
      alerts.push({ type: "coverage_shortfall", coverage_ratio: coverage, target_multiplier: COVERAGE_MULT, tenant_id: TENANT });
    }
    return ok({ alerts, count: alerts.length });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ------------------------- /revops/mbo/{email} -------------------- */
const _setMbo: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-setMbo");
  try {
    const auth = authorizeUser(event, UserRole.ADMIN);
    if (isAuthError(auth)) return auth.error;
    if (!isPrivileged(callerRole(event)) && callerRole(event)) return err("Admin only", 403);
    const email = event.pathParameters?.email;
    if (!email) return err("rep email required", 400);
    const body = JSON.parse(event.body || "{}");
    const period = body.period || currentPeriod();
    const item = {
      tenant_id: TENANT,
      sk: `REP#${email}#PERIOD#${period}`,
      rep_email: email,
      period,
      mbo_targets: Array.isArray(body.mbo_targets) ? body.mbo_targets : [],
      okr_attainment_pct: body.okr_attainment_pct ?? null,
      data_classification: "INTERNAL",
      updated_at: new Date().toISOString(),
    };
    await ddbClient.send(new PutCommand({ TableName: mboTable, Item: item }));
    logger.info(`mbo set for ${email}`);
    return ok(item);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* --------------------------- /revops/cadence ---------------------- */
// 4-block weekly meeting payload: loops grouped by cadence_state overlay.
const _getCadence: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-getCadence");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    let overlays: any[] = [];
    try {
      const res = await ddbClient.send(
        new QueryCommand({ TableName: cadenceTable, KeyConditionExpression: "tenant_id = :t", ExpressionAttributeValues: { ":t": TENANT } }),
      );
      overlays = res.Items ?? [];
    } catch { /* table may be empty */ }
    const blocks: Record<string, any[]> = { "1": [], "2": [], "3": [], "4": [] };
    for (const o of overlays) blocks[String(o.block ?? 1)]?.push(o);
    return ok({ tenant_id: TENANT, blocks, overlay_count: overlays.length });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

const _setCadenceState: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("revops-setCadenceState");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const loop_id = event.pathParameters?.loop_id;
    if (!loop_id) return err("loop_id required", 400);
    const body = JSON.parse(event.body || "{}");
    const states = ["in_flight", "managed", "handoff", "blocked", "at_risk", "correction"];
    if (!states.includes(body.cadence_state)) return err("invalid cadence_state", 400);
    const item = {
      tenant_id: TENANT,
      sk: `LOOP#${loop_id}`,
      loop_id,
      cadence_state: body.cadence_state,
      block: [1, 2, 3, 4].includes(body.block) ? body.block : 1,
      last_decision_ref: body.last_decision_ref ?? null,
      data_classification: "INTERNAL",
      updated_at: new Date().toISOString(),
    };
    await ddbClient.send(new PutCommand({ TableName: cadenceTable, Item: item }));
    return ok(item);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

export const listReps = withPermissions(_listReps);
export const getRep = withPermissions(_getRep);
export const forecast = withPermissions(_forecast);
export const alerts = withPermissions(_alerts);
export const setMbo = withPermissions(_setMbo);
export const getCadence = withPermissions(_getCadence);
export const setCadenceState = withPermissions(_setCadenceState);
