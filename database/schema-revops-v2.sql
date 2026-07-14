-- Aerostack V2 - RevOps Focused Schema
-- Flexible pipeline tracking with dynamic fields and lifecycle stages

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing types if migrating
DROP TYPE IF EXISTS deal_phase CASCADE;
DROP TYPE IF EXISTS health_status CASCADE;
DROP TYPE IF EXISTS event_type CASCADE;

-- =============================================
-- Deal Phases (Vertical Grouping)
-- =============================================
CREATE TYPE deal_phase AS ENUM (
  'LEAD',              -- Early prospect
  'DEVELOPING',        -- Qualified, being worked
  'ACTIVELY_FUNDING',  -- In negotiation/closing
  'CLOSED_WON',        -- Won (last 30d)
  'CLOSED_LOST',       -- Lost (last 30d)
  'LAUNCHED'           -- Launched/live (last 30d)
);

-- =============================================
-- Health Status (Color Coding)
-- =============================================
CREATE TYPE health_status AS ENUM (
  'GREEN',    -- Healthy, on track
  'YELLOW',   -- Needs attention
  'ORANGE',   -- At risk, blocked
  'RED'       -- Critical, lost
);

-- =============================================
-- Event Types (Change Tracking)
-- =============================================
CREATE TYPE event_type AS ENUM (
  'PHASE_CHANGE',
  'STAGE_CHANGE',
  'FIELD_UPDATE',
  'NOTE_ADDED',
  'HEALTH_CHANGE',
  'OWNER_CHANGE',
  'CREATED',
  'ARCHIVED'
);

-- =============================================
-- People Table (Contacts, Owners, Team)
-- =============================================
CREATE TABLE people (
  person_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  company         TEXT,
  role_title      TEXT,
  phone           TEXT,
  linkedin_url    TEXT,
  
  -- Internal team fields
  is_internal     BOOLEAN DEFAULT FALSE,
  team_area       TEXT, -- e.g., 'RevOps', 'Sales', 'CS'
  
  -- Metadata
  tags            TEXT[] DEFAULT '{}',
  custom_fields   JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_people_email ON people(email);
CREATE INDEX idx_people_company ON people(company);
CREATE INDEX idx_people_is_internal ON people(is_internal);

-- =============================================
-- Deals Table (Core RevOps Entity)
-- =============================================
CREATE TABLE deals (
  deal_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  name                    TEXT NOT NULL,
  description             TEXT,
  company                 TEXT,
  
  -- Lifecycle
  phase                   deal_phase NOT NULL DEFAULT 'LEAD',
  stage                   TEXT, -- Flexible stage within phase
  health_status           health_status DEFAULT 'GREEN',
  
  -- Ownership
  owner_id                UUID REFERENCES people(person_id),
  contact_id              UUID REFERENCES people(person_id),
  
  -- Financials
  amount                  NUMERIC(12,2),
  currency                TEXT DEFAULT 'USD',
  expected_close_date     DATE,
  actual_close_date       DATE,
  
  -- Priority & Scoring
  priority                INT CHECK (priority BETWEEN 1 AND 5),
  confidence_score        INT CHECK (confidence_score BETWEEN 1 AND 100),
  
  -- Integration Links
  hubspot_deal_id         TEXT UNIQUE,
  jira_key                TEXT,
  
  -- Flexible Fields
  tags                    TEXT[] DEFAULT '{}',
  custom_fields           JSONB DEFAULT '{}', -- Any additional fields
  
  -- Metadata
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  archived_at             TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_deals_phase ON deals(phase);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_health ON deals(health_status);
CREATE INDEX idx_deals_owner ON deals(owner_id);
CREATE INDEX idx_deals_hubspot ON deals(hubspot_deal_id);
CREATE INDEX idx_deals_tags ON deals USING GIN (tags);
CREATE INDEX idx_deals_custom_fields ON deals USING GIN (custom_fields);
CREATE INDEX idx_deals_close_date ON deals(expected_close_date);

-- =============================================
-- Deal Events (Activity & Change History)
-- =============================================
CREATE TABLE deal_events (
  event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID REFERENCES deals(deal_id) ON DELETE CASCADE,
  event_type      event_type NOT NULL,
  
  -- Event details
  actor_id        UUID REFERENCES people(person_id), -- Who made the change
  description     TEXT,
  
  -- Before/After for tracking changes
  before_value    JSONB,
  after_value     JSONB,
  
  -- Metadata
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_deal ON deal_events(deal_id);
CREATE INDEX idx_events_type ON deal_events(event_type);
CREATE INDEX idx_events_created ON deal_events(created_at DESC);

-- =============================================
-- Deal Notes (Communication & Context)
-- =============================================
CREATE TABLE deal_notes (
  note_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID REFERENCES deals(deal_id) ON DELETE CASCADE,
  author_id       UUID REFERENCES people(person_id),
  
  content         TEXT NOT NULL,
  note_type       TEXT, -- e.g., 'MEETING', 'CALL', 'EMAIL', 'INTERNAL'
  
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notes_deal ON deal_notes(deal_id);
CREATE INDEX idx_notes_created ON deal_notes(created_at DESC);

-- =============================================
-- Deal Stages Config (Flexible Stage Definitions)
-- =============================================
CREATE TABLE stage_definitions (
  stage_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_name      TEXT NOT NULL,
  phase           deal_phase NOT NULL,
  sort_order      INT NOT NULL,
  
  -- Stage configuration
  required_fields TEXT[], -- Fields that must be filled at this stage
  color           TEXT,    -- UI color for this stage
  description     TEXT,
  
  UNIQUE(phase, stage_name)
);

CREATE INDEX idx_stages_phase ON stage_definitions(phase, sort_order);

-- =============================================
-- Custom Field Definitions (Schema Registry)
-- =============================================
CREATE TABLE field_definitions (
  field_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key       TEXT UNIQUE NOT NULL,
  field_label     TEXT NOT NULL,
  field_type      TEXT NOT NULL, -- 'text', 'number', 'date', 'select', 'boolean', 'url'
  
  -- For select/dropdown fields
  options         JSONB, -- Array of possible values
  
  -- Validation
  is_required     BOOLEAN DEFAULT FALSE,
  validation_rule TEXT,
  
  -- UI hints
  placeholder     TEXT,
  help_text       TEXT,
  
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Triggers
-- =============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deal_notes_updated_at BEFORE UPDATE ON deal_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create event when deal is created
CREATE OR REPLACE FUNCTION log_deal_creation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO deal_events (deal_id, event_type, description, after_value)
    VALUES (
        NEW.deal_id,
        'CREATED',
        'Deal created',
        jsonb_build_object(
            'name', NEW.name,
            'phase', NEW.phase,
            'stage', NEW.stage
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deal_created
AFTER INSERT ON deals
FOR EACH ROW EXECUTE FUNCTION log_deal_creation();

-- Auto-log phase changes
CREATE OR REPLACE FUNCTION log_phase_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.phase IS DISTINCT FROM NEW.phase THEN
        INSERT INTO deal_events (deal_id, event_type, description, before_value, after_value)
        VALUES (
            NEW.deal_id,
            'PHASE_CHANGE',
            'Phase changed from ' || OLD.phase || ' to ' || NEW.phase,
            jsonb_build_object('phase', OLD.phase),
            jsonb_build_object('phase', NEW.phase)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deal_phase_change
AFTER UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION log_phase_change();

-- =============================================
-- Views for Common Queries
-- =============================================

-- All active deals with owner info
CREATE VIEW v_deals_active AS
SELECT 
    d.*,
    owner.name as owner_name,
    owner.email as owner_email,
    contact.name as contact_name,
    contact.email as contact_email,
    contact.company as contact_company
FROM deals d
LEFT JOIN people owner ON d.owner_id = owner.person_id
LEFT JOIN people contact ON d.contact_id = contact.person_id
WHERE d.archived_at IS NULL
ORDER BY d.phase, d.priority ASC, d.expected_close_date ASC;

-- Deals grouped by phase (for vertical grouping)
CREATE VIEW v_deals_by_phase AS
SELECT 
    d.phase,
    COUNT(*) as deal_count,
    SUM(d.amount) as total_amount,
    AVG(d.confidence_score) as avg_confidence,
    COUNT(CASE WHEN d.health_status = 'GREEN' THEN 1 END) as green_count,
    COUNT(CASE WHEN d.health_status = 'YELLOW' THEN 1 END) as yellow_count,
    COUNT(CASE WHEN d.health_status = 'ORANGE' THEN 1 END) as orange_count,
    COUNT(CASE WHEN d.health_status = 'RED' THEN 1 END) as red_count
FROM deals d
WHERE d.archived_at IS NULL
GROUP BY d.phase
ORDER BY 
    CASE d.phase
        WHEN 'LEAD' THEN 1
        WHEN 'DEVELOPING' THEN 2
        WHEN 'ACTIVELY_FUNDING' THEN 3
        WHEN 'CLOSED_WON' THEN 4
        WHEN 'LAUNCHED' THEN 5
        WHEN 'CLOSED_LOST' THEN 6
    END;

-- Recent activity (last 30 days)
CREATE VIEW v_deals_recent AS
SELECT 
    d.*,
    owner.name as owner_name,
    owner.email as owner_email
FROM deals d
LEFT JOIN people owner ON d.owner_id = owner.person_id
WHERE d.phase IN ('CLOSED_WON', 'CLOSED_LOST', 'LAUNCHED')
    AND d.updated_at >= NOW() - INTERVAL '30 days'
ORDER BY d.updated_at DESC;

-- =============================================
-- Sample Data
-- =============================================

-- Internal team members
INSERT INTO people (name, email, is_internal, team_area) VALUES
('Will Horn', 'will@enterprise.io', TRUE, 'RevOps'),
('Sarah Miller', 'sarah@enterprise.io', TRUE, 'Sales'),
('Mike Chen', 'mike@enterprise.io', TRUE, 'Customer Success');

-- Sample stage definitions
INSERT INTO stage_definitions (stage_name, phase, sort_order, color) VALUES
-- Lead stages
('New Lead', 'LEAD', 1, '#E8F5E9'),
('Contacted', 'LEAD', 2, '#C8E6C9'),
('Qualified', 'LEAD', 3, '#A5D6A7'),

-- Developing stages
('Discovery', 'DEVELOPING', 1, '#FFF9C4'),
('Proposal', 'DEVELOPING', 2, '#FFF59D'),
('Negotiation', 'DEVELOPING', 3, '#FFEE58'),

-- Funding stages
('Contract Review', 'ACTIVELY_FUNDING', 1, '#FFE082'),
('Signatures Pending', 'ACTIVELY_FUNDING', 2, '#FFCA28'),
('Closing', 'ACTIVELY_FUNDING', 3, '#FFC107');

-- Sample custom field definitions
INSERT INTO field_definitions (field_key, field_label, field_type, help_text) VALUES
('aoe_map_pct', 'AoE Map %', 'number', 'Percentage of area of engagement mapped'),
('abm_scope_fit', 'ABM Scope-Gx Fit', 'select', 'Account-based marketing scope and fit score'),
('funding_progress', 'Funding Progress', 'number', 'Current funding stage progress percentage'),
('next_step', 'Next Step', 'text', 'Next action item for this deal'),
('has_name_title', 'Has Name Title', 'text', 'Key decision maker name and title');

COMMENT ON TABLE deals IS 'Core RevOps entity for tracking leads, opportunities, and customers through the sales pipeline';
COMMENT ON TABLE deal_events IS 'Audit log of all changes and activities on deals';
COMMENT ON TABLE stage_definitions IS 'Flexible stage configuration for each phase of the pipeline';
COMMENT ON TABLE field_definitions IS 'Schema registry for custom fields that can be added to deals';

