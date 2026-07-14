import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { mapStageToPhase } from "../shared/deal-phases";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

/* ------------------------------------------------------------------ */
/* Customer Success — core surfaces (accounts/health, renewals, CSAT,  */
/* escalations, plans) on a single cs-core table + provider stubs.     */
/* Single-table: PK tenant_id, SK = ACCOUNT#id | RENEWAL#id | CSAT#id | */
/* ESC#id | PLAN#accountId. Source PRD: PRD-Aerostack-Customer-Success.      */
/* ------------------------------------------------------------------ */

const CORE = process.env.CS_CORE_TABLE_NAME!;
const ticketsTable = process.env.CS_TICKETS_TABLE_NAME || "";
const dealTable = process.env.DEALS_TABLE_NAME || "";
const companiesTable = process.env.COMPANIES_TABLE_NAME || "";
const TENANT = process.env.CS_TENANT_ID || "enterprise-internal";

const HEALTH_WEIGHTS: Record<string, number> = {
  delivery_health: 0.25,
  support_health: 0.2,
  cost_trend: 0.15,
  security_posture: 0.15,
  compliance_readiness: 0.1,
  commercial_health: 0.1,
  engagement_recency: 0.05,
};

function scoreToColor(s: number): "GREEN" | "YELLOW" | "ORANGE" | "RED" {
  if (s >= 80) return "GREEN";
  if (s >= 60) return "YELLOW";
  if (s >= 40) return "ORANGE";
  return "RED";
}

/** 7-input weighted composite; missing inputs excluded + renormalized. */
function computeHealth(inputs: Record<string, number | null>) {
  let sum = 0;
  let w = 0;
  for (const [k, weight] of Object.entries(HEALTH_WEIGHTS)) {
    const v = inputs[k];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    sum += Math.max(0, Math.min(100, v)) * weight;
    w += weight;
  }
  if (w === 0) return { score: 0, health: "RED" as const };
  const score = Math.round((sum / w) * 10) / 10;
  return { score, health: scoreToColor(score) };
}

function tenantOf(event: any): string {
  return event.headers?.["X-Tenant-Id"] || event.headers?.["x-tenant-id"] || event.queryStringParameters?.tenant_id || TENANT;
}
function callerEmail(event: any): string | null {
  const c = event.requestContext?.authorizer?.claims || {};
  return c.email || c["cognito:username"] || null;
}
function callerRole(event: any): string {
  const c = event.requestContext?.authorizer?.claims || {};
  return c["givenRole"] || c["custom:role"] || "";
}
function isLead(role: string): boolean {
  return role.toLowerCase() === "admin" || role === "Admin" || role === "Super-Admin";
}

async function queryByPrefix(tenant_id: string, prefix: string): Promise<any[]> {
  const res = await ddbClient.send(
    new QueryCommand({
      TableName: CORE,
      KeyConditionExpression: "tenant_id = :t AND begins_with(sk, :p)",
      ExpressionAttributeValues: { ":t": tenant_id, ":p": prefix },
    }),
  );
  return res.Items ?? [];
}

async function scanAll(table: string): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any;
  do {
    const res = await ddbClient.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey }));
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/* --------- support_health input from open tickets (lightweight) --- */
async function supportHealthFor(tenant_id: string, account_id: string | null): Promise<number | null> {
  if (!ticketsTable) return null;
  try {
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: ticketsTable,
        KeyConditionExpression: "tenant_id = :t AND begins_with(sk, :p)",
        ExpressionAttributeValues: { ":t": tenant_id, ":p": "TICKET#" },
      }),
    );
    const tickets = (res.Items ?? []).filter(
      (i) => !String(i.sk).includes("#MSG#") && !String(i.sk).includes("#EVENT#") && (!account_id || i.account_id === account_id),
    );
    const open = tickets.filter((t) => ["open", "in_progress", "waiting"].includes(t.status)).length;
    const breached = tickets.filter((t) => t.sla_breached).length;
    // simple heuristic: start at 100, -8 per open, -15 per breach, floor 0
    return Math.max(0, 100 - open * 8 - breached * 15);
  } catch {
    return null;
  }
}

/* ----------------------------- ACCOUNTS --------------------------- */
const _listAccounts: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-listAccounts");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    let accounts = await queryByPrefix(tenant_id, "ACCOUNT#");
    // CSM sees only assigned accounts unless lead/admin.
    const role = callerRole(event);
    const me = callerEmail(event);
    if (!isLead(role) && me) accounts = accounts.filter((a) => a.csm_email === me);
    return ok({ accounts, count: accounts.length });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

const _getAccount: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-getAccount");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const id = event.pathParameters?.id;
    if (!id) return err("account id required", 400);
    const got = await ddbClient.send(new GetCommand({ TableName: CORE, Key: { tenant_id, sk: `ACCOUNT#${id}` } }));
    if (!got.Item) return err("Account not found", 404);

    // recompute health with live support input
    const inputs = { ...(got.Item.health_inputs || {}) };
    inputs.support_health = await supportHealthFor(tenant_id, id);
    const { score, health } = computeHealth(inputs);
    const account = { ...got.Item, health_inputs: inputs, health, health_score: score };
    return ok(account);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

const _upsertAccount: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-upsertAccount");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");
    const account_id = body.account_id || event.pathParameters?.id || randomUUID();
    const now = new Date().toISOString();
    const existing = await ddbClient.send(new GetCommand({ TableName: CORE, Key: { tenant_id, sk: `ACCOUNT#${account_id}` } }));
    const inputs = { ...(existing.Item?.health_inputs || {}), ...(body.health_inputs || {}) };
    inputs.support_health = await supportHealthFor(tenant_id, account_id);
    const { score, health } = computeHealth(inputs);
    const item = {
      tenant_id,
      sk: `ACCOUNT#${account_id}`,
      account_id,
      company_name: body.company_name ?? existing.Item?.company_name ?? account_id,
      csm_email: body.csm_email ?? existing.Item?.csm_email ?? null,
      segment: body.segment ?? existing.Item?.segment ?? "smb",
      arr_cents: body.arr_cents ?? existing.Item?.arr_cents ?? null,
      health,
      health_score: score,
      health_inputs: inputs,
      data_classification: "CONFIDENTIAL",
      created_at: existing.Item?.created_at ?? now,
      updated_at: now,
    };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    return ok(item, existing.Item ? 200 : 201);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

const _assignCsm: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-assignCsm");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    if (!isLead(callerRole(event)) && callerRole(event)) return err("CS lead/Admin only", 403);
    const tenant_id = tenantOf(event);
    const id = event.pathParameters?.id;
    if (!id) return err("account id required", 400);
    const body = JSON.parse(event.body || "{}");
    const got = await ddbClient.send(new GetCommand({ TableName: CORE, Key: { tenant_id, sk: `ACCOUNT#${id}` } }));
    if (!got.Item) return err("Account not found", 404);
    const item = { ...got.Item, csm_email: body.csm_email ?? null, updated_at: new Date().toISOString() };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    return ok(item);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/** Seed Accounts from the HubSpot companies mirror (idempotent helper). */
const _seedAccounts: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-seedAccounts");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    if (!companiesTable) return err("companies table not configured", 400);
    const tenant_id = tenantOf(event);
    const companies = await scanAll(companiesTable);
    // deal health per company (from deals mirror)
    const deals = dealTable ? await scanAll(dealTable) : [];
    const now = new Date().toISOString();
    let created = 0;
    for (const c of companies.slice(0, 500)) {
      const account_id = c.companyId;
      if (!account_id) continue;
      const existing = await ddbClient.send(new GetCommand({ TableName: CORE, Key: { tenant_id, sk: `ACCOUNT#${account_id}` } }));
      if (existing.Item) continue;
      const companyDeals = deals.filter((d) => Array.isArray(d.companyIds) && d.companyIds.includes(account_id));
      const won = companyDeals.filter((d) => mapStageToPhase(d.dealstageName) === "CLOSED_WON").length;
      const deal_health = companyDeals.length ? Math.round((won / companyDeals.length) * 100) : null;
      const support_health = await supportHealthFor(tenant_id, account_id);
      const inputs = { delivery_health: null, cost_trend: null, security_posture: null, compliance_readiness: null, support_health, engagement_recency: null, commercial_health: deal_health };
      const { score, health } = computeHealth(inputs);
      await ddbClient.send(new PutCommand({
        TableName: CORE,
        Item: { tenant_id, sk: `ACCOUNT#${account_id}`, account_id, company_name: c.name ?? account_id, csm_email: null, segment: "smb", arr_cents: null, health, health_score: score, health_inputs: inputs, data_classification: "CONFIDENTIAL", created_at: now, updated_at: now },
      }));
      created++;
    }
    logger.info(`seeded ${created} accounts`);
    return ok({ seeded: created });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ----------------------------- RENEWALS --------------------------- */
const _listRenewals: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const renewals = await queryByPrefix(tenantOf(event), "RENEWAL#");
    const status = event.queryStringParameters?.status;
    return ok({ renewals: status ? renewals.filter((r) => r.status === status) : renewals, count: renewals.length });
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};
const _upsertRenewal: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");
    const renewal_id = event.pathParameters?.id || body.renewal_id || randomUUID();
    const item = {
      tenant_id, sk: `RENEWAL#${renewal_id}`, renewal_id,
      account_id: body.account_id ?? null, renewal_date: body.renewal_date ?? null,
      term_months: body.term_months ?? 12, arr_cents: body.arr_cents ?? 0,
      status: body.status ?? "upcoming", risk_reason: body.risk_reason ?? null,
      data_classification: "CONFIDENTIAL", updated_at: new Date().toISOString(),
    };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    return ok(item);
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};

/* ------------------------------- CSAT ----------------------------- */
const _csatResponse: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");
    const collected_at = new Date().toISOString();
    const response_id = randomUUID();
    const item = {
      tenant_id, sk: `CSAT#${body.account_id ?? "na"}#${collected_at}#${response_id}`,
      response_id, account_id: body.account_id ?? null, contact_email: body.contact_email ?? null,
      score: Number(body.score ?? 0), nps: body.nps ?? null, comment: body.comment ?? null,
      collected_at, data_classification: "CONFIDENTIAL",
    };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    // never log contact_email
    return ok({ response_id, account_id: item.account_id, score: item.score, collected_at }, 201);
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};
const _csatTrends: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const account_id = event.queryStringParameters?.account_id;
    const prefix = account_id ? `CSAT#${account_id}#` : "CSAT#";
    const rows = await queryByPrefix(tenant_id, prefix);
    const series = rows
      .map((r) => ({ collected_at: r.collected_at, score: r.score, nps: r.nps }))
      .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));
    const avg = series.length ? Math.round((series.reduce((s, r) => s + (r.score || 0), 0) / series.length) * 10) / 10 : null;
    return ok({ account_id: account_id ?? null, count: series.length, avg_csat: avg, series });
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};

/* ---------------------------- ESCALATIONS ------------------------- */
const _listEscalations: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const rows = await queryByPrefix(tenantOf(event), "ESC#");
    return ok({ escalations: rows, count: rows.length });
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};
const _openEscalation: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");
    const escalation_id = randomUUID();
    const item = {
      tenant_id, sk: `ESC#${escalation_id}`, escalation_id,
      account_id: body.account_id ?? null, severity: body.severity ?? "medium",
      summary: body.summary ?? "", owner_email: body.owner_email ?? callerEmail(event),
      status: "open", opened_at: new Date().toISOString(), resolved_at: null,
      data_classification: "CONFIDENTIAL",
    };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    return ok(item, 201);
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};

/* ------------------------------- PLANS ---------------------------- */
const _getPlan: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const id = event.pathParameters?.id;
    if (!id) return err("account id required", 400);
    const got = await ddbClient.send(new GetCommand({ TableName: CORE, Key: { tenant_id, sk: `PLAN#${id}` } }));
    return ok(got.Item ?? { account_id: id, objectives: [], last_qbr_date: null, next_qbr_date: null });
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};
const _putPlan: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;
    const tenant_id = tenantOf(event);
    const id = event.pathParameters?.id;
    if (!id) return err("account id required", 400);
    const body = JSON.parse(event.body || "{}");
    const item = {
      tenant_id, sk: `PLAN#${id}`, plan_id: id, account_id: id,
      objectives: Array.isArray(body.objectives) ? body.objectives : [],
      last_qbr_date: body.last_qbr_date ?? null, next_qbr_date: body.next_qbr_date ?? null,
      data_classification: "CONFIDENTIAL", updated_at: new Date().toISOString(),
    };
    await ddbClient.send(new PutCommand({ TableName: CORE, Item: item }));
    return ok(item);
  } catch (e: any) {
    return err(e.message || "Internal error");
  }
};

/* ------------------- PROVIDERS (CS-2 stub-first) ------------------ */
const _cost: APIGatewayProxyHandler = async (event) => {
  const auth = authorizeUser(event, UserRole.ENGINEER);
  if (isAuthError(auth)) return auth.error;
  return ok({ account_id: event.queryStringParameters?.account_id ?? null, provider: "stub", raw_spend_cents: null, committed_savings_cents: null, coverage_pct: null, note: "CostDataProvider stub — Cost Explorer integration pending (CS-2)" });
};
const _security: APIGatewayProxyHandler = async (event) => {
  const auth = authorizeUser(event, UserRole.ENGINEER);
  if (isAuthError(auth)) return auth.error;
  return ok({ account_id: event.queryStringParameters?.account_id ?? null, provider: "stub", posture: "YELLOW", tier: "base", findings_count: null, note: "PostureProvider stub — SecHub/Config integration pending (CS-2)" });
};
const _compliance: APIGatewayProxyHandler = async (event) => {
  const auth = authorizeUser(event, UserRole.ENGINEER);
  if (isAuthError(auth)) return auth.error;
  return ok({ account_id: event.queryStringParameters?.account_id ?? null, provider: "stub", status: "on_track", soc2_coverage_pct: null, evidence_progress_pct: null, note: "ComplianceProvider stub — Drata integration pending (CS-2)" });
};

export const listAccounts = withPermissions(_listAccounts);
export const getAccount = withPermissions(_getAccount);
export const upsertAccount = withPermissions(_upsertAccount);
export const assignCsm = withPermissions(_assignCsm);
export const seedAccounts = withPermissions(_seedAccounts);
export const listRenewals = withPermissions(_listRenewals);
export const upsertRenewal = withPermissions(_upsertRenewal);
export const csatResponse = withPermissions(_csatResponse);
export const csatTrends = withPermissions(_csatTrends);
export const listEscalations = withPermissions(_listEscalations);
export const openEscalation = withPermissions(_openEscalation);
export const getPlan = withPermissions(_getPlan);
export const putPlan = withPermissions(_putPlan);
export const cost = withPermissions(_cost);
export const security = withPermissions(_security);
export const compliance = withPermissions(_compliance);
