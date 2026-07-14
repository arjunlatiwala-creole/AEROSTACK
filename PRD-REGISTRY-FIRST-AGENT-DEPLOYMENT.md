# PRD: Registry-First Agent Deployment Pattern

**Status:** Draft
**Date:** 2026-03-06
**Owner:** Will
**Depends on:** ABP (Agent Builder Platform) for build/deploy, Aerostack for runtime/registry

---

## Delivery Model: Composable Enterprise GRC Private SaaS

This architecture is a **Composable Enterprise GRC Private SaaS** delivery model. Each word is load-bearing:

- **Composable** — the shim is catalog-driven. Customers subscribe to agents and integrations; only those resources get provisioned. Add the Delivery agent later, the shim grows. Remove HubSpot, the secret goes away. It's not a monolith you deploy and hope they use all of.

- **Enterprise** — customers deploy the shim in their own account, through their own pipeline, with their own change management. CloudTrail, KMS CMK, IAM with external ID — all the boxes their security team needs to check. The shim construct imports into their existing CDK app if they want it to feel native.

- **GRC** — SOC 2 mapped, cdk-nag zero suppressions, data classification tags on every table, audit-log always deployed, PITR on everything, PII never cached in the control plane. Compliance is baked into the shim construct itself, not bolted on later.

- **Private SaaS** — the customer's data never leaves their account. enterprise's IP never enters their account. Customers get outcomes through the Aerostack UI; enterprise gets access through a scoped cross-account role the customer can revoke at any time. SaaS economics (subscription, multi-tenant control plane) with private deployment guarantees (their VPC, their KMS, their CloudTrail).

### Market Position

Most SaaS says "trust us with your data." Most on-prem/private cloud says "here's our code, run it yourself." This sits in the gap — customers keep their data, enterprise keeps its IP, and the shim is the thin contract between the two. This is a differentiated delivery model for regulated industries and enterprise buyers who can't send data to a third-party SaaS but also don't want to operate the platform themselves.

### Delivery Models

The shim construct is the same code in all three models. The only difference is who runs `cdk deploy` and where the construct lives.

| Model | Who Deploys | Target Customer | Pricing |
|-------|-------------|-----------------|---------|
| **A: Managed** | enterprise runs `cdk deploy` into customer account (via Organizations or deployment role) | SMB / Startup — buying outcomes, not infrastructure | SaaS subscription |
| **B: Self-Service** | Customer runs the shim CDK stack in their own pipeline, feeds stack outputs to Aerostack | Enterprise — needs change management and security review | Platform license |
| **C: Embedded** | Customer imports the shim construct into their existing CDK app | Enterprise-plus — wants data plane native to their environment | Enterprise contract |

In all three models, the customer gets tables and a door. enterprise runs the agents against those tables through the cross-account role. The customer never calls the shim tables directly — the Aerostack platform UI hits the control plane, which reaches into their data plane.

---

## Problem

Aerostack agents are defined in a static TypeScript catalog (`aerostack-agents.ts`) that requires a code deploy to add, update, or remove agents. The DynamoDB agent registry exists but is treated as a mirror of the static catalog, not as the source of truth. There is no pattern for an external system to build an agent, deploy it, register it, and have it appear in Aerostack without a frontend code change.

The same gap exists for knowledge bases and API endpoints — they can be created at runtime via the tools-api, but there's no lifecycle that connects "someone requested a new capability" to "that capability is live and discoverable in Aerostack."

---

## Goal

Define a complete request → build → deploy → register → discover lifecycle where:

1. A user or system requests a new agent, KB, or API capability
2. ABP (or another external platform) builds and deploys it
3. The deployed artifact self-registers with the Aerostack registry
4. Aerostack discovers and surfaces it without any code change
5. Health and status are tracked continuously

---

## What Exists Today

| Component | Status | Gap |
|-----------|--------|-----|
| Agent Registry API (`POST /agents`) | Working | Accepts external registrations but frontend ignores them |
| `RegistryClient` (Python) | Working | Agents can self-register, heartbeat, deregister |
| `AgentDefinition` model | Working | Has `endpoint`, `kb_access`, `kb_write`, `capabilities`, `status` |
| `DashboardAgents` UI | Working | Reads static catalog first, registry second — inverts the right priority |
| KB Registry (`/knowledge`) | Working | System KBs auto-seed, custom KBs creatable at runtime |
| `Aerostack_AGENT_CATALOG` | Working | Static, requires code deploy to change |
| Health checks | Missing | No polling of registered agent endpoints |
| KB provisioning on registration | Missing | Agent declares `kb_access` but nothing provisions |
| Registration contract | Partial | Basic fields exist, no health URL, no manifest schema |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  ABP (Agent Builder Platform) — external                 │
│                                                          │
│  1. User requests new agent/KB/API                       │
│  2. ABP scaffolds, builds, deploys (Lambda, container,   │
│     Bedrock AgentCore, etc.)                             │
│  3. ABP calls Aerostack registration API with manifest        │
└──────────────────────┬───────────────────────────────────┘
                       │ POST /agents/register
                       │ (agent manifest)
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Aerostack Registry (tools-api)                               │
│                                                          │
│  4. Validates manifest schema                            │
│  5. Creates agent record (status: registering)           │
│  6. Provisions declared KBs if they don't exist          │
│  7. Calls agent health endpoint to verify                │
│  8. Sets status: active (or error if health fails)       │
│  9. Emits registration event                             │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Aerostack Frontend (pwa-frontend)                            │
│                                                          │
│  10. DashboardAgents reads registry as source of truth   │
│  11. New agent appears with status badge                 │
│  12. Static catalog entries shown as "bundled defaults"   │
│  13. CopilotKit actions auto-registered for new agent    │
└──────────────────────────────────────────────────────────┘
```

---

## Registration Manifest Schema

The manifest is what ABP (or any external deployer) sends to register an agent:

```typescript
interface AgentManifest {
  // Identity
  name: string;
  description: string;
  version: string;
  owner: string;

  // Classification
  agent_type: 'tool' | 'autonomous' | 'workflow' | 'assistant';
  domain: 'delivery' | 'revenue' | 'people' | 'devops' | 'strategy' | 'custom';
  tier: 'foundation' | 'intelligence' | 'executive';
  tags: string[];

  // Runtime
  endpoint: string;           // URL or Lambda ARN
  health_url: string;         // GET returns 200 if healthy
  auth_type: 'none' | 'iam' | 'bearer' | 'api_key';
  auth_config?: Record<string, unknown>;

  // Capabilities
  capabilities: string[];     // Tool names this agent exposes
  tools: AgentToolManifest[];

  // Data flow
  consumes: string[];         // Agent IDs this reads from
  feeds: string[];            // Agent IDs this writes to

  // Knowledge
  kb_access: string[];        // KB IDs to read (provisioned if missing)
  kb_write: string[];         // KB IDs to write (provisioned if missing)
  kb_create?: KbCreateRequest[]; // New KBs to create on registration

  // Model
  model?: string;             // e.g. 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
}

interface AgentToolManifest {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;  // JSON Schema
  output_schema?: Record<string, unknown>;
}

interface KbCreateRequest {
  name: string;
  description: string;
  category: 'system' | 'custom' | 'agent';
  access: 'team' | 'private' | 'agent-only';
  icon?: string;
}
```

---

## Agent Lifecycle

```
                    POST /agents/register
                           │
                           ▼
                    ┌──────────────┐
                    │  registering │
                    └──────┬───────┘
                           │ manifest validated,
                           │ KBs provisioned,
                           │ health check called
                           ▼
              ┌────────────┴────────────┐
              │                         │
       health 200                 health fail
              │                         │
              ▼                         ▼
       ┌──────────┐             ┌──────────┐
       │  active   │             │  error   │
       └──────┬────┘             └──────┬───┘
              │                         │
              │ periodic health         │ retry via
              │ check fails             │ PUT /agents/{id}
              │                         │
              ▼                         │
       ┌──────────────┐                 │
       │  unhealthy   │ ◄──────────────┘
       └──────┬───────┘
              │ 3 consecutive
              │ failures
              ▼
       ┌──────────────┐
       │  deregistered│
       └──────────────┘
```

Valid statuses: `registering`, `active`, `unhealthy`, `error`, `paused`, `deregistered`

---

## Required Changes

### 1. Registry API — Enhanced Registration Endpoint

New endpoint: `POST /agents/register`

Accepts the full `AgentManifest`. On receipt:
- Validates manifest against schema (Zod or Pydantic)
- Creates agent record with `status: registering`
- For each KB in `kb_create`: calls knowledge handler to create
- For each KB in `kb_access`/`kb_write`: verifies existence
- Calls `health_url` — if 200, sets `status: active`; otherwise `status: error`
- Returns the created agent record with `agent_id`

The existing `POST /agents` stays as-is for simple CRUD. The new `/agents/register` is the full lifecycle endpoint.

### 2. Health Reconciler

A Lambda on a 5-minute EventBridge schedule:
- Scans all agents with `status: active` or `status: unhealthy`
- Calls each agent's `health_url`
- If active agent fails health: set `status: unhealthy`, increment `health_fail_count`
- If unhealthy agent passes health: set `status: active`, reset `health_fail_count`
- If `health_fail_count >= 3`: set `status: deregistered`
- Agents with `status: paused` or `status: deregistered` are skipped

### 3. Frontend — Registry-First Discovery

`DashboardAgents` changes:
- Primary data source: `GET /agents` (DynamoDB registry)
- Static `Aerostack_AGENT_CATALOG` becomes "bundled defaults" — shown with a badge if not yet registered
- Externally-registered agents appear alongside catalog agents
- Status badges reflect real-time registry status, not static catalog status
- "Seed Registry" button remains for bootstrapping catalog defaults

### 4. KB Provisioning on Registration

When an agent registers with `kb_create`:
- Call the knowledge handler's `create_kb` for each entry
- Store the created KB IDs back on the agent record
- If a KB in `kb_access` or `kb_write` doesn't exist and isn't in `kb_create`, return a validation error

### 5. CopilotKit Auto-Discovery (Future)

When CopilotKit is integrated:
- On page load, fetch active agents from registry
- For each agent with an `endpoint`, register a `useCopilotAction`
- Agent's `tools` array becomes the action's parameter schema
- Agent's `description` becomes the action description
- New agents appear in the copilot without any code change

---

## ABP Responsibilities (Out of Scope for Aerostack)

ABP handles everything before registration:
- Accepting the user's request for a new agent/capability
- Scaffolding the agent code (Lambda handler, container, etc.)
- Deploying to AWS (CDK, SAM, or direct)
- Obtaining the deployed endpoint URL and health URL
- Calling `POST /agents/register` with the manifest
- Handling build failures and retries

Aerostack does not build or deploy agents. It receives registrations and manages the runtime lifecycle.

---

## Deployment Topology: Split-Plane (IP Protection)

The fundamental constraint: any code deployed into a customer's AWS account is extractable by the customer. Lambda Layers, compiled bytecode, obfuscated bundles — none of it survives a determined account owner reading `/opt` in a Lambda or pulling a container image. Python `.pyc` is trivially decompilable. Even Cython `.so` files are reversible with binary analysis.

The only architecture that protects enterprise platform IP is a split-plane model where agent logic never leaves the enterprise account.

### The Split

```
┌──────────────────────────────────────────────────────────┐
│  enterprise AWS Account (CONTROL PLANE — your IP)           │
│                                                          │
│  ├── Aerostack Platform UI (app.aerostack.com)                     │
│  ├── Agent Lambdas / Fargate (all orchestration logic)   │
│  ├── Prompt templates, KB engine, scoring models         │
│  ├── Agent registry, health reconciler                   │
│  ├── ABP (agent builder/deployer)                        │
│  └── Bedrock calls (optional — or use customer's)        │
│                                                          │
│         │ STS AssumeRole (cross-account)                  │
│         │ scoped to specific tables/buckets               │
│         │ external ID prevents confused deputy            │
│         ▼                                                │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Customer AWS Account (DATA PLANE — their data)          │
│                                                          │
│  ├── DynamoDB tables (known schema, their data)          │
│  ├── S3 buckets (their documents, uploads)               │
│  ├── Bedrock model access (their usage, their bill)      │
│  └── IAM Role: aerostack-data-access                          │
│       ├── Trusts: enterprise account ID                     │
│       ├── ExternalId: aerostack-tenant-{customer_id}          │
│       ├── Grants: dynamodb:GetItem, PutItem, Query, Scan │
│       │           on specific table ARNs only            │
│       ├── Grants: s3:GetObject, PutObject                │
│       │           on specific bucket ARNs only           │
│       └── Grants: bedrock:InvokeModel (optional)         │
│                                                          │
│  Total customer-deployed code: ~50 lines of CDK          │
└──────────────────────────────────────────────────────────┘
```

### What the Customer Deploys

A single CDK stack — this is the entire customer-side artifact:

```python
class AerostackCustomerDataPlane(cdk.Stack):
    def __init__(self, scope, id, *,
                 aerostack_account_id: str,
                 tenant_id: str,
                 **kwargs):
        super().__init__(scope, id, **kwargs)

        # Data tables (customer owns this data)
        self.data_table = dynamodb.Table(self, "AerostackData",
            table_name=f"aerostack-{tenant_id}-data",
            partition_key=dynamodb.Attribute(
                name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(
                name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        self.kb_table = dynamodb.Table(self, "AerostackKb",
            table_name=f"aerostack-{tenant_id}-kb",
            partition_key=dynamodb.Attribute(
                name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(
                name="sk", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
        )

        # Cross-account role — enterprise assumes this to access data
        self.access_role = iam.Role(self, "AerostackAccess",
            role_name=f"aerostack-access-{tenant_id}",
            assumed_by=iam.AccountPrincipal(aerostack_account_id),
            external_id=f"aerostack-tenant-{tenant_id}",
            max_session_duration=cdk.Duration.hours(1),
        )

        self.data_table.grant_read_write_data(self.access_role)
        self.kb_table.grant_read_write_data(self.access_role)

        # Outputs for Aerostack registration
        cdk.CfnOutput(self, "RoleArn", value=self.access_role.role_arn)
        cdk.CfnOutput(self, "DataTableName", value=self.data_table.table_name)
        cdk.CfnOutput(self, "KbTableName", value=self.kb_table.table_name)
        cdk.CfnOutput(self, "Region", value=self.region)
```

No agent code. No prompts. No orchestration logic. Just tables and a door.

### What enterprise Retains

Everything that makes Aerostack valuable:
- Agent orchestration logic (how agents chain, what they decide)
- Prompt templates (the actual intelligence layer)
- KB engine (vector search, classification, auto-routing)
- Scoring models (deal scoring, CSAT analysis, content quality)
- Platform UI (dashboards, copilot, agent management)
- Registry and health management
- ABP (the builder/deployer itself)

The customer gets outcomes (scored deals, generated content, delivery insights). They never see how those outcomes are produced.

### Cross-Account Data Access Pattern

When an Aerostack agent needs customer data:

1. Agent Lambda in enterprise account calls STS `AssumeRole` with the customer's role ARN and external ID
2. STS returns temporary credentials scoped to that role's permissions
3. Agent uses those credentials to read/write the customer's DynamoDB tables
4. Credentials expire after the session (max 1 hour)
5. All access is logged in the customer's CloudTrail

The customer can revoke access at any time by deleting the IAM role. They can audit every access via CloudTrail. They maintain full sovereignty over their data while enterprise maintains full sovereignty over the platform logic.

### Bedrock Model Access

Two options per customer:

1. enterprise pays for Bedrock, marks up in subscription price — simpler, customer doesn't need Bedrock enabled
2. Customer pays for Bedrock directly — agent assumes their role, calls Bedrock in their account, they see usage on their bill

Option 2 is better for enterprise customers who want cost visibility. Option 1 is better for SMBs who want simplicity.

### Customer Onboarding Flow

```
1. Customer signs up on app.aerostack.com
2. Aerostack generates a tenant ID and provides the CDK stack template
3. Customer deploys the CDK stack in their AWS account
   (or enterprise deploys it for them via AWS Organizations if managed)
4. Customer provides the stack outputs (role ARN, table names, region)
5. Aerostack stores tenant config: { tenant_id, role_arn, external_id, tables, region }
6. Aerostack agents can now access customer data via cross-account role
7. Customer sees their dashboards on app.aerostack.com, scoped to their tenant
```

### Why This Works

- Same model as Datadog, Coralogix, CloudHealth, Spot.io — proven at scale
- AWS explicitly supports and documents cross-account role assumption
- Customer retains data sovereignty and can revoke access instantly
- enterprise retains all platform IP — nothing proprietary leaves the enterprise account
- Latency overhead is minimal (~50-100ms for STS AssumeRole, cached for session duration)
- Customer's AWS bill reflects only their data storage and optional Bedrock usage

---

## Customer Deployment Pattern (Multi-Tenant)

For multi-tenant scenarios where a customer gets their own agent fleet:

1. Customer deploys the data-plane CDK stack (tables + IAM role)
2. Aerostack stores tenant config with role ARN and table references
3. Agents in enterprise account assume the customer's role when operating on their data
4. Aerostack frontend scopes all views to the authenticated tenant
5. Shared/platform agents are available to all tenants
6. Customer-specific agents are registered with `owner: {tenant_id}`
7. Customer-specific KBs are created in the customer's KB table via cross-account access

---

## Success Criteria

- An agent deployed by ABP appears in Aerostack DashboardAgents within 60 seconds of registration
- An agent that goes down is marked unhealthy within 10 minutes
- A new KB declared in the manifest is queryable immediately after registration
- No frontend code change required to surface a new agent
- The static catalog continues to work as bundled defaults for bootstrapping
- No enterprise platform code is deployed into customer AWS accounts
- Customer data never leaves the customer's AWS account
- Customer can revoke enterprise access by deleting the IAM role

---

## Development & Testing Strategy

The shim is the product's installation footprint. The agents are the product. Build and validate the shim first, then every customer engagement is: deploy the shim, point agents at it, charge for the runtime.

### Phase 1: Single-Account Simulation

Test the entire cross-account pattern without a second AWS account:

1. In the enterprise account, deploy the customer data-plane CDK stack with `aerostack_account_id` set to your own account ID
2. This creates the DynamoDB tables, Secrets Manager entries, and IAM role — all in the same account
3. Modify agent code to accept a `tenant_config` (role ARN, table names, region) and use STS `AssumeRole` for all data access instead of direct table references
4. Validate that every agent works through the role assumption path — no direct table access anywhere
5. This proves the shim works and that agents are fully decoupled from the data layer

The key discipline: even in dev, agents must never use hardcoded table names or direct credentials. Every data operation goes through `AssumeRole` → scoped credentials → table access. If it works in single-account simulation, it works cross-account with zero code changes.

### Phase 2: Two-Account Validation

Use a second AWS account (even a personal one) to validate the real cross-account boundary:

1. Deploy the data-plane CDK stack into the second account
2. Feed the stack outputs (role ARN, table names, region) into Aerostack tenant config
3. Run the full agent suite against the remote data plane
4. Verify CloudTrail in the second account shows the expected access patterns
5. Test revocation: delete the IAM role, confirm agents fail gracefully with clear error

### Phase 3: Customer Pilot

First real customer deployment:

1. Provide the customer the CDK stack template (or deploy it for them)
2. Customer runs `cdk deploy` — takes under 2 minutes
3. Customer provides stack outputs
4. Aerostack onboards the tenant, agents start operating on their data
5. Customer sees dashboards on app.aerostack.com scoped to their tenant

### What to Build First

The shim CDK stack and the agent-side `TenantDataClient` — a Python class that wraps STS AssumeRole and provides typed access to tenant tables and secrets. Every agent imports this client instead of using boto3 directly. This is the single abstraction that makes the split-plane work.

```python
class TenantDataClient:
    """All agent data access goes through this client."""

    def __init__(self, tenant_config: TenantConfig):
        self._config = tenant_config
        self._session = None
        self._session_expiry = None

    def _get_session(self) -> boto3.Session:
        """Assume the tenant's cross-account role, cache the session."""
        if self._session and self._session_expiry > datetime.now(timezone.utc):
            return self._session

        sts = boto3.client("sts")
        creds = sts.assume_role(
            RoleArn=self._config.role_arn,
            RoleSessionName=f"aerostack-agent-{self._config.tenant_id}",
            ExternalId=self._config.external_id,
            DurationSeconds=3600,
        )["Credentials"]

        self._session = boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=self._config.region,
        )
        self._session_expiry = creds["Expiration"]
        return self._session

    def data_table(self) -> dynamodb.Table:
        session = self._get_session()
        return session.resource("dynamodb").Table(self._config.data_table_name)

    def kb_table(self) -> dynamodb.Table:
        session = self._get_session()
        return session.resource("dynamodb").Table(self._config.kb_table_name)

    def get_secret(self, secret_id: str) -> str:
        session = self._get_session()
        client = session.client("secretsmanager")
        return client.get_secret_value(SecretId=secret_id)["SecretString"]

    def bedrock_client(self) -> botocore.client.BaseClient:
        session = self._get_session()
        return session.client("bedrock-runtime")
```

Every agent handler changes from `table = dynamodb.Table(TABLE_NAME)` to `table = tenant_client.data_table()`. That's the migration. Once that's done, the agents work against any tenant's data plane — same account, different account, doesn't matter.

---

## Shim Table Design: Catalog-Driven Data Plane

The customer data-plane CDK stack (the "shim") does not deploy a fixed set of tables. It reads from a table catalog — a typed registry of table schemas keyed by agent/integration — and provisions only the tables required by the customer's subscribed agents and integrations.

This means: if a customer subscribes to the Opps agent and the Content agent, they get the deals table, the content table, and the KB table. They don't get the Perspex sessions table or the delivery table. The shim builder CDK construct reads the catalog, filters by subscription, and synthesizes only what's needed.

### Table Schema Catalog

The catalog is a typed data structure that both the shim builder and agents reference. It lives in the `common/` package so it's shared across the CDK construct and the agent runtime.

```typescript
interface ShimTableDefinition {
  tableId: string;                    // Unique key: 'deals', 'content', 'kb', etc.
  description: string;
  partitionKey: { name: string; type: 'S' | 'N' };
  sortKey?: { name: string; type: 'S' | 'N' };
  gsis?: ShimGsiDefinition[];
  ttlAttribute?: string;             // Enable TTL on this attribute if present
  pointInTimeRecovery: boolean;       // Always true for GRC compliance
  dataClassification: 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  requiredByAgents: string[];         // Agent IDs that need this table
  requiredByIntegrations: string[];   // Integration IDs that need this table
}

interface ShimGsiDefinition {
  indexName: string;
  partitionKey: { name: string; type: 'S' | 'N' };
  sortKey?: { name: string; type: 'S' | 'N' };
  projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes?: string[];
}
```

### Catalog Entries

Derived from the existing Aerostack table patterns in `tools_stack.py` and agent handlers:

| Table ID | PK / SK | GSIs | Classification | Required By |
|----------|---------|------|----------------|-------------|
| `agent-registry` | `agent_id` (S) | `by-type` (agent_type/updated_at), `by-status` (status/updated_at) | INTERNAL | core (always deployed) |
| `kb` | `pk` (S) / `sk` (S) | — | CONFIDENTIAL | content-strategy, content-creator, content-publisher, any agent with `kbAccess` |
| `content` | `pk` (S) / `sk` (S) | — | INTERNAL | content-strategy, content-creator, content-publisher |
| `deals` | `pk` (S) / `sk` (S) | `by-status` (status/updated_at), `by-owner` (owner/created_at) | CONFIDENTIAL | opps, sow, pricing |
| `delivery` | `pk` (S) / `sk` (S) | `by-engagement` (engagement_id/updated_at), `by-health` (health_status/check_date) | INTERNAL | delivery, csat |
| `people` | `pk` (S) / `sk` (S) | `by-role` (role/name), `by-utilization` (utilization_band/name) | CONFIDENTIAL | utilization, staffing, slack-admin |
| `perspex-sessions` | `pk` (S) / `sk` (S) | — | INTERNAL | perspex (cooperation engine) |
| `workflows` | `pk` (S) / `sk` (S) | `by-status` (status/scheduled_at) | INTERNAL | strategy, any workflow-type agent |
| `audit-log` | `pk` (S) / `sk` (S) | `by-user` (user_id/timestamp), `by-resource` (resource_type/timestamp) | RESTRICTED | core (always deployed for GRC) |

### Secrets Manager Catalog

Integrations that require external API credentials get Secrets Manager entries provisioned by the shim. The catalog maps integration IDs to secret definitions:

| Secret ID | Description | Required By Integration |
|-----------|-------------|------------------------|
| `{tenant}-hubspot-pat` | HubSpot Personal Access Token | `integration-hubspot` |
| `{tenant}-slack-bot-token` | Slack Bot OAuth Token | `integration-slack` |
| `{tenant}-linear-api-key` | Linear API Key | `integration-linear` |
| `{tenant}-stripe-secret` | Stripe Secret Key | `integration-stripe` |
| `{tenant}-builder-io-key` | Builder.io API Key | `integration-builder` |
| `{tenant}-bedrock-config` | Bedrock model preferences and config | `integration-bedrock` (optional) |

Secrets are created as empty placeholders by the shim. The customer (or enterprise onboarding) populates them after deployment. Agents access secrets via the `TenantDataClient.get_secret()` method through the cross-account role.

### How the Shim Builder Works

The shim builder is a CDK construct that accepts a tenant ID, the enterprise account ID, and a list of subscribed agent/integration IDs. It filters the catalog and synthesizes only the required resources:

```
Input:
  tenant_id: "acme-corp"
  aerostack_account_id: "730335467631"
  subscribed_agents: ["opps", "sow", "content-strategy", "content-creator"]
  subscribed_integrations: ["integration-hubspot", "integration-slack"]

Catalog lookup:
  opps → needs: deals table
  sow → needs: deals table (already included)
  content-strategy → needs: content table, kb table
  content-creator → needs: content table (already included), kb table (already included)
  integration-hubspot → needs: hubspot-pat secret
  integration-slack → needs: slack-bot-token secret
  core → always: agent-registry table, audit-log table

Output CDK resources:
  DynamoDB: agent-registry, deals, content, kb, audit-log (5 tables)
  Secrets Manager: hubspot-pat, slack-bot-token (2 secrets)
  IAM Role: scoped to exactly those 5 tables + 2 secrets
  KMS Key: customer-managed, used by all tables and secrets
```

The IAM role's policy is synthesized from the exact set of provisioned resources — no wildcards, no extra permissions. If the customer later subscribes to the Delivery agent, the shim is re-deployed with the updated subscription list, and the delivery table + any new secrets are added. Existing tables are untouched (CDK handles this via CloudFormation update).

### Agent-Side Table Resolution

Agents don't hardcode table names. The `TenantDataClient` resolves table names from the tenant config, which stores the mapping of table IDs to physical table names:

```python
# Tenant config stored in Aerostack control plane
tenant_config = {
    "tenant_id": "acme-corp",
    "role_arn": "arn:aws:iam::123456789012:role/aerostack-access-acme-corp",
    "external_id": "aerostack-tenant-acme-corp",
    "region": "us-east-1",
    "tables": {
        "agent-registry": "aerostack-acme-corp-agent-registry",
        "deals": "aerostack-acme-corp-deals",
        "content": "aerostack-acme-corp-content",
        "kb": "aerostack-acme-corp-kb",
        "audit-log": "aerostack-acme-corp-audit-log",
    },
    "secrets": {
        "hubspot-pat": "aerostack-acme-corp-hubspot-pat",
        "slack-bot-token": "aerostack-acme-corp-slack-bot-token",
    },
}
```

The `TenantDataClient` gains a `table(table_id: str)` method that resolves from this map:

```python
# Agent code — no hardcoded table names
deals = tenant_client.table("deals")
deals.put_item(Item={"pk": "DEAL#123", "sk": "META", ...})

kb = tenant_client.table("kb")
kb.query(KeyConditionExpression=Key("pk").eq("KB#system-brand-voice"))
```

If an agent requests a table that wasn't provisioned for this tenant (e.g., the Delivery agent tries to access the `delivery` table for a tenant that didn't subscribe to it), the `TenantDataClient` raises a clear error: `TableNotProvisioned: Table 'delivery' is not available for tenant 'acme-corp'`.

---

## GRC Compliance: Data-Plane Security Requirements

The shim is the security boundary between enterprise's platform and the customer's data. Every shim deployment must universally meet enterprise GRC standards — this is not optional, not configurable, and not tier-dependent. A free-tier customer gets the same security posture as an enterprise customer.

### Encryption

All data at rest and in transit is encrypted:

- Every DynamoDB table: encrypted with a customer-managed KMS key (CMK) created by the shim
- Every Secrets Manager secret: encrypted with the same CMK
- The CMK key policy grants usage to the cross-account IAM role and the customer's account root
- All DynamoDB access enforces TLS via IAM policy condition: `aws:SecureTransport: true`
- The KMS key has automatic annual rotation enabled

```python
# Shim creates one CMK for all tenant resources
self.tenant_key = kms.Key(self, "TenantKey",
    alias=f"alias/aerostack-{tenant_id}",
    description=f"Aerostack tenant encryption key for {tenant_id}",
    enable_key_rotation=True,
    removal_policy=RemovalPolicy.RETAIN,
)
```

### IAM: Least Privilege

The cross-account role follows strict least-privilege principles:

- Trusts only the enterprise account ID (single principal)
- Requires external ID (`aerostack-tenant-{tenant_id}`) to prevent confused deputy attacks
- Maximum session duration: 1 hour
- Grants only `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan`, `BatchGetItem`, `BatchWriteItem` on the exact table ARNs provisioned
- Grants only `secretsmanager:GetSecretValue` on the exact secret ARNs provisioned
- Grants `kms:Decrypt`, `kms:GenerateDataKey` on the tenant CMK only
- No wildcard resources, no `*` actions
- Optionally grants `bedrock:InvokeModel` if the customer pays for their own Bedrock usage

### Point-in-Time Recovery

All DynamoDB tables have point-in-time recovery (PITR) enabled. This is non-negotiable — it provides continuous backups with 35-day recovery window and is required for SOC 2 compliance.

```python
# Every table in the shim
dynamodb.Table(self, table_id,
    point_in_time_recovery=True,
    # ... other props
)
```

### Audit Logging

The shim deploys a dedicated `audit-log` table for every tenant. This table is always provisioned regardless of subscription — it's a core GRC requirement.

Additionally, the customer's AWS CloudTrail captures all DynamoDB, Secrets Manager, STS, and KMS API calls made by the cross-account role. The shim does not create CloudTrail (the customer likely already has it), but the onboarding documentation specifies that CloudTrail must be enabled in the customer account.

The audit-log table schema:

| Field | Type | Description |
|-------|------|-------------|
| `pk` | S | `AUDIT#{YYYY-MM-DD}` — partitioned by date |
| `sk` | S | `{timestamp}#{request_id}` — sortable within day |
| `user_id` | S | Who performed the action (agent ID or human user) |
| `action` | S | CRUD operation type |
| `resource_type` | S | Entity type (deal, content, kb_entry, etc.) |
| `resource_id` | S | Entity identifier |
| `resource_classification` | S | Data classification level |
| `outcome` | S | `success` or `failure` |
| `ttl` | N | Auto-expire after retention period (default: 365 days) |

GSIs: `by-user` (user_id / sk), `by-resource` (resource_type / sk)

### Tagging

Every resource created by the shim carries the full enterprise tag set. Tags are applied at the stack level via CDK `Tags.of(self)`:

| Tag | Value |
|-----|-------|
| `enterprise:deployed-by` | `aerostack-shim` |
| `enterprise:customer` | `{tenant_id}` |
| `enterprise:engagement` | `aerostack-platform` |
| `enterprise:workload` | `data-plane` |
| `enterprise:module` | `shim` |
| `enterprise:env` | `{stage}` (dev / staging / prod) |
| `enterprise:grc` | `soc2` (default — overridable for HIPAA, GDPR, etc.) |
| `enterprise:solution` | `aerostack` |

Additionally, each DynamoDB table gets a `enterprise:data-classification` tag matching its catalog entry (INTERNAL, CONFIDENTIAL, or RESTRICTED).

### Data Retention

- DynamoDB tables with `ttlAttribute` in the catalog have TTL enabled — items auto-expire after the configured retention period
- The `audit-log` table has a default TTL of 365 days (configurable per customer, minimum 365 for SOC 2)
- Tables without TTL (e.g., `deals`, `kb`) retain data indefinitely — deletion is handled by the application layer or customer request
- When a tenant is offboarded, the shim stack is destroyed, which deletes all tables (or retains them per `RemovalPolicy` — default RETAIN for safety)

### SOC 2 Mapping

| SOC 2 Criteria | Shim Control |
|----------------|-------------|
| CC6.1 — Logical Access | Cross-account IAM role with external ID, scoped to exact resource ARNs |
| CC6.2 — Access Provisioning | Role created by CDK, permissions derived from subscription catalog |
| CC6.3 — Access Removal | Customer deletes IAM role to revoke; shim stack destroy for offboarding |
| CC6.6 — Encryption | KMS CMK for all tables and secrets, TLS enforced via policy condition |
| CC7.1 — System Monitoring | CloudTrail in customer account, audit-log table in shim |
| CC7.2 — Anomaly Detection | Customer's GuardDuty monitors cross-account role usage |
| CC8.1 — Change Management | Shim deployed via CDK with version-controlled templates |
| A1.2 — Recovery | PITR on all tables, KMS key retained on stack deletion |

### cdk-nag Compliance

The shim CDK stack must pass `cdk-nag` with zero suppressions. The `AwsSolutions` rule pack is applied:

```python
from cdk_nag import AwsSolutionsChecks
import aws_cdk as cdk

app = cdk.App()
stack = AerostackCustomerDataPlane(app, "AerostackShim", ...)
cdk.Aspects.of(app).add(AwsSolutionsChecks(verbose=True))
```

Key rules the shim must satisfy:
- `AwsSolutions-DDB3`: DynamoDB PITR enabled ✓
- `AwsSolutions-IAM4`: No AWS managed policies on custom roles ✓
- `AwsSolutions-IAM5`: No wildcard permissions ✓
- `AwsSolutions-KMS5`: KMS key rotation enabled ✓
- `AwsSolutions-SMG4`: Secrets Manager rotation configured ✓ (rotation Lambda optional — at minimum, rotation policy declared)

### PII Handling

Tables classified as CONFIDENTIAL or RESTRICTED (deals, people, kb) may contain PII. The shim enforces:

- KMS encryption at rest (CMK, not AWS-managed key)
- No PII in table names, GSI names, or tag values
- Agents accessing PII tables must emit audit events for every read/write
- The `TenantDataClient` logs all CONFIDENTIAL+ table access to the audit-log table automatically
- PII is never cached in the enterprise control plane — it's read from the customer's tables, processed in-memory, and the response is returned. No intermediate storage.

---

## Non-Goals (This PRD)

- Building the ABP agent builder/deployer (that's ABP's domain)
- CopilotKit integration (separate effort, depends on this)
- AWS Organizations multi-account automation
- Agent versioning and rollback (future PRD)
- Agent marketplace / module store (future PRD)
