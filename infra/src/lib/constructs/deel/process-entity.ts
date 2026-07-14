import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface DeelProcessingProps {
	bucket: s3.IBucket;
	deelPeopleTable: dynamodb.ITable;
	integrationsTable: dynamodb.ITable;
	integrationSyncHistoryTable: dynamodb.ITable;
	integrationSyncDetailsTable: dynamodb.ITable;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class ProcessDeelEntity extends Construct {
	public readonly lambda: nodejs.NodejsFunction;

	constructor(scope: Construct, id: string, props: DeelProcessingProps) {
		super(scope, id);

		this.lambda = new nodejs.NodejsFunction(this, "ProcessDeelEntities", {
			...props.lambdaDefaults,
			entry: "src/functions/deel/process-entity.ts",
			handler: "handler",
			timeout: cdk.Duration.minutes(10),
			environment: {
				DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				INTEGRATION_SYNC_HISTORY_TABLE_NAME:
					props.integrationSyncHistoryTable.tableName,
				INTEGRATION_SYNC_DETAILS_TABLE_NAME:
					props.integrationSyncDetailsTable.tableName,
				INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
			},
		});

		props.bucket.grantReadWrite(this.lambda);
		props.deelPeopleTable.grantReadWriteData(this.lambda);
		props.integrationSyncHistoryTable.grantReadWriteData(this.lambda);
		props.integrationSyncDetailsTable.grantReadWriteData(this.lambda);
		props.integrationsTable.grantReadWriteData(this.lambda);
	}
}
