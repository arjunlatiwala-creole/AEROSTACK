import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand, UpdateCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { createHash } from "node:crypto";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME!;
const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME!;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;
const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME!;

const s3 = new S3Client({});
const secretsManager = new SecretsManagerClient({});

/**
 * Maps Google Workspace MIME types to their best export format.
 * Google Docs/Sheets/Slides are cloud-native and must be exported.
 * We export to Office formats (docx/xlsx/pptx) to preserve editability.
 */
const GOOGLE_DOC_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
  },
  "application/vnd.google-apps.drawing": {
    mime: "image/svg+xml",
    ext: "svg",
  },
  "application/vnd.google-apps.form": {
    mime: "application/pdf",
    ext: "pdf",
  },
};

/**
 * Editor "export" host path per Google app. Unlike the Drive API's
 * files.export (hard-capped at 10MB), the editor export host
 * (docs.google.com/.../export) handles much larger files and accepts the
 * same OAuth Bearer token. Used as a fallback for files over the API cap.
 */
const GOOGLE_EDITOR_HOST: Record<string, string> = {
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.spreadsheet": "spreadsheets",
  "application/vnd.google-apps.presentation": "presentation",
  "application/vnd.google-apps.drawing": "drawings",
};

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface SyncResult {
  success: boolean;
  version_number?: number;
  error?: string;
  skipped?: boolean;
}

/**
 * Fetches a file from Google Drive using the service account credentials
 * and uploads it to S3 as a new version.
 */
export async function syncFromDrive(
  document: Record<string, unknown>,
): Promise<SyncResult> {
  const documentId = document.document_id as string;
  const sourceId = document.source_id as string;
  const ownerEmail = (document.owner_email as string) ?? (document.org_id as string);

  console.log(`[SYNC-DRIVE] Starting sync for document=${documentId}, sourceId=${sourceId}, owner=${ownerEmail}`);

  if (!sourceId) {
    console.error(`[SYNC-DRIVE] No source_id on document ${documentId}, aborting`);
    return { success: false, error: "No source_id on document" };
  }

  try {
    // 1. Get service account credentials from Secrets Manager
    console.log(`[SYNC-DRIVE] Fetching service account credentials from Secrets Manager: ${GOOGLE_DRIVE_SA_SECRET_NAME}`);
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
    );
    const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
    console.log(`[SYNC-DRIVE] Service account loaded: ${saKey.client_email}`);

    // 2. Get access token using service account JWT (impersonate file owner for domain-wide delegation)
    console.log(`[SYNC-DRIVE] Requesting OAuth2 access token (impersonating ${ownerEmail})...`);
    const accessToken = await getAccessToken(saKey, ownerEmail);
    console.log(`[SYNC-DRIVE] Access token obtained successfully`);

    // 3. Get file metadata from Drive
    console.log(`[SYNC-DRIVE] Fetching file metadata from Drive for fileId=${sourceId}`);
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${sourceId}?fields=name,mimeType,modifiedTime,size`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      console.error(`[SYNC-DRIVE] Metadata fetch FAILED: status=${metaRes.status}, response=${errText}`);
      return { success: false, error: `Drive metadata fetch failed: ${metaRes.status} ${errText}` };
    }

    const meta = (await metaRes.json()) as {
      name: string;
      mimeType: string;
      modifiedTime: string;
      size: string;
    };
    console.log(`[SYNC-DRIVE] File metadata: name="${meta.name}", mimeType=${meta.mimeType}, modifiedTime=${meta.modifiedTime}, size=${meta.size}`);

    // 4. Download file content
    const isGoogleDoc = meta.mimeType.startsWith("application/vnd.google-apps.");
    let contentType: string;
    let chosenExt = "";
    let fileBuffer: Buffer;

    if (isGoogleDoc) {
      // Google Docs are cloud-native — must be exported to a real file format.
      const exportFormat = GOOGLE_DOC_EXPORT_MAP[meta.mimeType] ?? {
        mime: "application/pdf",
        ext: "pdf",
      };
      console.log(`[SYNC-DRIVE] Google Doc detected (${meta.mimeType}) — exporting as ${exportFormat.ext}`);

      const exported = await exportGoogleDoc(sourceId, meta.mimeType, exportFormat, accessToken);
      if (!exported) {
        return {
          success: false,
          error:
            "This Google file is too large to export. Google's export endpoints have size limits even for PDF. Open it in Drive and download/split it manually.",
        };
      }
      fileBuffer = exported.buffer;
      contentType = exported.mime;
      chosenExt = exported.ext;
      console.log(`[SYNC-DRIVE] Export succeeded via ${exported.via} as ${chosenExt}: ${fileBuffer.length} bytes`);
    } else {
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${sourceId}?alt=media`;
      contentType = meta.mimeType;
      console.log(`[SYNC-DRIVE] Regular file — downloading directly as ${contentType}`);
      const fileRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!fileRes.ok) {
        const errText = await fileRes.text();
        console.error(`[SYNC-DRIVE] File download FAILED: status=${fileRes.status}, response=${errText}`);
        return { success: false, error: `Drive file download failed: ${fileRes.status} ${errText}` };
      }
      fileBuffer = Buffer.from(await fileRes.arrayBuffer());
    }

    console.log(`[SYNC-DRIVE] File downloaded successfully: ${fileBuffer.length} bytes`);

    // 5. Compute SHA-256 hash
    const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
    console.log(`[SYNC-DRIVE] Content hash: ${contentHash}`);

    // 6. Compare to current version — skip if unchanged
    // For Google Docs: use modifiedTime (docx export produces different bytes each time)
    // For regular files: use content hash (reliable binary comparison)
    const currentVersion = document.current_version as number;
    const storedModifiedAt = document.source_modified_at as string | undefined;

    if (currentVersion > 0) {
      let isUnchanged: boolean;

      if (isGoogleDoc) {
        // Compare as timestamps to avoid string format mismatches (milliseconds, timezone)
        const storedTime = storedModifiedAt ? new Date(storedModifiedAt).getTime() : 0;
        const driveTime = new Date(meta.modifiedTime).getTime();
        isUnchanged = storedTime >= driveTime;
        if (isUnchanged) {
          console.log(`[SYNC-DRIVE] File unchanged (modifiedTime: stored=${storedModifiedAt}, drive=${meta.modifiedTime}), syncing permissions only`);
        } else {
          console.log(`[SYNC-DRIVE] File changed! stored=${storedModifiedAt}, drive=${meta.modifiedTime}`);
        }
      } else {
        isUnchanged = document.content_hash === contentHash;
        if (isUnchanged) {
          console.log(`[SYNC-DRIVE] File unchanged (hash match), syncing permissions only`);
        }
      }

      if (isUnchanged) {
        await syncPermissionsFromDrive(documentId, sourceId, accessToken);
        return { success: true, skipped: true, version_number: currentVersion };
      }
    }

    // 7. Upload to S3
    const nextVersion = currentVersion + 1;
    const sanitizedName = (isGoogleDoc ? `${meta.name}.${chosenExt}` : meta.name)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_");
    const ownerFolder = ownerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    // Use doc slug + short ID for readable folder name
    const docSlug = ((document.slug as string) ?? "").split("/").pop() ?? "doc";
    const shortId = documentId.slice(0, 8);
    const s3Key = `${ownerFolder}/${docSlug}_${shortId}/v${nextVersion}_${sanitizedName}`;

    console.log(`[SYNC-DRIVE] Uploading to S3: bucket=${BUCKET}, key=${s3Key}, size=${fileBuffer.length} bytes`);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType,
        Metadata: {
          "original-filename": encodeURIComponent(meta.name),
          "document-id": documentId,
          "source-modified": meta.modifiedTime,
        },
      }),
    );
    console.log(`[SYNC-DRIVE] S3 upload complete`);

    // 8. Create version record
    const now = new Date().toISOString();
    const filenameWithExt = isGoogleDoc
      ? `${meta.name}.${chosenExt}`
      : meta.name;
    console.log(`[SYNC-DRIVE] Creating version record: document=${documentId}, version=${nextVersion}`);
    await ddbClient.send(
      new PutCommand({
        TableName: VERSIONS_TABLE,
        Item: {
          document_id: documentId,
          version_number: nextVersion,
          s3_key: s3Key,
          s3_version_id: "",
          file_size_bytes: fileBuffer.length,
          content_hash: contentHash,
          original_filename: filenameWithExt,
          source_modified_at: meta.modifiedTime,
          imported_at: now,
          imported_by: "sync-agent",
        },
      }),
    );
    console.log(`[SYNC-DRIVE] Version record created in DynamoDB`);

    // 9. Update document current_version + mime_type
    console.log(`[SYNC-DRIVE] Updating document record: current_version → ${nextVersion}`);
    await ddbClient.send(
      new UpdateCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
        UpdateExpression:
          "SET current_version = :v, updated_at = :now, mime_type = :mt, content_hash = :ch, source_modified_at = :sma",
        ExpressionAttributeValues: {
          ":v": nextVersion,
          ":now": now,
          ":mt": contentType,
          ":ch": contentHash,
          ":sma": meta.modifiedTime,
        },
      }),
    );

    console.log(`[SYNC-DRIVE] ✅ Sync complete: document=${documentId}, version=${nextVersion}, file="${meta.name}", size=${fileBuffer.length} bytes`);

    // 10. Sync permissions from Drive
    await syncPermissionsFromDrive(documentId, sourceId, accessToken);

    return { success: true, version_number: nextVersion };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[SYNC-DRIVE] ❌ Sync FAILED for document=${documentId}:`, error);
    return { success: false, error: message };
  }
}

/**
 * Reads permissions from Google Drive and syncs them to our document-access table.
 * Maps Drive permission types to our visibility model:
 *   - "anyone" / "anyoneWithLink" → visibility = "public"
 *   - "domain" → visibility = "internal"
 *   - "user" / "group" → visibility = "restricted" + add to access table
 */
async function syncPermissionsFromDrive(
  documentId: string,
  sourceId: string,
  accessToken: string,
): Promise<void> {
  try {
    console.log(`[SYNC-DRIVE] Fetching permissions from Drive for fileId=${sourceId}`);

    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${sourceId}/permissions?fields=permissions(id,type,role,emailAddress,domain)`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!permRes.ok) {
      console.warn(`[SYNC-DRIVE] Failed to fetch permissions: ${permRes.status}`);
      return;
    }

    const permData = (await permRes.json()) as {
      permissions: Array<{
        id: string;
        type: string; // "user" | "group" | "domain" | "anyone"
        role: string; // "owner" | "writer" | "commenter" | "reader"
        emailAddress?: string;
        domain?: string;
      }>;
    };

    console.log(`[SYNC-DRIVE] Found ${permData.permissions.length} permission(s)`);
    console.log(`[SYNC-DRIVE] Raw permissions:`, JSON.stringify(permData.permissions, null, 2));

    // Determine visibility from permissions
    let visibility: "public" | "internal" | "restricted" = "restricted";
    const userEmails: Array<{ email: string; permission: string }> = [];

    for (const perm of permData.permissions) {
      console.log(`[SYNC-DRIVE] Permission: type=${perm.type}, role=${perm.role}, email=${perm.emailAddress ?? "n/a"}, domain=${perm.domain ?? "n/a"}`);

      if (perm.type === "anyone") {
        console.log(`[SYNC-DRIVE]   → Mapping to PUBLIC (anyone with link)`);
        visibility = "public";
      } else if (perm.type === "domain") {
        console.log(`[SYNC-DRIVE]   → Mapping to INTERNAL (domain: ${perm.domain})`);
        if (visibility !== "public") visibility = "internal";
      } else if (perm.type === "user" && perm.emailAddress && perm.role !== "owner") {
        // Skip the service account itself
        if (perm.emailAddress.includes("iam.gserviceaccount.com")) {
          console.log(`[SYNC-DRIVE]   → Skipping service account: ${perm.emailAddress}`);
          continue;
        }
        console.log(`[SYNC-DRIVE]   → Adding user grant: ${perm.emailAddress} (${perm.role})`);
        userEmails.push({
          email: perm.emailAddress.toLowerCase(),
          permission: perm.role === "writer" ? "edit" : "view",
        });
      } else if (perm.type === "group" && perm.emailAddress) {
        console.log(`[SYNC-DRIVE]   → Adding group grant: ${perm.emailAddress} (${perm.role})`);
        userEmails.push({
          email: perm.emailAddress.toLowerCase(),
          permission: perm.role === "writer" ? "edit" : "view",
        });
      } else if (perm.type === "user" && perm.role === "owner") {
        console.log(`[SYNC-DRIVE]   → Skipping owner: ${perm.emailAddress}`);
      }
    }

    console.log(`[SYNC-DRIVE] Final visibility determination: ${visibility}, user grants: ${userEmails.length}`);

    // Update document visibility
    console.log(`[SYNC-DRIVE] Setting visibility=${visibility} for document=${documentId}`);
    await ddbClient.send(
      new UpdateCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
        UpdateExpression: "SET visibility = :v",
        ExpressionAttributeValues: { ":v": visibility },
      }),
    );

    // Clear existing access records for this document (from drive sync)
    const existingAccess = await ddbClient.send(
      new QueryCommand({
        TableName: ACCESS_TABLE,
        KeyConditionExpression: "document_id = :did",
        FilterExpression: "granted_by = :gb",
        ExpressionAttributeValues: {
          ":did": documentId,
          ":gb": "drive-sync",
        },
      }),
    );

    if (existingAccess.Items) {
      for (const item of existingAccess.Items) {
        await ddbClient.send(
          new DeleteCommand({
            TableName: ACCESS_TABLE,
            Key: {
              document_id: documentId,
              access_id: item.access_id as string,
            },
          }),
        );
      }
    }

    // Add new access records for each user
    const { randomUUID } = await import("node:crypto");
    const now = new Date().toISOString();

    for (const user of userEmails) {
      await ddbClient.send(
        new PutCommand({
          TableName: ACCESS_TABLE,
          Item: {
            access_id: randomUUID(),
            document_id: documentId,
            grantee_type: "person",
            grantee_id: user.email,
            permission: user.permission,
            granted_by: "drive-sync",
            granted_at: now,
          },
        }),
      );
    }

    console.log(`[SYNC-DRIVE] Permissions synced: visibility=${visibility}, ${userEmails.length} user grant(s)`);
  } catch (error) {
    console.warn(`[SYNC-DRIVE] Permission sync failed (non-fatal):`, error);
  }
}

/**
 * Exports a Google-native file (Doc/Sheet/Slides/Drawing) trying multiple
 * strategies to get around the Drive API's 10MB files.export cap:
 *
 *   1. Drive API export → native Office format (docx/xlsx/pptx)   [<=10MB]
 *   2. Editor host export → native Office format                  [large files]
 *   3. Editor host export → PDF                                   [large files]
 *   4. Drive API export → PDF                                     [<=10MB]
 *
 * The editor host (docs.google.com/<app>/export) is not part of the documented
 * Drive API and has far higher size limits. It accepts the same OAuth token.
 * Returns null only when every strategy fails.
 */
async function exportGoogleDoc(
  sourceId: string,
  mimeType: string,
  officeFormat: { mime: string; ext: string },
  accessToken: string,
): Promise<{ buffer: Buffer; mime: string; ext: string; via: string } | null> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const editorApp = GOOGLE_EDITOR_HOST[mimeType];

  type Attempt = { url: string; mime: string; ext: string; via: string };
  const attempts: Attempt[] = [];

  // 1. Drive API — native Office format (capped at 10MB, but cleanest output)
  attempts.push({
    url: `https://www.googleapis.com/drive/v3/files/${sourceId}/export?mimeType=${encodeURIComponent(officeFormat.mime)}`,
    mime: officeFormat.mime,
    ext: officeFormat.ext,
    via: "drive-api-office",
  });

  // 2. Editor host — native Office format (handles large files)
  if (editorApp && officeFormat.ext !== "svg") {
    attempts.push({
      url: `https://docs.google.com/${editorApp}/d/${sourceId}/export?format=${officeFormat.ext}`,
      mime: officeFormat.mime,
      ext: officeFormat.ext,
      via: "editor-host-office",
    });
  }

  // 3. Editor host — PDF (handles large files)
  if (editorApp) {
    attempts.push({
      url: `https://docs.google.com/${editorApp}/d/${sourceId}/export?format=pdf`,
      mime: "application/pdf",
      ext: "pdf",
      via: "editor-host-pdf",
    });
  }

  // 4. Drive API — PDF (capped at 10MB, last resort)
  if (officeFormat.ext !== "pdf") {
    attempts.push({
      url: `https://www.googleapis.com/drive/v3/files/${sourceId}/export?mimeType=application/pdf`,
      mime: "application/pdf",
      ext: "pdf",
      via: "drive-api-pdf",
    });
  }

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: auth, redirect: "follow" });
      if (!res.ok) {
        const body = await res.text();
        const tooLarge = body.includes("exportSizeLimitExceeded") || res.status === 403;
        console.warn(`[SYNC-DRIVE] export via ${attempt.via} failed: ${res.status}${tooLarge ? " (size/permission)" : ""}`);
        continue;
      }

      const ct = res.headers.get("content-type") ?? "";
      // Editor host returns HTML (a login/error page) when the token isn't
      // accepted — guard against saving that as if it were the document.
      if (ct.includes("text/html")) {
        console.warn(`[SYNC-DRIVE] export via ${attempt.via} returned HTML, skipping`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 100) {
        console.warn(`[SYNC-DRIVE] export via ${attempt.via} returned ${buffer.length} bytes, skipping`);
        continue;
      }

      return { buffer, mime: attempt.mime, ext: attempt.ext, via: attempt.via };
    } catch (e) {
      console.warn(`[SYNC-DRIVE] export via ${attempt.via} threw:`, e);
    }
  }

  return null;
}

/**
 * Gets an OAuth2 access token using the service account's private key (JWT grant).
 * When impersonateEmail is provided, uses domain-wide delegation to act as that user.
 */
async function getAccessToken(saKey: ServiceAccountKey, impersonateEmail?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");

  const claims: Record<string, unknown> = {
    iss: saKey.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: saKey.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // Domain-wide delegation: impersonate the file owner so the SA can access their files
  if (impersonateEmail) {
    claims.sub = impersonateEmail;
  }

  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(saKey.private_key, "base64url");

  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch(saKey.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error(`[SYNC-DRIVE] Token exchange FAILED: status=${tokenRes.status}, response=${errBody}`);
    throw new Error(`Token exchange failed: ${tokenRes.status} ${errBody}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}
