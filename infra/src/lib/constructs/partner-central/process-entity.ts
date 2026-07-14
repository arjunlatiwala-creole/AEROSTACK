import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface ProcessPartnerCentralEntityProps {
	bucket: s3.IBucket;
	partnerOpportunitiesTable: dynamodb.ITable;
	partnerEngagementsTable: dynamodb.ITable;
	partnerEngagementInvitationsTable: dynamodb.ITable;
	integrationsTable: dynamodb.ITable;
	integrationSyncHistoryTable: dynamodb.ITable;
	integrationSyncDetailsTable: dynamodb.ITable;

	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * Partner Central Entity Processing Construct
 *
 * Reads raw data from S3, transforms it, and writes to DynamoDB tables.
 */
export class ProcessPartnerCentralEntity extends Construct {
	public readonly lambda: lambda.IFunction;

	constructor(
		scope: Construct,
		id: string,
		props: ProcessPartnerCentralEntityProps,
	) {
		super(scope, id);

		const processLambda = new nodejs.NodejsFunction(
			this,
			"ProcessPartnerCentralEntity",
			{
				...props.lambdaDefaults,
				entry: "src/functions/partner-central/process-entity.ts",
				handler: "handler",
				timeout: cdk.Duration.minutes(15),
				environment: {
					...props.lambdaDefaults.environment,
					PARTNER_CENTRAL_BUCKET_NAME: props.bucket.bucketName,

					PARTNER_OPPORTUNITIES_TABLE_NAME:
						props.partnerOpportunitiesTable.tableName,
					PARTNER_ENGAGEMENTS_TABLE_NAME:
						props.partnerEngagementsTable.tableName,
					PARTNER_ENGAGEMENT_INVITATIONS_TABLE_NAME:
						props.partnerEngagementInvitationsTable.tableName,

					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
					INTEGRATION_SYNC_HISTORY_TABLE_NAME:
						props.integrationSyncHistoryTable.tableName,
					INTEGRATION_SYNC_DETAILS_TABLE_NAME:
						props.integrationSyncDetailsTable.tableName,
				},
			},
		);

		this.lambda = processLambda;

		props.bucket.grantRead(processLambda);

		props.partnerOpportunitiesTable.grantReadWriteData(processLambda);
		props.partnerEngagementsTable.grantReadWriteData(processLambda);
		props.partnerEngagementInvitationsTable.grantReadWriteData(processLambda);

		props.integrationsTable.grantReadWriteData(processLambda);
		props.integrationSyncHistoryTable.grantReadWriteData(processLambda);
		props.integrationSyncDetailsTable.grantReadWriteData(processLambda);
	}
}
