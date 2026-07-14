import { Duration } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";
import { integrationsModels } from "../../models/integrations";

export class IntegrationsApiConstruct extends Construct {
	public readonly openApiSpec: any;

	constructor(
		scope: Construct,
		id: string,
		props: {
			api: apigw.RestApi;
			integrationsTable: dynamodb.ITable;
			syncHistoryTable: dynamodb.ITable;
			syncDetailsTable: dynamodb.ITable;
			auth: CognitoAuth;
			googleDirectorySecretName?: string;
			googleAdminEmail?: string;
			deelSecretName?: string;
			linearSecretName?: string;
			hubspotSecretName?: string;
		},
	) {
		super(scope, id);

		const createIntegrationFn = new lambda.NodejsFunction(
			this,
			"CreateIntegrationLambda",
			{
				entry: "src/functions/integrations/create-integration.ts",
				handler: "handler",
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
				},
			},
		);

		const getIntegrationFn = new lambda.NodejsFunction(
			this,
			"GetIntegrationLambda",
			{
				entry: "src/functions/integrations/get-integration.ts",
				handler: "handler",
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
				},
			},
		);

		const listIntegrationsFn = new lambda.NodejsFunction(
			this,
			"ListIntegrationsLambda",
			{
				entry: "src/functions/integrations/list-integrations.ts",
				handler: "handler",
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
				},
			},
		);

		const updateIntegrationFn = new lambda.NodejsFunction(
			this,
			"UpdateIntegrationLambda",
			{
				entry: "src/functions/integrations/update-integration.ts",
				handler: "handler",
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
				},
			},
		);

		const deleteIntegrationFn = new lambda.NodejsFunction(
			this,
			"DeleteIntegrationLambda",
			{
				entry: "src/functions/integrations/delete-integration.ts",
				handler: "handler",
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
				},
			},
		);

		const getSyncHistoryFn = new lambda.NodejsFunction(
			this,
			"GetSyncHistoryLambda",
			{
				entry: "src/functions/integrations/get-sync-history.ts",
				handler: "handler",
				environment: {
					INTEGRATION_SYNC_HISTORY_TABLE_NAME: props.syncHistoryTable.tableName,
				},
			},
		);

		const getSyncDetailsFn = new lambda.NodejsFunction(
			this,
			"GetSyncDetailsLambda",
			{
				entry: "src/functions/integrations/get-sync-history-details.ts",
				handler: "handler",
				environment: {
					INTEGRATION_SYNC_DETAILS_TABLE_NAME: props.syncDetailsTable.tableName,
				},
			},
		);

		const manualSyncTriggerFn = new lambda.NodejsFunction(
			this,
			"ManualSyncTriggerLambda",
			{
				entry:
					"src/functions/integrations/sync/manual-sync/manual-sync.request.ts",
				handler: "handler",
			},
		);

		manualSyncTriggerFn.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["events:PutEvents"],
				resources: ["*"],
			}),
		);

		const testIntegrationFn = new lambda.NodejsFunction(
			this,
			"TestIntegrationLambda",
			{
				entry: "src/functions/integrations/test-integration.ts",
				handler: "handler",
				timeout: Duration.seconds(30),
				environment: {
					INTEGRATIONS_TABLE_NAME: props.integrationsTable.tableName,
					GOOGLE_SA_SECRET_NAME: props.googleDirectorySecretName || "",
					GOOGLE_DRIVE_SA_SECRET_NAME: "aerostack/document-host/google-drive-sa",
					GOOGLE_ADMIN_EMAIL: props.googleAdminEmail || "",
					DEEL_SECRET_NAME: props.deelSecretName || "",
					LINEAR_SECRET_NAME: props.linearSecretName || "",
					HUBSPOT_SECRET_NAME: props.hubspotSecretName || "",
					SLACK_SECRET_NAME: "slack_bot_token",
				},
			},
		);

		if (props.googleDirectorySecretName) {
			const googleSaSecret = sm.Secret.fromSecretNameV2(
				this,
				"GoogleSaSecretForTest",
				props.googleDirectorySecretName,
			);
			googleSaSecret.grantRead(testIntegrationFn);
		}

		const googleDriveSaSecret = sm.Secret.fromSecretNameV2(
			this,
			"GoogleDriveSaSecretForTest",
			"aerostack/document-host/google-drive-sa",
		);
		googleDriveSaSecret.grantRead(testIntegrationFn);

		if (props.deelSecretName) {
			const deelSecret = sm.Secret.fromSecretNameV2(
				this,
				"DeelSecretForTest",
				props.deelSecretName,
			);
			deelSecret.grantRead(testIntegrationFn);
		}

		if (props.linearSecretName) {
			const linearSecret = sm.Secret.fromSecretNameV2(
				this,
				"LinearSecretForTest",
				props.linearSecretName,
			);
			linearSecret.grantRead(testIntegrationFn);
		}

		if (props.hubspotSecretName) {
			const hubspotSecret = sm.Secret.fromSecretNameV2(
				this,
				"HubspotSecretForTest",
				props.hubspotSecretName,
			);
			hubspotSecret.grantRead(testIntegrationFn);
		}

		const slackSecret = sm.Secret.fromSecretNameV2(
			this,
			"SlackSecretForTest",
			"slack_bot_token",
		);
		slackSecret.grantRead(testIntegrationFn);

		/**
		 * Grant table permissions to all lambdas
		 */
		const allLambdas = [
			createIntegrationFn,
			getIntegrationFn,
			listIntegrationsFn,
			updateIntegrationFn,
			deleteIntegrationFn,
			getSyncHistoryFn,
			getSyncDetailsFn,
			manualSyncTriggerFn,
			testIntegrationFn,
		];

		const allTables = [
			props.integrationsTable,
			props.syncHistoryTable,
			props.syncDetailsTable,
		];

		// Grant read/write access to all tables for all lambdas
		this.grantTableAccess(allLambdas, allTables, true);

		const integrationsResource = props.api.root.addResource("integrations");

		const createIntegrationModel = props.api.addModel(
			"CreateIntegrationRequest",
			{
				contentType: "application/json",
				modelName: "CreateIntegrationRequest",
				schema: integrationsModels.createIntegration.schema,
			},
		);

		const updateIntegrationModel = props.api.addModel(
			"UpdateIntegrationRequest",
			{
				contentType: "application/json",
				modelName: "UpdateIntegrationRequest",
				schema: integrationsModels.updateIntegration.schema,
			},
		);

		// POST /integrations
		integrationsResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(createIntegrationFn),
			{
				...props.auth.getMethodOptions(),
				requestModels: { "application/json": createIntegrationModel },
				requestValidator: new apigw.RequestValidator(
					this,
					"CreateIntegrationValidator",
					{
						restApi: props.api,
						validateRequestBody: true,
					},
				),
			},
		);

		// GET /integrations
		integrationsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listIntegrationsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.integration_type": false,
					"method.request.querystring.status": false,
					"method.request.querystring.enabled": false,
					"method.request.querystring.limit": false,
					"method.request.querystring.nextToken": false,
				},
			},
		);

		// /integrations/{integrationId}
		const singleIntegration =
			integrationsResource.addResource("{integrationId}");

		singleIntegration.addMethod(
			"GET",
			new apigw.LambdaIntegration(getIntegrationFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.integrationId": true,
				},
			},
		);

		singleIntegration.addMethod(
			"PATCH",
			new apigw.LambdaIntegration(updateIntegrationFn),
			{
				...props.auth.getMethodOptions(),
				requestModels: { "application/json": updateIntegrationModel },
				requestParameters: {
					"method.request.path.integrationId": true,
				},
				requestValidator: new apigw.RequestValidator(
					this,
					"UpdateIntegrationValidator",
					{
						restApi: props.api,
						validateRequestBody: true,
						validateRequestParameters: true,
					},
				),
			},
		);

		singleIntegration.addMethod(
			"DELETE",
			new apigw.LambdaIntegration(deleteIntegrationFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.integrationId": true,
				},
			},
		);

		const syncHistoryResource = singleIntegration.addResource("sync-history");
		syncHistoryResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getSyncHistoryFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.integrationId": true,
					"method.request.querystring.limit": false,
					"method.request.querystring.nextToken": false,
				},
			},
		);

		const syncResource = integrationsResource.addResource("sync");
		const manualSyncRoot = integrationsResource.addResource("manual-sync");

		// POST /integrations/manual-sync/{integration_type}
		const syncTypeResource = manualSyncRoot.addResource("{integration_type}");
		syncTypeResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(manualSyncTriggerFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.integration_type": true,
				},
			},
		);

		const syncIdResource = syncResource.addResource("{syncId}");
		const detailsResource = syncIdResource.addResource("details");

		detailsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getSyncDetailsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.syncId": true,
					"method.request.querystring.entity_type": false,
					"method.request.querystring.status": false,
					"method.request.querystring.limit": false,
					"method.request.querystring.nextToken": false,
				},
			},
		);

		const testResource = integrationsResource.addResource("test");
		const typeTestResource = testResource.addResource("{integration_type}");
		typeTestResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(testIntegrationFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.path.integration_type": true,
				},
			},
		);

		// OpenAPI
		this.openApiSpec = {
			openapi: "3.0.3",
			info: {
				title: "Integrations API",
				version: "1.0.0",
				description:
					"API for managing external integrations and sync operations",
			},
			tags: [
				{
					name: "Integrations",
					description: "Integration management endpoints",
				},
				{
					name: "Sync History",
					description: "Integration sync history and details",
				},
				{
					name: "Sync Operations",
					description: "Manual sync trigger endpoints",
				},
			],
			paths: {
				"/integrations": {
					post: {
						summary: "Create an integration",
						tags: ["Integrations"],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: integrationsModels.createIntegration.schema,
									example: integrationsModels.createIntegration.example,
								},
							},
						},
						responses: {
							"201": { description: "Integration created" },
							"400": { description: "Validation error" },
							"500": { description: "Internal server error" },
						},
					},
					get: {
						summary: "List integrations",
						tags: ["Integrations"],
						parameters: [
							{
								name: "integration_type",
								in: "query",
								schema: { type: "string" },
							},
							{ name: "status", in: "query", schema: { type: "string" } },
							{ name: "enabled", in: "query", schema: { type: "boolean" } },
							{ name: "limit", in: "query", schema: { type: "integer" } },
							{
								name: "nextToken",
								in: "query",
								schema: { type: "string" },
							},
						],
						responses: {
							"200": { description: "Integrations retrieved" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/integrations/{integrationId}": {
					get: {
						summary: "Get integration",
						tags: ["Integrations"],
						parameters: [
							{
								name: "integrationId",
								in: "path",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							"200": { description: "Integration retrieved" },
							"404": { description: "Not found" },
						},
					},
					patch: {
						summary: "Update integration",
						tags: ["Integrations"],
						parameters: [
							{
								name: "integrationId",
								in: "path",
								required: true,
								schema: { type: "string" },
							},
						],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: integrationsModels.updateIntegration.schema,
								},
							},
						},
						responses: {
							"200": { description: "Integration updated" },
							"400": { description: "Validation error" },
						},
					},
					delete: {
						summary: "Delete integration",
						tags: ["Integrations"],
						parameters: [
							{
								name: "integrationId",
								in: "path",
								required: true,
								schema: { type: "string" },
							},
						],
						responses: {
							"204": { description: "Integration deleted" },
							"404": { description: "Not found" },
						},
					},
				},
				"/integrations/{integrationId}/sync-history": {
					get: {
						summary: "Get sync history for an integration",
						description:
							"Retrieves the sync history for a specific integration with pagination support",
						tags: ["Sync History"],
						parameters: [
							{
								name: "integrationId",
								in: "path",
								required: true,
								schema: { type: "string" },
								description: "The unique identifier of the integration",
							},
							{
								name: "limit",
								in: "query",
								required: false,
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 100,
									default: 50,
								},
								description: "Maximum number of records to return",
							},
							{
								name: "nextToken",
								in: "query",
								required: false,
								schema: { type: "string" },
								description: "Pagination token from previous response",
							},
						],
						responses: {
							"200": {
								description: "Sync history retrieved successfully",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/SyncHistoryResponse",
										},
									},
								},
							},
							"400": { description: "Bad request - invalid parameters" },
							"404": { description: "Integration not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/integrations/manual-sync/{integration_type}": {
					post: {
						summary: "Trigger manual sync",
						description:
							"Triggers a manual sync operation for a specific integration. Publishes a 'Manual Sync Requested' event to EventBridge that initiates the full sync workflow.",
						tags: ["Sync Operations"],
						parameters: [
							{
								name: "integration_type",
								in: "path",
								required: true,
								schema: {
									type: "string",
									enum: ["hubspot", "salesforce", "deel", "linear"],
								},
								description:
									"The type of integration to sync (e.g., 'hubspot', 'salesforce')",
							},
						],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["integration_id"],
										properties: {
											integration_id: {
												type: "string",
												description:
													"The unique identifier of the integration to sync",
											},
										},
									},
									example: {
										integration_id: "int_abc123xyz",
									},
								},
							},
						},
						responses: {
							"200": {
								description: "Sync triggered successfully",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												success: {
													type: "boolean",
													description:
														"Indicates if the sync was successfully triggered",
												},
											},
										},
										example: {
											success: true,
										},
									},
								},
							},
							"400": {
								description:
									"Bad request - missing integration_id or invalid integration_type",
							},
							"401": {
								description: "Unauthorized - requires ENGINEER role",
							},
							"500": {
								description: "Internal server error",
							},
						},
					},
				},
				"/integrations/sync/{syncId}/details": {
					get: {
						summary: "Get detailed sync records",
						description:
							"Retrieves detailed information about individual records processed during a sync operation",
						tags: ["Sync History"],
						parameters: [
							{
								name: "syncId",
								in: "path",
								required: true,
								schema: { type: "string" },
								description: "The unique identifier of the sync operation",
							},
							{
								name: "entity_type",
								in: "query",
								required: false,
								schema: { type: "string" },
								description: "Filter by entity type (e.g., 'contact', 'deal')",
							},
							{
								name: "status",
								in: "query",
								required: false,
								schema: { type: "string", enum: ["success", "failure"] },
								description: "Filter by sync status",
							},
							{
								name: "limit",
								in: "query",
								required: false,
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 200,
									default: 100,
								},
								description: "Maximum number of records to return",
							},
							{
								name: "nextToken",
								in: "query",
								required: false,
								schema: { type: "string" },
								description: "Pagination token from previous response",
							},
						],
						responses: {
							"200": {
								description: "Sync details retrieved successfully",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/SyncDetailsResponse",
										},
									},
								},
							},
							"400": { description: "Bad request - invalid parameters" },
							"404": { description: "Sync operation not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/integrations/test/{integration_type}": {
					post: {
						summary: "Test integration connection",
						description: "Performs real live API connectivity checks to external service (Google, Deel, Linear).",
						tags: ["Integrations"],
						parameters: [
							{
								name: "integration_type",
								in: "path",
								required: true,
								schema: { type: "string" },
								description: "The integration type to test (e.g. google, deel, linear)"
							}
						],
						responses: {
							"200": {
								description: "Test completed",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												success: { type: "boolean" },
												checks: {
													type: "object",
													additionalProperties: { type: "boolean" }
												},
												error: { type: "string", nullable: true }
											}
										}
									}
								}
							},
							"500": { description: "Internal server error" }
						}
					}
				},
			},
			components: {
				schemas: Object.fromEntries(
					Object.entries(integrationsModels).map(([_, v]) => [
						v.name,
						v.schema,
					]),
				),
			},
		};
	}

	private grantTableAccess(
		lambdas: lambda.NodejsFunction[],
		tables: dynamodb.ITable[],
		readWrite = false,
	) {
		lambdas.forEach((fn) => {
			tables.forEach((table) => {
				if (readWrite) {
					table.grantReadWriteData(fn);
				} else {
					table.grantReadData(fn);
				}
			});
		});
	}
}
