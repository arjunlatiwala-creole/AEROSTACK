import * as apigw from "aws-cdk-lib/aws-apigateway";

export interface ModelDef {
  name: string;
  schema: apigw.JsonSchema;
}

export const bfpmModels: Record<string, ModelDef> = {
  createSession: {
    name: "CreateBfpmSessionRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["title", "sessionType", "status", "participants"],
      properties: {
        title: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        sessionType: {
          type: apigw.JsonSchemaType.STRING,
          enum: ["strategic", "tactical", "operational"],
        },
        status: {
          type: apigw.JsonSchemaType.STRING,
          enum: ["beacon", "focus", "perspex", "move", "completed"],
        },
        participants: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
      },
      additionalProperties: false,
    },
  },


  createBeacon: {
    name: "CreateBeaconSessionRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["statement", "tags", "timeframe", "confidence"],
      properties: {
        sessionId: { type: apigw.JsonSchemaType.STRING },
        statement: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        tags: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        timeframe: { type: apigw.JsonSchemaType.STRING },
        confidence: {
          type: apigw.JsonSchemaType.NUMBER,
          minimum: 0,
          maximum: 1,
        },
        contextVector: { type: apigw.JsonSchemaType.STRING },
      },
      additionalProperties: false,
    },
  },


  createFocus: {
    name: "CreateFocusSessionRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["challengeText", "tags"],
      properties: {
        challengeText: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        tags: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
      },
      additionalProperties: false,
    },
  },

  createPerspexInput: {
    name: "CreatePerspexInputRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: ["participantId", "top3", "risk"],
      properties: {
        participantId: { type: apigw.JsonSchemaType.STRING },
        top3: {
          type: apigw.JsonSchemaType.ARRAY,
          minItems: 3,
          maxItems: 3,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        risk: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
        level: {
          type: apigw.JsonSchemaType.STRING,
          enum: ["individual", "systemic", "strategic"],
        },
      },
      additionalProperties: false,
    },
  },

  createPerspexSummary: {
    name: "CreatePerspexSummaryRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: [
        "commonGround",
        "tensions",
        "mergedChallenge",
        "generalizedRisks",
      ],
      properties: {
        focusId: { type: apigw.JsonSchemaType.STRING },
        beaconId: { type: apigw.JsonSchemaType.STRING },
        commonGround: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        tensions: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        mergedChallenge: { type: apigw.JsonSchemaType.STRING },
        generalizedRisks: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
      },
      additionalProperties: false,
    },
  },


  createActionPlan: {
    name: "CreateActionPlanRequest",
    schema: {
      type: apigw.JsonSchemaType.OBJECT,
      required: [
        "objectives",
        "owners",
        "timeframe",
        "supportLevel",
      ],
      properties: {
        summaryId: { type: apigw.JsonSchemaType.STRING },
        objectives: {
          type: apigw.JsonSchemaType.ARRAY,
          minItems: 1,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        owners: {
          type: apigw.JsonSchemaType.ARRAY,
          items: { type: apigw.JsonSchemaType.STRING },
        },
        timeframe: { type: apigw.JsonSchemaType.STRING },
        supportLevel: {
          type: apigw.JsonSchemaType.STRING,
          enum: ["low", "medium", "high"],
        },
        linkedBeacon: { type: apigw.JsonSchemaType.STRING },
      },
      additionalProperties: false,
    },
  },


};
