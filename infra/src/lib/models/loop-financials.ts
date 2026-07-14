import * as apigw from "aws-cdk-lib/aws-apigateway";

export const loopFinancialsModels = {
    createLoopFinancial: {
        schema: {
            type: apigw.JsonSchemaType.OBJECT,
            required: ["loop_id"],
            properties: {
                loop_id: { type: apigw.JsonSchemaType.STRING, format: "uuid" },
                budget_usd: { type: apigw.JsonSchemaType.NUMBER },
                actual_spend_usd: { type: apigw.JsonSchemaType.NUMBER },
                revenue_generated_usd: { type: apigw.JsonSchemaType.NUMBER },
                cost_center: { type: apigw.JsonSchemaType.STRING },
                fiscal_period: { type: apigw.JsonSchemaType.STRING },
                notes: { type: apigw.JsonSchemaType.STRING },
            },
        },
    },
    loopFinancialResponse: {
        schema: {
            type: apigw.JsonSchemaType.OBJECT,
            properties: {
                financial_id: { type: apigw.JsonSchemaType.STRING },
                loop_id: { type: apigw.JsonSchemaType.STRING },
                budget_usd: { type: apigw.JsonSchemaType.NUMBER },
                actual_spend_usd: { type: apigw.JsonSchemaType.NUMBER },
                revenue_generated_usd: { type: apigw.JsonSchemaType.NUMBER },
                cost_center: { type: apigw.JsonSchemaType.STRING },
                fiscal_period: { type: apigw.JsonSchemaType.STRING },
                notes: { type: apigw.JsonSchemaType.STRING },
                created_at: { type: apigw.JsonSchemaType.STRING },
                updated_at: { type: apigw.JsonSchemaType.STRING },
            },
        },
    },
};