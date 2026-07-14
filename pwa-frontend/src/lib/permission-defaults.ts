export const NO_PERMISSIONS = {
  "enterprise-aerostack": [],
  "my-aerostack": [],
  operations: {
    revops: [],
    financials: [],
    engineering: [],
    "people-ops": [],
  },
  tools: {
    perspex: [],
    engagement: [],
    // "content-arch": [],
    calcs: [],
    "opps-tools": [],
    // "sow-tools": [],
    "delivery-tools": [],
    // "csat-tools": [],
    // "data-tools": [],
    // "email-extractor": [],
    knowledge: [],
    // "slack-admin": [],
    "zoom-recordings": [],
    "hiring-tools": [],
  },
  resources: {
    "enterprise-work": [],
    // people: [],
    opportunities: [],
    delivery: [],
    learning: [],
  },
  agents: {
    agents: [],
    // "workflow-ledger": []
  },
  system: {
    integrations: [],
    // mcp: [],
    roles: [],
    // setup: []
  },
};

export const FULL_ACCESS = {
  "enterprise-aerostack": ["read", "write"],
  "my-aerostack": ["read", "write"],
  operations: {
    revops: ["read", "write"],
    financials: ["read", "write"],
    engineering: ["read", "write"],
    "people-ops": ["read", "write"],
  },
  tools: {
    perspex: ["read", "write"],
    engagement: ["read", "write"],
    "content-arch": ["read", "write"],
    calcs: ["read", "write"],
    "opps-tools": ["read", "write"],
    "sow-tools": ["read", "write"],
    "delivery-tools": ["read", "write"],
    "csat-tools": ["read", "write"],
    "data-tools": ["read", "write"],
    "email-extractor": ["read", "write"],
    knowledge: ["read", "write"],
    "slack-admin": ["read", "write"],
    "zoom-recordings": ["read", "write"],
    "workspace-admin": ["read", "write"],
    "comp-plan": ["read", "write"],
    "builder-tools": ["read", "write"],
    "project-handoff": ["read", "write"],
    "hiring-tools": ["read", "write"],
  },
  resources: {
    "enterprise-work": ["read", "write"],
    people: ["read", "write"],
    opportunities: ["read", "write"],
    delivery: ["read", "write"],
    learning: ["read", "write"],
  },
  agents: {
    agents: ["read", "write"],
    "workflow-ledger": ["read", "write"],
  },
  system: {
    integrations: ["read", "write"],
    mcp: ["read", "write"],
    roles: ["read", "write"],
    setup: ["read", "write"],
  },
};

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Record<string, any>> = {
  User: {
    ...NO_PERMISSIONS,
    "enterprise-aerostack": ["read", "write"],
    "my-aerostack": ["read", "write"],
    operations: {
      ...NO_PERMISSIONS.operations,
      engineering: ["read", "write"],
    },
    tools: {
      ...NO_PERMISSIONS.tools,
      perspex: ["read", "write"],
      engagement: ["read", "write"],
      calcs: ["read", "write"],
      // "sow-tools": ["read", "write"],
      "delivery-tools": ["read", "write"],
    },
    resources: {
      ...NO_PERMISSIONS.resources,
      "enterprise-work": ["read", "write"],
      // opportunities: ["read", "write"],
      delivery: ["read", "write"],
      learning: ["read", "write"],
    },
  },
  Seller: {
    ...NO_PERMISSIONS,
    "enterprise-aerostack": ["read", "write"],
    "my-aerostack": ["read", "write"],
    operations: {
      ...NO_PERMISSIONS.operations,
      revops: ["read", "write"],
    },
    tools: {
      ...NO_PERMISSIONS.tools,
      perspex: ["read", "write"],
      engagement: ["read", "write"],
      "opps-tools": ["read", "write"],
      // "sow-tools": ["read", "write"],
      // "csat-tools": ["read", "write"],
      // "email-extractor": ["read", "write"],
    },
    resources: {
      ...NO_PERMISSIONS.resources,
      "enterprise-work": ["read", "write"],
      opportunities: ["read", "write"],
      // delivery: ["read", "write"],
      learning: ["read", "write"],
    },
  },
  Admin: {
    ...FULL_ACCESS,
    tools: {
      ...FULL_ACCESS.tools,
      "hiring-tools": [],
    },
  },
  "Super-Admin": FULL_ACCESS,
};
