import type { ScheduledHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { syncFromCanva } from "./sync-from-canva";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;

/**
 * Scheduled poller that checks all Canva-sourced documents for changes.
 * Runs every 15 minutes via EventBridge.
 * 
 * For each Canva doc, it re-exports the design and compares the hash.
 * If changed, a new version is created in S3 + DynamoDB.
 */
export const handler: ScheduledHandler = async () => {
  console.log(`[CANVA-POLLER] Starting scheduled Canva sync poll...`);

  try {
    // Get all Canva-sourced documents
    const result = await ddbClient.send(
      new ScanCommand({
        TableName: DOCS_TABLE,
        FilterExpression: "source_provider = :sp AND is_deleted = :d",
        ExpressionAttributeValues: {
          ":sp": "canva",
          ":d": false,
        },
      }),
    );

    const docs = result.Items ?? [];
    console.log(`[CANVA-POLLER] Found ${docs.length} Canva document(s) to check`);

    if (docs.length === 0) {
      console.log(`[CANVA-POLLER] No Canva docs to sync. Done.`);
      return;
    }

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of docs) {
      const docId = doc.document_id as string;
      const title = doc.title as string;

      try {
        console.log(`[CANVA-POLLER] Checking: "${title}" (${docId})`);
        const result = await syncFromCanva(doc as Record<string, unknown>);

        if (result.success && result.skipped) {
          skipped++;
        } else if (result.success) {
          synced++;
          console.log(`[CANVA-POLLER] ✅ Updated: "${title}" → v${result.version_number}`);
        } else {
          failed++;
          console.warn(`[CANVA-POLLER] ⚠️ Failed: "${title}" — ${result.error}`);
        }
      } catch (err) {
        failed++;
        console.error(`[CANVA-POLLER] ❌ Error syncing "${title}":`, err);
      }

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`[CANVA-POLLER] Done. Synced: ${synced}, Unchanged: ${skipped}, Failed: ${failed}`);
  } catch (error) {
    console.error(`[CANVA-POLLER] ❌ Poller failed:`, error);
  }
};
