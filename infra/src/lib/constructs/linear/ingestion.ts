import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface LinearIngestionProps {
	secret: sm.ISecret;
	bucketPrefix: string;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * Linear Data Ingestion Construct
 *
 * Event-driven ingestion of Linear project data into S3.
 * Uses GraphQL API with pagination to fetch all projects and issues.
 */
export class LinearIngestion extends Construct {
	public readonly lambda: lambda.IFunction;
	public readonly bucket: s3.IBucket;

	constructor(scope: Construct, id: string, props: LinearIngestionProps) {
		super(scope, id);

		this.bucket = new s3.Bucket(this, "LinearDataBucket", {
			encryption: s3.BucketEncryption.S3_MANAGED,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			versioned: true,
			lifecycleRules: [
				{
					id: "DeleteOldVersions",
					noncurrentVersionExpiration: cdk.Duration.days(30),
				},
			],
			removalPolicy: cdk.RemovalPolicy.RETAIN,
		});

		const ingestLambda = new nodejs.NodejsFunction(
			this,
			"IngestLinearData",
			{
				...props.lambdaDefaults,
				entry: "src/functions/linear/ingest.ts",
				handler: "handler",
				timeout: cdk.Duration.minutes(15),
				environment: {
					...props.lambdaDefaults.environment,
					LINEAR_SECRET_NAME: props.secret.secretName,
					LINEAR_DATA_BUCKET: this.bucket.bucketName,
				},
			},
		);

		this.lambda = ingestLambda;

		props.secret.grantRead(ingestLambda);
		this.bucket.grantWrite(ingestLambda);

		ingestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["events:PutEvents"],
				resources: ["*"],
			}),
		);
	}
}
