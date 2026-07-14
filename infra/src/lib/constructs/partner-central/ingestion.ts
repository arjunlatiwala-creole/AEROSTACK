import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface PartnerCentralIngestionProps {
	roleArn: string;
	bucketPrefix: string;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class PartnerCentralIngestion extends Construct {
	public readonly lambda: lambda.IFunction;
	public readonly bucket: s3.IBucket;

	constructor(
		scope: Construct,
		id: string,
		props: PartnerCentralIngestionProps,
	) {
		super(scope, id);

		this.bucket = new s3.Bucket(this, "PartnerCentralDataBucket", {
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
			"IngestPartnerCentralData",
			{
				...props.lambdaDefaults,
				entry: "src/functions/partner-central/ingest.ts",
				handler: "handler",
				timeout: cdk.Duration.minutes(15),
				environment: {
					...props.lambdaDefaults.environment,
					PARTNER_ROLE_ARN: props.roleArn,
					PARTNER_CENTRAL_BUCKET_NAME: this.bucket.bucketName,
				},
			},
		);

		this.lambda = ingestLambda;

		this.bucket.grantWrite(ingestLambda);

		ingestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["sts:AssumeRole"],
				resources: [props.roleArn],
			}),
		);

		ingestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["events:PutEvents"],
				resources: ["*"],
			}),
		);
	}
}
