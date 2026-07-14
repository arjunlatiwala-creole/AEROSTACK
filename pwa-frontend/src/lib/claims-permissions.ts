/**
 * Resolves user permissions from Cognito JWT token claims.
 *
 * When the Pre-Token Generation Lambda is active, the ID token contains:
 *   - `givenRole`           : normalized role derived from Cognito group (e.g. "Admin")
 *   - `custom:rbac_deltas`  : compact JSON overrides relative to role defaults
 *   - `cognito:groups`      : raw group list (fallback when `givenRole` claim is absent)
 *
 * The function returns `null` when:
 *   - Cognito is not configured (local dev stub)
 *   - The user session is unavailable
 *   - No group signal is present (signals caller to fall back to `/roles/me` API)
 */

import { fetchAuthSession } from "aws-amplify/auth";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permission-defaults";
import type { GivenRole } from "@/api/roles";

export interface ClaimsPermissions {
  givenRole: GivenRole;
  userRole: Record<string, any>;
  /** True when data came from JWT claims (authoritative); false when default-fallback. */
  fromClaims: true;
}

interface RbacDeltas {
  allow: string[];
  deny: string[];
}

function parseDeltaClaims(raw: string | undefined): RbacDeltas {
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

function resolveGivenRoleFromGroups(groups: string[]): GivenRole | null {
  const priority: GivenRole[] = ["Super-Admin", "Admin", "Seller", "User"];
  for (const role of priority) {
    if (groups.includes(role)) return role;
  }
  return null;
}

function applyDeltas(
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
      if (!result[parts[0]].includes(accessType)) result[parts[0]].push(accessType);
    } else {
      const [group, item] = parts;
      if (!result[group] || typeof result[group] !== "object") result[group] = {};
      if (!Array.isArray(result[group][item])) result[group][item] = [];
      if (!result[group][item].includes(accessType)) result[group][item].push(accessType);
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
        result[parts[0]] = result[parts[0]].filter((a: string) => a !== accessType);
      }
    } else {
      const [group, item] = parts;
      if (Array.isArray(result[group]?.[item])) {
        result[group][item] = result[group][item].filter((a: string) => a !== accessType);
      }
    }
  }

  return result;
}

/**
 * Fetches the current Amplify auth session and extracts RBAC data from the
 * ID token claims.
 *
 * Returns `null` when:
 *   - VITE_RBAC_MODE is "db_only" (default / Phase 1) — always use /roles/me
 *   - Running in local dev mode (VITE_AWS_USER_POOL_ID stub)
 *   - The session is unavailable or the token has no group signal
 *
 * A `null` result tells the caller to fall back to the `/roles/me` API.
 *
 * Set VITE_RBAC_MODE=claims_then_db to activate Phase 2 (claims first,
 * API fallback for unmigrated users). Set to claims_only for full cutover.
 */
export async function getPermissionsFromClaims(): Promise<ClaimsPermissions | null> {
  // Respect the frontend RBAC mode — default is db_only (Phase 1).
  const rbacMode = import.meta.env.VITE_RBAC_MODE || "db_only";
  if (rbacMode === "db_only") return null;

  // Skip when Cognito is not configured (local dev).
  if (
    import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX" ||
    !import.meta.env.VITE_AWS_USER_POOL_ID
  ) {
    return null;
  }

  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload;
    if (!payload) return null;

    // `givenRole` is added by the Pre-Token Generation trigger.
    let givenRole = payload["givenRole"] as GivenRole | undefined;

    if (!givenRole) {
      // Fallback: derive from cognito:groups when pre-token trigger hasn't run.
      const groupsRaw = payload["cognito:groups"];
      const groupList: string[] = Array.isArray(groupsRaw)
        ? (groupsRaw as string[])
        : typeof groupsRaw === "string"
          ? groupsRaw.split(",")
          : [];

      const derived = resolveGivenRoleFromGroups(groupList);
      if (!derived) {
        // No group signal at all → signal fallback to API.
        return null;
      }
      givenRole = derived;
    }

    const base =
      ROLE_DEFAULT_PERMISSIONS[givenRole] ?? ROLE_DEFAULT_PERMISSIONS.User;

    const deltasRaw = payload["custom:rbac_deltas"] as string | undefined;
    const deltas = parseDeltaClaims(deltasRaw);
    const userRole =
      deltas.allow.length > 0 || deltas.deny.length > 0
        ? applyDeltas(base, deltas)
        : JSON.parse(JSON.stringify(base));

    return { givenRole, userRole, fromClaims: true };
  } catch {
    return null;
  }
}
