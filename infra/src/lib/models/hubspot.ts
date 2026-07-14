import * as apigw from "aws-cdk-lib/aws-apigateway";

export interface ModelDef {
  name: string;
  schema: apigw.JsonSchema;
}

export const hubspotModels: Record<string, ModelDef> = {
  createDeal: {
    name: "CreateDealRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["dealname"],
      properties: {
        dealname: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        amount: { type: apigw.JsonSchemaType.STRING },
        dealstage: { type: apigw.JsonSchemaType.STRING },
        closedate: { type: apigw.JsonSchemaType.STRING },
        pipeline: { type: apigw.JsonSchemaType.STRING },
      },
      additionalProperties: true,
    },
  },

  updateDeal: {
    name: "UpdateDealRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      properties: {
        dealname: { type: apigw.JsonSchemaType.STRING },
        amount: { type: apigw.JsonSchemaType.STRING },
        dealstage: { type: apigw.JsonSchemaType.STRING },
        closedate: { type: apigw.JsonSchemaType.STRING },
      },
      minProperties: 1,
      additionalProperties: true,
    },
  },

  createContact: {
    name: "CreateContactRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["email"],
      properties: {
        email: {
          type: apigw.JsonSchemaType.STRING,
          pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        },
        firstname: { type: apigw.JsonSchemaType.STRING },
        lastname: { type: apigw.JsonSchemaType.STRING },
        phone: { type: apigw.JsonSchemaType.STRING },
        company: { type: apigw.JsonSchemaType.STRING },
      },
      additionalProperties: true,
    },
  },

  updateContact: {
    name: "UpdateContactRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      properties: {
        email: { type: apigw.JsonSchemaType.STRING },
        firstname: { type: apigw.JsonSchemaType.STRING },
        lastname: { type: apigw.JsonSchemaType.STRING },
        phone: { type: apigw.JsonSchemaType.STRING },
      },
      minProperties: 1,
      additionalProperties: true,
    },
  },

  createCompany: {
    name: "CreateCompanyRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["name"],
      properties: {
        name: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        domain: { type: apigw.JsonSchemaType.STRING },
        industry: { type: apigw.JsonSchemaType.STRING },
        phone: { type: apigw.JsonSchemaType.STRING },
        city: { type: apigw.JsonSchemaType.STRING },
        state: { type: apigw.JsonSchemaType.STRING },
      },
      additionalProperties: true,
    },
  },

  batchCreate: {
    name: "BatchCreateRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: apigw.JsonSchemaType.ARRAY,
          minItems: 1,
          maxItems: 100,
          items: { type: apigw.JsonSchemaType.OBJECT },
        },
      },
    },
  },
};
