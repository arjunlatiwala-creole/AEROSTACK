import { useQuery } from "@tanstack/react-query"
import { getDeals } from "@/api/hubspot"

/* =====================================================
 * TYPES
 * ===================================================== */

export type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED"

export type Phase =
  | "LEAD"
  | "DEVELOPING"
  | "ACTIVELY_FUNDING"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "LAUNCHED"

export interface Deal {
  id?: string
  deal_id?: string
  name: string
  company: string
  amount: number
  health_status: HealthStatus
  phase?: Phase
  stage?: string
  owner_email?: string
}

export interface PipelinePhase {
  phase: Phase
  phase_label: string
  deal_count: number
  total_value: number
  health_distribution: Partial<Record<HealthStatus, number>>
  deals: Deal[]
}

export interface DashboardData {
  pipeline: PipelinePhase[]
  summary: {
    total_deals: number
    total_pipeline_value: number
    deals_by_phase: Partial<Record<Phase, number>>
    health_distribution: Partial<Record<HealthStatus, number>>
  }
  recent_activity: unknown[]
}

/* =====================================================
 * STAGE → PHASE MAPPING
 * ===================================================== */

const STAGE_TO_PHASE: Record<string, Phase> = {
  closedwon: "CLOSED_WON",
  closedlost: "CLOSED_LOST",

}

const DEFAULT_PHASE: Phase = "LEAD"

/* =====================================================
 * HEALTH DERIVATION
 * ===================================================== */

function deriveHealth(stage: string, amount: number): HealthStatus {
  if (stage === "closedwon") return "GREEN"
  if (stage === "closedlost") return "RED"

  if (amount === 0) return "YELLOW"
  if (amount > 50000) return "GREEN"

  return "ORANGE"
}

/* =====================================================
 * MAPPER
 * ===================================================== */

function mapHubSpotDeal(raw: any): Deal {
  const amount = Number(raw.amount ?? 0)
  const phase = STAGE_TO_PHASE[raw.stage] ?? DEFAULT_PHASE

  return {
    id: raw.id,
    deal_id: raw.id,
    name: raw.name,
    company: raw.companyName ?? "Unknown",
    amount,
    stage: raw.stage,
    phase,
    health_status: deriveHealth(raw.stage, amount),
    owner_email: raw.contactEmail ?? undefined,
  }
}

export function mapHubSpotDeals(rawDeals: any[]): Deal[] {
  return rawDeals.map(mapHubSpotDeal)
}

/* =====================================================
 * PIPELINE BUILDER
 * ===================================================== */

export function buildPipelineFromDeals(deals: Deal[]): DashboardData {
  const phases: Phase[] = [
    "LEAD",
    "DEVELOPING",
    "ACTIVELY_FUNDING",
    "CLOSED_WON",
    "CLOSED_LOST",
    "LAUNCHED",
  ]

  const phaseLabels: Record<Phase, string> = {
    LEAD: "Leads",
    DEVELOPING: "Developing Deals",
    ACTIVELY_FUNDING: "Actively Funding Deals",
    CLOSED_WON: "Closed Won",
    CLOSED_LOST: "Closed Lost",
    LAUNCHED: "Launched",
  }

  const pipeline = phases.map((phase) => {
    const phaseDeals = deals.filter((d) => d.phase === phase)
    const total_value = phaseDeals.reduce((sum, d) => sum + d.amount, 0)

    const health_distribution = phaseDeals.reduce((acc, d) => {
      acc[d.health_status] = (acc[d.health_status] || 0) + 1
      return acc
    }, {} as Partial<Record<HealthStatus, number>>)

    return {
      phase,
      phase_label: phaseLabels[phase],
      deal_count: phaseDeals.length,
      total_value,
      health_distribution,
      deals: phaseDeals,
    }
  })

  const summary = {
    total_deals: deals.length,
    total_pipeline_value: deals.reduce((sum, d) => sum + d.amount, 0),
    deals_by_phase: deals.reduce((acc, d) => {
      if (d.phase) acc[d.phase] = (acc[d.phase] || 0) + 1
      return acc
    }, {} as Partial<Record<Phase, number>>),
    health_distribution: deals.reduce((acc, d) => {
      acc[d.health_status] = (acc[d.health_status] || 0) + 1
      return acc
    }, {} as Partial<Record<HealthStatus, number>>),
  }

  return { pipeline, summary, recent_activity: [] }
}

/* =====================================================
 * FINAL HOOK
 * ===================================================== */

export function useRevOpsDashboard() {
  return useQuery<DashboardData>({
    queryKey: ["revops-dashboard"],
    queryFn: async () => {
      const raw = await getDeals()
      const deals = mapHubSpotDeals(raw.data.deals)
      return buildPipelineFromDeals(deals)
    },
    staleTime: 5 * 60 * 1000,

  })
}
