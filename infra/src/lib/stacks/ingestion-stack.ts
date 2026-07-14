import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { getConfig } from "../config";
import { DeelIngestion } from "../constructs/deel/ingestion";
import { ProcessDeelEntity } from "../constructs/deel/process-entity";
import { EventRules } from "../constructs/event-rules/event-rules";
import { HubspotIngestion } from "../constructs/hubspot/ingestion";
import { ProcessHubspotEntity } from "../constructs/hubspot/process-entity";
import { LinearIngestion } from "../constructs/linear/ingestion";
import { ProcessLinearEntity } from "../constructs/linear/process-entity";
import { PartnerCentralIngestion } from "../constructs/partner-central/ingestion";
import { ProcessPartnerCentralEntity } from "../constructs/partner-central/process-entity";

export interface IngestionStackProps extends cdk.StackProps {
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

export class IngestionStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: IngestionStackProps) {
		super(scope, id, props);

		const cfg = getConfig();

		const lambdaDefaults = {
			runtime: lambda.Runtime.NODEJS_20_X,
			architecture: lambda.Architecture.X86_64,
			timeout: cdk.Duration.seconds(30),
			bundling: {
				minify: true,
				externalModules: ["@aws-sdk/*"],
			},
		};

		const hubspotSecret = sm.Secret.fromSecretNameV2(
			this,
			"HubSpotSecret",
			cfg.hubspotSecret,
		);

		const deelSecret = sm.Secret.fromSecretNameV2(
			this,
			"DeelSecret",
			cfg.deelSecret,
		);

		const linearSecret = sm.Secret.fromSecretNameV2(
			this,
			"LinearSecret",
			cfg.linearSecret,
		);

		/**
		 * Manual Sync Fanout
		 */
		const manualSyncFanoutLambda = new nodejs.NodejsFunction(
			this,
			"ManualSyncFanoutLambda",
			{
				...lambdaDefaults,
				entry:
					"src/functions/integrations/sync/manual-sync/manual-sync-fanout.ts",
				handler: "handler",
			},
		);

		manualSyncFanoutLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["events:PutEvents"],
				resources: ["*"],
			}),
		);

		/**
		 * HubSpot Ingestion
		 */
		const hubspotIngestion = new HubspotIngestion(this, "HubspotIngestion", {
			secret: hubspotSecret,
			integrationsRawTable: props.integrationsRawTable,
			lambdaDefaults: {
				...lambdaDefaults,
				environment: {
					HUBSPOT_SECRET_NAME: cfg.hubspotSecret,
				},
			},
		});

		/**
		 * HubSpot Processing
		 */
		const hubspotProcessing = new ProcessHubspotEntity(
			this,
			"ProcessHubspotEntity",
			{
				integrationsRawTable: props.integrationsRawTable,
				dealsTable: props.dealsTable,
				companiesTable: props.companiesTable,
				contactsTable: props.contactsTable,
				integrationsTable: props.integrationsTable,
				integrationSyncHistoryTable: props.integrationSyncHistoryTable,
				integrationSyncDetailsTable: props.integrationSyncDetailsTable,
				lambdaDefaults: {
					...lambdaDefaults,
					timeout: cdk.Duration.minutes(15),
				},
			},
		);

		/**
		 * Deel Ingestion
		 */
		const deelIngestion = new DeelIngestion(this, "DeelIngestion", {
			secret: deelSecret,
			bucketPrefix: cfg.prefix,
			lambdaDefaults: {
				...lambdaDefaults,
				environment: {
					DEEL_SECRET_NAME: cfg.deelSecret,
					DEEL_BUCKET_NAME: cfg.deelDataBucket,
				},
			},
		});

		/**
		 * Deel Processing
		 */
		const deelProcessing = new ProcessDeelEntity(this, "ProcessDeelEntity", {
			bucket: deelIngestion.bucket,
			deelPeopleTable: props.deelPeopleTable,
			integrationsTable: props.integrationsTable,
			integrationSyncHistoryTable: props.integrationSyncHistoryTable,
			integrationSyncDetailsTable: props.integrationSyncDetailsTable,
			lambdaDefaults: {
				...lambdaDefaults,
			},
		});

		/**
		 * Linear Ingestion
		 */
		const linearIngestion = new LinearIngestion(this, "LinearIngestion", {
			secret: linearSecret,
			bucketPrefix: cfg.prefix,
			lambdaDefaults: {
				...lambdaDefaults,
				environment: {
					LINEAR_SECRET_NAME: cfg.linearSecret,
					LINEAR_DATA_BUCKET: cfg.linearDataBucket,
				},
			},
		});

		/**
		 * Linear Processing
		 */
		const linearProcessing = new ProcessLinearEntity(
			this,
			"ProcessLinearEntity",
			{
				bucket: linearIngestion.bucket,
				linearDeliveryTable: props.linearDeliveryTable,
				integrationsTable: props.integrationsTable,
				integrationSyncHistoryTable: props.integrationSyncHistoryTable,
				integrationSyncDetailsTable: props.integrationSyncDetailsTable,
				lambdaDefaults: {
					...lambdaDefaults,
					timeout: cdk.Duration.minutes(15),
				},
			},
		);

		/**
		 * Partner Central Ingestion
		 */
		const partnerCentralIngestion = new PartnerCentralIngestion(
			this,
			"PartnerCentralIngestion",
			{
				roleArn: cfg.partnerRoleArn || "",
				bucketPrefix: cfg.prefix,
				lambdaDefaults: {
					...lambdaDefaults,
					environment: {},
				},
			},
		);

		/**
		 * Partner Central Processing
		 */
		const partnerCentralProcessing = new ProcessPartnerCentralEntity(
			this,
			"ProcessPartnerCentralEntity",
			{
				bucket: partnerCentralIngestion.bucket,
				partnerOpportunitiesTable: props.partnerOpportunitiesTable,
				partnerEngagementsTable: props.partnerEngagementsTable,
				partnerEngagementInvitationsTable:
					props.partnerEngagementInvitationsTable,
				integrationsTable: props.integrationsTable,
				integrationSyncHistoryTable: props.integrationSyncHistoryTable,
				integrationSyncDetailsTable: props.integrationSyncDetailsTable,
				lambdaDefaults: {
					...lambdaDefaults,
					timeout: cdk.Duration.minutes(15),
				},
			},
		);

		/**
		 * EventBridge Rules (event-driven routing + scheduled ingestion)
		 */
		new EventRules(this, "EventRules", {
			manualSyncFanoutLambda,
			ingestionLambdas: {
				hubspot: hubspotIngestion.lambda,
				deel: deelIngestion.lambda,
				linear: linearIngestion.lambda,
				partner_central: partnerCentralIngestion.lambda,
			},
			processingLambdas: {
				hubspot: hubspotProcessing.lambda,
				deel: deelProcessing.lambda,
				linear: linearProcessing.lambda,
				partner_central: partnerCentralProcessing.lambda,
			},
			// Twice-daily scheduled ingestion: 6 AM and 6 PM US Eastern (11:00 / 23:00 UTC).
			// partner_central is intentionally excluded — no longer in use.
			scheduledIngestions: [
				{ integrationType: "hubspot" },
				{ integrationType: "deel" },
				{ integrationType: "linear" },
			],
			prefix: cfg.prefix, // e.g. "aerostack-dev" or "aerostack-prod" — used for alarm/rule names
		});

		/**
		 * Outputs
		 */
		new cdk.CfnOutput(this, "HubspotIngestionLambdaArn", {
			value: hubspotIngestion.lambda.functionArn,
			description: "ARN of HubSpot ingestion Lambda",
			exportName: `${cfg.prefix}-HubspotIngestionLambdaArn`,
		});

		new cdk.CfnOutput(this, "HubspotProcessingLambdaArn", {
			value: hubspotProcessing.lambda.functionArn,
			description: "ARN of HubSpot processing Lambda",
			exportName: `${cfg.prefix}-HubspotProcessingLambdaArn`,
		});

		new cdk.CfnOutput(this, "DeelIngestionLambdaArn", {
			value: deelIngestion.lambda.functionArn,
			description: "ARN of Deel ingestion Lambda",
			exportName: `${cfg.prefix}-DeelIngestionLambdaArn`,
		});

		new cdk.CfnOutput(this, "DeelProcessingLambdaArn", {
			value: deelProcessing.lambda.functionArn,
			description: "ARN of Deel processing Lambda",
			exportName: `${cfg.prefix}-DeelProcessingLambdaArn`,
		});

		new cdk.CfnOutput(this, "DeelDataBucketName", {
			value: deelIngestion.bucket.bucketName,
			description: "S3 bucket for Deel data storage",
			exportName: `${cfg.prefix}-DeelDataBucketName`,
		});

		new cdk.CfnOutput(this, "LinearIngestionLambdaArn", {
			value: linearIngestion.lambda.functionArn,
			description: "ARN of Linear ingestion Lambda",
			exportName: `${cfg.prefix}-LinearIngestionLambdaArn`,
		});

		new cdk.CfnOutput(this, "LinearProcessingLambdaArn", {
			value: linearProcessing.lambda.functionArn,
			description: "ARN of Linear processing Lambda",
			exportName: `${cfg.prefix}-LinearProcessingLambdaArn`,
		});

		new cdk.CfnOutput(this, "LinearDataBucketName", {
			value: linearIngestion.bucket.bucketName,
			description: "S3 bucket for Linear data storage",
			exportName: `${cfg.prefix}-LinearDataBucketName`,
		});

		new cdk.CfnOutput(this, "PartnerCentralIngestionLambdaArn", {
			value: partnerCentralIngestion.lambda.functionArn,
			description: "ARN of Partner Central ingestion Lambda",
			exportName: `${cfg.prefix}-PartnerCentralIngestionLambdaArn`,
		});

		new cdk.CfnOutput(this, "PartnerCentralProcessingLambdaArn", {
			value: partnerCentralProcessing.lambda.functionArn,
			description: "ARN of Partner Central processing Lambda",
			exportName: `${cfg.prefix}-PartnerCentralProcessingLambdaArn`,
		});

		new cdk.CfnOutput(this, "PartnerCentralDataBucketName", {
			value: partnerCentralIngestion.bucket.bucketName,
			description: "S3 bucket for Partner Central data storage",
			exportName: `${cfg.prefix}-PartnerCentralDataBucketName`,
		});

		new cdk.CfnOutput(this, "ManualSyncFanoutLambdaArn", {
			value: manualSyncFanoutLambda.functionArn,
			description: "ARN of Manual Sync Fanout Lambda",
			exportName: `${cfg.prefix}-ManualSyncFanoutLambdaArn`,
		});
	}
}
