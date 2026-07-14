import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as sm from "aws-cdk-lib/aws-secretsmanager";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { DealPageSchema, DealSchema } from "../../../schemas/hubspot/deals";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";

export interface HubspotDealsListApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  //   secret: sm.ISecret;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class HubspotDealsListApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: HubspotDealsListApiProps) {
    super(scope, id);

    const createFn = (
      id: string,
      entry: string,
      handler: string
    ): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, id, {
        ...props.lambdaDefaults,
        entry,
        handler,
        environment: {
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
          CONTACTS_TABLE_NAME: props.contactsTable.tableName,
        },
      });
      // Grant read permissions to all tables
      props.dealsTable.grantReadData(fn);
      props.companiesTable.grantReadData(fn);
      props.contactsTable.grantReadData(fn);

      //   props.secret.grantRead(fn);
      return fn;
    };

    const listDeals = createFn(
      "ListDeals",
      "src/functions/hubspot/deals-list.ts",
      "listDeals"
    );

    const getDeal = createFn(
      "GetDeal",
      "src/functions/hubspot/deals-list.ts",
      "getDeal"
    );

    const getRevOpsDashboardData = createFn(
      "GetRevOpsDashboardData",
      "src/functions/hubspot/deals-list.ts",
      "getRevOpsDashboardData"
    );

    // Delete HubSpot data Lambda (deals, companies, contacts)
    const deleteHubspotDataFn = new nodejs.NodejsFunction(
      this,
      "DeleteHubspotData",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/hubspot/delete-hubspot-data.ts",
        handler: "handler",
        timeout: cdk.Duration.minutes(5),
        environment: {
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
          CONTACTS_TABLE_NAME: props.contactsTable.tableName,
        },
      },
    );
    props.dealsTable.grantReadWriteData(deleteHubspotDataFn);
    props.companiesTable.grantReadWriteData(deleteHubspotDataFn);
    props.contactsTable.grantReadWriteData(deleteHubspotDataFn);

    const hubspot =
      props.api.root.getResource("hubspot") ??
      props.api.root.addResource("hubspot");
    const deals = hubspot.addResource("deals-list");
    const revops = hubspot.addResource("revops-dashboard");
    const deleteData = hubspot.addResource("delete-data");

    deals.addMethod(
      "GET",
      new apigw.LambdaIntegration(listDeals),
      props.auth.getMethodOptions()
    );

    deals
      .addResource("{id}")
      .addMethod(
        "GET",
        new apigw.LambdaIntegration(getDeal),
        props.auth.getMethodOptions()
      );

    revops.addMethod(
      "GET",
      new apigw.LambdaIntegration(getRevOpsDashboardData),
      props.auth.getMethodOptions()
    );

    // DELETE /hubspot/delete-data
    deleteData.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(deleteHubspotDataFn),
      props.auth.getMethodOptions()
    );

    this.openApiSpec = {
      tags: [
        {
          name: "HubSpot Deals Listing",
          description:
            "Operations related to HubSpot deals to get and list deals",
        },
        {
          name: "HubSpot RevOps",
          description: "RevOps dashboard APIs",
        },
      ],
      paths: {
        "/hubspot/deals-list": {
          get: {
            summary: "List Deals",
            tags: ["HubSpot Deals Listing"],
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
        "/hubspot/deals-list/{id}": {
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
        "/hubspot/revops-dashboard": {
          get: {
            summary: "Get RevOps Dashboard Data",
            tags: ["HubSpot RevOps"],
            responses: {
              "200": {
                description: "RevOps dashboard response",
                content: {
                  "application/json": {},
                },
              },
            },
          },
        },
        "/hubspot/delete-data": {
          delete: {
            summary: "Delete all HubSpot data",
            description:
              "Deletes all records from deals, companies, and contacts tables. Requires ADMIN role.",
            tags: ["HubSpot Data Management"],
            responses: {
              "200": {
                description: "Data deleted successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        message: { type: "string" },
                        totalDeleted: { type: "number" },
                        results: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              table: { type: "string" },
                              deletedCount: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              "403": { description: "Forbidden - requires ADMIN role" },
              "500": { description: "Internal server error" },
            },
          },
        },
      },
      components: { schemas: { Deal: DealSchema, DealPage: DealPageSchema } },
    };
  }
}
