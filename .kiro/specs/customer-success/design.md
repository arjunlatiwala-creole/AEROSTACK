# Aerostack Customer Success — Design

## Architecture posture
Greenfield, additive. CS modules land under `tools-api/functions/cs/` (Python) and/or `infra/src/functions/cs/` (TypeScript) with a new `CustomerSuccessApi` construct and new `cs-*` DynamoDB tables. No logical-ID changes to existing constructs. Build order is **ticketing first** (zero external-API dependency).

```
enterprise OPS VIEW (Cloudscape, internal Cognito pool)        CUSTOMER VIEW (Cloudscape @ portal.enterprise.ai, SEPARATE Cognito pool)
        \                                                /
         \------------------ API Gateway ---------------/   (Customer View: server-side tenant_id scope + internal-field strip)
                                  |
   /cs/tickets   --> cs/tickets.ts        --> support-tickets (DDB, NEW, KMS CMK, Retain)
   /cs/accounts  --> cs/accounts.ts       --> cs-accounts (DDB, NEW)  [keyed to HubSpot companyId]
   /cs/renewals  --> cs/renewals.ts       --> cs-renewals (DDB, NEW)
   /cs/csat/*    --> cs/csat.ts           --> cs-csat (DDB, NEW)  [contact_email RESTRICTED]
   /cs/plans, /cs/escalations --> cs/...  --> cs-plans, cs-escalations (DDB, NEW)
   /cs/cost      --> cs/cost.ts      [CostDataProvider]     --> Cost Explorer (SoT) + Archera + MontyCloud
   /cs/security  --> cs/security.ts  [PostureProvider]      --> SecHub + Config via MontyCloud (base) / Upwind (upgrade)
   /cs/compliance--> cs/compliance.ts[ComplianceProvider]   --> Drata
                                  |
        READ (existing): companies / deals / contacts (HubSpot mirror), delivery loops, Deel people
```

## Data models (verbatim from PRD §6)

### SupportTicket / TicketMessage (CS-1)
```typescript
interface SupportTicket {
  tenant_id: string; ticket_id: string; account_id: string;
  subject: string; priority: 'P0'|'P1'|'P2'|'P3';
  status: 'open'|'waiting'|'in_progress'|'resolved'|'closed';   // SLA clock pauses on 'waiting'
  assignee_email: string | null;
  sla_first_response_due: string | null; sla_resolution_due: string | null;
  sla_breached: boolean;
  data_classification: 'CONFIDENTIAL';
  created_at: string; updated_at: string;
}
interface TicketMessage {
  tenant_id: string; ticket_id: string; ts: string;
  author_email: string; body: string;
  internal_only: boolean;                  // true = enterprise-ops note customer never sees
  data_classification: 'CONFIDENTIAL';
}
```
SLA: business hours 9–6 ET; P0 24/7; pause while `waiting`; breach → Slack alert. SLA due-times computed on create/transition by a pure `computeSla(priority, now)` helper (testable).

### Provider interfaces (CS-2)
```typescript
interface CostDataProvider { getSpend(tenant_id, period): Promise<{ raw_spend_cents; committed_savings_cents|null; coverage_pct|null }>; }
interface PostureProvider  { getPosture(tenant_id): Promise<{ posture:'GREEN'|'YELLOW'|'ORANGE'|'RED'; tier:'base'|'upwind'; findings_count }>; }
interface ComplianceProvider { getComplianceStatus(tenant_id): Promise<{ status:'on_track'|'gaps'|'at_risk'; soc2_coverage_pct; evidence_progress_pct }>; }
```
Cost reconciliation: Cost Explorer wins on conflict. Each provider has a stub/mock impl first (greenfield) so the surface ships before live integrations; real integrations land behind the seam.

### Account + composite health (CS-3)
```typescript
interface Account {
  account_id: string;          // HubSpot companyId
  tenant_id: string; company_name: string;
  csm_email: string | null; segment: 'smb'|'mid'|'enterprise'; arr_cents: number | null;
  health: 'GREEN'|'YELLOW'|'ORANGE'|'RED';
  health_inputs: {
    delivery_health: number|null;   // 25%
    cost_trend: number|null;        // 15%
    security_posture: number|null;  // 15%
    compliance_readiness: number|null; // 10%
    support_health: number|null;    // 20%
    engagement_recency: number|null;//  5%
    commercial_health: number|null; // 10%
  };
  data_classification: 'CONFIDENTIAL'; created_at: string; updated_at: string;
}
```
`computeAccountHealth(inputs, weights)` is a pure function (the headline tested unit). Missing inputs are excluded and weights renormalized.

### Renewal / CsatResponse (CS-4), SuccessPlan / Escalation (CS-5)
Per PRD §6 — `Renewal`, `CsatResponse` (contact_email RESTRICTED), `SuccessPlan`, `Escalation`.

## New DynamoDB tables (additive)
| Table | PK | SK | GSIs | Policy |
|-------|----|----|------|--------|
| `support-tickets` | `TENANT#{tenant_id}` | `TICKET#{id}` / `#MSG#{ts}` / `#EVENT#{ts}` | by-status, by-assignee, by-priority | KMS CMK, Retain + UpdateReplace Retain |
| `cs-accounts` | `TENANT#{tenant_id}` | `ACCOUNT#{account_id}` | by-csm | same |
| `cs-renewals` | `TENANT#{tenant_id}` | `RENEWAL#{id}` | by-status, by-date | same |
| `cs-csat` | `TENANT#{tenant_id}` | `RESP#{id}` | by-account | same |
| `cs-plans` | `TENANT#{tenant_id}` | `ACCOUNT#{account_id}` | — | same |
| `cs-escalations` | `TENANT#{tenant_id}` | `ESC#{id}` | by-account, by-severity | same |

All: `PAY_PER_REQUEST`, 7 `enterprise:*` tags, `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`, KMS CMK.

## Config model
```typescript
interface CSConfig {
  tenant_id: string;
  deployment_mode: 'enterprise_saas'|'dedicated'|'customer_account';  // default enterprise_saas
  customerName: string;
  features: { tickets; cost; security; compliance; renewals; csat; successPlans; escalations };
  health_weights: { delivery:0.25; cost:0.15; security:0.15; compliance:0.10; support:0.20; engagement:0.05; commercial:0.10 };
  security_tier: 'base'|'upwind';
  customer_view: { enabled: boolean; domain: string };  // e.g. portal.enterprise.ai
  csat_cadence_days: number;
}
```

## Dual-view rule
Same data plane, two renderers. Customer View filtered server-side to the caller's `tenant_id`, strips internal-only fields (`internal_only` messages, margin, internal notes, other tenants). Standalone deployment: separate CloudFront + separate Cognito pool.

## Governance-role separation (HARD CATCH)
Provider IAM (`ce:GetCostAndUsage`, `budgets:*`, `securityhub:GetFindings`, `config:` read) goes in a dedicated read-mostly governance role provisioned alongside — never inside — the Peregrine migration role.

## Reuse map
| Need | Reuse |
|------|-------|
| Customer/internal split, delivery health | `infra/src/functions/delivery/list-delivery.ts`, `loops/get-delivery-loop.ts` |
| Account source (company) | HubSpot mirror `companies`/`deals`/`contacts` |
| CSM assignment | Deel people (`team_area='Customer Success'`) |
| Permission gate | `withPermissions` + `X-Resource-Key: operations/customer-success` |
| Cost/posture/portal patterns | partnerready.ai (lift patterns, do not re-spec) |
| Response envelope | `shared/response.ts` (TS) / tools-api handler conventions (Py) |

## Testing strategy
- Unit: `computeSla`, `computeAccountHealth` (weighted, missing-input renormalization), SLA pause-on-waiting.
- Isolation: cross-tenant read fails closed; CSM A cannot read CSM B's accounts.
- PII: no `contact_email` in logs; no client-side caching of contact emails.
- Construct: CS tables KMS CMK + Retain + UpdateReplace Retain + tags; customer Cognito pool separate from internal.
