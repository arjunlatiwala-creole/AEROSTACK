import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface ProcessUnifiedEntityProps {
	unifiedOpportunitiesTable: dynamodb.ITable;
	dealsTable: dynamodb.ITable;
	companiesTable: dynamodb.ITable;
	contactsTable: dynamodb.ITable;
	partnerOpportunitiesTable: dynamodb.ITable;
	integrationsTable: dynamodb.ITable;
	integrationSyncHistoryTable: dynamodb.ITable;
	integrationSyncDetailsTable: dynamodb.ITable;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class ProcessUnifiedEntity extends Construct {
	public readonly lambda: lambda.IFunction;

	constructor(scope: Construct, id: string, props: ProcessUnifiedEntityProps) {
		super(scope, id);

		const processLambda = new nodejs.NodejsFunction(
			this,
			"ProcessUnifiedEntityLambda",
			{
				...props.lambdaDefaults,
				entry: "src/functions/unified/process-entity.ts",
				handler: "handler",
				timeout: cdk.Duration.minutes(15),
				environment: {
					...props.lambdaDefaults.environment,
					UNIFIED_OPPORTUNITIES_TABLE_NAME:
						props.unifiedOpportunitiesTable.tableName,
					DEALS_TABLE_NAME: props.dealsTable.tableName,
					COMPANIES_TABLE_NAME: props.companiesTable.tableName,
					CONTACTS_TABLE_NAME: props.contactsTable.tableName,
					PARTNER_OPPORTUNITIES_TABLE_NAME:
						props.partnerOpportunitiesTable.tableName,
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
					INTEGRATION_SYNC_HISTORY_TABLE_NAME:
						props.integrationSyncHistoryTable.tableName,
					INTEGRATION_SYNC_DETAILS_TABLE_NAME:
						props.integrationSyncDetailsTable.tableName,
				},
			},
		);

		this.lambda = processLambda;

		// Read from source tables
		props.dealsTable.grantReadData(processLambda);
		props.companiesTable.grantReadData(processLambda);
		props.contactsTable.grantReadData(processLambda);
		props.partnerOpportunitiesTable.grantReadData(processLambda);

		// Read/write to unified table
		props.unifiedOpportunitiesTable.grantReadWriteData(processLambda);

		// Sync tracking
		props.integrationsTable.grantReadData(processLambda);
		props.integrationSyncHistoryTable.grantReadWriteData(processLambda);
		props.integrationSyncDetailsTable.grantReadWriteData(processLambda);
	}
}
