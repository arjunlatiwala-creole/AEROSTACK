import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
  Callback,
} from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import {
  parseDeltaClaims,
  computeEffectivePermissions,
  checkPermissionFromMap,
  resolveGivenRoleFromGroups,
  type RbacMode,
} from "./claims-utils";

export interface PermissionCheckResult {
  allowed: boolean;
  error?: APIGatewayProxyResult;
  userRole?: Record<string, any> | null;
}

/**
 * Wraps a Lambda handler with automatic permission checking.
 *
 * Rollout is controlled by the RBAC_MODE environment variable:
 *   db_only      — existing DynamoDB-backed check (default, safe)
 *   claims_then_db — check JWT claims first; fall back to DynamoDB when
 *                    the `givenRole` claim is absent (phased migration)
 *   claims_only  — always derive permissions from JWT claims; skip DynamoDB
 *
 * Generic so it works with both APIGatewayProxyHandler and V2 variants.
 */
export function withPermissions<T extends (...args: any[]) => any>(
  handler: T,
): T {
  const wrapped = async (
    event: APIGatewayProxyEvent,
    context: Context,
    callback: Callback<APIGatewayProxyResult>,
  ): Promise<APIGatewayProxyResult> => {
    const tableName = process.env.PERSON_TABLE_NAME;
    if (tableName) {
      const result = await checkPermission(event, tableName);
      if (!result.allowed) return result.error!;
    }
    return (handler as Function)(event, context, callback);
  };
  return wrapped as unknown as T;
}

/**
 * Reusable permission middleware for Lambda handlers.
 *
 * Reads the `X-Resource-Key` header (e.g. "operations/revops") and determines
 * whether the caller has the required access type using the active RBAC_MODE.
 *
 * Rules (all modes):
 *  - No X-Resource-Key header → allow (backward compat)
 *  - No identifiable user → deny (except in SAM local)
 *  - GET → needs "read"; POST/PUT/PATCH/DELETE → needs "write"
 */
export async function checkPermission(
  event: APIGatewayProxyEvent,
  personTableName: string,
): Promise<PermissionCheckResult> {
  const resourceKey =
    event.headers?.["X-Resource-Key"] ||
    event.headers?.["x-resource-key"];

  if (!resourceKey) return { allowed: true };

  const mode = (process.env.RBAC_MODE || "db_only") as RbacMode;
  const method = event.httpMethod?.toUpperCase() || "GET";
  const accessType = method === "GET" ? "read" : "write";

  // ------------------------------------------------------------------
  // Claims path: db_only falls straight through to DynamoDB below.
  // ------------------------------------------------------------------
  if (mode === "claims_only" || mode === "claims_then_db") {
    const claimsResult = checkPermissionFromClaims(
      event,
      resourceKey,
      accessType,
    );

    if (claimsResult !== null) return claimsResult;

    // `claims_only` never falls back to DynamoDB; treat missing claims as the
    // role-default (User) and check against that.
    if (mode === "claims_only") {
      return { allowed: accessType === "read" };
    }
    // `claims_then_db` falls through to the DynamoDB path below.
  }

  // ------------------------------------------------------------------
  // DynamoDB path (original behavior)
  // ------------------------------------------------------------------
  let personId = event.requestContext.authorizer?.claims?.sub;

  if (!personId && process.env.AWS_SAM_LOCAL === "true") {
    const token =
      event.headers?.Authorization || event.headers?.authorization;
    if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(parts[1], "base64").toString(),
          );
          personId = payload.sub;
        }
      } catch {
        // ignore decode errors
      }
    }
  }

  if (!personId) {
    if (process.env.AWS_SAM_LOCAL === "true") return { allowed: true };
    return {
      allowed: false,
      error: forbidden("Unable to identify user"),
    };
  }

  try {
    const result = await ddbClient.send(
      new QueryCommand({
        TableName: personTableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": personId },
        Limit: 1,
      }),
    );

    const person = result.Items?.[0];
    const userRole = person?.userRole;

    if (!userRole) return { allowed: true, userRole: null };

    const parts = resourceKey.split("/");
    let permissions: string[] | undefined;

    if (parts.length === 1) {
      permissions = userRole[parts[0]];
    } else {
      const [group, item] = parts;
      permissions = userRole[group]?.[item];
    }

    if (!permissions) return { allowed: true, userRole };

    if (Array.isArray(permissions)) {
      const hasRead =
        permissions.includes("read") || permissions.includes("write");
      const hasWrite = permissions.includes("write");

      if (
        (accessType === "read" && hasRead) ||
        (accessType === "write" && hasWrite)
      ) {
        return { allowed: true, userRole };
      }
    }

    return {
      allowed: false,
      error: forbidden(
        `You don't have ${accessType} access to ${resourceKey}`,
      ),
    };
  } catch (error) {
    console.error("Permission check failed:", error);
    return { allowed: true };
  }
}

/**
 * Checks permission from JWT claims alone.
 * Returns null when the `givenRole` claim is absent (signals fallback needed).
 */
function checkPermissionFromClaims(
  event: APIGatewayProxyEvent,
  resourceKey: string,
  accessType: "read" | "write",
): PermissionCheckResult | null {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) return null;

  // `givenRole` is injected by the Pre-Token Generation trigger.
  let givenRole: string | undefined = claims["givenRole"];

  if (!givenRole) {
    // Fallback: derive from cognito:groups if pre-token trigger hasn't run yet.
    const groupsRaw = claims["cognito:groups"];
    if (groupsRaw) {
      const groups =
        typeof groupsRaw === "string" ? groupsRaw.split(",") : [];
      givenRole = resolveGivenRoleFromGroups(groups);
    }
  }

  // No group info at all → signal caller to fall back.
  if (!givenRole) return null;

  const deltasRaw: string | undefined = claims["custom:rbac_deltas"];
  const deltas = parseDeltaClaims(deltasRaw);
  const userRole = computeEffectivePermissions(givenRole, deltas);

  const allowed = checkPermissionFromMap(userRole, resourceKey, accessType);

  if (allowed) return { allowed: true, userRole };

  return {
    allowed: false,
    error: forbidden(`You don't have ${accessType} access to ${resourceKey}`),
  };
}

function forbidden(message: string): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify({
      success: false,
      error: message,
      code: "FORBIDDEN",
    }),
  };
}
