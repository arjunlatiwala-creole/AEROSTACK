Great—here’s a single, copy-pasteable PRD that fuses the Aerostack V1 spec with your React PWA baseline, Squid/Cognito prep, API contracts, and TypeScript types. It’s written to be build-ready in a monorepo.

⸻

Aerostack V1 — Product Requirements Document (PRD)

0) Context & Purpose

Aerostack is the prioritization and learning control surface for enterprise. It models work as Loops (Objectives or Key Results), scores outcomes, and exposes dashboards for day-to-day execution. Jira remains the task truth; Aerostack is the prioritization + scoring truth. Slack provides fast input; Squid/Cognito provide auth and agentic UX.

Core Principles
	•	Loops = O or KR (no task-level loops).
	•	Exactly one Outcome Owner; ≤3 Merited Contributors (25–50% each).
	•	Effort (1–5) × Outcome (1–5) = loop score; Velocity = weighted 90-day rolling average (50/30/20).
	•	Weekly: Aerostack used as the agenda; Daily: Jira→Aerostack sync.
	•	Adaptation requires a Lesson (abstract + tags + reuse note).

⸻

1) Scope & Functional Requirements

1.1 Must-Have (V1)
	•	Create/update Loops (O/KR), assign owner, target date, priority, category → pillar auto-mapped.
	•	Score Effort (mid-flight) and Outcome (on close); assign Merited Contributors.
	•	Lessons captured at Adaptation with tags; auto-generate Résumé items on close.
	•	Dashboards (tabular) with filters: Owner, Category, Pillar, Tags, Phase, Status, Priority, Date.
	•	Slack: /aerostack new, /aerostack score {loop_id}, /aerostack list.
	•	Jira: single project; Epic==KR; Boards for TechOps / RevOps / AdminOps; webhook on Epic Done.
	•	Auth prep (Cognito via Squid) wired but disabled until keys present.

1.2 Nice-to-Have (V1.1)
	•	Velocity snapshots job; MSP consistency floor option.
	•	FR/Proposal and Delivery Handoff dedicated visuals (beyond table).
	•	CSV export per dashboard.

⸻

2) Category → Pillar Mapping (fixed in V1)

Category	Pillar
ENG	TECHOPS
MSP	TECHOPS
GTM	REVOPS
BD	REVOPS
OPS:Finance	ADMINOPS
OPS:HR	ADMINOPS
OPS:SalesOps	REVOPS
LND	CROSS
ADVISORY	CROSS


⸻

3) Data Model & Schema (Postgres)

Use exactly these enums, tables, and triggers. No inline types.

3.1 Enums

CREATE TYPE loop_category AS ENUM (
  'ENG','MSP','GTM','BD','OPS:Finance','OPS:HR','OPS:SalesOps','LND','ADVISORY'
);
CREATE TYPE loop_type AS ENUM ('OBJECTIVE','KEY_RESULT');
CREATE TYPE loop_status AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','ARCHIVED');
CREATE TYPE loop_phase  AS ENUM ('PROJECTION','ASSERTION','FOCUS','FEEDBACK','ADAPTATION');
CREATE TYPE ownership_role AS ENUM ('OUTCOME_OWNER','CONTRIBUTOR');
CREATE TYPE visibility_flag AS ENUM ('PUBLIC','INTERNAL');
CREATE TYPE pillar AS ENUM ('REVOPS','TECHOPS','ADMINOPS','CROSS');

3.2 Category→Pillar map

CREATE TABLE category_pillar_map (
  category        loop_category PRIMARY KEY,
  default_pillar  pillar NOT NULL
);

INSERT INTO category_pillar_map VALUES
 ('ENG','TECHOPS'),('MSP','TECHOPS'),
 ('GTM','REVOPS'),('BD','REVOPS'),
 ('OPS:Finance','ADMINOPS'),('OPS:HR','ADMINOPS'),('OPS:SalesOps','REVOPS'),
 ('LND','CROSS'),('ADVISORY','CROSS');

3.3 Tables

CREATE TABLE people (
  person_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  role_title    TEXT,
  area          pillar,
  level_numeric INT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loops (
  loop_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   TEXT NOT NULL,
  description             TEXT,
  category                loop_category NOT NULL,
  pillar                  pillar,
  loop_type               loop_type NOT NULL,
  status                  loop_status NOT NULL DEFAULT 'PLANNED',
  phase                   loop_phase  NOT NULL DEFAULT 'PROJECTION',
  priority                INT DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  start_date              DATE,
  target_completion_date  DATE,
  actual_completion_date  DATE,
  effort_score            INT CHECK (effort_score BETWEEN 1 AND 5),
  outcome_score           INT CHECK (outcome_score BETWEEN 1 AND 5),
  loop_score              NUMERIC(6,2),
  jira_key                TEXT,
  tags                    TEXT[] DEFAULT '{}',
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_loops_category ON loops(category);
CREATE INDEX idx_loops_status   ON loops(status);
CREATE INDEX idx_loops_phase    ON loops(phase);
CREATE INDEX idx_loops_pillar   ON loops(pillar);

CREATE OR REPLACE FUNCTION set_default_pillar() RETURNS trigger AS $$
BEGIN
  IF NEW.pillar IS NULL THEN
    SELECT default_pillar INTO NEW.pillar
    FROM category_pillar_map WHERE category = NEW.category;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loops_default_pillar
BEFORE INSERT ON loops
FOR EACH ROW EXECUTE FUNCTION set_default_pillar();

CREATE TABLE loop_ownership (
  ownership_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id       UUID REFERENCES loops(loop_id) ON DELETE CASCADE,
  person_id     UUID REFERENCES people(person_id),
  role          ownership_role NOT NULL,
  credit_share  NUMERIC(4,2) NOT NULL    -- 1.00 for owner; 0.25–0.50 contributors
);
CREATE UNIQUE INDEX ux_one_owner_per_loop
ON loop_ownership(loop_id) WHERE role='OUTCOME_OWNER';

CREATE TABLE lessons (
  lesson_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID REFERENCES loops(loop_id) ON DELETE CASCADE,
  abstract    TEXT CHECK (char_length(abstract) <= 280),
  tags        TEXT[] DEFAULT '{}',
  reuse_notes TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_lessons_tags ON lessons USING GIN (tags);

CREATE TABLE resume_items (
  resume_item_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID REFERENCES people(person_id),
  loop_id         UUID REFERENCES loops(loop_id),
  title           TEXT NOT NULL,
  category        loop_category NOT NULL,
  score           NUMERIC(6,2),
  date_completed  DATE,
  visibility      visibility_flag DEFAULT 'INTERNAL',
  accreditation   BOOLEAN DEFAULT FALSE,
  public_blurb    TEXT
);
CREATE INDEX idx_resume_person     ON resume_items(person_id);
CREATE INDEX idx_resume_visibility ON resume_items(visibility);

CREATE TABLE velocity_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID REFERENCES people(person_id),
  window_start    DATE NOT NULL,
  window_end      DATE NOT NULL,
  velocity_score  NUMERIC(6,3),
  created_at      TIMESTAMPTZ DEFAULT now()
);


⸻

4) Scoring & Velocity

Loop score

loop_score = effort_score × outcome_score

Velocity (rolling 90d)

W0 = avg(loop_score completed in last 0–30 days)
W1 = avg(loop_score completed in last 31–60 days)
W2 = avg(loop_score completed in last 61–90 days)
Velocity = (W0*0.5) + (W1*0.3) + (W2*0.2)

Optional MSP consistency floor

IF category='MSP': Velocity = GREATEST(Velocity, 0.8 * avg_90d)

Credit application (per-person aggregation)
	•	Owner retains ≥0.50; contributors (≤3) get 0.25–0.50.
	•	A person’s aggregated velocity uses their credit_share × loop_score contributions.

⸻

5) REST API (stateless, JSON)

5.1 Error model (global)

{ "error": { "code": "string", "message": "string", "details": {} } }

5.2 Endpoints

POST /loops.create

{
  "title": "MVP Launch in a Box – ACME",
  "description": "Scope, infra, showcase by EOW",
  "loop_type": "KEY_RESULT",
  "category": "BD",
  "owner_email": "daria@enterprise.io",
  "target_completion_date": "2025-09-15",
  "priority": 2,
  "tags": ["revgen","channel/aws"],
  "jira_key": ""
}

200

{ "loop_id":"UUID","pillar":"REVOPS","jira_key":"Aerostack-241" }

POST /loops.update

{
  "loop_id":"UUID",
  "title":"optional",
  "description":"optional",
  "phase":"FOCUS",
  "status":"IN_PROGRESS",
  "priority":1,
  "owner_email":"daria@enterprise.io",
  "tags":["revgen","proposal"]
}

POST /loops.score-effort

{ "loop_id":"UUID", "effort_score":4 }

POST /loops.score-outcome

{
  "loop_id":"UUID",
  "outcome_score":5,
  "contributors":[
    { "email":"x@enterprise.io","share":0.25 },
    { "email":"y@enterprise.io","share":0.25 }
  ],
  "lesson":{
    "abstract":"Cut ETL cost 40% via S3 events; zero downtime.",
    "tags":["aws","cost-optimization"],
    "reuse_notes":"Template IaC module; replicate to Customer-123."
  }
}

POST /loops.add-tags

{ "loop_id":"UUID", "tags":["handoff","channel/aws"] }

GET /loops.list
	•	Filters: owner_email, category, pillar, tag, phase, status, priority_min, priority_max, due_before, due_after
	•	Returns list with pagination (page, page_size, next_cursor).

GET /loops.view/{loop_id}
	•	Returns loop + ownership + lessons + computed fields.

POST /people.create

{
  "name":"Will Horn",
  "email":"will@enterprise.io",
  "role_title":"CEO",
  "area":"CROSS",
  "level_numeric":10
}

GET /people.lookup?email=… → person record.

⸻

6) TypeScript Types (place in common/types/aerostack.ts)

// Shared enums
export type LoopCategory =
  | 'ENG' | 'MSP' | 'GTM' | 'BD'
  | 'OPS:Finance' | 'OPS:HR' | 'OPS:SalesOps'
  | 'LND' | 'ADVISORY';

export type LoopType = 'OBJECTIVE' | 'KEY_RESULT';
export type LoopStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';
export type LoopPhase  = 'PROJECTION' | 'ASSERTION' | 'FOCUS' | 'FEEDBACK' | 'ADAPTATION';
export type Pillar = 'REVOPS' | 'TECHOPS' | 'ADMINOPS' | 'CROSS';
export type OwnershipRole = 'OUTCOME_OWNER' | 'CONTRIBUTOR';
export type VisibilityFlag = 'PUBLIC' | 'INTERNAL';

// Core entities
export interface Person {
  person_id: string;
  name: string;
  email: string;
  role_title?: string;
  area?: Pillar;
  level_numeric?: number;
  created_at: string;
  updated_at: string;
}

export interface Loop {
  loop_id: string;
  title: string;
  description?: string;
  category: LoopCategory;
  pillar: Pillar;
  loop_type: LoopType;
  status: LoopStatus;
  phase: LoopPhase;
  priority: number; // 1..5
  start_date?: string;
  target_completion_date?: string;
  actual_completion_date?: string;
  effort_score?: number;  // 1..5
  outcome_score?: number; // 1..5
  loop_score?: number;    // effort*outcome
  jira_key?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface LoopOwnership {
  ownership_id: string;
  loop_id: string;
  person_id: string;
  role: OwnershipRole;
  credit_share: number; // 1.0 for owner, 0.25..0.50 for contributors
}

export interface Lesson {
  lesson_id: string;
  loop_id: string;
  abstract: string; // <=280 chars
  tags: string[];
  reuse_notes?: string;
  created_at: string;
}

export interface ResumeItem {
  resume_item_id: string;
  person_id: string;
  loop_id: string;
  title: string;
  category: LoopCategory;
  score?: number;
  date_completed?: string;
  visibility: VisibilityFlag;
  accreditation: boolean;
  public_blurb?: string;
}

export interface VelocitySnapshot {
  snapshot_id: string;
  person_id: string;
  window_start: string;
  window_end: string;
  velocity_score: number;
  created_at: string;
}

// API contracts
export interface CreateLoopRequest {
  title: string;
  description?: string;
  loop_type: LoopType;
  category: LoopCategory;
  owner_email: string;
  target_completion_date?: string;
  priority?: number;
  tags?: string[];
  jira_key?: string;
}
export interface CreateLoopResponse {
  loop_id: string;
  pillar: Pillar;
  jira_key?: string;
}

export interface UpdateLoopRequest {
  loop_id: string;
  title?: string;
  description?: string;
  phase?: LoopPhase;
  status?: LoopStatus;
  priority?: number;
  owner_email?: string;
  tags?: string[];
}

export interface ScoreEffortRequest { loop_id: string; effort_score: number; }

export interface ScoreOutcomeRequest {
  loop_id: string;
  outcome_score: number;
  contributors?: Array<{ email: string; share: number }>;
  lesson?: { abstract: string; tags?: string[]; reuse_notes?: string };
}

export interface AddTagsRequest { loop_id: string; tags: string[]; }

export interface ApiError { error: { code: string; message: string; details?: any } }


⸻

7) Frontend Spec (React + Vite + Redux + Shadcn)

7.1 Project layout (monorepo)

/pwa-frontendd
/common
  /types     # shared TypeScript types (aerostack.ts etc.)
  /utils     # logging, http client, feature flags
/squid-backend

7.2 Web app structure

/pwa-frontend
  /src
    main.tsx
    routes.tsx
  /components
    /ui         # Shadcn (or equivalent) primitives only
    /aerostack       # LoopTable, LoopFormModal, ScoreModal, Filters
  /features
    /loops
      loops.slice.ts        # Redux slice (async thunks calling API)
      loops.api.ts          # fetch wrappers
      hooks.ts
      selectors.ts
    /people
      people.slice.ts
  /pages
    DashboardOrg.tsx
    DashboardOpportunities.tsx
    DashboardDelivery.tsx
    DashboardLearning.tsx
    DashboardPerson.tsx
  /theme
    index.css
    ThemeProvider.tsx
  /store
    index.ts   # configureStore, middleware, persistor
  /env
    config.ts  # reads from .env

7.3 State management
	•	Redux Toolkit for slices & thunks.
	•	Only call the API layer from thunks. Components talk to Redux; Redux talks to API.

7.4 UI/UX
	•	Shadcn (or equivalent) primitives; accessibility first.
	•	Light/Dark mode via ThemeProvider; design tokens exposed.
	•	Loading skeletons & pessimistic fallbacks on all async views.
	•	No overflow/hidden surprises; responsive from mobile up.

7.5 Logging & Telemetry
	•	@enterprise/common/utils/logger.ts wrapper.
	•	Log action, user, payload shape, result, latency (no PII).

7.6 Env & CI/CD
	•	.env files per app; never hardcode keys.
	•	CI: typecheck, lint, unit tests, build, Lighthouse budget.
	•	Feature flags via VITE_FLAG_* for gated features.

⸻

8) MVP Screens (frontend)
	1.	Org Dashboard (default)

	•	v_loops_tabular with filters.
	•	Bulk phase update; owner reassign; close (opens score modal).

	2.	Opportunities

	•	v_opportunity_prioritization sorted (priority asc, weighted_score desc, due asc).
	•	Quick link to /aerostack new?category=BD|GTM|ADVISORY.

	3.	Delivery Status

	•	v_delivery_status (ENG/MSP in flight).
	•	Filter: owner, tag, due.

	4.	Learning / People

	•	v_learning_loops; Person dashboard from v_person_dashboard.

	5.	Loop Create/Edit Modals

	•	Fields per API; pillar is auto-derived (read-only).

	6.	Score Modal

	•	Outcome (1–5), contributors (email+share), lessons (abstract, tags, reuse notes).

⸻

9) Slack Integration

Slash commands
	•	/aerostack new → modal (title, desc, type, category, owner, target, priority, tags, jira_key).
	•	/aerostack score {loop_id} → outcome + contributors + lesson.
	•	/aerostack list → top N open loops by priority.

Store modal JSON files under /apps/api/slack/modals/.

⸻

10) Jira Integration
	•	One project Aerostack.
	•	Issue types: Epic (KR), Story/Task, Sub-task, Bug.
	•	Boards: TechOps, RevOps (includes SalesOps), AdminOps (Finance+HR).
	•	Custom fields: Aerostack_LOOP_ID, Aerostack_CATEGORY, Aerostack_PILLAR, TARGET_COMPLETION_DATE.
	•	Workflow: To Do → In Progress → In Review → Done.
	•	Webhook on Epic Done → API endpoint updates loop status/dates and prompts Outcome scoring.

⸻

11) MVP Flows

Create loop
	•	Modal/Web → /loops.create; pillar set via mapping trigger; Epic created if missing.

Weekly sync
	•	Use Org Dashboard; move phases; confirm owners; merge/kill dupes.

Daily Jira sync
	•	Worker pulls or receives webhook; updates status, actual_completion_date.

Close loop
	•	/loops.score-outcome → set Outcome; add Lesson; assign contributors; create Résumé item.

Velocity
	•	Compute on read + weekly snapshot job to velocity_snapshots.

⸻

12) Security & Access
	•	Auth prepared for AWS Cognito via Squid; keep disabled until keys exist.
	•	All endpoints stateless; bearer token required (middleware stub).
	•	Role claims (future): allow score/close only to owner or admins.

⸻

Appendix 1 — React PWA Frontend Best Practices (Baseline)
	•	React + Vite, TypeScript, Redux Toolkit, Shadcn (or equivalent accessible library).
	•	Monorepo with /common/types.
	•	No inline types; all types in common/types.
	•	No hardcoded env; use .env.
	•	Light/Dark theme switch + tokens.
	•	SRP, SoC, DI where relevant, Singleton for global services.
	•	Async/await, event-driven flows only; no arbitrary timeouts.
	•	Defensive programming: skeletons, retries, safe fallbacks.
	•	DRY; refactor early.
	•	CI/CD-ready; Lighthouse budgets; responsive UX; no visible overflow.
	•	Docs: README with project map, setup, schema, endpoints.

⸻

Appendix 2 — Aerostack Scoring Rubric (Role-agnostic)
	•	ENG: Effort=complexity/scope; Outcome=quality/durability/impact.
	•	MSP: Effort=stewardship breadth; Outcome=SLA/uptime/cost trend.
	•	GTM: Effort=program scale; Outcome=KPI lift/pipeline influence.
	•	BD: Effort=deal complexity; Outcome=$/margin/strategic tier.
	•	OPS (Fin/HR/SalesOps): Effort=org scope; Outcome=adoption/efficiency/compliance.
	•	LND: Effort=depth; Outcome=pass + applied use; enablement.
	•	ADVISORY: Effort=stakeholder/market scale; Outcome=decision→impact.

⸻

If you want, I can split this into:
	•	aerostack_v1_schema.sql
	•	common/types/aerostack.ts
	•	apps/api/openapi.yaml
	•	apps/api/slack/modals/new_loop.json
	•	apps/api/slack/modals/score_loop.json

But you said you can copy/paste directly—so this PRD should be enough to start building now.