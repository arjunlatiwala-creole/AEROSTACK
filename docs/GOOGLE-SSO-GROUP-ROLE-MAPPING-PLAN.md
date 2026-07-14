# Google SSO → Organization Group → Platform Role Mapping

## Implementation Plan

> **Scope:** `infra/` and `pwa-frontend/` only
> **Goal:** Auto-assign platform roles (Super-Admin, Admin, Seller, User) based on Google Workspace group membership during Cognito sign-in via Google SSO.

---

## Current State (What Already Exists)

| Component | Status | Location |
|-----------|--------|----------|
| Pre-Signup trigger (account linking) | ✅ Done | `infra/src/functions/pre-signup/index.ts` |
| Pre-Token-Generation trigger (givenRole claim) | ✅ Partial | `infra/src/functions/pre-token-generation/index.ts` |
| Cognito User Pool + Google IdP + Hosted UI | ✅ Done | `infra/src/lib/constructs/auth/cognito-auth.ts` |
| Platform groups (User, Seller, Admin, Super-Admin) | ✅ Done | Created in Cognito construct |
| Frontend claims-based permissions | ✅ Done | `pwa-frontend/src/lib/claims-permissions.ts` |
| PermissionsContext (claims path + DDB fallback) | ✅ Done | `pwa-frontend/src/context/PermissionsContext.tsx` |
| Role defaults per givenRole | ✅ Done | `pwa-frontend/src/lib/permission-defaults.ts` |
| Google Directory API integration | ❌ Missing | Needs to be added to pre-token trigger |
| Google Group → Platform Role mapping config | ❌ Missing | Needs new config |
| Service account credentials in Secrets Manager | ❌ Missing | Needs AWS setup + CDK |

---

## Architecture Flow (From PDF)

```
Google Workspace (enterprise.io)
  └─ User logs in via Google SSO
       │
       ▼
AWS Cognito
  ├─ pre-signup trigger
  │    └─ Links Google identity to existing account if exists
  │
  └─ pre-token-generation trigger
       │
       ├─ 1. Does user have a Cognito group?
       │      YES → use it (manual override wins)
       │      NO  → call Google Directory API
       │
       ├─ 2. Map Google Group → Platform Role
       │      (highest priority wins)
       │
       ├─ 3. AdminAddUserToGroup(mappedRole)
       │
       └─ 4. Emit givenRole claim in JWT
              │
              ▼
PWA Frontend (claims_only mode)
  └─ PermissionsContext reads givenRole
       └─ loads ROLE_DEFAULT_PERMISSIONS[givenRole]
            └─ User sees correct UI based on role
```

---

## Google Group → Platform Role Mapping Table

| Priority | Platform Role | Google Groups | Members |
|----------|--------------|---------------|---------|
| P1 | Super-Admin | *(none — Cognito console only, never via SSO)* | Manual assign only |
| P2 | Admin | `aws-apn-mgmt@enterprise.io`, `finops@enterprise.io`, `gdac@enterprise.io` | ~14 members |
| P3 | Seller | `salesteam@enterprise.io`, `gtm@enterprise.io` | ~10 members |
| P4 | User (default) | `allusers@enterprise.io`, `everyone@enterprise.io` | ~22 members |
| — | Unmapped → User | `classroom_teachers@enterprise.io`, `oldcatch-all@enterprise.io`, `subcontractors@enterprise.io`, `techshiftusers@enterprise.io` | Defaults to User |

**Rule:** When a user belongs to multiple mapped groups, the highest priority role wins (Admin > Seller > User). Super-Admin is never auto-assigned.

---

## Step-by-Step Implementation

### Step 1: Create Google Workspace Service Account

**What:** Create a Google Cloud service account with domain-wide delegation to read group memberships.

**Actions:**
1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Create a service account (e.g., `cognito-group-reader@enterprise-workspace.iam.gserviceaccount.com`)
3. Enable domain-wide delegation on the service account
4. In Google Admin Console → Security → API Controls → Domain-wide Delegation:
   - Add the service account client ID
   - Grant scope: `https://www.googleapis.com/auth/admin.directory.group.readonly`
5. Set the impersonation subject to a Workspace admin email (e.g., `admin@enterprise.io`)
6. Download the JSON key file

**Output:** Service account JSON key file ready for Secrets Manager.

---

### Step 2: Store Service Account Credentials in AWS Secrets Manager

**What:** Store the Google service account JSON key securely in Secrets Manager so the Lambda can access it at runtime.

**Actions:**
1. Create a secret in AWS Secrets Manager:
   - Name: `google-directory-service-account`
   - Value: The full JSON key file content
2. You only need to remember the **secret name** — CDK resolves the ARN internally via `fromSecretNameV2`. No ARN is ever hardcoded in source or config.

**File changes:** None (AWS Console / CLI operation)

**CLI example:**
```bash
aws secretsmanager create-secret \
  --name "google-directory-service-account" \
  --secret-string file://service-account-key.json \
  --region us-east-1
```

> **Security note:** The Lambda receives only the secret **name** as an env var (e.g. `enterprise/google-directory-service-account`). The Secrets Manager SDK resolves it to the correct resource internally. The full ARN never appears in code, config files, or environment variables. CDK's `grantRead()` handles IAM scoping automatically at deploy time.

---

### Step 3: Add Google Group → Role Mapping Configuration

**What:** Create a shared configuration file that maps Google Group email addresses to platform roles. Used by the pre-token-generation Lambda.

**File:** `infra/src/shared/google-group-role-map.ts`

```typescript
/**
 * Maps Google Workspace group emails to platform roles.
 * Priority order: Admin (P2) > Seller (P3) > User (P4).
 * Super-Admin is NEVER auto-assigned — Cognito console only.
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
  let bestPriority = ROLE_PRIORITY["User"]; // 4

  for (const email of groupEmails) {
    const role = GOOGLE_GROUP_TO_ROLE[email.toLowerCase()];
    if (role && ROLE_PRIORITY[role] < bestPriority) {
      bestRole = role;
      bestPriority = ROLE_PRIORITY[role];
    }
  }

  return bestRole;
}
```

---

### Step 4: Create Google Directory API Client Utility

**What:** A lightweight utility that calls the Google Directory API to list a user's group memberships. Uses a service account with domain-wide delegation (no OAuth consent needed).

**File:** `infra/src/shared/google-directory-client.ts`

```typescript
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SignJWT, importPKCS8 } from "jose";

const secretsClient = new SecretsManagerClient({});

// Cache the service account credentials across warm Lambda invocations.
let cachedCredentials: { clientEmail: string; privateKey: string } | null = null;

interface GoogleGroupInfo {
  email: string;
  name: string;
}

/**
 * Loads Google service account credentials from Secrets Manager.
 * Uses the secret **name** (not ARN) — the SDK resolves it internally.
 * Cached after first call for Lambda warm-start performance.
 */
async function getServiceAccountCredentials(): Promise<{
  clientEmail: string;
  privateKey: string;
}> {
  if (cachedCredentials) return cachedCredentials;

  const secretName = process.env.GOOGLE_SA_SECRET_NAME;
  if (!secretName) throw new Error("GOOGLE_SA_SECRET_NAME env var not set");

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );

  const parsed = JSON.parse(result.SecretString || "{}");
  cachedCredentials = {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
  return cachedCredentials;
}

/**
 * Creates a short-lived Google OAuth2 access token using the service
 * account's private key (JWT bearer assertion flow).
 */
async function getGoogleAccessToken(
  impersonateEmail: string,
): Promise<string> {
  const { clientEmail, privateKey } = await getServiceAccountCredentials();
  const key = await importPKCS8(privateKey, "RS256");

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: clientEmail,
    sub: impersonateEmail,
    scope:
      "https://www.googleapis.com/auth/admin.directory.group.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(key);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token exchange failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.access_token;
}

/**
 * Lists all Google Workspace groups for a given user email.
 * Returns an array of group objects with email and name.
 */
export async function listUserGoogleGroups(
  userEmail: string,
): Promise<GoogleGroupInfo[]> {
  const impersonateEmail =
    process.env.GOOGLE_ADMIN_EMAIL || "admin@enterprise.io";
  const accessToken = await getGoogleAccessToken(impersonateEmail);

  const url = new URL(
    "https://admin.googleapis.com/admin/directory/v1/groups",
  );
  url.searchParams.set("userKey", userEmail);
  url.searchParams.set("fields", "groups(email,name)");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Google Directory API failed: ${resp.status} ${text}`,
    );
  }

  const data = await resp.json();
  return (data.groups || []).map((g: any) => ({
    email: g.email,
    name: g.name,
  }));
}
```

**Dependencies to add:** `jose` (for JWT signing — lightweight, no native deps, Lambda-friendly)

```bash
cd infra && pnpm add jose
```

---

### Step 5: Update Pre-Token-Generation Lambda

**What:** The core change. Modify the existing trigger to call Google Directory API when the user has no Cognito group, map their Google Groups to a platform role, and assign it.

**File:** `infra/src/functions/pre-token-generation/index.ts`

**Current behavior:**
- If user has no platform group → auto-assign "User"
- Emit `givenRole` claim from Cognito group

**New behavior:**
- If user has a platform group → use it (manual override wins) ← unchanged
- If user has NO platform group → call Google Directory API:
  - Fetch user's Google Groups
  - Map groups to platform role using `resolveRoleFromGoogleGroups()`
  - Call `AdminAddUserToGroup(mappedRole)`
  - If API fails → default to "User" (graceful degradation)
- Emit `givenRole` claim ← unchanged

**Updated code outline:**

```typescript
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

  // --- NEW: Google Directory API lookup when no Cognito group ---
  if (!hasPlatformGroup) {
    let resolvedRole = "User";

    // Only attempt Google lookup if the secret name is configured
    if (process.env.GOOGLE_SA_SECRET_NAME) {
      try {
        const email = event.request?.userAttributes?.email;
        if (email) {
          const googleGroups = await listUserGoogleGroups(email);
          const groupEmails = googleGroups.map((g) => g.email);
          resolvedRole = resolveRoleFromGoogleGroups(groupEmails);
          console.log(
            `Google groups for ${email}:`,
            groupEmails,
            `→ resolved role: ${resolvedRole}`,
          );
        }
      } catch (err) {
        // Graceful degradation: default to "User" if API fails
        console.warn("Google Directory API lookup failed:", err);
        resolvedRole = "User";
      }
    }

    // Assign the resolved role as Cognito group
    try {
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
          GroupName: resolvedRole,
        }),
      );
    } catch (err) {
      console.warn("Failed to auto-assign group:", err);
    }

    // Add to groups list so givenRole resolves correctly below
    groups.push(resolvedRole);
  }

  // Resolve givenRole from platform group membership (unchanged logic)
  let givenRole = "User";
  if (groups.includes("Super-Admin")) givenRole = "Super-Admin";
  else if (groups.includes("Admin")) givenRole = "Admin";
  else if (groups.includes("Seller")) givenRole = "Seller";

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: { givenRole },
    },
  };

  return event;
};
```

---

### Step 6: Update CDK Stack — Lambda Permissions & Environment

**What:** Grant the pre-token-generation Lambda access to Secrets Manager and pass the required environment variables. Uses CDK's `fromSecretNameV2` so the ARN is never hardcoded anywhere.

**File:** `infra/src/lib/stacks/` (whichever stack creates the pre-token Lambda)

**Changes needed:**

1. **Look up the secret by name and grant access (CDK auto-scopes IAM):**
   ```typescript
   import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

   // Look up by NAME only — CDK resolves the ARN internally
   const googleSaSecret = secretsmanager.Secret.fromSecretNameV2(
     this, "GoogleSaSecret", envConfig.googleDirectorySecretName,
   );

   // Pass only the secret name to the Lambda (no ARN exposed)
   preTokenLambda.addEnvironment(
     "GOOGLE_SA_SECRET_NAME", googleSaSecret.secretName,
   );
   preTokenLambda.addEnvironment(
     "GOOGLE_ADMIN_EMAIL", envConfig.googleAdminEmail || "admin@enterprise.io",
   );

   // CDK generates the correct IAM policy with the resolved ARN
   // — you never see or type the ARN yourself
   googleSaSecret.grantRead(preTokenLambda);
   ```

2. **Ensure the Lambda has `cognito-idp:AdminAddUserToGroup` permission** (should already exist from current implementation).

3. **Add the secret name to `EnvConfig`** in `infra/src/lib/config.ts`:
   ```typescript
   /** Secret name in Secrets Manager (NOT the ARN). */
   googleDirectorySecretName?: string;
   googleAdminEmail?: string;
   ```

---

### Step 7: Update Environment Config Files

**What:** Add the new config values to the environment JSON files. Only the secret **name** is stored — no ARN, no credentials.

**File:** `infra/env/local.json` and any prod/dev config files

```json
{
  "googleDirectorySecretName": "google-directory-service-account",
  "googleAdminEmail": "admin@enterprise.io"
}
```

> The secret name is not sensitive — it's just a lookup key. The actual credentials live in Secrets Manager, encrypted at rest, accessible only to the Lambda via IAM.

---

### Step 8: Frontend — No Code Changes Required

**What:** Verify the existing frontend claims path works end-to-end. No code changes needed.

**Why it already works:**

The `PermissionsContext` in `pwa-frontend/src/context/PermissionsContext.tsx` already:
1. Calls `getPermissionsFromClaims()` first (reads `givenRole` from JWT)
2. Loads `ROLE_DEFAULT_PERMISSIONS[givenRole]` for the resolved role
3. Falls back to `/roles/me` API if claims are unavailable

The `claims-permissions.ts` utility already:
1. Fetches the Amplify auth session
2. Extracts `givenRole` from ID token claims
3. Resolves `cognito:groups` as fallback
4. Applies `custom:rbac_deltas` overrides if present

**Verification only:** After deploying the Lambda changes, sign in with a Google SSO account and confirm:
- `givenRole` claim appears in the JWT
- `cognito:groups` contains the correct platform group
- The UI shows the correct permissions for the assigned role

---

### Step 9: Testing Plan

#### Unit Tests (infra)

| Test | File | What to verify |
|------|------|----------------|
| Role mapping logic | `google-group-role-map.test.ts` | `resolveRoleFromGoogleGroups()` returns correct role for various group combinations |
| Single Admin group | — | `["aws-apn-mgmt@enterprise.io"]` → "Admin" |
| Single Seller group | — | `["salesteam@enterprise.io"]` → "Seller" |
| Multiple groups (highest wins) | — | `["allusers@enterprise.io", "finops@enterprise.io"]` → "Admin" |
| Unmapped groups only | — | `["classroom_teachers@enterprise.io"]` → "User" |
| Empty groups | — | `[]` → "User" |
| Never returns Super-Admin | — | Even if somehow passed, Super-Admin is not in the map |

#### Integration Tests

| Test | What to verify |
|------|----------------|
| Google SSO first-time login | User gets correct Cognito group based on Google Groups |
| Google SSO returning user | Existing Cognito group is respected (not overwritten) |
| Manual role override | Admin sets user to "Admin" via roles UI → next login keeps "Admin" |
| API failure graceful degradation | If Google API is down, user gets "User" role |
| Super-Admin protection | Super-Admin group is never auto-assigned from Google Groups |

#### E2E Smoke Test

1. Sign in with a Google account that belongs to `finops@enterprise.io`
2. Verify JWT contains `givenRole: "Admin"`
3. Verify Cognito shows user in "Admin" group
4. Verify UI shows Admin-level permissions
5. Sign in with a Google account that belongs only to `allusers@enterprise.io`
6. Verify JWT contains `givenRole: "User"`
7. Verify UI shows User-level permissions

---

### Step 10: Rollout Strategy

#### Phase A: Deploy with Feature Flag (Safe)
1. Deploy the updated Lambda with `GOOGLE_SA_SECRET_NAME` env var **unset**
2. Behavior is identical to today (no Google API calls)
3. Verify no regressions

#### Phase B: Enable Google Directory Lookup
1. Create the Secrets Manager secret with service account key
2. Update the Lambda env var to set the secret name
3. Monitor CloudWatch logs for the pre-token trigger
4. Verify first Google SSO logins get correct roles

#### Phase C: Deprecate DynamoDB Fallback (Optional, Later)
1. Once all active users have logged in at least once via the new trigger
2. Remove the `/roles/me` API fallback from `PermissionsContext`
3. Switch to pure `claims_only` mode

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `infra/src/shared/google-group-role-map.ts` | **NEW** | Google Group → Role mapping config + resolver |
| `infra/src/shared/google-directory-client.ts` | **NEW** | Google Directory API client (JWT auth, groups.list) |
| `infra/src/functions/pre-token-generation/index.ts` | **MODIFY** | Add Google Directory lookup when no Cognito group |
| `infra/src/lib/config.ts` | **MODIFY** | Add `googleDirectorySecretName` and `googleAdminEmail` to `EnvConfig` |
| `infra/src/lib/stacks/` (auth stack) | **MODIFY** | Add env vars + Secrets Manager IAM to pre-token Lambda |
| `infra/env/*.json` | **MODIFY** | Add secret name + admin email config values |
| `infra/package.json` | **MODIFY** | Add `jose` dependency |
| `pwa-frontend/` | **NO CHANGES** | Already supports claims_only mode |

---

## Dependencies

| Dependency | Package | Why |
|------------|---------|-----|
| `jose` | `infra/package.json` | JWT signing for Google service account auth (lightweight, no native deps) |
| `@aws-sdk/client-secrets-manager` | Already in infra | Read service account key from Secrets Manager |

---

## Security Considerations

- Service account key stored in Secrets Manager (encrypted at rest, IAM-scoped access)
- **No ARN exposed anywhere** — Lambda receives only the secret name; CDK's `fromSecretNameV2` + `grantRead()` handles ARN resolution and IAM scoping at deploy time
- Lambda has least-privilege: CDK-generated policy scoped to the specific secret only
- Google API scope is read-only (`admin.directory.group.readonly`)
- Super-Admin role is never auto-assigned — manual Cognito console only
- Graceful degradation: API failure defaults to "User" (never escalates)
- Credentials cached in Lambda memory (warm starts) — never logged
- The impersonation subject email should be a dedicated admin service account, not a personal email
- Config files only contain the secret name (a non-sensitive lookup key), never the ARN or credentials

---

## Estimated Timeline

| Step | Effort | Depends On |
|------|--------|------------|
| Step 1: Google service account | 1-2 hours | Google Admin access |
| Step 2: Secrets Manager | 15 min | Step 1 |
| Step 3: Group-role mapping config | 30 min | — |
| Step 4: Google Directory client | 1-2 hours | — |
| Step 5: Update pre-token Lambda | 1-2 hours | Steps 3, 4 |
| Step 6: CDK stack updates | 30 min | Steps 2, 5 |
| Step 7: Environment config | 15 min | Step 2 |
| Step 8: Frontend verification | 30 min | Steps 5, 6 deployed |
| Step 9: Testing | 2-3 hours | All above |
| Step 10: Rollout | 1 hour | All above |

**Total: ~1-2 days of dev work**
