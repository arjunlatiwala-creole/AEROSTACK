import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, err } from "../shared/response";
import { randomUUID } from "node:crypto";

const BUCKET = process.env.HIRING_RESUME_BUCKET_NAME;

if (!BUCKET) {
    throw new Error("HIRING_RESUME_BUCKET_NAME is required");
}

const s3 = new S3Client({});

const ALLOWED_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * Public endpoint — returns a presigned S3 PUT URL for resume upload.
 * The frontend uploads directly to S3 using this URL.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const body = JSON.parse(event.body ?? "{}");
        const fileName: string | undefined = body.fileName;
        const contentType: string | undefined = body.contentType;
        const candidateEmail: string | undefined = body.email;

        if (!fileName || !contentType) {
            return err("fileName and contentType are required", 400);
        }

        if (!ALLOWED_TYPES.includes(contentType)) {
            return err("Only PDF and Word documents are accepted", 400);
        }

        const ext = fileName.split(".").pop()?.toLowerCase() ?? "pdf";
        const s3Key = `resumes/${candidateEmail ?? "unknown"}/${randomUUID()}.${ext}`;

        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: s3Key,
            ContentType: contentType,
            Metadata: {
                "original-filename": encodeURIComponent(fileName),
                "candidate-email": candidateEmail ?? "unknown",
            },
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return ok({ uploadUrl, s3Key, maxSizeBytes: 3 * 1024 * 1024 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error generating upload URL:", error);
        return err("Failed to generate upload URL", 500);
    }
};
