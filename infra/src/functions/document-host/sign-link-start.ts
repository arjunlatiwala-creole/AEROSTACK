/**
 * POST /documents/sign/link/{envelopeId}/start
 *
 * Public, no-auth endpoint hit AFTER the signer fills the intake form.
 *
 * Flow:
 *   1. Verify magic-link token
 *   2. Validate intake form responses against schema (required fields)
 *   3. Persist responses on the envelope record
 *   4. Retrieve a fresh Dropbox Sign embedded signing URL using signature_id
 *   5. Return signing URL — the Aerostack page renders it in an iframe
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { verifySignLinkToken } from "./sign-link-token";

const ENVELOPES_TABLE = process.env.DROPBOX_SIGN_REQUESTS_TABLE ?? process.env.DOCUSIGN_ENVELOPES_TABLE!;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET!;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL!;

const smClient = new SecretsManagerClient({});

async function getApiKey(): Promise<string> {
  if (process.env.DROPBOX_SIGN_API_KEY_FILE) {
    const fs = await import("node:fs/promises");
    return (await fs.readFile(process.env.DROPBOX_SIGN_API_KEY_FILE, "utf-8")).trim();
  }
  const res = await smClient.send(
    new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET }),
  );
  return res.SecretString!.trim();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const envelopeId = event.pathParameters?.envelopeId;
    if (!envelopeId) return err("envelopeId is required", 400);

    const body = JSON.parse(event.body ?? "{}");
    const { token, intake_responses } = body as {
      token?: string;
      intake_responses?: Record<string, string>;
    };
    if (!token) return err("token is required", 400);

    let payload;
    try {
      payload = verifySignLinkToken(token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid token";
      return err(msg, 401);
    }
    if (payload.envelope_id !== envelopeId) return err("Token does not match envelope", 403);

    // Load envelope
    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    );
    const envelope = envRes.Item;
    if (!envelope) return err("Envelope not found", 404);
    if (envelope.status === "completed") return err("This envelope has already been signed by all parties.", 400);
    if (envelope.status === "voided") return err("This signing request has been cancelled.", 410);

    const signers = (envelope.signers as Array<{
      name: string;
      email: string;
      recipient_id: string;
      signature_id: string;
      status: string;
    }>) ?? [];
    const signer = signers.find((s) => s.recipient_id === payload.recipient_id);
    if (!signer) return err("Signer not found", 404);
    if (signer.status?.toLowerCase() === "completed" || signer.status?.toLowerCase() === "signed") {
      return err("You've already signed this document.", 400);
    }

    // Validate intake form responses against schema
    const allFields = (envelope.intake_form_fields as Array<{
      id: string;
      label: string;
      type: string;
      required?: boolean;
      recipient_id?: string;
    }>) ?? [];
    const formFields = allFields.filter(
      (f) => !f.recipient_id || f.recipient_id === payload.recipient_id,
    );
    const responses = intake_responses ?? {};
    const missing: string[] = [];
    for (const field of formFields) {
      if (field.required) {
        const v = responses[field.id];
        if (v === undefined || v === null || String(v).trim() === "") {
          missing.push(field.label);
        }
      }
    }
    if (missing.length > 0) {
      return err(`Please fill in: ${missing.join(", ")}`, 400);
    }

    // Persist intake responses (keyed by recipient_id so parallel signers don't clobber)
    if (formFields.length > 0) {
      const now = new Date().toISOString();
      await ddbClient.send(
        new UpdateCommand({
          TableName: ENVELOPES_TABLE,
          Key: { envelope_id: envelopeId },
          UpdateExpression: "SET intake_form_responses.#rid = :r, updated_at = :now",
          ExpressionAttributeNames: { "#rid": payload.recipient_id },
          ExpressionAttributeValues: {
            ":r": { responses, submitted_at: now },
            ":now": now,
          },
        }),
      );
    }

    // Mint a fresh Dropbox Sign embedded signing URL using signature_id
    if (!signer.signature_id) {
      return err("Signer does not have an associated signature_id", 500);
    }

    const apiKey = await getApiKey();
    const basicAuth = Buffer.from(`${apiKey}:`).toString("base64");

    const response = await fetch(`${DS_BASE_URL}/embedded/sign_url/${signer.signature_id}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });

    const responseData: any = await response.json();
    if (!response.ok) {
      console.error("[SIGN-LINK-START] Dropbox Sign API error:", responseData);
      throw new Error(`Dropbox Sign error: ${JSON.stringify(responseData.error || responseData)}`);
    }

    const signingUrl = responseData.embedded?.sign_url;
    if (!signingUrl) {
      throw new Error("Dropbox Sign did not return a signing URL");
    }

     return ok({
      signing_url: signingUrl,
      envelope_id: envelopeId,
      signer_email: signer.email,
      client_id: process.env.DROPBOX_SIGN_CLIENT_ID,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SIGN-LINK-START] Error:", error);
    return err(message, 500);
  }
};
