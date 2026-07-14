# **Aerostack RevOps Productivity — PRD v0.1**
# **Rep productivity, forecast, and pipeline-health intelligence on the existing RevOps surface**

**document:** PRD — Aerostack RevOps Productivity Module
**version:** 0.1
**status:** Draft — authored against codebase reconciliation (2026-06-27)
**author:** Will Horn (with Kiro)
**date:** 2026-06-27
**applies_to:** enterprise-aerostack (enterprise internal work system; candidate for product repackaging)
**lineage:** D Feature/Module (productivity layer on a built RevOps surface)
**tier (per Architecture Canon):** Tier 3 — Aerostack-class business application
**references:**
- `Enterprise-Architecture-Canon-Four-Tier-Stack.md` (Tier 2 keystone this PRD aligns to)
- `Aerostack-Doc-vs-Code-Audit-2026.06.27.md`, `Aerostack-Loops-Model-Audit-Batch2-2026.06.27.md` (this project)
- Sibling PRD: `enterprise-aerostack/docs/inputs/PRD-Aerostack-Q2C-v0.2.md`
- **Source files (real paths):**
  - `infra/src/functions/hubspot/deals-list.ts` (`listDeals`, unexported `getGlobalSummary`)
  - `infra/src/lib/constructs/hubspot/deals-list-api.ts` (`GetRevOpsDashboardData` wiring)
  - `tools-api/functions/opps/handler.py` (`_score_deal`, `_win_rate`, `_pipeline_coverage`, `_create_opp`)
  - `infra/src/functions/loops/get-opportunity.ts` (BD/GTM/ADVISORY weighted scoring)
  - `infra/src/shared/validation/loop.schema.ts` (`LoopPillarEnum` incl. `REVOPS`)
  - `pwa-frontend/src/pages/DashboardRevOpsEnhanced.tsx`, `DashboardOpportunities.tsx`, `components/aerostack/OppsTools.tsx`
  - `common/src/utils/velocity.ts` (per-person weighted 90-day velocity)
  - `database/schema-revops-v2.sql`, `database/schema.sql` (`velocity_snapshots`, `category_pillar_map`)

---

## 0. TL;DR / What changed from v0

RevOps in Aerostack today is a real, shipping **pipeline-analytics** surface — pipeline dashboard, prioritized opportunities, opp creation into HubSpot. What it is *not* yet is a **productivity** surface: there is no rep-level activity, forecast, MBO/OKR-attainment, or sales-velocity intelligence, the consolidated `GetRevOpsDashboardData` endpoint is wired but its handler was never implemented (dead endpoint), and deal scoring / win-rate / coverage are stateless calculators that read nothing real. This PRD adds the productivity layer on top of the existing, working surface — no rip-and-replace.

---

## 0.1 Architecture Canon alignment  [per Enterprise-Architecture-Canon-Four-Tier-Stack.md]

- **Tier:** Tier 3 — Aerostack-class business application (the ABP resell layer / digital services). The value is the RevOps domain application; the architecture underneath is Tier 2 Aerostack.
- **Class / mode:** An expression of the Aerostack class (Tier 2) running in **internal mode** today (`enterprise-aerostack`, single-tenant). The `tenant_id` discipline in §10/§11.3 is what makes it **customer-mode**-deployable through Peregrine (Tier 1) later — same module, customer-branded.
- **Flow:** Primarily the **Revenue** flow of the five (Revenue · Delivery · People · Compliance + Knowledge). Feeds the **Operational Cadence Module's** RevOps/GTM meeting (a peer Tier 3 app).
- **Runs on:** Peregrine + Kestrel (Tier 1) → AWS + GitHub operated by MSP tooling (Tier 0). HubSpot is an external CRM source of truth, not a tier.
- **Maturity model:** Today the RevOps surface is **Observer** (reports pipeline). This PRD moves it toward **Advisor** (forecast, alerts, coverage recommendations); Operator (auto-actions on deals) is out of scope here.
- **Sibling surfaces (same architecture/platform, different audience):** **RevOps = internal-facing** · **CS Module = customer-facing** (`PRD-Aerostack-Customer-Success-v0.1`) · **partnerready.ai = AWS-partner-facing** (separate product; reuse patterns, link where useful). These three are siblings, not layers.

---

## 1. Background & current state

RevOps is a **Tier-3 Aerostack-class business application** (per the Architecture Canon) — the **internal-facing** sibling surface (CS = customer-facing, partnerready.ai = partner-facing). It sits on the HubSpot-sourced data plane (DynamoDB `deals`/`contacts`/`companies`, mirrored from HubSpot; the Postgres `database/schema-revops-v2.sql` describes the intended velocity model but is not deployed). The frontend already consumes `listDeals` for live pipeline analytics; the opportunity-loop prioritizer (BD/GTM/ADVISORY) is live.

**RevOps is, concretely, a 4-block weekly cadence meeting that marshals loops** — the productivity layer turns "pipeline visibility" into "run the weekly RevOps cadence and write decisions back." It does **not** introduce a new work object: it marshals **loops** (the `BD/GTM/ADVISORY` Opportunity bucket), the same object the Operational Cadence Module uses. The mission is to get enterprise out of the weeds and steadily more efficient.

---

## 2. What exists today  [BUILT/PARTIAL/GAP reconciliation]

| Capability | File evidence | Status | Gap / delta |
| :---- | :---- | :---- | :---- |
| RevOps pipeline dashboard UI (flow/table/cards, value, health distribution) | `pwa-frontend/src/pages/DashboardRevOpsEnhanced.tsx` ← `listDeals` | BUILT | Consumes `listDeals`, not the dead `/revops-dashboard` endpoint |
| Pipeline analytics API (`total_pipeline_value`, `deals_by_phase`, `health_distribution`, paging) | `infra/src/functions/hubspot/deals-list.ts` `listDeals` | BUILT | No rep dimension; deal-level only |
| Prioritized opportunities (BD/GTM/ADVISORY, weighted score) | `infra/src/functions/loops/get-opportunity.ts` → `/loops/opportunity` | BUILT | Dead commented-out v1 in file; OpenAPI path mislabeled `/opportunity-prioritization` |
| Opp creation into HubSpot + pipeline fetch | `tools-api/functions/opps/handler.py` `_create_opp`, `_list_pipelines` | BUILT | — |
| Deal scoring — **BANT-C** (code), MEDPIC is the direction | `tools-api/functions/opps/handler.py` `_score_deal` (dead Python stub) + frontend TS scorer | PARTIAL | Two divergent scorers, **never persisted**, nothing to remap in HubSpot. MEDPIC = structured 6-dim object (§6 Phase 2); delete dead Python scorer |
| Loops as the marshalled object | `infra/src/functions/loops/get-opportunity.ts` (BD/GTM/ADVISORY); `loop.schema.ts` `LoopStatusEnum`/`LoopPhaseEnum` | BUILT (loops) / GAP (cadence overlay) | `cadence_state` is a NEW separate field (B3); convergence/divergence = existing `LoopPhaseEnum` (B5) |
| Win-rate, pipeline-coverage | `tools-api/functions/opps/handler.py` `_win_rate`/`_pipeline_coverage` | PARTIAL | Stateless calculators; caller passes the numbers; nothing aggregated or persisted |
| Collections (composite) | — (only HubSpot deal `amount`; no QuickBooks/AR) | GAP | QuickBooks + HubSpot + comms events composite (B2); greenfield |
| Consolidated RevOps dashboard API (`GET /hubspot/revops-dashboard`) | construct `deals-list-api.ts` references `getRevOpsDashboardData` | GAP | Handler export does not exist in `deals-list.ts` → dead endpoint |
| RevOps pillar taxonomy | `loop.schema.ts` `LoopPillarEnum`; `database/schema.sql` `category_pillar_map` (GTM/BD/OPS:SalesOps → REVOPS) | BUILT | — |
| Per-person velocity (weighted 90-day) | `common/src/utils/velocity.ts`; `database/schema.sql` `velocity_snapshots`, `v_person_dashboard` | PARTIAL | Computed client-side from completed loops; no rep-revenue velocity; SQL table unused |
| Rep productivity / activity / forecast / MBO-OKR attainment | — | GAP | No activity ingest, forecast, or MBO/OKR attainment anywhere (no quotas — enterprise uses MBO/OKR) |

---

## 3. Goals & non-goals / scope boundaries

**Goals**
* Implement the consolidated RevOps data API (replace the dead `getRevOpsDashboardData`) so the dashboard has one server-aggregated source.
* Add a **rep productivity** layer: per-owner pipeline, activity, win-rate, sales velocity, and **MBO/OKR outcome attainment** (no quotas) — computed from real deal data, not caller inputs.
* Add a **forecast** model (commit / best-case / pipeline categories) and stalled-deal/aging alerts.
* Make win-rate and pipeline-coverage real (server-aggregated from `deals`), deprecating the stateless calculators.

**Non-goals**
* Replacing HubSpot as the system of record (it stays the CRM source of truth).
* Building the CS / account-health surface (separate PRD: Aerostack Customer Success).
* Expanding `LoopStatusEnum` — the cadence-state vocabulary is a **separate `cadence_state` field**, not new loop statuses (B3).
* Re-speccing partnerready.ai / PRM (separate partner product; reuse its cost/posture patterns where useful).

**Depends on**
* HubSpot → DynamoDB ingestion (existing); Deel people join (existing, `get-opportunity.ts` pattern).
* Auth/RBAC (existing Cognito + `withPermissions`).

---

## 4. Personas

| Persona | What they do | Surface | Exists today? |
| :---- | :---- | :---- | :---- |
| RevOps lead | Monitors pipeline health, forecast, coverage; runs the RevOps cadence | `/revops` dashboard | Partial (pipeline only) |
| Seller / Growth Partner | Sees own pipeline, activity, velocity, MBO/OKR outcome attainment | rep view (new) | No |
| Sales manager | Compares rep productivity, spots stalled deals, coaches | leaderboard / portfolio (new) | No |
| Agent/automation | Reads RevOps metrics programmatically for the cadence agent | `/hubspot/revops-dashboard` API | No (dead endpoint) |

---

## 5. Information architecture

The surface is organized as the **4-block, time-boxed weekly RevOps meeting** (B1) plus the supporting dashboards:

```
/revops  (RevOps Productivity — the weekly cadence)
├── Block 1 · Opportunity Update     (10 min)  MEDPIC-scored deals · stage changes ·
│                                              stuck >14 days · score <60 flags
├── Block 2 · In-Flight Corrections  (15 min)  at-risk loops (BD/GTM/ADVISORY in correction
│                                              state) · burn/CSAT/milestone · written back via adaptLoop
├── Block 3 · Collections            (15 min)  Current/Aging as totals · At-Risk/Critical per-customer
│                                              (composite: QuickBooks + HubSpot + comms events)
└── Block 4 · Q&A + SalesOps + VoC   (5 min)   pending SOWs/admin + Voice-of-Customer digest
                                               (CSAT verbatims, support themes, HubSpot activity → content strategy)

Supporting dashboards
├── Pipeline        [BUILT]  flow / table / cards · value · health distribution
├── Opportunities   [BUILT]  prioritized BD/GTM/ADVISORY loops
├── Reps            [NEW]    per-rep: pipeline · activity · win-rate · velocity · MBO/OKR attainment
├── Forecast        [NEW]    commit / best-case / pipeline · coverage vs target · gap-to-MBO
└── Alerts          [NEW]    stalled / aging deals · coverage shortfalls · MBO-attainment risk
```

**Two-register UI (B6):** the system thinks in loops; humans see typed, named work — *"Acme engagement — needs a correction,"* not *"Loop #4471 — IN_PROGRESS."* Loops already carry a human `title` + category/phase/status badges; the add is a friendly category-relabel map (`BD`→"Deal", `ENG`→"Engagement", `INT:*`→"Build") plus the cadence-state vocabulary (§6).

---

## 6. Features by build phase

### Phase 1 — Consolidated RevOps API + real win-rate/coverage
**Owner module/agent:** `agent-revops` / `tools-api/functions/revops`
**Capabilities:** implement `getRevOpsDashboardData` (server-aggregated summary); compute win-rate and pipeline-coverage from real `deals` data; expose per-rep rollups.

**Data model (verbatim types):**
```typescript
interface RevOpsSummary {
  tenant_id: string;                       // [REQUIRED] (see §11.3)
  as_of: string;                           // ISO timestamp
  total_pipeline_value_cents: number;
  total_active_deals: number;
  deals_by_phase: Record<string, number>;  // ACTIVELY_FUNDING, DEVELOPING, ...
  health_distribution: Record<'GREEN'|'YELLOW'|'ORANGE'|'RED', number>;
  win_rate_pct: number;                    // computed: closed_won / (closed_won + closed_lost)
  pipeline_coverage_ratio: number;         // computed: open_pipeline / period_target
  data_classification: 'INTERNAL';
}

// NOTE: enterprise does NOT use sales quotas. Reps are measured on MBO outcome targets + OKRs.
// (A rep can produce ~10x base — that's expected, stated openly, and absorbed into the
//  target design + average deal size, not via a quota number.) So this is MBO/OKR attainment.
interface RepProductivity {
  rep_email: string;
  tenant_id: string;
  period: string;                          // e.g. "2026-Q2"
  open_pipeline_cents: number;
  closed_won_cents: number;
  win_rate_pct: number;
  avg_sales_cycle_days: number;
  velocity_score: number;                  // reuse common/src/utils/velocity.ts weighting
  mbo_targets: { id: string; outcome: string; target: number; unit: string }[];  // sourced from hiring/comp docs (MBOs)
  okr_attainment_pct: number | null;       // outcome attainment vs MBO/OKR — NOT quota %
  activity_count: number | null;           // null until activity ingest exists (Phase 4)
  data_classification: 'INTERNAL';
}
```

### Phase 2 — Cadence-state overlay + MEDPIC scoring object
**Capabilities:** the cadence machinery — a `cadence_state` overlay on loops (B3) and a structured MEDPIC scoring object (B4). Decisions write back via existing primitives (`adaptLoop` = replan, status update, `addComment`); a "correction" is a composite over these, not a single op.

```typescript
// B3 — cadence_state is a SEPARATE field on the loop record. DO NOT expand LoopStatusEnum.
type CadenceState = 'in_flight' | 'managed' | 'handoff' | 'blocked' | 'at_risk' | 'correction';
interface LoopCadenceOverlay {
  loop_id: string;
  tenant_id: string;                       // [REQUIRED]
  cadence_state: CadenceState;             // overlay; the loop keeps its own status/phase
  block: 1 | 2 | 3 | 4;                    // which RevOps meeting block surfaces it
  last_decision_ref: string | null;        // adaptLoop adaptation_id / comment id written back
  data_classification: 'INTERNAL';
}

// B4 — MEDPIC as a structured 6-dimension object, NOT overloaded BANT-C arithmetic.
// Code today is BANT-C (two divergent scorers, never persisted). MEDPIC dimensions differ in
// kind and need NEW capture fields. Adoption direction; not in code yet.
interface MedpicScore {
  deal_id: string;
  tenant_id: string;
  metrics: number | null;                  // NEW — quantified business impact
  economic_buyer: number | null;           // ≈ Authority, but more specific
  decision_criteria: number | null;        // NEW explicit field
  decision_process: number | null;         // NEW explicit field
  identify_pain: number | null;            // ≈ Need
  champion: number | null;                 // has_champion exists today
  composite: number;                        // weighted 0–100; <60 flags in Block 1
  data_classification: 'INTERNAL';
}
```
**Decision (B4):** define MEDPIC as this structured object; **delete the dead Python `_score_deal`** (unreachable — frontend never calls it) rather than revive it; the live frontend scorer migrates to emit `MedpicScore`. Nothing to remap in HubSpot (scores were never persisted).

### Phase 3 — Forecast + alerts
**Capabilities:** forecast categories per deal; coverage-vs-target and gap-to-MBO; stalled (>N days in stage) and aging-deal alerts.
```typescript
interface ForecastEntry {
  deal_id: string;
  tenant_id: string;
  rep_email: string;
  category: 'commit' | 'best_case' | 'pipeline' | 'omitted';
  amount_cents: number;
  close_date: string;
  days_in_stage: number;
  stalled: boolean;                        // days_in_stage > threshold
  data_classification: 'INTERNAL';
}
```

### Phase 4 — Activity ingest (productivity signals)
**Capabilities:** ingest rep activity (calls/emails/meetings) from HubSpot engagements API into a `revops-activity` record type; backfill `activity_count` and activity-to-outcome ratios.

---

## 7. Root-event lifecycle

`CLARIFY > VALIDATE > BUILD > OPERATE`

| Stage | What RevOps Productivity does | Activation trigger |
| :---- | :---- | :---- |
| CLARIFY | Opportunity loops (BD/GTM/ADVISORY) prioritized; deal scored | new opp / deal created |
| VALIDATE | Win-rate, coverage, forecast category set | deal advances stage |
| BUILD | Quote-to-Cash hand-off (Q2C PRD) | verbal commit |
| OPERATE | Rep productivity + forecast tracked; alerts on stall/risk | continuous |

Deal state machine (existing HubSpot stages mapped): `lead → discovery → proposal → negotiation → verbal_commit → closed_won|closed_lost`.

**Convergence/divergence teaching lens (B5) — maps to the existing `LoopPhaseEnum`, not a new abstraction.** The cadence UI shows "diverging/converging" as a human-readable reading of the loop's existing `phase`:
- **Divergence (open / explore):** `PROJECTION`, `ASSERTION`
- **Convergence (narrow / resolve / re-baseline):** `FOCUS`, `FEEDBACK`, `ADAPTATION`

A loop opens (diverges), runs, and closes (converges). This is the structural lens available to those who think in loops — invisible to those who just want to know if a deal is on track (the two-register principle from §5).

---

## 8. API surface

> All RevOps APIs are Lambda modules. Consolidated read API in `infra/src/functions/hubspot/` (alongside `deals-list.ts`); productivity/forecast in a new `tools-api/functions/revops/` or `infra/src/functions/revops/`. Frontend consumes the same APIs.

### 8.1 `/hubspot/revops-dashboard` (implement the dead endpoint)
```
GET    /hubspot/revops-dashboard          — RevOpsSummary (server-aggregated)
```

### 8.2 `/revops` productivity API
```
GET    /revops/reps                        — RepProductivity[] (all reps, period)
GET    /revops/reps/{email}                — RepProductivity (one rep)
GET    /revops/forecast                    — ForecastEntry[] (by period/rep)
GET    /revops/alerts                      — stalled/aging/coverage-risk list
PUT    /revops/mbo/{email}                 — set/adjust a rep's MBO outcome targets (Admin; sourced from hiring/comp docs)
```

### 8.3 `/revops/cadence` (the weekly meeting)
```
GET    /revops/cadence                      — the 4-block meeting payload (loops by block + cadence_state)
PUT    /revops/cadence/loops/{loop_id}      — set cadence_state; writes back via adaptLoop/status/addComment
GET    /revops/collections                  — Block 3 composite (Current/Aging totals + At-Risk/Critical per-customer)
GET    /revops/voc                           — Block 4 Voice-of-Customer digest (CSAT verbatims, support themes, activity)
```

---

## 9. Integrations / data sources

| Upstream / Downstream | System | Contract / shape | Notes |
| :---- | :---- | :---- | :---- |
| Upstream | HubSpot CRM (via DynamoDB mirror) | `deals`/`contacts`/`companies` | source of truth for pipeline |
| Upstream | HubSpot Engagements API | activity events | Phase 4 only |
| Upstream | Deel people | owner-email → person join | existing pattern in `get-opportunity.ts` |
| Upstream | Loops | `BD/GTM/ADVISORY` Opportunity bucket + `cadence_state` overlay | the marshalled work object (B3) — not a new object |
| Upstream | **Collections (composite, B2)** | QuickBooks (authoritative invoice/payment ledger) + HubSpot (deal/contract context) + comms events (email/Slack promise-to-pay) | greenfield; QB says what's owed, comms say what's been said about it; shared with CS §9 |
| Downstream | Operational Cadence Module | RevOps summary + alerts + cadence payload feed the RevOps/GTM meeting | reads `/hubspot/revops-dashboard`, `/revops/alerts`, `/revops/cadence` |

---

## 10. Configuration model

> RevOps is currently internal (single-tenant), but every new record carries `tenant_id` from line one so the surface is customer-deployable later without a migration.

```typescript
interface RevOpsConfig {
  tenant_id: string;                       // unique per agreement
  customerName: string;
  features: { reps: boolean; forecast: boolean; alerts: boolean; activityIngest: boolean };
  fiscal_periods: string[];                // e.g. ["2026-Q2","2026-Q3"]
  stalled_days_threshold: number;          // default 30
  coverage_target_multiplier: number;      // default 3.0 (matches current _pipeline_coverage "healthy >= 3.0")
}
```

---

## 11. Cross-cutting / NFRs & GOVERNANCE GATES

**11.1 Data classification** — all RevOps entities are `INTERNAL` (pipeline/financial aggregates are internal business data; no customer PII stored beyond existing CRM mirror).

**11.2 IAM / least-privilege** — read-only scoped access to `deals`/`contacts`/`companies` tables + Secrets Manager (HubSpot PAT, existing). No wildcard ARNs. `PUT /revops/mbo` requires Admin.

**11.3 Tenant isolation** — `tenant_id` on `RevOpsSummary`, `RepProductivity`, `ForecastEntry`, and any new `revops-mbo` / `revops-activity` records. (Repo today: zero tables carry tenant_id — this PRD adds it on the new records and is a step toward the platform-wide gate.)

**11.4 RBAC** — `Seller` sees own `RepProductivity`; `Admin`/`Super-Admin` see all + set MBO targets; via `withPermissions()` with resource key `operations/revops`.

**11.5 Audit logging** — log MBO-target changes (config change), forecast-category overrides (data modification), and any export/download of rep productivity (data access).

**11.6 Test & coverage plan** — Vitest 80/75/80/80 on the aggregation logic; dedicated tests for win-rate/coverage math against fixture deal sets; tenant-isolation test (rep A cannot read rep B via API).

**11.7 Rollback plan** — new records are additive; no logical-ID changes to existing constructs; `DeletionPolicy: Retain` on any new DynamoDB table (e.g. `revops-mbo`).

**11.8 Mandatory infra tags** — `enterprise:module=revops`, `enterprise:workload=aerostack`, `enterprise:grc=soc2`, plus the standard `deployed-by/customer/engagement/env`.

**11.9 Secrets & encryption** — HubSpot PAT stays in Secrets Manager; no new secrets client-side; encryption at rest/transit.

**11.10 Accessibility / perf / design system** — WCAG 2.1 AA; `GET /hubspot/revops-dashboard` p95 < 800 ms (single aggregation scan, cached). **The RevOps surface is built in AWS Cloudscape** — one enterprise.ai product language, consistent with partnerready.ai + Peregrine Ops + the CS surfaces. **This is a net-new, intentionally breaking rebuild** (decided): the internal RevOps PRDs move Aerostack to Cloudscape, and the existing shadcn/Tailwind Pipeline/Opportunities tabs are **migrated into the new Cloudscape RevOps view** — a clean break, not a wrap-and-coexist. Aerostack's older `pwa-frontend` stack is being superseded here, not preserved. Cloudscape ships WCAG-compliant components.

**11.11 Commit-before-code** — this PRD → FI build plan → Slack #revops syndication → human commit → Linear (project "RevOps Productivity", issues per phase) → build.

**11.12 Build approach — backend extends, frontend is a breaking Cloudscape rebuild.** Two different postures by layer:
- **Backend / infra — extend, shield, additive.** Built into the existing `enterprise-aerostack` reference instance: **reuse** `listDeals`/`getGlobalSummary`, `deal-phases`, `get-opportunity.ts`, `common/src/utils/velocity.ts`, `withPermissions`; **shield** in-flight dev-team work (Divya, Rudresh, others) — new code lands as additive modules (`tools-api/functions/revops/`, new constructs) with **no logical-ID changes** to existing constructs and no edits to unrelated handlers; merge via the `dev` branch flow. Cleanup-as-you-go for code this PRD directly touches (delete the dead Python `_score_deal`, fix the `getRevOpsDashboardData` dead export, correct the OpenAPI `/opportunity-prioritization` mislabel).
- **Frontend — intentionally breaking (decided).** The RevOps UI is a **net-new Cloudscape rebuild** that supersedes the shadcn/Tailwind `pwa-frontend` RevOps screens; existing Pipeline/Opportunities tabs migrate into it. This break is by design — Aerostack internal surfaces are moving to Cloudscape — and is scoped to the RevOps surface (it does not force a rewrite of unrelated `pwa-frontend` screens this PRD doesn't touch).

**11.13 Deploy-for-review-and-approval — iterate as developed (the default loop).** This is NOT "preview at the end." Every increment of every surface (Reps, Forecast, Alerts, the cadence view) SHALL be **deployed to a dev environment continuously as it is built, for Will's review and approval, and iterated in place based on that feedback** — before it is promoted/wired to production. The cadence is: build a slice → deploy to dev → Will reviews → iterate → next slice. No surface advances to production wiring without Will's approval of the dev deployment. A reviewable dev deployment is the working state of every in-progress slice, not a milestone checkbox.

---

## 12. Open questions

| Question | Owner | Decision gate |
| :---- | :---- | :---- |
| ~~Is quota set in Aerostack or pulled from a comp system?~~ **RESOLVED: no quotas.** enterprise measures reps on **MBO outcome targets + OKRs**, sourced from the **hiring/comp docs** (not a comp-system pull, not hand-entered quotas). A rep producing ~10x base is expected and absorbed into target design + avg deal size. *(Pointer: MBO targets live in the hiring/comp docs — Kiro references those; not inlined here.)* | Will (decided 2026-06-28) | — |
| Does forecast category live on the HubSpot deal or only in Aerostack? | RevOps lead | Phase 2 design |
| Keep BANT or fold MEDPIC into scoring now? | Will / Kyle | tracked separately; not gating this PRD |
| ~~Cloudscape reconciliation: migrate or wrap?~~ **RESOLVED:** net-new Cloudscape, intentionally breaking — migrate the existing Pipeline/Opportunities tabs into the new Cloudscape view; Aerostack's `pwa-frontend` stack is superseded, not preserved. | Will (decided 2026-06-27) | — |

---

## 13. Success metrics

| Metric | Current | Phase 1 target | Full target |
| :---- | :---- | :---- | :---- |
| Win-rate / coverage source | caller-supplied (stateless) | computed from real deals | computed + per-rep |
| RevOps dashboard API | dead endpoint | live consolidated summary | live + forecast |
| Rep productivity visibility | none | per-rep pipeline + win-rate | + velocity + MBO/OKR attainment |
| Stalled-deal detection | manual | automated alert (>30d in stage) | predictive risk |

---

## 14. Milestones

| Milestone | Scope | Target date |
| :---- | :---- | :---- |
| M1 | Consolidated `/revops-dashboard` API + real win-rate/coverage | Week 1–2 |
| M2 | `/revops/reps` productivity rollups + UI tab | Week 3–4 |
| M3 | Forecast + alerts | Week 5–6 |
| M4 | Activity ingest (Phase 3) | later |

---

## 15. Acceptance criteria

* `GET /hubspot/revops-dashboard` returns a populated `RevOpsSummary` (no longer a dead endpoint), and `DashboardRevOpsEnhanced.tsx` reads from it.
* Win-rate and pipeline-coverage are computed server-side from `deals` (closed_won/closed_lost, open_pipeline/target) — the stateless calculator path is deprecated.
* `GET /revops/reps` returns one `RepProductivity` per owner with pipeline, win-rate, velocity; a `Seller` calling it sees only their own row.
* Stalled deals (>`stalled_days_threshold` in stage) surface in `GET /revops/alerts`.
* Every new record carries `tenant_id`; a cross-tenant read test fails closed.
* `analyze-standards.js` passes with zero CRITICAL; new DynamoDB table carries the 7 `enterprise:*` tags and `DeletionPolicy: Retain`.
* **Every slice deploys to dev for Will's review and approval, and iterates there before production wiring** (§11.13). The loop is build → deploy to dev → review → iterate → next slice. No surface is promoted to production without approval of its dev deployment — this is the default working rhythm, not an end-of-build preview.
* **The build extends the live Aerostack codebase** (§11.12): no logical-ID changes to existing constructs, no edits to unrelated in-flight handlers; the only deletions are the dead `_score_deal`, the dead-export fix, and the OpenAPI mislabel.

---

## 16. Spec decomposition & AIDLC hand-off

### 16.1 Kiro spec triplet
Seeds `.kiro/specs/revops-productivity/` — `.config.kiro` (`requirements-first`), `requirements.md`, `design.md`, `tasks.md`. (A worked triplet for the lead feature is provided in the companion file `WORKED-EXAMPLE-revops-dashboard-api.md`.)

### 16.2 REASONS Canvas decomposition *(Mode B forward hook)*
| Feature (from §6) | Planned `REASONS.md` path | Notes |
| :---- | :---- | :---- |
| Consolidated RevOps API | `.kiro/specs/revops-dashboard-api/REASONS.md` | Mode B |
| Rep productivity rollups | `.kiro/specs/revops-rep-productivity/REASONS.md` | Mode B |
| Forecast + alerts | `.kiro/specs/revops-forecast/REASONS.md` | Mode B |

### 16.3 Kestrel registry mapping *(forward hook)*
| §2 GAP | Artifact type | Registry id (proposed) | ≥2 callers? |
| :---- | :---- | :---- | :---- |
| Consolidated RevOps summary aggregation | module | `revops-summary` | Yes (cadence agent + dashboard) |
| Real win-rate/coverage calc | block | `pipeline-coverage-calc` | Maybe (RevOps + Q2C) |
| Rep productivity rollup | module | `rep-productivity` | RevOps only (keep product-coupled until shared) |

---

*Document: Aerostack RevOps Productivity — PRD v0.1 (proposed Master Index slot 2025.2.15)*
*Last Updated: June 2026*
