import type { APIGatewayProxyHandler } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError, GivenRole, resolveActorEmail } from "../shared/auth-utils";
import { withPermissions } from "../shared/permission-middleware";

const cognitoClient = new CognitoIdentityProviderClient({});

/** All platform role group names — must stay in sync with CognitoAuth construct. */
const ALL_GIVEN_ROLE_GROUPS = Object.values(GivenRole);

/** Returns true if a personId maps to a "will" account (hardcoded Super-Admin). */
async function isWillAccount(
  personId: string,
  userPoolId: string | undefined,
): Promise<boolean> {
  if (!userPoolId) return false;
  try {
    const result = await cognitoClient.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: personId }),
    );
    const email =
      result.UserAttributes?.find((a) => a.Name === "email")?.Value || "";
    return email.toLowerCase() === "will@enterprise.io";
  } catch {
    return false;
  }
}

/**
 * Updates the user's Cognito group membership to reflect the new givenRole.
 * Removes from all other platform groups first, then adds to the target group.
 * Non-fatal: logs a warning on failure so the DynamoDB write is still visible.
 */
async function updateCognitoGroup(
  personId: string,
  givenRole: string,
  userPoolId: string,
): Promise<void> {
  // Remove from every group the user might currently be in (ignore 404s).
  await Promise.all(
    ALL_GIVEN_ROLE_GROUPS.filter((g) => g !== givenRole).map((group) =>
      cognitoClient
        .send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: userPoolId,
            Username: personId,
            GroupName: group,
          }),
        )
        .catch(() => { }),
    ),
  );

  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: personId,
      GroupName: givenRole,
    }),
  );
}

const VALID_GIVEN_ROLES: string[] = Object.values(GivenRole);

const _handler: APIGatewayProxyHandler = async (event) => {
  const authResult = authorizeUser(event);
  if (isAuthError(authResult)) return authResult.error;

  const tableName = process.env.PERSON_TABLE_NAME!;
  const userPoolId = process.env.USER_POOL_ID;
  const personId = event.pathParameters?.personId;

  if (!personId) {
    return err("personId is required", 400);
  }

  let body: any;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err("Invalid JSON body", 400);
  }

  const { givenRole, createdAt } = body;

  if (!givenRole || typeof givenRole !== "string") {
    return err("givenRole string is required in request body", 400);
  }

  if (!VALID_GIVEN_ROLES.includes(givenRole)) {
    return err(
      `Invalid givenRole. Must be one of: ${VALID_GIVEN_ROLES.join(", ")}`,
      400,
    );
  }

  if (!createdAt) {
    return err("createdAt is required in request body", 400);
  }

  const requesterId = authResult.user.sub;

  try {
    // Fetch requester's givenRole to check their authority level.
    const requesterResult = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": requesterId },
        Limit: 1,
      }),
    );
    const requesterRecord = requesterResult.Items?.[0];
    const requesterGivenRole: string = requesterRecord?.givenRole || "User";

    const targetIsWill = await isWillAccount(personId, userPoolId);

    // Block modification ONLY if requester is NOT Super-Admin.
    // if (targetIsWill && requesterGivenRole !== "Super-Admin") {
    //   return err(
    //     "This is a protected Super-Admin account and cannot be modified by an Admin",
    //     403,
    //   );
    // }

    // Write givenRole to DynamoDB (source of truth during transition).
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { personId, createdAt },
        UpdateExpression: "SET givenRole = :role, updatedAt = :now, updated_by = :by",
        ExpressionAttributeValues: {
          ":role": givenRole,
          ":now": new Date().toISOString(),
          ":by": resolveActorEmail(event, body.updated_by),
        },
      }),
    );

    // Write Cognito group membership as source of truth for the new RBAC path.
    if (userPoolId) {
      try {
        await updateCognitoGroup(personId, givenRole, userPoolId);
      } catch (cognitoErr) {
        // Non-fatal: DynamoDB write succeeded; log and proceed.
        console.warn(
          "Failed to update Cognito group membership (non-fatal):",
          cognitoErr,
        );
      }
    }

    return ok({ personId, givenRole });
  } catch (error: any) {
    console.error("Error saving givenRole:", error);
    return err(error.message || "Failed to save givenRole", 500);
  }
};

export const handler = withPermissions(_handler);
