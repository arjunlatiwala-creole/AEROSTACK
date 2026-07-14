# Aerostack RevOps Productivity — Requirements

## Overview
Add a **productivity layer** on top of the existing, shipping RevOps pipeline-analytics surface. RevOps today reports pipeline (dashboard, prioritized opportunities, opp creation into HubSpot) but has no rep-level activity, forecast, MBO/OKR-attainment, or sales-velocity intelligence. The consolidated `GetRevOpsDashboardData` endpoint is wired in the CDK construct but its handler was never implemented (dead endpoint), and win-rate / coverage are stateless calculators that read nothing real.

This spec adds the productivity layer **additively** — no rip-and-replace of the backend. Source PRD: `docs/inputs/PRD-Aerostack-RevOps-Productivity-v0.1.md`.

## Tier / Architecture Alignment
- **Tier 3** Aerostack-class business application, **Revenue** flow, **internal-facing** sibling of the customer-facing CS Module.
- Maturity: moves the surface from **Observer** (reports pipeline) toward **Advisor** (forecast, alerts, coverage recommendations). Operator (auto-actions) is out of scope.
- Runs on the HubSpot → DynamoDB mirror (`deals`/`contacts`/`companies`). HubSpot stays CRM source of truth.

## Build Posture (non-negotiable)
- **Backend/infra — extend, shield, additive.** Reuse `listDeals` / `getGlobalSummary` (`infra/src/functions/hubspot/deals-list.ts`), `deal-phases.ts`, `get-opportunity.ts`, `common/src/utils/velocity.ts`, `withPermissions`. New code lands as additive modules with **no logical-ID changes** to existing constructs and **no edits to unrelated in-flight handlers**. Merge via `dev`.
- **Frontend — intentionally breaking Cloudscape rebuild (decided).** Net-new AWS Cloudscape RevOps surface that supersedes the shadcn/Tailwind `pwa-frontend` RevOps screens; existing Pipeline/Opportunities tabs migrate into it. Scoped to the RevOps surface only.
- **Cleanup-as-you-go** for code this spec directly touches: implement the dead `getRevOpsDashboardData` export, delete the dead Python `_score_deal`, correct the OpenAPI `/opportunity-prioritization` mislabel.
- **Every new record carries `tenant_id`** from line one (single-tenant today, customer-deployable later without migration).
- **No sales quotas.** Reps are measured on **MBO outcome targets + OKRs** (sourced from hiring/comp docs). Attainment is outcome-vs-MBO, never a quota %.

## Requirements

### Phase 1 — Consolidated RevOps API + real win-rate/coverage

1. **FR-1: Implement the consolidated RevOps dashboard endpoint**
   - Implement and export `getRevOpsDashboardData` in `infra/src/functions/hubspot/deals-list.ts` (the CDK construct `deals-list-api.ts` already wires `GET /hubspot/revops-dashboard` to this handler — currently a dead reference).
   - Returns a server-aggregated `RevOpsSummary` (single source for the dashboard), reusing `getGlobalSummary` + `deal-phases` helpers.
   - Wrapped with `withPermissions`; resource key `operations/revops`.
   - p95 < 800 ms (single aggregation scan, cacheable).

2. **FR-2: Real win-rate, computed from deals**
   - `win_rate_pct = closed_won / (closed_won + closed_lost)` computed server-side by scanning the `deals` mirror (using normalized stages from `deal-phases`).
   - Deprecate the stateless calculator path (`tools-api/functions/opps/handler.py` `_win_rate`).

3. **FR-3: Real pipeline coverage, computed from deals**
   - `pipeline_coverage_ratio = open_pipeline / period_target` computed server-side. Default `coverage_target_multiplier = 3.0` (matches current "healthy >= 3.0").
   - Deprecate `_pipeline_coverage` stateless calculator.

4. **FR-4: `RevOpsSummary` carries `tenant_id` and `data_classification: 'INTERNAL'`.**

5. **FR-5: Per-rep rollups (`/revops/reps`)**
   - `GET /revops/reps` returns one `RepProductivity` per deal owner (period-scoped): open pipeline, closed-won, win-rate, avg sales cycle, velocity score (reuse `velocity.ts` weighting), MBO targets + OKR attainment.
   - `GET /revops/reps/{email}` returns a single rep.
   - **RBAC:** a `Seller` calling `/revops/reps` sees only their own row; `Admin`/`Super-Admin` see all.

6. **FR-6: MBO targets (`PUT /revops/mbo/{email}`)**
   - Admin-only. Sets/adjusts a rep's MBO outcome targets (sourced from hiring/comp docs). Persists to a new `revops-mbo` DynamoDB table.
   - Audit-logged as a config change.

### Phase 2 — Cadence-state overlay + MEDPIC scoring object

7. **FR-7: `cadence_state` overlay on loops**
   - A **separate `cadence_state` field** on a loop overlay record — **DO NOT expand `LoopStatusEnum`**. States: `in_flight | managed | handoff | blocked | at_risk | correction`.
   - `GET /revops/cadence` returns the 4-block weekly meeting payload (loops grouped by block + cadence_state).
   - `PUT /revops/cadence/loops/{loop_id}` sets cadence_state; writes decisions back via existing primitives (`adaptLoop`, status update, `addComment`) — a "correction" is a composite over these, not a new op.

8. **FR-8: MEDPIC scoring object**
   - Define `MedpicScore` as a structured 6-dimension object (metrics, economic_buyer, decision_criteria, decision_process, identify_pain, champion → weighted `composite` 0–100; `<60` flags in Block 1).
   - **Delete the dead Python `_score_deal`** (unreachable; frontend never calls it). Nothing to remap in HubSpot (scores were never persisted).

### Phase 3 — Forecast + alerts

9. **FR-9: Forecast categories (`GET /revops/forecast`)**
   - Per-deal `ForecastEntry` with category `commit | best_case | pipeline | omitted`, amount, close date, `days_in_stage`, `stalled` flag.
   - Coverage-vs-target and gap-to-MBO surfaced.

10. **FR-10: Alerts (`GET /revops/alerts`)**
    - Stalled deals (`days_in_stage > stalled_days_threshold`, default 30), aging deals, coverage shortfalls, MBO-attainment risk.

### Phase 4 — Activity ingest (later)

11. **FR-11: Activity ingest**
    - Ingest rep activity (calls/emails/meetings) from HubSpot Engagements API into a `revops-activity` record type; backfill `activity_count` and activity-to-outcome ratios. (Deferred; `activity_count` is `null` until this exists.)

### Cross-cutting (apply to all phases)

12. **NFR-1: Tenant isolation.** `tenant_id` on `RevOpsSummary`, `RepProductivity`, `ForecastEntry`, `revops-mbo`, `revops-activity`. Cross-tenant read must fail closed (test required).
13. **NFR-2: IAM least-privilege.** Read-only scoped access to `deals`/`contacts`/`companies` + Secrets Manager (existing HubSpot PAT). No wildcard ARNs. `PUT /revops/mbo` requires Admin.
14. **NFR-3: Audit logging.** MBO-target changes, forecast-category overrides, rep-productivity export.
15. **NFR-4: Data classification = INTERNAL** for all RevOps entities.
16. **NFR-5: Tests/coverage.** Vitest 80/75/80/80 on aggregation logic; dedicated win-rate/coverage math tests against fixture deal sets; tenant-isolation test.
17. **NFR-6: Rollback.** Additive only; no logical-ID changes; `DeletionPolicy: Retain` on new tables.
18. **NFR-7: Mandatory tags.** `enterprise:module=revops`, `enterprise:workload=aerostack`, `enterprise:grc=soc2`, plus standard `deployed-by/customer/engagement/env`.
19. **NFR-8: Cloudscape + WCAG 2.1 AA** for the net-new frontend.
20. **NFR-9: Deploy-for-review rhythm.** Every increment deploys to dev for review and iterates there before any production wiring. A reviewable dev deployment is the working state of every in-progress slice — not an end-of-build preview. Never promote to production.

## Acceptance Criteria
- `GET /hubspot/revops-dashboard` returns a populated `RevOpsSummary` (no longer dead), and the frontend reads from it.
- Win-rate and pipeline-coverage computed server-side from `deals`; stateless calculator path deprecated.
- `GET /revops/reps` returns one `RepProductivity` per owner; a `Seller` sees only their own row.
- Stalled deals (>`stalled_days_threshold`) surface in `GET /revops/alerts`.
- Every new record carries `tenant_id`; cross-tenant read test fails closed.
- New DynamoDB tables carry the 7 `enterprise:*` tags and `DeletionPolicy: Retain`.
- No logical-ID changes to existing constructs; only deletions are the dead `_score_deal`, the dead-export fix, and the OpenAPI mislabel.
- Every slice deploys to dev for review before production wiring.
