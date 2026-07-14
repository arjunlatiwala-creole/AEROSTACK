import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct, type IConstruct } from "constructs";
import { getConfig, throttling } from "../config";
import type { IApiAuth } from "../constructs/auth/cognito-auth";
import { CustomerSuccessApi } from "../constructs/cs/cs-api";
import { RevOpsApi } from "../constructs/revops/revops-api";

export interface ModulesApiStackProps extends cdk.StackProps {
  /** Shared Cognito User Pool from ApiStack — same login as the rest of Aerostack. */
  userPool: cognito.IUserPool;
  personTable: dynamodb.ITable;
  // RevOps
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  loopsTable: dynamodb.ITable;
  revopsMboTable: dynamodb.ITable;
  revopsCadenceTable: dynamodb.ITable;
  // Customer Success
  csTicketsTable: dynamodb.ITable;
  csCoreTable: dynamodb.ITable;
}

/**
 * Aerostack RevOps Productivity + Customer Success module APIs.
 * Separate stack/API Gateway (mirrors HiringApiStack) so the primary ApiStack
 * stays under the 500-resource CloudFormation limit. Shares the Aerostack Cognito
 * pool so login is identical.
 */
export class ModulesApiStack extends cdk.Stack {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: ModulesApiStackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext("env") || "dev";
    const cfg = getConfig();
    const rbacMode: string = this.node.tryGetContext("rbac_mode") || "db_only";

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(30),
      bundling: { minify: true, externalModules: ["@aws-sdk/*"] },
    };

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [props.userPool],
        authorizerName: `${cfg.prefix}-modules-authorizer`,
      },
    );
    const auth: IApiAuth = {
      authorizer,
      getMethodOptions: (): apigw.MethodOptions => ({
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      }),
    };

    const api = new apigw.RestApi(this, "Api", {
      restApiName: `${cfg.prefix}-modules-api`,
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
          "X-Tenant-Id",
        ],
      },
    });

    const revOpsApi = new RevOpsApi(this, "RevOpsApi", {
      api,
      auth,
      dealsTable: props.dealsTable,
      loopsTable: props.loopsTable,
      mboTable: props.revopsMboTable,
      cadenceTable: props.revopsCadenceTable,
      lambdaDefaults,
    });

    const customerSuccessApi = new CustomerSuccessApi(this, "CustomerSuccessApi", {
      api,
      auth,
      csTicketsTable: props.csTicketsTable,
      csCoreTable: props.csCoreTable,
      dealsTable: props.dealsTable,
      companiesTable: props.companiesTable,
      lambdaDefaults,
    });

    this.openApiSpec = {
      openapi: "3.0.3",
      info: { title: "Aerostack Modules API (RevOps + Customer Success)", version: "1.0.0" },
      tags: [
        ...(revOpsApi.openApiSpec.tags || []),
        ...(customerSuccessApi.openApiSpec.tags || []),
      ],
      paths: {
        ...revOpsApi.openApiSpec.paths,
        ...customerSuccessApi.openApiSpec.paths,
      },
    };

    cdk.Aspects.of(this).add(new PermissionEnvAspect(props.personTable, rbacMode));

    new cdk.CfnOutput(this, "ModulesApiUrl", {
      value: api.url,
      description: "Aerostack Modules (RevOps + CS) API Gateway base URL",
      exportName: `${cfg.prefix}-ModulesApiUrl`,
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
      const roleId = (node.role as iam.IRole | undefined)?.roleArn ?? node.node.id;
      if (!this.grantedRoles.has(roleId)) {
        this.grantedRoles.add(roleId);
        this.personTable.grantReadData(node);
      }
    }
  }
}
