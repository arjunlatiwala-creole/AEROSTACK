import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { CognitoAuth } from "../auth/cognito-auth";

export interface RolesApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  lambdaDefaults: Record<string, any>;
  personTable: dynamodb.ITable;
}

export class RolesApiConstruct extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: RolesApiProps) {
    super(scope, id);

    const listUsersFn = new nodejs.NodejsFunction(this, "ListUsersLambda", {
      ...props.lambdaDefaults,
      entry: "src/functions/roles/list-users.ts",
      handler: "handler",
      environment: {
        PERSON_TABLE_NAME: props.personTable.tableName,
        USER_POOL_ID: props.auth.userPool.userPoolId,
      },
    });

    props.personTable.grantReadData(listUsersFn);

    listUsersFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:ListUsers"],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );

    const saveUserRoleFn = new nodejs.NodejsFunction(
      this,
      "SaveUserRoleLambda",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/roles/save-user-role.ts",
        handler: "handler",
        environment: {
          PERSON_TABLE_NAME: props.personTable.tableName,
          USER_POOL_ID: props.auth.userPool.userPoolId,
        },
      },
    );

    props.personTable.grantReadWriteData(saveUserRoleFn);

    // Group management + attribute updates for the RBAC migration.
    props.auth.grantGroupManagement(saveUserRoleFn);
    saveUserRoleFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );

    const saveGivenRoleFn = new nodejs.NodejsFunction(
      this,
      "SaveGivenRoleLambda",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/roles/save-given-role.ts",
        handler: "handler",
        environment: {
          PERSON_TABLE_NAME: props.personTable.tableName,
          USER_POOL_ID: props.auth.userPool.userPoolId,
        },
      },
    );

    props.personTable.grantReadWriteData(saveGivenRoleFn);

    // Group membership updates for the RBAC migration.
    props.auth.grantGroupManagement(saveGivenRoleFn);
    saveGivenRoleFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );

    const deleteUserFn = new nodejs.NodejsFunction(this, "DeleteUserLambda", {
      ...props.lambdaDefaults,
      entry: "src/functions/roles/delete-user.ts",
      handler: "handler",
      environment: {
        PERSON_TABLE_NAME: props.personTable.tableName,
        USER_POOL_ID: props.auth.userPool.userPoolId,
      },
    });

    props.personTable.grantReadWriteData(deleteUserFn);

    props.auth.grantGroupManagement(deleteUserFn);
    deleteUserFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminDeleteUser",
          // Find every identity sharing an email (native + SSO) so removal
          // clears all of them, matching the dedup-by-email in list-users.
          "cognito-idp:ListUsers",
        ],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );

    const getMyRoleFn = new nodejs.NodejsFunction(this, "GetMyRoleLambda", {
      ...props.lambdaDefaults,
      entry: "src/functions/roles/get-my-role.ts",
      handler: "handler",
      environment: {
        PERSON_TABLE_NAME: props.personTable.tableName,
      },
    });

    props.personTable.grantReadWriteData(getMyRoleFn);

    const rolesResource = props.api.root.addResource("roles");
    const meResource = rolesResource.addResource("me");

    meResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getMyRoleFn),
      props.auth.getMethodOptions(),
    );

    const usersResource = rolesResource.addResource("users");

    usersResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(listUsersFn),
      props.auth.getMethodOptions(),
    );

    const singleUserResource = usersResource.addResource("{personId}");

    singleUserResource.addMethod(
      "PUT",
      new apigw.LambdaIntegration(saveUserRoleFn),
      {
        ...props.auth.getMethodOptions(),
        requestParameters: {
          "method.request.path.personId": true,
        },
      },
    );

    singleUserResource.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(deleteUserFn),
      {
        ...props.auth.getMethodOptions(),
        requestParameters: {
          "method.request.path.personId": true,
        },
      },
    );

    const givenRoleResource = singleUserResource.addResource("given-role");

    givenRoleResource.addMethod(
      "PUT",
      new apigw.LambdaIntegration(saveGivenRoleFn),
      {
        ...props.auth.getMethodOptions(),
        requestParameters: {
          "method.request.path.personId": true,
        },
      },
    );

    this.openApiSpec = {
      openapi: "3.0.3",
      info: {
        title: "Roles API",
        version: "1.0.0",
        description: "API for managing user roles and permissions",
      },
      tags: [
        { name: "Roles", description: "User role management endpoints" },
      ],
      paths: {
        "/roles/me": {
          get: {
            summary: "Get current user's role permissions",
            tags: ["Roles"],
            responses: {
              "200": { description: "Role retrieved successfully" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/roles/users": {
          get: {
            summary: "List all users with Cognito details",
            tags: ["Roles"],
            responses: {
              "200": { description: "Users retrieved successfully" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/roles/users/{personId}": {
          put: {
            summary: "Save user role permissions",
            tags: ["Roles"],
            parameters: [
              {
                name: "personId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["userRole"],
                    properties: {
                      userRole: {
                        type: "object",
                        description: "Permission map for the user",
                      },
                    },
                  },
                },
              },
            },
            responses: {
              "200": { description: "Role saved successfully" },
              "400": { description: "Validation error" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
      },
      components: { schemas: {} },
    };
  }
}
