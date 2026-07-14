import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME!;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const secretsManager = new SecretsManagerClient({});

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const TYPE_TO_MIME: Record<string, string> = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
};

const GOOGLE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EDIT_URL_BASE: Record<string, string> = {
  "application/vnd.google-apps.document": "https://docs.google.com/document/d/",
  "application/vnd.google-apps.spreadsheet": "https://docs.google.com/spreadsheets/d/",
  "application/vnd.google-apps.presentation": "https://docs.google.com/presentation/d/",
};

/**
 * Creates a new Google Drive file (Doc/Sheet/Slides) in the logged-in user's
 * Drive via the service account (domain-wide delegation), then registers it in
 * document-host and sets up a Drive watch so it auto-syncs to S3.
 *
 * Route: POST /documents/drive/create
 * Body: { name: string, type: "document"|"spreadsheet"|"presentation" }
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body ?? "{}") as { name?: string; type?: string };
    const { name, type } = body;

    if (!name || !type) return err("name and type are required", 400);

    const mimeType = TYPE_TO_MIME[type];
    if (!mimeType) {
      return err(`Invalid type: ${type}. Must be document, spreadsheet, or presentation`, 400);
    }

    const callerEmail = getCallerEmail(event);
    if (!callerEmail) return err("Could not determine the logged-in user's email", 401);

    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
    // Creating files requires full drive scope (not drive.readonly).
    const accessToken = await getAccessToken(
      saKey,
      callerEmail,
      "https://www.googleapis.com/auth/drive",
    );

    const createRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, mimeType }),
      },
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`[DRIVE-CREATE] Drive API error: ${createRes.status} ${errText}`);
      return err(`Failed to create file in Google Drive: ${createRes.status}`, 502);
    }

    const driveFile = (await createRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      webViewLink?: string;
    };

    const webViewLink =
      driveFile.webViewLink ?? `${EDIT_URL_BASE[mimeType] ?? "https://drive.google.com/file/d/"}${driveFile.id}/edit`;

    // Register in document-host for auto-sync
    const documentId = randomUUID();
    const now = new Date().toISOString();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

    const docRecord = {
      document_id: documentId,
      org_id: "enterprise",
      owner_email: callerEmail,
      title: name,
      slug: `${callerEmail}/${slug}-drive`,
      description: "Created from Drive Playground",
      source_provider: "google_drive",
      source_id: driveFile.id,
      source_url: webViewLink,
      mime_type: GOOGLE_EXPORT_MIME[mimeType] ?? mimeType,
      current_version: 0,
      visibility: "internal",
      tags: ["google-drive", "auto-sync", "playground"],
      is_deleted: false,
      created_by: callerEmail,
      created_at: now,
      updated_at: now,
    };

    await ddbClient.send(new PutCommand({ TableName: DOCS_TABLE, Item: docRecord }));

    // Register Drive watch for auto-sync (best-effort; poller is the fallback)
    try {
      const { registerWatch } = await import("./drive-watch");
      await registerWatch(driveFile.id, documentId, callerEmail);
    } catch (watchErr) {
      console.warn("[DRIVE-CREATE] Watch registration failed (poller will cover):", watchErr);
    }

    return ok({
      id: driveFile.id,
      name: driveFile.name,
      mimeType: driveFile.mimeType,
      webViewLink,
      document_id: documentId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DRIVE-CREATE] Error:", error);
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
    if (tokenRes.status === 401 || errBody.includes("unauthorized_client")) {
      throw new Error(
        `Token exchange failed (${tokenRes.status}): the service account needs the "https://www.googleapis.com/auth/drive" scope authorized in Google Workspace Admin → Security → API Controls → Domain-wide Delegation. Raw: ${errBody.slice(0, 200)}`,
      );
    }
    throw new Error(`Token exchange failed: ${tokenRes.status} - ${errBody.slice(0, 200)}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}

export const handler = withPermissions(_handler);
