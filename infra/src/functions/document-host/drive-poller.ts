import type { ScheduledHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { syncFromDrive } from "./sync-from-drive";
import { registerWatch } from "./drive-watch";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;

/**
 * Scheduled poller that:
 * 1. Re-registers expired Drive push notification watches
 * 2. Falls back to hash-based sync for any docs that missed a webhook
 *
 * Runs every 15 minutes via EventBridge.
 * Primary sync is via push notifications (drive-watch.ts) — this is the safety net.
 */
export const handler: ScheduledHandler = async () => {
  console.log(`[DRIVE-POLLER] Starting scheduled Drive sync poll...`);

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
    console.log(`[DRIVE-POLLER] Found ${docs.length} Google Drive document(s) to check`);

    if (docs.length === 0) {
      console.log(`[DRIVE-POLLER] No Drive docs to sync. Done.`);
      return;
    }

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let watchesRenewed = 0;

    const now = Date.now();

    for (const doc of docs) {
      const docId = doc.document_id as string;
      const title = doc.title as string;
      const sourceId = doc.source_id as string;
      const ownerEmail = (doc.owner_email as string) ?? (doc.org_id as string);

      // Renew watch if expired or not set
      const watchExpiration = doc.drive_watch_expiration
        ? Number(doc.drive_watch_expiration)
        : 0;
      if (!watchExpiration || watchExpiration < now + 60_000) {
        console.log(`[DRIVE-POLLER] Watch expired/missing for "${title}", renewing...`);
        const watchResult = await registerWatch(sourceId, docId, ownerEmail);
        if (watchResult) {
          watchesRenewed++;
        }
      }

      // Still do a hash-based sync as fallback
      try {
        console.log(`[DRIVE-POLLER] Checking: "${title}" (${docId})`);
        const syncResult = await syncFromDrive(doc as Record<string, unknown>);

        if (syncResult.success && syncResult.skipped) {
          skipped++;
        } else if (syncResult.success) {
          synced++;
          console.log(`[DRIVE-POLLER] ✅ Updated: "${title}" → v${syncResult.version_number}`);
        } else {
          failed++;
          console.warn(`[DRIVE-POLLER] ⚠️ Failed: "${title}" — ${syncResult.error}`);
        }
      } catch (err) {
        failed++;
        console.error(`[DRIVE-POLLER] ❌ Error syncing "${title}":`, err);
      }

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`[DRIVE-POLLER] Done. Synced: ${synced}, Unchanged: ${skipped}, Failed: ${failed}, Watches renewed: ${watchesRenewed}`);
  } catch (error) {
    console.error(`[DRIVE-POLLER] ❌ Poller failed:`, error);
  }
};
