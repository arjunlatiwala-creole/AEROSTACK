/**
 * POST /documents/{documentId}/sign/envelopes/{envelopeId}/signing-url
 *
 * Returns a fresh embedded signing URL for a specific signer.
 * Used when a signer wants to sign from within Aerostack (embedded signing ceremony in iframe).
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { extractUser } from "./doc-auth";
import { createSignLinkToken } from "./sign-link-token";

const ENVELOPES_TABLE = process.env.DROPBOX_SIGN_REQUESTS_TABLE ?? process.env.DOCUSIGN_ENVELOPES_TABLE!;
const DS_API_KEY_SECRET = process.env.DROPBOX_SIGN_API_KEY_SECRET!;
const DS_BASE_URL = process.env.DROPBOX_SIGN_BASE_URL!;

const smClient = new SecretsManagerClient({});

async function getApiKey(): Promise<string> {
  const res = await smClient.send(
    new GetSecretValueCommand({ SecretId: DS_API_KEY_SECRET }),
  );
  return res.SecretString!.trim();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const user = extractUser(event);
    const documentId = event.pathParameters?.documentId;
    const envelopeId = event.pathParameters?.envelopeId;
    if (!documentId || !envelopeId) return err("documentId and envelopeId are required", 400);

    const body = JSON.parse(event.body ?? "{}");
    const { signer_email } = body as { signer_email: string };
    if (!signer_email) return err("signer_email is required", 400);

    // Load envelope record
    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    );
    const envelope = envRes.Item;
    if (!envelope || envelope.document_id !== documentId) {
      return err("Envelope not found", 404);
    }

    // Allow: the signer themselves, the creator, or an admin
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isCreator = envelope.created_by === user.email;
    const isSigner = signer_email.toLowerCase() === user.email.toLowerCase();
    if (!isAdmin && !isCreator && !isSigner) {
      return err("Access denied", 403);
    }

    // Find signer record
    const signers = (envelope.signers as Array<{ name: string; email: string; recipient_id: string; signature_id?: string; sign_link?: string }>) ?? [];
    const signer = signers.find((s) => s.email.toLowerCase() === signer_email.toLowerCase());
    if (!signer) return err("Signer not found in this envelope", 404);

    if (envelope.status === "completed") {
      return err("Envelope is already completed — all parties have signed", 400);
    }
    if (envelope.status === "voided") {
      return err("Envelope has been voided", 400);
    }

    // Resolve local Aerostack magic link
    let signingUrl = signer.sign_link;
    if (!signingUrl) {
      const token = createSignLinkToken({
        envelope_id: envelopeId,
        document_id: documentId,
        signer_email: signer.email,
        recipient_id: signer.recipient_id,
      });
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      signingUrl = `${frontendUrl}/sign/${envelopeId}?token=${encodeURIComponent(token)}`;
    }

    return ok({
      signing_url: signingUrl,
      envelope_id: envelopeId,
      signer_email,
      client_id: process.env.DROPBOX_SIGN_CLIENT_ID,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DROPBOX-GET-SIGNING-URL] Error:", error);
    return err(message, 500);
  }
};
