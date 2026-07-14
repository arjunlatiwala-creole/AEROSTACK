import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError } from "../shared/auth-utils";
import {
  parseDeltaClaims,
  computeEffectivePermissions,
  resolveGivenRoleFromGroups,
} from "../shared/claims-utils";

interface ResolvedIdentity {
  personId: string | null;
  email: string;
}

function resolveIdentity(event: APIGatewayProxyEvent): ResolvedIdentity {
  // 1. Try claims first
  const claims =
    (event.requestContext as any).authorizer?.claims ||
    (event.requestContext as any).authorizer?.jwt?.claims;

  if (claims?.sub) {
    return {
      personId: claims.sub,
      email: claims.email || claims["cognito:username"] || "",
    };
  }

  // 2. Decode JWT from Authorization header
  const token =
    event.headers?.Authorization || event.headers?.authorization || "";

  if (token) {
    try {
      const parts = token.replace(/^Bearer\s+/i, "").split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        return {
          personId: payload.sub || null,
          email: payload.email || payload["cognito:username"] || "",
        };
      }
    } catch {}
  }

  return { personId: null, email: "" };
}

/**
 * Attempts to resolve givenRole from JWT claims.
 * Returns the role string when the pre-token trigger has been deployed and
 * the user is in a Cognito group; returns null otherwise (signals fallback).
 */
function resolveGivenRoleFromClaims(
  event: APIGatewayProxyEvent,
): string | null {
  const claims =
    (event.requestContext as any).authorizer?.claims ||
    (event.requestContext as any).authorizer?.jwt?.claims;

  if (!claims) return null;

  // Pre-token trigger injects `givenRole` directly into the token.
  if (claims["givenRole"]) return claims["givenRole"] as string;

  // Fallback: derive from cognito:groups if available.
  const groupsRaw = claims["cognito:groups"];
  if (groupsRaw) {
    const groups =
      typeof groupsRaw === "string" ? groupsRaw.split(",") : [];
    if (groups.length > 0) return resolveGivenRoleFromGroups(groups);
  }

  return null;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const authResult = authorizeUser(event);
  if (isAuthError(authResult)) return authResult.error;

  const tableName = process.env.PERSON_TABLE_NAME!;

  const { personId: resolvedId, email: emailClaims } = resolveIdentity(event);
  const personId = resolvedId || authResult.user.sub;

  const isWillAccount =
    typeof emailClaims === "string" &&
    emailClaims.toLowerCase() === "will@enterprise.io";

  // ------------------------------------------------------------------
  // Claims path: if the pre-token trigger has run and assigned a group,
  // return claims-derived permissions without a DynamoDB lookup.
  // ------------------------------------------------------------------
  const claimsGivenRole = resolveGivenRoleFromClaims(event);

  if (claimsGivenRole) {
    const givenRole = isWillAccount ? "Super-Admin" : claimsGivenRole;

    const deltasRaw: string | undefined =
      ((event.requestContext as any).authorizer?.claims ||
        (event.requestContext as any).authorizer?.jwt?.claims)?.[
        "custom:rbac_deltas"
      ];
    const deltas = parseDeltaClaims(deltasRaw);
    const userRole = computeEffectivePermissions(givenRole, deltas);

    return ok({ personId, userRole, givenRole });
  }

  // ------------------------------------------------------------------
  // DynamoDB fallback (unmigrated users without Cognito group assignment)
  // ------------------------------------------------------------------
  try {
    const result = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": personId },
        Limit: 1,
      }),
    );

    const person = result.Items?.[0];

    const storedRole: string = (person?.givenRole as string) || "User";
    const givenRole: string = isWillAccount ? "Super-Admin" : storedRole;

    const shouldUpdate =
      person &&
      (!person.givenRole ||
        (isWillAccount && person.givenRole !== "Super-Admin"));

    if (shouldUpdate) {
      await ddbClient
        .send(
          new UpdateCommand({
            TableName: tableName,
            Key: { personId: person!.personId, createdAt: person!.createdAt },
            UpdateExpression: "SET givenRole = :role",
            ExpressionAttributeValues: { ":role": givenRole },
          }),
        )
        .catch(() => {});
    }

    return ok({
      personId,
      userRole: person?.userRole || null,
      givenRole,
    });
  } catch (error: any) {
    console.error("Error fetching my role:", error);
    return err(error.message || "Failed to fetch role", 500);
  }
};
