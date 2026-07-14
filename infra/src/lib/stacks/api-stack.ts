import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct, IConstruct } from "constructs";
import { getConfig, throttling } from "../config";
import { APNDashboardApi } from "../constructs/apn-dashboard/apn-dashboard-api";
import { CognitoAuth } from "../constructs/auth/cognito-auth";
import { BfpmApiConstruct } from "../constructs/bfpm/bfpm-api";
import { HubspotDealsApi } from "../constructs/hubspot/deals-api";
import { HubspotDealsListApi } from "../constructs/hubspot/deals-list-api";
import { HubspotProcessingApi } from "../constructs/hubspot/process-raw-api";
import { SchemaRegistryApi } from "../constructs/hubspot/schema-registry-api";
import { IntegrationsApiConstruct } from "../constructs/integrations/integrations-api";
import { LoopFinancialsApiConstruct } from "../constructs/loop-financials/loop-financials-api";
import { OpenApiConstruct } from "../constructs/openapi/openapi-get-docs";
import { OpenApiPublisher } from "../constructs/openapi/openapi-publisher";
import { PartnerApiConstruct } from "../constructs/partner-central/partner-central-api";
import { PeopleOpsDashboardApi } from "../constructs/people-ops/people-ops-api";
import { DeliveryDashboardApi } from "../constructs/delivery/delivery-api";
import { RolesApiConstruct } from "../constructs/roles/roles-api";

export interface ApiStackProps extends cdk.StackProps {
  personTable: dynamodb.ITable;
  personInformationTable: dynamodb.ITable;
  bfpmSessionsTable: dynamodb.ITable;
  bfpmDataTable: dynamodb.ITable;
  loopsTable: dynamodb.ITable;
  loopFinancialsTable: dynamodb.ITable;
  integrationsRawTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  integrationsTable: dynamodb.ITable;
  integrationSyncDetailsTable: dynamodb.ITable;
  integrationSyncHistoryTable: dynamodb.ITable;
  deelPeopleTable: dynamodb.ITable;
  linearDeliveryTable: dynamodb.ITable;
  partnerOpportunitiesTable: dynamodb.ITable;
  partnerEngagementsTable: dynamodb.ITable;
  partnerEngagementInvitationsTable: dynamodb.ITable;
}

export class ApiStack extends cdk.Stack {
  public readonly auth: CognitoAuth;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext("env") || "dev";
    const cfg = getConfig();

    /**
     * RBAC rollout mode injected into every Lambda via PermissionEnvAspect.
     *   db_only       — existing DynamoDB-backed permission checks (default)
     *   claims_then_db — JWT claims first; fall back to DynamoDB
     *   claims_only   — JWT claims only; DynamoDB skipped for permission checks
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
     * Pre-Token Generation trigger.
     * Emits a `givenRole` claim derived from the user's Cognito group
     * membership so consumers can read the role from the JWT directly.
     * When GOOGLE_SA_SECRET_NAME is set, also resolves roles from Google
     * Workspace group membership for first-time SSO users.
     */
    const preTokenGenerationLambda = new nodejs.NodejsFunction(
      this,
      "PreTokenGenerationLambda",
      {
        ...lambdaDefaults,
        entry: "src/functions/pre-token-generation/index.ts",
        handler: "handler",
        environment: {
          ...(cfg.googleDirectorySecretName
            ? { GOOGLE_SA_SECRET_NAME: cfg.googleDirectorySecretName }
            : {}),
          ...(cfg.googleAdminEmail
            ? { GOOGLE_ADMIN_EMAIL: cfg.googleAdminEmail }
            : {}),
        },
      },
    );

    // Grant Secrets Manager read access for Google Directory API credentials.
    // Uses fromSecretNameV2 so the ARN is never hardcoded — CDK resolves it.
    if (cfg.googleDirectorySecretName) {
      const googleSaSecret = sm.Secret.fromSecretNameV2(
        this,
        "GoogleSaSecret",
        cfg.googleDirectorySecretName,
      );
      googleSaSecret.grantRead(preTokenGenerationLambda);
    }

    /**
     * Pre-SignUp trigger.
     * Links Google SSO identities to existing email/password accounts
     * so the same email never produces two user pool entries.
     */
    const preSignUpLambda = new nodejs.NodejsFunction(this, "PreSignUpLambda", {
      ...lambdaDefaults,
      entry: "src/functions/pre-signup/index.ts",
      handler: "handler",
    });

    /**
     * Post-confirmation Cognito trigger
     */
    const postConfirmationLambda = new nodejs.NodejsFunction(
      this,
      "PostConfirmationLambda",
      {
        ...lambdaDefaults,
        entry: "src/functions/post-signup-confirmation/index.ts",
        handler: "postSignupConfirmation",
        environment: {
          PERSON_TABLE_NAME: props.personTable.tableName,
        },
      },
    );

    props.personTable.grantWriteData(postConfirmationLambda);

    /**
     * Cognito Auth (User Pool + Authorizer)
     * Optionally wires Hosted UI + Google SSO when configured in env.
     */
    this.auth = new CognitoAuth(this, "Auth", {
      prefix: cfg.prefix,
      postConfirmationLambda,
      preTokenGenerationLambda,
      preSignUpLambda,
      cognitoDomainPrefix: cfg.cognitoDomainPrefix,
      googleClientId: cfg.googleClientId,
      googleClientSecret: cfg.googleClientSecret,
      oauthCallbackUrls: cfg.oauthCallbackUrls,
      oauthLogoutUrls: cfg.oauthLogoutUrls,
      existingUserPoolId: cfg.existingUserPoolId,
    });
    const auth = this.auth;

    /**
     * Grant the pre-token Lambda permission to auto-assign the "User" group
     * to first-time Google SSO users who have no platform group yet.
     * Uses grantTriggerGroupManagement (wildcard ARN) to avoid the circular
     * dependency: UserPool → PreTokenLambda → IAM policy → UserPool.
     */
    auth.grantTriggerGroupManagement(preTokenGenerationLambda);

    /**
     * Grant the pre-signup Lambda permission to list users and link provider
     * identities. Uses grantTriggerGroupManagement (wildcard ARN) to avoid
     * circular CloudFormation dependency: UserPool → PreSignUpLambda → UserPool.
     */
    auth.grantTriggerGroupManagement(preSignUpLambda);

    /**
     * Secrets
     */
    const hubspotSecret = sm.Secret.fromSecretNameV2(
      this,
      "HubSpotSecret",
      cfg.hubspotSecret,
    );

    const linearSecret = sm.Secret.fromSecretNameV2(
      this,
      "LinearSecret",
      cfg.linearSecret,
    );
    const linearAdminSecret = sm.Secret.fromSecretNameV2(
      this,
      "LinearAdminSecret",
      cfg.linearAdminSecret,
    );
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
     * BFPM API
     */
    const bfpmApi = new BfpmApiConstruct(this, "BfpmApi", {
      api,
      auth,
      lambdaDefaults,
      sessionsTable: props.bfpmSessionsTable,
      dataTable: props.bfpmDataTable,
    });

    /**
     * Business APIs
     */
    const hubspotApi = new HubspotDealsApi(this, "HubspotDealsApi", {
      api,
      auth,
      secret: hubspotSecret,
      lambdaDefaults: {
        ...lambdaDefaults,
        environment: {
          HUBSPOT_SECRET_NAME: cfg.hubspotSecret,
        },
      },
    });
    /**
     * Hubspot Deals List APIs
     */
    const hubspotListApi = new HubspotDealsListApi(
      this,
      "HubspotDealsListApi",
      {
        api,
        auth,
        //   secret: hubspotSecret,
        dealsTable: props.dealsTable,
        companiesTable: props.companiesTable,
        contactsTable: props.contactsTable,
        lambdaDefaults: {
          ...lambdaDefaults,
        },
      },
    );

    /**
     * HubSpot Ingestion API
     */
    const integrationsApi = new IntegrationsApiConstruct(
      this,
      "IntegrationsApi",
      {
        api,
        auth,
        integrationsTable: props.integrationsTable,
        syncHistoryTable: props.integrationSyncHistoryTable,
        syncDetailsTable: props.integrationSyncDetailsTable,
        googleDirectorySecretName: cfg.googleDirectorySecretName,
        googleAdminEmail: cfg.googleAdminEmail,
        deelSecretName: cfg.deelSecret,
        linearSecretName: cfg.linearSecret,
        hubspotSecretName: cfg.hubspotSecret,
      },
    );

    /**
     * HubSpot Processing API
     */
    const hubspotProcessingApi = new HubspotProcessingApi(
      this,
      "HubspotProcessingApi",
      {
        api,
        auth,
        integrationsRawTable: props.integrationsRawTable,
        dealsTable: props.dealsTable,
        companiesTable: props.companiesTable,
        contactsTable: props.contactsTable,
        lambdaDefaults: {
          ...lambdaDefaults,
        },
      },
    );

    /**
     * Loop Financials API
     */
    const loopFinancialsApi = new LoopFinancialsApiConstruct(
      this,
      "LoopFinancialsApi",
      {
        api,
        auth,
        loopFinancialsTable: props.loopFinancialsTable,
      },
    );

    /**
     * HubSpot Schema Registry API
     */
    const schemaRegistryApi = new SchemaRegistryApi(this, "SchemaRegistryApi", {
      api,
      auth,
      secret: hubspotSecret,
      lambdaDefaults: {
        ...lambdaDefaults,
        environment: {
          HUBSPOT_SECRET_NAME: cfg.hubspotSecret,
        },
      },
      bucketPrefix: cfg.prefix,
      bucketName: cfg.schemaRegistryBucket,
    });

    /**
     * Partner Central API
     */
    const partnerApi = new PartnerApiConstruct(this, "PartnerApi", {
      api,
      auth,
      lambdaDefaults,
      roleArn: cfg.partnerRoleArn || "",
    });

    /**
     * People ops dashboard API
     */
    const peopleOpsDashboardApi = new PeopleOpsDashboardApi(
      this,
      "PeopleOpsDashboardApi",
      {
        api,
        auth,
        lambdaDefaults: {
          ...lambdaDefaults,
        },
        deelPeopleTable: props.deelPeopleTable,
        personInformationTable: props.personInformationTable,
        loopsTable: props.loopsTable,
        dealsTable: props.dealsTable,
        companiesTable: props.companiesTable,
        contactsTable: props.contactsTable,
        linearDeliveryTable: props.linearDeliveryTable,
      },
    );

    /**
     * APN Dashboard API
     */
    // const apnDashboardApi = new APNDashboardApi(this, "APNDashboardApi", {
    //   api,
    //   auth,
    //   lambdaDefaults,
    //   partnerOpportunitiesTable: props.partnerOpportunitiesTable,
    //   partnerEngagementsTable: props.partnerEngagementsTable,
    //   partnerEngagementInvitationsTable:
    //     props.partnerEngagementInvitationsTable,
    // });
    /**
     * Delivery Dashboard API
     */
    const deliveryDashboardApi = new DeliveryDashboardApi(
      this,
      "DeliveryDashboardApi",
      {
        api,
        auth,
        lambdaDefaults,
        loopsTable: props.loopsTable,
        linearDeliveryTable: props.linearDeliveryTable,
        linearSecret: linearSecret,
        linearAdminSecret: linearAdminSecret,
      },
    );

    /**
     * Roles API
     */
    const rolesApi = new RolesApiConstruct(this, "RolesApi", {
      api,
      auth,
      lambdaDefaults,
      personTable: props.personTable,
    });

    /**
     * OpenAPI publishing - Combine ALL API specs
     */
    const combinedOpenApi = {
      openapi: "3.0.3",
      info: { title: "Aerostack API", version: "1.0.0" },
      tags: [
        ...(hubspotApi.openApiSpec.tags || []),
        ...(schemaRegistryApi.openApiSpec.tags || []),
        ...(bfpmApi.openApiSpec.tags || []),
        ...(loopFinancialsApi.openApiSpec.tags || []),
        ...(hubspotProcessingApi.openApiSpec.tags || []),
        ...(integrationsApi.openApiSpec.tags || []),
        ...(partnerApi.openApiSpec.tags || []),
        ...(peopleOpsDashboardApi.openApiSpec.tags || []),
        // ...(apnDashboardApi.openApiSpec.tags || []),
        ...(deliveryDashboardApi.openApiSpec.tags || []),
        ...(rolesApi.openApiSpec.tags || []),
      ],
      paths: {
        ...hubspotApi.openApiSpec.paths,
        ...schemaRegistryApi.openApiSpec.paths,
        ...bfpmApi.openApiSpec.paths,
        ...loopFinancialsApi.openApiSpec.paths,
        ...hubspotProcessingApi.openApiSpec.paths,
        ...integrationsApi.openApiSpec.paths,
        ...partnerApi.openApiSpec.paths,
        ...peopleOpsDashboardApi.openApiSpec.paths,
        // ...apnDashboardApi.openApiSpec.paths,
        ...deliveryDashboardApi.openApiSpec.paths,
        ...rolesApi.openApiSpec.paths,
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
          ...hubspotApi.openApiSpec.components?.schemas,
          ...schemaRegistryApi.openApiSpec.components?.schemas,
          ...bfpmApi.openApiSpec.components?.schemas,
          ...loopFinancialsApi.openApiSpec.components?.schemas,
          ...hubspotProcessingApi.openApiSpec.components?.schemas,
          ...integrationsApi.openApiSpec.components?.schemas,
          ...partnerApi.openApiSpec.components?.schemas,
          ...peopleOpsDashboardApi.openApiSpec.components?.schemas,
          // ...apnDashboardApi.openApiSpec.components?.schemas,
          ...deliveryDashboardApi.openApiSpec.components?.schemas,
          ...rolesApi.openApiSpec.components?.schemas,
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
      description: "API Gateway base URL",
      exportName: `${cfg.prefix}-ApiUrl`,
    });

    new cdk.CfnOutput(this, "SchemaRegistryBucketName", {
      value: schemaRegistryApi.bucket.bucketName,
      description: "S3 bucket for HubSpot schema storage",
      exportName: `${cfg.prefix}-SchemaRegistryBucketName`,
    });
  }
}

class PermissionEnvAspect implements cdk.IAspect {
  private readonly grantedRoles = new Set<string>();

  constructor(
    private readonly personTable: dynamodb.ITable,
    private readonly rbacMode: string,
  ) { }

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
