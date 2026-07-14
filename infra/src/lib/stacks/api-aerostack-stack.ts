import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct, IConstruct } from "constructs";
import { getConfig, throttling } from "../config";
import type { IApiAuth } from "../constructs/auth/cognito-auth";
import { DocumentHostApi } from "../constructs/document-host/document-host-api";
import { EnterpriseAerostackDashboardApi } from "../constructs/enterpriseAerostack/enterprise-aerostack-api";
import { LoopsApiConstruct } from "../constructs/loops/loops-api";
import { OpenApiConstruct } from "../constructs/openapi/openapi-get-docs";
import { OpenApiPublisher } from "../constructs/openapi/openapi-publisher";

export interface ApiAerostackStackProps extends cdk.StackProps {
  /**
   * Shared Cognito User Pool from ApiStack.
   * Avoids creating a duplicate pool (same prefix → name and export collision).
   */
  userPool: cognito.IUserPool;
  personTable: dynamodb.ITable;
  loopsTable: dynamodb.ITable;
  loopFinancialsTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  deelPeopleTable: dynamodb.ITable;
  linearDeliveryTable: dynamodb.ITable;
  integrationSyncHistoryTable: dynamodb.ITable;
  /** Document Host tables */
  documentsTable: dynamodb.ITable;
  documentVersionsTable: dynamodb.ITable;
  documentAccessTable: dynamodb.ITable;
}

export class ApiAerostackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiAerostackStackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext("env") || "dev";
    const cfg = getConfig();

    /**
     * RBAC rollout mode injected into every Lambda via PermissionEnvAspect.
     *   db_only        — existing DynamoDB-backed permission checks (default)
     *   claims_then_db — JWT claims first; fall back to DynamoDB
     *   claims_only    — JWT claims only; DynamoDB skipped for permission checks
     */
    const rbacMode: string = this.node.tryGetContext("rbac_mode") || "db_only";

    /**
     * Shared Lambda defaults
     */
    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        externalModules: ["@aws-sdk/*"],
      },
    };

    /**
     * Build a local API Gateway authorizer backed by the shared User Pool.
     * We do NOT create a new Cognito User Pool here — using the same pool
     * that ApiStack owns avoids duplicate resource names and CFn export
     * collisions. Each RestApi still needs its own authorizer resource.
     */
    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [props.userPool],
        authorizerName: `${cfg.prefix}-aerostack-authorizer`,
      },
    );

    const auth: IApiAuth = {
      authorizer,
      getMethodOptions: (): apigw.MethodOptions => ({
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      }),
    };

    /**
     * API Gateway
     */
    const api = new apigw.RestApi(this, "Api", {
      restApiName: `${cfg.prefix}-aerostack-api`,
      deployOptions: {
        stageName: env,
        throttlingRateLimit: throttling.rateLimit,
        throttlingBurstLimit: throttling.burstLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Amz-Date",
          "X-Amz-Security-Token",
          "X-Resource-Key",
        ],
      },
    });

    /**
     * Enterprise Aerostack Dashboard API
     */
    const enterpriseAerostackDashboardApi = new EnterpriseAerostackDashboardApi(
      this,
      "EnterpriseAerostackDashboardApi",
      {
        api,
        auth,
        lambdaDefaults,
        loopsTable: props.loopsTable,
        loopFinancialsTable: props.loopFinancialsTable,
        dealsTable: props.dealsTable,
        companiesTable: props.companiesTable,
        contactsTable: props.contactsTable,
        deelPeopleTable: props.deelPeopleTable,
        linearDeliveryTable: props.linearDeliveryTable,
        integrationSyncHistoryTable: props.integrationSyncHistoryTable,
        personTable: props.personTable,
      },
    );

    /**
     * Loops API (moved from ApiStack to reduce resource count)
     */
    const loopsApi = new LoopsApiConstruct(this, "LoopsApi", {
      api,
      auth,
      loopsTable: props.loopsTable,
      deelPeopleTable: props.deelPeopleTable,
      personTable: props.personTable,
    });

    /**
     * Document Host API (document management + auto-sync from Canva/Drive +
     * DocuSign e-signature when configured)
     */
    new DocumentHostApi(this, "DocumentHostApi", {
      api,
      auth,
      lambdaDefaults,
      documentsTable: props.documentsTable,
      documentVersionsTable: props.documentVersionsTable,
      documentAccessTable: props.documentAccessTable,
      apiBaseUrl: cfg.apiBaseUrl ?? api.url,
      frontendUrl: cfg.frontendUrl,
      ...(cfg.dropboxSign ? { dropboxSign: cfg.dropboxSign } : {}),
    });

    /**
     * OpenAPI publishing
     */
    const combinedOpenApi = {
      openapi: "3.0.3",
      info: { title: "Aerostack Dashboard API", version: "1.0.0" },
      tags: [
        ...(enterpriseAerostackDashboardApi.openApiSpec.tags || []),
        ...(loopsApi.openApiSpec.tags || []),
      ],
      paths: {
        ...enterpriseAerostackDashboardApi.openApiSpec.paths,
        ...loopsApi.openApiSpec.paths,
      },
      components: {
        securitySchemes: {
          CognitoIdToken: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "AWS Cognito ID Token. Obtain this by authenticating with AWS Cognito User Pool.",
          },
        },
        schemas: {
          ...enterpriseAerostackDashboardApi.openApiSpec.components?.schemas,
          ...loopsApi.openApiSpec.components?.schemas,
        },
      },
      security: [{ CognitoIdToken: [] }],
    };

    const publisher = new OpenApiPublisher(this, "OpenApiPublisher", {
      openApiSpec: combinedOpenApi,
      environment: env,
      bucketPrefix: cfg.prefix,
    });

    const openApiDocs = new OpenApiConstruct(this, "OpenApi", {
      bucket: publisher.bucket,
      s3Key: publisher.s3Key,
      api,
      auth,
      lambdaDefaults,
    });

    openApiDocs.node.addDependency(publisher);

    /**
     * Permission enforcement — inject PERSON_TABLE_NAME + RBAC_MODE into
     * every Lambda so the withPermissions wrapper uses the correct authority
     * source for this deployment stage.
     */
    cdk.Aspects.of(this).add(
      new PermissionEnvAspect(props.personTable, rbacMode),
    );

    /**
     * Outputs
     */
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "Enterprise Aerostack Dashboard API Gateway base URL",
      exportName: `${cfg.prefix}-AerostackDashboardApiUrl`,
    });
  }
}

class PermissionEnvAspect implements cdk.IAspect {
  private readonly grantedRoles = new Set<string>();

  constructor(
    private readonly personTable: dynamodb.ITable,
    private readonly rbacMode: string,
  ) {}

  visit(node: IConstruct): void {
    if (node instanceof lambda.Function) {
      node.addEnvironment("PERSON_TABLE_NAME", this.personTable.tableName);
      node.addEnvironment("RBAC_MODE", this.rbacMode);

      const roleId =
        (node.role as iam.IRole | undefined)?.roleArn ?? node.node.id;
      if (!this.grantedRoles.has(roleId)) {
        this.grantedRoles.add(roleId);
        this.personTable.grantReadData(node);
      }
    }
  }
}
