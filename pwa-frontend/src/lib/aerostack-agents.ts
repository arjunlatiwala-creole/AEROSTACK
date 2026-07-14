/**
 * Aerostack Agent Registry — catalog of all enterprise consulting platform agents.
 *
 * Each agent maps to a business function within the Aerostack operating system.
 * Agents are organized into domains that mirror enterprise's service delivery model.
 *
 * This is the frontend source of truth. Agents are also registered in the
 * DynamoDB registry via the tools-api for runtime status tracking.
 */

export type AgentStatus = 'active' | 'planned' | 'building' | 'paused' | 'error';
export type AgentTier = 'foundation' | 'intelligence' | 'executive';
export type AgentDomain =
  | 'delivery'
  | 'revenue'
  | 'people'
  | 'devops'
  | 'strategy';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly source?: string;
}

export interface AgentWorkflow {
  readonly id: string;
  readonly name: string;
  readonly schedule?: string;
  readonly trigger?: string;
  readonly description: string;
}

export interface AerostackAgent {
  readonly id: string;
  readonly name: string;
  readonly domain: AgentDomain;
  readonly tier: AgentTier;
  readonly status: AgentStatus;
  readonly replaces: string;
  readonly description: string;
  readonly tools: readonly AgentTool[];
  readonly workflows: readonly AgentWorkflow[];
  readonly consumes: readonly string[];
  readonly feeds: readonly string[];
  readonly slackChannel?: string;
  readonly model?: string;
  readonly reusesFrom?: string;
  readonly apiRoute?: string;
  readonly kbAccess?: readonly string[];
  readonly kbWrite?: readonly string[];
}

export const Aerostack_DOMAINS: Record<
  AgentDomain,
  { label: string; description: string; color: string; icon: string }
> = {
  delivery: {
    label: 'Delivery & Engagement',
    description: 'Client project health, milestones, CSAT, and delivery ops',
    color: 'blue',
    icon: 'Package',
  },
  revenue: {
    label: 'Revenue Operations',
    description: 'Pipeline, deals, SOWs, pricing, and financial tracking',
    color: 'green',
    icon: 'DollarSign',
  },
  people: {
    label: 'People & Talent',
    description: 'Team utilization, capacity, skills, and hiring',
    color: 'purple',
    icon: 'Users',
  },
  devops: {
    label: 'DevOps & Engineering',
    description: 'Repo health, backlog, site reliability, and compliance',
    color: 'orange',
    icon: 'GitBranch',
  },
  strategy: {
    label: 'Strategy & Visibility',
    description: 'Cross-domain synthesis, executive digests, and recommendations',
    color: 'rose',
    icon: 'Compass',
  },
};


/**
 * Aerostack Agent Catalog — the full fleet of enterprise consulting platform agents.
 *
 * Domain 1: Revenue Operations — pipeline, deals, SOWs, pricing
 * Domain 2: Delivery & Engagement — project health, CSAT, milestones
 * Domain 3: People & Talent — utilization, capacity, skills
 * Domain 4: DevOps & Engineering — repos, backlog, reliability
 * Domain 5: Strategy & Visibility — cross-domain synthesis
 */
export const Aerostack_AGENT_CATALOG: readonly AerostackAgent[] = [
  // ── REVENUE OPERATIONS ───────────────────────────────────────
  {
    id: 'opps',
    name: 'Opportunity Scoring',
    domain: 'revenue',
    tier: 'foundation',
    status: 'active',
    replaces: 'Sales ops analyst (deal scoring)',
    description:
      'BANT-based deal scoring, win rate calculation, and pipeline coverage analysis. Scores deals on budget, authority, need, and timeline dimensions.',
    apiRoute: '/opps',
    tools: [
      { name: 'score_deal', description: 'BANT-based deal scoring (0-100)' },
      { name: 'win_rate', description: 'Calculate win rate from deal counts' },
      { name: 'pipeline_coverage', description: 'Pipeline coverage ratio vs target' },
    ],
    workflows: [
      {
        id: 'opps:weekly-pipeline-review',
        name: 'Weekly Pipeline Review',
        schedule: 'Monday 9am',
        description: 'Score all active deals, flag at-risk, calculate coverage',
      },
    ],
    consumes: [],
    feeds: ['strategy', 'sow'],
    slackChannel: '#aerostack-revenue',
  },
  {
    id: 'sow',
    name: 'SOW Generator',
    domain: 'revenue',
    tier: 'foundation',
    status: 'building',
    replaces: 'Engagement manager (SOW drafting)',
    description:
      'Generates Statements of Work from deal data, templates, and engagement parameters. Tracks SOW lifecycle from draft to signed.',
    apiRoute: '/sow',
    tools: [
      { name: 'generate_sow', description: 'Generate SOW from deal + template' },
      { name: 'list_templates', description: 'Available SOW templates by engagement type' },
      { name: 'track_status', description: 'SOW lifecycle tracking (draft → review → signed)' },
    ],
    workflows: [
      {
        id: 'sow:stale-draft-alert',
        name: 'Stale Draft Alert',
        schedule: 'Wednesday 9am',
        description: 'Flag SOWs in draft status for more than 7 days',
      },
    ],
    consumes: ['opps'],
    feeds: ['delivery', 'strategy'],
    slackChannel: '#aerostack-revenue',
  },
  {
    id: 'pricing',
    name: 'Pricing Optimizer',
    domain: 'revenue',
    tier: 'intelligence',
    status: 'planned',
    replaces: 'Revenue ops (pricing analysis)',
    description:
      'Analyzes engagement pricing against market rates, utilization data, and margin targets. Recommends rate adjustments.',
    tools: [
      { name: 'analyze_rates', description: 'Compare rates vs market benchmarks' },
      { name: 'margin_analysis', description: 'Calculate engagement margins' },
      { name: 'rate_recommendations', description: 'Suggest rate adjustments per role/skill' },
    ],
    workflows: [
      {
        id: 'pricing:monthly-rate-review',
        name: 'Monthly Rate Review',
        schedule: '1st of month',
        description: 'Review all engagement rates against utilization and margins',
      },
    ],
    consumes: ['opps', 'delivery', 'people'],
    feeds: ['strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-revenue',
  },

  // ── DELIVERY & ENGAGEMENT ────────────────────────────────────
  {
    id: 'delivery',
    name: 'Delivery Tracker',
    domain: 'delivery',
    tier: 'foundation',
    status: 'building',
    replaces: 'Delivery manager (project health)',
    description:
      'Tracks project milestones, burn rate, velocity, and health scores. Flags at-risk engagements before they become problems.',
    apiRoute: '/delivery-tools',
    tools: [
      { name: 'project_health', description: 'Health score based on burn, velocity, milestones' },
      { name: 'burn_rate', description: 'Hours burned vs budget by engagement' },
      { name: 'milestone_tracker', description: 'Milestone completion and upcoming deadlines' },
      { name: 'velocity_report', description: 'Team velocity trends per engagement' },
    ],
    workflows: [
      {
        id: 'delivery:weekly-health-check',
        name: 'Weekly Health Check',
        schedule: 'Monday 10am',
        description: 'Score all active engagements, flag at-risk projects',
      },
      {
        id: 'delivery:milestone-alert',
        name: 'Milestone Alert',
        schedule: 'Daily 8am',
        description: 'Alert on milestones due within 3 days or overdue',
      },
    ],
    consumes: ['sow'],
    feeds: ['csat', 'strategy'],
    slackChannel: '#aerostack-delivery',
  },
  {
    id: 'csat',
    name: 'CSAT Analyzer',
    domain: 'delivery',
    tier: 'intelligence',
    status: 'building',
    replaces: 'Customer success (satisfaction tracking)',
    description:
      'Manages customer satisfaction surveys, calculates CSAT and NPS scores, identifies trends and at-risk accounts.',
    apiRoute: '/csat',
    tools: [
      { name: 'calculate_csat', description: 'CSAT score from survey responses' },
      { name: 'calculate_nps', description: 'Net Promoter Score calculation' },
      { name: 'trend_analysis', description: 'CSAT trends over time per client' },
      { name: 'at_risk_accounts', description: 'Flag accounts with declining satisfaction' },
    ],
    workflows: [
      {
        id: 'csat:post-milestone-survey',
        name: 'Post-Milestone Survey',
        trigger: 'milestone_completed',
        description: 'Trigger CSAT survey after major milestone delivery',
      },
    ],
    consumes: ['delivery'],
    feeds: ['strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-delivery',
  },
  {
    id: 'engagement',
    name: 'Engagement Comms',
    domain: 'delivery',
    tier: 'foundation',
    status: 'active',
    replaces: 'Account manager (client communications)',
    description:
      'Generates visibility posts, Slack announcements, customer updates, and team communications from Aerostack loop data.',
    tools: [
      { name: 'generate_visibility_post', description: 'Create internal visibility post from loop' },
      { name: 'format_slack_announcement', description: 'Format structured Slack announcement' },
      { name: 'create_customer_update', description: 'Draft customer-facing update' },
      { name: 'draft_team_communication', description: 'Generate team standup/retro content' },
    ],
    workflows: [],
    consumes: ['delivery'],
    feeds: [],
    slackChannel: '#aerostack-delivery',
  },
  {
    id: 'project-handoff',
    name: 'Project Handoff',
    domain: 'delivery',
    tier: 'foundation',
    status: 'building',
    replaces: 'Project coordinator (pre-sales to delivery handoff)',
    description:
      'Automates the pre-sales to delivery handoff — deal commitment validation, pod resourcing, OKR setup, Linear project creation, Deel time card, and kickoff scheduling.',
    apiRoute: '/project-handoff',
    tools: [
      { name: 'select_deal', description: 'Filter and select deals moving to commitment' },
      { name: 'validate_commitment', description: 'Confirm SAL data, funding, engagement type' },
      { name: 'allocate_resources', description: 'Build delivery pod with roles, rates, sprints' },
      { name: 'setup_project', description: 'Create Linear project with OKRs, Deel time card' },
      { name: 'schedule_kickoff', description: 'Gate check and schedule kickoff meeting' },
    ],
    workflows: [
      {
        id: 'project-handoff:deal-to-delivery',
        name: 'Deal to Delivery',
        trigger: 'deal_commitment',
        description: 'Triggered when a deal moves to commitment — runs full handoff flow',
      },
    ],
    consumes: ['opps', 'sow'],
    feeds: ['delivery'],
    slackChannel: '#aerostack-delivery',
  },

  // ── PEOPLE & TALENT ──────────────────────────────────────────
  {
    id: 'slack-admin',
    name: 'Slack Admin',
    domain: 'people',
    tier: 'foundation',
    status: 'active',
    replaces: 'IT admin (Slack workspace management)',
    description:
      'Comprehensive Slack workspace administration — channel CRUD, user invites (workspace, single-channel guest, Slack Connect), user management, and offboarding.',
    apiRoute: '/slack-admin',
    tools: [
      { name: 'list_channels', description: 'List workspace channels with member counts' },
      { name: 'create_channel', description: 'Create public or private channels' },
      { name: 'archive_channel', description: 'Archive a channel' },
      { name: 'invite_to_workspace', description: 'Invite a full member to the workspace' },
      { name: 'invite_guest', description: 'Invite a single-channel guest' },
      { name: 'invite_slack_connect', description: 'Send Slack Connect invite to external user' },
      { name: 'bulk_invite', description: 'Bulk invite multiple emails at once' },
      { name: 'list_users', description: 'List all workspace members with status' },
      { name: 'lookup_user', description: 'Look up a user by email' },
      { name: 'deactivate_user', description: 'Deactivate a user for offboarding' },
    ],
    workflows: [
      {
        id: 'slack-admin:offboarding',
        name: 'Offboarding Checklist',
        trigger: 'manual',
        description: 'Deactivate user, remove from channels, notify team',
      },
    ],
    consumes: [],
    feeds: ['strategy'],
    slackChannel: '#aerostack-people',
  },
  {
    id: 'utilization',
    name: 'Utilization Tracker',
    domain: 'people',
    tier: 'foundation',
    status: 'planned',
    replaces: 'Resource manager (utilization tracking)',
    description:
      'Tracks team member utilization rates, identifies over/under-allocated resources, and forecasts capacity.',
    tools: [
      { name: 'utilization_report', description: 'Current utilization by person/team' },
      { name: 'capacity_forecast', description: 'Available capacity for next 4 weeks' },
      { name: 'bench_report', description: 'Team members on bench with skills' },
    ],
    workflows: [
      {
        id: 'utilization:weekly-report',
        name: 'Weekly Utilization Report',
        schedule: 'Monday 8am',
        description: 'Team utilization rates and capacity forecast',
      },
    ],
    consumes: ['delivery'],
    feeds: ['strategy', 'pricing'],
    slackChannel: '#aerostack-people',
  },
  {
    id: 'staffing',
    name: 'Staffing Matcher',
    domain: 'people',
    tier: 'intelligence',
    status: 'planned',
    replaces: 'Staffing coordinator (skill matching)',
    description:
      'Matches available team members to engagement requirements based on skills, availability, and client preferences.',
    tools: [
      { name: 'match_skills', description: 'Match team skills to engagement requirements' },
      { name: 'availability_check', description: 'Check availability for date range' },
      { name: 'recommend_staffing', description: 'Recommend staffing plan for engagement' },
    ],
    workflows: [
      {
        id: 'staffing:new-engagement-match',
        name: 'New Engagement Match',
        trigger: 'sow_signed',
        description: 'Auto-match team to new signed engagement',
      },
    ],
    consumes: ['sow', 'utilization'],
    feeds: ['delivery'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-people',
  },
  {
    id: 'comp-plan',
    name: 'Comp Plan Builder',
    domain: 'people',
    tier: 'intelligence',
    status: 'building',
    replaces: 'People ops (compensation planning)',
    description:
      'Design and model compensation plan structures — base salary bands, variable/bonus tiers, equity allocations, and total rewards packages. Supports role-based templates and scenario modeling.',
    apiRoute: '/comp-plan',
    tools: [
      { name: 'create_plan', description: 'Create a new compensation plan from template or scratch' },
      { name: 'model_scenario', description: 'Model total comp scenarios with base, variable, and equity' },
      { name: 'salary_bands', description: 'Define and manage salary bands by role and level' },
      { name: 'compare_plans', description: 'Side-by-side comparison of comp plan variants' },
    ],
    workflows: [
      {
        id: 'comp-plan:annual-review',
        name: 'Annual Comp Review',
        schedule: 'Quarterly',
        description: 'Review comp plans against market data and internal equity',
      },
    ],
    consumes: ['utilization', 'delivery'],
    feeds: ['strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-people',
  },

  // ── DEVOPS & ENGINEERING ─────────────────────────────────────
  {
    id: 'backlog',
    name: 'Backlog Manager',
    domain: 'devops',
    tier: 'intelligence',
    status: 'planned',
    replaces: 'Engineering manager (backlog grooming)',
    description:
      'Linear issue management with OKR-aligned prioritization. Scores issues by severity × impact × alignment. Syncs Sentry errors into Linear.',
    reusesFrom: 'a10dit/backlog',
    tools: [
      { name: 'get_linear_issues', description: 'Fetch issues with status filtering' },
      { name: 'create_linear_issue', description: 'Create issues (Sentry sync, action items)' },
      { name: 'get_linear_projects', description: 'Fetch projects with OKR progress' },
      { name: 'prioritize_backlog', description: 'Score issues by severity × impact × OKR' },
    ],
    workflows: [
      {
        id: 'backlog:weekly-health',
        name: 'Weekly Backlog Health',
        schedule: 'Monday 10am',
        description: 'Priority distribution, stale issues, at-risk projects',
      },
      {
        id: 'backlog:sentry-sync',
        name: 'Sentry → Linear Sync',
        schedule: 'Daily 11am',
        description: 'Create Linear issues from new Sentry errors',
      },
    ],
    consumes: ['repowatch'],
    feeds: ['strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-devops',
  },
  {
    id: 'repowatch',
    name: 'Repo Watcher',
    domain: 'devops',
    tier: 'foundation',
    status: 'planned',
    replaces: 'PM (progress tracking)',
    description:
      'Monitors GitHub commits, PRs, and Linear activity across client engagement repos. Produces unified changelogs and progress reports.',
    reusesFrom: 'a10dit/repowatch',
    tools: [
      { name: 'get_recent_commits', description: 'Fetch commits from last N hours' },
      { name: 'get_open_pull_requests', description: 'List open PRs with age and status' },
      { name: 'get_merged_pull_requests', description: 'Recently merged PRs' },
      { name: 'get_repo_activity_summary', description: 'Repo metadata and contributors' },
      { name: 'get_recently_updated_issues', description: 'Linear issues that changed recently' },
      { name: 'get_recently_completed_issues', description: 'Linear issues marked done' },
      { name: 'get_linear_project_progress', description: 'Active project progress %' },
    ],
    workflows: [
      {
        id: 'repowatch:daily-changelog',
        name: 'Daily Changelog',
        schedule: 'Daily 9am',
        description: 'Combined GitHub + Linear activity digest',
      },
    ],
    consumes: [],
    feeds: ['backlog', 'strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-devops',
  },

  // ── STRATEGY & VISIBILITY ────────────────────────────────────
  {
    id: 'content-strategy',
    name: 'Content Strategy Agent',
    domain: 'strategy',
    tier: 'intelligence',
    status: 'building',
    replaces: 'Marketing strategist (content planning)',
    description:
      'Converts OKRs, ICPs, and brand positioning into strategic content themes and editorial calendar blocks. Reads Strategic Alignment and Story Library KBs.',
    apiRoute: '/content',
    tools: [
      { name: 'generate_themes', description: 'Create strategic themes from goals + ICPs' },
      { name: 'audience_matrix', description: 'Map personas to themes' },
      { name: 'calendar_blocks', description: 'Generate themed calendar blocks' },
    ],
    workflows: [
      {
        id: 'content-strategy:monthly-planning',
        name: 'Monthly Content Planning',
        schedule: '1st of month',
        description: 'Generate next month strategic themes and calendar blocks',
      },
    ],
    consumes: ['opps', 'delivery'],
    feeds: ['content-creator', 'strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-content',
    kbAccess: ['system-strategic-alignment', 'system-story-library', 'system-customer-star'],
  },
  {
    id: 'content-creator',
    name: 'Content Creator Agent',
    domain: 'strategy',
    tier: 'intelligence',
    status: 'building',
    replaces: 'Content writer (drafting + editing)',
    description:
      'Generates platform-specific content drafts from briefs. Uses Brand Voice, Story Library, and Platform Playbook KBs for on-brand, story-driven output.',
    apiRoute: '/content',
    tools: [
      { name: 'create_brief', description: 'Create content brief from wizard selections' },
      { name: 'generate_draft', description: 'Generate KB-powered content draft via Bedrock' },
      { name: 'suggest_hashtags', description: 'Platform-appropriate hashtag suggestions' },
      { name: 'suggest_media', description: 'AI-suggested media type, alt text, and stock search terms' },
    ],
    workflows: [
      {
        id: 'content-creator:daily-drafts',
        name: 'Daily Draft Generation',
        schedule: 'Daily 8am',
        description: 'Generate drafts for upcoming calendar slots',
      },
    ],
    consumes: ['content-strategy'],
    feeds: ['content-publisher'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-content',
    kbAccess: [
      'system-brand-voice', 'system-strategic-alignment', 'system-story-library',
      'system-customer-star', 'system-platform-playbook', 'system-community-blocks',
      'system-aws-accreditations', 'system-prior-content', 'system-presentation-structures',
    ],
    kbWrite: ['system-prior-content'],
  },
  {
    id: 'content-publisher',
    name: 'Content Publisher Agent',
    domain: 'strategy',
    tier: 'intelligence',
    status: 'active',
    replaces: 'Content ops (manual CMS entry creation)',
    description:
      'AI-powered Builder.io content transformer. Takes raw input (JDs, customer stories, event details, blog drafts) and auto-detects the best data model, transforms content into the model schema using Bedrock, and publishes/unpublishes entries.',
    apiRoute: '/content-publisher',
    tools: [
      { name: 'detect', description: 'Auto-detect which Builder.io model fits the input content' },
      { name: 'transform', description: 'Transform raw content into model field schema using Bedrock' },
      { name: 'publish', description: 'Write pre-transformed data to Builder.io (draft or live)' },
      { name: 'transform_and_publish', description: 'One-shot: transform + publish in a single call' },
      { name: 'list_models', description: 'List all data models with schemas' },
    ],
    workflows: [
      {
        id: 'content-publisher:jd-to-post',
        name: 'JD to Job Post',
        trigger: 'manual',
        description: 'Transform a prepared JD into the job-post model and publish',
      },
      {
        id: 'content-publisher:story-to-cms',
        name: 'Story to CMS',
        trigger: 'manual',
        description: 'Transform customer/user stories into the matching CMS model',
      },
    ],
    consumes: ['content-creator'],
    feeds: ['strategy'],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-content',
    kbAccess: ['system-platform-playbook', 'system-prior-content'],
    kbWrite: ['system-prior-content'],
  },
  {
    id: 'strategy',
    name: 'Strategy Synthesizer',
    domain: 'strategy',
    tier: 'executive',
    status: 'planned',
    replaces: 'COO / Chief of Staff (executive briefings)',
    description:
      'Reads all domain agent outputs and synthesizes cross-domain insights into executive digests and strategic recommendations.',
    tools: [
      { name: 'get_all_results', description: 'Read workflow results from all agents' },
      { name: 'cross_domain_insights', description: 'Identify patterns across domains' },
      { name: 'generate_recommendations', description: 'Prioritized strategic actions' },
      { name: 'post_executive_digest', description: 'Post digest to Slack' },
    ],
    workflows: [
      {
        id: 'strategy:weekly-review',
        name: 'Weekly Strategic Review',
        schedule: 'Monday 11am',
        description: 'Cross-domain synthesis: revenue + delivery + people + devops',
      },
      {
        id: 'strategy:daily-digest',
        name: 'Daily Executive Digest',
        schedule: 'Daily 12pm',
        description: 'Top insights from all agent runs in last 24h',
      },
    ],
    consumes: ['opps', 'delivery', 'csat', 'utilization', 'backlog', 'repowatch'],
    feeds: [],
    model: 'Claude Sonnet 4',
    slackChannel: '#aerostack-executive',
  },
] as const;

export function getAgentsByDomain(domain: AgentDomain): readonly AerostackAgent[] {
  return Aerostack_AGENT_CATALOG.filter((a) => a.domain === domain);
}

export function getAgentsByStatus(status: AgentStatus): readonly AerostackAgent[] {
  return Aerostack_AGENT_CATALOG.filter((a) => a.status === status);
}

export function getAgentsByTier(tier: AgentTier): readonly AerostackAgent[] {
  return Aerostack_AGENT_CATALOG.filter((a) => a.tier === tier);
}

export function getAgentById(id: string): AerostackAgent | undefined {
  return Aerostack_AGENT_CATALOG.find((a) => a.id === id);
}
