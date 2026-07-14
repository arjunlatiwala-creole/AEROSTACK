import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { IApiAuth } from "../auth/cognito-auth";

export interface RevOpsApiProps {
  api: apigw.RestApi;
  auth: IApiAuth;
  dealsTable: dynamodb.ITable;
  loopsTable: dynamodb.ITable;
  mboTable: dynamodb.ITable;
  cadenceTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * RevOps Productivity API — reps, forecast, alerts, MBO, cadence.
 * Additive construct (new logical IDs only). Routes:
 *   GET  /revops/reps            GET /revops/reps/{email}
 *   GET  /revops/forecast        GET /revops/alerts
 *   PUT  /revops/mbo/{email}     (Admin)
 *   GET  /revops/cadence         PUT /revops/cadence/loops/{loop_id}
 */
export class RevOpsApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: RevOpsApiProps) {
    super(scope, id);

    const env = {
      DEALS_TABLE_NAME: props.dealsTable.tableName,
      LOOPS_TABLE_NAME: props.loopsTable.tableName,
      REVOPS_MBO_TABLE_NAME: props.mboTable.tableName,
      REVOPS_CADENCE_TABLE_NAME: props.cadenceTable.tableName,
    };

    const fn = (fid: string, handler: string): NodejsFunction => {
      const f = new NodejsFunction(this, fid, {
        ...props.lambdaDefaults,
        entry: "src/functions/revops/handlers.ts",
        handler,
        environment: env,
      });
      props.dealsTable.grantReadData(f);
      props.loopsTable.grantReadData(f);
      props.mboTable.grantReadWriteData(f);
      props.cadenceTable.grantReadWriteData(f);
      return f;
    };

    const listReps = fn("RevOpsListReps", "listReps");
    const getRep = fn("RevOpsGetRep", "getRep");
    const forecast = fn("RevOpsForecast", "forecast");
    const alerts = fn("RevOpsAlerts", "alerts");
    const setMbo = fn("RevOpsSetMbo", "setMbo");
    const getCadence = fn("RevOpsGetCadence", "getCadence");
    const setCadence = fn("RevOpsSetCadenceState", "setCadenceState");

    const opts = props.auth.getMethodOptions();
    const revops = props.api.root.getResource("revops") ?? props.api.root.addResource("revops");

    const reps = revops.addResource("reps");
    reps.addMethod("GET", new apigw.LambdaIntegration(listReps), opts);
    reps.addResource("{email}").addMethod("GET", new apigw.LambdaIntegration(getRep), opts);

    revops.addResource("forecast").addMethod("GET", new apigw.LambdaIntegration(forecast), opts);
    revops.addResource("alerts").addMethod("GET", new apigw.LambdaIntegration(alerts), opts);

    revops.addResource("mbo").addResource("{email}").addMethod("PUT", new apigw.LambdaIntegration(setMbo), opts);

    const cadence = revops.addResource("cadence");
    cadence.addMethod("GET", new apigw.LambdaIntegration(getCadence), opts);
    cadence.addResource("loops").addResource("{loop_id}").addMethod("PUT", new apigw.LambdaIntegration(setCadence), opts);

    this.openApiSpec = {
      tags: [{ name: "RevOps Productivity", description: "Rep productivity, forecast, alerts, MBO, cadence" }],
      paths: {
        "/revops/reps": { get: { summary: "Per-rep productivity (Seller sees own row)", tags: ["RevOps Productivity"], responses: { "200": { description: "Rep rollups" } } } },
        "/revops/reps/{email}": { get: { summary: "Single rep productivity", tags: ["RevOps Productivity"], parameters: [{ name: "email", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Rep" }, "404": { description: "Not found" } } } },
        "/revops/forecast": { get: { summary: "Per-deal forecast categories + stalled flags", tags: ["RevOps Productivity"], responses: { "200": { description: "Forecast" } } } },
        "/revops/alerts": { get: { summary: "Stalled deals + coverage shortfalls", tags: ["RevOps Productivity"], responses: { "200": { description: "Alerts" } } } },
        "/revops/mbo/{email}": { put: { summary: "Set MBO outcome targets (Admin)", tags: ["RevOps Productivity"], parameters: [{ name: "email", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "MBO set" } } } },
        "/revops/cadence": { get: { summary: "4-block weekly cadence payload", tags: ["RevOps Productivity"], responses: { "200": { description: "Cadence" } } } },
        "/revops/cadence/loops/{loop_id}": { put: { summary: "Set loop cadence_state (overlay)", tags: ["RevOps Productivity"], parameters: [{ name: "loop_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } } },
      },
    };
  }
}
