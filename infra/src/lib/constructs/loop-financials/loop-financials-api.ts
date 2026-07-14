import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";
import { loopFinancialsModels } from "../../models/loop-financials";

export class LoopFinancialsApiConstruct extends Construct {
	public readonly openApiSpec: any;

	constructor(
		scope: Construct,
		id: string,
		props: {
			api: apigw.RestApi;
			loopFinancialsTable: dynamodb.ITable;
			auth: CognitoAuth;
		},
	) {
		super(scope, id);

		const createLoopFinancialFn = new lambda.NodejsFunction(
			this,
			"CreateLoopFinancialLambda",
			{
				entry: "src/functions/loop-financials/create-loop-financial.ts",
				handler: "handler",
				environment: {
					LOOP_FINANCIALS_TABLE_NAME: props.loopFinancialsTable.tableName,
				},
			},
		);

		const listLoopFinancialFn = new lambda.NodejsFunction(
			this,
			"ListLoopFinancialLambda",
			{
				entry: "src/functions/loop-financials/list-loop-financials.ts",
				handler: "handler",
				environment: {
					LOOP_FINANCIALS_TABLE_NAME: props.loopFinancialsTable.tableName,
				},
			},
		);

		/**
		 * Grant table permissions to all lambdas
		 */
		const allLambdas = [createLoopFinancialFn, listLoopFinancialFn];

		const allTables = [props.loopFinancialsTable];

		// Grant read/write access to all tables for all lambdas
		this.grantTableAccess(allLambdas, allTables, true);

		const loopFinancialsResource =
			props.api.root.addResource("loop-financials");

		// Models
		const createLoopFinancialModel = props.api.addModel(
			"CreateLoopFinancialRequest",
			{
				contentType: "application/json",
				modelName: "CreateLoopFinancialRequest",
				schema: loopFinancialsModels.createLoopFinancial.schema,
			},
		);

		const loopFinancialResponseModel = props.api.addModel(
			"LoopFinancialResponse",
			{
				contentType: "application/json",
				modelName: "LoopFinancialResponse",
				schema: loopFinancialsModels.loopFinancialResponse.schema,
			},
		);

		// POST /loop-financials - Create
		loopFinancialsResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(createLoopFinancialFn),
			{
				authorizer: props.auth.authorizer,
				requestModels: {
					"application/json": createLoopFinancialModel,
				},
				requestValidator: new apigw.RequestValidator(
					this,
					"CreateLoopFinancialValidator",
					{
						restApi: props.api,
						validateRequestBody: true,
					},
				),
				methodResponses: [
					{
						statusCode: "201",
						responseModels: {
							"application/json": loopFinancialResponseModel,
						},
					},
					{ statusCode: "400" },
					{ statusCode: "500" },
				],
			},
		);

		// GET /loop-financials - List
		loopFinancialsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listLoopFinancialFn),
			{
				authorizer: props.auth.authorizer,
				requestParameters: {
					"method.request.querystring.loop_id": false,
					"method.request.querystring.fiscal_period": false,
					"method.request.querystring.limit": false,
					"method.request.querystring.last_key": false,
				},
				methodResponses: [
					{
						statusCode: "200",
						responseModels: {
							"application/json": apigw.Model.EMPTY_MODEL,
						},
					},
					{ statusCode: "500" },
				],
			},
		);

		// OpenAPI Spec
		this.openApiSpec = {
			paths: {
				"/loop-financials": {
					post: {
						summary: "Create loop financial record",
						tags: ["Loop Financials"],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/CreateLoopFinancialRequest",
									},
								},
							},
						},
						responses: {
							"201": {
								description: "Loop financial created",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/LoopFinancialResponse",
										},
									},
								},
							},
						},
					},
					get: {
						summary: "List loop financials",
						tags: ["Loop Financials"],
						parameters: [
							{
								name: "loop_id",
								in: "query",
								schema: { type: "string" },
							},
							{
								name: "fiscal_period",
								in: "query",
								schema: { type: "string" },
							},
							{
								name: "limit",
								in: "query",
								schema: { type: "integer" },
							},
							{
								name: "last_key",
								in: "query",
								schema: { type: "string" },
							},
						],
						responses: {
							"200": {
								description: "List of loop financials",
							},
						},
					},
				},
			},
			components: {
				schemas: {
					CreateLoopFinancialRequest:
						loopFinancialsModels.createLoopFinancial.schema,
					LoopFinancialResponse:
						loopFinancialsModels.loopFinancialResponse.schema,
				},
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
