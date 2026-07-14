import crypto from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { EventBridgeEvent } from "aws-lambda";
import {
  IntegrationRepository,
  IntegrationSyncDetailsRepository,
  IntegrationSyncHistoryRepository,
} from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { SyncHistoryTracker } from "../integrations/helpers/sync-history";
import { createLogger } from "../shared/logger";
import { err, ok } from "../shared/response";
import { userInfo } from "node:os";

const s3Client = new S3Client({});
const logger = createLogger("LinearProcessEntityHandler");

interface LinearIssue {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  state: {
    id: string;
    name: string;
    type: string;
    color: string;
  };
  assignee: { id: string; name: string; email: string } | null;
  labels: { nodes: Array<{ id: string; name: string; color: string }> };
}

interface LinearProjectUpdate {
  id: string;
  health: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user: { id: string; name: string; email: string };
    }>;
  };
}

interface LinearProject {
  id: string;
  name: string;
  description: string;
  content: string;
  state: string;
  priority: number;
  progress: number;
  scope: number;
  url: string;
  startDate: string | null;
  targetDate: string | null;
  status: { name: string; type: string } | null;
  lead: { id: string; name: string; email: string } | null;
  creator: { id: string; name: string; email: string } | null;
  members: {
    nodes: Array<{
      id: string;
      name: string;
      email: string;
      displayName: string;
    }>;
  };
  labels: { nodes: Array<{ id: string; name: string }> };
  teams: {
    nodes: Array<{
      id: string;
      name: string;
      key: string;
      description: string | null;
    }>;
  };
  projectUpdates?: LinearProjectUpdate[];
  issues?: LinearIssue[];
}

interface S3LinearData {
  syncedAt: string;
  totalProjects: number;
  totalIssues: number;
  totalUpdates: number;
  projects: LinearProject[];
}

/**
 * Extract important delivery data from a Linear project.
 * Flattens key fields for the linear-delivery DynamoDB table.
 */
function extractProjectDeliveryData(
  project: LinearProject,
): Record<string, any> {
  // Build base record — GSI key attributes must never be empty strings
  // because DynamoDB (local) rejects empty-string key attributes.
  const record: Record<string, any> = {
    id: project.id,
    name: project.name,
    description: project.description || "N/A",
    content: project.content || "N/A",
    state: project.state || "unknown",
    priority: project.priority,
    progress: project.progress,
    scope: project.scope,
    url: project.url,
    start_date: project.startDate || "N/A",
    target_date: project.targetDate || "N/A",
    status_name: project.status?.name || "N/A",
    status_type: project.status?.type || "N/A",

    // Lead info (flattened) — lead_email is a GSI key, so use "N/A" instead of ""
    lead_id: project.lead?.id || "N/A",
    lead_name: project.lead?.name || "N/A",
    lead_email: project.lead?.email || "N/A",

    // Creator info (flattened)
    creator_id: project.creator?.id || "N/A",
    creator_name: project.creator?.name || "N/A",
    creator_email: project.creator?.email || "N/A",
  };

  // Team info
  record.teams =
    project.teams?.nodes?.map((t) => ({
      id: t.id,
      name: t.name,
      key: t.key,
    })) || [];

  // Members
  record.members =
    project.members?.nodes?.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      displayName: m.displayName,
    })) || [];

  // Project updates
  record.project_updates = (project.projectUpdates ?? []).map((u) => ({
    id: u.id,
    health: u.health,
    body: u.body,
    created_at: u.createdAt,
    userId: u.user?.id || "N/A",
    user_name: u.user?.name || "N/A",
    user_email: u.user?.email || "N/A",
    comments:
      u.comments?.nodes?.map((c) => ({
        id: c.id,
        body: c.body,
        created_at: c.createdAt,
        userId: c.user?.id || "N/A",
        user_name: c.user?.name || "N/A",
        user_email: c.user?.email || "N/A",
      })) || [],
  }));

  // Labels
  record.labels =
    project.labels?.nodes?.map((l) => ({
      id: l.id,
      name: l.name,
    })) || [];

  // Issues summary
  record.total_issues = project.issues?.length || 0;
  record.issues_completed =
    project.issues?.filter((i) => i.completedAt !== null).length || 0;
  record.issues_canceled =
    project.issues?.filter((i) => i.canceledAt !== null).length || 0;

  // Individual issues (important fields only)
  record.issues = (project.issues || []).map((issue) => ({
    id: issue.id,
    title: issue.title,
    priority: issue.priority,
    estimate: issue.estimate,
    due_date: issue.dueDate || "N/A",
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    completed_at: issue.completedAt || "N/A",
    canceled_at: issue.canceledAt || "N/A",
    state_name: issue.state?.name || "N/A",
    state_type: issue.state?.type || "N/A",
    assignee_name: issue.assignee?.name || "N/A",
    assignee_email: issue.assignee?.email || "N/A",
    labels: issue.labels?.nodes?.map((l) => l.name) || [],
  }));

  // Timestamps
  record.synced_at = new Date().toISOString();
  record.updated_at = new Date().toISOString();

  return record;
}

/**
 * Merges Linear-synced project_updates with existing DDB project_updates.
 */
function mergeProjectUpdates(
  linearUpdates: Record<string, any>[], // from extractProjectDeliveryData
  existingUpdates: Record<string, any>[], // from DDB existing record
): Record<string, any>[] {
  const existingById = new Map(existingUpdates.map((u) => [u.id, u]));

  const merged = linearUpdates.map((linearUpdate) => {
    const existing = existingById.get(linearUpdate.id);
    if (existing) {
      // Keep DDB version — it has the real Cognito user email
      // Only update health/body in case they changed in Linear
      return {
        ...existing,
        health: linearUpdate.health,
        body: linearUpdate.body,
      };
    }
    // New update from Linear — add it as-is
    return linearUpdate;
  });

  // Also keep any DDB entries NOT in the Linear response
  // (e.g. entries added via addProjectUpdate that Linear doesn't return yet)
  const linearIds = new Set(linearUpdates.map((u) => u.id));
  const ddbOnlyUpdates = existingUpdates.filter((u) => !linearIds.has(u.id));

  return [...merged, ...ddbOnlyUpdates];
}

// ─── S3 fetch ──────────────────────────────────────────────────────────────
async function fetchLinearDataFromS3(
  bucket: string,
  key: string,
): Promise<S3LinearData> {
  logger.info("Fetching Linear data from S3", { bucket, key });

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const bodyString = await response.Body?.transformToString();
  if (!bodyString) {
    throw new Error("Empty S3 response");
  }

  return JSON.parse(bodyString);
}

export const handler = async (
  event: EventBridgeEvent<"Ingestion Complete", any>,
) => {
  const startTime = Date.now();

  // Parse event detail
  const {
    bucket,
    s3Key,
    projectsProcessed,
    integration_id: integrationId,
    entity,
  } = event.detail;

  if (!bucket || !s3Key) {
    return err("bucket and s3Key are required", 400);
  }

  logger.info("Processing Linear entities", {
    bucket,
    s3Key,
    projectsProcessed,
  });

  // Table names
  const linearDeliveryTable =
    process.env.LINEAR_DELIVERY_TABLE_NAME! || "local-linear-delivery";
  const integrationsSyncHistoryTable =
    process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME! ||
    "local-integration-sync-history";
  const integrationsSyncDetailsTable =
    process.env.INTEGRATION_SYNC_DETAILS_TABLE_NAME! ||
    "local-integration-sync-details";
  const integrationsTable =
    process.env.INTEGRATIONS_TABLE_NAME! || "local-integrations";

  // Sync tracking setup
  const syncId = crypto.randomUUID();

  const integrationRepo = new IntegrationRepository(
    ddbClient,
    integrationsTable,
  );
  const syncHistoryRepo = new IntegrationSyncHistoryRepository(
    ddbClient,
    integrationsSyncHistoryTable,
  );
  const syncDetailsRepo = new IntegrationSyncDetailsRepository(
    ddbClient,
    integrationsSyncDetailsTable,
  );
  const tracker = new SyncHistoryTracker(
    integrationRepo,
    syncHistoryRepo,
    syncDetailsRepo,
    integrationId,
    syncId,
  );

  let processed = 0;
  let failed = 0;

  try {
    // Initialize sync
    await tracker.initialize({ manual_trigger: true, direction: "inbound" });

    // Fetch data from S3
    const linearData = await fetchLinearDataFromS3(bucket, s3Key);
    logger.info(`Fetched ${linearData.projects.length} projects from S3`, {
      totalIssues: linearData.totalIssues,
      totalUpdates: linearData.totalUpdates,
    });

    // Process each project
    for (const project of linearData.projects) {
      try {
        const projectId = project.id;

        // Extract and transform project data
        const deliveryData = extractProjectDeliveryData(project);
        logger.info(`Processing project: ${project.name}`, {
          id: projectId,
          updates: deliveryData.project_updates?.length ?? 0,
          issues: deliveryData.issues?.length ?? 0,
        });

        // Check if record exists
        const queryResult = await ddbClient.send(
          new QueryCommand({
            TableName: linearDeliveryTable,
            KeyConditionExpression: "id = :id",
            ExpressionAttributeValues: {
              ":id": projectId,
            },
            ScanIndexForward: false,
            Limit: 1,
          }),
        );

        const existingRecord = queryResult.Items?.[0];

        if (!existingRecord) {
          // INSERT new record
          await ddbClient.send(
            new PutCommand({
              TableName: linearDeliveryTable,
              Item: {
                ...deliveryData,
                created_at: new Date().toISOString(),
              },
            }),
          );

          await tracker.recordSuccess(
            entity || "project",
            projectId,
            projectId,
            "create",
            {
              old: {},
              new: deliveryData,
            },
          );

          logger.info(`Inserted new project: ${projectId}`);
        } else {
          // ── UPDATE ──────────────────────────────────────────────────
          // Merge project_updates carefully so we don't overwrite real user
          // emails that were stored by the addProjectUpdate handler.
          const existingUpdates: Record<string, any>[] = Array.isArray(
            existingRecord.project_updates,
          )
            ? existingRecord.project_updates
            : [];

          const mergedUpdates = mergeProjectUpdates(
            deliveryData.project_updates ?? [],
            existingUpdates,
          );

          await ddbClient.send(
            new PutCommand({
              TableName: linearDeliveryTable,
              Item: {
                ...deliveryData,
                // Preserve original insert timestamp
                created_at: existingRecord.created_at,
                // Use merged updates (real emails preserved)
                project_updates: mergedUpdates,
              },
            }),
          );

          await tracker.recordSuccess(
            entity || "project",
            projectId,
            projectId,
            "update",
            {
              old: existingRecord,
              new: deliveryData,
            },
          );

          logger.info(`Updated Linear project: ${projectId}`);
        }

        processed++;
      } catch (recordError: any) {
        failed++;
        logger.error("Record sync failed", {
          projectId: project.id,
          error: recordError,
        });

        await tracker.recordFailure(
          entity || "project",
          project.id,
          "upsert",
          recordError,
        );
      }
    }

    logger.info("Linear entity processing complete", {
      processed,
      failed,
      syncId,
    });

    return ok({
      message: "Linear entities processed successfully",
      syncId,
      processed,
      failed,
      totalProjects: linearData.projects.length,
    });
  } catch (error: any) {
    logger.error("Process entity error", error);
    return err(error.message || "Failed to process Linear entities", 500);
  } finally {
    await tracker.complete(
      processed,
      failed,
      startTime,
      failed > 0 ? `${failed} records failed to sync` : "",
      true,
    );
  }
};
