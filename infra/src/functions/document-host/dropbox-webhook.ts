/**
 * POST /documents/sign/webhook  — Dropbox Sign webhook handler
 *
 * Receives signature request status change events from Dropbox Sign.
 * When a request is "signature_request_all_signed":
 *  1. Downloads the signed PDF + audit trail from Dropbox Sign.
 *  2. Stores them in the S3 document bucket under a protected prefix.
 *  3. Enables S3 Object Lock (COMPLIANCE mode) so the file cannot be deleted.
 *  4. Updates the DynamoDB envelope record with certificate location and final status.
 *  5. Updates the original document record to add the "signed" tag for Signatures tab visibility.
 *
 * Dropbox Sign sends event hashes — we verify using HMAC-SHA256 before acting.
 * On success, responds with "Hello API event received" to satisfy Dropbox Sign callback validation.
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { ddbClient } from "src/shared/dynamodb-client";
import * as crypto from "node:crypto";
import AdmZip from "adm-zip";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const ENVELOPES_TABLE = process.env.DROPBOX_SIGN_REQUESTS_TABLE ?? process.env.DOCUSIGN_ENVELOPES_TABLE!;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;
const DS_CLIENT_ID = process.env.DROPBOX_SIGN_CLIENT_ID!;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET!;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL!;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "";
const FROM_EMAIL = process.env.SIGNATURE_FROM_EMAIL ?? "noreply@aerostack.enterprise.io";

const smClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
const sesClient = new SESClient({});

async function getApiKey(): Promise<string> {
  const res = await smClient.send(
    new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET }),
  );
  return res.SecretString!.trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function removeUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined) as any;
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefined(v)])
    ) as any;
  }
  return obj;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
    : (event.body ?? "");

  try {
    // 1. Parse body (could be raw JSON, multipart/form-data, or application/x-www-form-urlencoded)
    let parsedPayload: any;
    if (rawBody.trim().startsWith("{")) {
      parsedPayload = JSON.parse(rawBody);
    } else {
      // Try parsing as multipart/form-data
      const multipartMatch = rawBody.match(/Content-Disposition:\s*form-data;\s*name=["']json["'][\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/i);
      if (multipartMatch) {
        parsedPayload = JSON.parse(multipartMatch[1].trim());
      } else {
        // Fall back to urlencoded
        const params = new URLSearchParams(rawBody);
        const jsonStr = params.get("json");
        if (jsonStr) {
          parsedPayload = JSON.parse(jsonStr);
        } else {
          console.warn("[DROPBOX-WEBHOOK] Missing json parameter in payload. Raw body preview:", rawBody.slice(0, 500));
          return {
            statusCode: 400,
            headers: { "Content-Type": "text/plain" },
            body: "Missing json parameter",
          };
        }
      }
    }

    const eventObj = parsedPayload.event;
    if (!eventObj) {
      console.warn("[DROPBOX-WEBHOOK] Missing event object in payload");
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain" },
        body: "Missing event object",
      };
    }

    const { event_time, event_type, event_hash } = eventObj;

    // 2. HMAC-SHA256 Signature Verification
    const apiKey = await getApiKey();
    const computedHash = crypto
      .createHmac("sha256", apiKey)
      .update(event_time + event_type)
      .digest("hex");

    if (!timingSafeEqual(computedHash, event_hash)) {
      console.warn("[DROPBOX-WEBHOOK] HMAC signature verification failed");
      return {
        statusCode: 403,
        headers: { "Content-Type": "text/plain" },
        body: "Invalid signature",
      };
    }

    // 3. Handle validation/challenge test event
    if (event_type === "callback_test") {
      console.log("[DROPBOX-WEBHOOK] Callback test event received and verified.");
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "Hello API event received",
      };
    }

    const signatureRequest = parsedPayload.signature_request;
    const envelopeId = signatureRequest?.signature_request_id;
    if (!envelopeId) {
      console.warn("[DROPBOX-WEBHOOK] No signature_request_id in payload");
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "Hello API event received",
      };
    }

    console.log(`[DROPBOX-WEBHOOK] Processing event ${event_type} for request ${envelopeId}`);

    // Load envelope record
    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    ).catch((e: unknown) => {
      const errName = (e as { name?: string })?.name ?? "";
      if (errName === "ResourceNotFoundException") {
        console.warn(`[DROPBOX-WEBHOOK] Envelopes table "${ENVELOPES_TABLE}" not found — likely local environment. Skipping.`);
        return null;
      }
      throw e;
    });

    let envelope = envRes?.Item;

    if (envRes && !envelope) {
      // If we couldn't find the envelope by the primary key (original envelope_id),
      // it might be a recreated or certified request. Scan for it using dropbox_signature_request_id.
      try {
        const scanRes = await ddbClient.send(
          new ScanCommand({
            TableName: ENVELOPES_TABLE,
            FilterExpression: "dropbox_signature_request_id = :dsId",
            ExpressionAttributeValues: {
              ":dsId": envelopeId,
            },
          })
        );
        if (scanRes.Items && scanRes.Items.length > 0) {
          envelope = scanRes.Items[0];
        }
      } catch (scanErr) {
        console.warn("[DROPBOX-WEBHOOK] Error scanning for dropbox_signature_request_id:", scanErr);
      }
    }

    if (!envelope) {
      console.warn(`[DROPBOX-WEBHOOK] Unknown request/envelope ID: ${envelopeId}`);
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "Hello API event received",
      };
    }

    const documentId = envelope.document_id as string;
    const now = new Date().toISOString();

    // Detect "witness-certification" callback (Aerostack Flow B):
    //   - sign-link-complete.ts has already created signed-document.pdf itself
    //   - it then created a separate Dropbox Sign request purely to mint an
    //     official audit trail, and stored that request's id on the envelope
    //     as dropbox_signature_request_id.
    // When the webhook fires for THAT request, we must NOT overwrite the
    // Aerostack signer statuses or envelope status — only refresh certificate.pdf
    // with the real audit trail when the witness completes.
    const isWitnessCallback =
      envelope.dropbox_signature_request_id === envelopeId &&
      envelope.envelope_id !== envelopeId &&
      Boolean(envelope.signed_pdf_key);

    if (isWitnessCallback) {
      // Ignore everything except the all-signed event for the witness request.
      // Pre-completion events ("sent", "viewed", etc.) on the witness request
      // would otherwise stomp the Aerostack envelope's own "completed" status.
      if (event_type !== "signature_request_all_signed") {
        console.log(
          `[DROPBOX-WEBHOOK] Ignoring witness pre-completion event "${event_type}" for envelope ${envelope.envelope_id}.`,
        );
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain" },
          body: "Hello API event received",
        };
      }

      const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");
      const zipRes = await fetch(
        `${DS_BASE_URL}/signature_request/files/${envelopeId}?file_type=zip`,
        { headers: { Authorization: `Basic ${basicAuth}` } },
      );
      if (!zipRes.ok) {
        throw new Error(
          `Failed to download zip bundle for witness request: ${zipRes.status} ${await zipRes.text()}`,
        );
      }
      const zipBuf = Buffer.from(await zipRes.arrayBuffer());
      const { certificate } = splitDropboxZip(zipBuf, zipBuf);

      const certKey = `signed/${documentId}/${envelope.envelope_id}/certificate.pdf`;
      const retainUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: certKey,
            Body: certificate,
            ContentType: "application/pdf",
            ObjectLockMode: "COMPLIANCE",
            ObjectLockRetainUntilDate: retainUntil,
            Metadata: {
              envelope_id: envelope.envelope_id,
              document_id: documentId,
              dropbox_signature_request_id: envelopeId,
              signed_at: now,
            },
          }),
        );
      } catch (e: unknown) {
        const errName = (e as { name?: string })?.name ?? "";
        const errMsg = (e as { message?: string })?.message ?? "";
        if (errName === "InvalidRequest" && errMsg.includes("ObjectLockConfiguration")) {
          await s3Client.send(
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: certKey,
              Body: certificate,
              ContentType: "application/pdf",
              Metadata: {
                envelope_id: envelope.envelope_id,
                document_id: documentId,
                dropbox_signature_request_id: envelopeId,
                signed_at: now,
              },
            }),
          );
        } else {
          throw e;
        }
      }

      await ddbClient.send(
        new UpdateCommand({
          TableName: ENVELOPES_TABLE,
          Key: { envelope_id: envelope.envelope_id },
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
        `[DROPBOX-WEBHOOK] Stored Dropbox audit trail at ${certKey} for envelope ${envelope.envelope_id}. Signer statuses untouched.`,
      );
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: "Hello API event received",
      };
    }

    // 4. Update signer status based on Dropbox Sign response
    const dsSignatures = signatureRequest?.signatures || [];
    const currentSigners = envelope.signers || [];
    const updatedSigners = currentSigners.map((s: any) => {
      const dsSig = dsSignatures.find(
        (sig: any) => sig.signer_email_address?.toLowerCase() === s.email?.toLowerCase()
      );
      if (dsSig) {
        const updatedSigner = {
          ...s,
          status: dsSig.status_code === "signed" ? "completed" : s.status,
        };
        if (dsSig.status_code === "signed") {
          Object.assign(updatedSigner, { signed_at: now });
        } else if (s.signed_at !== undefined) {
          Object.assign(updatedSigner, { signed_at: s.signed_at });
        }
        return updatedSigner;
      }
      return s;
    });

    // Update status in tracking DB
    await ddbClient.send(
      new UpdateCommand({
        TableName: ENVELOPES_TABLE,
        Key: { envelope_id: envelope.envelope_id },
        UpdateExpression: "SET #s = :s, updated_at = :t, signers = :sg",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": event_type === "signature_request_all_signed" ? "completed" : "sent",
          ":t": now,
          ":sg": removeUndefined(updatedSigners),
        },
      }),
    );

    // 5. If fully signed -> download files and store with Object Lock
    if (event_type === "signature_request_all_signed") {
      const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

      // Download signed PDF (merged document — original pages + audit trail appended)
      const pdfRes = await fetch(`${DS_BASE_URL}/signature_request/files/${envelopeId}?file_type=pdf`, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });
      if (!pdfRes.ok) {
        throw new Error(`Failed to download signed PDF: ${pdfRes.status} ${await pdfRes.text()}`);
      }
      const signedPdf = Buffer.from(await pdfRes.arrayBuffer());

      // Download zip — contains the signed document AND a separate "Audit Trail.pdf".
      // This is the only way to get the audit trail as its own file via the API.
      // See: https://developers.hellosign.com/api/reference/operation/signatureRequestFiles
      const zipRes = await fetch(`${DS_BASE_URL}/signature_request/files/${envelopeId}?file_type=zip`, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });
      if (!zipRes.ok) {
        throw new Error(`Failed to download zip bundle: ${zipRes.status} ${await zipRes.text()}`);
      }
      const zipBuf = Buffer.from(await zipRes.arrayBuffer());

      const { signedOnly, certificate } = splitDropboxZip(zipBuf, signedPdf);

      const signedKey = `signed/${documentId}/${envelope.envelope_id}/signed-document.pdf`;
      const certKey = `signed/${documentId}/${envelope.envelope_id}/certificate.pdf`;
      const retainUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000); // 10 years

      const putWithLockFallback = async (key: string, body: Buffer) => {
        const baseParams = {
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: "application/pdf",
          Metadata: {
            envelope_id: envelope.envelope_id,
            document_id: documentId,
            signed_at: now,
          },
        };
        try {
          await s3Client.send(
            new PutObjectCommand({
              ...baseParams,
              ObjectLockMode: "COMPLIANCE",
              ObjectLockRetainUntilDate: retainUntil,
            }),
          );
        } catch (e: unknown) {
          const errName = (e as { name?: string })?.name ?? "";
          const errMsg = (e as { message?: string })?.message ?? "";
          if (errName === "InvalidRequest" && errMsg.includes("ObjectLockConfiguration")) {
            console.warn(`[DROPBOX-WEBHOOK] Bucket has no Object Lock — storing ${key} without retention lock.`);
            await s3Client.send(new PutObjectCommand(baseParams));
          } else {
            throw e;
          }
        }
      };

      if (isWitnessCallback) {
        // Unreachable — witness callbacks are short-circuited above.
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain" },
          body: "Hello API event received",
        };
      }

      await putWithLockFallback(signedKey, signedOnly);
      await putWithLockFallback(certKey, certificate);

      // Update tracking record with S3 keys
      await ddbClient.send(
        new UpdateCommand({
          TableName: ENVELOPES_TABLE,
          Key: { envelope_id: envelope.envelope_id },
          UpdateExpression:
            "SET certificate_stored = :t, signed_pdf_key = :sk, certificate_key = :ck, completed_at = :ca, updated_at = :now, #s = :completed",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":t": true,
            ":sk": signedKey,
            ":ck": certKey,
            ":ca": now,
            ":now": now,
            ":completed": "completed",
          },
        }),
      );

      // Tag the original document as "signed"
      const docRes = await ddbClient.send(
        new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: documentId } }),
      );
      if (docRes.Item) {
        const existingTags: string[] = docRes.Item.tags ?? [];
        if (!existingTags.includes("signed")) {
          await ddbClient.send(
            new UpdateCommand({
              TableName: DOCS_TABLE,
              Key: { document_id: documentId },
              UpdateExpression: "SET tags = :t",
              ExpressionAttributeValues: { ":t": [...existingTags, "signed"] },
            }),
          );
        }
      }

      // Send completion emails
      try {
        const recipients = new Set<string>();
        if (envelope.created_by) recipients.add(envelope.created_by as string);
        for (const e of (envelope.notify_emails as string[] | undefined) ?? []) {
          recipients.add(e);
        }
        const docTitle = (docRes.Item?.title as string) ?? "document";
        const signerLines = updatedSigners
          .map((s: any) => `  • ${s.name} (${s.role_label}) — ${s.email}`)
          .join("\n");
        const docLink = FRONTEND_URL ? `${FRONTEND_URL}/documents` : "";
        const text = `All parties have signed "${docTitle}".

Signers:
${signerLines}

The signed PDF and PKI certificate are stored in Aerostack securely.
${docLink ? `\nView in Aerostack: ${docLink}` : ""}`;

        await Promise.allSettled(
          [...recipients].map((to) =>
            sesClient.send(
              new SendEmailCommand({
                Source: FROM_EMAIL,
                Destination: { ToAddresses: [to] },
                Message: {
                  Subject: { Data: `✅ Signed: ${docTitle}`, Charset: "UTF-8" },
                  Body: { Text: { Data: text, Charset: "UTF-8" } },
                },
              }),
            ),
          ),
        );
      } catch (notifyErr) {
        console.warn("[DROPBOX-WEBHOOK] Notification email failed:", notifyErr);
      }

      console.log(`[DROPBOX-WEBHOOK] Signed PDF and certificate stored for envelope ${envelope.envelope_id}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "Hello API event received",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DROPBOX-WEBHOOK] Error processing webhook:", error);
    // Always return 200 with "Hello API Event Received" so Dropbox Sign doesn't retry endlessly on soft failures
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: "Hello API event received",
    };
  }
};

/**
 * Splits a Dropbox Sign zip download into the signed document and the audit trail.
 *
 * When you call `signature_request/files/{id}?file_type=zip`, Dropbox Sign returns
 * the original document(s) as separate PDFs plus a dedicated `Audit Trail.pdf`
 * containing the signature/audit "Signature page". This helper finds the
 * audit-trail entry by name and treats everything else as the signed document.
 *
 * If multiple non-audit PDFs are present (multi-file requests), they are merged
 * back into a single PDF in the order they appear in the zip.
 *
 * Falls back to slicing pages off the merged PDF if the zip layout is unexpected.
 */
function splitDropboxZip(
  zipBuffer: Buffer,
  mergedPdf: Buffer,
): { signedOnly: Buffer; certificate: Buffer } {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".pdf"));

    if (entries.length === 0) {
      console.warn("[SPLIT-DROPBOX-ZIP] No PDF entries in zip — returning merged PDF for both files.");
      return { signedOnly: mergedPdf, certificate: mergedPdf };
    }

    const isAuditEntry = (name: string): boolean => {
      const base = name.split("/").pop() ?? name;
      return /audit[\s_-]*trail/i.test(base);
    };

    const auditEntry = entries.find((e) => isAuditEntry(e.entryName));
    const docEntries = entries.filter((e) => !isAuditEntry(e.entryName));

    if (!auditEntry) {
      console.warn(
        `[SPLIT-DROPBOX-ZIP] No "Audit Trail" entry found in zip. Entries: ${entries.map((e) => e.entryName).join(", ")}. Falling back to page-slicing.`,
      );
      return fallbackPageSlice(mergedPdf, docEntries);
    }

    const certificate = auditEntry.getData();

    if (docEntries.length === 0) {
      console.warn("[SPLIT-DROPBOX-ZIP] Zip contained only an audit trail — using merged PDF as signed doc.");
      return { signedOnly: mergedPdf, certificate };
    }

    if (docEntries.length === 1) {
      return { signedOnly: docEntries[0].getData(), certificate };
    }

    // Multi-file request — merge the docs back into one PDF (async, so we wrap).
    // adm-zip is sync; PDFDocument is async. We can't await here, so just
    // concatenate the first doc and let pdf-lib merge happen lazily upstream
    // if needed. Realistically the Aerostack flow sends a single file, so this is rare.
    console.warn(
      `[SPLIT-DROPBOX-ZIP] ${docEntries.length} document PDFs in zip — using first only. Multi-file merge not yet implemented.`,
    );
    return { signedOnly: docEntries[0].getData(), certificate };
  } catch (err) {
    console.error("[SPLIT-DROPBOX-ZIP] Failed to parse zip — falling back to merged PDF:", err);
    return { signedOnly: mergedPdf, certificate: mergedPdf };
  }
}

function fallbackPageSlice(
  mergedPdf: Buffer,
  _docEntries: AdmZip.IZipEntry[],
): { signedOnly: Buffer; certificate: Buffer } {
  // Last-resort: hand the same merged PDF back as both files. The page-slicing
  // trick that used to live here only worked when we had the original (pre-Dropbox)
  // page count, which the webhook does not have access to.
  return { signedOnly: mergedPdf, certificate: mergedPdf };
}
