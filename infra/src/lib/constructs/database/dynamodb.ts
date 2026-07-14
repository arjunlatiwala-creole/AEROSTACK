import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface DynamoTableProps {
	readonly tableName: string;
	readonly partitionKey: dynamodb.Attribute;
	readonly sortKey?: dynamodb.Attribute;
	readonly stream?: dynamodb.StreamViewType;
	readonly timeToLiveAttribute?: string;
	readonly globalSecondaryIndexes?: GlobalSecondaryIndexConfig[];
	readonly localSecondaryIndexes?: LocalSecondaryIndexConfig[];
	readonly removalPolicy?: cdk.RemovalPolicy;
	readonly tags?: Record<string, string>;
}

export interface GlobalSecondaryIndexConfig {
	readonly indexName: string;
	readonly partitionKey: dynamodb.Attribute;
	readonly sortKey?: dynamodb.Attribute;
	readonly projectionType?: dynamodb.ProjectionType;
	readonly nonKeyAttributes?: string[];
}

export interface LocalSecondaryIndexConfig {
	readonly indexName: string;
	readonly sortKey: dynamodb.Attribute;
	readonly projectionType?: dynamodb.ProjectionType;
	readonly nonKeyAttributes?: string[];
}

export class DynamoTable extends Construct {
	public readonly table: dynamodb.Table;

	constructor(scope: Construct, id: string, props: DynamoTableProps) {
		super(scope, id);

		this.table = new dynamodb.Table(this, "Table", {
			tableName: props.tableName,
			partitionKey: props.partitionKey,
			sortKey: props.sortKey,

			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			encryption: dynamodb.TableEncryption.AWS_MANAGED,

			stream: props.stream,
			timeToLiveAttribute: props.timeToLiveAttribute,
			removalPolicy: props.removalPolicy,

			...(props.localSecondaryIndexes && {
				localSecondaryIndexes: props.localSecondaryIndexes.map(
					(lsi): dynamodb.LocalSecondaryIndexProps => ({
						indexName: lsi.indexName,
						sortKey: lsi.sortKey,
						projectionType: lsi.projectionType,
						nonKeyAttributes: lsi.nonKeyAttributes,
					}),
				),
			}),
		});

		// GSIs must be added AFTER creation
		props.globalSecondaryIndexes?.forEach((gsi) => {
			this.table.addGlobalSecondaryIndex({
				indexName: gsi.indexName,
				partitionKey: gsi.partitionKey,
				sortKey: gsi.sortKey,
				projectionType: gsi.projectionType,
				nonKeyAttributes: gsi.nonKeyAttributes,
			});
		});

		if (props.tags) {
			for (const [key, value] of Object.entries(props.tags)) {
				cdk.Tags.of(this.table).add(key, value);
			}
		}

		new cdk.CfnOutput(this, "TableName", { value: this.table.tableName });
		new cdk.CfnOutput(this, "TableArn", { value: this.table.tableArn });
	}

	public grantRead(grantee: iam.IGrantable) {
		return this.table.grantReadData(grantee);
	}

	public grantWrite(grantee: iam.IGrantable) {
		return this.table.grantWriteData(grantee);
	}

	public grantReadWrite(grantee: iam.IGrantable) {
		return this.table.grantReadWriteData(grantee);
	}

	public grantFullAccess(grantee: iam.IGrantable) {
		return this.table.grantFullAccess(grantee);
	}

	public grantStreamRead(grantee: iam.IGrantable) {
		return this.table.grantStreamRead(grantee);
	}
}
