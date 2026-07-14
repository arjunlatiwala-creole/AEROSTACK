/**
 * Shared utilities for Cognito claims-based RBAC.
 *
 * Mirrors the frontend `permission-defaults.ts` logic so the backend can
 * reconstruct effective permissions from (givenRole + delta claims) without
 * a DynamoDB round-trip.
 *
 * Delta format stored in `custom:rbac_deltas` Cognito attribute:
 *   { "allow": ["operations/revops:write", "tools/perspex:read"], "deny": ["system/setup:read"] }
 */

export type RbacMode = "db_only" | "claims_then_db" | "claims_only";

export interface RbacDeltas {
  allow: string[]; // "resourceKey:accessType"
  deny: string[]; // "resourceKey:accessType"
}

/** Priority order for Cognito group → givenRole resolution. */
const GROUP_PRIORITY = ["Super-Admin", "Admin", "Seller", "User"] as const;

export function resolveGivenRoleFromGroups(groups: string[]): string {
  for (const role of GROUP_PRIORITY) {
    if (groups.includes(role)) return role;
  }
  return "User";
}

export function parseDeltaClaims(raw: string | undefined | null): RbacDeltas {
  if (!raw) return { allow: [], deny: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      allow: Array.isArray(parsed.allow) ? parsed.allow : [],
      deny: Array.isArray(parsed.deny) ? parsed.deny : [],
    };
  } catch {
    return { allow: [], deny: [] };
  }
}

/**
 * Flattens a nested permission map to a Set of "resourceKey:accessType" strings.
 * e.g. { operations: { revops: ["read","write"] } } → { "operations/revops:read", "operations/revops:write" }
 */
export function flattenPermissions(roleMap: Record<string, any>): Set<string> {
  const result = new Set<string>();
  for (const [key, value] of Object.entries(roleMap)) {
    if (Array.isArray(value)) {
      for (const accessType of value) {
        result.add(`${key}:${accessType}`);
      }
    } else if (value && typeof value === "object") {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (Array.isArray(subValue)) {
          for (const accessType of subValue) {
            result.add(`${key}/${subKey}:${accessType}`);
          }
        }
      }
    }
  }
  return result;
}

/** Applies delta overrides to a base permission map (deep-cloned before mutation). */
export function applyDeltasToPermissions(
  base: Record<string, any>,
  deltas: RbacDeltas,
): Record<string, any> {
  const result: Record<string, any> = JSON.parse(JSON.stringify(base));

  for (const entry of deltas.allow) {
    const colonIdx = entry.lastIndexOf(":");
    if (colonIdx === -1) continue;
    const key = entry.slice(0, colonIdx);
    const accessType = entry.slice(colonIdx + 1);
    const parts = key.split("/");

    if (parts.length === 1) {
      if (!Array.isArray(result[parts[0]])) result[parts[0]] = [];
      if (!result[parts[0]].includes(accessType))
        result[parts[0]].push(accessType);
    } else {
      const [group, item] = parts;
      if (!result[group] || typeof result[group] !== "object")
        result[group] = {};
      if (!Array.isArray(result[group][item])) result[group][item] = [];
      if (!result[group][item].includes(accessType))
        result[group][item].push(accessType);
    }
  }

  for (const entry of deltas.deny) {
    const colonIdx = entry.lastIndexOf(":");
    if (colonIdx === -1) continue;
    const key = entry.slice(0, colonIdx);
    const accessType = entry.slice(colonIdx + 1);
    const parts = key.split("/");

    if (parts.length === 1) {
      if (Array.isArray(result[parts[0]])) {
        result[parts[0]] = result[parts[0]].filter(
          (a: string) => a !== accessType,
        );
      }
    } else {
      const [group, item] = parts;
      if (Array.isArray(result[group]?.[item])) {
        result[group][item] = result[group][item].filter(
          (a: string) => a !== accessType,
        );
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Role defaults — mirrors pwa-frontend/src/lib/permission-defaults.ts
// ---------------------------------------------------------------------------

const NO_PERMISSIONS: Record<string, any> = {
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

const FULL_ACCESS: Record<string, any> = {
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
    // "content-arch": ["read", "write"],
    calcs: ["read", "write"],
    "opps-tools": ["read", "write"],
    // "sow-tools": ["read", "write"],
    "delivery-tools": ["read", "write"],
    // "csat-tools": ["read", "write"],
    // "data-tools": ["read", "write"],
    // "email-extractor": ["read", "write"],
    knowledge: ["read", "write"],
    // "slack-admin": ["read", "write"],
    "zoom-recordings": ["read", "write"],
    "hiring-tools": ["read", "write"],
  },
  resources: {
    "enterprise-work": ["read", "write"],
    // people: ["read", "write"],
    opportunities: ["read", "write"],
    delivery: ["read", "write"],
    learning: ["read", "write"],
  },
  agents: {
    agents: ["read", "write"],
    // "workflow-ledger": ["read", "write"],
  },
  system: {
    integrations: ["read", "write"],
    // mcp: ["read", "write"],
    roles: ["read", "write"],
    // setup: ["read", "write"],
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

/**
 * Returns the effective permission map for a givenRole + optional deltas.
 */
export function computeEffectivePermissions(
  givenRole: string,
  deltas: RbacDeltas,
): Record<string, any> {
  const base =
    ROLE_DEFAULT_PERMISSIONS[givenRole] ?? ROLE_DEFAULT_PERMISSIONS.User;
  if (deltas.allow.length === 0 && deltas.deny.length === 0) {
    return JSON.parse(JSON.stringify(base));
  }
  return applyDeltasToPermissions(base, deltas);
}

/**
 * Computes compact delta claims from a full permission map relative to the
 * role defaults for the given givenRole.
 *
 * The result, when passed to `applyDeltasToPermissions(defaults, delta)`,
 * reproduces the original fullMap.
 */
export function computeDeltas(
  givenRole: string,
  fullMap: Record<string, any>,
): RbacDeltas {
  const base =
    ROLE_DEFAULT_PERMISSIONS[givenRole] ?? ROLE_DEFAULT_PERMISSIONS.User;
  const baseFlat = flattenPermissions(base);
  const fullFlat = flattenPermissions(fullMap);

  const allow: string[] = [];
  const deny: string[] = [];

  for (const entry of fullFlat) {
    if (!baseFlat.has(entry)) allow.push(entry);
  }
  for (const entry of baseFlat) {
    if (!fullFlat.has(entry)) deny.push(entry);
  }

  return { allow, deny };
}

/**
 * Serializes deltas to a compact JSON string suitable for storage in a
 * Cognito custom attribute (max 2048 chars).
 * Returns an empty string when there are no deltas.
 */
export function serializeDeltas(deltas: RbacDeltas): string {
  if (deltas.allow.length === 0 && deltas.deny.length === 0) return "";
  return JSON.stringify(deltas);
}

/**
 * Checks a single permission from a userRole map.
 * Read is allow-by-default when key is missing; write is deny-by-default.
 */
export function checkPermissionFromMap(
  userRole: Record<string, any>,
  resourceKey: string,
  accessType: "read" | "write",
): boolean {
  const parts = resourceKey.split("/");
  let permissions: string[] | undefined;

  if (parts.length === 1) {
    permissions = userRole[parts[0]];
  } else {
    const [group, item] = parts;
    permissions = userRole[group]?.[item];
  }

  if (!permissions) return accessType === "read";

  if (accessType === "read") {
    return permissions.includes("read") || permissions.includes("write");
  }
  return permissions.includes("write");
}
