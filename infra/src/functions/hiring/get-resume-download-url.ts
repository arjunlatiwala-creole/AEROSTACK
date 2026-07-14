import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const BUCKET = process.env.HIRING_RESUME_BUCKET_NAME;

if (!BUCKET) {
    throw new Error("HIRING_RESUME_BUCKET_NAME is required");
}

const s3 = new S3Client({});

/**
 * Authenticated endpoint — generates a presigned GET URL for a candidate's resume.
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const s3Key = event.queryStringParameters?.s3Key;
        if (!s3Key) {
            return err("s3Key query parameter is required", 400);
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET,
            Key: s3Key,
        });

        const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return ok({ downloadUrl });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Error generating download URL:", error);
        return err("Failed to generate download URL", 500);
    }
};

export const handler = withPermissions(_handler);
