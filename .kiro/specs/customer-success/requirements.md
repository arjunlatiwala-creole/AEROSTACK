# Aerostack Customer Success — Requirements

## Overview
Stand up the **customer-facing managed-services value surface** — the single pane where a customer sees every operated outcome enterprise runs for them (delivery, cost, security posture, compliance, support), and the enterprise-side surface where the team manages that book of business. enterprise's MSP model sells **operated outcomes, not licenses**; this surface makes those outcomes visible.

CS in `enterprise-aerostack` is **greenfield**: a "coming soon" CSAT stub, a delivery dashboard that can split internal-vs-customer work, and the HubSpot CRM mirror are all that exist. Everything else is built here. Source PRD: `docs/inputs/PRD-Aerostack-Customer-Success-v0.1.md`.

## Tier / Architecture Alignment
- **Tier 3** Aerostack-class business application; **customer-facing** sibling of internal-facing RevOps.
- **Deployment mode: enterprise-hosted SaaS** — aggregates partner/API data, curates it, presents to the customer. NOT split-plane. `tenant_id` provides row-level isolation now and relocatability later.
- Spans **Delivery** (account health), **Revenue** (renewals/ARR), **Compliance** (security/posture). Produces **Knowledge** (CSAT/health → KB).
- Maturity: Observer → Advisor (renewal risk, escalation prompts). Operator (auto-remediation) out of scope.

## Build Posture (non-negotiable)
- **Backend — greenfield additive.** New CS modules under `tools-api/functions/cs/` (+ `infra/src/functions/cs/`). Reuse: delivery loops (`get-delivery-loop.ts`), HubSpot mirror (`deals`/`companies`/`contacts`), Deel people (CSM assignment), `withPermissions`. The CSAT scaffold (`tools-api/functions/csat/handler.py`) is replaced/absorbed. **No logical-ID changes to existing constructs; no edits to unrelated in-flight handlers.** Merge via `dev`.
- **Frontend — net-new Cloudscape (both registers).** enterprise Ops View (portfolio across all customers) AND Customer View (self-service, own tenant only). Customer View deploys standalone @ `portal.enterprise.ai` with its **own Cognito pool** (security boundary, decided). Reuse partnerready.ai / Peregrine Ops Cloudscape portal patterns.
- **Every CS record carries `tenant_id`** from line one. CS holds prepared customer data — tenant isolation is load-bearing.
- **Reuse, don't rebuild** partnerready.ai's Cost Explorer / posture / customer-portal *patterns* (separate product; link it for MSP customers later, do not re-spec it).
- **Providers behind abstractions** so the underlying Tier-0 tool can swap without touching the dashboard.

## Requirements

### Phase 1 (CS-1) — Support ticketing (anchor surface, ships first; zero external-API dependency)

1. **FR-1: Ticket store + CRUD**
   - `support-tickets` table: PK `TENANT#{tenant_id}`, SK `TICKET#{id}` | `TICKET#{id}#MSG#{ts}` | `TICKET#{id}#EVENT#{ts}`. GSIs: by-status, by-assignee, by-priority.
   - `SupportTicket` (priority P0–P3, status open/waiting/in_progress/resolved/closed, assignee, SLA fields, `sla_breached`). `data_classification: 'CONFIDENTIAL'`.
   - `POST /cs/tickets`, `GET /cs/tickets` (queue), `GET /cs/tickets/{id}` (+ thread), `PUT /cs/tickets/{id}` (status/assignee/priority → SLA recompute).

2. **FR-2: Threaded messages with internal-only flag**
   - `TicketMessage` with `internal_only: boolean` (enterprise-ops notes the customer never sees).
   - `POST /cs/tickets/{id}/messages`. `internal_only` messages are stripped server-side for the Customer View.

3. **FR-3: SLA framework**
   - Business hours 9–6 ET; P0 runs 24/7; clock pauses while `waiting` (on customer). First-response: P0 1h · P1 4h · P2 8bh · P3 2bd. Resolution: P0 4h · P1 1bd · P2 3bd · P3 best-effort.
   - SLA breach fires a Slack alert.

### Phase 2 (CS-2) — Tier-0 data surfaces behind providers

4. **FR-4: Cost surface (`CostDataProvider`)**
   - `GET /cs/cost?account_id=` behind `CostDataProvider` (AWS Cost Explorer `ce:GetCostAndUsage` = source of truth, + Archera coverage, + MontyCloud inventory). On conflict, **Cost Explorer wins**. Reuse partnerready.ai's Cost Explorer pattern.

5. **FR-5: Security posture (`PostureProvider`)**
   - `GET /cs/security?account_id=` behind `PostureProvider`. Base tier = AWS Security Hub + Config via MontyCloud (shipping). Upwind = planned upgrade (provider swap, not rebuild).

6. **FR-6: Compliance (`ComplianceProvider`)**
   - `GET /cs/compliance?account_id=` behind `ComplianceProvider` (Drata control status, audit readiness, SOC 2 coverage).

7. **FR-7 [HARD CATCH]: Governance-role separation.** Foundations data permissions (`ce:GetCostAndUsage`, `budgets:*`, `securityhub:GetFindings`, `config:` read) live in a **separate, dedicated, read-mostly governance role provisioned alongside (NOT inside) the Peregrine migration role.** Do not add these to the migration role.

### Phase 3 (CS-3) — Account entity + 7-input composite health

8. **FR-8: Account entity**
   - `Account` keyed to HubSpot companyId; CSM (Deel person), segment, ARR. `data_classification: 'CONFIDENTIAL'`.
   - `GET /cs/accounts` (portfolio; CSM-scoped for CSM role), `GET /cs/accounts/{id}`, `PUT /cs/accounts/{id}/csm` (Admin/CS lead).

9. **FR-9: 7-input composite health**
   - Weighted composite → GREEN/YELLOW/ORANGE/RED: delivery 25%, support 20%, cost 15%, security 15%, compliance 10%, commercial 10%, engagement 5%.
   - Raises at-risk flag **30+ days before renewal**. No single tool produces this — it's the cross-tier churn signal.

### Phase 4 (CS-4) — Renewals + CSAT/NPS

10. **FR-10: Renewals**
    - `Renewal` (date, term, ARR, status upcoming/in_progress/won/lost/at_risk, risk_reason). `GET /cs/renewals`, `PUT /cs/renewals/{id}`.

11. **FR-11: CSAT/NPS (replaces the scaffold)**
    - `POST /cs/csat/surveys`, `POST /cs/csat/responses`, `GET /cs/csat/trends?account_id=`. `CsatResponse.contact_email` is customer PII → RESTRICTED in storage/logs.

### Phase 5 (CS-5) — Success plans + QBR + escalations

12. **FR-12: Success plans / QBR** — `GET|PUT /cs/accounts/{id}/plan` (objectives, last/next QBR).
13. **FR-13: Escalations** — `GET|POST /cs/escalations` (severity, owner, status).

### Customer View (standalone @ portal.enterprise.ai)

14. **FR-14: Dual-view renderer**
    - Same APIs, **separate Cognito pool**, server-side `tenant_id` scoping + internal-field stripping. No new routes — a filtered renderer over the CS APIs. Separate CloudFront distribution.

### Cross-cutting

15. **NFR-1: Data classification.** CS entities `CONFIDENTIAL`; `contact_email` RESTRICTED. KMS CMK on CS tables.
16. **NFR-2: IAM least-privilege.** Read scoped to `companies`/`deals`/`contacts` + delivery loops; write to new `cs-*` tables only. No wildcard ARNs. Governance-role separation (FR-7).
17. **NFR-3: Tenant isolation (load-bearing).** `tenant_id` on every record and query; cross-tenant + cross-CSM reads fail closed.
18. **NFR-4: RBAC.** CSM sees only assigned accounts (`csm_email == caller`); CS lead/Admin see all. `withPermissions` resource key `operations/customer-success`.
19. **NFR-5: Audit logging.** CSAT capture, CSM reassignment, escalation open/close, account-detail export.
20. **NFR-6: Tests/coverage.** Vitest 80/75/80/80; health-rollup tests against fixtures; tenant- and CSM-isolation tests; PII-in-logs test (no `contact_email`).
21. **NFR-7: Rollback.** Additive tables; `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain` on ALL CS tables (never destroy customer data).
22. **NFR-8: Tags.** `enterprise:module=customer-success`, `enterprise:workload=aerostack`, `enterprise:grc=soc2`, + standard.
23. **NFR-9: No client-side PII.** CS UI must not cache contact emails (localStorage check is HIGH).
24. **NFR-10: Cloudscape + WCAG 2.1 AA** both views; portfolio list p95 < 1s.
25. **NFR-11: Deploy-for-review rhythm.** Every slice deploys to dev for review and iterates there. Never promote to production.

## Acceptance Criteria
- `Account` exists per HubSpot company with computed `health` reflecting deal/delivery/CSAT inputs.
- `GET /cs/accounts` returns a CSM's own accounts only as CSM; full portfolio for CS lead/Admin.
- CSAT responses persist; `GET /cs/csat/trends` returns a time series (the "coming soon" path is gone).
- Renewals appear in `GET /cs/renewals` with status + at-risk flag, queryable by date window.
- Support tickets: open/track/resolve with SLA timers; `internal_only` messages stripped for Customer View.
- Every CS record carries `tenant_id`; cross-tenant and cross-CSM read tests fail closed; no `contact_email` in logs.
- CS tables carry `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain`, KMS CMK, 7 `enterprise:*` tags.
- Every slice deploys to dev for review before production wiring.
