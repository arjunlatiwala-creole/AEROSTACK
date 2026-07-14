/**
 * Lightweight Google Directory API client for Lambda.
 *
 * Uses a service account with domain-wide delegation to list a user's
 * Google Workspace group memberships. Credentials are loaded from
 * Secrets Manager by **name** (not ARN) and cached across warm starts.
 *
 * Dependencies: jose (JWT signing), @aws-sdk/client-secrets-manager.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SignJWT, importPKCS8 } from "jose";
import type { CryptoKey as JoseCryptoKey } from "jose";

const secretsClient = new SecretsManagerClient({});

/** Cached across warm Lambda invocations — never logged. */
let cachedCredentials: {
  clientEmail: string;
  privateKey: JoseCryptoKey;
} | null = null;

export interface GoogleGroupInfo {
  email: string;
  name: string;
}

/**
 * Loads and caches Google service account credentials from Secrets Manager.
 * The private key is imported once as a KeyLike for repeated signing.
 */
async function getServiceAccountCredentials(): Promise<{
  clientEmail: string;
  privateKey: JoseCryptoKey;
}> {
  if (cachedCredentials) return cachedCredentials;

  const secretName = process.env.GOOGLE_SA_SECRET_NAME;
  if (!secretName) throw new Error("GOOGLE_SA_SECRET_NAME env var not set");

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );

  const parsed = JSON.parse(result.SecretString || "{}");
  const privateKey = await importPKCS8(parsed.private_key, "RS256");

  cachedCredentials = {
    clientEmail: parsed.client_email,
    privateKey,
  };
  return cachedCredentials;
}

/**
 * Creates a short-lived Google OAuth2 access token via JWT bearer
 * assertion (service account flow with domain-wide delegation).
 */
export async function getGoogleAccessToken(
  impersonateEmail: string,
  scope: string = "https://www.googleapis.com/auth/admin.directory.group.readonly",
): Promise<string> {
  const { clientEmail, privateKey } = await getServiceAccountCredentials();

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: clientEmail,
    sub: impersonateEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(privateKey);

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

  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Lists all Google Workspace groups for a given user email.
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

  const data = (await resp.json()) as {
    groups?: Array<{ email: string; name: string }>;
  };
  return (data.groups ?? []).map((g) => ({
    email: g.email,
    name: g.name,
  }));
}


/**
 * Lists all Google Workspace groups in the customer's domain.
 * Used for admin UIs that let users pick a group to assign work to.
 */
export async function listAllGoogleGroups(): Promise<GoogleGroupInfo[]> {
  const impersonateEmail =
    process.env.GOOGLE_ADMIN_EMAIL || "admin@enterprise.io";
  const accessToken = await getGoogleAccessToken(impersonateEmail);

  const groups: GoogleGroupInfo[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "https://admin.googleapis.com/admin/directory/v1/groups",
    );
    url.searchParams.set("customer", "my_customer");
    url.searchParams.set("fields", "nextPageToken,groups(email,name)");
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Google Directory listGroups failed: ${resp.status} ${text}`,
      );
    }

    const data = (await resp.json()) as {
      groups?: Array<{ email: string; name: string }>;
      nextPageToken?: string;
    };
    for (const g of data.groups ?? []) {
      groups.push({ email: g.email, name: g.name });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return groups;
}

/**
 * Lists all member email addresses in a given Google Workspace group.
 * Recursively expands nested groups by following type=GROUP entries.
 * Returns only resolved USER emails (active and dedup'd by the caller).
 */
export async function listGroupMemberEmails(
  groupEmail: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  if (visited.has(groupEmail)) return [];
  visited.add(groupEmail);

  const impersonateEmail =
    process.env.GOOGLE_ADMIN_EMAIL || "admin@enterprise.io";
  const accessToken = await getGoogleAccessToken(impersonateEmail);

  const emails = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(groupEmail)}/members`,
    );
    url.searchParams.set("includeDerivedMembership", "true");
    url.searchParams.set(
      "fields",
      "nextPageToken,members(email,type,status)",
    );
    url.searchParams.set("maxResults", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Google Directory listMembers failed for ${groupEmail}: ${resp.status} ${text}`,
      );
    }

    const data = (await resp.json()) as {
      members?: Array<{ email?: string; type?: string; status?: string }>;
      nextPageToken?: string;
    };

    for (const m of data.members ?? []) {
      if (!m.email) continue;
      // Only skip explicitly inactive accounts.
      if (m.status === "SUSPENDED" || m.status === "ARCHIVED") continue;

      if (m.type === "GROUP") {
        const nested = await listGroupMemberEmails(m.email, visited);
        for (const e of nested) emails.add(e.toLowerCase());
      } else if (m.type === "USER") {
        // Only include actual user accounts — skip CUSTOMER, EXTERNAL,
        // or any non-user entry (e.g. collaborative inbox addresses).
        emails.add(m.email.toLowerCase());
      }
      // Skip type === "CUSTOMER" / "EXTERNAL" / unknown — these are
      // typically shared inboxes or external contacts, not real people.
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return Array.from(emails);
}
