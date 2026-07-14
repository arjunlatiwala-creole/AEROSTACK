import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import {
  buildPipelineFromDeals,
  deriveHealth,
  mapStageToPhase,
} from "../shared/deal-phases";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";
import {
  computeOpenPipelineValue,
  computePipelineCoverageRatio,
  computeWinRatePct,
  deriveDefaultPeriodTarget,
  normalizeHealthDistribution,
  type RevOpsSummary,
  toCents,
} from "../revops/aggregations";
import {
  type CompanyInfo,
  type ContactInfo,
  type DealsPageFormatContext,
  formatDealsListPage,
  formatSingleDeal,
} from "./formatters";

/* ------------------------------------------------------------------ */
/* ENV                                                                  */
/* ------------------------------------------------------------------ */
const dealTable = process.env.DEALS_TABLE_NAME!;
const companyTable = process.env.COMPANIES_TABLE_NAME!;
const contactTable = process.env.CONTACTS_TABLE_NAME!;

/* ------------------------------------------------------------------ */
/* HELPERS                                                              */
/* ------------------------------------------------------------------ */
const fullName = (p: { firstname?: string; lastname?: string } = {}) =>
  [p.firstname, p.lastname].filter(Boolean).join(" ");

const getEmailFromEvent = (event: any): string | null => {
  const queryEmail = event.queryStringParameters?.email;
  if (queryEmail) return queryEmail;
  const claims =
    event.requestContext?.authorizer?.claims ||
    event.requestContext?.authorizer?.jwt?.claims;
  return claims?.email || claims?.["cognito:username"] || null;
};

async function scanOne(table: string, keyName: string, keyValue: string) {
  const res = await ddbClient.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: `${keyName} = :v`,
      ExpressionAttributeValues: { ":v": keyValue },
    }),
  );
  return res.Items?.[0];
}

/* ------------------------------------------------------------------ */
/* STAGE NORMALISATION                                                  */
/* Merges "closed-lost", "closed_lost", "Closed Lost" → "Closed Lost"  */
/* Same for "closed-won" variants → "Closed Won"                        */
/* ------------------------------------------------------------------ */
function normaliseStage(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim().toLowerCase().replace(/[-_]/g, " ");
  if (s === "closed lost") return "Closed Lost";
  if (s === "closed won") return "Closed Won";
  if (s === "launched") return "Invoicing";
  // Title-case everything else
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* PIPELINE MATCH                                                        */
/* ------------------------------------------------------------------ */
const normalisePipeline = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function matchesPipeline(deal: any, needle: string): boolean {
  const name = deal.pipelineName ?? deal.pipeline_name ?? "";
  const exact = name.toLowerCase().trim();
  const needleExact = needle.toLowerCase().trim();
  return (
    exact === needleExact ||
    normalisePipeline(name).includes(normalisePipeline(needle))
  );
}

/* ------------------------------------------------------------------ */
/* LIST DEALS                                                            */
/* ------------------------------------------------------------------ */
const _listDeals: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("listDeals");

  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const limitParam = event.queryStringParameters?.limit;
    const cursor = event.queryStringParameters?.cursor;
    const stageFilter = event.queryStringParameters?.stage ?? "";
    const phaseFilter = event.queryStringParameters?.phase ?? "";

    const closeDate = event.queryStringParameters?.closeDate ?? "";
    const oppFilter = event.queryStringParameters?.opp ?? "enterprise";
    // pipeline param — sent by frontend as the exact pipeline name string
    const pipelineFilter = (event.queryStringParameters?.pipeline ?? "").trim();
    const callerEmail = getEmailFromEvent(event);

    const pageSize = limitParam ? Number(limitParam) : 20;
    if (Number.isNaN(pageSize) || pageSize <= 0)
      return err("Invalid limit", 400);

    /* ── scan ALL deals ─────────────────────────────────────────── */
    const allDeals: any[] = [];
    let lastKey: any;
    do {
      const res = await ddbClient.send(
        new ScanCommand({ TableName: dealTable, ExclusiveStartKey: lastKey }),
      );
      allDeals.push(...(res.Items ?? []));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    /* ── collect company / contact ids ─────────────────────────── */
    const companyIds = new Set<string>();
    const contactIds = new Set<string>();
    allDeals.forEach((d) => {
      d.companyIds?.forEach((id: string) => companyIds.add(id));
      d.contactIds?.forEach((id: string) => contactIds.add(id));
    });

    const companyMap = new Map<string, CompanyInfo>();
    for (const id of companyIds) {
      const c = await scanOne(companyTable, "companyId", id);
      if (c)
        companyMap.set(id, {
          name: c.name ?? "",
          ownerEmail: c.ownerEmail ?? c.owner_email ?? "",
        });
    }

    const contactMap = new Map<string, ContactInfo>();
    for (const id of contactIds) {
      const c = await scanOne(contactTable, "contactId", id);
      if (c)
        contactMap.set(id, {
          fullName: fullName(c),
          firstName: c.firstname ?? "",
          lastName: c.lastname ?? "",
          email: c.email ?? "",
        });
    }

    /* ── ownership filter ───────────────────────────────────────── */
    const Enterprise_DOMAIN = "@enterprise.io";
    const ownershipFilteredDeals = allDeals.filter((d) => {
      if (oppFilter === "all") return true;
      if (oppFilter === "my")
        return callerEmail ? d.ownerEmail === callerEmail : false;
      // default: "enterprise"
      if (d.ownerEmail?.includes(Enterprise_DOMAIN)) return true;
      if (Array.isArray(d.contactIds)) {
        for (const id of d.contactIds) {
          if (contactMap.get(id)?.email?.includes(Enterprise_DOMAIN)) return true;
        }
      }
      return false;
    });

    /* ── pipeline_names dropdown (from all ownership-filtered deals) */
    const allPipelineNames = Array.from(
      new Set(
        ownershipFilteredDeals
          .map((d) => d.pipelineName ?? d.pipeline_name ?? "")
          .filter((n): n is string => typeof n === "string" && n.length > 0),
      ),
    ).sort();
    const stageCountMap = new Map<string, number>();
    for (const d of ownershipFilteredDeals) {
      const s = normaliseStage(d.dealstageName);
      if (s) stageCountMap.set(s, (stageCountMap.get(s) ?? 0) + 1);
    }
    const available_stages = Array.from(stageCountMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => a.stage.localeCompare(b.stage));

    const phaseCountMap = new Map<string, number>();

    for (const d of ownershipFilteredDeals) {
      const stage = normaliseStage(d.dealstageName);
      const phase = mapStageToPhase(stage);
      if (phase) {
        phaseCountMap.set(phase, (phaseCountMap.get(phase) ?? 0) + 1);
      }
    }

    const available_phases = Array.from(phaseCountMap.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => a.phase.localeCompare(b.phase));

    /* ── FILTER 1: pipeline ─────────────────────────────────────── */
    let filteredDeals = [...ownershipFilteredDeals];

    if (pipelineFilter) {
      filteredDeals = filteredDeals.filter((d) =>
        matchesPipeline(d, pipelineFilter),
      );
    }
    // /* ── FILTER 2: stage ────────────────────────────────────────── */
    // if (stageFilter) {
    //   const normTarget = normaliseStage(stageFilter);
    //   filteredDeals = filteredDeals.filter(
    //     (d) => normaliseStage(d.dealstageName) === normTarget,
    //   );
    // }

    // /* ── FILTER 2: phase ────────────────────────────────────────── */
    // if (phaseFilter) {
    //   filteredDeals = filteredDeals.filter((d) => {
    //     const stage = normaliseStage(d.dealstageName);
    //     const phase = mapStageToPhase(stage);
    //     return phase === phaseFilter;
    //   });
    // }
    /* ── FILTER: stage + phase (OR logic) ───────────────────────── */
    if (stageFilter || phaseFilter) {
      const normStageTarget = stageFilter ? normaliseStage(stageFilter) : null;

      filteredDeals = filteredDeals.filter((d) => {
        const stage = normaliseStage(d.dealstageName);
        const phase = mapStageToPhase(stage);

        const stageMatch = normStageTarget ? stage === normStageTarget : false;

        const phaseMatch = phaseFilter ? phase === phaseFilter : false;

        // 🔥 OR logic here
        return stageMatch || phaseMatch;
      });
    }

    /* ── FILTER 3: closedate ────────────────────────────────────── */
    if (closeDate) {
      filteredDeals = filteredDeals.filter((d) =>
        d.closedate ? String(d.closedate).startsWith(closeDate) : false,
      );
    }

    /* ── summary stats: computed from fully-filtered deals ──────── */
    let total_deals = 0;
    let total_pipeline_value = 0;
    const deals_by_phase: Record<string, number> = {};
    const health_distribution: Record<string, number> = {};

    for (const item of filteredDeals) {
      total_deals++;
      const amount = Number(item.amount ?? 0);
      total_pipeline_value += amount;
      const normStage = normaliseStage(item.dealstageName);
      const phase = mapStageToPhase(normStage);
      const health = deriveHealth(normStage, amount);
      deals_by_phase[phase] = (deals_by_phase[phase] || 0) + 1;
      health_distribution[health] = (health_distribution[health] || 0) + 1;
    }

    const total_active_deals =
      (deals_by_phase["ACTIVELY_FUNDING"] || 0) +
      (deals_by_phase["DEVELOPING"] || 0);

    /* ── paginate ───────────────────────────────────────────────── */
    const cursorIndex = cursor
      ? Number(Buffer.from(cursor, "base64").toString("utf8"))
      : 0;
    const pageDeals = filteredDeals.slice(cursorIndex, cursorIndex + pageSize);
    const nextIndex = cursorIndex + pageSize;
    const hasMore = nextIndex < filteredDeals.length;
    const nextCursor = hasMore
      ? Buffer.from(String(nextIndex)).toString("base64")
      : null;

    /* ── format + enrich page deals ────────────────────────────── */
    const ctx: DealsPageFormatContext = { companyMap, contactMap };
    const formatted = formatDealsListPage({ results: pageDeals } as any, ctx);

    const enrichedDeals = (formatted.deals || []).map((d: any) => {
      const amount = Number(d.amount || 0);
      // Normalise stage_name so "closed-lost" → "Closed Lost" everywhere
      const stage = normaliseStage(d.stage_name);
      const phase = mapStageToPhase(stage);
      const health_status = deriveHealth(stage, amount);
      return { ...d, stage, phase, health_status };
    });

    /* ── build pipeline from ALL filtered deals (for flow/cards) ── */
    const allFormatted = formatDealsListPage(
      { results: filteredDeals } as any,
      ctx,
    );
    const allEnriched = (allFormatted.deals || []).map((d: any) => {
      const amount = Number(d.amount || 0);
      const stage = normaliseStage(d.stage_name);
      const phase = mapStageToPhase(stage);
      const health_status = deriveHealth(stage, amount);
      return { ...d, stage, phase, health_status };
    });
    const { pipeline } = buildPipelineFromDeals(allEnriched);

    return ok({
      deals: enrichedDeals,
      pipeline,
      pipeline_names: allPipelineNames, // string[] for dropdown
      available_stages,
      available_phases,
      total_deals,
      total_pipeline_value,
      total_active_deals,
      deals_by_phase,
      health_distribution,
      pageSize,
      totalPages: Math.ceil(filteredDeals.length / pageSize),
      hasMore,
      nextCursor,
    });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};
export const listDeals = withPermissions(_listDeals);

/* ------------------------------------------------------------------ */
/* GET DEAL                                                             */
/* ------------------------------------------------------------------ */
const _getDeal: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("getDeal");

  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const dealId = event.pathParameters?.id;
    if (!dealId) return err("dealId required", 400);

    const deal = await scanOne(dealTable, "dealId", dealId);
    if (!deal) return err("Deal not found", 404);

    const companies: any[] = [];
    if (Array.isArray(deal.companyIds)) {
      for (const id of deal.companyIds) {
        const c = await scanOne(companyTable, "companyId", id);
        if (c) companies.push(c);
      }
    }

    const contacts: any[] = [];
    if (Array.isArray(deal.contactIds)) {
      for (const id of deal.contactIds) {
        const c = await scanOne(contactTable, "contactId", id);
        if (c) contacts.push(c);
      }
    }

    const base = formatSingleDeal(deal, { companies, contacts });

    const amount = Number(base.amount || 0);
    const stage = normaliseStage(base.stage_name);
    const phase = mapStageToPhase(stage);
    const health_status = deriveHealth(stage, amount);

    return ok({ ...base, stage, phase, health_status });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};
export const getDeal = withPermissions(_getDeal);

/* ------------------------------------------------------------------ */
/* GLOBAL SUMMARY                                                       */
/* Additively tracks value_by_phase so RevOps can compute open-pipeline */
/* and closed-deal values without a second scan. Count-based fields are */
/* unchanged.                                                           */
/* ------------------------------------------------------------------ */
export async function getGlobalSummary(tableName: string) {
  const logger = createLogger("getGlobalSummary");

  let lastKey: any;
  let total_deals = 0;
  let total_pipeline_value = 0;
  let active_deals = 0;
  const deals_by_phase: Record<string, number> = {};
  const value_by_phase: Record<string, number> = {};
  const health_distribution: Record<string, number> = {};

  do {
    const res = await ddbClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "dealstageName, amount",
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      total_deals++;
      const amount = Number(item.amount ?? 0);
      total_pipeline_value += amount;
      const stage = normaliseStage(item.dealstageName);
      const phase = mapStageToPhase(stage);
      const health = deriveHealth(stage, amount);
      deals_by_phase[phase] = (deals_by_phase[phase] || 0) + 1;
      value_by_phase[phase] = (value_by_phase[phase] || 0) + amount;
      health_distribution[health] = (health_distribution[health] || 0) + 1;
      if (phase === "ACTIVELY_FUNDING" || phase === "DEVELOPING")
        active_deals++;
    }

    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  logger.info(`Completed global summary scan. Total Deals: ${total_deals}`);
  return {
    total_deals,
    total_pipeline_value,
    active_deals,
    deals_by_phase,
    value_by_phase,
    health_distribution,
  };
}

/* ------------------------------------------------------------------ */
/* CONSOLIDATED REVOPS DASHBOARD (RevOps Productivity — Phase 1)        */
/* Implements the previously-dead getRevOpsDashboardData reference in   */
/* deals-list-api.ts. Server-aggregated RevOpsSummary (single source).  */
/* Win-rate and pipeline-coverage are computed from real deals here,    */
/* deprecating the stateless calculators in tools-api/opps.             */
/* ------------------------------------------------------------------ */
const REVOPS_TENANT_ID = process.env.REVOPS_TENANT_ID || "enterprise-internal";
const COVERAGE_TARGET_MULTIPLIER = Number(
  process.env.COVERAGE_TARGET_MULTIPLIER || "3.0",
);

const _getRevOpsDashboardData: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("getRevOpsDashboardData");

  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const summary = await getGlobalSummary(dealTable);

    const closedWonCount = summary.deals_by_phase["CLOSED_WON"] ?? 0;
    const closedLostCount = summary.deals_by_phase["CLOSED_LOST"] ?? 0;
    const closedWonValue = summary.value_by_phase["CLOSED_WON"] ?? 0;
    const closedLostValue = summary.value_by_phase["CLOSED_LOST"] ?? 0;

    const openPipelineValue = computeOpenPipelineValue(
      summary.total_pipeline_value,
      closedWonValue,
      closedLostValue,
    );
    const periodTarget = deriveDefaultPeriodTarget(
      closedWonValue,
      openPipelineValue,
      COVERAGE_TARGET_MULTIPLIER,
    );

    const revOpsSummary: RevOpsSummary = {
      tenant_id: REVOPS_TENANT_ID,
      as_of: new Date().toISOString(),
      total_pipeline_value_cents: toCents(summary.total_pipeline_value),
      total_active_deals: summary.active_deals,
      deals_by_phase: summary.deals_by_phase,
      health_distribution: normalizeHealthDistribution(
        summary.health_distribution,
      ),
      win_rate_pct: computeWinRatePct(closedWonCount, closedLostCount),
      pipeline_coverage_ratio: computePipelineCoverageRatio(
        openPipelineValue,
        periodTarget,
      ),
      data_classification: "INTERNAL",
    };

    return ok(revOpsSummary);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};
export const getRevOpsDashboardData = withPermissions(_getRevOpsDashboardData);
