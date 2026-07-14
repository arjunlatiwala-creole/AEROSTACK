import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const LOOPS_TABLE_NAME = process.env.LOOPS_TABLE_NAME;
const LOOP_FINANCIALS_TABLE_NAME = process.env.LOOP_FINANCIALS_TABLE_NAME;
const DEALS_TABLE_NAME = process.env.DEALS_TABLE_NAME;
const COMPANIES_TABLE_NAME = process.env.COMPANIES_TABLE_NAME;
const CONTACTS_TABLE_NAME = process.env.CONTACTS_TABLE_NAME;
const DEEL_PEOPLE_TABLE_NAME = process.env.DEEL_PEOPLE_TABLE_NAME;
const LINEAR_DELIVERY_TABLE_NAME = process.env.LINEAR_DELIVERY_TABLE_NAME;
const INTEGRATION_SYNC_HISTORY_TABLE_NAME =
  process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME;

if (!LOOPS_TABLE_NAME) throw new Error("LOOPS_TABLE_NAME is missing");
if (!LOOP_FINANCIALS_TABLE_NAME)
  throw new Error("LOOP_FINANCIALS_TABLE_NAME is missing");
if (!DEALS_TABLE_NAME) throw new Error("DEALS_TABLE_NAME is missing");
if (!DEEL_PEOPLE_TABLE_NAME)
  throw new Error("DEEL_PEOPLE_TABLE_NAME is missing");
if (!LINEAR_DELIVERY_TABLE_NAME)
  throw new Error("LINEAR_DELIVERY_TABLE_NAME is missing");
if (!COMPANIES_TABLE_NAME) throw new Error("COMPANIES_TABLE_NAME is missing");
if (!CONTACTS_TABLE_NAME) throw new Error("CONTACTS_TABLE_NAME is missing");

const LOOP_STATUS_PROGRESS: Record<string, number> = {
  BACKLOG: 0,
  IN_PROGRESS: 50,
  IN_QA_REVIEW: 75,
  COMPLETED: 100,
  DELAY_INCOMPLETED: 0,
};

type DashboardPeriod = "week" | "month";
type DashboardView = "SUPER_ADMIN" | "ADMIN" | "SELLER" | "USER";

type ActivityType = "AGENT" | "SALES" | "DELIVERY" | "RISK" | "USER";

interface DashboardActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  occurredAt: string; // ISO
  updatedBy?: string | null;
}

interface RevenuePoint {
  label: string; // e.g. Mon or 2026-03-01
  revenue_usd: number;
  pipeline_usd: number;
}

interface OpsHealthItem {
  department: string;
  completion_pct: number; // 0..100
  completed: number;
  total: number;
}

interface SuperAdminDashboardResponse {
  kpis: {
    total_revenue_usd: number;
    total_revenue_change_pct: number | null;
    open_opportunities: number;
    open_opportunities_change: number | null; // absolute change vs previous window
    active_deliveries: number;
    active_deliveries_status_label: string; // "On track" | "At risk" etc
    avg_csat: number | null;
    avg_csat_change: number | null;
    team_members: number;
    team_members_change: number | null;
  };
  analytics: {
    period: DashboardPeriod;
    revenue_pipeline: RevenuePoint[];
    ops_health: OpsHealthItem[];
  };
  activity_feed: DashboardActivityItem[];
  generated_at: string;
}

interface AdminDeliveryRow {
  project: string;
  owner: string | null;
  status: "On Track" | "At Risk" | "Off Track" | "Unknown";
  status_color: "GREEN" | "YELLOW" | "RED" | "GRAY";
  due_date: string | null;
  source: "PROJECT" | "LOOP";
}

interface PeopleOverviewRow {
  department: string;
  members: number;
}

interface AdminDashboardResponse {
  kpis: {
    active_deliveries: number;
    active_deliveries_status_label: string;
    open_opportunities: number;
    open_opportunities_change: number | null;
    team_members: number;
    team_members_change: number | null;
    avg_csat: number | null;
    avg_csat_change: number | null;
  };
  delivery_monitoring: {
    active_deliveries: AdminDeliveryRow[];
  };
  department_health: OpsHealthItem[];
  people_overview: PeopleOverviewRow[];
  activity_feed: DashboardActivityItem[];
  generated_at: string;
}

interface SellerDashboardResponse {
  scope: "my" | "all";
  kpis: {
    my_open_deals: number;
    my_open_deals_change: number | null;
    my_open_deals_label?: string;
    pipeline_value_usd: number;
    pipeline_value_change_usd: number | null;
    pipeline_label?: string;
    sows_created: number | null;
    my_avg_csat: number | null;
    my_avg_csat_label?: string;
    revenue_label?: string;
  };
  revenue_series: Array<{ label: string; revenue_usd: number }>;
  active_deliveries: AdminDeliveryRow[];
  active_deliveries_label?: string;
  pipeline: Array<{
    company: string | null;
    deal: string;
    stage: string | null;
    value_usd: number;
    updated_at: string | null;
  }>;
  activity_feed: DashboardActivityItem[];
  activity_feed_label?: string;
  generated_at: string;
}

interface UserDashboardResponse {
  kpis: {
    my_open_tasks: number;
    my_open_tasks_change: number | null;
    my_deliveries: number;
    my_deliveries_status_label: string;
    learning_progress_pct: number | null;
    learning_progress_change: number | null;
  };
  tasks: Array<{
    id: string;
    title: string;
    due_date: string | null;
    done: boolean;
    type?: string;
  }>;
  deliveries: AdminDeliveryRow[];
  learning: Array<{ module: string; pct: number }>;
  activity_feed: DashboardActivityItem[];
  generated_at: string;
}

type EnterpriseAerostackDashboardUnion =
  | { view: "SUPER_ADMIN"; data: SuperAdminDashboardResponse }
  | { view: "ADMIN"; data: AdminDashboardResponse }
  | { view: "SELLER"; data: SellerDashboardResponse }
  | { view: "USER"; data: UserDashboardResponse };

function isoNow() {
  return new Date().toISOString();
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseIsoDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeNumber(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function getClaim(event: any, key: string): string | null {
  const claims = event?.requestContext?.authorizer?.claims;
  if (!claims) return null;
  const v = claims[key];
  if (!v) return null;
  return String(v);
}

function resolveIdentity(event: any): {
  personId: string | null;
  email: string;
} {
  // 1. Try Cognito authorizer claims (most reliable)
  const claims = event?.requestContext?.authorizer?.claims;
  if (claims?.sub) {
    return {
      personId: String(claims.sub),
      email: String(
        claims.email || claims["cognito:username"] || "",
      ).toLowerCase(),
    };
  }

  // 2. Try decoding the raw Authorization Bearer token
  const token =
    event?.headers?.Authorization || event?.headers?.authorization || "";
  if (token) {
    try {
      const parts = String(token)
        .replace(/^Bearer\s+/i, "")
        .split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        return {
          personId: payload.sub ? String(payload.sub) : null,
          email: String(
            payload.email || payload["cognito:username"] || "",
          ).toLowerCase(),
        };
      }
    } catch {
      // ignore decode errors
    }
  }

  return { personId: null, email: "" };
}

async function getGivenRoleFromPersonTable(event: any): Promise<DashboardView> {
  const identity = resolveIdentity(event);

  const tableName = process.env.PERSON_TABLE_NAME;
  const { personId, email } = resolveIdentity(event);

  const roleFromRecord = (person: any): DashboardView => {
    if (!person) return "USER";
    const givenRole = String(person.givenRole ?? "").trim();
    switch (givenRole) {
      case "Super-Admin":
        return "SUPER_ADMIN";
      case "Admin":
        return "ADMIN";
      case "Seller":
        return "SELLER";
      case "User":
      default:
        return "USER";
    }
  };

  // Step 1 — look up by personId (Cognito sub) — fast primary key query
  if (personId) {
    try {
      const result = await ddbClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "personId = :pid",
          ExpressionAttributeValues: { ":pid": personId },
          Limit: 1,
        }),
      );
      const person = result.Items?.[0];
      if (person) return roleFromRecord(person);
    } catch {
      // fall through to email lookup
    }
  }

  // Step 2 — fall back to email-based scan (for SSO / mismatched sub)
  if (email) {
    try {
      const emailResult = await ddbClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: "email = :em OR ownerEmail = :em",
          ExpressionAttributeValues: { ":em": email },
          Limit: 1,
        }),
      );
      const person = emailResult.Items?.[0];
      if (person) return roleFromRecord(person);
    } catch {
      // fall through to default
    }
  }

  // Step 3 — legacy heuristic: "will" in email defaults to Super Admin
  if (email.includes("will")) return "SUPER_ADMIN";

  return "USER";
}

/**
 * Look up the Person table and return the canonical email stored there.
 * This is the email that appears in deals, loops, and projects —
 * it may differ from the Cognito token email (e.g. Google SSO vs email/password).
 *
 * Resolution order:
 *   1. Query by personId (Cognito sub) — O(1) primary key lookup
 *   2. Scan by JWT email — fallback for SSO / mismatched sub
 *   3. Return the JWT email as-is if no Person record found
 */
async function getPersonEmail(event: any): Promise<string> {
  const { personId, email: jwtEmail } = resolveIdentity(event);
  const tableName = process.env.PERSON_TABLE_NAME;

  if (tableName) {
    // Step 1: look up by Cognito sub (fastest — PK query)
    if (personId) {
      try {
        const res = await ddbClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "personId = :pid",
            ExpressionAttributeValues: { ":pid": personId },
            Limit: 1,
          }),
        );
        const person = res.Items?.[0];
        const personEmail = String(person?.email ?? "")
          .trim()
          .toLowerCase();
        if (personEmail) return personEmail;
      } catch {
        // fall through
      }
    }

    // Step 2: scan by JWT email (SSO / mismatched sub)
    if (jwtEmail) {
      try {
        const res = await ddbClient.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: "email = :em OR ownerEmail = :em",
            ExpressionAttributeValues: { ":em": jwtEmail },
            Limit: 1,
          }),
        );
        const person = res.Items?.[0];
        const personEmail = String(person?.email ?? "")
          .trim()
          .toLowerCase();
        if (personEmail) return personEmail;
      } catch {
        // fall through
      }
    }
  }

  // Step 3: best-effort — use the JWT email directly
  return jwtEmail;
}

async function scanAll(
  tableName: string,
  projectionExpression?: string,
  limitPages = 25,
): Promise<any[]> {
  const items: any[] = [];
  let lastKey: Record<string, any> | undefined = undefined;
  let pages = 0;

  do {
    const res = await ddbClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        ...(projectionExpression
          ? { ProjectionExpression: projectionExpression }
          : {}),
      }),
    );
    if (res.Items) items.push(...res.Items);
    lastKey = res.LastEvaluatedKey as any;
    pages++;
  } while (lastKey && pages < limitPages);

  return items;
}

function calcChangePct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function fiscalKeyToSort(fp?: string | null): number | null {
  // Supports "YYYY-QN" or "YYYY-MM"
  if (!fp) return null;
  const s = String(fp);
  const q = s.match(/^(\d{4})-Q([1-4])$/i);
  if (q) return Number(q[1]) * 10 + Number(q[2]);
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  return null;
}

function pickWindow(period: DashboardPeriod) {
  const now = new Date();
  if (period === "month") {
    const start = new Date(now);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const prevStart = new Date(start);
    prevStart.setMonth(prevStart.getMonth() - 1);
    const prevEnd = new Date(start);
    return { start, prevStart, prevEnd, now };
  }

  // week: last 7 days including today, compare vs previous 7-day window
  const today = startOfDay(now);
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  const prevEnd = new Date(start);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 7);
  return { start, prevStart, prevEnd, now };
}

function formatDowLabel(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function buildRevenueSeries(
  period: DashboardPeriod,
  financials: any[],
  deals: any[],
): RevenuePoint[] {
  if (period === "month") {
    // Show last 12 fiscal months summary
    const byFiscal: Record<string, { rev: number; pipeline: number }> = {};

    // Group financials by month
    for (const f of financials) {
      const fp = String(f.fiscal_period ?? "").trim();
      if (!fp || !fp.match(/^\d{4}-\d{2}$/)) {
        // Fallback to updated_at if fiscal_period is missing
        const t = parseIsoDate(f.updated_at) ?? parseIsoDate(f.created_at);
        if (t) {
          const fallbackFp = t.toISOString().slice(0, 7); // YYYY-MM
          if (!byFiscal[fallbackFp]) byFiscal[fallbackFp] = { rev: 0, pipeline: 0 };
          byFiscal[fallbackFp].rev += safeNumber(f.revenue_generated_usd);
        }
        continue;
      }
      if (!byFiscal[fp]) byFiscal[fp] = { rev: 0, pipeline: 0 };
      byFiscal[fp].rev += safeNumber(f.revenue_generated_usd);
    }

    // Group deals by month (Won -> Revenue, Open -> Pipeline)
    for (const d of deals) {
      const stage = String(d.dealstage || d.stage || d.dealStageName || d.dealstageName || "").toLowerCase();
      const isWon = (stage.includes("closed") && stage.includes("won")) || stage.includes("committed");
      const isClosed = stage.includes("closed") || stage.includes("won") || stage.includes("committed");

      const t =
        parseIsoDate(d.closedate) ??
        parseIsoDate(d.updatedAt) ??
        parseIsoDate(d.lastmodifieddate) ??
        parseIsoDate(d.hs_lastmodifieddate) ??
        parseIsoDate(d.createdAt) ??
        parseIsoDate(d.createdate);

      if (!t) continue;
      const fp = t.toISOString().slice(0, 7);
      if (!byFiscal[fp]) byFiscal[fp] = { rev: 0, pipeline: 0 };

      if (isWon) {
        byFiscal[fp].rev += safeNumber(d.amount);
      } else if (!isClosed) {
        byFiscal[fp].pipeline += safeNumber(d.amount);
      }
    }
    // Generate constant range of last 12 months
    const series: RevenuePoint[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const fp = d.toISOString().slice(0, 7); // YYYY-MM
      const data = byFiscal[fp] || { rev: 0, pipeline: 0 };
      series.push({
        label: fp,
        revenue_usd: Math.round(data.rev),
        pipeline_usd: Math.round(data.pipeline)
      });
    }

    return series;
  }

  // Fallback for "week" period (Daily view)
  const { start, now } = pickWindow(period);
  const points: RevenuePoint[] = [];

  const dayCount = 7; // Fixed for week

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dayStart = startOfDay(d);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const label = formatDowLabel(dayStart);

    const rev = financials
      .filter((f) => {
        const t = parseIsoDate(f.created_at) ?? parseIsoDate(f.updated_at);
        return t ? t >= dayStart && t < dayEnd : false;
      })
      .reduce((sum, f) => sum + safeNumber(f.revenue_generated_usd), 0);

    const pipeline = deals
      .filter((dItem) => {
        const t =
          parseIsoDate(dItem.updatedAt) ??
          parseIsoDate(dItem.createdAt) ??
          parseIsoDate(dItem.createdate) ??
          parseIsoDate(dItem.lastmodifieddate);
        if (!t) return false;
        if (t < dayStart || t >= dayEnd) return false;
        const stage = String(
          dItem.stage ?? dItem.dealstage ?? "",
        ).toLowerCase();
        return !stage.includes("closed");
      })
      .reduce((sum, dItem) => sum + safeNumber(dItem.amount), 0);

    points.push({
      label,
      revenue_usd: Math.round(rev),
      pipeline_usd: Math.round(pipeline),
    });
  }

  return points;
}

function computeOpsHealth(
  loops: any[],
  projects: any[],
  deals: any[],
  financials: any[],
  people: any[]
): OpsHealthItem[] {
  const engTotal = loops.length + projects.length;
  const engCompleted =
    loops.filter(l => String(l.status ?? "").toUpperCase() === "COMPLETED").length +
    projects.filter(p => {
      const s = String(p.status_type ?? p.state_name ?? p.state ?? "").toLowerCase();
      return s.includes("completed") || s.includes("done");
    }).length;

  const revTotal = deals.length;
  const revCompleted = deals.filter(d => {
    const stage = String(d.dealstageName ?? d.dealstage ?? d.stage ?? "").toLowerCase();
    return stage.includes("won") || (stage.includes("closed") && !stage.includes("lost"));
  }).length;

  const finTotal = financials.length;
  const finCompleted = financials.filter(f => {
    const spend = Number(f.actual_spend_usd) || 0;
    const budget = Number(f.budget_usd) || 0;
    return budget > 0 ? spend <= budget : true;
  }).length;

  const peopleTotal = people.length;
  const peopleCompleted = people.filter(p => {
    const status = String(p.new_hiring_status ?? p.hiring_status ?? "").toLowerCase();
    return status === "active";
  }).length;

  const toPct = (c: number, t: number) => t === 0 ? 100 : Math.round((c / t) * 100);

  return [

    { department: "RevOps", completion_pct: toPct(revCompleted, revTotal), completed: revCompleted, total: revTotal },
    { department: "Financials", completion_pct: toPct(finCompleted, finTotal), completed: finCompleted, total: finTotal },
    { department: "Engineering", completion_pct: toPct(engCompleted, engTotal), completed: engCompleted, total: engTotal },
    { department: "People Ops", completion_pct: toPct(peopleCompleted, peopleTotal), completed: peopleCompleted, total: peopleTotal }
  ];
}

function mapHealthToStatus(health: any): {
  status: AdminDeliveryRow["status"];
  color: AdminDeliveryRow["status_color"];
} {
  const h = String(health ?? "").toLowerCase();
  if (h === "ontrack") return { status: "On Track", color: "GREEN" };
  if (h === "onrisk" || h.includes("risk")) return { status: "At Risk", color: "YELLOW" };
  if (h === "offtrack" || h.includes("off")) return { status: "Off Track", color: "RED" };
  return { status: "Unknown", color: "GRAY" };
}

function buildAdminActiveDeliveries(
  loops: any[],
  projects: any[],
): AdminDeliveryRow[] {
  const activeLoopStatuses = new Set(["IN_PROGRESS", "DELAY_INCOMPLETED", "BACKLOG"]);

  const loopRows: AdminDeliveryRow[] = loops
    .filter((l) => {
      const cat = String(l.category ?? "").toUpperCase();
      const status = String(l.status ?? "").toUpperCase();
      const hasPrefix = cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
      return hasPrefix && activeLoopStatuses.has(status);
    })
    .map((l) => {
      const raw = String(l.status ?? "").toUpperCase();
      const isDelayed =
        raw.includes("DELAY");
      return {
        project: String(l.title ?? l.name ?? "Loop"),
        owner: (l.owner_name ?? l.owner_email ?? null) as string | null,
        status: isDelayed ? "Off Track" : "On Track",
        status_color: isDelayed ? "RED" : "GREEN",
        due_date: l.target_completion_date ?? l.targetDate ?? null,
        source: "LOOP",
      };
    });

  const projectRows: AdminDeliveryRow[] = projects
    .filter((p) => {
      const s = String(p.status_name ?? "").toLowerCase();
      if (!s) return false;
      if (
        s.includes("completed") ||
        s.includes("canceled")
      )
        return false;
      return (
        s.includes("in progress") ||
        s.includes("started") ||
        s.includes("active") ||
        s.includes("planned") ||
        s.includes("backlog")
      );
    })
    .map((p) => {
      const updates = Array.isArray(p.project_updates) ? p.project_updates : [];
      const latest =
        updates
          .slice()
          .sort((a: any, b: any) =>
            String(b.created_at ?? "").localeCompare(
              String(a.created_at ?? ""),
            ),
          )[0] ?? null;
      const { status, color } = mapHealthToStatus(latest?.health);
      return {
        project: String(p.name ?? "Project"),
        owner: (p.lead_name ?? p.creator_name ?? null) as string | null,
        status,
        status_color: color,
        due_date: p.target_date ?? p.targetDate ?? null,
        source: "PROJECT",
      };
    });

  return [...projectRows, ...loopRows]
    .sort((a, b) =>
      String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")),
    )
  // .slice(0, 12);
}

function buildPeopleOverview(people: any[]): PeopleOverviewRow[] {
  const buckets = new Map<string, number>();
  const normalize = (raw: string) => {
    const s = raw.toLowerCase();
    if (s.includes("eng")) return "Engineering";
    if (s.includes("rev") || s.includes("sales")) return "RevOps/Sales";
    if (s.includes("deliver")) return "Delivery";
    if (s.includes("people") || s.includes("talent") || s.includes("hr"))
      return "People Ops";
    if (s.includes("fin")) return "Finance";
    return "Other";
  };

  for (const p of people) {
    const dept =
      p.department?.name ?? p.department ?? p.team ?? p.org ?? "Other";
    const key = normalize(String(dept));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const order = [
    "Engineering",
    "RevOps/Sales",
    "Delivery",
    "People Ops",
    "Finance",
    "Other",
  ];
  return order
    .filter((k) => buckets.has(k))
    .map((department) => ({
      department,
      members: buckets.get(department) ?? 0,
    }));
}

function buildActivityFeed(
  loops: any[],
  deals: any[],
  projects: any[],
  syncHistory: any[],
  filterEmail?: string,
  companyMap?: Map<string, string>,
  contactMap?: Map<string, string>,
): DashboardActivityItem[] {
  const items: DashboardActivityItem[] = [];
  const femail = filterEmail?.toLowerCase();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const s of syncHistory) {
    // Sync activity is usually global automation, skipping persona filter for now
    // unless there is a specific 'triggered_by' field to check.
    const t =
      parseIsoDate(s.startedAt) ??
      parseIsoDate(s.completedAt) ??
      parseIsoDate(s.createdAt) ??
      parseIsoDate(s.SK);
    if (!t || t < weekAgo) continue;
    items.push({
      id: `sync:${s.PK ?? s.integration_id ?? ""}:${t.toISOString()}`,
      type: "AGENT",
      title: `Agent ran — ${String(s.operation ?? s.type ?? "Automation")} ${String(s.status ?? "").toLowerCase()}`,
      occurredAt: t.toISOString(),
      updatedBy: s.updated_by ?? s.updatedBy ?? "System",
    });
  }

  for (const d of deals) {
    if (femail) {
      const owner = String(d.ownerEmail ?? d.owner_email ?? "").toLowerCase();
      if (owner !== femail) continue;
    }
    const catStr = String(d.createdate || "");
    const uatStr = String(d.hs_lastmodifieddate || "");

    const cd = parseIsoDate(catStr);
    const ud = parseIsoDate(uatStr);

    const isNew = !ud || !cd || cd.getTime() === ud.getTime();

    const t = ud ?? cd;
    if (!t || t < weekAgo) continue;

    const verb = isNew ? "Deal created" : "Deal updated";

    const companyId = Array.isArray(d.companyIds) ? d.companyIds[0] : null;
    const companyName =
      companyMap && companyId ? companyMap.get(String(companyId)) : null;

    const contactId = Array.isArray(d.contactIds) ? d.contactIds[0] : null;
    const contactName =
      contactMap && contactId ? contactMap.get(String(contactId)) : null;

    const extra =
      companyName || contactName ? ` — ${companyName ?? contactName}` : "";

    items.push({
      id: `deal:${d.dealId ?? d.id ?? ""}:${t.toISOString()}`,
      type: "SALES",
      title: `${verb} — ${String(d.name ?? d.dealname ?? "Opportunity")}${extra}`,
      occurredAt: t.toISOString(),
      updatedBy: d.updated_by ?? d.updatedBy ?? null,
    });
  }

  for (const p of projects) {
    if (femail) {
      const lead = String(p.lead_email ?? "").toLowerCase();
      const members = Array.isArray(p.members)
        ? p.members.map((m: any) => String(m.email ?? "").toLowerCase())
        : [];
      if (lead !== femail && !members.includes(femail)) continue;
    }
    const cat = String(p.created_at || p.createdAt || "");
    const uat = String(p.updated_at || p.updatedAt || p.syncedAt || "");
    const isNew = !uat || cat === uat;

    const t = parseIsoDate(uat) ?? parseIsoDate(cat);
    if (!t || t < weekAgo) continue;

    const verb = isNew ? "Project created" : "Project updated";
    const status = String(p.status_name ?? p.state ?? "status");

    items.push({
      id: `project:${p.id ?? ""}:${t.toISOString()}`,
      type: "DELIVERY",
      title: `${verb} — ${String(p.name ?? "Project")} (${status})`,
      occurredAt: t.toISOString(),
      updatedBy: p.updated_by ?? p.updatedBy ?? null,
    });
  }

  for (const l of loops) {
    if (femail) {
      const owner = String(l.owner_email ?? l.ownerEmail ?? "").toLowerCase();
      if (owner !== femail) continue;
    }
    const cat = String(l.created_at || l.createdAt || "");
    const uat = String(l.updated_at || l.updatedAt || "");
    const isNew = !uat || cat === uat;

    const t =
      parseIsoDate(uat) ??
      parseIsoDate(cat) ??
      parseIsoDate(l.target_completion_date);
    if (!t || t < weekAgo) continue;

    const status = String(l.status ?? "").toUpperCase();
    const maybeRisk =
      status.includes("DELAY");
    const verb = maybeRisk
      ? "Risk flagged"
      : isNew
        ? "Loop created"
        : "Loop updated";

    items.push({
      id: `loop:${l.loop_id ?? ""}:${t.toISOString()}`,
      type: maybeRisk ? "RISK" : "DELIVERY",
      title: `${verb} — ${String(l.title ?? l.name ?? "Loop")} (${status || "UPDATED"})`,
      occurredAt: t.toISOString(),
      updatedBy: l.updated_by ?? l.updatedBy ?? null,
    });
  }

  return items
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 12);
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const view = await getGivenRoleFromPersonTable(event);
    const period =
      (event.queryStringParameters?.period as DashboardPeriod | undefined) ??
      "month";
    const normalizedPeriod: DashboardPeriod =
      period === "month" ? "month" : "week";

    const [
      loops,
      financials,
      deals,
      people,
      projects,
      syncHistory,
      companies,
      contacts,
      deelPeople,
    ] = await Promise.all([
      scanAll(LOOPS_TABLE_NAME!, undefined, 25),
      scanAll(LOOP_FINANCIALS_TABLE_NAME!, undefined, 25),
      scanAll(DEALS_TABLE_NAME!, undefined, 25),
      scanAll(process.env.PERSON_TABLE_NAME!, undefined, 25),
      scanAll(LINEAR_DELIVERY_TABLE_NAME!, undefined, 25),
      INTEGRATION_SYNC_HISTORY_TABLE_NAME
        ? scanAll(INTEGRATION_SYNC_HISTORY_TABLE_NAME, undefined, 25)
        : Promise.resolve([]),
      scanAll(COMPANIES_TABLE_NAME!, undefined, 25),
      scanAll(CONTACTS_TABLE_NAME!, undefined, 25),
      scanAll(DEEL_PEOPLE_TABLE_NAME!, undefined, 25),
    ]);


    const companyMap = new Map<string, string>();
    for (const c of companies) {
      if (c.companyId)
        companyMap.set(String(c.companyId), String(c.name || ""));
    }
    const contactMap = new Map<string, string>();
    for (const c of contacts) {
      if (c.contactId) {
        const full = [c.firstname, c.lastname].filter(Boolean).join(" ");
        contactMap.set(String(c.contactId), full);
      }
    }

    // KPI: Total revenue (Financials only) + change vs previous fiscal period
    const dealRevenue = deals
      .filter((d) => {
        const stage = String(d.dealstage || d.stage || d.dealStageName || d.dealstageName || "").toLowerCase();
        return (stage.includes("closed") && stage.includes("won")) || stage.includes("committed");
      })
      .reduce((sum, d) => sum + safeNumber(d.amount), 0);

    const totalRevenue = financials.reduce(
      (sum, f) => sum + safeNumber(f.revenue_generated_usd),
      0,
    );

    const byFiscal: Record<string, number> = {};
    for (const f of financials) {
      const fp = String(f.fiscal_period ?? "").trim();
      if (!fp) continue;
      byFiscal[fp] = (byFiscal[fp] || 0) + safeNumber(f.revenue_generated_usd);
    }
    // Also add Won Deal revenue to byFiscal grouping (Removed per request, only tracking finance table)
    /*
    for (const d of deals) {
      const stage = String(d.dealstage || d.stage || d.dealStageName || d.dealstageName || "").toLowerCase();
      const isWon = (stage.includes("closed") && stage.includes("won")) || stage.includes("committed");
      if (!isWon) continue;

      const t = parseIsoDate(d.updatedAt) ?? parseIsoDate(d.lastmodifieddate) ?? parseIsoDate(d.createdAt);
      if (!t) continue;
      const fp = t.toISOString().slice(0, 7); // YYYY-MM
      byFiscal[fp] = (byFiscal[fp] || 0) + safeNumber(d.amount);
    }
    */

    const fiscalKeys = Object.keys(byFiscal)
      .map((fp) => ({ fp, sort: fiscalKeyToSort(fp) }))
      .filter((x): x is { fp: string; sort: number } => x.sort !== null)
      .sort((a, b) => b.sort - a.sort);
    const currentFp = fiscalKeys[0]?.fp ?? null;
    const prevFp = fiscalKeys[1]?.fp ?? null;
    const revenueChangePct =
      currentFp && prevFp
        ? calcChangePct(byFiscal[currentFp] ?? 0, byFiscal[prevFp] ?? 0)
        : null;

    // KPI: Open opportunities + delta vs previous 7-day window
    const { start, prevStart, prevEnd, now } = pickWindow("week");
    const isClosed = (d: any) => {
      const stage = String(d.stage ?? d.dealstage ?? "").toLowerCase();
      return stage.includes("closed");
    };
    const openOpps = deals.filter((d) => !isClosed(d));
    const openOppsCount = openOpps.length;
    const openCreatedThisWeek = openOpps.filter((d) => {
      const t = parseIsoDate(d.createdAt) ?? parseIsoDate(d.createdate);
      return t ? t >= start && t <= now : false;
    }).length;
    const openCreatedPrevWeek = openOpps.filter((d) => {
      const t = parseIsoDate(d.createdAt) ?? parseIsoDate(d.createdate);
      return t ? t >= prevStart && t < prevEnd : false;
    }).length;
    const openOppsDelta = openCreatedThisWeek - openCreatedPrevWeek;

    // KPI: Active deliveries (loops + projects)
    const activeLoopStatuses = new Set(["IN_PROGRESS", "DELAY_INCOMPLETED", "BACKLOG"]);
    const activeLoops = loops.filter((l) => {
      const cat = String(l.category ?? "").toUpperCase();
      const status = String(l.status ?? "").toUpperCase();
      const hasPrefix = cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
      return hasPrefix && activeLoopStatuses.has(status);
    });
    const hasCategory = (item: any) => {
      const cat = String(item.category ?? "").toUpperCase();
      return cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
    };

    const activeProjects = projects.filter((p) => {
      const s = String(p.status_name ?? "").toLowerCase();
      if (!s) return false;
      if (
        s.includes("completed") ||
        s.includes("canceled")

      )
        return false;
      return (
        s.includes("in progress") ||
        s.includes("started") ||
        s.includes("active") ||
        s.includes("planned") ||
        s.includes("backlog")
      );
    });

    const activeDeliveries = activeLoops.length + activeProjects.length;

    const teamMembers = people.filter((p) => {
      if (p.active === undefined || p.active === null) return true;
      return Number(p.active) === 1;
    }).length;

    const newHiresThisMonth = people.filter((p) => {
      const t = parseIsoDate(p.createdAt);
      if (!t) return false;
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return t >= thirtyDaysAgo && t <= now;
    }).length;

    const generated_at = isoNow();

    const union: EnterpriseAerostackDashboardUnion = await (async () => {
      if (view === "SUPER_ADMIN") {
        const data: SuperAdminDashboardResponse = {
          kpis: {
            total_revenue_usd: Math.round(totalRevenue),
            total_revenue_change_pct:
              revenueChangePct === null
                ? null
                : Math.round(revenueChangePct * 10) / 10,
            open_opportunities: openOppsCount,
            open_opportunities_change: openOppsDelta,
            active_deliveries: activeDeliveries,
            active_deliveries_status_label: "On track",
            avg_csat: null,
            avg_csat_change: null,
            team_members: teamMembers,
            team_members_change: newHiresThisMonth,
          },
          analytics: {
            period: normalizedPeriod,
            revenue_pipeline: buildRevenueSeries(
              normalizedPeriod,
              financials,
              deals,
            ),
            ops_health: computeOpsHealth(loops, projects, deals, financials, deelPeople),
          },
          activity_feed: buildActivityFeed(
            loops,
            deals,
            projects,
            syncHistory,
            undefined,
            companyMap,
            contactMap,
          ),
          generated_at,
        };
        return { view: "SUPER_ADMIN", data };
      }

      if (view === "ADMIN") {
        const data: AdminDashboardResponse = {
          kpis: {
            active_deliveries: activeDeliveries,
            active_deliveries_status_label: "On track",
            open_opportunities: openOppsCount,
            open_opportunities_change: openOppsDelta,
            team_members: teamMembers,
            team_members_change: newHiresThisMonth,
            avg_csat: null,
            avg_csat_change: null,
          },
          delivery_monitoring: {
            active_deliveries: buildAdminActiveDeliveries(loops, projects),
          },
          department_health: computeOpsHealth(loops, projects, deals, financials, deelPeople),
          people_overview: buildPeopleOverview(people),
          activity_feed: buildActivityFeed(
            loops,
            deals,
            projects,
            syncHistory,
            undefined,
            companyMap,
            contactMap,
          ).filter((a) => a.type !== "AGENT"),
          generated_at,
        };
        return { view: "ADMIN", data };
      }

      if (view === "SELLER") {
        // Resolve the canonical email from the Person table so filtering
        // against deals/loops/projects (which store the Person email) is reliable.
        const email = await getPersonEmail(event);

        const scope =
          (event.queryStringParameters?.scope as "my" | "all" | undefined) ??
          "my";
        const isClosed = (d: any) => {
          const stage = String(d.stage ?? d.dealstage ?? "").toLowerCase();
          return stage.includes("closed");
        };
        const isMine = (d: any) => {
          const ownerEmail = String(
            d.ownerEmail ?? d.owner_email ?? "",
          ).toLowerCase();
          return (
            (!!email && ownerEmail === email)
          );
        };

        const baseDeals = scope === "all" ? deals : deals.filter(isMine);
        const open = baseDeals.filter((d) => !isClosed(d));
        const pipelineValue = open.reduce(
          (sum, d) => sum + safeNumber(d.amount),
          0,
        );

        const closedWon = baseDeals.filter((d) => {
          const stage = String(d.dealstage ?? "").toLowerCase();
          return stage.includes("closed") && stage.includes("won");
        });
        const revenueSeries = buildRevenueSeries(
          normalizedPeriod,
          [], // No financials for seller-only chart
          baseDeals, // Pass all deals (Won will count as Revenue, Open as Pipeline)
        ).map((p) => ({ label: p.label, revenue_usd: p.revenue_usd }));

        // Filter projects/loops by canonical Person email (unless scope is 'all')
        const sellerProjects = scope === "all" ? projects.filter((p) => {
          const cat = String(p.category ?? "").toUpperCase();
          return cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
        }) : projects.filter((p) => {
          if (!email) return false;
          const cat = String(p.category ?? "").toUpperCase();
          if (!cat.startsWith("BD") && !cat.startsWith("INT") && !cat.startsWith("GTM")) return false;
          const lead = String(p.lead_email ?? "").toLowerCase();
          const pOwner = String(p.ownerEmail ?? p.owner_email ?? "").toLowerCase();
          const memberEmails = Array.isArray(p.members)
            ? p.members
              .map((m: any) => String(m.email ?? "").toLowerCase())
              .filter(Boolean)
            : [];
          return lead === email || pOwner === email || memberEmails.includes(email);
        });
        const sellerLoops = scope === "all" ? loops.filter((l) => {
          const cat = String(l.category ?? "").toUpperCase();
          return cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
        }) : loops.filter((l) => {
          if (!email) return false;
          const cat = String(l.category ?? "").toUpperCase();
          if (!cat.startsWith("BD") && !cat.startsWith("INT") && !cat.startsWith("GTM")) return false;
          return String(l.owner_email ?? l.ownerEmail ?? "").toLowerCase() === email;
        });

        const data: SellerDashboardResponse = {
          scope,
          kpis: {
            my_open_deals: open.length,
            my_open_deals_change: null,
            my_open_deals_label: scope === "all" ? "All Open Deals" : "My Open Deals",
            pipeline_value_usd: Math.round(pipelineValue),
            pipeline_value_change_usd: null,
            pipeline_label: scope === "all" ? "All Pipeline" : "My Pipeline",
            sows_created: null,
            my_avg_csat: null,
            my_avg_csat_label: scope === "all" ? "All Avg CSAT" : "My Avg CSAT",
            revenue_label: scope === "all" ? "All Revenue Trend" : "My Revenue Trend",
          },
          revenue_series: revenueSeries,
          active_deliveries: buildAdminActiveDeliveries(sellerLoops, sellerProjects),
          active_deliveries_label: scope === "all" ? "All Active Deliveries" : "My Active Deliveries",
          pipeline: open
            .slice()
            .sort((a, b) =>
              String(b.updatedAt ?? b.lastmodifieddate ?? "").localeCompare(
                String(a.updatedAt ?? a.lastmodifieddate ?? ""),
              ),
            )
            // .slice(0, 12)
            .map((d) => {
              const firstCompanyId = Array.isArray(d.companyIds)
                ? d.companyIds[0]
                : null;
              const companyName = firstCompanyId
                ? companyMap.get(String(firstCompanyId))
                : (d.companyName ?? null);

              return {
                company: companyName,
                deal: String(d.name ?? d.dealname ?? "Opportunity"),
                stage: d.dealstageName ?? null,
                value_usd: safeNumber(d.amount),
                updated_at: d.hs_lastmodifieddate ?? null,
              };
            }),
          activity_feed: buildActivityFeed(
            loops,
            deals,
            projects,
            syncHistory,
            scope === "all" ? undefined : email,
            companyMap,
            contactMap,
          )
            .filter((a) => a.type !== "AGENT")
            .slice(0, 12),
          activity_feed_label: scope === "all" ? "All Recent Activity" : "My Recent Activity",
          generated_at,
        };
        return { view: "SELLER", data };
      }

      // USER — resolve canonical Person email for accurate data filtering
      const email = await getPersonEmail(event);

      const allMyLoops = loops.filter((l) => {
        return String(l.owner_email ?? l.ownerEmail ?? "").toLowerCase() === email;
      });

      const myLoops = allMyLoops.filter((l) => {
        const cat = String(l.category ?? "").toUpperCase();
        const status = String(l.status ?? "").toUpperCase();
        const isDelivery = cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
        const isShowing = activeLoopStatuses.has(status)
          || status === "IN_PROGRESS";
        return isDelivery && isShowing;
      });

      const learningLoops = allMyLoops.filter((l) => {
        const cat = String(l.category ?? "").toUpperCase();
        return cat.includes("LEARNING") || cat === "OAL" || cat === "LND" || cat === "PRO-DEV" || cat === "PRO_DEV" || cat === "SKILLS_CERT" || cat === "ONBOARDING" || cat === "COMMS_FLUENCY";
      });

      const myProjects = projects.filter((p) => {
        if (!email) return false;
        const lead = String(p.lead_email ?? "").toLowerCase();
        const pOwner = String(p.creator_email ?? "").toLowerCase();
        const memberEmails = Array.isArray(p.members)
          ? p.members
            .map((m: any) => String(m.email ?? "").toLowerCase())
            .filter(Boolean)
          : [];
        return lead === email || pOwner === email || memberEmails.includes(email);
      });

      const myOpenTasks = allMyLoops.filter((l) => {
        const s = String(l.status ?? "").toUpperCase();
        return s === "IN_PROGRESS" || s === "BACKLOG";
      }).length;
      const myDeliveries = myProjects.length + myLoops.length;


      const learningPct = learningLoops.length === 0
        ? null
        : Math.round(learningLoops.reduce((sum, l) => {
          const status = String(l.status ?? "").toUpperCase();
          const p = LOOP_STATUS_PROGRESS[status] ?? l.progress ?? 0;
          return sum + p;
        }, 0) / learningLoops.length);

      const data: UserDashboardResponse = {
        kpis: {
          my_open_tasks: myOpenTasks,
          my_open_tasks_change: null,
          my_deliveries: myDeliveries,
          my_deliveries_status_label: "Active Deliveries",
          learning_progress_pct: learningPct,
          learning_progress_change: null,
        },
        tasks: allMyLoops.map((l) => {
          const cat = String(l.category ?? "").toUpperCase();
          const isDelivery = cat.startsWith("BD") || cat.startsWith("INT") || cat.startsWith("GTM");
          const isLearning = cat.includes("LEARNING") || cat === "OAL" || cat === "LND" || cat === "PRO-DEV" || cat === "PRO_DEV" || cat === "SKILLS_CERT" || cat === "ONBOARDING" || cat === "COMMS_FLUENCY";
          const type = isDelivery ? "Delivery" : isLearning ? "Learning" : "Task";
          return {
            id: l.loop_id ?? l.id ?? String(Math.random()),
            title: String(l.title ?? l.name ?? "Loop Task"),
            due_date: l.target_completion_date ?? l.targetDate ?? null,
            done: String(l.status ?? "").toUpperCase() === "COMPLETED" || String(l.status ?? "").toUpperCase() === "DONE",
            type,
          };
        }).slice(0, 50),
        deliveries: buildAdminActiveDeliveries(myLoops, myProjects),
        learning: learningLoops.map((l) => {
          const status = String(l.status ?? "").toUpperCase();
          const pct = LOOP_STATUS_PROGRESS[status] ?? l.progress ?? 0;
          return {
            module: String(l.title ?? l.name ?? "Skill"),
            pct,
          };
        }),
        activity_feed: buildActivityFeed(
          loops,
          deals,
          projects,
          syncHistory,
          email,
          companyMap,
          contactMap,
        ).slice(0, 50),
        generated_at,
      };
      return { view: "USER", data };
    })();

    return ok(union);
  } catch (e: any) {
    return err(e?.message ?? "Failed to load Enterprise Aerostack dashboard", 500);
  }
};

export const handler = withPermissions(_handler);
