import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { extractUser, canModifyDocument } from "./doc-auth";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) {
  throw new Error("DOCUMENTS_TABLE_NAME is required");
}

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const body = JSON.parse(event.body ?? "{}");
    const { title, slug, description, visibility, tags, signing_template } = body;

    // Verify document exists
    const existing = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
      }),
    );

    if (!existing.Item || existing.Item.is_deleted) {
      return err("Document not found", 404);
    }

    // Ownership check: admin/superadmin can edit any, others only their own
    const user = extractUser(event);
    if (!canModifyDocument(user, existing.Item)) {
      return err("You can only edit your own documents", 403);
    }

    // If slug is changing, check uniqueness
    if (slug && slug !== existing.Item.slug) {
      const slugCheck = await ddbClient.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "GSI_Slug",
          KeyConditionExpression: "slug = :s",
          ExpressionAttributeValues: { ":s": slug },
          Limit: 1,
        }),
      );

      if (slugCheck.Items && slugCheck.Items.length > 0) {
        return err(`Slug "${slug}" is already in use`, 409);
      }
    }

    const updateParts: string[] = ["#updated_at = :now"];
    const exprNames: Record<string, string> = { "#updated_at": "updated_at" };
    const exprValues: Record<string, unknown> = {
      ":now": new Date().toISOString(),
    };

    if (title !== undefined) {
      updateParts.push("#title = :title");
      exprNames["#title"] = "title";
      exprValues[":title"] = title;
    }
    if (slug !== undefined) {
      updateParts.push("#slug = :slug");
      exprNames["#slug"] = "slug";
      exprValues[":slug"] = slug;
    }
    if (description !== undefined) {
      updateParts.push("#description = :description");
      exprNames["#description"] = "description";
      exprValues[":description"] = description;
    }
    if (visibility !== undefined) {
      if (!["public", "internal", "restricted"].includes(visibility)) {
        return err("visibility must be public, internal, or restricted", 400);
      }
      if (existing.Item.source_provider !== "manual") {
        return err("Visibility can only be modified for manually uploaded documents. Please change sharing options in the source provider to synchronize.", 400);
      }
      updateParts.push("#visibility = :visibility");
      exprNames["#visibility"] = "visibility";
      exprValues[":visibility"] = visibility;
    }
    if (tags !== undefined) {
      updateParts.push("#tags = :tags");
      exprNames["#tags"] = "tags";
      exprValues[":tags"] = tags;
    }
    if (signing_template !== undefined) {
      // Reusable signing template saved on the document. Format:
      //   { intake_form_fields, field_markers, signers? (role labels only),
      //     email_subject?, email_body? }
      // Sender opens the Send-for-Signature dialog → these auto-prefill so
      // they only need to add the counterparty's name + email.
      updateParts.push("#signing_template = :st");
      exprNames["#signing_template"] = "signing_template";
      exprValues[":st"] = signing_template;
    }

    const result = await ddbClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { document_id: documentId },
        UpdateExpression: `SET ${updateParts.join(", ")}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: "ALL_NEW",
      }),
    );

    return ok(result.Attributes);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error updating document:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
