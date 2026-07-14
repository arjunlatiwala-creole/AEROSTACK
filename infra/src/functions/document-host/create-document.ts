import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) {
  throw new Error("DOCUMENTS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body ?? "{}");
    const {
      title,
      slug,
      description,
      source_provider,
      source_id,
      source_url,
      mime_type,
      visibility,
      tags,
      org_id,
    } = body;

    if (!title || !slug || !mime_type || !visibility || !org_id) {
      return err(
        "title, slug, mime_type, visibility, and org_id are required",
        400,
      );
    }

    if (!["canva", "google_drive", "manual"].includes(source_provider ?? "manual")) {
      return err("source_provider must be canva, google_drive, or manual", 400);
    }

    if (!["public", "internal", "restricted"].includes(visibility)) {
      return err("visibility must be public, internal, or restricted", 400);
    }

    // Slug uniqueness is checked below after constructing the full slug

    const now = new Date().toISOString();
    const claims = (event as unknown as { requestContext?: { authorizer?: { claims?: Record<string, string> } } })
      .requestContext?.authorizer?.claims;

    let personId = claims?.sub ?? "system";
    let ownerEmail = claims?.email ?? body.owner_email ?? "unknown";

    // SAM local: decode JWT manually to get claims
    if (ownerEmail === "unknown" && process.env.AWS_SAM_LOCAL === "true") {
      const token = (event.headers?.Authorization ?? event.headers?.authorization ?? "").replace("Bearer ", "");
      if (token) {
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
            personId = payload.sub ?? personId;
            ownerEmail = payload.email ?? ownerEmail;
          }
        } catch { /* ignore decode errors */ }
      }
    }

    // Slug becomes {ownerEmail}/{slug} for public URL ownership visibility
    const ownerPrefix = ownerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const fullSlug = `${ownerPrefix}/${slug}`;

    // Check slug uniqueness using the full slug (owner/slug)
    const existingFull = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI_Slug",
        KeyConditionExpression: "slug = :s",
        ExpressionAttributeValues: { ":s": fullSlug },
        Limit: 1,
      }),
    );

    if (existingFull.Items && existingFull.Items.length > 0) {
      return err(`Slug "${fullSlug}" is already in use`, 409);
    }

    const document: Record<string, unknown> = {
      document_id: randomUUID(),
      org_id,
      title,
      slug: fullSlug,
      owner_email: ownerEmail,
      source_provider: source_provider ?? "manual",
      mime_type,
      current_version: 0,
      visibility,
      tags: tags && tags.length > 0 ? tags : ["untagged"],
      is_deleted: false,
      created_by: personId,
      created_at: now,
      updated_at: now,
    };

    // Only include optional string fields if they have a value
    // DynamoDB rejects empty strings
    if (description) document.description = description;
    if (source_id) document.source_id = source_id;
    if (source_url) document.source_url = source_url;

    await ddbClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: document,
      }),
    );

    // For Google Drive sources, trigger initial file fetch immediately
    if ((source_provider === "google_drive") && source_id) {
      try {
        const { syncFromDrive } = await import("./sync-from-drive");
        const syncResult = await syncFromDrive(document);
        if (syncResult.success && syncResult.version_number) {
          document.current_version = syncResult.version_number;
        }
      } catch (syncErr) {
        console.warn("Initial Drive sync failed, will retry on webhook:", syncErr);
      }

      // Register Drive push notification watch for real-time sync
      try {
        const { registerWatch } = await import("./drive-watch");
        const watchResult = await registerWatch(source_id, document.document_id as string, ownerEmail);
        if (watchResult) {
          console.log(`Drive watch registered: channelId=${watchResult.channelId}, expires=${watchResult.expiration}`);
        }
      } catch (watchErr) {
        console.warn("Drive watch registration failed, poller will retry:", watchErr);
      }
    }

    // For Canva sources, trigger initial export
    if (source_provider === "canva" && source_id) {
      try {
        const { syncFromCanva } = await import("./sync-from-canva");
        const syncResult = await syncFromCanva(document);
        if (syncResult.success && syncResult.version_number) {
          document.current_version = syncResult.version_number;
        }
      } catch (syncErr) {
        console.warn("Initial Canva sync failed, will retry on webhook:", syncErr);
      }
    }

    return ok(document, 201);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating document:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
