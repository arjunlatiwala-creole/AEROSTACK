# **Aerostack Customer Success — PRD v0.1**
# **The managed-services value surface: one pane for every operated outcome enterprise runs for a customer**

**document:** PRD — Aerostack Customer Success Module
**version:** 0.1
**status:** Draft — authored against codebase reconciliation (2026-06-27)
**author:** Will Horn (with Kiro)
**date:** 2026-06-27
**applies_to:** enterprise-aerostack (enterprise internal work system; candidate for product repackaging)
**lineage:** A Build-ready Product (greenfield surface; PRD is the spec)
**tier (per Architecture Canon):** Tier 3 — Aerostack-class business application (and the home of the dual-nature managed-service wrappers)
**references:**
- `Enterprise-Architecture-Canon-Four-Tier-Stack.md` (Tier 2 keystone this PRD aligns to)
- `Aerostack-Doc-vs-Code-Audit-2026.06.27.md`, `Aerostack-Loops-Model-Audit-Batch2-2026.06.27.md` (this project)
- Sibling PRD: `enterprise-aerostack/docs/inputs/PRD-Aerostack-Q2C-v0.2.md`; companion: `PRD-Aerostack-RevOps-Productivity-v0.1.md`
- **Source files (real paths):**
  - `tools-api/functions/csat/handler.py` (scaffold — "coming soon")
  - `pwa-frontend/src/pages/DashboardCsat.tsx` (stub); `components/aerostack/CsatTools.tsx` (unwired stub)
  - `infra/src/functions/delivery/list-delivery.ts` (`INTERNAL_TEAM_KEY="GINT"`, customer/internal split, Linear `health` passthrough)
  - `infra/src/functions/loops/get-delivery-loop.ts` (ENG/MSP delivery loops + Deel join)
  - `infra/src/schemas/hubspot/deals.ts`; `infra/src/functions/hubspot/deals-list.ts` (CRM mirror)
  - `database/schema-revops-v2.sql` (`people.team_area='Customer Success'`, `health_status` enum, `deal_events`)

---

## 0. TL;DR / What changed from v0

**The reframe (v0.1 → this version):** CS is not only CRM-shaped (account-health + renewals + CSAT + success plans). It is the **customer-facing managed-services value surface — the single pane where a customer sees every operated outcome enterprise runs for them**, and the enterprise-side surface where our team manages that book of business. enterprise's MSP model sells **operated outcomes, not licenses**; this surface is where those outcomes (delivery, cost, security posture, compliance readiness, support) become visible. This is the net-new **enterprise-business Tier-3 applied application** we are building now — get the enterprise operation visible and efficient.

Customer Success in `enterprise-aerostack` is **greenfield**. What exists: a "coming soon" CSAT stub, a delivery dashboard that can split internal-vs-customer work, and the HubSpot CRM mirror. Everything else — account-level health rollup, support ticketing, cost/security/compliance surfaces, renewals, CSAT/NPS, success plans, QBRs, escalations, the customer portal — does not exist and is built here.

**Prior art (reuse, don't rebuild):** the sibling product **partnerready.ai** (a *different* product — the first applied enterprise *partner* product, naming/deployment still being clarified in the AIDLC dogfooding process) already has in-flight **AWS Cost Explorer** (`ce:GetCostAndUsage`), **APN posture** (via Kestrel), and a **Customer Portal** surface. Where that logic is genuinely reusable, build off it / lift the pattern (and note the future interface link — MSP customers here may eventually use partnerready.ai and need it linked). But this PRD is **not** an extension of partnerready.ai; it is the enterprise-business CS surface.

---

## 0.1 Architecture Canon alignment  [per Enterprise-Architecture-Canon-Four-Tier-Stack.md]

- **Tier:** Tier 3 — Aerostack-class business application (the ABP resell layer / digital services).
- **Class / deployment mode:** An expression of the Aerostack class (Tier 2). Deployment is a **flexible dimension** (the partnerready.ai lesson), not a binary — an Aerostack-class instance can run **internal mode** (enterprise's own ops), **enterprise-hosted SaaS mode** (enterprise hosts it multi-tenant), or **customer-account / split-plane mode** (customer owns the deployment). **This CS support/comms portal is enterprise-hosted SaaS** — it is NOT split-plane: it *aggregates* data from partner tooling + APIs + operated outcomes, **prepares/curates** it, and **presents it to the customer** in the interactive support + comms surface. `tenant_id` (§10/§11.3) is what makes this flexible — **row-level isolation** between customers inside the enterprise-hosted portal today, and **relocatable** to a dedicated/customer-account deployment for a specific customer later without re-architecting.
- **Flow:** Spans **Delivery** (account health from delivery loops), **Revenue** (renewals/ARR), and **Compliance** (the security/posture surface). Produces **Knowledge** (CSAT/health signals feed the KB). Feeds the **Operational Cadence Module's** #custeng meeting.
- **Runs on:** Peregrine + Kestrel (Tier 1) → AWS + GitHub operated by MSP tooling (Tier 0).
- **Maturity model:** Observer (surface health) → Advisor (renewal risk, escalation prompts) in this PRD; Operator (auto-remediation) out of scope.
- **Sibling surfaces (same architecture/platform, different audience):** **CS Module = customer-facing** · **RevOps = internal-facing** (`PRD-Aerostack-RevOps-Productivity-v0.1`) · **partnerready.ai = AWS-partner-facing** (separate product; MSP customers here may eventually use it — link it in the Customer View, reuse its cost/posture/portal patterns). These three are siblings, not layers.

### The dual-nature managed-service surface  [Canon: "Tier 0 tool + Tier 3 service wrapper"]

The CS Module is the **primary Tier 3 dashboard that surfaces the dual-nature Foundations tools as managed outcomes**. Per the Canon, enterprise sells *operated outcomes*, not licenses. The same tools that operate the substrate at Tier 0 reappear here, wrapped as sellable managed services and rendered on the account view:

| Managed outcome (Tier 3 wrapper) | Tier 0 tool operated underneath | Surfaced on the CS account view as |
| :---- | :---- | :---- |
| Managed cloud cost control | Archera (commitments / RIs / Savings Plans) | cost posture + savings on the account |
| Managed security posture | **Base now:** AWS Security Hub + Config via MontyCloud · **Upgrade (planned):** Upwind runtime CNAPP | account security posture / findings (base) → runtime depth (upgrade) |
| Managed compliance | Drata (SOC 2, continuous-control monitoring) | audit-readiness / control status |
| Managed cloud ops | One-CT / MontyCloud | cloud-ops health |

This is a **Phase-4 extension** of the module (after the core health/renewal/CSAT phases): the account-health rollup (§6) gains a *security & compliance posture* input sourced from these tools. The base/upgrade security tier is a productization lever — ship the managed-security surface on native AWS (SecHub/Config) now, upsell the Upwind-resolved package later. **Upwind is planned, not yet adopted**; base = SecHub/Config via MontyCloud is the shipping reality, so this surface ships on the base tier first.

---

## 1. Background & current state

CS is a **Tier-3 Aerostack-class business application** (per the Architecture Canon) that should sit on the same data plane as RevOps and Delivery. Today, "health" exists only in two disconnected places — per-deal (GREEN/YELLOW/ORANGE/RED in the RevOps deals path) and per-Linear-update (`health` string passed through delivery) — and is **never rolled up to a customer account**. There is no account entity that aggregates a customer's deals + delivery loops + satisfaction into one health score. The Postgres design schema names a `Customer Success` `team_area` and a `health_status` enum but implements neither a CS surface nor account-health.

---

## 2. What exists today  [BUILT/PARTIAL/GAP reconciliation]

| Capability | File evidence | Status | Gap / delta |
| :---- | :---- | :---- | :---- |
| CSAT survey / scoring / NPS API | `tools-api/functions/csat/handler.py` — returns `"CSAT action '{action}' — coming soon"`; no infra construct | GAP | Pure scaffold; no store, no survey, no NPS |
| CSAT frontend | `pwa-frontend/src/pages/DashboardCsat.tsx` (stub); `components/aerostack/CsatTools.tsx` (unwired) | GAP | "Platform overview coming soon" |
| Internal vs customer segmentation | `infra/src/functions/delivery/list-delivery.ts` (`INTERNAL_TEAM_KEY="GINT"`, `CUSTOMER_LOOP_CATEGORIES={BD,GTM}`) | PARTIAL | Delivery scope, not a CS account view |
| Delivery progress + health passthrough | `list-delivery.ts` (progress buckets; Linear `health` per update); `get-delivery-loop.ts` (ENG/MSP loops + Deel) | PARTIAL | No onTrack/atRisk/offTrack rollup to account |
| Customer relationship records | `infra/src/schemas/hubspot/deals.ts`; joins in `deals-list.ts` (HubSpot→DynamoDB `deals`/`contacts`/`companies`) | BUILT | CRM mirror; not CS-shaped; no account object |
| Support ticketing / SLA | — (only the unrelated CSAT stub) | GAP | Greenfield; ships first (CS-1) |
| Cost surface (Cost Explorer) | not in `enterprise-aerostack`; **exists in partnerready.ai** (`ce:GetCostAndUsage`, admin "Platform Costs") | GAP in enterprise-aerostack / **PARTIAL as reusable prior art** | Lift the pattern from partnerready.ai; do not rebuild from scratch |
| Security posture / compliance | — (steering text only; no SecHub/Config/Drata integration) | GAP | Greenfield; base tier = SecHub/Config; Upwind planned |
| Customer portal (standalone, 2nd Cognito pool) | not in `enterprise-aerostack`; **a Customer Portal surface exists in partnerready.ai** | GAP in enterprise-aerostack / **PARTIAL as reusable prior art** | Reuse portal pattern; separate pool decided |
| `partner-engagements` engagement record | none — `infra/src/functions/partner-central/*` is APN integration, not CS | GAP | No CS engagement/account record exists |
| Account composite health / renewal / churn / success plan / QBR | — | GAP | Entirely unbuilt |

> **Branch/commit verification (2026-06-27):** scan of `enterprise-aerostack` main + dev + all PR branches + full commit history found **none** of these surfaces in code (the dev branch is delivery/docs/auth/zoom/learning/hiring/Dropbox-Sign only). Cost Explorer + Customer Portal are **in-flight in the separate partnerready.ai product**, cited above as reusable prior art. Caveat: unpushed/no-PR local branches by the dev team (Divya, Rudresh, others) are not visible via the GitHub API.

---

## 3. Goals & non-goals / scope boundaries

**Goals**
* Stand up the **managed-services value surface** — one pane exposing every operated outcome (delivery, cost, security posture, compliance, support) per customer, in **two views**: a **enterprise Ops View** (portfolio across all customers) and a **Customer View** (self-service, their data only).
* Ship **support ticketing** as the anchor customer-interaction surface (highest-frequency touchpoint, zero external-API dependency — ships first).
* Define a first-class **Account** entity with a **7-input composite health score** (delivery, cost, security, compliance, support, engagement recency, commercial) — a cross-tier churn signal no single tool produces.
* Expose **cost / security-posture / compliance** surfaces, each behind a **provider abstraction** (`CostDataProvider` / `PostureProvider` / `ComplianceProvider`) so the underlying Tier-0 tool can change without touching the dashboard.
* Build **renewal tracking** (date, term, ARR-at-risk, pipeline) + churn signals; **CSAT/NPS capture + trends**; **success plans / QBR**; **escalations/risk-flag** list.
* Deploy the Customer View **standalone at `portal.enterprise.ai`** with its own Cognito pool (security boundary), notifications across Email (SES) + Slack + in-app.

**Non-goals**
* Replacing HubSpot as CRM source of truth; product-usage/adoption telemetry ingest (future phase — no usage signal exists today).
* RevOps pipeline/forecast (separate PRD — companion).
* Building partnerready.ai or its PRM (that is a separate partner product; reuse its cost/posture/portal *patterns* where useful, link it in the interface for MSP customers later, but do not re-spec it here).
* Adopting Upwind (planned, not adopted — security ships on the AWS SecHub/Config base tier).

**Depends on**
* HubSpot mirror (`deals`/`companies`/`contacts`); delivery loops (`get-delivery-loop.ts`); Deel people (CSM assignment); Auth/RBAC (extend — add customer Cognito pool, don't re-spec auth).
* Tier-0 data via providers (Cost Explorer / SecHub+Config / Drata) — all greenfield integrations behind the provider seams.

---

## 4. Personas

| Persona | What they do | Surface | Exists today? |
| :---- | :---- | :---- | :---- |
| CSM (Customer Success Manager) | Owns a book of accounts; drives health, renewal, success plan; works tickets | enterprise Ops View (new) | No |
| CS lead | Monitors portfolio health, at-risk accounts, renewal forecast | enterprise Ops View portfolio (new) | No |
| Delivery owner | Flags delivery risk that affects account health | delivery → account link (new) | Partial |
| **Customer admin/user** | Self-service: sees own cost, security, compliance, tickets, engagement status; opens tickets | **Customer View @ portal.enterprise.ai** (new) | No |
| Customer contact | Receives CSAT/NPS surveys; raises support tickets | survey + ticket surface (new) | No |
| Agent/automation | Reads account health/renewals/escalations for the CustEng cadence | `/cs/accounts` API | No |

---

## 5. Information architecture

Two views of the same data plane (dual-view):

```
enterprise OPS VIEW  (internal — portfolio across all customers; internal notes + commercial context)
├── Portfolio       [NEW]  accounts grid · composite health · CSM · renewal · ARR-at-risk
├── Account         [NEW]  one account: health inputs · tickets · cost · security · compliance ·
│                          delivery loops · CSAT trend · success plan · escalations · internal notes
├── Tickets         [NEW]  support queue · SLA timers · assignee · internal-only notes
├── Renewals        [NEW]  renewal pipeline · upcoming · at-risk ARR · forecast
├── CSAT / NPS      [NEW]  survey config · scores · trend (replaces the stub)
└── Escalations     [NEW]  risk flags · open issues · owner · status

CUSTOMER VIEW @ portal.enterprise.ai  (external — their tenant only; NEVER internal notes / other tenants / margin)
├── Overview        [NEW]  their account health (customer-safe) · open tickets · upcoming renewal
├── Support         [NEW]  open/track tickets · message thread (customer-visible messages only)
├── Cost            [NEW]  their AWS cost + savings (Cost Explorer source of truth + Archera coverage)
├── Security        [NEW]  posture summary (base: SecHub/Config; upgrade: Upwind)
├── Compliance      [NEW]  control/audit-readiness status (Drata)
└── Engagement      [NEW]  delivery status · success-plan objectives
```

**Dual-view rule:** same underlying data, two renderers. Customer View is filtered server-side to the caller's `tenant_id` and strips internal-only fields. It deploys **standalone** (separate CloudFront distribution, **separate Cognito pool** from the enterprise-internal pool — decided: the security boundary is worth the ops overhead).

**Design system — Cloudscape (REQUIRED, both registers, for enterprise.ai product-language consistency).** **Both** the customer-facing Customer View **and** the enterprise Ops View are built in **AWS Cloudscape** — the same design system **partnerready.ai and One-CT / Peregrine Ops already use**. Every enterprise.ai product surface speaks one visual/product language; no split-brain UI. This applies to everything this PRD builds (customer- and internal-facing alike). The only code that stays on the existing `pwa-frontend` (shadcn/ui + Tailwind) is pre-existing screens this PRD does not touch. Reuse partnerready.ai's / Peregrine Ops' Cloudscape portal patterns and components.

---

## 6. Features by build phase

> **Build order (per A9):** ticketing first (zero external-API dependency, highest frequency) → cost/security/compliance surfaces → composite health + cross-flow → intelligence. Phases below are numbered in build order.

### Phase 1 (CS-1) — Support ticketing (anchor surface, ships first)
**Owner module/agent:** `agent-cs` / `tools-api/functions/cs` (+ `infra/src/functions/cs/`)
**Capabilities:** the primary customer-interaction surface — open/track/resolve tickets, threaded messages, SLA timers, internal-only notes. No external API dependency, so it ships before the Tier-0 data surfaces.

**Data model (verbatim types):**
```typescript
// support-tickets table — PK TENANT#{tenant_id}, SK TICKET#{id} | TICKET#{id}#MSG#{ts} | TICKET#{id}#EVENT#{ts}
// GSIs: by-status, by-assignee, by-priority
interface SupportTicket {
  tenant_id: string;                       // [REQUIRED]
  ticket_id: string;
  account_id: string;
  subject: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'open' | 'waiting' | 'in_progress' | 'resolved' | 'closed';  // SLA clock pauses on 'waiting'
  assignee_email: string | null;
  sla_first_response_due: string | null;   // P0 1h · P1 4h · P2 8bh · P3 2bd
  sla_resolution_due: string | null;       // P0 4h · P1 1bd · P2 3bd · P3 best-effort
  sla_breached: boolean;                    // breach → Slack alert
  data_classification: 'CONFIDENTIAL';
  created_at: string; updated_at: string;
}
interface TicketMessage {
  tenant_id: string; ticket_id: string; ts: string;
  author_email: string;
  body: string;
  internal_only: boolean;                  // true = enterprise-ops note the customer never sees
  data_classification: 'CONFIDENTIAL';
}
```
SLA framework: business hours 9–6 ET; P0 runs 24/7; clock pauses while `waiting` (on customer); breach fires a Slack alert.

### Phase 2 (CS-2) — Tier-0 data surfaces behind providers
**Capabilities:** cost, security-posture, and compliance surfaces, each behind a provider abstraction so the underlying tool can swap (MontyCloud→One-CT, SecHub→Upwind) without touching the dashboard. **All greenfield in `enterprise-aerostack`; reuse partnerready.ai's Cost Explorer pattern where applicable.**
```typescript
interface CostDataProvider {   // Archera (commitments) + AWS Cost Explorer (ce:GetCostAndUsage, source of truth) + MontyCloud (inventory)
  getSpend(tenant_id: string, period: string): Promise<{ raw_spend_cents: number; committed_savings_cents: number | null; coverage_pct: number | null }>;
}
interface PostureProvider {     // base: AWS Security Hub + Config via MontyCloud (shipping) · upgrade: Upwind (PLANNED)
  getPosture(tenant_id: string): Promise<{ posture: 'GREEN'|'YELLOW'|'ORANGE'|'RED'; tier: 'base'|'upwind'; findings_count: number }>;
}
interface ComplianceProvider { // Drata
  getComplianceStatus(tenant_id: string): Promise<{ status: 'on_track'|'gaps'|'at_risk'; soc2_coverage_pct: number; evidence_progress_pct: number }>;
}
```
**Cost reconciliation rule:** Cost Explorer is source of truth for raw spend (must match the customer's AWS console). Archera enriches with commitment/coverage; MontyCloud with inventory/optimization. On conflict, **Cost Explorer wins**.

### Phase 3 (CS-3) — Account entity + 7-input composite health
**Capabilities:** create the `Account` aggregate keyed to a HubSpot company; compute the **composite health score** (no single tool produces it — that's the point); assign a CSM.

**Data model (verbatim types):**
```typescript
interface Account {
  account_id: string;                      // keyed to HubSpot companyId
  tenant_id: string;                       // [REQUIRED] (see §11.3)
  company_name: string;
  csm_email: string | null;                // owning CSM (Deel person)
  segment: 'smb' | 'mid' | 'enterprise';
  arr_cents: number | null;
  health: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';   // composite, see weights
  health_inputs: {                          // 7 inputs, weighted composite
    delivery_health: number | null;        // 25% — delivery loops / Linear
    cost_trend: number | null;             // 15% — CostDataProvider
    security_posture: number | null;       // 15% — PostureProvider (base SecHub/Config)
    compliance_readiness: number | null;   // 10% — ComplianceProvider (Drata)
    support_health: number | null;         // 20% — ticket volume/SLA/CSAT on tickets
    engagement_recency: number | null;     //  5% — last meaningful touch
    commercial_health: number | null;      // 10% — renewal proximity / ARR risk
  };
  data_classification: 'CONFIDENTIAL';     // customer relationship data
  created_at: string; updated_at: string;
}
```
**Why composite:** a customer can have healthy delivery but degrading security and stalled compliance — only the CS surface sees all of it. This composite is the **cross-tier churn signal**; it raises the at-risk flag **30+ days before renewal**.

### Phase 4 (CS-4) — Renewals + CSAT/NPS
```typescript
interface Renewal {
  renewal_id: string;
  account_id: string;
  tenant_id: string;
  renewal_date: string;
  term_months: number;
  arr_cents: number;
  status: 'upcoming' | 'in_progress' | 'won' | 'lost' | 'at_risk';
  risk_reason: string | null;
  data_classification: 'CONFIDENTIAL';
}

interface CsatResponse {
  response_id: string;
  account_id: string;
  tenant_id: string;
  contact_email: string;
  score: number;                           // 1–5 CSAT
  nps: number | null;                      // 0–10 NPS, when collected
  comment: string | null;
  collected_at: string;
  data_classification: 'CONFIDENTIAL';     // contact email = customer PII
}
```

> **Note on the managed-service posture inputs (the dual-nature wrappers from §0.1):** these are now delivered by the CS-2 providers (`CostDataProvider`/`PostureProvider`/`ComplianceProvider`) feeding the CS-3 composite `health_inputs` — they are not a separate phase. Security ships on the **base** tier (AWS Security Hub + Config via MontyCloud); **Upwind is the planned upgrade**, a provider swap behind `PostureProvider`, not a rebuild.

### Phase 5 (CS-5) — Success plans + QBR + escalations
```typescript
interface SuccessPlan {
  plan_id: string; account_id: string; tenant_id: string;
  objectives: { title: string; status: 'open'|'in_progress'|'done'; due_date: string }[];
  last_qbr_date: string | null; next_qbr_date: string | null;
  data_classification: 'CONFIDENTIAL';
}
interface Escalation {
  escalation_id: string; account_id: string; tenant_id: string;
  severity: 'low'|'medium'|'high'|'critical';
  summary: string; owner_email: string; status: 'open'|'mitigating'|'resolved';
  opened_at: string; resolved_at: string | null;
  data_classification: 'CONFIDENTIAL';
}
```

---

## 7. Root-event lifecycle

`CLARIFY > VALIDATE > BUILD > OPERATE` — CS owns **OPERATE** (and the renewal loop back to CLARIFY).

| Stage | What CS does | Activation trigger |
| :---- | :---- | :---- |
| CLARIFY | (RevOps owns) — CS observes new logo signal | closed_won → account created |
| VALIDATE | Onboarding/success plan kickoff | engagement start |
| BUILD | Delivery loops tracked; health begins rolling up | first delivery loop |
| OPERATE | Health, CSAT, renewals, escalations managed; renewal → new CLARIFY | continuous |

Account health state: `GREEN ⇄ YELLOW ⇄ ORANGE ⇄ RED` (recomputed on input change). Renewal: `upcoming → in_progress → won|lost|at_risk`.

---

## 8. API surface

> CS APIs are Lambda modules under `tools-api/functions/cs/` (or `infra/src/functions/cs/`). The CSAT scaffold at `tools-api/functions/csat/handler.py` is replaced/absorbed. Frontend consumes the same APIs.

### 8.1 `/cs/accounts`
```
GET    /cs/accounts                        — Account[] (portfolio; CSM-scoped for CSM role)
GET    /cs/accounts/{id}                    — Account + rolled-up detail
PUT    /cs/accounts/{id}/csm                — assign/reassign CSM (Admin/CS lead)
```
### 8.2 `/cs/renewals`
```
GET    /cs/renewals                         — Renewal[] (pipeline, filter by status/date)
PUT    /cs/renewals/{id}                     — update renewal status/risk
```
### 8.3 `/cs/csat`  (replaces the scaffold)
```
POST   /cs/csat/surveys                      — create/send survey
POST   /cs/csat/responses                    — record a response
GET    /cs/csat/trends?account_id=           — CSAT/NPS trend over time
```
### 8.4 `/cs/plans`, `/cs/escalations`
```
GET|PUT  /cs/accounts/{id}/plan              — success plan
GET|POST /cs/escalations                     — list / open escalation
```
### 8.5 `/cs/tickets` (CS-1, ships first)
```
GET    /cs/tickets                           — queue (enterprise Ops: all; Customer View: own tenant)
POST   /cs/tickets                           — open a ticket
GET    /cs/tickets/{id}                       — ticket + message thread (internal_only stripped for Customer View)
POST   /cs/tickets/{id}/messages              — add message (internal_only flag, enterprise-side only)
PUT    /cs/tickets/{id}                        — update status/assignee/priority (SLA recompute)
```
### 8.6 `/cs/cost`, `/cs/security`, `/cs/compliance` (CS-2, behind providers)
```
GET    /cs/cost?account_id=                   — CostDataProvider (Cost Explorer + Archera + MontyCloud)
GET    /cs/security?account_id=               — PostureProvider (base SecHub/Config; upgrade Upwind)
GET    /cs/compliance?account_id=             — ComplianceProvider (Drata)
```
### 8.7 Customer View (standalone @ portal.enterprise.ai)
Same APIs, **separate Cognito pool**, server-side `tenant_id` scoping + internal-field stripping. No new routes — a filtered renderer over §8.1–8.6. Reuse partnerready.ai's customer-portal pattern where applicable.

---

## 9. Integrations / data sources

| Upstream / Downstream | System | Contract / shape | Notes |
| :---- | :---- | :---- | :---- |
| Upstream | HubSpot mirror | `companies` (→ Account), `deals` (→ deal_health), `contacts` (→ survey targets) | source of truth |
| Upstream | Delivery loops | `get-delivery-loop.ts` ENG/MSP loops + Linear health | → delivery_health input |
| Upstream | Deel people | CSM assignment (`team_area='Customer Success'`) | existing people store |
| Upstream | **Cost** (`CostDataProvider`) | AWS Cost Explorer `ce:GetCostAndUsage` (source of truth) + Archera (coverage) + MontyCloud (inventory) | greenfield in enterprise-aerostack; **reuse partnerready.ai's Cost Explorer pattern**. Conflict → Cost Explorer wins. |
| Upstream | **Security** (`PostureProvider`) | base: AWS Security Hub + Config via MontyCloud · upgrade: Upwind (PLANNED) | greenfield; provider swap, not rebuild |
| Upstream | **Compliance** (`ComplianceProvider`) | Drata (control status, audit readiness, SOC 2 coverage) | greenfield |
| Upstream | **Collections (composite, if AR shown)** | QuickBooks (authoritative ledger) + HubSpot (deal/contract context) + comms events (promise-to-pay) | greenfield; primarily a RevOps Block-3 concern — CS may surface per-account AR |
| Downstream | Operational Cadence Module | account health + escalations feed the #custeng meeting | reads `/cs/accounts`, `/cs/escalations`, `/cs/tickets` |
| Link-out | **partnerready.ai** | MSP customers who also use partnerready.ai → link it in the Customer View | future interface link; separate product |

---

## 10. Configuration model

> CS is **enterprise-hosted SaaS** (aggregates partner/API data, prepares it, presents to the customer). `tenant_id` is the **flexibility pattern** (like partnerready.ai): row-level isolation between customers in the enterprise-hosted portal now, relocatable to a dedicated/customer-account deployment per deal later — without re-architecting. Non-negotiable from line one.

```typescript
interface CSConfig {
  tenant_id: string;                       // unique per agreement
  deployment_mode: 'enterprise_saas' | 'dedicated' | 'customer_account';  // flexible (partnerready.ai pattern); default enterprise_saas
  customerName: string;
  features: { tickets: boolean; cost: boolean; security: boolean; compliance: boolean;
              renewals: boolean; csat: boolean; successPlans: boolean; escalations: boolean };
  health_weights: {                         // 7-input composite (defaults from CS-3)
    delivery: 0.25; cost: 0.15; security: 0.15; compliance: 0.10;
    support: 0.20; engagement: 0.05; commercial: 0.10;
  };
  security_tier: 'base' | 'upwind';        // base = SecHub/Config (shipping); upwind = planned
  customer_view: { enabled: boolean; domain: string };  // e.g. portal.enterprise.ai
  csat_cadence_days: number;
}
```

---

## 11. Cross-cutting / NFRs & GOVERNANCE GATES

**11.1 Data classification** — CS entities are `CONFIDENTIAL` (customer relationship data); `CsatResponse.contact_email` is customer PII → handle as RESTRICTED in storage/logs.

**11.2 IAM / least-privilege** — read scoped to `companies`/`deals`/`contacts` + delivery loops; write to new `cs-*` tables only. No wildcard ARNs. CSM-assignment and escalation-close gated to CS lead/Admin.
  - **[HARD CATCH] Governance-role separation.** The Foundations data access the providers need in a customer account — `ce:GetCostAndUsage`, `budgets:*`, `securityhub:GetFindings`, `config:` read — must live in a **separate, dedicated, read-mostly governance role provisioned alongside (not inside) the Peregrine migration role.** Do NOT add these permissions to the migration role: conflating them breaks the migration path's least-privilege posture. This is a hard requirement, not a preference.

**11.3 Tenant isolation (flexibility pattern)** — `tenant_id` on every CS record and query; tenant-id-per-agreement; cross-tenant read must fail closed. In **enterprise-hosted SaaS mode** (the default for this portal) this is **row-level isolation** between customers in the enterprise account — the same discipline lets an instance be **relocated** to a dedicated/customer-account deployment per deal without a data migration. CS holds prepared customer data, so this is load-bearing.

**11.4 RBAC** — `CSM` sees only their assigned accounts (`csm_email == caller`); CS lead/Admin see all; via `withPermissions()` resource key `operations/customer-success`.

**11.5 Audit logging** — log: CSAT response capture (data modification), CSM reassignment (permission/config change), escalation open/close (data modification), account-detail export (data access). Required `AuditEvent` shape.

**11.6 Test & coverage plan** — Vitest 80/75/80/80; dedicated tests for the health-rollup function (weighted deal+delivery+csat → color) against fixtures; **tenant-isolation test (CSM A cannot read CSM B's accounts)**; PII-handling test (no contact_email in logs).

**11.7 Rollback plan** — additive new tables; `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain` on all CS DynamoDB tables (customer data must never be destroyed on stack update — matches `mp-saas-standards` "don't delete customer data on unsubscribe").

**11.8 Mandatory infra tags** — `enterprise:module=customer-success`, `enterprise:workload=aerostack`, `enterprise:grc=soc2` (hipaa if a customer carries PHI), plus standard tags.

**11.9 Secrets & encryption** — KMS CMK on CS tables (CONFIDENTIAL+); encryption at rest/transit; no PII in client storage (the `analyze-standards.js` localStorage check is HIGH — CS UI must not cache contact emails).

**11.10 Accessibility / perf / design system** — WCAG 2.1 AA; portfolio list p95 < 1 s. **All net-new surfaces in this PRD use AWS Cloudscape — both the Customer View and the enterprise Ops View** (consistent with partnerready.ai + One-CT/Peregrine Ops — one enterprise.ai product language, no split-brain UI). Cloudscape ships WCAG-compliant components, which also satisfies the accessibility bar.

**11.11 Commit-before-code** — PRD → FI build plan → Slack #custeng syndication → human commit → Linear ("Customer Success" project, issues per phase) → build.

---

## 12. Open questions

| Question | Owner | Decision gate |
| :---- | :---- | :---- |
| Is the Account keyed to HubSpot company or to a partner-engagement? | Will | Phase 1 design |
| Health rollup weighting — fixed or per-segment? | CS lead | Phase 1 |
| CSAT delivery channel — email (SES) or in-app? | Will | Phase 2 |
| Does ARR live in Aerostack or come from Q2C/contracts? | Will | depends on Q2C PRD |

---

## 13. Success metrics

| Metric | Current | Phase 1 target | Full target |
| :---- | :---- | :---- | :---- |
| Account health visibility | none (deal-only, no rollup) | per-account rollup | predictive risk |
| Renewal tracking | none | renewal pipeline live | forecast + at-risk ARR |
| CSAT/NPS | scaffold ("coming soon") | capture + trend | closed-loop on detractors |
| At-risk accounts surfaced | manual | automated list | feeds #custeng cadence |

---

## 14. Milestones

| Milestone | Scope | Target date |
| :---- | :---- | :---- |
| M1 | Account entity + health rollup + portfolio/account UI | Week 1–3 |
| M2 | Renewals + CSAT/NPS capture & trends | Week 4–6 |
| M3 | Success plans + QBR + escalations | Week 7–8 |

---

## 15. Acceptance criteria

* An `Account` exists per HubSpot company with a computed `health` that showcasenstrably reflects its `deal_health`, `delivery_health`, and `latest_csat` inputs.
* `GET /cs/accounts` returns a CSM's own accounts only when called as `CSM`; full portfolio for CS lead/Admin (RBAC verified).
* CSAT responses persist and `GET /cs/csat/trends` returns a time series (the "coming soon" path is gone).
* Renewals appear in `GET /cs/renewals` with status and at-risk flag; upcoming renewals are queryable by date window.
* Every CS record carries `tenant_id`; cross-tenant and cross-CSM read tests fail closed; no `contact_email` appears in logs.
* CS tables carry `DeletionPolicy: Retain`, KMS CMK, and the 7 `enterprise:*` tags; `analyze-standards.js` passes with zero CRITICAL (incl. no client-side PII storage).

---

## 16. Spec decomposition & AIDLC hand-off

### 16.1 Kiro spec triplet
Seeds `.kiro/specs/customer-success/` — `.config.kiro` (`requirements-first`), `requirements.md`, `design.md`, `tasks.md`.

### 16.2 REASONS Canvas decomposition *(Mode B forward hook)*
| Feature (from §6) | Planned `REASONS.md` path | Notes |
| :---- | :---- | :---- |
| Account + health rollup | `.kiro/specs/cs-account-health/REASONS.md` | Mode B |
| Renewals + CSAT | `.kiro/specs/cs-renewals-csat/REASONS.md` | Mode B |
| Success plans + escalations | `.kiro/specs/cs-success-plans/REASONS.md` | Mode B |

### 16.3 Kestrel registry mapping *(forward hook)*
| §2 GAP | Artifact type | Registry id (proposed) | ≥2 callers? |
| :---- | :---- | :---- | :---- |
| Account health rollup | module | `account-health-rollup` | Yes (CS + cadence agent) |
| CSAT/NPS capture + trend | module | `csat-nps` | Maybe (CS + future product) |
| Tenant-scoped customer record store | block | `tenant-scoped-record` | Yes (CS + RevOps + everything → promote) |

---

*Document: Aerostack Customer Success — PRD v0.1 (proposed Master Index slot 2025.2.16)*
*Last Updated: June 2026*
