import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME!;
const secretsManager = new SecretsManagerClient({});

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink: string;
  owners?: { displayName: string; emailAddress: string }[];
  sharingUser?: { displayName: string; emailAddress: string };
}

/**
 * GET /documents/drive/files
 *
 * Lists files shared with the calling user in Google Drive.
 * Uses the Service Account with domain-wide delegation to impersonate
 * the user (identified from their Cognito JWT claims).
 *
 * Query params:
 *   - pageSize (default 100)
 *   - pageToken (for pagination)
 *   - query    (optional extra Drive query clause)
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // Standard Cognito JWT claims injection (same as create-document, etc.)
    const claims = (event.requestContext as unknown as { authorizer?: { claims?: Record<string, string> } })
      ?.authorizer?.claims;
    const userEmail = claims?.email;

    if (!userEmail) {
      return err("Unable to determine authenticated user email", 401);
    }

    // 1. Load SA credentials
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);

    // 2. Get access token impersonating the user
    const accessToken = await getAccessToken(saKey, userEmail);

    // 3. Query Drive for files shared with the user
    const pageSize = event.queryStringParameters?.pageSize ?? "100";
    const pageToken = event.queryStringParameters?.pageToken;
    const extraQuery = event.queryStringParameters?.query ?? "";

    const baseQuery = "sharedWithMe = true and trashed = false";
    const fullQuery = extraQuery ? `${baseQuery} and ${extraQuery}` : baseQuery;

    const params = new URLSearchParams({
      q: fullQuery,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,owners,sharingUser)",
      pageSize,
      orderBy: "modifiedTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[LIST-DRIVE-FILES] Drive API error: ${res.status} ${body}`);
      return err(`Drive API error: ${res.status}`, res.status === 401 ? 401 : 502);
    }

    const data = await res.json() as { files: DriveFile[]; nextPageToken?: string };

    return ok({
      files: data.files ?? [],
      nextPageToken: data.nextPageToken ?? null,
      impersonating: userEmail,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[LIST-DRIVE-FILES] Error:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);

// ─── JWT helper (same as sync-from-drive.ts) ──────────────────────────────────

async function getAccessToken(saKey: ServiceAccountKey, impersonateEmail: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims  = {
    iss: saKey.client_email,
    sub: impersonateEmail,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: saKey.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(saKey.private_key, "base64url");

  const jwt = `${header}.${payload}.${signature}`;
  const tokenRes = await fetch(saKey.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} ${errBody}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };
  return tokenData.access_token;
}
