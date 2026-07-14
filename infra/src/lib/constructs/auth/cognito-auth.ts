import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

/**
 * Minimal interface consumed by API constructs that need authorization.
 * Both CognitoAuth and any lightweight wrappers must satisfy this.
 */
export interface IApiAuth {
  readonly authorizer: apigw.IAuthorizer;
  getMethodOptions(): apigw.MethodOptions;
}

/** Platform role group names — must match GivenRole enum in auth-utils.ts. */
const PLATFORM_GROUPS = ["User", "Seller", "Admin", "Super-Admin"] as const;

export interface CognitoAuthProps {
  prefix: string;

  /**
   * Optional triggers
   */
  postConfirmationLambda?: lambda.IFunction;

  /**
   * Pre-Token Generation trigger.
   * When provided, the trigger runs on every token issuance and emits a
   * normalized `givenRole` claim derived from the user's Cognito group.
   */
  preTokenGenerationLambda?: lambda.IFunction;

  /**
   * Pre-SignUp trigger.
   * When provided, links Google SSO identities to existing email/password
   * accounts to prevent duplicate users in the pool.
   */
  preSignUpLambda?: lambda.IFunction;

  /**
   * Optional Hosted UI + Google SSO configuration.
   * When omitted, the stack behaves as today (no Hosted UI / social IdP).
   */
  cognitoDomainPrefix?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  oauthCallbackUrls?: string[];
  oauthLogoutUrls?: string[];

  /**
   * When set, the construct imports an existing Cognito User Pool by ID
   * instead of creating a new one. Used so the PROD stage can share the DEV
   * user pool. In import mode the construct skips pool/group/IdP/app-client/
   * domain creation and only builds the API Gateway authorizer.
   */
  existingUserPoolId?: string;
}

export class CognitoAuth extends Construct {
  public readonly userPool: cognito.IUserPool;
  public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: CognitoAuthProps) {
    super(scope, id);

    /**
     * Import mode — share an existing User Pool (e.g. PROD reusing DEV's pool).
     * Only the imported pool + authorizer are wired up; pool, groups, Google
     * IdP, app client, domain, and the normal outputs are intentionally
     * skipped.
     */
    if (props.existingUserPoolId) {
      this.userPool = cognito.UserPool.fromUserPoolId(
        this,
        "ImportedUserPool",
        props.existingUserPoolId,
      );

      this.authorizer = new apigw.CognitoUserPoolsAuthorizer(
        this,
        "CognitoAuthorizer",
        {
          cognitoUserPools: [this.userPool],
          authorizerName: `${props.prefix}-authorizer`,
        },
      );

      // No exportName — avoids clashing with the DEV stack's UserPoolId export.
      new cdk.CfnOutput(this, "UserPoolId", {
        value: props.existingUserPoolId,
      });

      return;
    }

    const triggers: cognito.UserPoolTriggers = {
      ...(props.postConfirmationLambda
        ? { postConfirmation: props.postConfirmationLambda }
        : {}),
      ...(props.preTokenGenerationLambda
        ? { preTokenGeneration: props.preTokenGenerationLambda }
        : {}),
      ...(props.preSignUpLambda
        ? { preSignUp: props.preSignUpLambda }
        : {}),
    };

    /**
     * Cognito User Pool (CDK-owned)
     *
     * Custom attributes:
     *  - rbac_deltas (mutable): compact JSON delta overrides relative to the
     *    user's group-default permissions. Automatically included in the ID
     *    token so consumers can reconstruct effective permissions from claims.
     */
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${props.prefix}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      customAttributes: {
        rbac_deltas: new cognito.StringAttribute({ mutable: true }),
      },
      lambdaTriggers: Object.keys(triggers).length > 0 ? triggers : undefined,
    });

    /**
     * Standard platform role groups.
     * These are the source of truth for a user's primary role (givenRole).
     * The pre-token trigger maps group membership to the `givenRole` JWT claim.
     */
    for (const groupName of PLATFORM_GROUPS) {
      new cognito.CfnUserPoolGroup(
        this,
        `Group${groupName.replace("-", "")}`,
        {
          userPoolId: this.userPool.userPoolId,
          groupName,
          description: `Platform role group: ${groupName}`,
        },
      );
    }

    const supportedIdentityProviders: cognito.UserPoolClientIdentityProvider[] =
      [cognito.UserPoolClientIdentityProvider.COGNITO];

    const oAuthConfig =
      props.cognitoDomainPrefix &&
      props.oauthCallbackUrls &&
      props.oauthCallbackUrls.length > 0 &&
      props.oauthLogoutUrls &&
      props.oauthLogoutUrls.length > 0
        ? {
            flows: {
              authorizationCodeGrant: true,
            },
            callbackUrls: props.oauthCallbackUrls,
            logoutUrls: props.oauthLogoutUrls,
            scopes: [
              cognito.OAuthScope.OPENID,
              cognito.OAuthScope.EMAIL,
              cognito.OAuthScope.PROFILE,
            ],
          }
        : undefined;

    /**
     * Optionally configure Google IdP
     */
    let googleProvider: cognito.UserPoolIdentityProviderGoogle | undefined;

    if (props.googleClientId && props.googleClientSecret) {
      googleProvider = new cognito.UserPoolIdentityProviderGoogle(
        this,
        "GoogleIdP",
        {
          userPool: this.userPool,
          clientId: props.googleClientId,
          clientSecret: props.googleClientSecret,
          scopes: ["openid", "email", "profile"],
          attributeMapping: {
            email: cognito.ProviderAttribute.GOOGLE_EMAIL,
            givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
            familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          },
        },
      );

      supportedIdentityProviders.push(
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      );
    }

    /**
     * Create an App Client for this User Pool
     */
    const appClient = new cognito.UserPoolClient(this, "AppClient", {
      userPool: this.userPool,
      userPoolClientName: `${props.prefix}-app-client`,
      generateSecret: false, // for SPAs / web apps
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: oAuthConfig,
      supportedIdentityProviders,
    });

    if (googleProvider) {
      appClient.node.addDependency(googleProvider);
    }

    /**
     * Optional Hosted UI domain
     */
    if (props.cognitoDomainPrefix) {
      this.userPool.addDomain("UserPoolDomain", {
        cognitoDomain: {
          domainPrefix: props.cognitoDomainPrefix,
        },
      });

      const region = cdk.Stack.of(this).region;
      new cdk.CfnOutput(this, "CognitoDomain", {
        value: `https://${props.cognitoDomainPrefix}.auth.${region}.amazoncognito.com`,
        description: "Cognito Hosted UI domain — use as VITE_AWS_COGNITO_DOMAIN",
        exportName: `${props.prefix}-CognitoDomain`,
      });
    }

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: appClient.userPoolClientId,
      exportName: `${props.prefix}-UserPoolClientId`,
    });

    /**
     * API Gateway Authorizer
     */
    this.authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [this.userPool],
        authorizerName: `${props.prefix}-authorizer`,
      },
    );

    /**
     * Outputs
     */
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `${props.prefix}-UserPoolId`,
    });
  }

  /**
   * API Gateway Method Authorization Helper
   */
  public getMethodOptions(): apigw.MethodOptions {
    return {
      authorizer: this.authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };
  }

  /**
   * Grants a Lambda (or other grantee) the IAM permissions needed to manage
   * Cognito group membership and user attributes for the RBAC migration:
   *   - AdminAddUserToGroup
   *   - AdminRemoveUserFromGroup
   *   - AdminUpdateUserAttributes
   *   - AdminListGroupsForUser
   *
   * Safe to use on Lambdas that are NOT UserPool triggers.
   */
  public grantGroupManagement(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminListGroupsForUser",
        ],
        resources: [this.userPool.userPoolArn],
      }),
    );
  }

  /**
   * Grants a Lambda trigger (e.g. PreTokenGeneration, PostConfirmation) the
   * ability to call AdminAddUserToGroup / AdminListGroupsForUser WITHOUT
   * creating a circular CloudFormation dependency.
   *
   * UserPool triggers create a cycle when their IAM policy references
   * `userPool.userPoolArn` (a token that depends on the UserPool resource,
   * which itself depends on the trigger Lambda). This method avoids that by
   * using CloudFormation pseudo-parameter ARNs instead of the resource token.
   */
  public grantTriggerGroupManagement(grantee: iam.IGrantable): void {
    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminLinkProviderForUser",
          "cognito-idp:ListUsers",
        ],
        // Pseudo-parameter ARN — no dependency on the UserPool resource token.
        resources: [
          `arn:aws:cognito-idp:${region}:${account}:userpool/*`,
        ],
      }),
    );
  }
}
