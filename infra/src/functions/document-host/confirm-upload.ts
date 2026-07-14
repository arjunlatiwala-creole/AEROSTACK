import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const BUCKET = process.env.DOCUMENT_BUCKET_NAME;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME;

if (!BUCKET) throw new Error("DOCUMENT_BUCKET_NAME is required");
if (!DOCS_TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");
if (!VERSIONS_TABLE) throw new Error("DOCUMENT_VERSIONS_TABLE_NAME is required");

const s3 = new S3Client({});

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const body = JSON.parse(event.body ?? "{}");
    const { s3_key, original_filename } = body;

    if (!s3_key) {
      return err("s3_key is required", 400);
    }

    // Verify the file exists in S3
    const headResult = await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: s3_key,
      }),
    );

    // Get current document to determine next version number
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const nextVersion = (docResult.Item.current_version as number) + 1;
    const now = new Date().toISOString();

    const claims = (event as unknown as { requestContext?: { authorizer?: { claims?: Record<string, string> } } })
      .requestContext?.authorizer?.claims;
    let personId = claims?.sub ?? "system";
    let personEmail = claims?.email ?? "system";

    // SAM local: decode JWT manually
    if (personEmail === "system" && process.env.AWS_SAM_LOCAL === "true") {
      const token = (event.headers?.Authorization ?? event.headers?.authorization ?? "").replace("Bearer ", "");
      if (token) {
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
            personId = payload.sub ?? personId;
            personEmail = payload.email ?? personEmail;
          }
        } catch { /* ignore */ }
      }
    }

    // Create version record
    const version = {
      document_id: documentId,
      version_number: nextVersion,
      s3_key,
      s3_version_id: headResult.VersionId ?? "",
      file_size_bytes: headResult.ContentLength ?? 0,
      content_hash: headResult.ETag?.replace(/"/g, "") ?? "",
      original_filename: original_filename ?? s3_key.split("/").pop() ?? "file",
      imported_at: now,
      imported_by: personEmail,
    };

    await ddbClient.send(
      new PutCommand({
        TableName: VERSIONS_TABLE,
        Item: version,
      }),
    );

    // Update document's current_version
    await ddbClient.send(
      new UpdateCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
        UpdateExpression:
          "SET current_version = :v, updated_at = :now",
        ExpressionAttributeValues: {
          ":v": nextVersion,
          ":now": now,
        },
      }),
    );

    return ok({ version, document_id: documentId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error confirming upload:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
