import * as apigw from "aws-cdk-lib/aws-apigateway";
import { z } from "zod";
import {
	CreateIntegrationInputSchema,
	IntegrationSchema,
	IntegrationSyncDetailsSchema,
	IntegrationSyncHistorySchema,
	UpdateIntegrationInputSchema,
} from "../../shared/validation/integrations.schema";

export interface ModelDef {
	name: string;
	schema: apigw.JsonSchema;
	example?: any;
}

function zodToApiGatewaySchema(zodSchema: z.ZodTypeAny): apigw.JsonSchema {
	const jsonSchema = z.toJSONSchema(zodSchema, {
		target: "openapi-3.0",
	});
	return jsonSchema as apigw.JsonSchema;
}

/**
 * API Gateway Models for Integrations
 */
export const integrationsModels: Record<string, ModelDef> = {
	createIntegration: {
		name: "CreateIntegrationRequest",
		schema: zodToApiGatewaySchema(CreateIntegrationInputSchema),
		example: {
			integration_type: "hubspot",
			display_name: "HubSpot CRM",
			description: "Integration with HubSpot for contact and deal sync",
			auth_type: "oauth2",
			enabled: true,
			sync_enabled: true,
			sync_frequency_minutes: 60,
			settings: {
				api_version: "v3",
				include_contacts: true,
				include_deals: true,
			},
		},
	},
	updateIntegration: {
		name: "UpdateIntegrationRequest",
		schema: zodToApiGatewaySchema(UpdateIntegrationInputSchema),
		example: {
			display_name: "HubSpot CRM (Updated)",
			enabled: false,
			sync_frequency_minutes: 120,
		},
	},
	integration: {
		name: "Integration",
		schema: zodToApiGatewaySchema(IntegrationSchema),
	},
	syncHistory: {
		name: "IntegrationSyncHistory",
		schema: zodToApiGatewaySchema(IntegrationSyncHistorySchema),
	},
	syncDetails: {
		name: "IntegrationSyncDetails",
		schema: zodToApiGatewaySchema(IntegrationSyncDetailsSchema),
	},
	syncHistoryResponse: {
		name: "SyncHistoryResponse",
		schema: {
			type: apigw.JsonSchemaType.OBJECT,
			properties: {
				integration_id: { type: apigw.JsonSchemaType.STRING },
				items: {
					type: apigw.JsonSchemaType.ARRAY,
					items: { ref: "#/components/schemas/IntegrationSyncHistory" },
				},
				nextToken: { type: apigw.JsonSchemaType.STRING },
				hasMore: { type: apigw.JsonSchemaType.BOOLEAN },
			},
			required: ["integration_id", "items", "hasMore"],
		},
	},
	syncDetailsResponse: {
		name: "SyncDetailsResponse",
		schema: {
			type: apigw.JsonSchemaType.OBJECT,
			properties: {
				sync_id: { type: apigw.JsonSchemaType.STRING },
				items: {
					type: apigw.JsonSchemaType.ARRAY,
					items: { ref: "#/components/schemas/IntegrationSyncDetails" },
				},
				nextToken: { type: apigw.JsonSchemaType.STRING },
				hasMore: { type: apigw.JsonSchemaType.BOOLEAN },
			},
			required: ["sync_id", "items", "hasMore"],
		},
	},
};
