import * as cdk from "aws-cdk-lib";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { CognitoAuth } from "../auth/cognito-auth";

export interface SchemaRegistryApiProps {
    api: apigw.RestApi;
    auth: CognitoAuth;
    secret: sm.ISecret;
    lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
    bucketPrefix: string;
    bucketName?: string;
}

export class SchemaRegistryApi extends Construct {
    public readonly bucket: s3.Bucket;
    public readonly openApiSpec: any;

    constructor(scope: Construct, id: string, props: SchemaRegistryApiProps) {
        super(scope, id);

        this.bucket = new s3.Bucket(this, "SchemaRegistryBucket", {
            bucketName: props.bucketName ?? `${props.bucketPrefix}-schema-registry`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [
                {
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                },
            ],
        });

        const schemaRegistryFn = new nodejs.NodejsFunction(
            this,
            "SchemaRegistryFunction",
            {
                ...props.lambdaDefaults,
                entry: "src/functions/hubspot/schema-registry.ts",
                handler: "getSchemaRegistry",
                environment: {
                    ...props.lambdaDefaults.environment,
                    SCHEMA_BUCKET_NAME: this.bucket.bucketName,
                },
            }
        );

        props.secret.grantRead(schemaRegistryFn);
        this.bucket.grantWrite(schemaRegistryFn);

        const hubspot = props.api.root.resourceForPath("hubspot");
        const schemaRegistry = hubspot.addResource("schema-registry");
        const schemaType = schemaRegistry.addResource("{type}");

        schemaType.addMethod(
            "GET",
            new apigw.LambdaIntegration(schemaRegistryFn),
            props.auth.getMethodOptions()
        );

        this.openApiSpec = {
            tags: [
                {
                    name: "HubSpot Schema Registry",
                    description: "Operations for managing HubSpot object schemas",
                },
            ],
            paths: {
                "/hubspot/schema-registry/{type}": {
                    get: {
                        summary: "Get HubSpot Object Schema",
                        description:
                            "Fetches properties from HubSpot API and stores schema in S3",
                        tags: ["HubSpot Schema Registry"],
                        parameters: [
                            {
                                name: "type",
                                in: "path",
                                schema: {
                                    type: "string",
                                    enum: ["deals", "contacts", "company"],
                                },
                                required: true,
                                description: "The HubSpot object type",
                            },
                        ],
                        responses: {
                            "200": {
                                description: "Schema successfully retrieved and stored",
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                success: { type: "boolean" },
                                                data: {
                                                    type: "object",
                                                    properties: {
                                                        objectType: { type: "string" },
                                                        totalFields: { type: "number" },
                                                        s3Location: { type: "string" },
                                                        schema: {
                                                            type: "array",
                                                            items: {
                                                                type: "object",
                                                                properties: {
                                                                    name: { type: "string" },
                                                                    type: { type: "string" },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            "400": {
                                description: "Invalid request",
                            },
                            "500": {
                                description: "Internal server error",
                            },
                        },
                    },
                },
            },
        };
    }
}