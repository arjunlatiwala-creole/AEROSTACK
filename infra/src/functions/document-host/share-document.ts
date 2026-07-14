import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { randomUUID } from "node:crypto";
import { extractUser, canModifyDocument } from "./doc-auth";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME;

if (!DOCS_TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");
if (!ACCESS_TABLE) throw new Error("DOCUMENT_ACCESS_TABLE_NAME is required");

const VALID_GRANTEE_TYPES = ["person", "role", "org", "public"];
const VALID_PERMISSIONS = ["view", "edit", "admin"];

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const body = JSON.parse(event.body ?? "{}");
    const { grantee_type, grantee_id, permission } = body;

    if (!grantee_type || !grantee_id || !permission) {
      return err("grantee_type, grantee_id, and permission are required", 400);
    }

    if (!VALID_GRANTEE_TYPES.includes(grantee_type)) {
      return err(
        `grantee_type must be one of: ${VALID_GRANTEE_TYPES.join(", ")}`,
        400,
      );
    }

    if (!VALID_PERMISSIONS.includes(permission)) {
      return err(
        `permission must be one of: ${VALID_PERMISSIONS.join(", ")}`,
        400,
      );
    }

    // Verify document exists
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    // Only owner or admin can share/change permissions
    const user = extractUser(event);
    if (!canModifyDocument(user, docResult.Item)) {
      return err("You can only manage sharing for your own documents", 403);
    }

    if (docResult.Item.source_provider !== "manual") {
      return err("Sharing is only supported for manually uploaded documents. Please manage permissions in the source provider directly.", 400);
    }

    const personId =
      (event as unknown as Record<string, unknown>).requestContext &&
      ((event as unknown as Record<string, Record<string, Record<string, string>>>)
        .requestContext?.authorizer?.claims?.sub ?? "system");

    const accessRecord = {
      access_id: randomUUID(),
      document_id: documentId,
      grantee_type,
      grantee_id,
      permission,
      granted_by: personId,
      granted_at: new Date().toISOString(),
    };

    await ddbClient.send(
      new PutCommand({
        TableName: ACCESS_TABLE,
        Item: accessRecord,
      }),
    );

    return ok(accessRecord, 201);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sharing document:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
