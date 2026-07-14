import * as cdk from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface HubspotIngestionProps {
	secret: sm.ISecret;
	integrationsRawTable: dynamodb.ITable;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * HubSpot Data Ingestion Construct
 *
 * Creates a Lambda function that ingests data from HubSpot into the IntegrationsRawTable.
 * Triggered via EventBridge events only (no API Gateway endpoint).
 *
 * Event Flow:
 * - Receives: "Ingest Requested" event from EventBridge
 * - Fetches: Data from HubSpot API (deals, contacts, companies)
 * - Writes: Raw data to IntegrationsRawTable
 * - Publishes: "Ingestion Complete" event to EventBridge
 */
export class HubspotIngestion extends Construct {
	public readonly lambda: lambda.IFunction;

	constructor(scope: Construct, id: string, props: HubspotIngestionProps) {
		super(scope, id);

		const ingestLambda = new nodejs.NodejsFunction(this, "IngestHubspotData", {
			...props.lambdaDefaults,
			entry: "src/functions/hubspot/ingest.ts",
			handler: "ingestHubspotData",
			timeout: cdk.Duration.minutes(15),
			environment: {
				...props.lambdaDefaults.environment,
				INTEGRATIONS_RAW_TABLE_NAME: props.integrationsRawTable.tableName,
			},
		});

		this.lambda = ingestLambda;

		props.secret.grantRead(ingestLambda);
		props.integrationsRawTable.grantReadWriteData(ingestLambda);

		ingestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["events:PutEvents"],
				resources: ["*"],
			}),
		);
	}
}
