import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";
import { bfpmModels } from "../../models/bfpm";

export interface BfpmApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
  sessionsTable: dynamodb.ITable;
  dataTable: dynamodb.ITable;
}

export class BfpmApiConstruct extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: BfpmApiProps) {
    super(scope, id);

    const createFn = (id: string, entry: string) => {
      const fn = new nodejs.NodejsFunction(this, id, {
        ...props.lambdaDefaults,
        entry,
        handler: "handler",
        environment: {
          BFPM_SESSIONS_TABLE_NAME: props.sessionsTable.tableName,
          BFPM_DATA_TABLE_NAME: props.dataTable.tableName,
          DYNAMODB_LOCAL_ENDPOINT: process.env.DYNAMODB_LOCAL_ENDPOINT || "",
        },
      });
      props.sessionsTable.grantReadWriteData(fn);
      props.dataTable.grantReadWriteData(fn);
      return fn;
    };

    const createLambda = createFn(
      "BfpmCreateLambda",
      "src/functions/bfpm/create.ts"
    );
    const getSessionLambda = createFn(
      "BfpmGetSessionLambda",
      "src/functions/bfpm/get.ts"
    );
    const bfpmRoot = props.api.root.addResource("bfpm");

    /* POST /bfpm/session */
    const sessionResource = bfpmRoot.addResource("session");
    const createSessionModel = props.api.addModel("CreateBfpmSessionRequest", {
      contentType: "application/json",
      modelName: "CreateBfpmSessionRequest",
      schema: bfpmModels.createSession.schema,
    });

    sessionResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createLambda),
      {
        ...props.auth.getMethodOptions(),
        requestModels: { "application/json": createSessionModel },
        requestValidator: new apigw.RequestValidator(this, "SessionValidator", {
          restApi: props.api,
          validateRequestBody: true,
          validateRequestParameters: false,
        }),
      }
    );

    /* POST /bfpm/beacon?sessionId=xxx */
    const beaconResource = bfpmRoot.addResource("beacon");
    const createBeaconModel = props.api.addModel("CreateBeaconSessionRequest", {
      contentType: "application/json",
      modelName: "CreateBeaconSessionRequest",
      schema: bfpmModels.createBeacon.schema,
    });

    beaconResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createLambda),
      {
        ...props.auth.getMethodOptions(),
        requestModels: { "application/json": createBeaconModel },
        requestParameters: { "method.request.querystring.sessionId": true },
        requestValidator: new apigw.RequestValidator(this, "BeaconValidator", {
          restApi: props.api,
          validateRequestBody: true,
          validateRequestParameters: true,
        }),
      }
    );

    /* POST /bfpm/focus?sessionId=xxx */
    const focusResource = bfpmRoot.addResource("focus");
    const createFocusModel = props.api.addModel("CreateFocusSessionRequest", {
      contentType: "application/json",
      modelName: "CreateFocusSessionRequest",
      schema: bfpmModels.createFocus.schema,
    });

    focusResource.addMethod("POST", new apigw.LambdaIntegration(createLambda), {
      ...props.auth.getMethodOptions(),
      requestModels: { "application/json": createFocusModel },
      requestParameters: { "method.request.querystring.sessionId": true },
      requestValidator: new apigw.RequestValidator(this, "FocusValidator", {
        restApi: props.api,
        validateRequestBody: true,
        validateRequestParameters: true,
      }),
    });

    /* POST /bfpm/perspex-input?sessionId=xxx */
    const perspexInputResource = bfpmRoot.addResource("perspex-input");
    const createPerspexInputModel = props.api.addModel(
      "CreatePerspexInputRequest",
      {
        contentType: "application/json",
        modelName: "CreatePerspexInputRequest",
        schema: bfpmModels.createPerspexInput.schema,
      }
    );

    perspexInputResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createLambda),
      {
        ...props.auth.getMethodOptions(),
        requestModels: { "application/json": createPerspexInputModel },
        requestParameters: { "method.request.querystring.sessionId": true },
        requestValidator: new apigw.RequestValidator(
          this,
          "PerspexInputValidator",
          {
            restApi: props.api,
            validateRequestBody: true,
            validateRequestParameters: true,
          }
        ),
      }
    );

    /* POST /bfpm/perspex-summary?sessionId=xxx */
    const perspexSummaryResource = bfpmRoot.addResource("perspex-summary");
    const createPerspexSummaryModel = props.api.addModel(
      "CreatePerspexSummaryRequest",
      {
        contentType: "application/json",
        modelName: "CreatePerspexSummaryRequest",
        schema: bfpmModels.createPerspexSummary.schema,
      }
    );

    perspexSummaryResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createLambda),
      {
        ...props.auth.getMethodOptions(),
        requestModels: { "application/json": createPerspexSummaryModel },
        requestParameters: { "method.request.querystring.sessionId": true },
        requestValidator: new apigw.RequestValidator(
          this,
          "PerspexSummaryValidator",
          {
            restApi: props.api,
            validateRequestBody: true,
            validateRequestParameters: true,
          }
        ),
      }
    );

    /* POST /bfpm/action-plan?sessionId=xxx */
    const actionPlanResource = bfpmRoot.addResource("action-plan");
    const createActionPlanModel = props.api.addModel(
      "CreateActionPlanRequest",
      {
        contentType: "application/json",
        modelName: "CreateActionPlanRequest",
        schema: bfpmModels.createActionPlan.schema,
      }
    );

    actionPlanResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createLambda),
      {
        ...props.auth.getMethodOptions(),
        requestModels: { "application/json": createActionPlanModel },
        requestParameters: { "method.request.querystring.sessionId": true },
        requestValidator: new apigw.RequestValidator(
          this,
          "ActionPlanValidator",
          {
            restApi: props.api,
            validateRequestBody: true,
            validateRequestParameters: true,
          }
        ),
      }
    );

    /* GET /bfpm/session */
    sessionResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getSessionLambda),
      {
        ...props.auth.getMethodOptions(),
      }
    );

    /* GET /bfpm/session/{sessionId} */
    const sessionByIdResource = sessionResource.addResource("{sessionId}");

    sessionByIdResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getSessionLambda),
      {
        ...props.auth.getMethodOptions(),
      }
    );

    /* OpenAPI Spec */
    this.openApiSpec = {
      openapi: "3.0.3",
      info: { title: "BFPM API", version: "1.0.0" },
      tags: [
        {
          name: "BFPM",
          description: "Beacon, Focus, Perspex, ActionPlan endpoints",
        },
      ],
      paths: {
        "/bfpm/session": {
          post: {
            summary: "Create session",
            tags: ["BFPM"],
            requestBody: {
              content: {
                "application/json": { schema: bfpmModels.createSession.schema },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },

          get: {
            summary: "List sessions",
            tags: ["BFPM"],
            responses: {
              "200": {
                description: "Sessions fetched successfully",
              },
              "500": {
                description: "Internal server error",
              },
            },
          },
        },
        "/bfpm/session/{sessionId}": {
          get: {
            summary: "Get session by ID",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": { description: "Session fetched" },
              "404": { description: "Session not found" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/bfpm/beacon": {
          post: {
            summary: "Create beacon",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": { schema: bfpmModels.createBeacon.schema },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/bfpm/focus": {
          post: {
            summary: "Create focus",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": { schema: bfpmModels.createFocus.schema },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/bfpm/perspex-input": {
          post: {
            summary: "Create perspex input",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: bfpmModels.createPerspexInput.schema,
                },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/bfpm/perspex-summary": {
          post: {
            summary: "Create perspex summary",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: bfpmModels.createPerspexSummary.schema,
                },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/bfpm/action-plan": {
          post: {
            summary: "Create action plan",
            tags: ["BFPM"],
            parameters: [
              {
                name: "sessionId",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: bfpmModels.createActionPlan.schema,
                },
              },
              required: true,
            },
            responses: {
              "201": { description: "Created successfully" },
              "400": { description: "Validation error" },
              "500": { description: "Internal server error" },
            },
          },
        },
      },
      components: {
        schemas: Object.fromEntries(
          Object.entries(bfpmModels).map(([_, v]) => [v.name, v.schema])
        ),
      },
    };
  }
}
