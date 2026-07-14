# Aerostack RevOps Productivity — Tasks

> Build rhythm: build a slice → deploy to dev → leave reviewable → next slice. Mark `[x]` when done.
> Backend extends additively (no logical-ID changes). Frontend is a net-new Cloudscape rebuild.

## Phase 1 — Consolidated RevOps API + real win-rate/coverage (the cleanest first slice)

### Task 1: Implement the dead `getRevOpsDashboardData` endpoint
- [x] Export `getGlobalSummary` from `infra/src/functions/hubspot/deals-list.ts` (additively extended with `value_by_phase`)
- [x] Add `common/src/types/revops-productivity.ts` with `RevOpsSummary`, `RepProductivity`, `ForecastEntry`, `CadenceState`, `LoopCadenceOverlay`, `MedpicScore`, `RevOpsConfig`
- [x] Implement & export `getRevOpsDashboardData` handler (wraps `getGlobalSummary`, adds win-rate, coverage, tenant_id, as_of, cents) wrapped with `withPermissions`
- [x] Add win-rate + coverage pure helpers in a testable module (`revops/aggregations.ts`)
- [x] Validated via `cdk synth Aerostack-ApiStack` (esbuild bundles the now-real export; template generates clean)
- [ ] BLOCKED: Deploy to dev — AWS SSO session expired (see `.kiro/state/blockers.md`). Command ready: `pnpm --filter infra build && npx cdk deploy Aerostack-ApiStack` (after `aws sso login`)

#### Acceptance Criteria
- Endpoint returns populated `RevOpsSummary` (no longer dead) — verified by synth; runtime verify pending deploy
- win_rate_pct = closed_won/(closed_won+closed_lost); coverage = open/target
- Carries tenant_id + data_classification:'INTERNAL'

---

### Task 2: Unit tests for aggregation math
- [x] Vitest tests for win-rate, coverage, phase rollups against fixture deal sets (14 tests passing via `pnpm dlx vitest`)
- [x] Aggregation module fully covered (all exported helpers tested)

---

### Task 3: Per-rep productivity rollups `/revops/reps`
- [ ] New `infra/src/functions/revops/rep-productivity.ts` (group deals by ownerEmail, reuse deal-phases + velocity)
- [ ] `GET /revops/reps` and `GET /revops/reps/{email}`; Seller sees only own row (RBAC)
- [ ] New `RevOpsApi` construct wiring these routes (no changes to existing constructs)
- [ ] Tenant-isolation test (rep A cannot read rep B)
- [ ] Deploy to dev; review

---

### Task 4: MBO targets `PUT /revops/mbo/{email}` + `revops-mbo` table
- [ ] New `revops-mbo` DynamoDB table (Retain, 7 tags) via new construct
- [ ] `set-mbo.ts` handler, Admin-only; audit-logged
- [ ] Deploy to dev; review

---

## Phase 2 — Cadence-state overlay + MEDPIC

### Task 5: `cadence_state` overlay (separate field, NOT LoopStatusEnum)
- [ ] `revops-cadence` table + overlay record type
- [ ] `GET /revops/cadence` (4-block payload), `PUT /revops/cadence/loops/{id}` (write back via adaptLoop/addComment)
- [ ] Deploy to dev; review

### Task 6: MEDPIC scoring object + cleanup
- [x] Define `MedpicScore` type (in `common/src/types/revops-productivity.ts`)
- [ ] Migrate live frontend scorer to emit `MedpicScore` (frontend, pending Cloudscape rebuild)
- [ ] HELD: Delete dead Python `_score_deal` — CONFLICT: Q2C PRD lists it as Active feeding Q2C qualification + `aerostack-agents.ts` exposes it as a tool. Needs Will's decision (see blockers.md)
- [x] Correct OpenAPI `/opportunity-prioritization` → `/loops/opportunity` (verified real route is `loops/opportunity`)

---

## Phase 3 — Forecast + alerts

### Task 7: Forecast `GET /revops/forecast` + `revops-forecast` table
- [ ] Per-deal ForecastEntry; coverage-vs-target, gap-to-MBO
- [ ] Deploy to dev; review

### Task 8: Alerts `GET /revops/alerts`
- [ ] Stalled (>threshold), aging, coverage-shortfall, MBO-risk
- [ ] Deploy to dev; review

---

## Phase 4 — Activity ingest (later)

### Task 9: HubSpot Engagements activity ingest → `revops-activity`
- [ ] Backfill activity_count + activity-to-outcome ratios

---

## Frontend (Cloudscape, net-new — runs in parallel as backend slices land)

### Task 10: Cloudscape RevOps app shell
- [ ] Scaffold Cloudscape app surface for `/revops` (AppLayout, SideNavigation, tabs)
- [ ] API client + TanStack Query hooks pointing at the new endpoints
- [ ] Deploy to dev; review

### Task 11: Migrate Pipeline + Opportunities tabs into Cloudscape
- [ ] Pipeline tab consumes `/hubspot/revops-dashboard`
- [ ] Opportunities tab consumes `/loops/opportunity`

### Task 12: Reps / Forecast / Alerts / Cadence Cloudscape views
- [ ] Wire each as its backend slice lands; two-register UI labels
