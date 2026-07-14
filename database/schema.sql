-- Aerostack V1 Database Schema
-- PostgreSQL database schema for AgentiCo Aerostack prioritization system

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing types if they exist (for development)
DROP TYPE IF EXISTS loop_category CASCADE;
DROP TYPE IF EXISTS loop_type CASCADE;
DROP TYPE IF EXISTS loop_status CASCADE;
DROP TYPE IF EXISTS loop_phase CASCADE;
DROP TYPE IF EXISTS ownership_role CASCADE;
DROP TYPE IF EXISTS visibility_flag CASCADE;
DROP TYPE IF EXISTS pillar CASCADE;

-- Create enums
CREATE TYPE loop_category AS ENUM (
  'ENG','MSP','GTM','BD','OPS:Finance','OPS:HR','OPS:SalesOps','LND','ADVISORY'
);

CREATE TYPE loop_type AS ENUM ('OBJECTIVE','KEY_RESULT');

CREATE TYPE loop_status AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','ARCHIVED');

CREATE TYPE loop_phase AS ENUM ('PROJECTION','ASSERTION','FOCUS','FEEDBACK','ADAPTATION');

CREATE TYPE ownership_role AS ENUM ('OUTCOME_OWNER','CONTRIBUTOR');

CREATE TYPE visibility_flag AS ENUM ('PUBLIC','INTERNAL');

CREATE TYPE pillar AS ENUM ('REVOPS','TECHOPS','ADMINOPS','CROSS');

-- Category→Pillar mapping table
CREATE TABLE category_pillar_map (
  category        loop_category PRIMARY KEY,
  default_pillar  pillar NOT NULL
);

-- Insert category→pillar mappings
INSERT INTO category_pillar_map VALUES
 ('ENG','TECHOPS'),('MSP','TECHOPS'),
 ('GTM','REVOPS'),('BD','REVOPS'),
 ('OPS:Finance','ADMINOPS'),('OPS:HR','ADMINOPS'),('OPS:SalesOps','REVOPS'),
 ('LND','CROSS'),('ADVISORY','CROSS');

-- People table
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

-- Loops table (core entity)
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

-- Indexes for loops
CREATE INDEX idx_loops_category ON loops(category);
CREATE INDEX idx_loops_status   ON loops(status);
CREATE INDEX idx_loops_phase    ON loops(phase);
CREATE INDEX idx_loops_pillar   ON loops(pillar);
CREATE INDEX idx_loops_tags     ON loops USING GIN (tags);

-- Trigger function to set default pillar based on category
CREATE OR REPLACE FUNCTION set_default_pillar() RETURNS trigger AS $$
BEGIN
  IF NEW.pillar IS NULL THEN
    SELECT default_pillar INTO NEW.pillar
    FROM category_pillar_map WHERE category = NEW.category;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Trigger to auto-set pillar on loop creation
CREATE TRIGGER trg_loops_default_pillar
BEFORE INSERT ON loops
FOR EACH ROW EXECUTE FUNCTION set_default_pillar();

-- Function to calculate loop score
CREATE OR REPLACE FUNCTION calculate_loop_score() RETURNS trigger AS $$
BEGIN
  IF NEW.effort_score IS NOT NULL AND NEW.outcome_score IS NOT NULL THEN
    NEW.loop_score = NEW.effort_score * NEW.outcome_score;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Trigger to auto-calculate loop score
CREATE TRIGGER trg_loops_calculate_score
BEFORE UPDATE ON loops
FOR EACH ROW EXECUTE FUNCTION calculate_loop_score();

-- Loop ownership table (owner + contributors)
CREATE TABLE loop_ownership (
  ownership_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id       UUID REFERENCES loops(loop_id) ON DELETE CASCADE,
  person_id     UUID REFERENCES people(person_id),
  role          ownership_role NOT NULL,
  credit_share  NUMERIC(4,2) NOT NULL    -- 1.00 for owner; 0.25–0.50 contributors
);

-- Ensure only one owner per loop
CREATE UNIQUE INDEX ux_one_owner_per_loop
ON loop_ownership(loop_id) WHERE role='OUTCOME_OWNER';

-- Lessons learned table
CREATE TABLE lessons (
  lesson_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID REFERENCES loops(loop_id) ON DELETE CASCADE,
  abstract    TEXT CHECK (char_length(abstract) <= 280),
  tags        TEXT[] DEFAULT '{}',
  reuse_notes TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for lesson tags
CREATE INDEX idx_lessons_tags ON lessons USING GIN (tags);

-- Resume items (auto-generated achievements)
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

-- Indexes for resume items
CREATE INDEX idx_resume_person     ON resume_items(person_id);
CREATE INDEX idx_resume_visibility ON resume_items(visibility);

-- Velocity snapshots for performance tracking
CREATE TABLE velocity_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID REFERENCES people(person_id),
  window_start    DATE NOT NULL,
  window_end      DATE NOT NULL,
  velocity_score  NUMERIC(6,3),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to relevant tables
CREATE TRIGGER update_people_updated_at BEFORE UPDATE ON people
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE VIEW v_loops_with_ownership AS
SELECT 
    l.*,
    owner.name as owner_name,
    owner.email as owner_email,
    array_agg(DISTINCT contrib.name) FILTER (WHERE contrib.name IS NOT NULL) as contributors
FROM loops l
LEFT JOIN loop_ownership lo_owner ON l.loop_id = lo_owner.loop_id AND lo_owner.role = 'OUTCOME_OWNER'
LEFT JOIN people owner ON lo_owner.person_id = owner.person_id
LEFT JOIN loop_ownership lo_contrib ON l.loop_id = lo_contrib.loop_id AND lo_contrib.role = 'CONTRIBUTOR'
LEFT JOIN people contrib ON lo_contrib.person_id = contrib.person_id
GROUP BY l.loop_id, owner.name, owner.email;

CREATE VIEW v_loops_tabular AS
SELECT 
    l.loop_id,
    l.title,
    l.category,
    l.pillar,
    l.loop_type,
    l.status,
    l.phase,
    l.priority,
    l.target_completion_date,
    l.effort_score,
    l.outcome_score,
    l.loop_score,
    l.tags,
    owner.name as owner_name,
    owner.email as owner_email
FROM loops l
LEFT JOIN loop_ownership lo ON l.loop_id = lo.loop_id AND lo.role = 'OUTCOME_OWNER'
LEFT JOIN people owner ON lo.person_id = owner.person_id
ORDER BY l.priority ASC, l.target_completion_date ASC;

CREATE VIEW v_opportunity_prioritization AS
SELECT 
    l.loop_id,
    l.title,
    l.category,
    l.priority,
    l.target_completion_date,
    l.loop_score,
    CASE 
        WHEN l.loop_score IS NOT NULL THEN l.loop_score * (6 - l.priority) 
        ELSE NULL 
    END as weighted_score,
    owner.name as owner_name
FROM loops l
LEFT JOIN loop_ownership lo ON l.loop_id = lo.loop_id AND lo.role = 'OUTCOME_OWNER'
LEFT JOIN people owner ON lo.person_id = owner.person_id
WHERE l.status IN ('PLANNED', 'IN_PROGRESS')
AND l.category IN ('BD', 'GTM', 'ADVISORY')
ORDER BY l.priority ASC, weighted_score DESC NULLS LAST, l.target_completion_date ASC;

CREATE VIEW v_delivery_status AS
SELECT 
    l.loop_id,
    l.title,
    l.category,
    l.status,
    l.phase,
    l.target_completion_date,
    l.tags,
    owner.name as owner_name
FROM loops l
LEFT JOIN loop_ownership lo ON l.loop_id = lo.loop_id AND lo.role = 'OUTCOME_OWNER'
LEFT JOIN people owner ON lo.person_id = owner.person_id
WHERE l.category IN ('ENG', 'MSP')
AND l.status = 'IN_PROGRESS'
ORDER BY l.target_completion_date ASC;

CREATE VIEW v_learning_loops AS
SELECT 
    l.loop_id,
    l.title,
    l.category,
    l.status,
    l.outcome_score,
    lessons.abstract,
    lessons.tags as lesson_tags,
    owner.name as owner_name
FROM loops l
LEFT JOIN loop_ownership lo ON l.loop_id = lo.loop_id AND lo.role = 'OUTCOME_OWNER'
LEFT JOIN people owner ON lo.person_id = owner.person_id
LEFT JOIN lessons ON l.loop_id = lessons.loop_id
WHERE l.status = 'COMPLETED'
AND lessons.lesson_id IS NOT NULL
ORDER BY l.actual_completion_date DESC;

CREATE VIEW v_person_dashboard AS
SELECT 
    p.person_id,
    p.name,
    p.email,
    p.area,
    COUNT(l.loop_id) as active_loops,
    AVG(l.loop_score) as avg_score,
    COUNT(CASE WHEN l.status = 'COMPLETED' THEN 1 END) as completed_loops
FROM people p
LEFT JOIN loop_ownership lo ON p.person_id = lo.person_id AND lo.role = 'OUTCOME_OWNER'
LEFT JOIN loops l ON lo.loop_id = l.loop_id AND l.status IN ('PLANNED', 'IN_PROGRESS')
GROUP BY p.person_id, p.name, p.email, p.area
ORDER BY p.name;

-- Sample data for development
INSERT INTO people (name, email, role_title, area, level_numeric) VALUES
('Will Horn', 'will@enterprise.io', 'CEO', 'CROSS', 10),
('Daria Doe', 'daria@enterprise.io', 'CTO', 'TECHOPS', 9),
('Alex Smith', 'alex@enterprise.io', 'VP Engineering', 'TECHOPS', 8),
('Sam Johnson', 'sam@enterprise.io', 'VP Sales', 'REVOPS', 8);

-- Grant permissions (adjust as needed for your environment)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aerostack_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aerostack_user;
