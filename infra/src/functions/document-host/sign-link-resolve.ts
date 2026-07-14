/**
 * GET /documents/sign/link/{envelopeId}?token=<sign-link-token>
 *
 * Public, no-auth endpoint hit by the Aerostack sign landing page.
 *
 * Verifies the magic-link token, returns just enough info for the page to:
 *   1) render the document title + sender + intake form schema
 *   2) decide if the form has already been answered
 *   3) display signer status
 *
 * Does NOT mint a DocuSign signing URL — that happens after intake form
 * submission, via /documents/sign/link/{envelopeId}/start.
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { verifySignLinkToken } from "./sign-link-token";

const ENVELOPES_TABLE = process.env.DOCUSIGN_ENVELOPES_TABLE!;
const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const envelopeId = event.pathParameters?.envelopeId;
    const token = event.queryStringParameters?.token;
    if (!envelopeId || !token) return err("envelopeId and token are required", 400);

    let payload;
    try {
      payload = verifySignLinkToken(token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invalid token";
      return err(msg, 401);
    }
    if (payload.envelope_id !== envelopeId) return err("Token does not match envelope", 403);

    const envRes = await ddbClient.send(
      new GetCommand({ TableName: ENVELOPES_TABLE, Key: { envelope_id: envelopeId } }),
    );
    const envelope = envRes.Item;
    if (!envelope) return err("Envelope not found", 404);
    if (envelope.status === "voided") return err("This signing request has been cancelled.", 410);

    const docRes = await ddbClient.send(
      new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: payload.document_id } }),
    );
    const doc = docRes.Item;

    const signers = (envelope.signers as Array<{
      email: string;
      name: string;
      role_label: string;
      recipient_id: string;
      status: string;
    }>) ?? [];
    const me = signers.find((s) => s.recipient_id === payload.recipient_id);
    if (!me) return err("Signer not found in envelope", 404);

    // Sequential routing: only the active signer can act. Earlier signers
    // who already finished still see the page (read-only "you've signed");
    // later signers see "waiting for prior signers."
    const activeRecipientId = (envelope.active_recipient_id as string | null) ?? "1";
    const myStatus = me.status?.toLowerCase();
    const alreadySigned = myStatus === "completed" || myStatus === "signed";
    const isMyTurn = activeRecipientId === payload.recipient_id;
    const waitingOnEarlier = !alreadySigned && !isMyTurn;

    // Per-recipient intake form filtering: only show fields tagged for this
    // signer (or untagged fields shared across all signers).
    const allFields = (envelope.intake_form_fields as Array<{
      id: string;
      label: string;
      type: string;
      required?: boolean;
      recipient_id?: string;
    }>) ?? [];
    const myFields = allFields.filter(
      (f) => !f.recipient_id || f.recipient_id === payload.recipient_id,
    );

    // Has this signer already submitted intake answers?
    const responses = (envelope.intake_form_responses as Record<string, Record<string, unknown>>) ?? {};
    const myResponses = responses[payload.recipient_id] ?? null;

    return ok({
      envelope_id: envelopeId,
      document_id: payload.document_id,
      document_title: doc?.title ?? "Document",
      sender_email: envelope.created_by,
      status: envelope.status,
      me: {
        name: me.name,
        email: me.email,
        role_label: me.role_label,
        recipient_id: me.recipient_id,
        status: me.status,
      },
      signers: signers.map((s) => ({
        name: s.name,
        role_label: s.role_label,
        status: s.status,
      })),
      intake_form_fields: myFields,
      intake_form_responses: myResponses,
      intake_form_already_submitted: myResponses !== null,
      already_signed: alreadySigned,
      is_my_turn: isMyTurn,
      waiting_on_earlier_signers: waitingOnEarlier,
      active_recipient_id: activeRecipientId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SIGN-LINK-RESOLVE] Error:", error);
    return err(message, 500);
  }
};
