import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError } from "../shared/auth-utils";
import { withPermissions } from "../shared/permission-middleware";

const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * Priority score for deduplication: higher = preferred identity to keep.
 * CONFIRMED email accounts rank above external-provider (Google SSO) accounts
 * so the native account wins when both exist for the same email.
 */
function identityScore(status: string): number {
  if (status === "CONFIRMED") return 3;
  if (status === "FORCE_CHANGE_PASSWORD") return 2;
  if (status === "EXTERNAL_PROVIDER") return 1;
  return 0;
}

const _handler: APIGatewayProxyHandler = async (event) => {
  const authResult = authorizeUser(event);
  if (isAuthError(authResult)) return authResult.error;

  const tableName = process.env.PERSON_TABLE_NAME!;
  const userPoolId = process.env.USER_POOL_ID!;

  try {
    const personItems: Record<string, any>[] = [];
    let lastKey: Record<string, any> | undefined;

    do {
      const scanResult = await ddbClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
        }),
      );
      if (scanResult.Items) personItems.push(...scanResult.Items);
      lastKey = scanResult.LastEvaluatedKey;
    } while (lastKey);

    const cognitoUsers = new Map<
      string,
      { email: string; status: string; emailVerified: boolean }
    >();
    let paginationToken: string | undefined;

    do {
      const listResult = await cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Limit: 60,
          PaginationToken: paginationToken,
        }),
      );

      for (const user of listResult.Users || []) {
        const email =
          user.Attributes?.find((a) => a.Name === "email")?.Value || "";
        const emailVerified =
          user.Attributes?.find((a) => a.Name === "email_verified")?.Value ===
          "true";
        cognitoUsers.set(user.Username!, {
          email,
          status: user.UserStatus || "UNKNOWN",
          emailVerified,
        });
      }

      paginationToken = listResult.PaginationToken;
    } while (paginationToken);

    // Build the full user list, then deduplicate by email address.
    // When a user has two Cognito identities (e.g. email + Google SSO),
    // DynamoDB holds two records. We keep the one whose Cognito status has
    // the highest priority (CONFIRMED > EXTERNAL_PROVIDER) and merge the
    // userRole/givenRole from whichever record has data.
    const rawUsers = personItems.map((person) => {
      const cognito = cognitoUsers.get(person.personId);
      const email = cognito?.email || "N/A";
      const isWillAccount = email.toLowerCase() === "will@enterprise.io";

      return {
        personId: person.personId,
        createdAt: person.createdAt,
        email,
        status: cognito?.status || "UNKNOWN",
        emailVerified: cognito?.emailVerified ?? false,
        userRole: person.userRole || null,
        givenRole: isWillAccount ? "Super-Admin" : (person.givenRole || "User"),
        updatedAt: person.updatedAt || null,
        updated_by: person.updated_by || person.updatedBy || null,
      };
    });

    // Deduplicate: for each email keep the highest-priority identity.
    // Merge userRole and givenRole from the duplicate (prefer non-default values).
    const byEmail = new Map<string, (typeof rawUsers)[0]>();

    for (const user of rawUsers) {
      const key = user.email.toLowerCase();
      const existing = byEmail.get(key);

      if (!existing) {
        byEmail.set(key, user);
        continue;
      }

      const existingScore = identityScore(existing.status);
      const currentScore = identityScore(user.status);

      // Pick the higher-priority identity as the base.
      const winner = currentScore >= existingScore ? user : existing;
      const loser = currentScore >= existingScore ? existing : user;

      // Merge: take userRole / givenRole from whichever record has custom data.
      byEmail.set(key, {
        ...winner,
        userRole: winner.userRole ?? loser.userRole,
        givenRole:
          winner.givenRole !== "User"
            ? winner.givenRole
            : loser.givenRole,
      });
    }

    const users = Array.from(byEmail.values());

    return ok({ users });
  } catch (error: any) {
    console.error("Error listing users:", error);
    return err(error.message || "Failed to list users", 500);
  }
};

export const handler = withPermissions(_handler);
