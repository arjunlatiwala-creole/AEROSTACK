/**
 * GET /documents/{documentId}/sign/envelopes/{envelopeId}/signed-download
 *
 * Returns short-lived presigned S3 URLs for:
 *   - the Aerostack-signed PDF (signed_pdf_key)
 *   - the Dropbox audit-trail certificate (certificate_key)
 *
 * Self-healing certificate path:
 *   When `certifyWithDropboxSign` runs at the end of the Aerostack signing flow,
 *   it writes a PLACEHOLDER cert (the last page of the Aerostack-stamped PDF) and
 *   marks `certificate_source = "placeholder"`. The real Dropbox audit trail
 *   is supposed to land here when the witness signs and the webhook fires.
 *   If the webhook never fires (URL not registered, network drop, retry
 *   storm), this endpoint detects the placeholder, polls Dropbox Sign for
 *   the witness request status, and — if it's signed — downloads the real
 *   audit trail and swaps it in before returning the URL.
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { extractUser } from "./doc-auth";
import AdmZip from "adm-zip";

const ENVELOPES_TABLE = process.env.DOCUSIGN_ENVELOPES_TABLE!;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL;

const s3Client = new S3Client({});
const smClient = new SecretsManagerClient({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const user = extractUser(event);
    const documentId = event.pathParameters?.documentId;
    const envelopeId = event.pathParameters?.envelopeId;
    if (!documentId || !envelopeId) {
      return err("documentId and envelopeId are required", 400);
    }

    // ?download=1 forces Content-Disposition: attachment so the browser
    // downloads instead of opening the PDF inline. Cross-origin presigned
    // URLs ignore the <a download> attribute, so we have to set it here.
    const forceDownload = event.queryStringParameters?.download === "1";

    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    );
    const envelope = envRes.Item;
    if (!envelope || envelope.document_id !== documentId) {
      return err("Envelope not found", 404);
    }

    // Authorization: doc owner, admin, or one of the signers
    const docRes = await ddbClient.send(
      new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: documentId } }),
    );
    const doc = docRes.Item;
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = doc?.owner_email?.toLowerCase() === user.email.toLowerCase();
    const isSigner = ((envelope.signers as Array<{ email: string }>) ?? []).some(
      (s) => s.email.toLowerCase() === user.email.toLowerCase(),
    );
    if (!isAdmin && !isOwner && !isSigner) {
      return err("Access denied", 403);
    }

    const signedKey = envelope.signed_pdf_key as string | undefined;
    let certKey = envelope.certificate_key as string | undefined;
    const certSource = envelope.certificate_source as string | undefined;
    const dropboxRequestId = envelope.dropbox_signature_request_id as string | undefined;

    if (!signedKey) {
      return err("Signed document not yet available — envelope may still be in progress.", 404);
    }

    // Self-heal: try Dropbox if we don't have a real Dropbox cert yet.
    //   - placeholder/legacy envelopes (certificate_source !== "dropbox")
    //   - missing certificate_key (witness webhook never fired)
    let certIsReal = certSource === "dropbox" && Boolean(certKey);
    const needsRefresh =
      !certIsReal && Boolean(dropboxRequestId) && Boolean(DS_API_KEY_SECRET) && Boolean(DS_BASE_URL);
    if (needsRefresh && dropboxRequestId) {
      try {
        const refreshedKey = await tryRefreshFromDropbox({
          envelopeId,
          documentId,
          dropboxRequestId,
        });
        if (refreshedKey) {
          certKey = refreshedKey;
          certIsReal = true;
        }
      } catch (refreshErr) {
        console.warn("[GET-SIGNED-DOWNLOAD-URL] Dropbox refresh failed:", refreshErr);
      }
    }

    // 5 minute expiry — long enough to view but tight enough that copied
    // links from logs / browser history go stale quickly.
    //
    // When `forceDownload` is set, we tell S3 to override the response
    // Content-Disposition header so the browser saves the file instead of
    // rendering it inline. Cross-origin presigned URLs ignore the <a download>
    // HTML attribute, so this is the only way to force a download.
    const safeTitle = ((doc?.title as string | undefined) ?? "signed").replace(/[^A-Za-z0-9._-]+/g, "_") || "signed";
    const signedDispositionFilename = `${safeTitle}-signed.pdf`;
    const certDispositionFilename = `${safeTitle}-certificate.pdf`;

    const signed_pdf_url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: signedKey,
        ...(forceDownload && {
          ResponseContentDisposition: `attachment; filename="${signedDispositionFilename}"`,
        }),
      }),
      { expiresIn: 300 },
    );

    // Only serve the cert URL when it's a real Dropbox-issued audit trail.
    // No placeholder, no Aerostack audit page — the button stays hidden until
    // Dropbox actually has the cert.
    const certificate_url = certIsReal && certKey
      ? await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: BUCKET,
            Key: certKey,
            ...(forceDownload && {
              ResponseContentDisposition: `attachment; filename="${certDispositionFilename}"`,
            }),
          }),
          { expiresIn: 300 },
        )
      : null;

    return ok({
      envelope_id: envelopeId,
      signed_pdf_url,
      signed_pdf_sha256: envelope.signed_pdf_sha256 ?? null,
      certificate_url,
      completed_at: envelope.completed_at ?? null,
      expires_in_seconds: 300,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET-SIGNED-DOWNLOAD-URL] Error:", error);
    return err(message, 500);
  }
};

/**
 * Pulls the latest Dropbox audit trail and stores it as certificate.pdf in S3.
 *
 * Dropbox builds the "Audit Trail.pdf" continuously across the life of a
 * signature request — it shows "Pending" for unsigned recipients and the
 * real Document ID at the top from day one. We pull it on every download
 * request so the cert reflects the current Dropbox state, even if the
 * request hasn't been signed by the witness yet. Once the request hits
 * `is_complete`, the cert gets locked in by the webhook.
 *
 * Returns the cert S3 key on success, null when Dropbox has nothing to give
 * (e.g. 409 "files preparing" right after creation).
 */
async function tryRefreshFromDropbox(opts: {
  envelopeId: string;
  documentId: string;
  dropboxRequestId: string;
}): Promise<string | null> {
  const apiKey = await getDropboxApiKey();
  const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

  // Download the zip and extract the audit trail. We don't gate on
  // is_complete — Dropbox includes the audit trail in the zip from the
  // moment the request is built, with "Pending" rows for unsigned signers.
  const zipRes = await fetch(
    `${DS_BASE_URL}/signature_request/files/${opts.dropboxRequestId}?file_type=zip`,
    { headers: { Authorization: `Basic ${basicAuth}` } },
  );
  if (!zipRes.ok) {
    // 409 = Dropbox is still preparing files; anything else is a hard error.
    console.warn(
      `[GET-SIGNED-DOWNLOAD-URL] Dropbox zip not available yet for ${opts.dropboxRequestId}: ${zipRes.status}`,
    );
    return null;
  }
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const auditTrail = extractAuditTrailFromZip(zipBuf);
  if (!auditTrail) {
    console.warn(
      `[GET-SIGNED-DOWNLOAD-URL] No "Audit Trail.pdf" entry in zip for ${opts.dropboxRequestId}`,
    );
    return null;
  }

  const certKey = `signed/${opts.documentId}/${opts.envelopeId}/certificate.pdf`;
  const now = new Date().toISOString();
  const retainUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000); // 10 years

  const basePut = {
    Bucket: BUCKET,
    Key: certKey,
    Body: auditTrail,
    ContentType: "application/pdf",
    Metadata: {
      envelope_id: opts.envelopeId,
      document_id: opts.documentId,
      dropbox_signature_request_id: opts.dropboxRequestId,
      signed_at: now,
      source: "self-heal",
    },
  };
  try {
    await s3Client.send(
      new PutObjectCommand({
        ...basePut,
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntil,
      }),
    );
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name ?? "";
    const msg = (e as { message?: string })?.message ?? "";
    if (name === "InvalidRequest" && msg.includes("ObjectLockConfiguration")) {
      await s3Client.send(new PutObjectCommand(basePut));
    } else {
      throw e;
    }
  }

  await ddbClient.send(
    new UpdateCommand({
      TableName: ENVELOPES_TABLE,
      Key: { envelope_id: opts.envelopeId },
      UpdateExpression:
        "SET certificate_stored = :t, certificate_key = :ck, certificate_source = :src, dropbox_certificate_received_at = :ca, updated_at = :now",
      ExpressionAttributeValues: {
        ":t": true,
        ":ck": certKey,
        ":src": "dropbox",
        ":ca": now,
        ":now": now,
      },
    }),
  );

  console.log(
    `[GET-SIGNED-DOWNLOAD-URL] Self-healed cert for envelope ${opts.envelopeId} from Dropbox request ${opts.dropboxRequestId}`,
  );
  return certKey;
}

async function getDropboxApiKey(): Promise<string> {
  const res = await smClient.send(new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET! }));
  return res.SecretString!.trim();
}

function extractAuditTrailFromZip(zipBuffer: Buffer): Buffer | null {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".pdf"));
    const audit = entries.find((e) => {
      const base = e.entryName.split("/").pop() ?? e.entryName;
      return /audit[\s_-]*trail/i.test(base);
    });
    return audit ? audit.getData() : null;
  } catch (err) {
    console.error("[GET-SIGNED-DOWNLOAD-URL] Failed to parse zip:", err);
    return null;
  }
}
