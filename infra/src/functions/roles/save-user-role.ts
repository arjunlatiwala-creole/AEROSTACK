import type { APIGatewayProxyHandler } from "aws-lambda";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { authorizeUser, isAuthError, resolveActorEmail } from "../shared/auth-utils";
import { withPermissions } from "../shared/permission-middleware";
import { computeDeltas, serializeDeltas } from "../shared/claims-utils";

const cognitoClient = new CognitoIdentityProviderClient({});

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
 * Writes compact delta claims to the `custom:rbac_deltas` Cognito attribute.
 * These deltas, combined with the role defaults at token issuance, reproduce
 * the full permission map without embedding it verbatim in the token.
 * Non-fatal: DynamoDB write is the primary write during the transition.
 */
async function updateCognitoDeltas(
  personId: string,
  givenRole: string,
  userRole: Record<string, any>,
  userPoolId: string,
): Promise<void> {
  const deltas = computeDeltas(givenRole, userRole);
  const deltasStr = serializeDeltas(deltas);

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: personId,
      UserAttributes: [
        { Name: "custom:rbac_deltas", Value: deltasStr },
      ],
    }),
  );
}

const _handler: APIGatewayProxyHandler = async (event) => {
  const authResult = authorizeUser(event);
  if (isAuthError(authResult)) return authResult.error;

  const tableName = process.env.PERSON_TABLE_NAME!;
  const userPoolId = process.env.USER_POOL_ID;
  const requesterId = authResult.user.sub;
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

  const { userRole, createdAt } = body;
  if (!userRole || typeof userRole !== "object") {
    return err("userRole object is required in request body", 400);
  }
  if (!createdAt) {
    return err("createdAt is required in request body", 400);
  }

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

    // Always fetch target record for givenRole (needed for delta computation)
    // and to enforce the Admin → Super-Admin restriction.
    const targetResult = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "personId = :pid",
        ExpressionAttributeValues: { ":pid": personId },
        Limit: 1,
      }),
    );
    const targetRecord = targetResult.Items?.[0];
    const targetGivenRole: string = targetRecord?.givenRole || "User";

    if (requesterGivenRole === "Admin" && targetGivenRole === "Super-Admin") {
      return err(
        "Admins cannot modify permissions for Super-Admin accounts",
        403,
      );
    }

    // Write full permission map to DynamoDB (primary write during transition).
    await ddbClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { personId, createdAt },
        UpdateExpression: "SET userRole = :role, updatedAt = :now, updated_by = :by",
        ExpressionAttributeValues: {
          ":role": userRole,
          ":now": new Date().toISOString(),
          ":by": resolveActorEmail(event, body.updated_by),
        },
      }),
    );

    // Write compact deltas to Cognito attribute for the claims-based path.
    if (userPoolId) {
      try {
        await updateCognitoDeltas(personId, targetGivenRole, userRole, userPoolId);
      } catch (cognitoErr) {
        // Non-fatal: DynamoDB write succeeded; log and proceed.
        console.warn(
          "Failed to update Cognito rbac_deltas (non-fatal):",
          cognitoErr,
        );
      }
    }

    return ok({ personId, userRole });
  } catch (error: any) {
    console.error("Error saving user role:", error);
    return err(error.message || "Failed to save user role", 500);
  }
};

export const handler = withPermissions(_handler);
