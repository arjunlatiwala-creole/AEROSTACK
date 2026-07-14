import path from "path";

export interface RouteItem {
  id: Lowercase<string>;
  path: Lowercase<string>;
  title: string;
  description?: string;
}

export const ROUTES = {
  AUTH: {
    LOGIN: {
      id: "login",
      path: "/login",
      title: "Login",
      description: "Sign in to access your Aerostack account.",
    },
  },
  APP: {
    HOME: {
      id: "home",
      path: "/",
      title: "Home",
      description: "Welcome to your Aerostack dashboard — your central hub.",
    },
    TEST: {
      id: "test",
      path: "/test",
      title: "Test",
      description: "Access the testing environment for experimental features.",
    },
    MY_Aerostack: {
      id: "my_aerostack",
      path: "/myaerostack",
      title: "Myaerostack",
      description: "Manage your personal Aerostack ecosystem account.",
    },
    SETUP: {
      id: "setup",
      path: "/setup",
      title: "Setup",
      description: "Configure your RevOps settings with expert precision.",
    },
    REVOPS: {
      id: "revops",
      path: "/revops",
      title: "Revops",
      description: "Oversee your revenue operations with comprehensive tools.",
    },
    REVOPS_PRODUCTIVITY: {
      id: "revops_productivity",
      path: "/revops-productivity",
      title: "RevOps Productivity",
      description: "Rep productivity, forecast, and pipeline-health intelligence (Cloudscape).",
    },
    CUSTOMER_SUCCESS: {
      id: "customer_success",
      path: "/customer-success",
      title: "Customer Success",
      description: "Support ticketing, account health, and renewals (Cloudscape).",
    },
    DEAL_DETAIL: {
      id: "deal_detail",
      path: "/revops/dealdetail/:dealId",
      title: "Deal Detail",
      description: "View detailed information about a specific deal.",
    },
    FINANCIALS: {
      id: "financials",
      path: "/financials",
      title: "Financials",
      description: "Monitor your organization’s financial performance.",
    },
    ENGINEERING: {
      id: "engineering",
      path: "/engineering",
      title: "Engineering",
      description: "Access development resources and engineering tools.",
    },
    PEOPLE_OPS: {
      id: "people_ops",
      path: "/peopleops",
      title: "Peopleops",
      description: "Manage human resources and team operations efficiently.",
    },
    INTEGRATIONS: {
      id: "integrations",
      path: "/integrations",
      title: "Integrations",
      description: "Connect and manage your third-party tools and services.",
    },
    ORG: {
      id: "org",
      path: "/org",
      title: "Org",
      description: "View and manage your company’s organizational structure.",
    },
    OPPORTUNITIES: {
      id: "opportunities",
      path: "/opportunities",
      title: "Opportunities",
      description: "Track and develop new business opportunities.",
    },
    DELIVERY: {
      id: "delivery",
      path: "/delivery",
      title: "Delivery",
      description: "Coordinate and oversee delivery and logistics processes.",
    },
    PROJECT_DETAILS: {
      id: "project_details",
      path: "/delivery/projectdetails/:projectId",
      title: "Project Details",
      description: "View detailed information about a specific project.",
    },
    PROJECT_UPDATES: {
      id: "project_updates",
      path: "/delivery/projectdetails/:projectId/updates",
      title: "Project Updates",
      description: "Track updates and progress for a specific project.",
    },
    LEARNING: {
      id: "learning",
      path: "/organization-learning",
      title: "Organization Learning",
      description: "Access educational resources to enhance your knowledge.",
    },
    LEARNING_OPS: {
      id: "learning_ops",
      path: "/organization-learning/ops",
      title: "Learning Ops",
      description: "View current status of all active learning assignments across the organization.",
    },
    LEARNING_COMPLETION: {
      id: "learning_completion",
      path: "/organization-learning/completion",
      title: "Completion Tracking",
      description: "Track who has and hasn't completed learning requirements.",
    },
    MOODLE_CATALOG: {
      id: "moodle_catalog",
      path: "/organization-learning/moodle-catalog",
      title: "Moodle Catalog",
      description: "Browse and bulk-assign Moodle LMS courses to team members.",
    },
    PERSON: {
      id: "person",
      path: "/person",
      title: "Person",
      description: "Focus on individual team member profiles and details.",
    },
    BFPM: {
      id: "bfpm",
      path: "/bfpm",
      title: "Perspex",
      description: "Cooperation acceleration engine — align perspectives and generate action plans.",
    },
    MCP: {
      id: "mcp",
      path: "/mcp",
      title: "Mcp",
      description: "Explore the Model Context Protocol for AI integrations.",
    },
    LOOP: {
      id: "loop",
      path: "/loop/:loopId",
      title: "Loop",
      description: "Manage and track your business loop.",
    },
    ENGAGEMENT: {
      id: "engagement",
      path: "/engagement",
      title: "Engagement",
      description:
        "Create visibility posts and communications from Aerostack loops.",
    },
    CALCS: {
      id: "calcs",
      path: "/calcs",
      title: "Calcs",
      description: "Financial calculators and data analysis tools.",
    },
    OPPS_TOOLS: {
      id: "opps-tools",
      path: "/opps-tools",
      title: "Opps Tools",
      description:
        "Analyze deal performance with scoring models, win rate tracking, and pipeline coverage insights.",
    },

    SOW_TOOLS: {
      id: "sow",
      path: "/sow",
      title: "SOW Tools",
      description:
        "Build and manage Statements of Work using templates, dynamic pricing, and markdown export.",
    },

    DELIVERY_TOOLS: {
      id: "delivery-tools",
      path: "/delivery-tools",
      title: "Delivery Tools",
      description:
        "Monitor project health, track resource burn, and measure team velocity in real time.",
    },

    CSAT_TOOLS: {
      id: "csat",
      path: "/csat",
      title: "CSAT Tools",
      description:
        "Create surveys, calculate CSAT scores, and measure NPS to track customer satisfaction.",
    },

    DATA_TOOLS: {
      id: "data-tools",
      path: "/data-tools",
      title: "Data Tools",
      description:
        "Explore and analyze Aerostack data lake for insights, reporting, and advanced analytics.",
    },


    Enterprise_Aerostack: {
      id: "enterprise_aerostack",
      path: "/enterprise-aerostack",
      title: "Enterprise Aerostack",
      description: "Enterprise Aerostack overview and platform summary.",
    },
    EDIT_INTEGRATION: {
      id: "edit_integration",
      path: "/integrations/edit",
      title: "Edit Integration",
      description: "Edit integration details.",
    },
    INTEGRATIONS_SYNC_HISTORY: {
      id: "integrations_sync_history",
      path: "/integrations-sync-history",
      title: "Integration Sync History",
      description: "View sync history for integrations.",
    },
    INTEGRATIONS_SYNC_DETAILS: {
      id: "integrations_sync_details",
      path: "/integrations-sync-details",
      title: "Sync Details",
      description: "View detailed sync records.",
    },
    API_DOCS: {
      id: "api_docs",
      path: "/api-docs",
      title: "API Docs",
      description: "Explore our API documentation.",
    },
    APN: {
      id: "apn",
      path: "/apn",
      title: "APN",
      description: "AWS Partner Network opportunities and engagements.",
    },
    AGENTS: {
      id: "agents",
      path: "/agents",
      title: "Agents",
      description:
        "Manage, monitor, and configure AI agents for automated tasks and workflow execution.",
    },
    WORKFLOW_LEDGER: {
      id: "workflow_ledger",
      path: "/workflow_ledger",
      title: "Workflow Ledger",
      description:
        "Track, audit, and monitor workflow activities with a complete execution history.",
    },
    PEOPLE: {
      id: "people",
      path: "/people",
      title: "People",
      description: "Focus on deel sourcecd people.",
    },
    EMAIL_EXTRACTOR: {
      id: "email_extractor",
      path: "/email-extractor",
      title: "Email Extractor",
      description: "Extract Opp Control and AWS Channel Control rows from email threads.",
    },
    KNOWLEDGE: {
      id: "knowledge",
      path: "/knowledge",
      title: "Knowledge",
      description: "Manage organizational and personal knowledge bases — searchable by AI agents.",
    },
    CONTENT_ARCHITECTURE: {
      id: "content-architecture",
      path: "/content-architecture",
      title: "Content Architecture",
      description: "Strategic Content Agent System — architecture, agents, knowledge bases, pipeline phases, and AIDLC tagging.",
    },
    SLACK_ADMIN: {
      id: "slack-admin",
      path: "/slack-admin",
      title: "Slack Admin",
      description: "Slack workspace administration — channels, invites, guests, Slack Connect, and user management.",
    },
    COMP_PLAN: {
      id: "comp-plan",
      path: "/comp-plan",
      title: "Comp Plan",
      description: "Design, model, and manage compensation plan structures — base, variable, equity, and total rewards.",
    },
    PROJECT_HANDOFF: {
      id: "project-handoff",
      path: "/project-handoff",
      title: "Project Handoff",
      description: "Pre-sales to delivery handoff — deal commitment, resourcing, OKRs, and kickoff scheduling.",
    },
    ROLES: {
      id: "roles",
      path: "/roles",
      title: "Roles",
      description: "Manage user roles, permissions, and access control across the platform.",
    },
    ROLE_DETAIL: {
      id: "role_detail",
      path: "/roles/:personId",
      title: "Role Detail",
      description: "View and edit permissions for a specific user.",
    },
    ZOOM_RECORDINGS: {
      id: "zoom-recordings",
      path: "/zoom-recordings",
      title: "Zoom Recordings",
      description: "Browse and access Zoom meeting recordings stored in S3 and Google Drive.",
    },
    WORKSPACE_ADMIN: {
      id: "workspace-admin",
      path: "/workspace-admin",
      title: "Workspace Admin",
      description: "Google Workspace alias audit, OU management, and group administration.",
    },
    HIRING_TOOLS: {
      id: "hiring-tools",
      path: "/hiring-tools",
      title: "Hiring",
      description: "Candidate pipeline management — track referrals, qualifications, and hiring stages.",
    },
    ACCREDITATIONS: {
      id: "accreditations",
      path: "/accreditations",
      title: "Accreditations",
      description: "Track certifications, mandatory training, and learning compliance across the organization.",
    },
    DOCUMENTS: {
      id: "documents",
      path: "/documents",
      title: "Documents",
      description: "Manage hosted documents — upload, version, auto-sync from Canva/Drive, and share via friendly URLs.",
    },
  },
} as const;
