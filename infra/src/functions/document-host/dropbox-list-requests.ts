/**
 * GET /documents/{documentId}/sign/envelopes
 *
 * Lists all Dropbox Sign signature requests for a given document.
 * Returns request status, signer statuses, and metadata.
 */

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { extractUser } from "./doc-auth";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const ENVELOPES_TABLE = process.env.DROPBOX_SIGN_REQUESTS_TABLE ?? process.env.DOCUSIGN_ENVELOPES_TABLE!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const user = extractUser(event);
    const documentId = event.pathParameters?.documentId;
    if (!documentId) return err("documentId is required", 400);

    // Verify document exists
    const docRes = await ddbClient.send(
      new GetCommand({ TableName: DOCS_TABLE, Key: { document_id: documentId } }),
    );
    if (!docRes.Item || docRes.Item.is_deleted) return err("Document not found", 404);

    const doc = docRes.Item;
    const isAdmin = user.role === "admin" || user.role === "superadmin";
    const isOwner = doc.owner_email?.toLowerCase() === user.email.toLowerCase();

    // Query signature requests by document_id using GSI
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: ENVELOPES_TABLE,
        IndexName: "GSI_DocumentId",
        KeyConditionExpression: "document_id = :d",
        ExpressionAttributeValues: { ":d": documentId },
        ScanIndexForward: false,
      }),
    );

    const envelopes = res.Items ?? [];

    if (isAdmin || isOwner) {
      return ok({ envelopes, count: envelopes.length });
    }

    // Otherwise, check if user is a signer in any of these requests
    const userEmail = user.email.toLowerCase();
    const allowedEnvelopes = envelopes.filter((env) => {
      const signers = (env.signers ?? []) as Array<{ email?: string }>;
      return signers.some((s) => s.email?.toLowerCase() === userEmail);
    });

    if (allowedEnvelopes.length === 0) {
      return err("Access denied", 403);
    }

    return ok({ envelopes: allowedEnvelopes, count: allowedEnvelopes.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DROPBOX-LIST-REQUESTS] Error:", error);
    return err(message, 500);
  }
};
