# Aerostack Quote-to-Cash (Q2C) — PRD v0.2

**document:** PRD — Aerostack Q2C Module  
**version:** 0.2  
**status:** Draft — iterated from v0.1 with codebase validation  
**author:** Will Horn (with Kiro)  
**date:** 2026-04-23  
**applies_to:** Aerostack (enterprise internal work system; future candidate for product repackaging)

**references:**
- `docs/inputs/Q2C-Aerostack Scope` (v0.1 — this document supersedes)
- `Aerostack-MODULAR-PLATFORM-VISION.md` (modular platform architecture)
- `PRD-REGISTRY-FIRST-AGENT-DEPLOYMENT.md` (agent lifecycle, split-plane model)
- `pwa-frontend/src/lib/aerostack-agents.ts` (agent catalog — revenue domain)
- `tools-api/functions/opps/handler.py` (existing Opps agent backend)
- `common/src/types/aerostack.ts` (current data model)
- `docs/inputs/Growth Associate W2 Comp Plan - SFO.md` (comp model, deal lifecycle)
- Union call transcript (2026-04-23)
- GGTC Partnership Deal (engagement lifecycle, revenue splits, managed resell model)

---

## 0. What changed from v0.1

v0.1 was written without access to the Aerostack codebase. This version corrects against what actually exists, identifies what is already built that Q2C can extend, and restructures the PRD around buildable increments rather than a monolithic scope.

**Key corrections:**

1. Aerostack already has an Opps agent (active), SOW agent (building), Pricing agent (planned), and Delivery agent (building). Q2C extends these — it does not replace them.
2. The existing Opps handler creates deals directly in HubSpot with BANT scoring, lifecycle stages (`Lead > Developing > Ready for Signature > Funding-Ready > Closed`), and funding status tracking. Q2C's CPQ layer sits on top of this, not beside it.
3. The agent registry pattern (PRD-REGISTRY-FIRST-AGENT-DEPLOYMENT) means Q2C agents self-register and appear in the fleet without frontend code changes.
4. The modular platform vision (Aerostack-MODULAR-PLATFORM-VISION) already defines module interfaces. Q2C should ship as installable modules (`core-revops`, `workflow-sales-cycle`, `agent-pricing`, etc.), not as a monolithic feature.
5. The split-plane deployment model means Q2C data (contracts, invoices, pricing) lives in the customer data plane. The commercial logic (pricing rules, approval routing, margin calculations) lives in the enterprise control plane.
6. The existing data model uses Loops as the core work unit. Q2C entities (Quote, Contract, Order) should reference Loops where they represent trackable work, but Q2C needs its own first-class entities — Loops are not a substitute for commercial objects.

**Structural changes from v0.1:**

- Reorganized around build phases (what to build first, second, third) instead of a flat feature list
- Added explicit "what exists today" mapping for every capability
- Replaced the flat `[must]/[should]/[later]` tags with phased delivery tied to revenue milestones
- Added the billing vendor integration as a first-class architectural decision with a recommendation
- Removed the PC3 worked example (it validated the model; move to a design doc)
- Added UX wireframe descriptions for the deal builder
- Added API surface draft

---

## 1. Problem statement

enterprise's commercial process currently runs on a patchwork:

- **Opps** live in HubSpot (created via Aerostack Opps agent or manually)
- **Quotes** are Google Docs or spreadsheets emailed around
- **Contracts** are Word docs with manual variable insertion, signed via DocuSign (ad hoc)
- **Invoicing** is manual (QuickBooks or Stripe direct)
- **Revenue tracking** is a spreadsheet maintained by Will
- **Partner economics** (GGTC referral, managed resell margin) are computed manually per deal
- **Practice MRR** is a monthly spreadsheet exercise
- **AWS funding offsets** are tracked in a separate spreadsheet and reconciled manually

This works at ~$2M ARR. It breaks at $5M. It is impossible at $10M.

Aerostack Q2C replaces the patchwork with a single commercial spine: the structured translation of "what sales sold" into "what billing charges and what delivery fulfills."

---

## 2. What exists today (codebase-validated)

| Capability | Current State | Where It Lives | Q2C Relationship |
|---|---|---|---|
| Deal entry + HubSpot sync | Active | `tools-api/functions/opps/handler.py`, `OppsTools.tsx` | Q2C extends with multi-stage quoting |
| BANT deal scoring | Active | Opps handler (`score_deal` action) | Feeds into Q2C deal qualification |
| Pipeline coverage + win rate | Active | Opps handler (client-side calc in `OppsTools.tsx`) | Q2C adds catalog-aware pipeline views |
| Deal lifecycle stages | Active | `Lead > Developing > Ready for Signature > Funding-Ready > Closed` | Q2C maps to `CLARIFY > VALIDATE > BUILD > OPERATE` |
| Funding status tracking | Active | Opps handler (`funding_needed`, `funding_status` fields) | Q2C extends to full AWS funding claim lifecycle |
| SOW generation | Stub | `SowTools.tsx` shows "Coming soon" | Q2C's contract module replaces this |
| Delivery tracking | Building | `tools-api/functions/delivery/`, `DeliveryTools.tsx` | Q2C receives milestone signals from Delivery |
| Agent registry | Active | `tools-api/functions/agents/` | Q2C agents register here |
| Knowledge bases | Active | `tools-api/functions/knowledge/` | Q2C uses KBs for contract templates, pricing rules |
| Financial tracking | Active | `FinancialService` (Loops-based) | Q2C replaces with contract-level financials |
| People/org data | Active | People Ops services | Q2C uses for approval routing, role-based access |

**Critical gap:** There is no structured commercial object model today. Deals exist in HubSpot. Everything between "deal closed" and "invoice sent" is manual. Q2C fills this gap.

---

## 3. Scope boundaries

**In scope (this PRD):**

- Offering catalog and pricing engine
- Quote construction (CPQ) with multi-stage support
- Contract generation, e-signature, and activation
- Order hand-off to delivery pods
- Billing integration (vendor-mediated, not built in-house)
- Revenue recognition inputs
- Partner/channel attribution and tiered referral calculation
- Practice MRR computation
- AWS funding offset tracking

**Out of scope (adjacent Aerostack modules — already have or will have their own PRDs):**

- Lead qualification and CRM sync (Opps agent — already active)
- Delivery pod staffing and timesheet capture (Delivery agent — building)
- CSP consumption monitoring (One-CT module — planned)
- Content and engagement (Content agents — active)
- Rev-rec policy decisions and GL posting (accounting system)
- Agent builder platform / ABP (separate PRD)

**Depends on (must exist or be stubbed):**

- Opps agent (exists — Q2C reads opportunities from it)
- Delivery agent (building — Q2C sends orders to it, receives milestone signals)
- Agent registry (exists — Q2C agents register here)
- Knowledge base system (exists — Q2C stores templates and pricing rules here)

---

## 4. Architecture decision: billing vendor

**Recommendation: Union as billing execution layer.**

Rationale from the April 23 transcript and capability analysis:

| Requirement | Union | Build on Stripe | Orb / Metronome |
|---|---|---|---|
| Multi-entity, multi-currency | Native (8 yrs in production) | Build it yourself | Partial |
| B2B subscription + usage hybrid | Core product | Stripe Billing covers basics | Strong on usage, weaker on B2B |
| Pluggable tax engine | Yes (Avalara, regional) | Stripe Tax (US-centric) | Varies |
| CRM-agnostic ingest | API-first, no CRM dependency | N/A | N/A |
| White-label / tenant-flexible | Confirmed in transcript | N/A | No |
| Custom billing rules | Supported | Build it yourself | Partial |
| Time to integrate | Weeks (API-open) | Months | Weeks |
| Cost at enterprise scale | ~$500-1K/mo | Stripe fees only | ~$500-1K/mo |

**Decision gate:** Validate on April 29 engineer call. If Union passes, commit. If not, fall back to Stripe direct with a thinner billing layer built in Aerostack.

**Aerostack's role regardless of vendor:** Aerostack is the source of truth for the commercial deal. The billing vendor is an execution layer — it receives structured instructions from Aerostack and handles invoice generation, payment capture, and dunning. Aerostack never delegates commercial logic to the billing vendor.

---

## 5. Personas and Aerostack surfaces

| Persona | What they do in Q2C | Aerostack surface | Exists today? |
|---|---|---|---|
| Seller (enterprise or GGTC) | Builds quote, negotiates, closes | Deal Builder (new) + Opps Tools (extend) | Opps Tools exists |
| Practice leader | Approves non-standard pricing | Approval Queue (new) | No |
| Solution architect / SA | Validates technical scope vs. pricing | Quote Review (new) | No |
| Delivery lead / Pod lead | Receives order, stages resources | Order Hand-off (new) + Delivery Tools (extend) | Delivery Tools building |
| CSP / LaunchLogic ops | Onboards account, confirms billing ready | Activation Checklist (new) | No |
| Finance (controller / CFO) | Reviews rev-rec, approves invoices | Finance Dashboard (extend) | Loop-based financials exist |
| Partner ops | Manages resell channel, reconciles | Channel Ledger (new) | No |
| Customer (buyer / AP) | Signs contract, receives invoices | Customer Portal (later) | No |
| Practice investor (GGTC) | Monitors Practice MRR, step-down | Investor View (new) | No |

---


## 6. Features by build phase

### Phase 1: Catalog + CPQ (Weeks 1-4)

*Goal: Replace the spreadsheet quote process. Sellers can build structured quotes in Aerostack.*

#### 6.1 Offering Catalog

The master list of everything enterprise sells, with pricing rules attached.

**Data model — `Offering`:**

```typescript
interface Offering {
  offering_id: string;
  name: string;                          // "MAP Assessment", "LaunchLogic Scale"
  solution_line: 'S1' | 'S2' | 'S3' | 'S4';  // Revenue Growth / Cost Deflection / SaaS Launch / Data & AI
  category: 'VALIDATE' | 'BUILD' | 'OPERATE';
  pricing_model: 'fixed_fee' | 'time_and_materials' | 'subscription_flat' | 'subscription_tiered' | 'usage_based' | 'hybrid';
  default_price_cents: number;           // base price in cents
  price_unit?: string;                   // "per user", "per month", "per migration unit"
  periodicity: 'one_time' | 'monthly' | 'quarterly' | 'annual' | 'custom';
  custom_periodicity_rule?: string;      // JSON rule for escalators, free months, etc.
  fulfillment_pod_type: string;          // "assessment", "build", "launchlogic", "csp", "pc3_migration"
  aws_funding_eligible: boolean;
  aws_programs: string[];                // ["MAP", "EBA", "IWA", "IWB"]
  rev_rec_category: 'one_time_fixed' | 'one_time_milestone' | 'recurring_ratable' | 'usage_point_in_time' | 'bundle_allocated';
  default_terms: Record<string, unknown>; // payment terms, renewal, termination defaults
  band_tier_presets?: Record<string, unknown>; // Band 1/2/3 default configs
  catalog_version: string;               // semver — pinned to contract at execution
  status: 'active' | 'deprecated' | 'draft';
  created_at: string;
  updated_at: string;
}
```

**Capabilities:**

- Three solution-line taxonomy (S1/S2/S3, reserve S4 Data & AI Governance)
- ~20-30 marketplace offering definitions (SKUs) with pricing model, fulfillment pod type, default terms, AWS funding eligibility, rev-rec treatment
- Pricing model support: fixed-fee, T&M, subscription (flat/tiered), usage-based, hybrid
- Periodicity support: one-time, monthly, quarterly, annual, custom (escalators, free months)
- Versioned catalog — version pinned to contract at execution; active contracts immutable against future catalog changes
- Bundle templates — pre-composed engagement lifecycles (e.g., "MAP Assessment > Modernize > LaunchLogic Scale")
- Band-tier presets (Band 1/2/3) that pre-fill defaults based on deal size

**Storage:** DynamoDB table `aerostack-{tenant}-offerings` in the data plane. Catalog management API in the control plane.

**Aerostack agent:** Extends the existing Pricing agent (currently `planned` status in the catalog). The Pricing agent gains `list_offerings`, `get_offering`, `create_offering`, `update_offering`, `deprecate_offering` tools.

#### 6.2 Quote Construction (CPQ)

**Data model — `Quote` and `QuoteLineItem`:**

```typescript
interface Quote {
  quote_id: string;
  opportunity_id: string;               // links to HubSpot deal via Opps agent
  account_id: string;
  solution_line: 'S1' | 'S2' | 'S3' | 'S4';
  status: 'draft' | 'in_approval' | 'presented' | 'accepted' | 'expired' | 'superseded';
  version: number;                       // increments on each revision
  previous_version_id?: string;          // for redline comparison
  line_items: QuoteLineItem[];
  total_price_cents: number;
  total_after_funding_cents: number;     // net-of-AWS-funding view
  margin_view?: MarginView;             // internal only — cost vs. price per line
  approval_status: 'auto_approved' | 'pending' | 'approved' | 'rejected';
  approval_chain?: ApprovalRecord[];
  valid_until: string;                   // ISO date
  branded_for: 'enterprise' | 'ggtc' | 'joint';
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface QuoteLineItem {
  line_item_id: string;
  offering_id: string;
  offering_version: string;              // catalog version pinned at quote creation
  stage: 'VALIDATE' | 'BUILD' | 'OPERATE';
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  pricing_model: string;
  periodicity: string;
  custom_terms?: Record<string, unknown>; // free months, escalators, etc.
  aws_funding_eligible: boolean;
  aws_funding_estimate_cents?: number;
  rev_rec_category: string;
  scope_config?: Record<string, unknown>; // user counts, data volumes, etc.
}

interface ApprovalRecord {
  approver_id: string;
  approver_role: string;
  decision: 'approved' | 'rejected' | 'pending';
  reason?: string;
  decided_at?: string;
}

interface MarginView {
  total_cost_cents: number;
  total_margin_cents: number;
  margin_pct: number;
  line_margins: { line_item_id: string; cost_cents: number; margin_pct: number }[];
}
```

**Capabilities:**

- Guided deal builder: pick solution line > pick offerings > configure scope > see price
- Multi-stage quote: one quote can contain VALIDATE + BUILD + OPERATE line items with different rev-rec treatments
- Real-time total calculation including AWS funding offset preview
- Quote versioning and redline comparison (seller iterates with customer)
- Approval routing with SLA and escalation (see approval matrix below)
- Quote-to-proposal generation (PDF/docx) branded per partnership (enterprise, GGTC, joint)
- Margin view (internal only) showing cost vs. price per line item

**Approval matrix:**

| Condition | Approver |
|---|---|
| Standard catalog pricing, standard terms | Auto-approve |
| Discount <= 15% on VALIDATE or BUILD | Seller + SA |
| Discount > 15% or custom payment terms | Practice leader |
| Bundled OPERATE commitment > 24 months | Practice leader + Finance |
| Any contract > $500K TCV | Practice leader + CFO |
| Any cross-entity or multi-currency deal | Finance |
| Any deal invoking tiered referral > 1% | Partnership ops |

**UX — Deal Builder wireframe description:**

The Deal Builder is a new tab in the existing Opps Tools component (`OppsTools.tsx`), added alongside the existing Opp Entry, Deal Scoring, Win Rate, and Pipeline tabs.

Step 1 — **Select Solution Line:** Three large cards (S1 Revenue Growth, S2 Cost Deflection, S3 SaaS Launch) with optional S4. Selecting one filters the offering catalog.

Step 2 — **Pick Offerings:** Filterable grid of offerings for the selected solution line. Each card shows: name, category (VALIDATE/BUILD/OPERATE), pricing model, base price, AWS funding eligibility badge. Seller clicks to add to quote. Multiple offerings can be added across stages.

Step 3 — **Configure Scope:** For each added line item, a configuration panel appears. Fields depend on the offering's pricing model: quantity, user counts, data volumes, custom terms (free months, escalators), AWS funding flags, partner-of-record selection.

Step 4 — **Review & Price:** Summary view showing all line items grouped by stage (VALIDATE > BUILD > OPERATE). Real-time totals: gross price, AWS funding offset, net price. Internal margin view toggle. Redline comparison if this is a revision.

Step 5 — **Submit for Approval:** If terms are standard, auto-approve. Otherwise, routes to the approval queue with the appropriate approvers per the matrix above.

**Aerostack agent:** New `quote` agent in the revenue domain. Tools: `create_quote`, `add_line_item`, `remove_line_item`, `configure_line_item`, `submit_for_approval`, `get_quote`, `list_quotes`, `compare_versions`.

---

### Phase 2: Contracts + Order Hand-off (Weeks 5-8)

*Goal: Accepted quotes become executable contracts. Signed contracts generate orders for delivery pods.*

#### 6.3 Contracts

**Data model — `Contract`, `Amendment`:**

```typescript
interface Contract {
  contract_id: string;
  quote_id: string;                      // the accepted quote this was generated from
  account_id: string;
  status: 'draft' | 'pending_signature' | 'active' | 'suspended' | 'terminated' | 'expired';
  template_id: string;                   // contract template from KB
  catalog_version_locked: string;        // immutable after execution
  terms: ContractTerms;
  signatories: Signatory[];
  amendments: Amendment[];
  activation_gate?: ActivationGate;      // optional: billing starts on delivery signal
  e_sign_envelope_id?: string;           // DocuSign envelope ID
  signed_at?: string;
  effective_date: string;
  expiry_date?: string;
  created_at: string;
  updated_at: string;
}

interface ContractTerms {
  payment_terms: string;                 // "Net 30", "Net 60", etc.
  renewal: 'auto' | 'manual' | 'none';
  renewal_notice_days?: number;
  termination_notice_days?: number;
  escalator?: { type: 'percentage' | 'fixed'; value: number; frequency: string };
  custom_clauses: { clause_id: string; text: string; category: string }[];
  price_protection: boolean;             // grandfathering — catalog changes don't touch this contract
}

interface Signatory {
  name: string;
  email: string;
  role: string;                          // "Customer", "enterprise", "Graphite"
  signed: boolean;
  signed_at?: string;
}

interface ActivationGate {
  type: 'milestone' | 'date' | 'signal';
  description: string;                   // "billing begins at implementation acceptance"
  triggered: boolean;
  triggered_at?: string;
  triggered_by?: string;                 // delivery system signal source
}

interface Amendment {
  amendment_id: string;
  parent_contract_id: string;
  type: 'scope_change' | 'price_change' | 'term_change' | 'extension';
  description: string;
  new_line_items?: QuoteLineItem[];
  removed_line_items?: string[];
  effective_date: string;
  approved_by: string;
  created_at: string;
}
```

**Capabilities:**

- Contract template library per offering with variable insertion (stored in Aerostack Knowledge Base)
- E-signature integration (DocuSign — confirm on April 29; PandaDoc as alternative)
- Amendments and change orders linked to parent contract (not standalone new contracts)
- Activation gate: contract can require a delivery-system signal before billing starts
- Multi-party signature flows — customer + enterprise + Graphite where joint delivery
- Term management: renewal dates, auto-renew flags, notice periods, escalator schedules
- Clause library for common custom terms (free months, discount windows, price protection)
- Price protection / grandfathering — catalog version pinned at contract execution

**Aerostack agent:** New `contract` agent in the revenue domain. Tools: `generate_contract`, `send_for_signature`, `check_signature_status`, `activate_contract`, `create_amendment`, `suspend_contract`, `terminate_contract`.

#### 6.4 Order and Fulfillment Hand-off

**Data model — `Order`, `Milestone`:**

```typescript
interface Order {
  order_id: string;
  contract_id: string;
  account_id: string;
  order_type: 'VALIDATE' | 'BUILD' | 'OPERATE';
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  fulfillment_pod_type: string;
  assigned_pod_id?: string;
  scope: Record<string, unknown>;
  milestones: Milestone[];
  billing_triggers: BillingTrigger[];
  loop_id?: string;                      // links to Aerostack Loop for work tracking
  created_at: string;
  updated_at: string;
}

interface Milestone {
  milestone_id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'accepted';
  due_date?: string;
  completed_at?: string;
  accepted_at?: string;
  acceptance_criteria: string;
  triggers_billing: boolean;
  triggers_operate_activation: boolean;  // BUILD completion activates OPERATE subscription
}

interface BillingTrigger {
  trigger_id: string;
  type: 'milestone_completion' | 'milestone_acceptance' | 'date' | 'activation_signal';
  milestone_id?: string;
  scheduled_date?: string;
  amount_cents: number;
  triggered: boolean;
  triggered_at?: string;
}
```

**Capabilities:**

- On contract activation, generate order records handed to the appropriate delivery team
- Order contains: scope, milestones, acceptance criteria, billing triggers, referenced contract ID
- Delivery systems post back milestone completion signals that Aerostack uses to trigger invoicing or OPERATE activation
- Completion of BUILD triggers automatic activation of committed OPERATE subscription (no re-contracting)
- Links to Aerostack Loops for work tracking within the existing delivery system

**Integration with existing Delivery agent:** The Delivery agent (currently `building` status) receives Orders via its API. The `project_health`, `burn_rate`, `milestone_tracker` tools already exist. Q2C adds `accept_milestone` and `signal_completion` tools that write back to the Order, triggering billing events.

---

### Phase 3: Billing + Revenue (Weeks 9-14)

*Goal: Contracts generate invoices. Revenue recognition inputs flow to accounting. AWS funding offsets are tracked.*

#### 6.5 Billing and Invoicing

**This is the billing vendor integration layer.** Aerostack does not build invoice generation, payment capture, or dunning. It sends structured billing instructions to the vendor (Union recommended) and receives status updates.

**Data model — `BillingInstruction`, `Invoice` (Aerostack-side records):**

```typescript
interface BillingInstruction {
  instruction_id: string;
  contract_id: string;
  order_id?: string;
  type: 'one_time' | 'recurring' | 'usage' | 'credit';
  amount_cents: number;
  currency: string;
  billing_entity: string;                // "enterprise_us", "enterprise_eu", etc.
  customer_billing_entity: string;
  schedule?: BillingSchedule;
  usage_config?: UsageConfig;
  aws_funding_offset_cents?: number;
  tax_jurisdiction?: string;
  metadata: Record<string, unknown>;
  sent_to_vendor: boolean;
  vendor_subscription_id?: string;
  vendor_invoice_id?: string;
  created_at: string;
}

interface BillingSchedule {
  start_date: string;
  end_date?: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'custom';
  proration_policy: 'day' | 'none';
  escalator?: { type: 'percentage' | 'fixed'; value: number; frequency: string };
}

interface UsageConfig {
  meter_id: string;                      // maps to One-CT consumption feed
  unit: string;
  rate_per_unit_cents: number;
  tiers?: { up_to: number; rate_cents: number }[];
}

interface Invoice {
  invoice_id: string;
  vendor_invoice_id: string;
  contract_id: string;
  account_id: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void' | 'credited';
  amount_cents: number;
  amount_after_funding_cents: number;    // net-of-AWS-funding view to customer
  currency: string;
  billing_entity: string;
  line_items: InvoiceLineItem[];
  issued_at: string;
  due_at: string;
  paid_at?: string;
}

interface InvoiceLineItem {
  description: string;
  offering_id: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  aws_funding_offset_cents: number;
  rev_rec_category: string;
}
```

**Capabilities:**

- Generate billing instructions per contract billing rules (periodic, milestone-based, consumption-based)
- Metered usage ingest from One-CT (CSP consumption) and cost-opt reporting
- AWS funding offset application on invoices (net-of-funding view to customer; full-fee view internally until claim approved)
- Multi-entity, multi-currency invoicing (enterprise US, potential EU/APJ entities)
- Proration on mid-period start, stop, or tier change
- Collections workflow: dunning sequences, AR aging, escalation (vendor-managed)
- Credit note / refund handling with audit trail

**Integration pattern:**

```
Aerostack Q2C                          Billing Vendor (Union)
    |                                     |
    |-- POST /subscriptions ------------->|  (recurring billing instruction)
    |-- POST /one-time-charges ---------->|  (milestone or fixed-fee charge)
    |-- POST /usage-events -------------->|  (metered consumption from One-CT)
    |                                     |
    |<-- webhook: invoice.created --------|  (Aerostack records the invoice)
    |<-- webhook: invoice.paid -----------|  (Aerostack updates payment status)
    |<-- webhook: invoice.overdue --------|  (Aerostack flags for finance review)
    |<-- webhook: subscription.changed ---|  (Aerostack records tier/status changes)
```

#### 6.6 Revenue Recognition Inputs

**Data model — `RevRecLine`:**

```typescript
interface RevRecLine {
  rev_rec_id: string;
  invoice_id: string;
  contract_id: string;
  line_item_id: string;
  category: 'one_time_fixed' | 'one_time_milestone' | 'recurring_ratable' | 'usage_point_in_time' | 'bundle_allocated';
  total_amount_cents: number;
  recognized_amount_cents: number;
  deferred_amount_cents: number;
  recognition_start: string;
  recognition_end?: string;
  allocation_hint?: {                    // for bundles (VALIDATE + BUILD + OPERATE)
    bundle_id: string;
    standalone_selling_price_cents: number;
    allocated_amount_cents: number;
  };
  change_order_impact?: {
    original_amount_cents: number;
    adjusted_amount_cents: number;
    reason: string;
  };
  exported_to_gl: boolean;
  gl_export_date?: string;
}
```

**Capabilities:**

- Every line item tagged with rev-rec category
- Allocation hints for bundles — finance decides the final allocation but Aerostack provides the building blocks
- Change-order impact on rev-rec recalculation
- Export to accounting (NetSuite or equivalent) with rev-rec schedule

#### 6.7 AWS Funding Offset Tracking

**Data model — `FundingClaim`:**

```typescript
interface FundingClaim {
  claim_id: string;
  contract_id: string;
  account_id: string;
  program: 'MAP' | 'EBA' | 'IWA' | 'IWB';
  status: 'draft' | 'submitted' | 'approved' | 'denied' | 'expired';
  amount_cents: number;
  applied_to_invoices: string[];         // invoice IDs where offset was applied
  submitted_at?: string;
  decided_at?: string;
  denial_reason?: string;
  notes: string;
  created_at: string;
  updated_at: string;
}
```

**Capabilities:**

- Track AWS funding claims per contract and line item
- Apply funding offset to customer invoices (net-of-funding view)
- Handle claim denial: re-invoice customer for the full amount, reconcile with finance
- Program attribution (MAP, IWA, IWB, EBA) per deal for co-sell tracking

**Integration with existing Opps agent:** The Opps handler already tracks `funding_needed` and `funding_status`. Q2C extends this with the full claim lifecycle and links claims to specific contract line items and invoices.

---

### Phase 4: Channel Economics + Practice Reporting (Weeks 15-20)

*Goal: Partner economics are computed automatically. Practice MRR is a live metric, not a monthly spreadsheet.*

#### 6.8 Channel / Partner Economics

**Data model — `ChannelAssignment`, `ReferralCalculation`:**

```typescript
interface ChannelAssignment {
  assignment_id: string;
  account_id: string;
  channel: 'td_synnex_graphite' | 'ingram_enterprise' | 'direct';
  distributor: string;
  reseller: string;
  default_margin_band_pct: number;       // 7-10% default
  spp_status: boolean;
  effective_date: string;
  end_date?: string;                     // null = current; set on reassignment
  reassignment_reason?: string;
}

interface ReferralCalculation {
  referral_id: string;
  account_id: string;
  source_party: 'enterprise' | 'ggtc' | 'distribution';
  operate_revenue_cents: number;         // managed services revenue for the period
  referral_tier_pct: number;             // 1% baseline, up to 5% strategic
  referral_amount_cents: number;
  period: string;                        // "2026-04"
  payout_status: 'calculated' | 'approved' | 'paid';
}

interface ManagedResellMargin {
  margin_id: string;
  account_id: string;
  channel_assignment_id: string;
  cloud_consumption_cents: number;
  margin_pct: number;
  margin_amount_cents: number;
  period: string;
  distributor_statement_reconciled: boolean;
  reconciled_at?: string;
}
```

**Capabilities:**

- Partner-of-record assignment per account (Graphite via TD Synnex OR enterprise via Ingram)
- Managed resell margin calculation on cloud consumption (distributor-dependent: 7-10% default)
- Tiered referral calculation on managed services revenue for sourced accounts (1% baseline to 5% strategic)
- Channel reassignment with forward-only effect (prior invoices preserve original attribution)
- Distributor statement reconciliation (TD Synnex and Ingram)
- AWS program attribution (MAP, IWA, IWB, EBA) per deal for co-sell tracking

#### 6.9 Practice-Level Reporting

**Data model — `PracticeMrrSnapshot`, `BandTrackingRecord`:**

```typescript
interface PracticeMrrSnapshot {
  snapshot_id: string;
  period: string;                        // "2026-04"
  practice_mrr_cents: number;            // OPERATE recurring + resale margin on enterprise-sourced accounts
  operate_recurring_cents: number;
  resale_margin_cents: number;
  excluded_one_time_cents: number;       // BUILD/VALIDATE revenue (not counted)
  step_down_tier: 'pre_250k' | 'pre_500k' | 'pre_1m' | 'post_1m';
  consecutive_months_at_tier: number;    // must be 2+ to trigger step-down
  investment_rate_pct: number;           // current GGTC investment rate
  computed_at: string;
}

interface BandTrackingRecord {
  record_id: string;
  period: string;
  band: 1 | 2 | 3;
  kpi_targets: {
    pipeline_value_cents: number;
    arr_cents: number;
    active_csp_accounts: number;
    active_build_engagements: number;
  };
  kpi_actuals: {
    pipeline_value_cents: number;
    arr_cents: number;
    active_csp_accounts: number;
    active_build_engagements: number;
  };
  on_track: boolean;
}
```

**Capabilities:**

- Practice MRR calculation per the partnership definition (OPERATE recurring + resale margin on enterprise-sourced accounts, excluding one-time BUILD/VALIDATE)
- Step-down trigger monitoring ($250K / $500K / $1M Practice MRR, 2 consecutive months)
- Revenue split views per engagement stage for GGTC/enterprise reporting
- Band 1/2/3 ramp tracking against KPI targets
- Cohort analysis (accounts by source, by entry offering, by progression through stages)
- Pipeline-to-revenue funnel with conversion rates per stage

---


## 7. End-to-end flow: CLARIFY > VALIDATE > BUILD > OPERATE

This maps the four-stage engagement lifecycle to Q2C actions. Aerostack Q2C activates at the CLARIFY > VALIDATE transition (first paid engagement) and runs continuously through OPERATE.

### Stage 1 — CLARIFY > VALIDATE transition (first quote)

1. Opportunity graduates in CRM (qualified, solution line identified, band-tier estimated). The existing Opps agent creates the deal in HubSpot.
2. Seller opens the Deal Builder in Aerostack, selects solution line (S1/S2/S3) and one or more offerings from the catalog.
3. Aerostack pre-fills an engagement-lifecycle template with default VALIDATE scope (e.g., MAP assessment, EBA workshop).
4. Seller configures scope: user counts, data volumes, AWS funding eligibility flags, partner-of-record selection.
5. Aerostack runs pricing logic, produces a quote with: assessment fee, net-of-AWS-funding view, anticipated BUILD range, OPERATE recurring estimate.
6. Approval routing: standard terms auto-approve; non-standard routes per the approval matrix.
7. Contract generated from template, signed in e-sign, Aerostack marks VALIDATE activated.
8. Order generated and handed to delivery lead (assessment pod or EBA workshop lead).

### Stage 2 — VALIDATE execution

1. Milestones tracked (kickoff, findings, readout). Invoicing triggers per milestone OR on completion, per contract terms.
2. AWS funding claim submitted in parallel; Aerostack tracks claim status and applies funding offset to customer invoice.
3. Outputs of VALIDATE (findings, pilot recommendation) become inputs to a BUILD quote — the BUILD quote re-uses account data, so the seller is not re-keying anything.

### Stage 3 — BUILD quote and execution

1. New quote ties to existing account; solution line carries over; offerings may be combined (e.g., one BUILD scope + one OPERATE subscription committed up front).
2. BUILD pricing supports fixed-fee, T&M, or hybrid. T&M requires timesheet integration for periodic invoicing.
3. Contract amendments (scope changes, change orders) generate new line items linked to the parent contract — not new contracts.
4. Completion of BUILD triggers automatic activation of the committed OPERATE subscription. No re-contracting required.

### Stage 4 — OPERATE (recurring, evergreen)

1. LaunchLogic / CSP / CostOpt runs on subscription terms. Monthly billing with optional metered usage overlay.
2. CSP consumption data flows from cloud provider > One-CT > Aerostack > billing vendor > invoice.
3. Managed resell margin computed at the resell-channel level (TD Synnex vs. Ingram) and attributed to sourcing party.
4. Tiered referral to GGTC computed on managed services revenue from GGTC-sourced accounts.
5. Practice MRR computed continuously for investor reporting and step-down triggers.

### Non-happy-path flows (must be first-class)

- **Scope change mid-BUILD:** Change order, re-price, re-approve, amend contract without breaking the parent deal.
- **Customer pauses OPERATE:** Subscription suspension, pro-rated credit, clear reactivation path.
- **AWS funding claim denied:** Re-invoice customer for the full amount, reconcile with finance.
- **Partner-of-record change:** Channel reassignment, margin re-attribution going forward, prior invoices locked.
- **Custom activation gate:** Aerostack holds the activation gate, triggers billing on delivery-system signal ("implementation accepted").
- **Price protection / grandfathering:** Catalog version pinned at contract execution; future catalog changes do not touch active contracts.
- **Multi-entity billing:** Entity-aware invoicing (US entity bills US customer, EU entity bills EU customer from same master agreement).

---

## 8. API surface draft

All Q2C APIs live in the tools-api as new Lambda function modules, following the existing pattern (`tools-api/functions/{module}/handler.py`).

### 8.1 Catalog API (`/catalog`)

```
GET    /catalog/offerings                    — list active offerings (filterable by solution_line, category)
GET    /catalog/offerings/{id}               — get offering detail
POST   /catalog/offerings                    — create offering (admin only)
PUT    /catalog/offerings/{id}               — update offering (creates new version)
POST   /catalog/offerings/{id}/deprecate     — deprecate offering
GET    /catalog/bundles                      — list bundle templates
```

### 8.2 Quote API (`/quotes`)

```
POST   /quotes                               — create quote from opportunity
GET    /quotes/{id}                          — get quote with line items
PUT    /quotes/{id}                          — update quote (creates new version)
POST   /quotes/{id}/line-items               — add line item
DELETE /quotes/{id}/line-items/{item_id}     — remove line item
PUT    /quotes/{id}/line-items/{item_id}     — configure line item (scope, terms)
POST   /quotes/{id}/submit                   — submit for approval
POST   /quotes/{id}/approve                  — approve (authorized approvers only)
POST   /quotes/{id}/reject                   — reject with reason
GET    /quotes/{id}/compare/{version}        — redline comparison between versions
POST   /quotes/{id}/generate-proposal        — generate PDF/docx proposal
```

### 8.3 Contract API (`/contracts`)

```
POST   /contracts                            — generate contract from accepted quote
GET    /contracts/{id}                       — get contract detail
POST   /contracts/{id}/send-for-signature    — send to e-sign
GET    /contracts/{id}/signature-status       — check e-sign status
POST   /contracts/{id}/activate              — activate contract (triggers order generation)
POST   /contracts/{id}/amendments            — create amendment/change order
POST   /contracts/{id}/suspend               — suspend contract
POST   /contracts/{id}/terminate             — terminate contract
```

### 8.4 Order API (`/orders`)

```
GET    /orders                               — list orders (filterable by contract, account, status)
GET    /orders/{id}                          — get order with milestones
POST   /orders/{id}/milestones/{mid}/complete — mark milestone complete (delivery system calls this)
POST   /orders/{id}/milestones/{mid}/accept   — accept milestone (triggers billing if configured)
```

### 8.5 Billing API (`/billing`)

```
GET    /billing/invoices                     — list invoices (filterable by account, contract, status)
GET    /billing/invoices/{id}                — get invoice detail
POST   /billing/funding-claims               — create AWS funding claim
PUT    /billing/funding-claims/{id}          — update claim status
GET    /billing/funding-claims               — list claims (filterable by account, program, status)
```

### 8.6 Channel API (`/channel`)

```
GET    /channel/assignments                  — list channel assignments
POST   /channel/assignments                  — assign partner-of-record
PUT    /channel/assignments/{id}             — reassign (forward-only)
GET    /channel/referrals                    — list referral calculations
GET    /channel/margins                      — list managed resell margins
POST   /channel/reconcile                    — reconcile distributor statement
```

### 8.7 Practice API (`/practice`)

```
GET    /practice/mrr                         — current Practice MRR and step-down status
GET    /practice/mrr/history                 — historical MRR snapshots
GET    /practice/bands                       — band tracking records
GET    /practice/revenue-splits              — revenue split views per engagement stage
GET    /practice/funnel                      — pipeline-to-revenue funnel
```

---

## 9. Integrations and system boundaries

### 9.1 Upstream (data flows INTO Aerostack Q2C)

| System | Purpose | Payload | Frequency |
|---|---|---|---|
| CRM (HubSpot today) | Opportunity qualification, account attributes | Opportunity, Account, Contact | Event-driven (via existing Opps agent) |
| Aerostack Delivery module | Milestone completion, T&M timesheet aggregates | Milestone signal, T&M hours batch | Event-driven |
| One-CT / cloud provider APIs | Consumption for CSP billing, cost-opt findings | Usage events, cost-opt savings | Hourly to daily |
| AWS Partner Central (PC3) | Partner program attributions, funding claim status | Program status, claim status | Daily sync |
| Distributor statements (TD Synnex, Ingram) | Realized resell margin | CSV/statement feeds | Monthly |

### 9.2 Downstream (data flows OUT OF Aerostack Q2C)

| System | Purpose | Payload | Frequency |
|---|---|---|---|
| Billing vendor (Union) | Invoice generation, payment capture | Subscription, invoice schedule, usage events | Event-driven |
| Tax engine (Avalara) | Tax calculation on invoices | Invoice line items, jurisdictions | Per invoice |
| E-signature (DocuSign) | Contract signature | Contract PDF + signer envelope | Per contract |
| Accounting / GL (NetSuite) | Rev-rec posting, AR, financial reporting | Rev-rec schedule, invoice, payment | Daily batch |
| GGTC partner reporting | Partnership KPIs, Practice MRR, step-down | Aggregate monthly report | Monthly (push) |

### 9.3 Peer systems (Aerostack internal)

| Module | Relationship |
|---|---|
| Aerostack Opps (active) | Opportunity source; Q2C reads account/opportunity, writes back stage-progression signals |
| Aerostack Delivery (building) | Receives Orders; posts milestone completions and acceptance signals back |
| Aerostack One-CT (planned) | Provides consumption and cost-opt usage for OPERATE billing |
| Aerostack PC3 / Channel Command | Specialized fulfillment for PC3 migrations — treated as a pod type within the Order model |
| Aerostack Practice Analytics | Consumes Practice MRR snapshots and band tracking records |

---

## 10. Q2C as Aerostack modules (modular platform alignment)

Per the Aerostack Modular Platform Vision, Q2C ships as installable modules:

| Module ID | Category | Phase | Description |
|---|---|---|---|
| `core-catalog` | core | 1 | Offering catalog, pricing models, versioning |
| `core-cpq` | core | 1 | Quote construction, approval routing, proposal generation |
| `core-contracts` | core | 2 | Contract generation, e-sign, amendments, activation gates |
| `core-orders` | core | 2 | Order hand-off, milestone tracking, billing triggers |
| `integration-union` | integration | 3 | Billing vendor integration (Union or alternative) |
| `integration-docusign` | integration | 2 | E-signature integration |
| `integration-avalara` | integration | 3 | Tax engine integration |
| `core-channel` | core | 4 | Partner economics, managed resell, tiered referral |
| `core-practice-mrr` | core | 4 | Practice MRR computation, step-down monitoring |
| `dashboard-deal-builder` | dashboard | 1 | CPQ UI for sellers |
| `dashboard-approvals` | dashboard | 1 | Approval queue for practice leaders |
| `dashboard-channel-ledger` | dashboard | 4 | Channel economics for partner ops |
| `dashboard-investor` | dashboard | 4 | Practice MRR and step-down for investors |
| `workflow-quote-to-contract` | workflow | 2 | Automated quote > contract > order flow |
| `workflow-billing-triggers` | workflow | 3 | Milestone > billing instruction automation |
| `agent-pricing` | agent | 1 | Extends existing Pricing agent with catalog tools |
| `agent-quote` | agent | 1 | Quote construction and management |
| `agent-contract` | agent | 2 | Contract lifecycle management |
| `agent-billing` | agent | 3 | Billing instruction generation and tracking |
| `agent-channel` | agent | 4 | Channel economics computation |

Each module follows the `AerostackModule` interface from the platform vision and registers its agents via the agent registry pattern from PRD-REGISTRY-FIRST-AGENT-DEPLOYMENT.

---

## 11. Cross-cutting requirements

### Audit logging

Every create/update on pricing, contract, and billing carries an audit event:

```typescript
interface Q2cAuditEvent {
  event_id: string;
  timestamp: string;
  actor_id: string;
  actor_role: string;
  action: 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'sign' | 'activate' | 'suspend' | 'terminate';
  entity_type: 'offering' | 'quote' | 'contract' | 'order' | 'invoice' | 'funding_claim' | 'channel_assignment' | 'referral';
  entity_id: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  ip_address?: string;
}
```

### Role-based access

- Sellers see their deals and quotes
- Partners see their attributed accounts
- Investors see aggregated views only
- Finance sees all financial data
- Practice leaders see approval queues and margin views
- Admins see everything

### API-first

All Q2C capabilities are exposed as REST APIs (Section 8) so the CRM, delivery systems, and billing vendor integrate cleanly. The frontend consumes the same APIs.

### CRM-agnostic design

Aerostack Q2C must not be tightly coupled to HubSpot. The Opps agent is the integration boundary — Q2C reads opportunities from the Opps agent's data model, not from HubSpot directly. When HubSpot is replaced (transcript notes intent to exit at ~$20K/mo), only the Opps agent changes.

---

## 12. Open questions (to close before build starts)

| # | Question | Owner | Decision gate |
|---|---|---|---|
| 1 | Billing vendor: Union confirmed? | Will | April 29 engineer call |
| 2 | E-sign vendor: DocuSign confirmed? | Will | Before Phase 2 |
| 3 | Tax engine: Avalara for US, what for India/APJ? | Finance | Before Phase 3 |
| 4 | CRM migration timeline: when does HubSpot exit? | Will | Affects Opps agent abstraction priority |
| 5 | S4 solution line (Data & AI Governance): active or reserved? | Will | Before catalog build |
| 6 | Rev-rec policy (ASC 606 bundle allocation methodology): documented? | Finance | Before Phase 3 |
| 7 | Product packaging decision gates: which Q2C modules are customer-facing? | Will | After Phase 4 |
| 8 | Joint-delivery contract model: multi-party signature + attribution design | Will + Partner ops | Before Phase 2 |
| 9 | Investor view UX: separate spec needed? | Will | Before Phase 4 |
| 10 | Accounting system: NetSuite confirmed? | Finance | Before Phase 3 GL export |

---

## 13. Success metrics

| Metric | Current (manual) | Phase 1 target | Phase 4 target |
|---|---|---|---|
| Time to generate a quote | 2-4 hours (spreadsheet) | < 15 minutes | < 5 minutes |
| Quote-to-contract cycle | 1-2 weeks (email + Word) | < 3 days | < 1 day |
| Invoice generation | Manual (hours) | Automated on trigger | Automated on trigger |
| Practice MRR computation | Monthly spreadsheet (hours) | N/A | Real-time, continuous |
| Partner referral calculation | Manual per deal | N/A | Automated per period |
| AWS funding reconciliation | Manual spreadsheet | Tracked per claim | Automated reconciliation |
| Revenue data for accounting | Manual export | N/A | Daily batch export |
| Deals requiring re-keying across stages | 100% | 0% | 0% |

---

## 14. Suggested next steps

1. **April 29:** Run Union engineer call against Sections 6.5, 6.6, 6.7, and 9.2. Specific probes: multi-entity multi-currency live showcase, pluggable tax, CRM-agnostic ingest, AWS funding offset handling, practice MRR calc (custom aggregate), referral tiering.
2. **By May 2:** Decide billing vendor (Union vs. Stripe direct). This unblocks Phase 3 design.
3. **By May 5:** Confirm e-sign vendor (DocuSign assumed). This unblocks Phase 2.
4. **May 5-9:** Build the offering catalog data model and seed it with the ~20-30 current SKUs. This is the foundation everything else depends on.
5. **May 9:** Begin Phase 1 build (Catalog + CPQ). Target: sellers can build structured quotes in Aerostack by end of May.
6. **June:** Phase 2 (Contracts + Order Hand-off). Target: accepted quotes become executable contracts with e-sign.
7. **July-August:** Phase 3 (Billing + Revenue). Target: contracts generate invoices via billing vendor.
8. **September:** Phase 4 (Channel Economics + Practice Reporting). Target: Practice MRR is a live metric.

---

*Draft v0.2 — Will Horn + Kiro — 2026-04-23. Iterated from v0.1 with full codebase validation. This document is the Q2C commercial spine PRD. Adjacent modules (CRM/Opps, Delivery, One-CT, PC3, Practice Analytics) are referenced but not specified here — they have or will have their own PRDs.*