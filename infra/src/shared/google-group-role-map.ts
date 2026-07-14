/**
 * Maps Google Workspace group emails to platform roles.
 *
 * Priority order: Admin (P2) > Seller (P3) > User (P4).
 * Super-Admin (P1) is NEVER auto-assigned — Cognito console only.
 *
 * Unmapped groups (e.g. classroom_teachers@, subcontractors@) default to User.
 */

export const ROLE_PRIORITY: Record<string, number> = {
  "Super-Admin": 1,
  Admin: 2,
  Seller: 3,
  User: 4,
};

export const GOOGLE_GROUP_TO_ROLE: Record<string, string> = {
  // P2 — Admin
  "aws-apn-mgmt@enterprise.io": "Admin",
  "finops@enterprise.io": "Admin",
  "gdac@enterprise.io": "Admin",

  // P3 — Seller
  "salesteam@enterprise.io": "Seller",
  "gtm@enterprise.io": "Seller",

  // P4 — User (explicit)
  "allusers@enterprise.io": "User",
  "everyone@enterprise.io": "User",
};

/**
 * Given a list of Google Group emails, returns the highest-priority
 * platform role. Returns "User" if no groups match or list is empty.
 * Never returns "Super-Admin" (manual-only).
 */
export function resolveRoleFromGoogleGroups(groupEmails: string[]): string {
  let bestRole = "User";
  let bestPriority = ROLE_PRIORITY["User"]!; // 4

  for (const email of groupEmails) {
    const role = GOOGLE_GROUP_TO_ROLE[email.toLowerCase()];
    if (role !== undefined) {
      const priority = ROLE_PRIORITY[role];
      if (priority !== undefined && priority < bestPriority) {
        bestRole = role;
        bestPriority = priority;
      }
    }
  }

  return bestRole;
}
