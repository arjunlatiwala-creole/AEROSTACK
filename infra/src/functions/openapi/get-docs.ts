import { APIGatewayProxyHandler } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";

const s3Client = new S3Client({});

/**
 * Convert a Readable stream to a string
 */
const streamToString = async (stream: Readable): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });

const _getDocs: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("getDocs");

  try {
    const authResult = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(authResult)) return authResult.error;

    const { user } = authResult;
    logger.info(`getDocs accessed by role=${user.role}`);

    const bucket = process.env.OPENAPI_BUCKET;
    const key = process.env.OPENAPI_KEY ?? "openapi-dev.json";

    if (!bucket) {
      logger.error("OpenAPI_BUCKET env var is not set");
      return err("OpenAPI bucket not configured", 500);
    }

    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!response.Body) {
      return err("Document not found", 404);
    }

    const body = await streamToString(response.Body as Readable);
    const parsed = JSON.parse(body);

    return ok(parsed);

  } catch (error: any) {
    logger.error("getDocs error:", error);
    return err(error.message || "Internal Server Error");
  }
};
export const getDocs = withPermissions(_getDocs);
