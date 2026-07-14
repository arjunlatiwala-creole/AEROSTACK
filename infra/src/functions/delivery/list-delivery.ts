import { APIGatewayProxyHandler } from "aws-lambda";
import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

// ─── Table names ───────────────────────────────────────────────────────────
const loopsTable = process.env.LOOPS_TABLE_NAME! || "local-loops";
const linearDeliveryTable =
  process.env.LINEAR_DELIVERY_TABLE_NAME! || "local-linear-delivery";

if (!loopsTable || !linearDeliveryTable) {
  throw new Error("Table names not configured in environment variables");
}

// ─── Unified shape ─────────────────────────────────────────────────────────
export interface UnifiedDeliveryItem {
  id: string;
  entity: "PROJECT" | "LOOP";
  name: string;
  status_name: string;
  virtual_status: string | null;
  state?: string;
  priority: string | null;
  progress: number;
  leadName: string | null;
  leadEmail: string | null;
  ownerEmail?: string | null;
  members: { email: string; name?: string }[];
  teams: { name: string; key?: string }[];
  totalIssues: number;
  completedIssues: number;
  startDate: string | null;
  targetDate: string | null;
  updatedAt: string | null;
  updatedBy?: string | null;
  url: string | null;
  phase?: string | null;
  category?: string | null;
  tags?: string[];
}

// ─── Loop status → progress % ─────────────────────────────────────────────
const LOOP_STATUS_PROGRESS: Record<string, number> = {
  BACKLOG: 0,
  IN_PROGRESS: 50,
  IN_QA_REVIEW: 75,
  COMPLETED: 100,
  DELAY_INCOMPLETED: 0,
};

// ─── Status normalisation ─────────────────────────────────────────────────
const LOOP_STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  IN_PROGRESS: "In Progress",
  IN_QA_REVIEW: "In QA Review",
  COMPLETED: "Completed",
  DELAY_INCOMPLETED: "Delay & Incompleted",
};

const PROJECT_STATUS_PROGRESS: Record<string, number> = {
  Backlog: 0,
  Planned: 25,
  "In Progress": 50,
  "In QA Review": 75,
  Completed: 100,
  Canceled: 0,
};

export function normalizeStatus(
  raw: string,
  entity: "PROJECT" | "LOOP",
): string {
  if (!raw) return "-";
  return entity === "LOOP" ? (LOOP_STATUS_LABEL[raw] ?? raw) : raw;
}

function normalizePriority(
  raw: any,
  entity: "PROJECT" | "LOOP",
): string | null {
  if (raw === null || raw === undefined || raw === "" || raw === "N/A") {
    return null;
  }
  const n = Number(raw);
  if (isNaN(n)) return String(raw);

  if (entity === "LOOP") {
    const map: Record<number, string> = {
      1: "Critical",
      2: "High",
      3: "Medium",
      4: "Low",
      5: "Minimal",
    };
    return map[n] ?? String(raw);
  } else {
    const map: Record<number, string> = {
      1: "Critical",
      2: "High",
      3: "Medium",
      4: "Low",
      0: "Minimal",
    };
    return map[n] ?? String(raw);
  }
}

// ─── Progress bucket ──────────────────────────────────────────────────────
function progressBucket(pct: number): string {
  if (pct === 0) return "0%";
  if (pct <= 50) return "1-50%";
  if (pct <= 99) return "51-99%";
  return "100%";
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function getEmailFromEvent(event: any): string | undefined {
  return (
    event.requestContext?.authorizer?.email ||
    event.requestContext?.authorizer?.claims?.email
  );
}

async function scanAll(tableName: string): Promise<any[]> {
  const items: any[] = [];
  let lastKey: any;
  do {
    const res = await ddbClient.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey }),
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ─── Transformers ─────────────────────────────────────────────────────────
function projectToUnified(p: any): UnifiedDeliveryItem {
  const status_name: string = (p.virtual_status || p.status_name) ?? "";
  const progress =
    PROJECT_STATUS_PROGRESS[status_name] ??
    (status_name === "COMPLETE" ? 100 : 0);
  const leadEmail = p.lead_email ?? null;
  return {
    id: `proj_${p.id}`,
    entity: "PROJECT",
    name: p.name ?? "",
    status_name,
    virtual_status: p.virtual_status,
    state: status_name,
    priority: normalizePriority(p.priority, "PROJECT"),
    progress,
    leadName: p.lead_name ?? p.lead?.name ?? null,
    leadEmail,
    ownerEmail: leadEmail,
    members: (p.members ?? []).map((m: any) => ({
      email: m.email,
      name: m.name,
    })),
    teams: (p.teams ?? []).map((t: any) => ({ name: t.name, key: t.key })),
    totalIssues: p.total_issues ?? 0,
    completedIssues: p.issues_completed ?? 0,
    startDate: p.start_date ?? null,
    targetDate: p.target_date ?? null,
    updatedAt: p.updated_at ?? null,
    updatedBy: p.updated_by ?? p.updatedBy ?? null,
    url: p.url ?? null,
  };
}

function loopToUnified(l: any): UnifiedDeliveryItem {
  const status: string = l.status ?? "";
  const progress =
    LOOP_STATUS_PROGRESS[status] ?? (status === "COMPLETE" ? 100 : 0);
  const status_name = normalizeStatus(l.status ?? "", "LOOP");
  const ownerEmail = l.owner_email ?? null;

  return {
    id: `loop_${l.loop_id}`,
    entity: "LOOP",
    name: l.title ?? "",
    status_name,
    virtual_status: null,
    state: status_name,
    priority: normalizePriority(l.priority, "LOOP"),
    progress,
    leadName: l.owner_name ?? l.owner_email ?? null,
    leadEmail: ownerEmail,
    ownerEmail,
    members: (l.contributors ?? []).map((c: any) =>
      typeof c === "string" ? { email: c } : { email: c.email, name: c.name },
    ),
    teams: [],
    totalIssues: 0,
    completedIssues: 0,
    startDate: l.created_at ?? null,
    targetDate: l.target_completion_date ?? null,
    updatedAt: l.updated_at ?? null,
    updatedBy: l.updated_by ?? l.updatedBy ?? null,
    url: null,
    phase: l.phase ?? null,
    category: l.category ?? null,
    tags: Array.isArray(l.tags) ? l.tags : [],
  };
}

// ─── Cursor helpers ───────────────────────────────────────────────────────
function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64");
}

function decodeCursor(cursor: string): number {
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    return payload.offset ?? 0;
  } catch {
    return 0;
  }
}

// ─── Helper: apply common project filters (used in two places) ────────────
// Used to build projectsForTeamDropdown after all filters except team filter
function applyCommonProjectFilters(
  projects: any[],
  opts: {
    statusFilter: string;
    priorityFilter: string;
    ownerFilter: string;
    progressFilter: string;
    targetDateFilter: string;
  },
): any[] {
  let result = [...projects];

  if (opts.statusFilter) {
    const q = opts.statusFilter.toLowerCase().replace(/_/g, " ");
    result = result.filter(
      (p) => (p.status_name ?? "").toLowerCase().replace(/_/g, " ") === q,
    );
  }

  if (opts.priorityFilter) {
    result = result.filter((p) => {
      const pVal = normalizePriority(p.priority, "PROJECT");
      if (opts.priorityFilter === "Minimal")
        return pVal === "Minimal" || pVal === null;
      return pVal === opts.priorityFilter;
    });
  }

  if (opts.ownerFilter) {
    const q = opts.ownerFilter.toLowerCase();
    result = result.filter(
      (p) =>
        p.lead_email?.toLowerCase().includes(q) ||
        p.lead_name?.toLowerCase().includes(q),
    );
  }

  if (opts.progressFilter) {
    result = result.filter((p) => {
      const pct =
        PROJECT_STATUS_PROGRESS[p.status_name ?? ""] ??
        (p.status_name === "COMPLETE" ? 100 : 0);
      return progressBucket(pct) === opts.progressFilter;
    });
  }

  if (opts.targetDateFilter) {
    result = result.filter(
      (p) => p.target_date?.split("T")[0] === opts.targetDateFilter,
    );
  }

  return result;
}

// ─── Handler ──────────────────────────────────────────────────────────────
const _listDelivery: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const qs = event.queryStringParameters ?? {};

    const callerEmail =
      getEmailFromEvent(event) ||
      (qs.callerEmail ? String(qs.callerEmail) : undefined);

    const tab = qs.tab ?? "my";
    const typeFilter = qs.type ?? qs.typeFilter ?? "all";
    const scope = qs.scope ?? "all";

    const pageSize = qs.limit ? Number(qs.limit) : 20;
    if (Number.isNaN(pageSize) || pageSize <= 0)
      return err("Invalid limit", 400);
    const cursor = qs.cursor;

    // ── Common filters ────────────────────────────────────────────────
    const statusFilter = qs.status ?? "";
    const priorityFilter = qs.priority ?? "";
    const ownerFilter = qs.owner ?? "";
    const progressFilter = qs.progress ?? "";
    const targetDateFilter = qs.targetDate ?? "";

    // ── Project-only filters ──────────────────────────────────────────
    const projectTeam = qs.projectTeam ?? qs.team ?? "";
    const issueCompletionFilter = qs.issueCompletion ?? "";

    // ── Loop-only filters ─────────────────────────────────────────────
    const loopPhase = qs.loopPhase ?? "";
    const loopCategory = qs.loopCategory ?? "";
    const loopTag = qs.loopTag ?? "";

    // ── Fetch raw data ────────────────────────────────────────────────
    const [rawProjects, rawLoops] = await Promise.all([
      typeFilter !== "loops"
        ? scanAll(linearDeliveryTable)
        : Promise.resolve([]),
      typeFilter !== "projects" && !projectTeam
        ? scanAll(loopsTable)
        : Promise.resolve([]),
    ]);

    const projectsOnly = rawProjects.filter(
      (p) => !p.entity_type || p.entity_type === "PROJECT",
    );

    // ── Ownership filter ──────────────────────────────────────────────
    const applyProjectOwnership = (projects: any[]) => {
      if (tab === "all") return projects;
      if (!callerEmail) return [];
      return projects.filter(
        (p) =>
          p.lead_email === callerEmail ||
          p.creator_email === callerEmail ||
          (Array.isArray(p.members) &&
            p.members.some((m: any) => m.email === callerEmail)),
      );
    };

    const applyLoopOwnership = (loops: any[]) => {
      if (tab === "all") return loops;
      if (!callerEmail) return [];
      return loops.filter((l) => l.owner_email === callerEmail);
    };

    let filteredProjects = applyProjectOwnership(projectsOnly);
    let filteredLoops = applyLoopOwnership(rawLoops);

    // ── Scope-based filtering (Engineering Dashboard) ─────────────────
    // Internal team key in Linear
    const INTERNAL_TEAM_KEY = "GINT";
    // Internal loop categories (all INT:* prefixed)
    const INTERNAL_LOOP_CATEGORIES = new Set([
      "INT:PRODUCT",
      "INT:AUTO",
      "INT:INFRA",
      "INT:DOCS",
    ]);
    // Customer loop categories
    const CUSTOMER_LOOP_CATEGORIES = new Set(["BD", "GTM"]);
    // All categories relevant to Engineering Dashboard
    const ENGINEERING_LOOP_CATEGORIES = new Set([
      ...INTERNAL_LOOP_CATEGORIES,
      ...CUSTOMER_LOOP_CATEGORIES,
    ]);

    if (scope === "internal") {
      // Projects: only from enterprise-Internal-Projects team (key: GINT)
      filteredProjects = filteredProjects.filter(
        (p) =>
          Array.isArray(p.teams) &&
          p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
      );
      // Loops: only INT:* categories
      filteredLoops = filteredLoops.filter((l) =>
        INTERNAL_LOOP_CATEGORIES.has(l.category),
      );
    } else if (scope === "customer") {
      // Projects: everything NOT in GINT team
      filteredProjects = filteredProjects.filter(
        (p) =>
          !Array.isArray(p.teams) ||
          !p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
      );
      // Loops: only BD and GTM categories
      filteredLoops = filteredLoops.filter((l) =>
        CUSTOMER_LOOP_CATEGORIES.has(l.category),
      );
    } else if (scope === "all") {
      // "all" on Engineering Dashboard: show all projects but
      // only INT:* and BD/GTM loops (no ENG, MSP, OPS:*, etc.)
      filteredLoops = filteredLoops.filter((l) =>
        ENGINEERING_LOOP_CATEGORIES.has(l.category),
      );
    }

    // ── Internal / External counts (after ownership + scope, before other filters) ──
    // These reflect the scope the user is viewing, not affected by other filters
    const rawInternalProjects = filteredProjects.filter(
      (p) =>
        Array.isArray(p.teams) &&
        p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
    ).length;

    const rawExternalProjects = filteredProjects.filter(
      (p) =>
        !Array.isArray(p.teams) ||
        !p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
    ).length;

    const rawInternalLoops = filteredLoops.filter((l) =>
      INTERNAL_LOOP_CATEGORIES.has(l.category),
    ).length;

    const rawExternalLoops = filteredLoops.filter((l) =>
      CUSTOMER_LOOP_CATEGORIES.has(l.category),
    ).length;

    // ── Apply team filter only to filteredProjects ────────────────────
    // When a team is selected, loops are excluded because they carry no team info
    if (projectTeam) {
      filteredProjects = filteredProjects.filter(
        (p) =>
          Array.isArray(p.teams) &&
          p.teams.some(
            (t: any) =>
              t.key?.toLowerCase() === projectTeam.toLowerCase() ||
              t.name?.toLowerCase() === projectTeam.toLowerCase(),
          ),
      );
      // Loops have no team membership — exclude them when filtering by team
      filteredLoops = [];
    }

    // ── Loop-only attribute filters ───────────────────────────────────
    if (loopPhase)
      filteredLoops = filteredLoops.filter((l) => l.phase === loopPhase);
    if (loopCategory)
      filteredLoops = filteredLoops.filter((l) => l.category === loopCategory);
    if (loopTag)
      filteredLoops = filteredLoops.filter(
        (l) => Array.isArray(l.tags) && l.tags.includes(loopTag),
      );

    // ── Transform ─────────────────────────────────────────────────────
    let unified: UnifiedDeliveryItem[] = [
      ...filteredProjects.map(projectToUnified),
      ...filteredLoops.map(loopToUnified),
    ];

    // ── Common filters (applied after transform so we use normalized values) ──

    if (statusFilter) {
      const normalizedQuery = statusFilter.toLowerCase().replace(/_/g, " ");
      unified = unified.filter(
        (i) =>
          i.status_name.toLowerCase().replace(/_/g, " ") === normalizedQuery,
      );
    }

    if (priorityFilter) {
      unified = unified.filter((i) => {
        if (priorityFilter === "Minimal")
          return i.priority === "Minimal" || i.priority === null;
        return i.priority === priorityFilter;
      });
    }

    if (ownerFilter) {
      const q = ownerFilter.toLowerCase();
      unified = unified.filter(
        (i) =>
          i.leadEmail?.toLowerCase().includes(q) ||
          i.leadName?.toLowerCase().includes(q),
      );
    }

    if (progressFilter) {
      unified = unified.filter(
        (i) => progressBucket(i.progress) === progressFilter,
      );
    }

    if (targetDateFilter) {
      unified = unified.filter(
        (i) => i.targetDate?.split("T")[0] === targetDateFilter,
      );
    }

    // Issue completion — projects only
    if (issueCompletionFilter) {
      unified = unified.filter((i) => {
        if (i.entity !== "PROJECT") return true;
        const pct =
          i.totalIssues > 0
            ? Math.round((i.completedIssues / i.totalIssues) * 100)
            : 0;
        return progressBucket(pct) === issueCompletionFilter;
      });
    }

    const totalCount = unified.length;

    // ── Sort by priority (highest first) ──────────────────────────────
    const PRIORITY_RANK: Record<string, number> = {
      Critical: 1,
      High: 2,
      Medium: 3,
      Low: 4,
      Minimal: 5,
    };

    unified.sort((a, b) => {
      const rankA = a.priority ? (PRIORITY_RANK[a.priority] ?? 6) : 6;
      const rankB = b.priority ? (PRIORITY_RANK[b.priority] ?? 6) : 6;
      return rankA - rankB;
    });

    // ── Paginate ──────────────────────────────────────────────────────
    const offset = cursor ? decodeCursor(cursor) : 0;
    const page = unified.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    const hasMore = nextOffset < totalCount;

    const summaryProjectCount = unified.filter(
      (i) => i.entity === "PROJECT",
    ).length;
    const summaryLoopCount = unified.filter((i) => i.entity === "LOOP").length;

    // ── Build allScopedProjects for team dropdown ──────────────────────
    // Only ownership + scope are applied — NO other filters (priority, status,
    // owner, etc.) so the team dropdown always shows every available team.
    const baseProjectsForTeam = applyProjectOwnership(projectsOnly);
    let scopedProjectsForTeam = [...baseProjectsForTeam];

    if (scope === "internal") {
      scopedProjectsForTeam = scopedProjectsForTeam.filter(
        (p) =>
          Array.isArray(p.teams) &&
          p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
      );
    } else if (scope === "customer") {
      scopedProjectsForTeam = scopedProjectsForTeam.filter(
        (p) =>
          !Array.isArray(p.teams) ||
          !p.teams.some((t: any) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
      );
    }

    // Stable team dropdown: use all projects in scope without secondary filters
    const projectsForTeamDropdown = scopedProjectsForTeam;

    // ── Internal / External counts (Filtered results) ──
    const summaryInternalProjects = unified.filter(
      (i) =>
        i.entity === "PROJECT" &&
        i.teams.some((t) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
    ).length;

    const summaryExternalProjects = unified.filter(
      (i) =>
        i.entity === "PROJECT" &&
        !i.teams.some((t) => t.key?.toUpperCase() === INTERNAL_TEAM_KEY),
    ).length;

    const summaryInternalLoops = unified.filter(
      (i) => i.entity === "LOOP" && INTERNAL_LOOP_CATEGORIES.has(i.category!),
    ).length;

    const summaryExternalLoops = unified.filter(
      (i) => i.entity === "LOOP" && CUSTOMER_LOOP_CATEGORIES.has(i.category!),
    ).length;

    const summary = buildSummary(
      unified,
      summaryProjectCount,
      summaryLoopCount,
      projectsForTeamDropdown,
      {
        internalProjects: summaryInternalProjects,
        externalProjects: summaryExternalProjects,
        internalLoops: summaryInternalLoops,
        externalLoops: summaryExternalLoops,
      },
    );

    return ok({
      tab,
      data: page,
      summary,
      pagination: {
        pageSize,
        offset,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasMore,
        nextCursor: hasMore ? encodeCursor(nextOffset) : null,
      },
    });
  } catch (e: any) {
    console.error(e);
    return err(e.message || "Internal error");
  }
};
export const listDelivery = withPermissions(_listDelivery);

// ─── Team name formatter ──────────────────────────────────────────────────
// Converts raw names like "costomer_team" → "Costomer Team"
// and "enterprise-CSP" → "Enterprise-Csp" by replacing underscores with spaces
// and title-casing each whitespace-separated word.
function formatTeamName(raw: string): string {
  return raw
    .replace(/[_-]/g, " ") // replace _ OR - with space
    .split(" ")
    .map((word) =>
      word.length === 0
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

// ─── Summary ──────────────────────────────────────────────────────────────
function buildSummary(
  items: UnifiedDeliveryItem[],
  projectCount: number,
  loopCount: number,
  projectsForTeamDropdown: any[],
  scopeCounts: {
    internalProjects: number;
    externalProjects: number;
    internalLoops: number;
    externalLoops: number;
  },
) {
  const by_status_name: Record<string, number> = {};
  let totalIssues = 0;
  let totalCompleted = 0;

  for (const item of items) {
    by_status_name[item.status_name] =
      (by_status_name[item.status_name] || 0) + 1;
    totalIssues += item.totalIssues;
    totalCompleted += item.completedIssues;
  }

  // ── Build available_teams from context-aware filtered projects ────────
  // Reflects My/All tab + all active filters, but NOT the team filter itself
  // so the dropdown never collapses when a team is selected.
  const teamMap = new Map<string, { key: string; name: string }>();
  for (const p of projectsForTeamDropdown) {
    (p.teams ?? []).forEach((t: any) => {
      if (t.name) {
        const key = (t.key ?? t.name).toLowerCase();
        if (!teamMap.has(key))
          teamMap.set(key, { key, name: formatTeamName(t.name) });
      }
    });
  }

  const available_teams = Array.from(teamMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const available_status_names = Object.entries(by_status_name)
    .map(([status_name, count]) => ({ status_name, count }))
    .sort((a, b) => a.status_name.localeCompare(b.status_name));

  return {
    total: items.length,
    projectCount,
    loopCount,
    // ── Internal / External breakdown ────────────────────────────────
    internalProjects: scopeCounts.internalProjects,
    externalProjects: scopeCounts.externalProjects,
    internalLoops: scopeCounts.internalLoops,
    externalLoops: scopeCounts.externalLoops,
    internalCount: scopeCounts.internalProjects + scopeCounts.internalLoops,
    externalCount: scopeCounts.externalProjects + scopeCounts.externalLoops,
    // ── Team dropdown ─────────────────────────────────────────────────
    teamCount: available_teams.length,
    available_teams,
    by_status_name,
    by_state: by_status_name,
    available_status_names,
    totalIssues,
    totalCompleted,
    overallProgress:
      items.length > 0
        ? Math.round(
          items.reduce((sum, i) => sum + (i.progress || 0), 0) / items.length,
        )
        : 0,
  };
}

// ─── getProjectById ───────────────────────────────────────────────────────

interface ProjectIssue {
  id: string;
  title: string;
  state_name: string;
  state_type: string;
  priority: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  labels: string[];
  due_date: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  estimate: number | null;
}

interface ProjectMember {
  id: string;
  name: string;
  email: string;
  displayName: string;
}

interface ProjectTeam {
  id: string;
  name: string;
  key: string;
}

// ─── Comment on a project update ──────────────────────────────────────────
interface UpdateComment {
  id: string;
  body: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

// ─── Project update entry (with nested comments) ──────────────────────────
interface ProjectUpdate {
  id: string;
  health: string;
  body: string; // the update text (was "note" / "content" — fixed)
  user_name: string | null;
  user_email: string | null;
  created_at: string;
  comments: UpdateComment[]; // ← NEW: nested comments array
}

interface ProjectDetail {
  id: string;
  prefixedId: string;
  name: string;
  description: string | null;
  content: string | null;
  url: string | null;
  status_name: string;
  virtual_status: string | null;
  priority: string | null;
  progress: number | null;
  scope: number;
  lead: { id: string | null; name: string | null; email: string | null };
  creator: { id: string | null; name: string | null; email: string | null };
  members: ProjectMember[];
  teams: ProjectTeam[];
  totalIssues: number;
  completedIssues: number;
  canceledIssues: number;
  issues: ProjectIssue[];
  startDate: string | null;
  targetDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  syncedAt: string | null;
  labels: string[];
  project_updates: ProjectUpdate[];
}

function normalizeNAString(value: any): string | null {
  if (!value || value === "N/A") return null;
  return String(value);
}

function formatIssue(raw: any): ProjectIssue {
  return {
    id: raw.id ?? "",
    title: raw.title ?? "",
    state_name: raw.state_name ?? "",
    state_type: raw.state_type ?? "",
    priority: normalizePriority(raw.priority, "PROJECT"),
    assignee_name: normalizeNAString(raw.assignee_name),
    assignee_email: normalizeNAString(raw.assignee_email),
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    due_date: normalizeNAString(raw.due_date),
    completed_at: normalizeNAString(raw.completed_at),
    canceled_at: normalizeNAString(raw.canceled_at),
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
    estimate: raw.estimate ?? null,
  };
}

// ─── Map a single comment from DDB ───────────────────────────────────────
function formatComment(c: any): UpdateComment {
  return {
    id: c.id ?? "",
    body: c.body ?? "",
    created_at: c.created_at ?? null,
    user_name: normalizeNAString(c.user_name),
    user_email: normalizeNAString(c.user_email),
  };
}

// ─── Map a single project_update from DDB (now includes comments) ─────────
function formatProjectUpdate(u: any): ProjectUpdate {
  return {
    id: u.id ?? "",
    health: u.health ?? "",
    // DDB stores body as "body" — was previously mapped as "note" which caused
    // the frontend to show empty text. Mapping it as "body" here fixes that.
    body: u.body ?? u.note_body ?? u.text ?? "",
    user_name: normalizeNAString(u.user_name),
    user_email: normalizeNAString(u.user_email),
    created_at: u.created_at ?? null,
    // Map every comment stored in DDB for this update
    comments: Array.isArray(u.comments) ? u.comments.map(formatComment) : [],
  };
}

// ─── Map the full project DDB item to ProjectDetail ───────────────────────
function formatProject(p: any): ProjectDetail {
  const priority = normalizePriority(p.priority, "PROJECT");
  const status_name = (p.virtual_status || p.status_name) ?? "";
  const progress =
    PROJECT_STATUS_PROGRESS[status_name] ??
    (status_name === "COMPLETE" ? 100 : 0);
  return {
    id: p.id ?? "",
    prefixedId: `proj_${p.id ?? ""}`,
    name: p.name ?? "",
    description: normalizeNAString(p.description),
    content: normalizeNAString(p.content),
    url: normalizeNAString(p.url),
    status_name: p.status_name ?? "",
    virtual_status: p.virtual_status ?? null,
    priority,
    progress,
    scope: p.scope ?? 0,
    lead: {
      id: normalizeNAString(p.lead_id),
      name: normalizeNAString(p.lead_name),
      email: normalizeNAString(p.lead_email),
    },
    creator: {
      id: normalizeNAString(p.creator_id),
      name: normalizeNAString(p.creator_name),
      email: normalizeNAString(p.creator_email),
    },
    members: (p.members ?? []).map(
      (m: any): ProjectMember => ({
        id: m.id ?? "",
        name: m.name ?? "",
        email: m.email ?? "",
        displayName: m.displayName ?? m.name ?? "",
      }),
    ),
    teams: (p.teams ?? []).map(
      (t: any): ProjectTeam => ({
        id: t.id ?? "",
        name: t.name ?? "",
        key: t.key ?? "",
      }),
    ),
    totalIssues: p.total_issues ?? 0,
    completedIssues: p.issues_completed ?? 0,
    canceledIssues: p.issues_canceled ?? 0,
    issues: Array.isArray(p.issues) ? p.issues.map(formatIssue) : [],
    startDate: normalizeNAString(p.start_date),
    targetDate: normalizeNAString(p.target_date),
    createdAt: p.created_at ?? null,
    updatedAt: p.updated_at ?? null,
    updatedBy: p.updated_by ?? null,
    syncedAt: p.synced_at ?? null,
    labels: Array.isArray(p.labels) ? p.labels : [],
    project_updates: Array.isArray(p.project_updates)
      ? p.project_updates.map(formatProjectUpdate)
      : [],
  };
}

const _getProjectById: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawId = event.pathParameters?.id ?? "";
    if (!rawId) return err("Missing path parameter: id", 400);

    const projectId = rawId.startsWith("proj_")
      ? rawId.slice("proj_".length)
      : rawId;

    const result = await ddbClient.send(
      new QueryCommand({
        TableName: linearDeliveryTable,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: { ":id": projectId },
        Limit: 1,
      }),
    );

    if (!result.Items?.length)
      return err(`Project not found: ${projectId}`, 404);

    const item = result.Items[0];
    if (item.entity_type && item.entity_type !== "PROJECT")
      return err(`Item ${projectId} is not a project`, 400);

    return ok({ project: formatProject(item) });
  } catch (e: any) {
    console.error("[getProjectById] error:", e);
    return err(e.message || "Internal error");
  }
};
export const getProjectById = withPermissions(_getProjectById);
