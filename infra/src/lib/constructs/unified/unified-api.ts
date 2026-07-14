import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { CognitoAuth } from "../auth/cognito-auth";

export interface UnifiedApiProps {
	api: apigw.RestApi;
	auth: CognitoAuth;
	lambdaDefaults: Omit<
		lambda.NodejsFunctionProps,
		"entry" | "handler" | "environment"
	>;
	unifiedOpportunitiesTable: dynamodb.ITable;
}

export class UnifiedApi extends Construct {
	public readonly openApiSpec: any;

	constructor(scope: Construct, id: string, props: UnifiedApiProps) {
		super(scope, id);

		const tableEnv = {
			UNIFIED_OPPORTUNITIES_TABLE_NAME:
				props.unifiedOpportunitiesTable.tableName,
		};

		// Lambda
		const listOpportunitiesFn = new lambda.NodejsFunction(
			this,
			"ListUnifiedOpportunitiesLambda",
			{
				...props.lambdaDefaults,
				entry: "src/functions/unified/list-opportunities.ts",
				handler: "handler",
				environment: tableEnv,
			},
		);

		props.unifiedOpportunitiesTable.grantReadData(listOpportunitiesFn);

		// API Resources
		const unifiedResource = props.api.root.addResource("unified");
		const opportunitiesResource = unifiedResource.addResource("opportunities");

		opportunitiesResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listOpportunitiesFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.cursor": false,
					"method.request.querystring.source": false,
				},
			},
		);

		// OpenAPI Specification
		this.openApiSpec = {
			openapi: "3.0.3",
			info: {
				title: "Unified Opportunities API",
				version: "1.0.0",
				description:
					"API for viewing unified opportunities from HubSpot and APN-ACE",
			},
			tags: [
				{
					name: "Unified",
					description: "Unified CRM opportunity endpoints",
				},
			],
			paths: {
				"/unified/opportunities": {
					get: {
						summary: "List Unified Opportunities",
						description:
							"Retrieve paginated list of unified opportunities from all sources",
						tags: ["Unified"],
						parameters: [
							{
								name: "limit",
								in: "query",
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 100,
									default: 20,
								},
								description: "Number of items per page",
							},
							{
								name: "cursor",
								in: "query",
								schema: { type: "string" },
								description: "Pagination cursor from previous response",
							},
							{
								name: "source",
								in: "query",
								schema: {
									type: "string",
									enum: ["hubspot", "apn-ace"],
								},
								description: "Filter by opportunity source",
							},
						],
						responses: {
							"200": {
								description: "Paginated list of unified opportunities",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/UnifiedOpportunitiesResponse",
										},
									},
								},
							},
							"400": { description: "Invalid query parameters" },
							"500": { description: "Internal server error" },
						},
					},
				},
			},
			components: {
				schemas: {
					UnifiedOpportunity: {
						type: "object",
						properties: {
							opportunityId: { type: "string" },
							source: {
								type: "string",
								enum: ["hubspot", "apn-ace"],
							},
							title: { type: "string", nullable: true },
							description: { type: "string", nullable: true },
							stage: { type: "string", nullable: true },
							pipeline: { type: "string", nullable: true },
							amount: { type: "number", nullable: true },
							currency: { type: "string", nullable: true },
							closeDate: { type: "string", nullable: true },
							ownerName: { type: "string", nullable: true },
							ownerEmail: { type: "string", nullable: true },
							companyName: { type: "string", nullable: true },
							companyDomain: { type: "string", nullable: true },
							companyIndustry: { type: "string", nullable: true },
							contacts: {
								type: "array",
								items: {
									$ref: "#/components/schemas/UnifiedContact",
								},
							},
							phase: { type: "string", nullable: true },
							phase_label: { type: "string", nullable: true },
							health_status: {
								type: "string",
								enum: ["GREEN", "YELLOW", "ORANGE", "RED"],
								nullable: true,
							},
							createdAt: { type: "string" },
							updatedAt: { type: "string" },
						},
					},
					UnifiedContact: {
						type: "object",
						properties: {
							firstName: { type: "string", nullable: true },
							lastName: { type: "string", nullable: true },
							email: { type: "string", nullable: true },
							phone: { type: "string", nullable: true },
							jobTitle: { type: "string", nullable: true },
						},
					},
					PipelinePhase: {
						type: "object",
						properties: {
							phase: { type: "string" },
							phase_label: { type: "string" },
							deal_count: { type: "integer" },
							total_value: { type: "number" },
							health_distribution: { type: "object" },
							deals: {
								type: "array",
								items: {
									$ref: "#/components/schemas/UnifiedOpportunity",
								},
							},
						},
					},
					UnifiedOpportunitiesResponse: {
						type: "object",
						properties: {
							deals: {
								type: "array",
								items: {
									$ref: "#/components/schemas/UnifiedOpportunity",
								},
							},
							pipeline: {
								type: "array",
								items: {
									$ref: "#/components/schemas/PipelinePhase",
								},
							},
							total_deals: { type: "integer" },
							total_pipeline_value: { type: "number" },
							total_active_deals: { type: "integer" },
							health_distribution: { type: "object" },
							pageSize: { type: "integer" },
							totalPages: { type: "integer" },
							hasMore: { type: "boolean" },
							nextCursor: { type: "string", nullable: true },
						},
					},
				},
			},
		};
	}
}
