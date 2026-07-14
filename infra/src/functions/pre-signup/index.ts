/**
 * Cognito Pre-SignUp trigger.
 *
 * When a user signs up via Google SSO and an account with the same email
 * already exists in the user pool (created via email/password), this trigger:
 *
 *  1. Finds the existing Cognito user by email.
 *  2. Links the Google identity to that user via AdminLinkProviderForUser.
 *  3. Throws "Already_Linked" to prevent Cognito from creating a duplicate.
 *
 * On the user's next Google sign-in the linked identity is recognised and
 * Cognito authenticates them as their existing account — no duplicate created.
 *
 * Group assignment and the `givenRole` claim are NOT handled here — that is
 * the responsibility of the Pre-Token Generation trigger, which runs once the
 * user record exists. Calling AdminAddUserToGroup from a pre-signup trigger
 * fails with UserNotFoundException because the user has not been created yet.
 *
 * Uses event.userPoolId (present in all Cognito trigger events) to avoid a
 * circular CloudFormation dependency between the UserPool and this Lambda.
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (event: any): Promise<any> => {
  // Only process external-provider (Google SSO) sign-ups.
  if (!event.triggerSource?.startsWith("PreSignUp_ExternalProvider")) {
    return event;
  }

  const email: string | undefined = event.request?.userAttributes?.email;
  if (!email) return event;

  const userPoolId: string = event.userPoolId;
  const username: string = event.userName; // e.g. "Google_114427894831765267799"

  // Parse provider name + sub from Cognito username.
  const underscoreIdx = username.indexOf("_");
  if (underscoreIdx === -1) return event;
  const providerName = username.substring(0, underscoreIdx); // "Google"
  const providerSub = username.substring(underscoreIdx + 1); // "114427894831765267799"

  try {
    // Search for an existing non-federated user with the same email.
    const listResult = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
        Limit: 10,
      }),
    );

    const existingUser = (listResult.Users ?? []).find(
      (u) => u.UserStatus !== "EXTERNAL_PROVIDER",
    );

    if (!existingUser || !existingUser.Username) {
      // No existing account — let Cognito create a new one normally.
      return event;
    }

    // Link the Google identity to the existing account.
    await cognitoClient.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: userPoolId,
        DestinationUser: {
          ProviderName: "Cognito",
          ProviderAttributeValue: existingUser.Username,
        },
        SourceUser: {
          ProviderName: providerName,
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: providerSub,
        },
      }),
    );

    // Throw to stop Cognito creating a duplicate user.
    // The linking persists — on the next Google sign-in the user is
    // authenticated as their existing linked account automatically.
    throw new Error("Already_Linked");
  } catch (err: any) {
    if (err.message === "Already_Linked") throw err;
    // Non-fatal: log and let sign-up proceed to avoid blocking the user.
    console.warn("Pre-signup account linking failed (non-fatal):", err);
  }

  return event;
};
