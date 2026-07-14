import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { randomUUID } from "node:crypto";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME!;

const secretsManager = new SecretsManagerClient({});

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Registers a Drive push notification (watch) for a given file.
 * Called when a google_drive document is first created or when a watch expires.
 *
 * Drive watches expire after ~24h, so the drive-poller also re-registers
 * expired watches on each run.
 */
export async function registerWatch(
  sourceId: string,
  documentId: string,
  ownerEmail: string,
): Promise<{ channelId: string; expiration: string } | null> {
  console.log(`[DRIVE-WATCH] Registering watch for file=${sourceId}, doc=${documentId}, owner=${ownerEmail}`);

  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
  if (!webhookBaseUrl) {
    console.error(`[DRIVE-WATCH] WEBHOOK_BASE_URL not set, cannot register watch`);
    return null;
  }

  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
    const accessToken = await getAccessToken(saKey, ownerEmail);

    const channelId = `dochost-${documentId}-${randomUUID().slice(0, 8)}`;
    const webhookUrl = `${webhookBaseUrl}/documents/drive-webhook`;

    // Watch expires in 24 hours (Drive max)
    const expiration = Date.now() + 24 * 60 * 60 * 1000;

    const watchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${sourceId}/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          expiration: expiration.toString(),
        }),
      },
    );

    if (!watchRes.ok) {
      const errText = await watchRes.text();
      console.error(`[DRIVE-WATCH] Watch registration FAILED: status=${watchRes.status}, response=${errText}`);
      return null;
    }

    const watchData = (await watchRes.json()) as {
      id: string;
      resourceId: string;
      expiration: string;
    };

    console.log(`[DRIVE-WATCH] Watch registered: channelId=${watchData.id}, resourceId=${watchData.resourceId}, expires=${watchData.expiration}`);

    // Store watch metadata on the document for renewal tracking
    await ddbClient.send(
      new UpdateCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
        UpdateExpression: "SET drive_watch_channel_id = :cid, drive_watch_resource_id = :rid, drive_watch_expiration = :exp",
        ExpressionAttributeValues: {
          ":cid": watchData.id,
          ":rid": watchData.resourceId,
          ":exp": watchData.expiration,
        },
      }),
    );

    return { channelId: watchData.id, expiration: watchData.expiration };
  } catch (error) {
    console.error(`[DRIVE-WATCH] Registration error:`, error);
    return null;
  }
}

/**
 * Stops (cancels) a Drive push notification channel.
 * Called when a document is deleted to prevent further notifications.
 */
export async function stopWatch(
  channelId: string,
  resourceId: string,
  ownerEmail: string,
): Promise<void> {
  console.log(`[DRIVE-WATCH] Stopping watch: channelId=${channelId}, resourceId=${resourceId}`);

  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
    const accessToken = await getAccessToken(saKey, ownerEmail);

    const res = await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: channelId, resourceId }),
    });

    if (res.ok) {
      console.log(`[DRIVE-WATCH] Watch stopped successfully`);
    } else {
      const errText = await res.text();
      console.warn(`[DRIVE-WATCH] Stop failed (${res.status}): ${errText}`);
    }
  } catch (error) {
    console.error(`[DRIVE-WATCH] Error stopping watch:`, error);
  }
}

/**
 * Receives push notifications from Google Drive when a watched file changes.
 * Route: POST /documents/drive-webhook
 *
 * Google sends headers:
 *   X-Goog-Channel-ID: the channel ID we registered
 *   X-Goog-Resource-State: "change" | "sync" | "update" | etc.
 *   X-Goog-Resource-ID: the resource ID from watch registration
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // API Gateway lowercases all header keys; normalize lookup to be safe
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value) headers[key.toLowerCase()] = value;
  }

  const channelId = headers["x-goog-channel-id"];
  const resourceState = headers["x-goog-resource-state"];
  const resourceId = headers["x-goog-resource-id"];

  console.log(`[DRIVE-WEBHOOK] Received: channelId=${channelId}, state=${resourceState}, resourceId=${resourceId}`);

  // Google sends a "sync" notification immediately after watch registration — acknowledge it
  if (resourceState === "sync") {
    console.log(`[DRIVE-WEBHOOK] Sync confirmation received, acknowledging`);
    return { statusCode: 200, body: "" };
  }

  // Only process actual changes
  if (resourceState !== "change" && resourceState !== "update") {
    console.log(`[DRIVE-WEBHOOK] Ignoring state: ${resourceState}`);
    return { statusCode: 200, body: "" };
  }

  if (!channelId) {
    console.warn(`[DRIVE-WEBHOOK] No channel ID in request, ignoring`);
    return { statusCode: 200, body: "" };
  }

  try {
    // Find the document by its watch channel ID
    // Try GSI first, fall back to scan if GSI doesn't exist (local dev)
    let doc: Record<string, unknown> | undefined;

    try {
      const queryResult = await ddbClient.send(
        new QueryCommand({
          TableName: DOCS_TABLE,
          IndexName: "drive-watch-channel-index",
          KeyConditionExpression: "drive_watch_channel_id = :cid",
          ExpressionAttributeValues: { ":cid": channelId },
        }),
      );
      doc = queryResult.Items?.[0] as Record<string, unknown> | undefined;
    } catch {
      // GSI doesn't exist (local dev) — fall back to scan
      const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
      const fallback = await ddbClient.send(
        new ScanCommand({
          TableName: DOCS_TABLE,
          FilterExpression: "drive_watch_channel_id = :cid",
          ExpressionAttributeValues: { ":cid": channelId },
        }),
      );
      doc = fallback.Items?.[0] as Record<string, unknown> | undefined;
    }

    if (!doc) {
      console.warn(`[DRIVE-WEBHOOK] No document found for channelId=${channelId}, may be expired watch`);
      return { statusCode: 200, body: "" };
    }

    // Skip deleted documents — watch will expire naturally
    if (doc.is_deleted === true) {
      console.log(`[DRIVE-WEBHOOK] Document is deleted, ignoring notification`);
      return { statusCode: 200, body: "" };
    }

    const documentId = doc.document_id as string;
    const title = doc.title as string;
    console.log(`[DRIVE-WEBHOOK] Matched document: "${title}" (${documentId}), triggering sync...`);

    // Cooldown: skip if we synced this document within the last 30 seconds
    // This prevents duplicate versions from rapid-fire Google notifications
    // while still catching new edits that happen after the cooldown window
    const lastUpdated = doc.updated_at as string | undefined;
    if (lastUpdated) {
      const secondsSinceLastSync = (Date.now() - new Date(lastUpdated).getTime()) / 1000;
      if (secondsSinceLastSync < 30) {
        console.log(`[DRIVE-WEBHOOK] Synced ${secondsSinceLastSync.toFixed(0)}s ago, skipping (cooldown 30s)`);
        return { statusCode: 200, body: "" };
      }
    }

    // Trigger sync
    const { syncFromDrive } = await import("./sync-from-drive");
    const result = await syncFromDrive(doc as Record<string, unknown>);

    if (result.success && result.skipped) {
      console.log(`[DRIVE-WEBHOOK] File unchanged (hash match), no new version needed`);
    } else if (result.success) {
      console.log(`[DRIVE-WEBHOOK] ✅ Synced: "${title}" → v${result.version_number}`);
    } else {
      console.warn(`[DRIVE-WEBHOOK] ⚠️ Sync failed: ${result.error}`);
    }

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error(`[DRIVE-WEBHOOK] Error processing notification:`, error);
    // Always return 200 to Google — otherwise it retries aggressively
    return { statusCode: 200, body: "" };
  }
};

/**
 * Gets an OAuth2 access token using domain-wide delegation.
 */
async function getAccessToken(saKey: ServiceAccountKey, impersonateEmail: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: saKey.client_email,
      sub: impersonateEmail,
      scope: "https://www.googleapis.com/auth/drive.readonly",
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
    throw new Error(`Token exchange failed: ${tokenRes.status}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}
