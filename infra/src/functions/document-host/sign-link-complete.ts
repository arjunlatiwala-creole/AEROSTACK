/**
 * POST /documents/sign/link/{envelopeId}/complete
 *
 * Public, no-auth endpoint hit when the signer clicks "I agree and sign"
 * on the Aerostack signing page.
 *
 * Flow:
 *   1. Verify magic-link token + load envelope
 *   2. Validate intake form responses + signature image
 *   3. Load original PDF from S3
 *   4. Bake the form answers + signature image into the PDF using pdf-lib
 *   5. Append an audit footer (signer name, email, timestamp, IP, SHA-256)
 *   6. Upload the signed PDF to S3 under signed/{documentId}/{envelopeId}/
 *      with Object Lock COMPLIANCE mode (10-year retention, undeletable)
 *   7. Mark this signer "completed"
 *   8. If all signers are complete:
 *        - tag original document as "signed"
 *        - send completion notification emails (sender + notify_emails)
 *        - mark envelope status = completed
 *   9. Return signed PDF download URL
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { verifySignLinkToken } from "./sign-link-token";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as crypto from "node:crypto";

const ENVELOPES_TABLE = process.env.DOCUSIGN_ENVELOPES_TABLE!;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME!;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "";
const FROM_EMAIL = process.env.SIGNATURE_FROM_EMAIL ?? "noreply@aerostack.enterprise.io";

const s3Client = new S3Client({});
const sesClient = new SESClient({});

// ───────────────────────────────────────────────────────────────────────────

interface FieldMarker {
  /** Maps to an intake form field id, or "__signature__" / "__date__" / "__name__" */
  field_id: string;
  page: number; // 1-indexed
  x: number; // points from left
  y: number; // points from bottom (PDF native coordinates)
  width: number;
  height: number;
  /** Which signer this marker belongs to (recipient_id) */
  recipient_id?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const envelopeId = event.pathParameters?.envelopeId;
    if (!envelopeId) return err("envelopeId is required", 400);

    const body = JSON.parse(event.body ?? "{}");
    const { token, intake_responses, signature_data_url, typed_name } = body as {
      token?: string;
      intake_responses?: Record<string, string>;
      /** PNG data URL from the signature pad, e.g. "data:image/png;base64,..." */
      signature_data_url?: string;
      /** What the signer typed as their full legal name (for audit log + name field) */
      typed_name?: string;
    };

    if (!token) return err("token is required", 400);
    if (!signature_data_url || !signature_data_url.startsWith("data:image/")) {
      return err("Signature is required", 400);
    }
    if (!typed_name || !typed_name.trim()) {
      return err("Please type your full legal name", 400);
    }

    // 1. Verify token
    let payload;
    try {
      payload = verifySignLinkToken(token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid token";
      return err(msg, 401);
    }
    if (payload.envelope_id !== envelopeId) return err("Token does not match envelope", 403);

    // 2. Load envelope
    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    );
    const envelope = envRes.Item;
    if (!envelope) return err("Envelope not found", 404);
    if (envelope.status === "completed") return err("Already signed by all parties", 400);
    if (envelope.status === "voided") return err("This envelope has been cancelled", 410);

    const signers = (envelope.signers as Array<{
      name: string;
      email: string;
      role_label: string;
      recipient_id: string;
      status: string;
      signature_id?: string;
      sign_link?: string;
    }>) ?? [];
    const signer = signers.find((s) => s.recipient_id === payload.recipient_id);
    if (!signer) return err("Signer not found in envelope", 404);
    if (signer.status?.toLowerCase() === "completed") {
      return err("You've already signed this document", 400);
    }

    // Sequential routing: refuse if it's not this signer's turn yet
    const activeRecipientId = (envelope.active_recipient_id as string | null) ?? "1";
    if (activeRecipientId !== signer.recipient_id) {
      return err(
        "It's not your turn to sign yet. We'll email you when the previous signers have completed.",
        409,
      );
    }

    // 3. Validate required intake fields — only fields belonging to THIS
    //    signer (untagged fields are shared and apply to every signer).
    const allFields = (envelope.intake_form_fields as Array<{
      id: string;
      label: string;
      required?: boolean;
      recipient_id?: string;
    }>) ?? [];
    const myFields = allFields.filter(
      (f) => !f.recipient_id || f.recipient_id === payload.recipient_id,
    );
    const responses = intake_responses ?? {};
    const missing = myFields
      .filter((f) => f.required && !(responses[f.id] ?? "").toString().trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      return err(`Please fill in: ${missing.join(", ")}`, 400);
    }

    // 4. Find the source PDF (current version of the document)
    const docRes = await ddbClient.send(
      new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: payload.document_id } }),
    );
    const doc = docRes.Item;
    if (!doc) return err("Document not found", 404);

    // If this signer already has a signed version (multi-party flow), use that
    // as the base so each signer's marks accumulate in the same PDF.
    const baseS3Key = (envelope.signed_pdf_in_progress_key as string | undefined)
      ?? await loadSourcePdfKey(payload.document_id, doc.current_version as number);
    if (!baseS3Key) return err("Source PDF not found in storage", 500);

    const s3Res = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: baseS3Key }),
    );
    const pdfBytes = await s3Res.Body!.transformToByteArray();

    // 5. Bake form values + signature into the PDF
    let fieldMarkers = (envelope.field_markers as FieldMarker[] | undefined) ?? [];

    // Fallback: automatically apply default coordinates for NDA / mNDA documents if no manual markers are set
    if (fieldMarkers.length === 0) {
      const titleLower = String(doc.title ?? "").toLowerCase();
      const slugLower = String(doc.slug ?? "").toLowerCase();
      if (
        titleLower.includes("nda") ||
        titleLower.includes("mnda") ||
        slugLower.includes("nda") ||
        slugLower.includes("mnda")
      ) {
        fieldMarkers = [
          // recipient 1 (enterprise) - Right column, Page 3
          { field_id: "__signature__", page: 3, x: 370, y: 75, width: 150, height: 30, recipient_id: "1" },
          { field_id: "__date__", page: 3, x: 350, y: 118, width: 100, height: 20, recipient_id: "1" },
          // recipient 2 (Counterparty) - Left column, Page 3
          { field_id: "__signature__", page: 3, x: 110, y: 75, width: 150, height: 30, recipient_id: "2" },
          { field_id: "__date__", page: 3, x: 95, y: 118, width: 100, height: 20, recipient_id: "2" },
          { field_id: "counterparty_name", page: 3, x: 95, y: 177, width: 180, height: 20, recipient_id: "2" },
          { field_id: "counterparty_title", page: 3, x: 95, y: 148, width: 180, height: 20, recipient_id: "2" },
          { field_id: "counterparty_company", page: 3, x: 80, y: 219, width: 180, height: 20, recipient_id: "2" },
          // recipient 2 (Counterparty) - Page 1
          { field_id: "counterparty_company", page: 1, x: 115, y: 673, width: 220, height: 16, recipient_id: "2" },
          { field_id: "effective_date", page: 1, x: 355, y: 699, width: 100, height: 16, recipient_id: "2" },
        ];
      }
    }

    const ipAddress = event.requestContext?.http?.sourceIp ?? "unknown";
    const signedAt = new Date().toISOString();

    // Merge intake responses from ALL signers so shared markers (e.g.
    // counterparty_company) get filled even if a previous signer submitted
    // them. The current signer's responses always win on conflict.
    const allResponses: Record<string, string> = {};
    const persistedResponses = (envelope.intake_form_responses as Record<string, { responses?: Record<string, string> }> | undefined) ?? {};
    for (const entry of Object.values(persistedResponses)) {
      if (entry?.responses) Object.assign(allResponses, entry.responses);
    }
    Object.assign(allResponses, responses);

    const stampedPdf = await stampPdf(pdfBytes, {
      fieldMarkers,
      responses: allResponses,
      typedName: typed_name.trim(),
      signatureDataUrl: signature_data_url,
      recipientId: signer.recipient_id,
      signerEmail: signer.email,
      signedAt,
      ipAddress,
    });

    // 6. Hash + upload to S3 with Object Lock
    const hash = crypto.createHash("sha256").update(stampedPdf).digest("hex");

    // While the envelope is still in progress, store under .../in-progress.pdf
    // (no Object Lock yet — needs to mutate as more signers sign).
    // Once the LAST signer signs, we move it to the locked location.
    const isLastSigner = signers.every(
      (s) => s.recipient_id === signer.recipient_id || s.status?.toLowerCase() === "completed",
    );

    const inProgressKey = `signed/${payload.document_id}/${envelopeId}/in-progress.pdf`;
    const finalKey = `signed/${payload.document_id}/${envelopeId}/signed-document.pdf`;

    if (isLastSigner) {
      // Final write — Object Lock COMPLIANCE, 10-year retention
      const retainUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: finalKey,
            Body: stampedPdf,
            ContentType: "application/pdf",
            ObjectLockMode: "COMPLIANCE",
            ObjectLockRetainUntilDate: retainUntil,
            Metadata: {
              envelope_id: envelopeId,
              document_id: payload.document_id as string,
              sha256: hash,
              signed_at: signedAt,
            },
          }),
        );
      } catch (e: unknown) {
        const errName = (e as { name?: string })?.name ?? "";
        const errMsg = (e as { message?: string })?.message ?? "";
        const isMissingLock = errName === "InvalidRequest" && errMsg.includes("ObjectLockConfiguration");
        if (!isMissingLock) throw e;
        // Bucket pre-dates Object Lock support — write without it but log a
        // strong warning. Operationally, the bucket should be recreated with
        // objectLockEnabled: true for legal-grade tamper-proofing.
        console.warn(
          "[SIGN-LINK-COMPLETE] Bucket has no Object Lock configuration. " +
          "Writing signed PDF without retention lock. Recreate the bucket with " +
          "objectLockEnabled=true for compliance-grade storage.",
        );
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: finalKey,
            Body: stampedPdf,
            ContentType: "application/pdf",
            Metadata: {
              envelope_id: envelopeId,
              document_id: payload.document_id as string,
              sha256: hash,
              signed_at: signedAt,
              object_lock: "unavailable",
            },
          }),
        );
      }
    } else {
      // Mid-flow write — overwrite in-progress.pdf for next signer
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: inProgressKey,
          Body: stampedPdf,
          ContentType: "application/pdf",
        }),
      );
    }

    // 7. Update signer status + envelope record
    const now = new Date().toISOString();
    const newSigners = signers.map((s) =>
      s.recipient_id === signer.recipient_id
        ? {
          ...s,
          status: "completed",
          signed_at: now,
          signed_ip: ipAddress,
          typed_name: typed_name.trim(),
        }
        : s,
    );
    const allDone = newSigners.every((s) => s.status?.toLowerCase() === "completed");

    // Sequential routing: figure out the next signer (lowest recipient_id
    // that's not yet completed). May be null if all done.
    const nextSigner = allDone
      ? null
      : [...newSigners]
        .sort((a, b) => Number(a.recipient_id) - Number(b.recipient_id))
        .find((s) => s.status?.toLowerCase() !== "completed") ?? null;

    const updateExpressions: string[] = [
      "signers = :s",
      "updated_at = :now",
      "intake_form_responses.#rid = :r",
    ];
    const exprValues: Record<string, unknown> = {
      ":s": newSigners,
      ":now": now,
      ":r": { responses, submitted_at: now, typed_name: typed_name.trim() },
    };
    const exprNames: Record<string, string> = { "#rid": signer.recipient_id };

    if (allDone) {
      console.log(`[SIGN-FLOW] Final signer ${signer.email} (recipient ${signer.recipient_id}) has signed. All signers have finished (allDone is true). Preparing to store the final completed PDF in S3 and certify it with Dropbox Sign.`);
      updateExpressions.push(
        "#st = :completed",
        "completed_at = :now",
        "signed_pdf_key = :sk",
        "signed_pdf_sha256 = :sha",
        "active_recipient_id = :none",
      );
      exprValues[":completed"] = "completed";
      exprValues[":sk"] = finalKey;
      exprValues[":sha"] = hash;
      exprValues[":none"] = null;
      exprNames["#st"] = "status";
    } else {
      console.log(`[SIGN-FLOW] Intermediate signer ${signer.email} (recipient ${signer.recipient_id}) has signed. Not all signers have finished (allDone is false). Storing the in-progress PDF and recreating the Dropbox request for remaining signers.`);
      updateExpressions.push(
        "signed_pdf_in_progress_key = :ipk",
        "active_recipient_id = :nextId",
      );
      exprValues[":ipk"] = inProgressKey;
      exprValues[":nextId"] = nextSigner!.recipient_id;

      // Recreate Dropbox signature request for remaining signers to keep the Dropbox dashboard status synced (e.g. shows Pending 1 instead of Pending 2)
      try {
        const remainingSigners = newSigners.filter((s) => s.status?.toLowerCase() !== "completed");
        const recreateRes = await recreateDropboxRequestForNextSigner({
          currentDropboxRequestId: (envelope.dropbox_signature_request_id as string | undefined) ?? envelopeId,
          documentId: payload.document_id,
          signedPdf: stampedPdf,
          docTitle: (doc.title as string) ?? "document",
          remainingSigners: remainingSigners.map((s) => ({
            name: s.name,
            email: s.email,
            recipient_id: s.recipient_id,
          })),
          emailSubject: (envelope.email_subject as string) ?? undefined,
          emailBody: (envelope.email_body as string) ?? undefined,
        });

        if (recreateRes) {
          // Update newSigners with the new signature_id for remaining signers
          const updatedSigners = newSigners.map((s) => {
            if (s.status?.toLowerCase() !== "completed") {
              const matchingSig = recreateRes.signatures.find(
                (sig) => sig.signer_email_address.toLowerCase() === s.email.toLowerCase()
              );
              return {
                ...s,
                signature_id: matchingSig?.signature_id ?? s.signature_id,
              };
            }
            return s;
          });

          // Overwrite the :s expression value with the updated signers array
          exprValues[":s"] = updatedSigners;
          
          updateExpressions.push("dropbox_signature_request_id = :dsReqId");
          exprValues[":dsReqId"] = recreateRes.dsEnvelopeId;
        }
      } catch (e) {
        console.warn("[SIGN-LINK-COMPLETE] Failed to recreate Dropbox request for next signer:", e);
      }
    }

    await ddbClient.send(
      new UpdateCommand({
        TableName: ENVELOPES_TABLE,
        Key: { envelope_id: envelopeId },
        UpdateExpression: "SET " + updateExpressions.join(", "),
        ExpressionAttributeValues: exprValues,
        ExpressionAttributeNames: exprNames,
      }),
    );

    // 8. Routing: notify the next person in the chain (or finalize)
    if (allDone) {
      await tagDocumentAsSigned(payload.document_id);
      await sendCompletionEmails({
        envelope,
        signers: newSigners,
        docTitle: (doc.title as string) ?? "document",
        pdfBuffer: stampedPdf,
      });

      // Generate and store Dropbox Sign Certificate of Completion silently (no signer emails sent)
      try {
        console.log(`[SIGN-FLOW] Triggering Dropbox Sign certification for final completed document.`);
        const certRes = await certifyWithDropboxSign({
          envelopeId,
          documentId: payload.document_id,
          signedPdf: stampedPdf,
          docTitle: (doc.title as string) ?? "Signed document",
        });
        if (certRes) {
          // Two paths:
          //  - certRes.certKey set: Dropbox already had the audit trail, we
          //    stored it as the real cert (certificate_source = "dropbox").
          //  - certRes.certKey empty: Dropbox didn't have the audit trail
          //    yet. Only remember the request id so the witness webhook can
          //    fill in the cert later. Do NOT mark certificate_stored.
          if (certRes.certKey) {
            await ddbClient.send(
              new UpdateCommand({
                TableName: ENVELOPES_TABLE,
                Key: { envelope_id: envelopeId },
                UpdateExpression: "SET certificate_key = :ck, certificate_stored = :true, certificate_source = :src, dropbox_certified_at = :ts, dropbox_signature_request_id = :dsReqId",
                ExpressionAttributeValues: {
                  ":ck": certRes.certKey,
                  ":true": true,
                  ":src": "dropbox",
                  ":ts": new Date().toISOString(),
                  ":dsReqId": certRes.dropboxSignatureRequestId,
                },
              }),
            );
          } else {
            await ddbClient.send(
              new UpdateCommand({
                TableName: ENVELOPES_TABLE,
                Key: { envelope_id: envelopeId },
                UpdateExpression: "SET dropbox_signature_request_id = :dsReqId, dropbox_certified_at = :ts",
                ExpressionAttributeValues: {
                  ":dsReqId": certRes.dropboxSignatureRequestId,
                  ":ts": new Date().toISOString(),
                },
              }),
            );
            console.log(`[SIGN-FLOW] Certification request created without immediate cert — waiting on witness webhook.`);
          }
          // Cancel the active Dropbox Sign request only after certification
          // request was created — otherwise we'd lose both copies.
          console.log(`[SIGN-FLOW] Certification request created. Cancelling stale intermediate signature request.`);
          await cancelSignatureRequest((envelope.dropbox_signature_request_id as string | undefined) ?? envelopeId);
        } else {
          console.warn(`[SIGN-FLOW] Certification returned no result. Skipping intermediate request cancellation.`);
        }
      } catch (e) {
        console.warn("[SIGN-LINK-COMPLETE] Dropbox Sign certification failed (non-fatal):", e);
      }
    } else if (nextSigner) {
      // Email the next signer their invite. Reuses email subject/body the
      // sender configured on the envelope.
      try {
        await sendNextSignerEmail({
          to: nextSigner.email,
          signerName: nextSigner.name,
          documentTitle: (doc.title as string) ?? "document",
          senderEmail: (envelope.created_by as string) ?? "",
          subject: (envelope.email_subject as string) ?? `Please sign: ${doc.title}`,
          messageBody: (envelope.email_body as string) ?? "",
          signLink: (nextSigner as { sign_link?: string }).sign_link ?? "",
          previousSignerName: signer.name,
        });
      } catch (e) {
        // Don't fail the request if the next-signer email fails — the previous
        // signer's signature is already saved. Log and surface in the response.
        console.warn(`[SIGN-LINK-COMPLETE] Failed to email next signer ${nextSigner.email}:`, e);
      }
    }

    return ok({
      success: true,
      all_signers_complete: allDone,
      signed_pdf_sha256: hash,
      message: allDone
        ? "All parties have signed. The signed document is locked and stored."
        : "Your signature is recorded. The next signer will receive their invitation shortly.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SIGN-LINK-COMPLETE] Error:", error);
    return err(message, 500);
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadSourcePdfKey(documentId: string, versionNumber: number): Promise<string | null> {
  const versionRes = await ddbClient.send(
    new GetCommand({
      TableName: VERSIONS_TABLE,
      Key: { document_id: documentId, version_number: versionNumber },
    }),
  );
  return (versionRes.Item?.s3_key as string | undefined) ?? null;
}

interface StampOptions {
  fieldMarkers: FieldMarker[];
  responses: Record<string, string>;
  typedName: string;
  signatureDataUrl: string;
  recipientId: string;
  signerEmail: string;
  signedAt: string;
  ipAddress: string;
}

/**
 * Bakes the form values and signature image into the PDF.
 *
 * If field markers exist, places content at their coordinates.
 * If no markers, places the signature on the last page (default location)
 * and skips text fields (form responses are saved on the envelope record only).
 */
async function stampPdf(pdfBytes: Uint8Array, opts: StampOptions): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Decode signature PNG
  const sigBytes = Buffer.from(opts.signatureDataUrl.split(",")[1], "base64");
  const sigImage = await pdfDoc.embedPng(sigBytes);

  const myMarkers = opts.fieldMarkers.filter(
    (m) => !m.recipient_id || m.recipient_id === opts.recipientId,
  );

  if (myMarkers.length > 0) {
    // Place content at each marker
    for (const marker of myMarkers) {
      const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, marker.page - 1));
      const page = pdfDoc.getPage(pageIdx);

      if (marker.field_id === "__signature__") {
        const sigDims = sigImage.scaleToFit(marker.width, marker.height);
        page.drawImage(sigImage, {
          x: marker.x,
          y: marker.y,
          width: sigDims.width,
          height: sigDims.height,
        });
      } else if (marker.field_id === "__date__") {
        page.drawText(new Date(opts.signedAt).toLocaleDateString(), {
          x: marker.x,
          y: marker.y,
          size: 11,
          font: helv,
          color: rgb(0, 0, 0),
        });
      } else if (marker.field_id === "__name__") {
        page.drawText(opts.typedName, {
          x: marker.x,
          y: marker.y,
          size: 11,
          font: helv,
          color: rgb(0, 0, 0),
        });
      } else {
        const value = opts.responses[marker.field_id] ?? "";
        page.drawText(String(value), {
          x: marker.x,
          y: marker.y,
          size: 11,
          font: helv,
          color: rgb(0, 0, 0),
          maxWidth: marker.width,
        });
      }
    }
  } else {
    // No markers: drop signature on last page, bottom-right
    const lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
    const { width, height } = lastPage.getSize();
    const sigW = 180;
    const sigH = 60;
    const sigDims = sigImage.scaleToFit(sigW, sigH);
    const x = width - sigDims.width - 50;
    const y = 90;
    lastPage.drawImage(sigImage, { x, y, width: sigDims.width, height: sigDims.height });
    lastPage.drawText(opts.typedName, {
      x,
      y: y - 14,
      size: 9,
      font: helvBold,
      color: rgb(0, 0, 0),
    });
    lastPage.drawText(`Signed ${new Date(opts.signedAt).toLocaleDateString()}`, {
      x,
      y: y - 26,
      size: 8,
      font: helv,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  // Audit footer on a new page (every signer adds their own audit block)
  const auditPage = pdfDoc.addPage();
  const { width: aw } = auditPage.getSize();
  let cursorY = auditPage.getSize().height - 60;

  const writeAudit = (text: string, opts2: { bold?: boolean; size?: number; color?: [number, number, number] } = {}) => {
    auditPage.drawText(text, {
      x: 50,
      y: cursorY,
      size: opts2.size ?? 11,
      font: opts2.bold ? helvBold : helv,
      color: rgb(...(opts2.color ?? [0.1, 0.1, 0.1])),
      maxWidth: aw - 100,
    });
    cursorY -= (opts2.size ?? 11) + 6;
  };

  writeAudit("Aerostack Signing Audit Trail", { bold: true, size: 16 });
  cursorY -= 8;
  writeAudit(`Envelope: ${opts.recipientId}`, { size: 9, color: [0.4, 0.4, 0.4] });
  cursorY -= 4;
  writeAudit("Signer", { bold: true, size: 10 });
  writeAudit(`Name: ${opts.typedName}`);
  writeAudit(`Email: ${opts.signerEmail}`);
  writeAudit(`IP address: ${opts.ipAddress}`);
  writeAudit(`Signed at (UTC): ${opts.signedAt}`);
  cursorY -= 4;
  writeAudit("Identity verification", { bold: true, size: 10 });
  writeAudit(`Magic link delivered to: ${opts.signerEmail}`);
  writeAudit(`HMAC-signed token verified at sign time`);
  cursorY -= 4;
  writeAudit("Form responses captured at signing", { bold: true, size: 10 });
  for (const [k, v] of Object.entries(opts.responses)) {
    writeAudit(`  ${k}: ${v}`, { size: 10 });
  }

  return pdfDoc.save();
}

async function tagDocumentAsSigned(documentId: string): Promise<void> {
  const docRes = await ddbClient.send(
    new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: documentId } }),
  );
  if (!docRes.Item) return;
  const tags: string[] = docRes.Item.tags ?? [];
  if (tags.includes("signed")) return;
  await ddbClient.send(
    new UpdateCommand({
      TableName: DOCS_TABLE,
      Key: { document_id: documentId },
      UpdateExpression: "SET tags = :t, updated_at = :now",
      ExpressionAttributeValues: {
        ":t": [...tags, "signed"],
        ":now": new Date().toISOString(),
      },
    }),
  );
}

interface CompletionEmailOpts {
  envelope: Record<string, unknown>;
  signers: Array<{ name: string; email: string; role_label: string; signed_at?: string }>;
  docTitle: string;
  pdfBuffer?: Uint8Array | Buffer;
}

function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachmentName?: string;
  attachmentBuffer?: Uint8Array | Buffer;
}): string {
  const boundary = "NextPart_" + Math.random().toString(36).slice(2);
  const altBoundary = "AlternativePart_" + Math.random().toString(36).slice(2);

  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    "",
  ];

  const body = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.text,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.html,
    "",
    `--${altBoundary}--`,
    "",
  ];

  if (opts.attachmentName && opts.attachmentBuffer) {
    const base64Content = Buffer.from(opts.attachmentBuffer).toString("base64").match(/.{1,76}/g)?.join("\n") || "";
    body.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${opts.attachmentName}"`,
      `Content-Description: ${opts.attachmentName}`,
      `Content-Disposition: attachment; filename="${opts.attachmentName}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Content,
      "",
    );
  }

  body.push(`--${boundary}--`);

  return headers.join("\r\n") + body.join("\r\n");
}

async function sendCompletionEmails(opts: CompletionEmailOpts): Promise<void> {
  const recipients = new Set<string>();
  if (opts.envelope.created_by) recipients.add(opts.envelope.created_by as string);
  for (const e of (opts.envelope.notify_emails as string[] | undefined) ?? []) {
    recipients.add(e);
  }
  // Also send each signer their own copy notification
  for (const s of opts.signers) recipients.add(s.email);

  if (recipients.size === 0) return;

  const docLink = FRONTEND_URL ? `${FRONTEND_URL}/documents` : "";
  const subject = `✅ Fully Signed: ${opts.docTitle}`;

  const signerLines = opts.signers
    .map((s) => `  • ${s.name} (${s.role_label}) — ${s.email}${s.signed_at ? ` — signed ${new Date(s.signed_at).toLocaleString()}` : ""}`)
    .join("\n");

  const text = `All parties have signed "${opts.docTitle}".

Signers:
${signerLines}

The signed PDF is locked in Aerostack storage and attached to this email.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 18px; margin: 0; color: #059669;">✅ Fully Signed: ${escapeHtml(opts.docTitle)}</h1>
      </div>
      <p style="margin: 0 0 16px 0;">All parties have signed the document <strong>${escapeHtml(opts.docTitle)}</strong>.</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Signers</div>
        ${opts.signers.map(s => `
          <div style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">
            <strong>${escapeHtml(s.name)}</strong> <span style="font-size: 12px; color: #64748b;">(${escapeHtml(s.role_label)})</span>
            <span style="font-size: 12px; color: #059669; float: right;">Signed</span>
            <div style="clear: both;"></div>
          </div>
        `).join("")}
      </div>
      <p style="margin: 24px 0 12px 0;">The signed PDF is attached to this email and locked in Aerostack storage.</p>
    </div>
  `;

  // Sanitize file name for email attachment header
  const attachmentName = `${opts.docTitle.replace(/[^a-zA-Z0-9]/g, "_")}_signed.pdf`;

  await Promise.allSettled(
    [...recipients].map((to) => {
      const mimeString = buildMimeMessage({
        from: FROM_EMAIL,
        to,
        subject,
        text,
        html,
        attachmentName: opts.pdfBuffer ? attachmentName : undefined,
        attachmentBuffer: opts.pdfBuffer,
      });

      return sesClient.send(
        new SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(mimeString),
          },
        }),
      );
    }),
  );
}


interface NextSignerEmailOpts {
  to: string;
  signerName: string;
  documentTitle: string;
  senderEmail: string;
  subject: string;
  messageBody: string;
  signLink: string;
  previousSignerName: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendNextSignerEmail(opts: NextSignerEmailOpts): Promise<void> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 18px; margin: 0; color: #059669;">📝 It's your turn to sign</h1>
      </div>
      <p style="margin: 0 0 12px 0;">Hi ${escapeHtml(opts.signerName)},</p>
      <p style="margin: 0 0 12px 0;">${escapeHtml(opts.previousSignerName)} has just signed. The document is now ready for your signature.</p>
      ${opts.messageBody ? `<p style="margin: 0 0 16px 0; white-space: pre-wrap;">${escapeHtml(opts.messageBody)}</p>` : ""}
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Document</div>
        <div style="font-weight: 600;">${escapeHtml(opts.documentTitle)}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 12px;">Sent by</div>
        <div>${escapeHtml(opts.senderEmail)}</div>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${opts.signLink}" style="display: inline-block; background: #059669; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">Review &amp; Sign</a>
      </div>
      <p style="font-size: 12px; color: #64748b; text-align: center; margin: 24px 0 0 0;">
        Or paste this link into your browser:<br>
        <span style="word-break: break-all;">${opts.signLink}</span>
      </p>
    </div>
  `;
  const text = `Hi ${opts.signerName},

${opts.previousSignerName} has just signed. The document is now ready for your signature.

${opts.messageBody}

Document: ${opts.documentTitle}
Sent by: ${opts.senderEmail}

Review & sign: ${opts.signLink}`;

  await sesClient.send(
    new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: opts.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    }),
  );
}


// ─── Dropbox Sign certification (silent) ──────────────────────────────────────
//
// We upload the Aerostack-signed PDF to Dropbox Sign using a single embedded system
// witness recipient to generate the official Certificate of Completion
// WITHOUT sending any email notifications to the actual signers.

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import AdmZip from "adm-zip";

const DS_CLIENT_ID = process.env.DROPBOX_SIGN_CLIENT_ID;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL;
const DS_TEST_MODE = process.env.DROPBOX_SIGN_TEST_MODE === "true";

const dsSm = new SecretsManagerClient({});

async function getApiKey(): Promise<string> {
  const res = await dsSm.send(
    new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET! }),
  );
  return res.SecretString!.trim();
}

interface CertifyOpts {
  envelopeId: string;
  documentId: string;
  signedPdf: Uint8Array;
  docTitle: string;
}

async function certifyWithDropboxSign(
  opts: CertifyOpts
): Promise<{ certKey: string; dropboxSignatureRequestId: string } | null> {
  if (!DS_CLIENT_ID || !DS_API_KEY_SECRET || !DS_BASE_URL) {
    console.warn("[CERTIFY] Dropbox Sign env vars missing — skipping certification.");
    return null;
  }

  try {
    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

    // Fetch the account email address dynamically to bypass test mode restrictions
    let witnessEmail = FROM_EMAIL;
    try {
      const accountRes = await fetch(`${DS_BASE_URL}/account`, {
        headers: { Authorization: `Basic ${basicAuth}` },
      });
      if (accountRes.ok) {
        const accountData: any = await accountRes.json();
        if (accountData?.account?.email_address) {
          witnessEmail = accountData.account.email_address;
        }
      }
    } catch (err) {
      console.warn("[CERTIFY] Could not fetch account details for email fallback:", err);
    }

    // Build the form payload — shared between both send strategies.
    const buildFormData = () => {
      const fd = new FormData();
      fd.append("client_id", DS_CLIENT_ID);
      fd.append("test_mode", DS_TEST_MODE ? "1" : "0");
      fd.append("title", `📄 Signed copy: ${opts.docTitle}`);
      fd.append("subject", `📄 Signed copy: ${opts.docTitle}`);
      fd.append("message", `This is the Aerostack-signed copy of "${opts.docTitle}". All parties have signed in Aerostack.`);
      fd.append("signers[0][name]", "Aerostack System");
      fd.append("signers[0][email_address]", witnessEmail);
      fd.append("signers[0][order]", "0");
      const fileBlob = new Blob([opts.signedPdf], { type: "application/pdf" });
      fd.append("files[0]", fileBlob, `${opts.docTitle.replace(/[^A-Za-z0-9._-]+/g, "_") || "document"}.pdf`);
      return fd;
    };

    // Use signature_request/create_embedded exclusively. This endpoint does
    // NOT send the "Please sign" email to the witness — Aerostack owns all signer
    // communication. (Post-signing confirmation email is suppressed in the
    // Dropbox API App dashboard.)
    const embeddedRes = await fetch(`${DS_BASE_URL}/signature_request/create_embedded`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}` },
      body: buildFormData(),
    });
    const responseData: any = await embeddedRes.json();

    if (!embeddedRes.ok) {
      console.error("[CERTIFY] create_embedded failed:", responseData);
      return null;
    }

    const usedEndpoint = "create_embedded";

    const dsEnvelopeId = responseData.signature_request?.signature_request_id;
    if (!dsEnvelopeId) {
      console.warn("[CERTIFY] Dropbox Sign returned no signature_request_id");
      return null;
    }

    console.log(`[CERTIFY] Created Dropbox Sign request ${dsEnvelopeId} via ${usedEndpoint} for "${opts.docTitle}"`);

    // Try to download the real Dropbox audit trail right now.
    // If Dropbox doesn't have one yet (request just created, or no signer has
    // signed yet so the audit page hasn't been generated), we DO NOT store a
    // placeholder — the cert button stays hidden until the witness webhook
    // lands a real cert. No fake "Aerostack audit page as cert" fallback.
    const dropboxAudit = await tryDownloadDropboxAuditTrail(basicAuth, dsEnvelopeId);
    if (!dropboxAudit) {
      console.log(
        `[CERTIFY] Dropbox audit not available yet for ${dsEnvelopeId}. Skipping cert write — webhook will store it when the witness signs.`,
      );
      // Still return the request id so the envelope can remember it and the
      // webhook / self-heal can find this envelope later.
      return { certKey: "", dropboxSignatureRequestId: dsEnvelopeId };
    }
    const certPdf = dropboxAudit;
    console.log(`[CERTIFY] Retrieved real Dropbox audit trail for request ${dsEnvelopeId}.`);
    const certKey = `signed/${opts.documentId}/${opts.envelopeId}/certificate.pdf`;
    const retainUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000); // 10 years

    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: certKey,
          Body: certPdf,
          ContentType: "application/pdf",
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: retainUntil,
          Metadata: {
            envelope_id: opts.envelopeId,
            document_id: opts.documentId,
            dropbox_signature_request_id: dsEnvelopeId,
          },
        }),
      );
    } catch (e: unknown) {
      const errName = (e as { name?: string })?.name ?? "";
      const errMsg = (e as { message?: string })?.message ?? "";
      if (errName === "InvalidRequest" && errMsg.includes("ObjectLockConfiguration")) {
        console.warn("[CERTIFY] Bucket has no Object Lock — storing certificate without retention lock.");
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: certKey,
            Body: certPdf,
            ContentType: "application/pdf",
            Metadata: {
              envelope_id: opts.envelopeId,
              document_id: opts.documentId,
              dropbox_signature_request_id: dsEnvelopeId,
              object_lock: "unavailable",
            },
          }),
        );
      } else {
        throw e;
      }
    }

    console.log(`[CERTIFY] Stored Dropbox Sign certificate at ${certKey}`);
    return { certKey, dropboxSignatureRequestId: dsEnvelopeId };
  } catch (error: unknown) {
    console.error("[CERTIFY] Error generating Dropbox Sign certificate:", error);
    return null;
  }
}

/**
 * Fetches an embedded signing URL from the ORIGINAL Dropbox Sign request
 * for a specific signer (identified by their signature_id stored on the envelope).
 * Returns the URL so the frontend can show the Dropbox iframe for confirmation.
 * Returns null if unavailable (non-fatal).
 */
async function getDropboxEmbeddedSignUrl(
  signatureId: string,
): Promise<string | null> {
  if (!DS_CLIENT_ID || !DS_API_KEY_SECRET || !DS_BASE_URL) return null;
  try {
    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");
    const res = await fetch(
      `${DS_BASE_URL}/embedded/sign_url/${signatureId}`,
      { headers: { Authorization: `Basic ${basicAuth}` } },
    );
    if (!res.ok) {
      console.warn(`[SIGN-LINK-COMPLETE] Could not get embedded sign URL (${res.status}) — skipping Dropbox confirmation step.`);
      return null;
    }
    const data: any = await res.json();
    return (data?.embedded?.sign_url as string | undefined) ?? null;
  } catch (e) {
    console.warn("[SIGN-LINK-COMPLETE] getDropboxEmbeddedSignUrl error (non-fatal):", e);
    return null;
  }
}

async function cancelSignatureRequest(envelopeId: string): Promise<void> {
  if (!DS_API_KEY_SECRET || !DS_BASE_URL) return;
  try {
    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");
    const response = await fetch(`${DS_BASE_URL}/signature_request/cancel/${envelopeId}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn(`[SIGN-LINK-COMPLETE] Failed to cancel original signature request ${envelopeId}:`, data);
    } else {
      console.log(`[SIGN-LINK-COMPLETE] Successfully cancelled original signature request ${envelopeId} on Dropbox Sign.`);
    }
  } catch (e) {
    console.warn(`[SIGN-LINK-COMPLETE] Error cancelling signature request ${envelopeId}:`, e);
  }
}

async function recreateDropboxRequestForNextSigner(opts: {
  currentDropboxRequestId: string;
  documentId: string;
  signedPdf: Uint8Array;
  docTitle: string;
  remainingSigners: Array<{ name: string; email: string; recipient_id: string }>;
  emailSubject?: string;
  emailBody?: string;
}): Promise<{ dsEnvelopeId: string; signatures: Array<{ signer_email_address: string; signature_id: string }> } | null> {
  if (!DS_CLIENT_ID || !DS_API_KEY_SECRET || !DS_BASE_URL) {
    console.warn("[RECREATE-DS] Dropbox Sign env vars missing — skipping recreation.");
    return null;
  }

  try {
    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

    // 1. Cancel the active signature request first
    await cancelSignatureRequest(opts.currentDropboxRequestId);

    // 2. Build the new signature request payload
    const buildFormData = () => {
      const fd = new FormData();
      fd.append("client_id", DS_CLIENT_ID);
      fd.append("test_mode", DS_TEST_MODE ? "1" : "0");
      fd.append("title", opts.docTitle);
      fd.append("subject", opts.emailSubject ?? `Please sign: ${opts.docTitle}`);
      fd.append("message", opts.emailBody ?? `You have been requested to review and sign the document: ${opts.docTitle}`);
      
      // Only append remaining signers!
      opts.remainingSigners.forEach((s, idx) => {
        fd.append(`signers[${idx}][name]`, s.name);
        fd.append(`signers[${idx}][email_address]`, s.email);
        fd.append(`signers[${idx}][order]`, String(idx));
      });

      const fileBlob = new Blob([opts.signedPdf], { type: "application/pdf" });
      fd.append("files[0]", fileBlob, `${opts.docTitle.replace(/[^A-Za-z0-9._-]+/g, "_") || "document"}.pdf`);
      return fd;
    };

    // Use create_embedded only — no Dropbox signer emails.
    const embeddedRes = await fetch(`${DS_BASE_URL}/signature_request/create_embedded`, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}` },
      body: buildFormData(),
    });
    const responseData: any = await embeddedRes.json();

    if (!embeddedRes.ok) {
      console.error("[RECREATE-DS] create_embedded failed:", responseData);
      return null;
    }

    const usedEndpoint = "create_embedded";

    const dsEnvelopeId = responseData.signature_request?.signature_request_id;
    if (!dsEnvelopeId) {
      console.warn("[RECREATE-DS] Dropbox Sign returned no signature_request_id");
      return null;
    }

    const dsSignatures = responseData.signature_request?.signatures || [];
    console.log(`[RECREATE-DS] Recreated Dropbox request ${dsEnvelopeId} via ${usedEndpoint} with ${opts.remainingSigners.length} signers.`);

    return {
      dsEnvelopeId,
      signatures: dsSignatures.map((sig: any) => ({
        signer_email_address: sig.signer_email_address ?? "",
        signature_id: sig.signature_id ?? "",
      })),
    };
  } catch (error: unknown) {
    console.error("[RECREATE-DS] Error recreating Dropbox request:", error);
    return null;
  }
}


/**
 * Extracts only the last page of a PDF. Used as the placeholder certificate
 * when the Dropbox-issued audit trail isn't available yet — the last page of
 * the Aerostack-stamped PDF is the Aerostack Signing Audit Trail page added by stampPdf.
 *
 * Falls back to the original buffer if extraction fails for any reason.
 */
async function extractLastPage(pdfBytes: Uint8Array): Promise<Buffer> {
  try {
    const source = await PDFDocument.load(pdfBytes);
    const pageCount = source.getPageCount();
    if (pageCount === 0) return Buffer.from(pdfBytes);
    const out = await PDFDocument.create();
    const [lastPage] = await out.copyPages(source, [pageCount - 1]);
    out.addPage(lastPage);
    return Buffer.from(await out.save());
  } catch (err) {
    console.warn("[EXTRACT-LAST-PAGE] Failed to extract last page — returning full PDF:", err);
    return Buffer.from(pdfBytes);
  }
}

/**
 * Downloads the current Dropbox Sign audit trail for a signature request.
 *
 * Dropbox builds the "Audit Trail.pdf" the moment a request is created — it
 * shows the real Document ID at the top, the signer list, and the current
 * status of each signer (Pending / Signed). We grab it right after creating
 * the witness request so the cert we store in S3 looks like a real Dropbox
 * cert from day one, even before anyone has signed.
 *
 * Returns null on any failure (409 "files not ready", auth, network) so the
 * caller can fall back to the Aerostack audit page gracefully.
 */
async function tryDownloadDropboxAuditTrail(
  basicAuth: string,
  dropboxRequestId: string,
): Promise<Buffer | null> {
  if (!DS_BASE_URL) return null;
  try {
    const zipRes = await fetch(
      `${DS_BASE_URL}/signature_request/files/${dropboxRequestId}?file_type=zip`,
      { headers: { Authorization: `Basic ${basicAuth}` } },
    );
    if (!zipRes.ok) {
      // 409 = Dropbox is still building the files. Anything else = real error.
      console.warn(
        `[CERTIFY] Dropbox zip not ready for ${dropboxRequestId} (status ${zipRes.status}).`,
      );
      return null;
    }
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    const zip = new AdmZip(zipBuf);
    const audit = zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".pdf"))
      .find((e) => {
        const base = e.entryName.split("/").pop() ?? e.entryName;
        return /audit[\s_-]*trail/i.test(base);
      });
    return audit ? audit.getData() : null;
  } catch (err) {
    console.warn("[CERTIFY] tryDownloadDropboxAuditTrail error:", err);
    return null;
  }
}
