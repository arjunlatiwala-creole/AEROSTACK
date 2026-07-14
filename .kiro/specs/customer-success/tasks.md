# Aerostack Customer Success — Tasks

> Build rhythm: build a slice → deploy to dev → leave reviewable → next slice. Mark `[x]` when done.
> Greenfield additive backend (no logical-ID changes). Net-new Cloudscape frontend (Ops View + Customer View @ portal.enterprise.ai, separate Cognito pool).
> Build order: ticketing first (zero external-API dependency).

## Phase 1 (CS-1) — Support ticketing (ships first)

### Task 1: Ticket types + SLA helper
- [x] `common/src/types/customer-success.ts` with `SupportTicket`, `TicketMessage`, `Account`, `Renewal`, `CsatResponse`, `SuccessPlan`, `Escalation`, `CSConfig`, provider interfaces
- [x] Pure `computeSla(priority, now)` helper + `slaPaused`/`isResolutionBreached` logic (`common/src/utils/cs-sla.ts`)
- [x] Vitest tests for SLA math (P0–P3 first-response/resolution, pause-on-waiting) — passing

### Task 2: `support-tickets` table + construct
- [ ] New `support-tickets` DDB table (PK/SK/GSIs per design; KMS CMK, Retain + UpdateReplace Retain, 7 tags)
- [ ] New `CustomerSuccessApi` construct (no edits to existing constructs)

### Task 3: Ticket CRUD + messages handlers
- [ ] `POST/GET /cs/tickets`, `GET/PUT /cs/tickets/{id}`, `POST /cs/tickets/{id}/messages`
- [ ] `internal_only` stripped server-side for Customer View; SLA recompute on transition
- [ ] SLA breach → Slack alert
- [ ] `withPermissions` resource key `operations/customer-success`; tenant + CSM isolation
- [ ] Deploy to dev; review

---

## Phase 3 (CS-3) — Account entity + composite health
> (CS-3 before CS-2 in build value: health rollup is the headline; cost/security providers can be stubbed behind seams.)

### Task 4: Account entity + health rollup
- [ ] `cs-accounts` table (by-csm GSI)
- [x] `computeAccountHealth(inputs, weights)` pure function + Vitest fixtures (`common/src/utils/cs-health.ts`; weighted, missing-input renormalization, fail-safe RED, clamping) — passing
- [ ] `GET /cs/accounts` (CSM-scoped), `GET /cs/accounts/{id}`, `PUT /cs/accounts/{id}/csm`
- [ ] delivery_health from delivery loops; support_health from tickets; deal_health from mirror
- [ ] Deploy to dev; review

---

## Phase 2 (CS-2) — Tier-0 data surfaces behind providers

### Task 5: Provider seams (stub-first)
- [ ] `CostDataProvider` / `PostureProvider` / `ComplianceProvider` interfaces + stub impls
- [ ] `GET /cs/cost`, `/cs/security`, `/cs/compliance`
- [ ] Cost Explorer wins on conflict (reconciliation rule)

### Task 6: Governance-role separation (HARD CATCH)
- [ ] Dedicated read-mostly governance role for provider IAM, provisioned ALONGSIDE (not inside) the Peregrine migration role
- [ ] Live integrations land behind the seam later

---

## Phase 4 (CS-4) — Renewals + CSAT/NPS

### Task 7: Renewals
- [ ] `cs-renewals` table; `GET /cs/renewals`, `PUT /cs/renewals/{id}`; at-risk flag; date-window query

### Task 8: CSAT/NPS (replaces scaffold)
- [ ] `cs-csat` table; `POST /cs/csat/surveys`, `POST /cs/csat/responses`, `GET /cs/csat/trends`
- [ ] contact_email RESTRICTED (no logs, no client cache); remove the "coming soon" path

---

## Phase 5 (CS-5) — Success plans + escalations

### Task 9: Success plans / QBR
- [ ] `cs-plans` table; `GET|PUT /cs/accounts/{id}/plan`

### Task 10: Escalations
- [ ] `cs-escalations` table; `GET|POST /cs/escalations`

---

## Customer View (standalone @ portal.enterprise.ai)

### Task 11: Separate Cognito pool + dual-view filtering
- [ ] Customer Cognito pool (separate from internal); server-side tenant_id scope + internal-field strip
- [ ] Separate CloudFront distribution for portal.enterprise.ai

---

## Frontend (Cloudscape, net-new — parallel as slices land)

### Task 12: enterprise Ops View Cloudscape shell
- [ ] AppLayout + SideNavigation: Portfolio, Account, Tickets, Renewals, CSAT/NPS, Escalations
- [ ] Tickets queue first (anchor surface); TanStack Query hooks
- [ ] Deploy to dev; review

### Task 13: Customer View Cloudscape shell
- [ ] Overview, Support, Cost, Security, Compliance, Engagement (customer-safe renderers)
- [ ] No client-side PII caching
- [ ] Deploy to dev; review
