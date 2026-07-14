import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import {
  deriveHealth,
  getPhaseLabel,
  mapStageToPhase,
} from "../shared/deal-phases";
import {
  type CompanyInfo,
  type ContactInfo,
  type DealsPageFormatContext,
  formatDealsListPage,
} from "../hubspot/formatters";

const logger = createLogger("GetPersonByEmailWithLoops");
const ddb = ddbClient;

const PEOPLE_TABLE = process.env.DEEL_PEOPLE_TABLE_NAME;
const LOOPS_TABLE = process.env.LOOPS_TABLE_NAME;
const PERSON_INFO_TABLE = process.env.PERSON_INFORMATION_TABLE_NAME;
const DEALS_TABLE = process.env.DEALS_TABLE_NAME;
const COMPANIES_TABLE = process.env.COMPANIES_TABLE_NAME;
const CONTACTS_TABLE = process.env.CONTACTS_TABLE_NAME;
const LINEAR_DELIVERY_TABLE = process.env.LINEAR_DELIVERY_TABLE_NAME;

/* ------------------ helpers ------------------ */

const getEmailFromEvent = (event: any) => {
  const queryEmail = event.queryStringParameters?.email;
  if (queryEmail) return queryEmail;
  const claims =
    event.requestContext?.authorizer?.claims ||
    event.requestContext?.authorizer?.jwt?.claims;
  return claims?.email || claims?.["cognito:username"] || null;
};

const fullName = (p: { firstname?: string; lastname?: string } = {}) =>
  [p.firstname, p.lastname].filter(Boolean).join(" ");

const scanAll = async (params: any) => {
  let items: any[] = [];
  let lastKey: any;
  do {
    const res = await ddb.send(
      new ScanCommand({ ...params, ExclusiveStartKey: lastKey }),
    );
    if (res.Items) items.push(...res.Items);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
};

const scanOne = async (table: string, keyName: string, keyValue: string) => {
  const res = await ddb.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: `${keyName} = :v`,
      ExpressionAttributeValues: { ":v": keyValue },
    }),
  );
  return res.Items?.[0];
};

/* ------------------ loops ------------------ */

const getAllPersonLoops = async (email: string) => {
  return scanAll({
    TableName: LOOPS_TABLE,
    FilterExpression: "owner_email = :email",
    ExpressionAttributeValues: { ":email": email },
  });
};

const getPersonLoopsByEmail = async (
  email: string,
  limit: number,
  nextCursor?: any,
) => {
  let items: any[] = [];
  let lastKey = nextCursor;
  const fetchLimit = limit + 1;
  do {
    const remaining = fetchLimit - items.length;
    const res = await ddb.send(
      new ScanCommand({
        TableName: LOOPS_TABLE,
        Limit: remaining,
        ExclusiveStartKey: lastKey,
        FilterExpression: "owner_email = :email",
        ExpressionAttributeValues: { ":email": email },
      }),
    );
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
    if (items.length >= fetchLimit || !lastKey) break;
  } while (true);

  const hasMore = items.length > limit;
  const paginated = items.slice(0, limit);
  const newCursor =
    hasMore && paginated.length > 0
      ? { loop_id: paginated[paginated.length - 1].loop_id }
      : null;
  return { items: paginated, nextCursor: newCursor, hasMore };
};

/* ------------------ scoring ------------------ */

const calculateLoopScore = (loop: any): number | null => {
  if (loop.effort_score != null && loop.outcome_score != null) {
    return Number(loop.effort_score) * Number(loop.outcome_score);
  }
  return null;
};

const calculateVelocityByEmail = async (email: string, windowDays = 90) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays);
    const rawLoops = await getAllPersonLoops(email);
    let totalWeightedScore = 0;
    let totalCreditShare = 0;
    for (const loop of rawLoops) {
      const score = loop.loop_score ?? calculateLoopScore(loop);
      if (
        loop.status === "COMPLETED" &&
        loop.target_completion_date &&
        new Date(loop.target_completion_date) >= cutoffDate &&
        score != null
      ) {
        totalWeightedScore += score;
        totalCreditShare += 1;
      }
    }
    return totalCreditShare > 0 ? totalWeightedScore / totalCreditShare : 0;
  } catch (error: any) {
    console.error("Error calculating velocity:", error);
    return 0;
  }
};

/* ------------------ opportunities (listDeals format) ------------------ */

/**
 * Fetches deals owned by `email` and returns them in the exact same
 * shape as the listDeals opp=my response:
 * { deals, pipeline, total_deals, total_pipeline_value,
 *   total_active_deals, health_distribution, pageSize,
 *   totalPages, hasMore, nextCursor }
 */
const getDealsForEmail = async (
  email: string,
  pageSize: number,
  cursorIndex: number,
  stageFilter?: string,
) => {
  /* ---- scan all deals ---- */
  const allDeals = await scanAll({ TableName: DEALS_TABLE });

  /* ---- collect company + contact ids ---- */
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  allDeals.forEach((d) => {
    d.companyIds?.forEach((id: string) => companyIds.add(id));
    d.contactIds?.forEach((id: string) => contactIds.add(id));
  });

  /* ---- build company map + contact map in parallel ---- */
  const companyMap = new Map<string, CompanyInfo>();
  const contactMap = new Map<string, ContactInfo>();

  await Promise.all([
    /* companies */
    ...Array.from(companyIds).map(async (id) => {
      const company = await scanOne(COMPANIES_TABLE!, "companyId", id);
      if (company) {
        companyMap.set(id, {
          name: company.name ?? "",
          ownerEmail: company.ownerEmail ?? company.owner_email ?? "",
        });
      }
    }),
    /* contacts */
    ...Array.from(contactIds).map(async (id) => {
      const contact = await scanOne(CONTACTS_TABLE!, "contactId", id);
      if (contact) {
        contactMap.set(id, {
          fullName: fullName(contact),
          firstName: contact.firstname ?? "",
          lastName: contact.lastname ?? "",
          email: contact.email ?? "",
        });
      }
    }),
  ]);

  /* ---- filter by owner email (opp=my) ---- */
  const ownershipFiltered = allDeals.filter(
    (d) =>
      typeof d.ownerEmail === "string" &&
      d.ownerEmail.toLowerCase() === email.toLowerCase(),
  );

  let filteredDeals = [...ownershipFiltered];

  /* ---- paginate ---- */
  const pageDeals = filteredDeals.slice(cursorIndex, cursorIndex + pageSize);
  const nextIndex = cursorIndex + pageSize;
  const hasMore = nextIndex < filteredDeals.length;
  const nextCursor = hasMore
    ? Buffer.from(String(nextIndex)).toString("base64")
    : null;

  /* ---- format page ---- */
  const ctx: DealsPageFormatContext = { companyMap, contactMap };
  const formatted = formatDealsListPage({ results: pageDeals } as any, ctx);

  const enrichedDeals = (formatted.deals || []).map((d: any) => {
    const amount = Number(d.amount || 0);
    const phase = mapStageToPhase(d.stage_name);
    const health_status = deriveHealth(d.stage_name, amount);
    return { ...d, phase, phase_label: getPhaseLabel(phase), health_status };
  });

  return {
    deals: enrichedDeals,
    pageSize,
    totalPages: Math.ceil(filteredDeals.length / pageSize),
    hasMore,
    nextCursor,
  };
};

/* ------------------ projects ------------------ */

const PROJECT_STATUS_PROGRESS: Record<string, number> = {
  Backlog: 0,
  Planned: 25,
  "In Progress": 50,
  Completed: 100,
  Canceled: 0,
};

function normalizePriority(raw: any): string | null {
  if (raw === null || raw === undefined || raw === "" || raw === "N/A")
    return null;
  const n = Number(raw);
  if (isNaN(n)) return String(raw);
  const map: Record<number, string> = {
    1: "Critical",
    2: "High",
    3: "Medium",
    4: "Low",
    0: "Minimal",
  };
  return map[n] ?? String(raw);
}

const getProjectsForEmail = async (email: string) => {
  if (!LINEAR_DELIVERY_TABLE) return [];

  const allItems = await scanAll({ TableName: LINEAR_DELIVERY_TABLE });

  // Keep only PROJECT entities
  const projects = allItems.filter(
    (p) => !p.entity_type || p.entity_type === "PROJECT",
  );

  // Filter: person is lead, creator, or member
  const lowerEmail = email.toLowerCase();
  const myProjects = projects.filter(
    (p) =>
      p.lead_email?.toLowerCase() === lowerEmail ||
      p.creator_email?.toLowerCase() === lowerEmail ||
      (Array.isArray(p.members) &&
        p.members.some((m: any) => m.email?.toLowerCase() === lowerEmail)),
  );

  // Transform to unified shape
  return myProjects.map((p: any) => {
    const status_name: string = p.status_name ?? "";
    const progress =
      PROJECT_STATUS_PROGRESS[status_name] ??
      (status_name === "COMPLETE" ? 100 : 0);
    return {
      id: `proj_${p.id}`,
      name: p.name ?? "",
      status_name,
      priority: normalizePriority(p.priority),
      progress,
      leadName: p.lead_name ?? p.lead?.name ?? null,
      leadEmail: p.lead_email ?? null,
      members: (p.members ?? []).map((m: any) => ({
        email: m.email,
        name: m.name,
      })),
      teams: (p.teams ?? []).map((t: any) => ({ name: t.name })),
      totalIssues: p.total_issues ?? 0,
      completedIssues: p.issues_completed ?? 0,
      startDate: p.start_date ?? null,
      targetDate: p.target_date ?? null,
      updatedAt: p.updated_at ?? null,
      url: p.url ?? null,
    };
  });
};

/* ------------------ handler ------------------ */

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (
      !PEOPLE_TABLE ||
      !LOOPS_TABLE ||
      !PERSON_INFO_TABLE ||
      !DEALS_TABLE ||
      !COMPANIES_TABLE
    ) {
      logger.error("Missing environment variables");
      return err("Missing environment variables", 500);
    }

    const email = getEmailFromEvent(event);
    const tab =
      (event.queryStringParameters?.tab as
        | "loops"
        | "opportunities"
        | "projects") || "loops";
    const limit = Number(event.queryStringParameters?.limit || 50);
    const page = Number(event.queryStringParameters?.page || 1);
    const stageFilter = event.queryStringParameters?.stage ?? "";

    // Cursor for loops tab
    const nextCursorRaw = event.queryStringParameters?.nextCursor;
    const nextCursor = nextCursorRaw
      ? JSON.parse(Buffer.from(nextCursorRaw, "base64").toString())
      : undefined;

    // Cursor for opportunities tab (index-based, same as listDeals)
    const oppCursorRaw = event.queryStringParameters?.cursor;
    const oppCursorIndex = oppCursorRaw
      ? Number(Buffer.from(oppCursorRaw, "base64").toString("utf8"))
      : 0;

    if (!email) return err("Email parameter is required", 400);

    logger.info("Fetching person data", { email, tab });

    /* ---------- resolve person ---------- */

    let person: any = null;
    let detailsSource:
      | "deel-people"
      | "person-information"
      | "loops-only"
      | "none" = "none";

    const peopleResult = await ddb.send(
      new ScanCommand({
        TableName: PEOPLE_TABLE,
        FilterExpression: "email = :email OR alternate_email = :email",
        ExpressionAttributeValues: { ":email": email },
      }),
    );

    if (peopleResult.Items && peopleResult.Items.length > 0) {
      person = peopleResult.Items[0];
      detailsSource = "deel-people";
    } else {
      const personInfoResult = await ddb.send(
        new GetCommand({ TableName: PERSON_INFO_TABLE, Key: { email } }),
      );
      if (personInfoResult.Item) {
        person = personInfoResult.Item;
        detailsSource = "person-information";
      }
    }

    if (!person) {
      const loopsForEmail = await getAllPersonLoops(email);
      if (loopsForEmail.length > 0) {
        person = { email };
        detailsSource = "loops-only";
      }
    }

    if (!person) {
      person = { email };
      detailsSource = "none";
    }

    /* ---------- tab-specific data ---------- */

    let tabPayload: Record<string, any> = {};

    if (tab === "loops") {
      const {
        items: paginatedLoops,
        nextCursor: newCursor,
        hasMore,
      } = await getPersonLoopsByEmail(email, limit, nextCursor);

      const loops = paginatedLoops.map((l) => ({
        ...l,
        loop_score: l.loop_score ?? calculateLoopScore(l),
      }));

      const allLoops = await getAllPersonLoops(email);

      const active_loops = allLoops.filter(
        (l) => l.status === "BACKLOG" || l.status === "IN_PROGRESS",
      ).length;

      const completedWithScore = allLoops.filter(
        (l) =>
          l.status === "COMPLETED" &&
          (l.loop_score ?? calculateLoopScore(l)) != null,
      );

      const completed_loops = completedWithScore.length;
      const avg_score =
        completed_loops > 0
          ? completedWithScore.reduce(
              (s, l) => s + (l.loop_score ?? calculateLoopScore(l)),
              0,
            ) / completed_loops
          : 0;

      const velocity_score = (await calculateVelocityByEmail(email, 90)) || 0;
      const total = allLoops.length;
      const totalPages = Math.ceil(total / limit);

      tabPayload = {
        active_loops,
        completed_loops,
        avg_score,
        velocity_score,
        loops,
        page,
        pageSize: limit,
        total,
        totalPages,
        nextCursor: newCursor
          ? Buffer.from(JSON.stringify(newCursor)).toString("base64")
          : null,
        hasMore,
      };
    } else if (tab === "opportunities") {
      // Uses the exact same format as listDeals with opp=my
      tabPayload = await getDealsForEmail(
        email,
        limit,
        oppCursorIndex,
        stageFilter || undefined,
      );
    } else if (tab === "projects") {
      const projects = await getProjectsForEmail(email);
      tabPayload = { projects };
    }

    /* ---------- build response ---------- */

    const needsDetails =
      detailsSource === "none" || detailsSource === "loops-only";

    const response = {
      person_id: person.id || person.person_id,
      name:
        person.name ||
        `${person.given_name || ""} ${person.family_name || ""}`.trim(),
      given_name: person.given_name || "",
      family_name: person.family_name || "",
      email: person.email || email,
      alternate_email: person.alternate_email,
      job_title: person.job_title || person.title || "",
      department: person.department || {},
      title: person.title || person.job_title || "",
      direct_reports: Array.isArray(person.direct_reports)
        ? person.direct_reports
        : [],
      level: person.level || 0,
      employment_status:
        person.hiring_status ||
        person.new_hiring_status ||
        person.employment_status ||
        "active",
      addresses: Array.isArray(person.addresses) ? person.addresses : [],
      start_date: person.start_date || null,
      details_source: detailsSource,
      needs_details: needsDetails,
      tab,
      ...tabPayload,
    };

    logger.info("Person data fetched", { email, tab });
    return ok(response);
  } catch (error: any) {
    logger.error("Error fetching person data", { message: error.message });
    return err(error.message || "Internal server error", 500);
  }
};

export const handler = withPermissions(_handler);
