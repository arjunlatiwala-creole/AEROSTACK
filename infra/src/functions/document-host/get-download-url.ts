import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

    const params = event.queryStringParameters ?? {};
    const versionParam = params.version;

    // Get document
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const targetVersion = versionParam
      ? Number(versionParam)
      : (docResult.Item.current_version as number);

    // Get version record
    const versionResult = await ddbClient.send(
      new GetCommand({
        TableName: VERSIONS_TABLE,
        Key: { document_id: documentId, version_number: targetVersion },
      }),
    );

    if (!versionResult.Item) {
      return err("Version not found", 404);
    }

    const s3Key = versionResult.Item.s3_key as string;
    const originalFilename = (versionResult.Item.original_filename as string) ??
      s3Key.split("/").pop() ?? "file";
    const docTitle = docResult.Item.title as string;
    const mimeType = (docResult.Item.mime_type as string) ?? "";

    // Extract extension from filename, or derive from mime_type as fallback
    const lastDot = originalFilename.lastIndexOf(".");
    let ext = lastDot > 0 ? originalFilename.slice(lastDot + 1) : "";

    if (!ext || ext.length > 10 || ext.includes(" ")) {
      // No valid extension in filename — derive from mime type
      ext = mimeToExt(mimeType);
    }

    const downloadName = `${docTitle}_v${targetVersion}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, "_");

    // mode=inline opens in browser, mode=attachment (default) triggers download
    const mode = params.mode === "inline" ? "inline" : "attachment";

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ResponseContentDisposition: `${mode}; filename="${downloadName}"`,
    });

    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return ok({
      download_url: downloadUrl,
      filename: downloadName,
      version_number: targetVersion,
      file_size_bytes: versionResult.Item.file_size_bytes,
      expires_in_seconds: 3600,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error generating download URL:", error);
    return err("Failed to generate download URL", 500);
  }
};

export const handler = withPermissions(_handler);


/** Maps common MIME types to file extensions */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
    "application/json": "json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/msword": "doc",
    "application/vnd.ms-excel": "xls",
    "application/zip": "zip",
  };
  return map[mime] ?? "bin";
}
