import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME!;
const secretsManager = new SecretsManagerClient({});

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Lists Google Drive files for the logged-in user, using the service account
 * with domain-wide delegation to impersonate the caller. No client-side OAuth.
 *
 * Query params:
 *   tab=shared|mine  (default shared)
 *   query=<text>     (optional name filter)
 *
 * Route: GET /documents/drive/files
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const tab = event.queryStringParameters?.tab === "mine" ? "mine" : "shared";
    const query = event.queryStringParameters?.query ?? "";

    const impersonateEmail = getCallerEmail(event);
    if (!impersonateEmail) {
      return err("Could not determine the logged-in user's email", 401);
    }

    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
    const accessToken = await getAccessToken(
      saKey,
      impersonateEmail,
      "https://www.googleapis.com/auth/drive.readonly",
    );

    let driveQuery =
      tab === "mine"
        ? "'me' in owners and trashed = false"
        : "sharedWithMe = true and trashed = false";
    if (query) {
      driveQuery += ` and name contains '${query.replace(/'/g, "\\'")}'`;
    }

    const params = new URLSearchParams({
      q: driveQuery,
      pageSize: "100",
      fields:
        "files(id,name,mimeType,modifiedTime,createdTime,webViewLink,iconLink,size,owners,sharingUser,shared)",
      orderBy: "modifiedTime desc",
    });

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!driveRes.ok) {
      const errText = await driveRes.text();
      console.error(`[DRIVE-LIST] Drive API error: ${driveRes.status} ${errText}`);
      return err(`Google Drive API error: ${driveRes.status}`, driveRes.status >= 500 ? 502 : 400);
    }

    const driveData = (await driveRes.json()) as {
      files: Array<Record<string, unknown>>;
    };

    return ok({ files: driveData.files ?? [], impersonated: impersonateEmail });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DRIVE-LIST] Error:", error);
    return err(message, 500);
  }
};

/** Extracts the caller's email from Cognito claims, with a SAM-local JWT fallback. */
function getCallerEmail(event: Parameters<APIGatewayProxyHandlerV2>[0]): string | null {
  const claims = (event as unknown as {
    requestContext?: { authorizer?: { claims?: Record<string, string> } };
  }).requestContext?.authorizer?.claims;
  let email = claims?.email ?? "";

  if (!email && process.env.AWS_SAM_LOCAL === "true") {
    const token = (event.headers?.Authorization ?? event.headers?.authorization ?? "").replace("Bearer ", "");
    if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
          email = payload.email ?? "";
        }
      } catch { /* ignore */ }
    }
  }
  return email || null;
}

async function getAccessToken(
  saKey: ServiceAccountKey,
  impersonateEmail: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: saKey.client_email,
      sub: impersonateEmail,
      scope,
      aud: saKey.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

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
    throw new Error(`Token exchange failed: ${tokenRes.status} - ${errBody.slice(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}

export const handler = withPermissions(_handler);
