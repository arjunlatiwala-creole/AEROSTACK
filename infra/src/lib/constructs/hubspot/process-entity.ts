import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface ProcessEntityProps {
	integrationsRawTable: dynamodb.ITable;
	dealsTable: dynamodb.ITable;
	companiesTable: dynamodb.ITable;
	contactsTable: dynamodb.ITable;
	integrationsTable: dynamodb.ITable;
	integrationSyncHistoryTable: dynamodb.ITable;
	integrationSyncDetailsTable: dynamodb.ITable;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class ProcessHubspotEntity extends Construct {
	public readonly lambda: nodejs.NodejsFunction;

	constructor(scope: Construct, id: string, props: ProcessEntityProps) {
		super(scope, id);

		this.lambda = new nodejs.NodejsFunction(this, "ProcessEntityLambda", {
			...props.lambdaDefaults,
			entry: "src/functions/hubspot/process-entity.ts",
			handler: "handler",
			timeout: cdk.Duration.minutes(15),
			environment: {
				...props.lambdaDefaults.environment,
				INTEGRATIONS_RAW_TABLE_NAME: props.integrationsRawTable.tableName,
				DEALS_TABLE_NAME: props.dealsTable.tableName,
				COMPANIES_TABLE_NAME: props.companiesTable.tableName,
				CONTACTS_TABLE_NAME: props.contactsTable.tableName,
				INTEGRATION_SYNC_HISTORY_TABLE_NAME:
					props.integrationSyncHistoryTable.tableName,
				INTEGRATION_SYNC_DETAILS_TABLE_NAME:
					props.integrationSyncDetailsTable.tableName,
				INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
			},
		});

		// Grant permissions
		props.integrationsRawTable.grantReadData(this.lambda);
		props.dealsTable.grantReadWriteData(this.lambda);
		props.companiesTable.grantReadWriteData(this.lambda);
		props.contactsTable.grantReadWriteData(this.lambda);
		props.integrationsTable.grantReadWriteData(this.lambda);
		props.integrationSyncHistoryTable.grantReadWriteData(this.lambda);
		props.integrationSyncDetailsTable.grantReadWriteData(this.lambda);
	}
}
