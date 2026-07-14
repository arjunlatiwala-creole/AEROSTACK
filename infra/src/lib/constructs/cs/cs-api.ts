import * as apigw from "aws-cdk-lib/aws-apigateway";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { IApiAuth } from "../auth/cognito-auth";

export interface CustomerSuccessApiProps {
  api: apigw.RestApi;
  auth: IApiAuth;
  csTicketsTable: dynamodb.ITable;
  csCoreTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

/**
 * Aerostack Customer Success API (CS-1: support ticketing).
 * Additive construct — new logical IDs only. Routes:
 *   POST   /cs/tickets
 *   GET    /cs/tickets
 *   GET    /cs/tickets/{id}
 *   PUT    /cs/tickets/{id}
 *   POST   /cs/tickets/{id}/messages
 */
export class CustomerSuccessApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: CustomerSuccessApiProps) {
    super(scope, id);

    const fn = (fid: string, handler: string): NodejsFunction => {
      const f = new NodejsFunction(this, fid, {
        ...props.lambdaDefaults,
        entry: "src/functions/cs/tickets.ts",
        handler,
        environment: { CS_TICKETS_TABLE_NAME: props.csTicketsTable.tableName },
      });
      props.csTicketsTable.grantReadWriteData(f);
      return f;
    };

    const createFn = fn("CsCreateTicket", "createTicket");
    const listFn = fn("CsListTickets", "listTickets");
    const getFn = fn("CsGetTicket", "getTicket");
    const updateFn = fn("CsUpdateTicket", "updateTicket");
    const msgFn = fn("CsAddMessage", "addMessage");

    const cs =
      props.api.root.getResource("cs") ?? props.api.root.addResource("cs");
    const tickets = cs.addResource("tickets");
    const opts = props.auth.getMethodOptions();

    tickets.addMethod("POST", new apigw.LambdaIntegration(createFn), opts);
    tickets.addMethod("GET", new apigw.LambdaIntegration(listFn), opts);

    const byId = tickets.addResource("{id}");
    byId.addMethod("GET", new apigw.LambdaIntegration(getFn), opts);
    byId.addMethod("PUT", new apigw.LambdaIntegration(updateFn), opts);

    byId
      .addResource("messages")
      .addMethod("POST", new apigw.LambdaIntegration(msgFn), opts);

    /* ---------------- CS core surface (accounts/renewals/csat/etc) -------- */
    const coreFn = (fid: string, handler: string): NodejsFunction => {
      const f = new NodejsFunction(this, fid, {
        ...props.lambdaDefaults,
        entry: "src/functions/cs/core.ts",
        handler,
        environment: {
          CS_CORE_TABLE_NAME: props.csCoreTable.tableName,
          CS_TICKETS_TABLE_NAME: props.csTicketsTable.tableName,
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
        },
      });
      props.csCoreTable.grantReadWriteData(f);
      props.csTicketsTable.grantReadData(f);
      props.dealsTable.grantReadData(f);
      props.companiesTable.grantReadData(f);
      return f;
    };

    const accounts = cs.addResource("accounts");
    accounts.addMethod("GET", new apigw.LambdaIntegration(coreFn("CsListAccounts", "listAccounts")), opts);
    accounts.addMethod("POST", new apigw.LambdaIntegration(coreFn("CsUpsertAccount", "upsertAccount")), opts);
    accounts.addResource("seed").addMethod("POST", new apigw.LambdaIntegration(coreFn("CsSeedAccounts", "seedAccounts")), opts);
    const acctById = accounts.addResource("{id}");
    acctById.addMethod("GET", new apigw.LambdaIntegration(coreFn("CsGetAccount", "getAccount")), opts);
    acctById.addMethod("PUT", new apigw.LambdaIntegration(coreFn("CsUpdateAccount", "upsertAccount")), opts);
    acctById.addResource("csm").addMethod("PUT", new apigw.LambdaIntegration(coreFn("CsAssignCsm", "assignCsm")), opts);
    const plan = acctById.addResource("plan");
    plan.addMethod("GET", new apigw.LambdaIntegration(coreFn("CsGetPlan", "getPlan")), opts);
    plan.addMethod("PUT", new apigw.LambdaIntegration(coreFn("CsPutPlan", "putPlan")), opts);

    const renewals = cs.addResource("renewals");
    renewals.addMethod("GET", new apigw.LambdaIntegration(coreFn("CsListRenewals", "listRenewals")), opts);
    renewals.addResource("{id}").addMethod("PUT", new apigw.LambdaIntegration(coreFn("CsUpsertRenewal", "upsertRenewal")), opts);

    const csat = cs.addResource("csat");
    csat.addResource("responses").addMethod("POST", new apigw.LambdaIntegration(coreFn("CsCsatResponse", "csatResponse")), opts);
    csat.addResource("trends").addMethod("GET", new apigw.LambdaIntegration(coreFn("CsCsatTrends", "csatTrends")), opts);

    const esc = cs.addResource("escalations");
    esc.addMethod("GET", new apigw.LambdaIntegration(coreFn("CsListEscalations", "listEscalations")), opts);
    esc.addMethod("POST", new apigw.LambdaIntegration(coreFn("CsOpenEscalation", "openEscalation")), opts);

    cs.addResource("cost").addMethod("GET", new apigw.LambdaIntegration(coreFn("CsCost", "cost")), opts);
    cs.addResource("security").addMethod("GET", new apigw.LambdaIntegration(coreFn("CsSecurity", "security")), opts);
    cs.addResource("compliance").addMethod("GET", new apigw.LambdaIntegration(coreFn("CsCompliance", "compliance")), opts);

    this.openApiSpec = {
      tags: [
        {
          name: "Customer Success",
          description: "CS support ticketing (CS-1)",
        },
      ],
      paths: {
        "/cs/tickets": {
          post: { summary: "Open a support ticket", tags: ["Customer Success"], responses: { "201": { description: "Created" } } },
          get: { summary: "List support tickets (tenant-scoped)", tags: ["Customer Success"], responses: { "200": { description: "Ticket queue" } } },
        },
        "/cs/tickets/{id}": {
          get: { summary: "Get ticket + message thread", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Ticket" }, "404": { description: "Not found" } } },
          put: { summary: "Update status/assignee/priority (SLA recompute)", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
        },
        "/cs/tickets/{id}/messages": {
          post: { summary: "Add a message (internal_only flag for enterprise-ops notes)", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Message added" } } },
        },
        "/cs/accounts": {
          get: { summary: "List accounts (CSM-scoped; lead/Admin see all)", tags: ["Customer Success"], responses: { "200": { description: "Accounts" } } },
          post: { summary: "Create/update an account", tags: ["Customer Success"], responses: { "201": { description: "Created" } } },
        },
        "/cs/accounts/seed": { post: { summary: "Seed accounts from HubSpot companies mirror", tags: ["Customer Success"], responses: { "200": { description: "Seeded" } } } },
        "/cs/accounts/{id}": {
          get: { summary: "Account + composite health (7-input)", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Account" }, "404": { description: "Not found" } } },
          put: { summary: "Update account", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
        },
        "/cs/accounts/{id}/csm": { put: { summary: "Assign/reassign CSM (lead/Admin)", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Assigned" } } } },
        "/cs/accounts/{id}/plan": {
          get: { summary: "Get success plan / QBR", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Plan" } } },
          put: { summary: "Update success plan / QBR", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
        },
        "/cs/renewals": { get: { summary: "Renewal pipeline (filter by status)", tags: ["Customer Success"], responses: { "200": { description: "Renewals" } } } },
        "/cs/renewals/{id}": { put: { summary: "Create/update renewal", tags: ["Customer Success"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } } },
        "/cs/csat/responses": { post: { summary: "Record a CSAT/NPS response", tags: ["Customer Success"], responses: { "201": { description: "Recorded" } } } },
        "/cs/csat/trends": { get: { summary: "CSAT/NPS trend over time", tags: ["Customer Success"], parameters: [{ name: "account_id", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Trend" } } } },
        "/cs/escalations": {
          get: { summary: "List escalations", tags: ["Customer Success"], responses: { "200": { description: "Escalations" } } },
          post: { summary: "Open an escalation", tags: ["Customer Success"], responses: { "201": { description: "Opened" } } },
        },
        "/cs/cost": { get: { summary: "Cost surface (CostDataProvider stub)", tags: ["Customer Success"], responses: { "200": { description: "Cost" } } } },
        "/cs/security": { get: { summary: "Security posture (PostureProvider stub)", tags: ["Customer Success"], responses: { "200": { description: "Posture" } } } },
        "/cs/compliance": { get: { summary: "Compliance status (ComplianceProvider stub)", tags: ["Customer Success"], responses: { "200": { description: "Compliance" } } } },
      },
    };
  }
}
