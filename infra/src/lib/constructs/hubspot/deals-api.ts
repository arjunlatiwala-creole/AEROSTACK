import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { DealPageSchema, DealSchema } from "../../../schemas/hubspot/deals";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";

export interface HubspotDealsApiProps {
	api: apigw.RestApi;
	auth: CognitoAuth;
	secret: sm.ISecret;
	lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class HubspotDealsApi extends Construct {
	public readonly openApiSpec: any;

	constructor(scope: Construct, id: string, props: HubspotDealsApiProps) {
		super(scope, id);

		const createFn = (
			id: string,
			entry: string,
			handler: string,
		): nodejs.NodejsFunction => {
			const fn = new nodejs.NodejsFunction(this, id, {
				...props.lambdaDefaults,
				entry,
				handler,
			});
			props.secret.grantRead(fn);
			return fn;
		};

		const listDeals = createFn(
			"ListDeals",
			"src/functions/hubspot/deals.ts",
			"listDeals",
		);

		const getDeal = createFn(
			"GetDeal",
			"src/functions/hubspot/deals.ts",
			"getDeal",
		);

		const hubspot = props.api.root.addResource("hubspot");
		const deals = hubspot.addResource("deals");

		deals.addMethod(
			"GET",
			new apigw.LambdaIntegration(listDeals),
			props.auth.getMethodOptions(),
		);

		deals
			.addResource("{id}")
			.addMethod(
				"GET",
				new apigw.LambdaIntegration(getDeal),
				props.auth.getMethodOptions(),
			);

		this.openApiSpec = {
			tags: [
				{
					name: "HubSpot Deals",
					description: "Operations related to HubSpot deals",
				},
			],
			paths: {
				"/hubspot/deals": {
					get: {
						summary: "List Deals",
						tags: ["HubSpot Deals"],
						parameters: [
							{
								name: "limit",
								in: "query",
								schema: { type: "number" },
								required: false,
							},
						],
						responses: {
							"200": {
								description: "Page of deals",
								content: { "application/json": { schema: DealPageSchema } },
							},
						},
					},
				},
				"/hubspot/deals/{id}": {
					get: {
						summary: "Get Deal by ID",
						tags: ["HubSpot Deals"],
						parameters: [
							{
								name: "id",
								in: "path",
								schema: { type: "string" },
								required: true,
							},
						],
						responses: {
							"200": {
								description: "Single deal",
								content: { "application/json": { schema: DealSchema } },
							},
						},
					},
				},
			},
			components: { schemas: { Deal: DealSchema, DealPage: DealPageSchema } },
		};
	}
}
