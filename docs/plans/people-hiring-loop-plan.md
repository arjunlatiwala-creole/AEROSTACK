# People Ops Hiring Loop — Implementation Plan (Phase 1)

**Scope**: HubSpot `hiring` pipeline ↔ Aerostack two-way sync + manual checklist UI.
**Out of scope (future phases)**: Google Workspace, Slack, GitHub, Linear, Moodle, Bedrock compliance agent, Tech Shift (1099 → W2) pipeline.

Source of truth for product requirements: `people-hriging-loop.md` at repo root.

---

## 1. Domain Model

A **Hiring Loop** is a new entity distinct from the existing `Loop` schema (which is an OKR/KR construct). Do **not** reuse `LoopSchema` — add a new table + schemas so hiring state never pollutes the OKR pipeline.

### Stage enum (Aerostack-side)
```
SOURCING → INTERVIEWING → OFFER → ONBOARDING → ACTIVE
                                            └─ CLOSED (from any stage, via HubSpot "Exited")
```

### HubSpot ↔ Aerostack stage map
| HubSpot stage (label)   | Probability | Aerostack stage     |
|-------------------------|-------------|----------------|
| 1st Contact             | 10%         | SOURCING       |
| Applied                 | 20%         | SOURCING       |
| First Interview         | 40%         | INTERVIEWING   |
| Second Interview        | 60%         | INTERVIEWING   |
| Presentation scheduled  | 80%         | INTERVIEWING   |
| Offer Letter Sent       | 90%         | OFFER          |
| Hired/Onboarding        | 100% Won    | ONBOARDING     |
| Exited                  | 0% Lost     | CLOSED         |

ACTIVE is Aerostack-only (entered when all ONBOARDING checklist items complete).

### Checklist items per stage
```
SOURCING:     initial_call_completed, nda_sent, nda_signed, candidate_qualified
INTERVIEWING: interview_1_completed, interview_2_completed, presentation_done,
              team_feedback_recorded, comp_plan_shared, comp_plan_agreed
OFFER:        offer_letter_sent, offer_letter_signed, deel_record_created
ONBOARDING:   google_workspace, slack_access, moodle_enrolled,
              role_based_tools, state_compliance
```
Model checklist as an array of `{ key, label, stage, done, done_at, done_by, notes? }` on the hiring loop item. Keys are stable strings; labels are presentational.

### New Zod schemas
Add `infra/src/shared/validation/hiring-loop.schema.ts`:
- `HiringStageEnum`
- `HiringChecklistItemSchema`
- `HiringLoopSchema` — `{ hiring_loop_id, hubspot_deal_id, candidate_name, candidate_email, owner_email, department?, role?, expected_start_date?, stage, hubspot_stage_id, hubspot_stage_label, checklist: HiringChecklistItemSchema[], nda_link?, comp_plan_link?, created_at, updated_at, updated_by, closed_reason? }`
- `CreateHiringLoopInputSchema`, `UpdateHiringLoopInputSchema`, `ToggleChecklistItemSchema`, `HiringLoopListParamsSchema`

---

## 2. Storage

New DynamoDB table `HiringLoopsTable`:
- PK: `hiring_loop_id` (ULID)
- GSI-1: `hubspot_deal_id` (exact match lookup from webhook)
- GSI-2: `stage#updated_at` for dashboard board queries
- GSI-3: `owner_email#updated_at` for "my candidates" view

Defined in `infra/src/lib/stacks/table-stack.ts` (add alongside existing tables; do not reuse `loops` or `integrations-raw`). Add repo at `infra/src/repos/hiring-loop.repository.ts` mirroring `loop.repository.ts` patterns.

Keep the existing `integrations-raw` ingestion path for deals — it remains the audit log. Hiring loops are the projected operational view.

---

## 3. Backend — Lambdas & Routes

Create `infra/src/functions/hiring-loops/`:

| File | Purpose |
|------|---------|
| `hubspot-webhook.ts` | Public POST endpoint HubSpot calls on deal create/propertyChange. Verifies signature (`X-HubSpot-Signature-v3`), filters to `hiring` pipeline, upserts hiring loop, advances stage. |
| `create-hiring-loop.ts` | Manual create (fallback if webhook missed). |
| `list-hiring-loops.ts` | List + filter by stage/owner for the dashboard. |
| `get-hiring-loop.ts` | Single record with checklist. |
| `update-hiring-loop.ts` | Patch candidate metadata (dept, start date, doc links). |
| `toggle-checklist-item.ts` | Mark a checklist item done/undone. On toggle, if the completed item is one of the allow-listed items mapped to a HubSpot deal property, write back to HubSpot deal. |
| `advance-stage.ts` | Internal helper + manual override endpoint (not called directly in normal flow). |
| `shared.ts` | Stage-map constants, checklist templates, write-back property map. |

### Webhook contract
- Route: `POST /integrations/hubspot/webhooks/hiring` (no auth; signature verified).
- Handle events: `deal.creation`, `deal.propertyChange` (filter: pipeline, dealstage, dealname, associated contact email, owner).
- On first creation inside `hiring` pipeline: create hiring loop in SOURCING with default checklist template.
- On stage change: update `stage`, `hubspot_stage_id`, `hubspot_stage_label`; append to stage history; do **not** reset or drop checklist items already completed.
- On "Exited": set `stage=CLOSED`, record `closed_reason` if HubSpot has a `closed_lost_reason` property.

### Write-back to HubSpot (Aerostack → HubSpot)
Maintain a property map in `shared.ts`:
```
nda_signed        → hs_nda_signed (bool)
comp_plan_agreed  → hs_comp_plan_agreed (bool)
offer_letter_signed → hs_offer_signed (bool)
deel_record_created → hs_deel_record_created (bool)
```
On checklist toggle, if key is in the map, PATCH the deal via `client.crm.deals.basicApi.update`. These custom properties need to be created in HubSpot first — include a one-off script `infra/scripts/hubspot-create-hiring-properties.ts` that idempotently creates them.

### API Gateway wiring
Extend `infra/src/lib/stacks/api-aerostack-stack.ts`:
- `/hiring-loops` (GET list, POST create) — authorized, requires ENGINEER or PEOPLE_OPS role.
- `/hiring-loops/{id}` (GET, PATCH)
- `/hiring-loops/{id}/checklist/{itemKey}` (PATCH)
- `/hiring-loops/{id}/advance` (POST, manual override, admin only)
- `/integrations/hubspot/webhooks/hiring` (POST, **unauthenticated**, signature-verified inside handler)

Add OpenAPI docs to match existing `infra/src/functions/openapi/` style.

### Permissions
Add a `PEOPLE_OPS` role to `UserRole` enum in `shared/auth-utils.ts` (if not present) and gate hiring routes with `withPermissions`.

### Config
New env vars on the hiring Lambdas:
- `HIRING_LOOPS_TABLE_NAME`
- `HUBSPOT_WEBHOOK_SECRET` (Secrets Manager entry)
- `HUBSPOT_HIRING_PIPELINE_ID` (hardcoded after discovery, env-configurable)

---

## 4. Frontend — `pwa-frontend`

### New feature module: `src/features/hiring/`
- `hiring.api.ts` — thin client calling new routes via `apiClient` (not `executable`; this is a REST flow, not Squid).
- `hiring.slice.ts` — Redux slice with `fetchHiringLoops`, `selectByStage`, `toggleChecklistItem` thunks and optimistic updates.
- `types.ts` — mirror backend Zod types.

### New page: `src/pages/HiringBoard.tsx`
Kanban-style board with columns for each Aerostack stage. Each card shows:
- candidate name, role/department, owner
- checklist progress `(n/m done)`
- warning badge if a stage-required item is missing past SLA
- link out to HubSpot deal

Reuse existing `Dashboard*` styling and the board component pattern from `DashboardDelivery.tsx` / `DashboardOpps.tsx` where applicable.

### New page: `src/pages/HiringCandidate.tsx`
Detail view: candidate info form (editable metadata), checklist grouped by stage with toggle + notes, HubSpot deal link, stage history timeline, NDA/comp plan link fields.

### Routing
Register routes in `src/routes.tsx` — `/hiring` (board) and `/hiring/:id` (detail). Add sidebar entry "Hiring" under People Ops section.

### Entry point from existing People dashboard
Add a "Hiring Loops" section/card to `DashboardPeopleOps.tsx` linking to `/hiring`.

---

## 5. Open Questions (blockers before build)

Confirmed for the agent to surface back to Will — do **not** guess:

1. HubSpot pipeline ID for `hiring` (needed for webhook filter).
2. Which HubSpot custom deal properties already exist for: department, role/title, expected start date, NDA link, comp plan link, recruiter owner. If absent, add to the one-off property-creation script.
3. Where NDA and comp plan documents live (HubSpot file link vs Google Drive URL). Drives whether Aerostack stores a URL field or a file reference.
4. Exact write-back property names preferred by People Ops.
5. Whether "Applied" should auto-send NDA or remain manual (current assumption: manual, team ticks the checkbox).

---

## 6. Build Order (suggested PRs)

1. **Schemas + table + repo** — `hiring-loop.schema.ts`, table in CDK, repository. No behavior yet.
2. **HubSpot property bootstrap script** — creates custom deal properties; run once manually.
3. **Webhook handler + signature verification** — create/advance hiring loop on deal events. Test against HubSpot developer app webhook simulator.
4. **CRUD Lambdas + API routes** — list/get/update/toggle-checklist.
5. **Write-back on checklist toggle** — PATCH deal properties on whitelisted items.
6. **Frontend board + detail pages** — wire to API, optimistic toggles.
7. **People Ops dashboard entry + sidebar nav**.
8. **E2E smoke test** — create deal in HubSpot sandbox, watch it appear; toggle NDA signed in Aerostack, verify deal property updated.

---

## 7. Explicit Non-Goals (Phase 1)

- No auto-provisioning of Google/Slack/GitHub/Linear/Moodle. ONBOARDING checklist items are **manual checkboxes only**.
- No Bedrock state-compliance agent.
- No Tech Shift (1099 → W2) pipeline — only the `hiring` pipeline is wired.
- No backfill of historical deals beyond what the existing `ingest.ts` already pulls; hiring loops are created going forward from webhook events. (If backfill is wanted, run a one-time script that scans existing `hiring`-pipeline deals in `integrations-raw` and seeds the table — flag as optional.)

---

## 8. Files to Create / Modify (checklist)

**New**
- `infra/src/shared/validation/hiring-loop.schema.ts`
- `infra/src/repos/hiring-loop.repository.ts`
- `infra/src/functions/hiring-loops/*` (8 files per §3)
- `infra/src/lib/constructs/hiring-loops/` (CDK construct for the table + Lambdas)
- `infra/scripts/hubspot-create-hiring-properties.ts`
- `pwa-frontend/src/features/hiring/*`
- `pwa-frontend/src/pages/HiringBoard.tsx`
- `pwa-frontend/src/pages/HiringCandidate.tsx`

**Modified**
- `infra/src/lib/stacks/table-stack.ts` — add hiring loops table
- `infra/src/lib/stacks/api-aerostack-stack.ts` — add routes
- `infra/src/lib/models/` — add `hiring-loops.ts` model registry entry (mirror `loops.ts`)
- `infra/src/functions/openapi/` — hiring OpenAPI spec entries
- `infra/src/functions/shared/auth-utils.ts` — add `PEOPLE_OPS` role if missing
- `pwa-frontend/src/routes.tsx` — add `/hiring*` routes
- `pwa-frontend/src/pages/DashboardPeopleOps.tsx` — add Hiring Loops entry
