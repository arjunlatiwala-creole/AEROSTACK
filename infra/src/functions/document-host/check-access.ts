import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { extractUser } from "./doc-auth";

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
 * Checks view access for a list of document IDs in a single batch request.
 * Route: POST /documents/check-access
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const caller = extractUser(event);
    const body = JSON.parse(event.body ?? "{}");
    const documentIds: string[] = body.document_ids ?? [];

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return ok({ access: {} });
    }

    const accessMap: Record<string, boolean> = {};
    const signersMap: Record<string, Array<{ name: string; email: string; role_label: string; status?: string }>> = {};

    // 1. Fetch all documents in parallel
    const docs = await Promise.all(
      documentIds.map(async (id) => {
        try {
          const res = await ddbClient.send(
            new GetCommand({
              TableName: DOCS_TABLE,
              Key: { document_id: id },
            })
          );
          return res.Item;
        } catch {
          return null;
        }
      })
    );

    // Filter documents and separate Google Drive docs from other docs
    const docMap = new Map<string, any>();
    const driveDocs: any[] = [];

    for (let i = 0; i < documentIds.length; i++) {
      const id = documentIds[i];
      const doc = docs[i];
      if (doc && !doc.is_deleted) {
        docMap.set(id, doc);
        
        const tags = (doc.tags ?? []) as string[];
        const isSigned = tags.some((t) => ["signed", "esign", "e-sign"].includes(t.toLowerCase()));

        if (caller.role === "admin" || caller.role === "superadmin") {
          accessMap[id] = true;
        } else if (doc.owner_email?.toLowerCase() === caller.email.toLowerCase()) {
          accessMap[id] = true;
        } else if (!isSigned && (doc.visibility === "public" || doc.visibility === "internal")) {
          accessMap[id] = true;
        } else if (!isSigned && doc.source_provider === "google_drive" && doc.source_id) {
          driveDocs.push(doc);
        }
      } else {
        accessMap[id] = false;
      }
    }

    // 2. Fetch Google Drive credentials and token once, if there are any Google Drive docs
    let driveAccessToken: string | null = null;
    if (driveDocs.length > 0 && GOOGLE_DRIVE_SA_SECRET_NAME) {
      try {
        const secretResult = await secretsManager.send(
          new GetSecretValueCommand({ SecretId: GOOGLE_DRIVE_SA_SECRET_NAME }),
        );
        const saKey: ServiceAccountKey = JSON.parse(secretResult.SecretString!);
        // Use the owner email of the first doc or fallback to system
        const impersonateEmail = driveDocs[0].owner_email || "system@enterprise.io";
        driveAccessToken = await getAccessToken(
          saKey,
          impersonateEmail,
          "https://www.googleapis.com/auth/drive.readonly",
        );
      } catch (tokenErr) {
        console.error("[CHECK-ACCESS] Failed to get Google Drive access token:", tokenErr);
      }
    }

    // Helper to fetch envelopes and signers
    const fetchAndPopulateSigners = async (docId: string) => {
      const ENVELOPES_TABLE = process.env.DOCUSIGN_ENVELOPES_TABLE;
      if (ENVELOPES_TABLE) {
        try {
          const envResult = await ddbClient.send(
            new QueryCommand({
              TableName: ENVELOPES_TABLE,
              IndexName: "GSI_DocumentId",
              KeyConditionExpression: "document_id = :d",
              ExpressionAttributeValues: { ":d": docId },
            }),
          );
          const envelopes = envResult.Items ?? [];
          const list: any[] = [];
          envelopes.forEach((env) => {
            const signers = (env.signers ?? []) as Array<{ name: string; email: string; role_label: string; status?: string }>;
            signers.forEach((s) => {
              list.push({
                name: s.name,
                email: s.email,
                role_label: s.role_label,
                status: s.status,
              });
            });
          });
          signersMap[docId] = list;
          return envelopes;
        } catch (envErr) {
          console.warn(`[CHECK-ACCESS] Envelope lookup failed for document ${docId}:`, envErr);
        }
      }
      return [];
    };

    // 3. Process all remaining checks in parallel
    await Promise.all(
      documentIds.map(async (id) => {
        const doc = docMap.get(id);

        // If already resolved (public/owner/admin/not found), skip but populate signers if signed
        if (accessMap[id] !== undefined) {
          if (doc) {
            const tags = (doc.tags ?? []) as string[];
            const isSigned = tags.some((t) => ["signed", "esign", "e-sign"].includes(t.toLowerCase()));
            if (isSigned) {
              await fetchAndPopulateSigners(id);
            }
          }
          return;
        }

        if (!doc) {
          accessMap[id] = false;
          return;
        }

        const tags = (doc.tags ?? []) as string[];
        const isSigned = tags.some((t) => ["signed", "esign", "e-sign"].includes(t.toLowerCase()));

        // STRICT SIGNED ACCESS CHECK: If signed, caller must be owner/admin or signer
        if (isSigned) {
          const envelopes = await fetchAndPopulateSigners(id);
          const isSigner = envelopes.some((env) => {
            const signers = (env.signers ?? []) as Array<{ email?: string }>;
            return signers.some((s) => s.email?.toLowerCase() === caller.email.toLowerCase());
          });
          accessMap[id] = isSigner;
          return;
        }

        // If it's Google Drive and we have a token
        if (doc.source_provider === "google_drive" && doc.source_id && driveAccessToken) {
          try {
            const driveUrl = `https://www.googleapis.com/drive/v3/files/${doc.source_id}/permissions?fields=permissions(id,emailAddress,role,type,domain)`;
            const driveRes = await fetch(driveUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${driveAccessToken}`,
              },
            });

            if (driveRes.ok) {
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
              const callerEmail = caller.email.toLowerCase();

              let hasAccess = false;
              for (const p of permissions) {
                if (p.role === "owner") continue;

                if (p.type === "anyone") {
                  hasAccess = true;
                  break;
                } else if (p.type === "domain" && p.domain) {
                  const domain = p.domain.toLowerCase();
                  if (callerEmail.endsWith("@" + domain) || callerEmail.endsWith("." + domain)) {
                    hasAccess = true;
                    break;
                  }
                } else if (p.emailAddress && p.emailAddress.toLowerCase() === callerEmail) {
                  hasAccess = true;
                  break;
                }
              }

              accessMap[id] = hasAccess;
              return;
            }
          } catch (driveErr) {
            console.warn(`[CHECK-ACCESS] Drive fetch failed for ${id}, falling back to DB:`, driveErr);
          }
        }

        // Fallback for failed Drive fetch OR Manual/Canva docs
        try {
          const result = await ddbClient.send(
            new QueryCommand({
              TableName: ACCESS_TABLE,
              KeyConditionExpression: "document_id = :did",
              FilterExpression: "grantee_id = :gid",
              ExpressionAttributeValues: {
                ":did": id,
                ":gid": caller.email.toLowerCase(),
              },
            }),
          );
          accessMap[id] = (result.Items ?? []).length > 0;
        } catch (dbErr) {
          console.error(`[CHECK-ACCESS] DB lookup failed for ${id}:`, dbErr);
          accessMap[id] = false;
        }
      })
    );

    return ok({ access: accessMap, signers: signersMap });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error checking batch access:", error);
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
