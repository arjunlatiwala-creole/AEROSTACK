import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct, IConstruct } from "constructs";
import { getConfig, throttling } from "../config";
import type { IApiAuth } from "../constructs/auth/cognito-auth";
import { HiringPipelineApi } from "../constructs/hiring/hiring-pipeline-api";

export interface HiringApiStackProps extends cdk.StackProps {
    /** Shared Cognito User Pool from ApiStack — avoids duplicate pool. */
    userPool: cognito.IUserPool;
    personTable: dynamodb.ITable;
    hiringCandidatesTable: dynamodb.ITable;
    hiringNotesTable: dynamodb.ITable;
    hiringJobRecsTable: dynamodb.ITable;
    hiringCompPlansTable: dynamodb.ITable;
}

export class HiringApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: HiringApiStackProps) {
        super(scope, id, props);

        const env = this.node.tryGetContext("env") || "dev";
        const cfg = getConfig();
        const rbacMode: string = this.node.tryGetContext("rbac_mode") || "db_only";

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
         * Cognito authorizer backed by the shared User Pool.
         */
        const authorizer = new apigw.CognitoUserPoolsAuthorizer(
            this,
            "CognitoAuthorizer",
            {
                cognitoUserPools: [props.userPool],
                authorizerName: `${cfg.prefix}-hiring-authorizer`,
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
            restApiName: `${cfg.prefix}-hiring-api`,
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
         * Hiring Pipeline API
         */
        new HiringPipelineApi(this, "HiringPipelineApi", {
            api,
            auth,
            lambdaDefaults,
            hiringCandidatesTable: props.hiringCandidatesTable,
            hiringNotesTable: props.hiringNotesTable,
            hiringJobRecsTable: props.hiringJobRecsTable,
            hiringCompPlansTable: props.hiringCompPlansTable,
            bucketPrefix: cfg.prefix,
            deelSecretName: cfg.deelSecret,
        });

        /**
         * Permission enforcement
         */
        cdk.Aspects.of(this).add(
            new PermissionEnvAspect(props.personTable, rbacMode),
        );

        /**
         * Outputs
         */
        new cdk.CfnOutput(this, "ApiUrl", {
            value: api.url,
            description: "Hiring Pipeline API Gateway base URL",
            exportName: `${cfg.prefix}-HiringApiUrl`,
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
