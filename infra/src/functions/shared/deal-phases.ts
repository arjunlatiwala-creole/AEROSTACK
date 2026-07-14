/* ------------------------------------------------------------------ */
/* Shared phase / health / pipeline helpers                           */
/* ------------------------------------------------------------------ */

export type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export type Phase =
  | "LEAD"
  | "DEVELOPING"
  | "ACTIVELY_FUNDING"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "LAUNCHED"
  | "PROPOSED";

export function mapStageToPhase(dealstageName?: string | null): Phase {
  if (!dealstageName) return "LEAD";

  const s = dealstageName.toLowerCase().trim();

  if (s.includes("closed-won") || s.includes("committed")) return "CLOSED_WON";
  if (s.includes("closed lost") || s.includes("closed-lost"))
    return "CLOSED_LOST";
  if (s.includes("business validation") || s.includes("technical validation"))
    return "ACTIVELY_FUNDING";
  if (s.includes("aws qualified") || s.includes("enterprise qualified"))
    return "DEVELOPING";
  if (s.includes("launched") || s.includes("invoicing")) return "LAUNCHED";
  if (s.includes("awaiting signature")) return "PROPOSED";

  return "LEAD";
}

export function deriveHealth(
  dealstageName?: string | null,
  amount: number = 0,
): HealthStatus {
  if (!dealstageName) return "YELLOW";

  const s = dealstageName.toLowerCase();

  if (s.includes("closed-won") || s.includes("committed")) return "GREEN";
  if (s.includes("closed lost") || s.includes("closed-lost")) return "RED";
  if (amount === 0) return "YELLOW";
  if (amount > 50000) return "GREEN";

  return "ORANGE";
}

export function getPhaseLabel(phase: string): string {
  switch (phase) {
    case "LEAD":
      return "Lead";
    case "DEVELOPING":
      return "Developing";
    case "ACTIVELY_FUNDING":
      return "Funding";
    case "CLOSED_WON":
      return "Closed Won";
    case "CLOSED_LOST":
      return "Closed Lost";
    case "LAUNCHED":
      return "Launched";
    case "PROPOSED":
      return "Proposed";
    default:
      return phase;
  }
}

// Internal stage normaliser (mirrors the one in the handler)
// Ensures "closed-lost", "Closed-Lost", "closed lost" all → "Closed Lost"
function normStage(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[-_]/g, " ");
  if (s === "closed lost") return "Closed Lost";
  if (s === "closed won") return "Closed Won";
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildPipelineFromDeals(deals: any[]) {
  const phases: Phase[] = [
    "LEAD",
    "DEVELOPING",
    "ACTIVELY_FUNDING",
    "CLOSED_WON",
    "CLOSED_LOST",
    "LAUNCHED",
    "PROPOSED",
  ];

  const pipeline = phases.map((phase) => {
    const phaseDeals = deals.filter((d) => d.phase === phase);

    const total_value = phaseDeals.reduce(
      (sum, d) => sum + Number(d.amount || 0),
      0,
    );

    const health_distribution = phaseDeals.reduce((acc: any, d) => {
      acc[d.health_status] = (acc[d.health_status] || 0) + 1;
      return acc;
    }, {});

    // Collect unique normalised stage names in this phase.
    // Variants like "closed-lost" and "Closed Lost" collapse to one entry.
    const stageMap = new Map<string, string>();
    phaseDeals.forEach((d) => {
      const raw = d.stage ?? d.stage_name ?? "";
      if (!raw) return;
      const norm = normStage(raw);
      if (!stageMap.has(norm)) stageMap.set(norm, norm);
    });
    const stages = Array.from(stageMap.values()).sort();

    return {
      phase,
      stages, // unique stage_names in this phase — use instead of phase_label
      deal_count: phaseDeals.length,
      total_value,
      health_distribution,
      deals: phaseDeals,
    };
  });

  const summary = {
    total_deals: deals.length,
    total_pipeline_value: deals.reduce(
      (sum, d) => sum + Number(d.amount || 0),
      0,
    ),
    deals_by_phase: deals.reduce((acc: any, d) => {
      acc[d.phase] = (acc[d.phase] || 0) + 1;
      return acc;
    }, {}),
    health_distribution: deals.reduce((acc: any, d) => {
      acc[d.health_status] = (acc[d.health_status] || 0) + 1;
      return acc;
    }, {}),
  };

  return { pipeline, summary };
}
