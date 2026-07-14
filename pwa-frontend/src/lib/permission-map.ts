/**
 * Maps route paths (from window.location.pathname) to permission keys.
 * Format: "group/item" for grouped permissions, or "top-level-key" for top-level.
 * The backend middleware and the sidebar filter both consume this mapping.
 */

export const PATH_TO_PERMISSION: Record<string, string> = {
  "/enterprise-aerostack": "enterprise-aerostack",
  "/person": "my-aerostack",
  "/myaerostack": "my-aerostack",

  "/revops": "operations/revops",
  "/financials": "operations/financials",
  "/engineering": "operations/engineering",
  "/peopleops": "operations/people-ops",

  "/bfpm": "tools/perspex",
  "/engagement": "tools/engagement",
  "/content-architecture": "tools/content-arch",
  "/calcs": "tools/calcs",
  "/opps-tools": "tools/opps-tools",
  "/sow": "tools/sow-tools",
  "/delivery-tools": "tools/delivery-tools",
  "/csat": "tools/csat-tools",
  "/data-tools": "tools/data-tools",
  "/email-extractor": "tools/email-extractor",
  "/knowledge": "tools/knowledge",
  "/slack-admin": "tools/slack-admin",
  "/zoom-recordings": "tools/zoom-recordings",
  "/hiring-tools": "tools/hiring-tools",

  "/org": "resources/enterprise-work",
  "/people": "resources/people",
  "/opportunities": "resources/opportunities",
  "/delivery": "resources/delivery",
  "/organization-learning": "resources/learning",
  "/organization-learning/ops": "resources/learning",

  "/agents": "agents/agents",
  "/workflow_ledger": "agents/workflow-ledger",

  "/integrations": "system/integrations",
  "/mcp": "system/mcp",
  "/roles": "system/roles",
  "/setup": "system/setup",
};

/**
 * Maps nav-item route IDs to permission keys.
 * Used by the sidebar to decide which items to show.
 */
export const NAV_ID_TO_PERMISSION: Record<string, string> = {
  enterprise_aerostack: "enterprise-aerostack",
  person: "my-aerostack",

  revops: "operations/revops",
  financials: "operations/financials",
  engineering: "operations/engineering",
  people_ops: "operations/people-ops",

  bfpm: "tools/perspex",
  engagement: "tools/engagement",
  "content-architecture": "tools/content-arch",
  calcs: "tools/calcs",
  "opps-tools": "tools/opps-tools",
  sow: "tools/sow-tools",
  "delivery-tools": "tools/delivery-tools",
  csat: "tools/csat-tools",
  "data-tools": "tools/data-tools",
  email_extractor: "tools/email-extractor",
  knowledge: "tools/knowledge",
  "slack-admin": "tools/slack-admin",
  "zoom-recordings": "tools/zoom-recordings",
  "hiring-tools": "tools/hiring-tools",

  org: "resources/enterprise-work",
  people: "resources/people",
  opportunities: "resources/opportunities",
  delivery: "resources/delivery",
  learning: "resources/learning",
  "learning-completion": "resources/learning",
  learning_ops: "resources/learning",

  agents: "agents/agents",
  workflow_ledger: "agents/workflow-ledger",

  integrations: "system/integrations",
  mcp: "system/mcp",
  roles: "system/roles",
  setup: "system/setup",
};

/**
 * Resolves the current browser path to a permission key.
 * Uses prefix matching for child routes (e.g. /revops/dealdetail/123 → operations/revops).
 */
export function resolvePermissionKey(pathOrId: string): string | null {
  // Check if it's a Nav ID first (from location.state.from passed as ID)
  if (NAV_ID_TO_PERMISSION[pathOrId]) {
    return NAV_ID_TO_PERMISSION[pathOrId];
  }

  const exact = PATH_TO_PERMISSION[pathOrId];
  if (exact) return exact;

  for (const [prefix, key] of Object.entries(PATH_TO_PERMISSION)) {
    if (pathOrId.startsWith(prefix + "/")) return key;
  }

  return null;
}

/**
 * Resolves the permissions array for a given key from the userRole object.
 */
function resolvePermissions(
  userRole: Record<string, any>,
  permissionKey: string,
): string[] | undefined {
  const parts = permissionKey.split("/");
  if (parts.length === 1) return userRole[parts[0]];
  const [group, item] = parts;
  return userRole[group]?.[item];
}

/**
 * Checks if a permission key has the given access type within a userRole object.
 * Returns true if no userRole is set (unrestricted).
 * For write access specifically, returns false if permissionKey is provided but missing in role.
 */
export function checkPermission(
  userRole: Record<string, any> | null | undefined,
  permissionKey: string,
  accessType: "read" | "write",
): boolean {
  if (!userRole) return true;

  const permissions = resolvePermissions(userRole, permissionKey);
  if (!permissions) {
    // Deny-by-default keys: deny all access if missing from stored role
    if (DENY_BY_DEFAULT_KEYS.has(permissionKey)) return false;
    // For write access specifically, deny by default when key is missing
    return accessType === "read";
  }

  return Array.isArray(permissions) && permissions.includes(accessType);
}

/**
 * Specifically checks for write access with a strict deny-by-default for missing keys.
 * Returns false if permissionKey is not found or userRole is missing.
 */
export function checkWritePermission(
  userRole: Record<string, any> | null | undefined,
  permissionKey: string,
): boolean {
  if (!userRole) return false;
  const permissions = resolvePermissions(userRole, permissionKey);
  if (!permissions) return false;
  return Array.isArray(permissions) && permissions.includes("write");
}

/**
 * Permission keys that are deny-by-default when missing from a stored role.
 * These are restricted resources that must be explicitly granted.
 */
const DENY_BY_DEFAULT_KEYS = new Set([
  "tools/hiring-tools",
  "tools/zoom-recordings",
]);

/**
 * Checks if a permission key has ANY access (read or write).
 * Used by the sidebar to decide item visibility.
 *
 * Most keys are allow-by-default when missing (backward compat for old stored roles).
 * Keys in DENY_BY_DEFAULT_KEYS are deny-by-default — must be explicitly granted.
 */
export function hasAnyAccess(
  userRole: Record<string, any> | null | undefined,
  permissionKey: string,
): boolean {
  if (!userRole) return true;

  const permissions = resolvePermissions(userRole, permissionKey);
  if (!permissions) {
    // Deny-by-default keys: if missing from stored role, deny access
    if (DENY_BY_DEFAULT_KEYS.has(permissionKey)) return false;
    return true;
  }

  return Array.isArray(permissions) && permissions.length > 0;
}
