import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { CognitoAuth } from "../auth/cognito-auth";

export interface APNDashboardApiProps {
	api: apigw.RestApi;
	auth: CognitoAuth;
	lambdaDefaults: Omit<
		lambda.NodejsFunctionProps,
		"entry" | "handler" | "environment"
	>;
	partnerOpportunitiesTable: dynamodb.ITable;
	partnerEngagementsTable: dynamodb.ITable;
	partnerEngagementInvitationsTable: dynamodb.ITable;
}

export class APNDashboardApi extends Construct {
	public readonly openApiSpec: any;

	constructor(scope: Construct, id: string, props: APNDashboardApiProps) {
		super(scope, id);

		const tableEnv = {
			PARTNER_OPPORTUNITIES_TABLE_NAME:
				props.partnerOpportunitiesTable.tableName,
			PARTNER_ENGAGEMENTS_TABLE_NAME: props.partnerEngagementsTable.tableName,
			PARTNER_ENGAGEMENT_INVITATIONS_TABLE_NAME:
				props.partnerEngagementInvitationsTable.tableName,
		};

		// Lambda Functions
		const listOpportunitiesFn = new lambda.NodejsFunction(
			this,
			"ListOpportunitiesLambda",
			{
				...props.lambdaDefaults,
				entry: "src/functions/apn-dashboard/list-opportunities.ts",
				handler: "handler",
				environment: tableEnv,
			},
		);

		const listEngagementsFn = new lambda.NodejsFunction(
			this,
			"ListEngagementsLambda",
			{
				...props.lambdaDefaults,
				entry: "src/functions/apn-dashboard/list-engagements.ts",
				handler: "handler",
				environment: tableEnv,
			},
		);

		const listInvitationsFn = new lambda.NodejsFunction(
			this,
			"ListInvitationsLambda",
			{
				...props.lambdaDefaults,
				entry: "src/functions/apn-dashboard/list-engagement-invitations.ts",
				handler: "handler",
				environment: tableEnv,
			},
		);

		// Grant table read permissions
		props.partnerOpportunitiesTable.grantReadData(listOpportunitiesFn);
		props.partnerEngagementsTable.grantReadData(listEngagementsFn);
		props.partnerEngagementInvitationsTable.grantReadData(listInvitationsFn);

		// Also grant read to all lambdas for cross-entity queries if needed
		props.partnerOpportunitiesTable.grantReadData(listEngagementsFn);
		props.partnerOpportunitiesTable.grantReadData(listInvitationsFn);
		props.partnerEngagementsTable.grantReadData(listOpportunitiesFn);
		props.partnerEngagementsTable.grantReadData(listInvitationsFn);
		props.partnerEngagementInvitationsTable.grantReadData(listOpportunitiesFn);
		props.partnerEngagementInvitationsTable.grantReadData(listEngagementsFn);

		// API Resources
		const apnResource = props.api.root.addResource("apn");

		// GET /apn/opportunities
		const opportunitiesResource = apnResource.addResource("opportunities");
		opportunitiesResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listOpportunitiesFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.last_key": false,
					"method.request.querystring.stage": false,
					"method.request.querystring.status": false,
				},
			},
		);

		// GET /apn/engagements
		const engagementsResource = apnResource.addResource("engagements");
		engagementsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listEngagementsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.last_key": false,
				},
			},
		);

		// GET /apn/engagement-invitations
		const invitationsResource = apnResource.addResource(
			"engagement-invitations",
		);
		invitationsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listInvitationsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.last_key": false,
					"method.request.querystring.status": false,
				},
			},
		);

		// OpenAPI Specification
		this.openApiSpec = {
			openapi: "3.0.3",
			info: {
				title: "APN Dashboard API",
				version: "1.0.0",
				description:
					"API for viewing AWS Partner Network opportunities, engagements, and invitations",
			},
			tags: [
				{
					name: "APN",
					description: "AWS Partner Network dashboard endpoints",
				},
			],
			paths: {
				"/apn/opportunities": {
					get: {
						summary: "List APN Opportunities",
						description:
							"Retrieve paginated list of AWS Partner Network opportunities",
						tags: ["APN"],
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
								name: "last_key",
								in: "query",
								schema: { type: "string" },
								description: "Pagination cursor from previous response",
							},
							{
								name: "stage",
								in: "query",
								schema: {
									type: "string",
									enum: [
										"Prospect",
										"Qualified",
										"Technical Validation",
										"Business Validation",
										"Committed",
										"Launched",
										"Closed Lost",
									],
								},
								description: "Filter by opportunity stage",
							},
							{
								name: "status",
								in: "query",
								schema: {
									type: "string",
									enum: [
										"Pending Submission",
										"Submitted",
										"In Review",
										"Approved",
										"Rejected",
										"Action Required",
									],
								},
								description: "Filter by review status",
							},
						],
						responses: {
							"200": {
								description: "Paginated list of opportunities",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/APNOpportunitiesResponse",
										},
									},
								},
							},
							"400": { description: "Invalid query parameters" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/apn/engagements": {
					get: {
						summary: "List APN Engagements",
						description:
							"Retrieve paginated list of AWS Partner Network engagements",
						tags: ["APN"],
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
								name: "last_key",
								in: "query",
								schema: { type: "string" },
								description: "Pagination cursor from previous response",
							},
						],
						responses: {
							"200": {
								description: "Paginated list of engagements",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/APNEngagementsResponse",
										},
									},
								},
							},
							"400": { description: "Invalid query parameters" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/apn/engagement-invitations": {
					get: {
						summary: "List APN Engagement Invitations",
						description:
							"Retrieve paginated list of AWS Partner Network engagement invitations",
						tags: ["APN"],
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
								name: "last_key",
								in: "query",
								schema: { type: "string" },
								description: "Pagination cursor from previous response",
							},
							{
								name: "status",
								in: "query",
								schema: {
									type: "string",
									enum: ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"],
								},
								description: "Filter by invitation status",
							},
						],
						responses: {
							"200": {
								description: "Paginated list of engagement invitations",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/APNInvitationsResponse",
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
					APNOpportunity: {
						type: "object",
						properties: {
							opportunityId: { type: "string" },
							arn: { type: "string" },
							customerCompanyName: { type: "string" },
							projectTitle: { type: "string" },
							stage: { type: "string" },
							reviewStatus: { type: "string" },
							targetCloseDate: { type: "string" },
							expectedMonthlySpend: { type: "number" },
							ownerEmail: { type: "string" },
							lastModifiedDate: { type: "string" },
						},
					},
					APNEngagement: {
						type: "object",
						properties: {
							engagementId: { type: "string" },
							title: { type: "string" },
							description: { type: "string" },
							customerCompanyName: { type: "string" },
							memberCount: { type: "integer" },
							createdAt: { type: "string" },
						},
					},
					APNEngagementInvitation: {
						type: "object",
						properties: {
							invitationId: { type: "string" },
							engagementTitle: { type: "string" },
							customerCompanyName: { type: "string" },
							status: { type: "string" },
							invitationDate: { type: "string" },
							senderCompanyName: { type: "string" },
						},
					},
					APNPaginatedResponse: {
						type: "object",
						properties: {
							items: { type: "array" },
							total: { type: "integer" },
							totalPages: { type: "integer" },
							pageSize: { type: "integer" },
							hasMore: { type: "boolean" },
							nextCursor: { type: "string", nullable: true },
							count: { type: "integer" },
						},
					},
					APNOpportunitiesResponse: {
						allOf: [
							{ $ref: "#/components/schemas/APNPaginatedResponse" },
							{
								type: "object",
								properties: {
									items: {
										type: "array",
										items: { $ref: "#/components/schemas/APNOpportunity" },
									},
								},
							},
						],
					},
					APNEngagementsResponse: {
						allOf: [
							{ $ref: "#/components/schemas/APNPaginatedResponse" },
							{
								type: "object",
								properties: {
									items: {
										type: "array",
										items: { $ref: "#/components/schemas/APNEngagement" },
									},
								},
							},
						],
					},
					APNInvitationsResponse: {
						allOf: [
							{ $ref: "#/components/schemas/APNPaginatedResponse" },
							{
								type: "object",
								properties: {
									items: {
										type: "array",
										items: {
											$ref: "#/components/schemas/APNEngagementInvitation",
										},
									},
								},
							},
						],
					},
				},
			},
		};
	}
}
