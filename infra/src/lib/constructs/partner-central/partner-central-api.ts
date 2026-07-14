import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { z } from "zod";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";

/**
 * Zod schemas for request and response
 */
const PartnerRequestSchema = z.object({
	type: z.string(),
	id: z.string().optional(),
	catalog: z.string().optional(),
});

const PartnerResponseSchema = z.object({
	success: z.boolean(),
	data: z.record(z.string(), z.unknown()).optional(),
	error: z.string().optional(),
});

function zodToApiGatewaySchema(zodSchema: z.ZodTypeAny): apigw.JsonSchema {
	const jsonSchema = z.toJSONSchema(zodSchema, {
		target: "openapi-3.0",
	});
	return jsonSchema as apigw.JsonSchema;
}

export interface PartnerApiConstructProps {
	api: apigw.RestApi;
	auth: CognitoAuth;
	lambdaDefaults: Omit<
		nodejs.NodejsFunctionProps,
		"entry" | "handler" | "environment"
	> & {
		environment?: Record<string, string>;
	};
	roleArn: string;
}

export class PartnerApiConstruct extends Construct {
	public readonly openApiSpec: any;

	constructor(scope: Construct, id: string, props: PartnerApiConstructProps) {
		super(scope, id);

		const createFunction = (
			id: string,
			entry: string,
			handler: string,
		): nodejs.NodejsFunction =>
			new nodejs.NodejsFunction(this, id, {
				...props.lambdaDefaults,
				entry,
				handler,
				environment: {
					ROLE_ARN: props.roleArn,
					...props.lambdaDefaults.environment,
				},
			});

		const partnerLambda = createFunction(
			"PartnerCentralLambda",
			"src/functions/partner-central/index.ts",
			"handler",
		);

		const partnerResource = props.api.root.addResource("partner-central");

		// API Gateway Models
		const partnerRequestModel = props.api.addModel("PartnerRequestModel", {
			contentType: "application/json",
			modelName: "PartnerRequestModel",
			schema: zodToApiGatewaySchema(PartnerRequestSchema),
		});

		const partnerResponseModel = props.api.addModel("PartnerResponseModel", {
			contentType: "application/json",
			modelName: "PartnerResponseModel",
			schema: zodToApiGatewaySchema(PartnerResponseSchema),
		});

		// POST /partner-central
		partnerResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(partnerLambda),
			{
				authorizationType: apigw.AuthorizationType.COGNITO,
				authorizer: props.auth.authorizer,
				requestModels: { "application/json": partnerRequestModel },
				requestValidator: new apigw.RequestValidator(
					this,
					"PartnerRequestValidator",
					{
						restApi: props.api,
						validateRequestBody: true,
					},
				),
				methodResponses: [
					{
						statusCode: "200",
						responseModels: { "application/json": partnerResponseModel },
					},
					{ statusCode: "400" },
					{ statusCode: "500" },
				],
			},
		);

		this.openApiSpec = {
			paths: {
				"/partner-central": {
					post: {
						summary: "Partner Central API",
						tags: ["Partner Central"],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/PartnerRequest" },
								},
							},
						},
						responses: {
							"200": {
								description: "Lambda response",
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/PartnerResponse" },
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					PartnerRequest: zodToApiGatewaySchema(PartnerRequestSchema),
					PartnerResponse: zodToApiGatewaySchema(PartnerResponseSchema),
				},
			},
		};
	}
}
