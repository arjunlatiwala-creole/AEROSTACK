# Aerostack RevOps Productivity — Design

## Architecture posture
Additive extension of the live Aerostack backend. Two backend homes:
- **`infra/` (TypeScript CDK)** — the consolidated read API lives here, alongside `deals-list.ts`, because it directly reuses `getGlobalSummary`, `deal-phases`, and the existing `deals`/`companies`/`contacts` tables already granted to that construct.
- **New additive modules** — rep productivity, forecast, alerts, cadence, MBO live in new `infra/src/functions/revops/` handlers + a new `RevOpsApi` construct. **No edits to existing constructs' logical IDs.**

```
[Cloudscape RevOps UI] --> API Gateway (existing RestApi)
   |                          |
   |-- GET /hubspot/revops-dashboard --> getRevOpsDashboardData (deals-list.ts)  [reuses getGlobalSummary]
   |-- GET /revops/reps[/{email}]    --> revops/rep-productivity.ts             [reuses velocity.ts, deal-phases]
   |-- GET /revops/forecast          --> revops/forecast.ts
   |-- GET /revops/alerts            --> revops/alerts.ts
   |-- PUT /revops/mbo/{email}       --> revops/set-mbo.ts        --> revops-mbo (DDB, NEW)
   |-- GET /revops/cadence           --> revops/get-cadence.ts   --> loop overlay (DDB, NEW)
   |-- PUT /revops/cadence/loops/{id}--> revops/set-cadence-state.ts --> adaptLoop/addComment (reuse)
                              |
                    DynamoDB: deals / companies / contacts (READ, existing mirror)
```

## Data models (verbatim from PRD §6)

### RevOpsSummary (Phase 1)
```typescript
interface RevOpsSummary {
  tenant_id: string;                       // REQUIRED
  as_of: string;                           // ISO timestamp
  total_pipeline_value_cents: number;
  total_active_deals: number;
  deals_by_phase: Record<string, number>;
  health_distribution: Record<'GREEN'|'YELLOW'|'ORANGE'|'RED', number>;
  win_rate_pct: number;                    // closed_won / (closed_won + closed_lost)
  pipeline_coverage_ratio: number;         // open_pipeline / period_target
  data_classification: 'INTERNAL';
}
```
> Existing `getGlobalSummary` already produces `total_deals`, `total_pipeline_value`, `active_deals`, `deals_by_phase`, `health_distribution`. The new handler wraps it, adds win-rate (from CLOSED_WON / CLOSED_LOST phase counts), coverage (open pipeline / target), `tenant_id`, `as_of`, and converts value to cents.

### RepProductivity (Phase 1)
```typescript
interface RepProductivity {
  rep_email: string;
  tenant_id: string;
  period: string;                          // e.g. "2026-Q2"
  open_pipeline_cents: number;
  closed_won_cents: number;
  win_rate_pct: number;
  avg_sales_cycle_days: number;
  velocity_score: number;                  // reuse common/src/utils/velocity.ts weighting
  mbo_targets: { id: string; outcome: string; target: number; unit: string }[];
  okr_attainment_pct: number | null;       // outcome attainment vs MBO/OKR — NOT quota %
  activity_count: number | null;           // null until Phase 4
  data_classification: 'INTERNAL';
}
```
Computed by grouping deals on `ownerEmail`, normalizing stages with `deal-phases`, computing per-owner win-rate/pipeline. MBO targets read from `revops-mbo`. `velocity_score` reuses `calculatePersonVelocity` (loops-based) where loop data is joinable; otherwise `0` with a note.

### CadenceState overlay (Phase 2) — separate field, NOT a LoopStatusEnum change
```typescript
type CadenceState = 'in_flight'|'managed'|'handoff'|'blocked'|'at_risk'|'correction';
interface LoopCadenceOverlay {
  loop_id: string; tenant_id: string;
  cadence_state: CadenceState;
  block: 1|2|3|4;
  last_decision_ref: string | null;
  data_classification: 'INTERNAL';
}
```

### MedpicScore (Phase 2)
```typescript
interface MedpicScore {
  deal_id: string; tenant_id: string;
  metrics: number | null; economic_buyer: number | null;
  decision_criteria: number | null; decision_process: number | null;
  identify_pain: number | null; champion: number | null;
  composite: number;                        // <60 flags in Block 1
  data_classification: 'INTERNAL';
}
```

### ForecastEntry (Phase 3)
```typescript
interface ForecastEntry {
  deal_id: string; tenant_id: string; rep_email: string;
  category: 'commit'|'best_case'|'pipeline'|'omitted';
  amount_cents: number; close_date: string; days_in_stage: number;
  stalled: boolean;                         // days_in_stage > threshold
  data_classification: 'INTERNAL';
}
```

## New DynamoDB tables (additive, in table-stack via new construct)
| Table | PK | SK | GSI | Notes |
|-------|----|----|-----|-------|
| `revops-mbo` | `TENANT#{tenant_id}` | `REP#{email}#PERIOD#{period}` | — | MBO targets; `DeletionPolicy: Retain` |
| `revops-cadence` | `TENANT#{tenant_id}` | `LOOP#{loop_id}` | by-block | cadence overlay; `Retain` |
| `revops-forecast` | `TENANT#{tenant_id}` | `DEAL#{deal_id}` | by-rep | forecast overrides; `Retain` |
| `revops-activity` | `TENANT#{tenant_id}` | `REP#{email}#TS#{ts}` | — | Phase 4 only |

All tables: `PAY_PER_REQUEST`, the 7 `enterprise:*` tags, `DeletionPolicy: Retain`.

## Config model
```typescript
interface RevOpsConfig {
  tenant_id: string; customerName: string;
  features: { reps: boolean; forecast: boolean; alerts: boolean; activityIngest: boolean };
  fiscal_periods: string[];
  stalled_days_threshold: number;          // default 30
  coverage_target_multiplier: number;      // default 3.0
}
```
Default tenant for internal mode: `tenant_id = "enterprise-internal"`.

## Reuse map (what we call, do not rewrite)
| Need | Reuse |
|------|-------|
| Global pipeline aggregation | `getGlobalSummary` (export it) in `deals-list.ts` |
| Stage→phase, health, pipeline build | `infra/src/functions/shared/deal-phases.ts` |
| Permission gate | `withPermissions` + `X-Resource-Key: operations/revops` |
| Velocity weighting | `common/src/utils/velocity.ts` |
| Opportunity prioritization | `infra/src/functions/loops/get-opportunity.ts` |
| Loop write-back (corrections) | `adapt-loop.ts`, `add-comment.ts`, `update-loop.ts` |
| Response envelope | `ok` / `err` in `shared/response.ts` |

## Cleanup items (only deletions/fixes this spec touches)
1. Implement & export `getRevOpsDashboardData` in `deals-list.ts` (also export `getGlobalSummary`).
2. Delete dead Python `_score_deal` in `tools-api/functions/opps/handler.py`.
3. Correct OpenAPI `/opportunity-prioritization` mislabel → `/loops/opportunity`.

## Frontend (Cloudscape, net-new)
New Cloudscape app surface for `/revops` with tabs: Pipeline (migrated), Opportunities (migrated), Reps (new), Forecast (new), Alerts (new), Cadence (4-block view). Two-register UI: humans see typed named work ("Acme engagement — needs a correction"), system thinks in loops. TanStack Query for server state; provider-agnostic API client. Supersedes shadcn RevOps screens.

## Testing strategy
- Unit (Vitest): win-rate math, coverage math, per-rep rollup grouping, stalled detection — against fixture deal sets.
- Tenant isolation: rep A cannot read rep B via `/revops/reps`; cross-tenant read fails closed.
- Construct tests: new tables block public access, carry tags, `Retain` policy.


## Productivity dashboard structure — update 2026-06-29

Per direct product feedback (`docs/inputs/revops-productivity-feedback-2026-06-29.md`), the RevOps
Productivity UI is the operating surface for the weekly RevOps meeting and is organized into five
sections so the data is a source of clarity at a glance, not individual-deal firefighting.

**Universal operators:** Kyle, Will, and Paige run the business universally across all five
sections — the dashboard is built for the three of them to operate the whole business from one
surface with full cross-cutting visibility (operating intent; system roles handled separately).

The five sections:

1. **Customer Defects & Risks (CoE)** — top band. Exceptions / anything scored bad, from the
   sections below or anywhere in the business. Backed by `GET /revops/alerts` (stalled deals,
   coverage shortfall); extensible to CS health/SLA exceptions.
2. **Collections** — invoice aging/health across customer, partner, and AWS FR billing; urgency +
   blockers. Shows Total Contract Value vs Billed vs Paid (two-sided ledger) rolling up
   deal→customer→practice→company→geo. Billed/Paid await the HubSpot→QuickBooks billing feed
   (task-based hookup; explicitly NOT blocked on Creole). Full RevRec stays in the QuickBooks
   RevRec module (build-vs-buy → buy; backlog) — not this screen.
3. **Transitions** — conversion → contract → handoff/onboarding → post-close (60–100%) →
   managed/offboarding. Funnel from the deal mirror; cadence board overlays loop transition state
   (`GET /revops/cadence`).
4. **Opportunities** — HubSpot staging, aging, blockers at a glance (flagged-first). Aging flag at
   **>14 days**; stalled from backend threshold. Backed by `GET /revops/forecast` + summary phases.
5. **SalesOps Mechanisms & Process Improvement** — rep performance on **MBO outcome targets + OKRs
   (no sales quotas)** via `GET /revops/reps`; plus a running process-improvement log.

Rules carried into the module: ownerless/PC3 deals route to a generic owner + automated
digital-campaign pipeline (not a person's manual job); every deal is process-owned or
named-owner-owned (no orphans); expectation-setting on first invoice issued.
