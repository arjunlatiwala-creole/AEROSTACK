/**
 * Cognito Pre-Token Generation trigger (v2 — Google Directory integration).
 *
 * 1. If the user already has a platform Cognito group → use it (manual
 *    override wins). This protects Super-Admin and any manual assignments.
 *
 * 2. If no platform group exists AND GOOGLE_SA_SECRET_NAME is configured →
 *    call Google Directory API to list the user's Google Workspace groups,
 *    map them to a platform role (highest priority wins), and assign the
 *    user to that Cognito group via AdminAddUserToGroup.
 *
 * 3. If the Google API call fails or is not configured → default to "User".
 *
 * 4. Emit a `givenRole` claim in the JWT so backend/frontend can read the
 *    role directly from claims.
 *
 * Priority: Super-Admin > Admin > Seller > User
 *
 * Runs on token issuance, when the user record already exists in the pool —
 * so AdminAddUserToGroup resolves the user correctly. Uses event.userPoolId
 * (present in all Cognito trigger events) — no env var needed for the pool
 * ID, which avoids a circular CloudFormation dependency.
 */

import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { listUserGoogleGroups } from "../../shared/google-directory-client";
import { resolveRoleFromGoogleGroups } from "../../shared/google-group-role-map";

const cognitoClient = new CognitoIdentityProviderClient({});

const PLATFORM_GROUPS = ["Super-Admin", "Admin", "Seller", "User"];

export const handler = async (event: any): Promise<any> => {
  const groups: string[] =
    event.request?.groupConfiguration?.groupsToOverride ?? [];

  const hasPlatformGroup = groups.some((g) => PLATFORM_GROUPS.includes(g));

  // ── No platform group yet → resolve from Google Directory API ──
  if (!hasPlatformGroup) {
    let resolvedRole = "User";

    // Only attempt Google lookup when the secret name is configured.
    // When unset, behaves identically to the old trigger (defaults to User).
    if (process.env.GOOGLE_SA_SECRET_NAME) {
      try {
        const email: string | undefined = event.request?.userAttributes?.email;
        if (email) {
          const googleGroups = await listUserGoogleGroups(email);
          const groupEmails = googleGroups.map((g) => g.email);
          resolvedRole = resolveRoleFromGoogleGroups(groupEmails);
          console.log(
            `[pre-token] Google groups for ${email}:`,
            groupEmails,
            `→ resolved role: ${resolvedRole}`,
          );
        }
      } catch (err) {
        // Graceful degradation: default to "User" if API fails.
        console.warn("[pre-token] Google Directory API lookup failed:", err);
        resolvedRole = "User";
      }
    }

    // Persist the resolved role as a Cognito group.
    try {
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
          GroupName: resolvedRole,
        }),
      );
    } catch (err) {
      console.warn("[pre-token] Failed to auto-assign group:", err);
    }

    // Add to the local groups array so givenRole resolves correctly below.
    groups.push(resolvedRole);
  }

  // ── Resolve givenRole from platform group membership ──
  let givenRole = "User";
  if (groups.includes("Super-Admin")) givenRole = "Super-Admin";
  else if (groups.includes("Admin")) givenRole = "Admin";
  else if (groups.includes("Seller")) givenRole = "Seller";

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        givenRole,
      },
    },
  };

  return event;
};
