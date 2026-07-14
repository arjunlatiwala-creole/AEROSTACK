import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { extractUser, canModifyDocument } from "./doc-auth";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
const ACCESS_TABLE = process.env.DOCUMENT_ACCESS_TABLE_NAME;
const GOOGLE_DRIVE_SA_SECRET_NAME = process.env.GOOGLE_DRIVE_SA_SECRET_NAME;

if (!DOCS_TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");
if (!ACCESS_TABLE) throw new Error("DOCUMENT_ACCESS_TABLE_NAME is required");

const secretsManager = new SecretsManagerClient({});

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Lists access grants for a document.
 * - Owners & Admins/Super-admins can see all permissions.
 * - Regular users can only see their own permission record (if any).
 * Route: GET /documents/{documentId}/access
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return err("documentId path parameter is required", 400);
    }

    const caller = extractUser(event);

    // 1. Fetch document record to check provider and owner
    const docResult = await ddbClient.send(
      new GetCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
      }),
    );

    const doc = docResult.Item;
    if (!doc || doc.is_deleted) {
      return err("Document not found", 404);
    }

    const isAuthorizedToSeeAll = canModifyDocument(caller, doc);

    // 2. If Google Drive document, attempt to fetch permissions live from Google Drive
    if (doc.source_provider === "google_drive" && doc.source_id && GOOGLE_DRIVE_SA_SECRET_NAME) {
      try {
        console.log(`[LIST-ACCESS] Fetching live permissions from Google Drive for file: ${doc.source_id}`);
        const secretResult = await secretsManager.send(
          new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
        );
        const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
        
        // We use the read-only drive scope since we are only listing permissions
        const accessToken = await getAccessToken(
          saKey,
          doc.owner_email || "system@enterprise.io",
          "https://www.googleapis.com/auth/drive.readonly",
        );

        const driveUrl = `https://www.googleapis.com/drive/v3/files/${doc.source_id}/permissions?fields=permissions(id,emailAddress,role,type,domain)`;
        const driveRes = await fetch(driveUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!driveRes.ok) {
          const errText = await driveRes.text();
          throw new Error(`Google Drive API returned ${driveRes.status}: ${errText}`);
        }

        const driveData = (await driveRes.json()) as {
          permissions?: Array<{
            id: string;
            emailAddress?: string;
            role: string;
            type: string;
            domain?: string;
          }>;
        };

        const permissions = driveData.permissions ?? [];
        console.log(`[LIST-ACCESS] Successfully fetched ${permissions.length} permissions from Google Drive`);

        // Construct the accessList to return based on the caller's authorization
        let accessList: any[] = [];

        if (isAuthorizedToSeeAll) {
          // Owners & Admins see everything as it is
          accessList = permissions
            .filter((p) => p.role !== "owner")
            .map((p) => {
              let granteeId = "";
              if (p.type === "anyone") {
                granteeId = "Anyone with link";
              } else if (p.type === "domain") {
                granteeId = p.domain || "Domain members";
              } else {
                granteeId = p.emailAddress || "";
              }

              return {
                access_id: p.id,
                document_id: documentId,
                grantee_type: p.type === "group" ? "group" : p.type === "user" ? "person" : p.type,
                grantee_id: granteeId,
                permission: p.role === "writer" ? "edit" : "view",
                granted_by: "drive",
                granted_at: new Date().toISOString(),
              };
            })
            .filter((a) => a.grantee_id !== "");
        } else {
          // Regular users check if they have access via any of the rules
          const callerEmail = caller.email.toLowerCase();
          for (const p of permissions) {
            let hasAccess = false;
            if (p.type === "anyone") {
              hasAccess = true;
            } else if (p.type === "domain" && p.domain) {
              const domain = p.domain.toLowerCase();
              if (callerEmail.endsWith("@" + domain) || callerEmail.endsWith("." + domain)) {
                hasAccess = true;
              }
            } else if (p.emailAddress && p.emailAddress.toLowerCase() === callerEmail) {
              hasAccess = true;
            }

            if (hasAccess && p.role !== "owner") {
              accessList.push({
                access_id: p.id,
                document_id: documentId,
                grantee_type: "person",
                grantee_id: caller.email,
                permission: p.role === "writer" ? "edit" : "view",
                granted_by: "drive",
                granted_at: new Date().toISOString(),
              });
            }
          }
        }

        console.log(`[LIST-ACCESS] Drive mapped permissions count: ${accessList.length}. Details:`, 
          accessList.map(a => `${a.grantee_id}: ${a.permission}`)
        );

        return ok({
          access: accessList,
          count: accessList.length,
        });
      } catch (driveErr) {
        console.warn("[LIST-ACCESS] Failed to fetch live Google Drive permissions, falling back to local DB:", driveErr);
      }
    }

    // 3. Fallback: Query ACCESS_TABLE for manual or failed-to-fetch drive docs
    const result = await ddbClient.send(
      new QueryCommand({
        TableName: ACCESS_TABLE,
        KeyConditionExpression: "document_id = :did",
        ExpressionAttributeValues: { ":did": documentId },
      }),
    );

    let accessList = result.Items ?? [];
    
    console.log(`[LIST-ACCESS] Local DB permission records count: ${accessList.length}. Details:`,
      accessList.map(a => `${a.grantee_id}: ${a.permission}`)
    );

    // Filter permissions based on user role (security filter) for local DB results
    if (!isAuthorizedToSeeAll) {
      accessList = accessList.filter(
        (p) => p.grantee_id.toLowerCase() === caller.email.toLowerCase()
      );
    }

    return ok({
      access: accessList,
      count: accessList.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error listing access:", error);
    return err(message, 500);
  }
};

async function getAccessToken(
  saKey: ServiceAccountKey,
  impersonateEmail: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: saKey.client_email,
      sub: impersonateEmail,
      scope,
      aud: saKey.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

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
    throw new Error(`Token exchange failed: ${tokenRes.status} - ${errBody}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  return tokenData.access_token;
}

export const handler = withPermissions(_handler);
