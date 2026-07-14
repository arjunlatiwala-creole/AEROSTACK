import type { APIGatewayProxyHandler } from "aws-lambda";
import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError, GivenRole } from "../shared/auth-utils";
import { withPermissions } from "../shared/permission-middleware";

const cognitoClient = new CognitoIdentityProviderClient({});

/** Hardcoded bootstrap Super-Admin that must never be deleted. */
const PROTECTED_EMAIL = "will@enterprise.io";

async function getCognitoEmail(personId: string, userPoolId: string): Promise<string> {
  try {
    const result = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: personId }),
    );
    return result.UserAttributes?.find((a) => a.Name === "email")?.Value || "";
  } catch {
    return "";
  }
}

/**
 * Finds every Cognito username sharing the given email address. A single person
 * can hold multiple identities (e.g. a native account plus a Google SSO
 * account) — `list-users.ts` dedupes these by email, so removal must clear all
 * of them, otherwise the duplicate identity could still sign in.
 */
async function findUsernamesByEmail(email: string, userPoolId: string): Promise<string[]> {
  if (!email) return [];
  const usernames = new Set<string>();
  let paginationToken: string | undefined;

  do {
    const result = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        // Cognito filter syntax requires the value wrapped in double quotes.
        Filter: `email = "${email}"`,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of result.Users || []) {
      if (user.Username) usernames.add(user.Username);
    }
    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return Array.from(usernames);
}

/** Deletes every DynamoDB person record for the given personId. */
async function deletePersonRecords(personId: string, tableName: string): Promise<void> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "personId = :pid",
      ExpressionAttributeValues: { ":pid": personId },
    }),
  );
  await Promise.all(
    (result.Items || []).map((item) =>
      ddbClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { personId: item.personId, createdAt: item.createdAt },
        }),
      ),
    ),
  );
}

const _handler: APIGatewayProxyHandler = async (event) => {
  const authResult = authorizeUser(event);
  if (isAuthError(authResult)) return authResult.error;

  const tableName = process.env.PERSON_TABLE_NAME!;
  const userPoolId = process.env.USER_POOL_ID!;
  const personId = event.pathParameters?.personId;

  if (!personId) {
    return err("personId is required", 400);
  }

  const requesterId = authResult.user.sub;

  if (requesterId === personId) {
    return err("You cannot remove your own account", 400);
  }

  try {
    // Fetch requester's givenRole to verify authority.
    const requesterResult = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": requesterId },
        Limit: 1,
      }),
    );
    const requesterGivenRole: string =
      requesterResult.Items?.[0]?.givenRole || "User";

    // Only Super-Admin and Admin can delete users.
    if (
      requesterGivenRole !== GivenRole.SUPER_ADMIN &&
      requesterGivenRole !== GivenRole.ADMIN
    ) {
      return err("Insufficient permissions to remove users", 403);
    }

    // Determine target's role/email for the protection checks.
    const targetResult = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": personId },
        Limit: 1,
      }),
    );
    const targetGivenRole: string = targetResult.Items?.[0]?.givenRole || "User";
    const targetEmail = await getCognitoEmail(personId, userPoolId);
    const isWill = targetEmail.toLowerCase() === PROTECTED_EMAIL;

    // The hardcoded bootstrap Super-Admin is protected from everyone.
    if (isWill) {
      return err("This is a protected account and cannot be removed", 403);
    }

    // Admins cannot remove Super-Admins.
    if (
      requesterGivenRole === GivenRole.ADMIN &&
      targetGivenRole === GivenRole.SUPER_ADMIN
    ) {
      return err("Admins cannot remove Super-Admin accounts", 403);
    }

    // Collect every Cognito identity for this person (native + SSO), falling
    // back to the single personId when the email lookup yields nothing.
    const usernamesByEmail = await findUsernamesByEmail(targetEmail, userPoolId);
    const usernames = Array.from(new Set<string>([personId, ...usernamesByEmail]));

    // Delete each Cognito identity. Tolerate already-missing users so the
    // DynamoDB cleanup below still runs for a partially removed account.
    await Promise.all(
      usernames.map((username) =>
        cognitoClient
          .send(
            new AdminDeleteUserCommand({
              UserPoolId: userPoolId,
              Username: username,
            }),
          )
          .catch((cognitoErr: any) => {
            if (cognitoErr?.name !== "UserNotFoundException") {
              console.warn(
                `Cognito delete failed for ${username} (non-fatal):`,
                cognitoErr,
              );
            }
          }),
      ),
    );

    // Remove the matching DynamoDB person records for every identity.
    await Promise.all(
      usernames.map((username) => deletePersonRecords(username, tableName)),
    );

    return ok({ personId, deleted: true, removed: usernames });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    return err(error.message || "Failed to delete user", 500);
  }
};

export const handler = withPermissions(_handler);
