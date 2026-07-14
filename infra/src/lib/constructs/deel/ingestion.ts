import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface DeelIngestionProps {
	secret: sm.ISecret;
	bucketPrefix: string;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * Deel Data Ingestion Construct
 *
 * Event-driven ingestion of Deel data into S3.
 * Env var names are intentionally preserved.
 */
export class DeelIngestion extends Construct {
	public readonly lambda: lambda.IFunction;
	public readonly bucket: s3.IBucket;

	constructor(scope: Construct, id: string, props: DeelIngestionProps) {
		super(scope, id);

		this.bucket = new s3.Bucket(this, "DeelDataBucket", {
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

		const ingestLambda = new nodejs.NodejsFunction(this, "IngestDeelData", {
			...props.lambdaDefaults,
			entry: "src/functions/deel/ingest.ts",
			handler: "handler",
			timeout: cdk.Duration.minutes(15),
			environment: {
				...props.lambdaDefaults.environment,
				DEEL_SECRET_NAME: props.secret.secretName,
				DEEL_BUCKET_NAME: this.bucket.bucketName,
			},
		});

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
