import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const BUCKET = process.env.DOCUMENT_BUCKET_NAME;
const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!BUCKET) throw new Error("DOCUMENT_BUCKET_NAME is required");
if (!TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");

const s3 = new S3Client({});

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const body = JSON.parse(event.body ?? "{}");
    const fileName: string | undefined = body.fileName;
    const contentType: string | undefined = body.contentType;

    if (!fileName || !contentType) {
      return err("fileName and contentType are required", 400);
    }

    // Verify document exists
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const sanitizedName = fileName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_");
    // Folder: {ownerEmail}/{docSlug}_{shortId}/v{n}_{filename}
    const ownerFolder = (docResult.Item.owner_email as string ?? docResult.Item.org_id as string)
      .toLowerCase()
      .replace(/[^a-z0-9@._-]/g, "");
    const docSlug = ((docResult.Item.slug as string) ?? "").split("/").pop() ?? "doc";
    const shortId = documentId.slice(0, 8);
    const s3Key = `${ownerFolder}/${docSlug}_${shortId}/v${(docResult.Item.current_version as number) + 1}_${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: contentType,
      Metadata: {
        "original-filename": encodeURIComponent(fileName),
        "document-id": documentId,
      },
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return ok({
      upload_url: uploadUrl,
      s3_key: s3Key,
      expires_in_seconds: 900,
      max_size_bytes: MAX_SIZE_BYTES,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error generating upload URL:", error);
    return err("Failed to generate upload URL", 500);
  }
};

export const handler = withPermissions(_handler);
