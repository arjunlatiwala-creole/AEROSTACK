import type { ScheduledHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { registerWatch } from "./drive-watch";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;

/**
 * Dedicated watch renewal Lambda.
 * Runs every 6 hours via EventBridge.
 *
 * Google Drive watches expire after max 24 hours — this is a hard limit
 * from Google that cannot be overridden. The only solution is to
 * re-register watches before they expire.
 *
 * Strategy:
 * - Runs every 6 hours (4x per day)
 * - Renews any watch expiring within the next 7 hours (buffer window)
 * - This guarantees watches are always active with overlap
 *
 * Combined with the 15-min poller (which also renews expired watches),
 * there's effectively zero gap in coverage.
 */
export const handler: ScheduledHandler = async () => {
  console.log(`[DRIVE-WATCH-RENEWER] Starting watch renewal cycle...`);

  try {
    const result = await ddbClient.send(
      new ScanCommand({
        TableName: DOCS_TABLE,
        FilterExpression: "source_provider = :sp AND is_deleted = :d",
        ExpressionAttributeValues: {
          ":sp": "google_drive",
          ":d": false,
        },
      }),
    );

    const docs = result.Items ?? [];
    console.log(`[DRIVE-WATCH-RENEWER] Found ${docs.length} Google Drive document(s)`);

    if (docs.length === 0) return;

    // Renew watches expiring within the next 7 hours
    const renewalThreshold = Date.now() + 7 * 60 * 60 * 1000;
    let renewed = 0;
    let alreadyValid = 0;
    let failed = 0;

    for (const doc of docs) {
      const docId = doc.document_id as string;
      const title = doc.title as string;
      const sourceId = doc.source_id as string;
      const ownerEmail = (doc.owner_email as string) ?? (doc.org_id as string);

      const watchExpiration = doc.drive_watch_expiration
        ? Number(doc.drive_watch_expiration)
        : 0;

      // Skip if watch is still valid beyond our threshold
      if (watchExpiration > renewalThreshold) {
        alreadyValid++;
        continue;
      }

      console.log(`[DRIVE-WATCH-RENEWER] Renewing watch for "${title}" (${docId}), expires=${new Date(watchExpiration).toISOString()}`);

      try {
        const watchResult = await registerWatch(sourceId, docId, ownerEmail);
        if (watchResult) {
          renewed++;
          console.log(`[DRIVE-WATCH-RENEWER] ✅ Renewed: "${title}", new expiry=${watchResult.expiration}`);
        } else {
          failed++;
          console.warn(`[DRIVE-WATCH-RENEWER] ⚠️ Failed to renew: "${title}"`);
        }
      } catch (err) {
        failed++;
        console.error(`[DRIVE-WATCH-RENEWER] ❌ Error renewing "${title}":`, err);
      }

      // Delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`[DRIVE-WATCH-RENEWER] Done. Renewed: ${renewed}, Already valid: ${alreadyValid}, Failed: ${failed}`);
  } catch (error) {
    console.error(`[DRIVE-WATCH-RENEWER] ❌ Renewal cycle failed:`, error);
  }
};
