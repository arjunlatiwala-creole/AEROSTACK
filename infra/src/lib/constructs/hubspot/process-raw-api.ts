import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { CognitoAuth } from "../auth/cognito-auth";

export interface HubspotProcessingApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  integrationsRawTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class HubspotProcessingApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: HubspotProcessingApiProps) {
    super(scope, id);

    // Process raw HubSpot data lambda
    const processLambda = new nodejs.NodejsFunction(
      this,
      "ProcessHubspotRawData",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/hubspot/process-raw.ts",
        handler: "handler",
        timeout: cdk.Duration.minutes(15),
        environment: {
          ...props.lambdaDefaults.environment,
          INTEGRATIONS_RAW_TABLE_NAME: props.integrationsRawTable.tableName,
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
          CONTACTS_TABLE_NAME: props.contactsTable.tableName,
        },
      }
    );

    // Permissions
    props.integrationsRawTable.grantReadData(processLambda);
    props.dealsTable.grantWriteData(processLambda);
    props.companiesTable.grantWriteData(processLambda);
    props.contactsTable.grantWriteData(processLambda);

    // API Gateway setup
    const hubspot =
      props.api.root.getResource("hubspot") ??
      props.api.root.addResource("hubspot");

    const process = hubspot.addResource("process");

    process.addMethod(
      "POST",
      new apigw.LambdaIntegration(processLambda),
      props.auth.getMethodOptions()
    );

    // OpenAPI spec
    this.openApiSpec = {
      tags: [
        {
          name: "HubSpot Processing",
          description: "Process raw HubSpot data into domain tables",
        },
      ],
      paths: {
        "/hubspot/process": {
          post: {
            summary: "Process HubSpot raw data",
            description:
              "Reads records from IntegrationsRawTable and stores them into Deals and Companies and Contacts tables",
            tags: ["HubSpot Processing"],
            responses: {
              "200": {
                description: "Processing completed successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        processed: {
                          type: "object",
                          properties: {
                            deals: { type: "number" },
                            companies: { type: "number" },
                            contacts: { type: "number" },
                          },
                        },
                      },
                    },
                  },
                },
              },
              "500": {
                description: "Internal server error",
              },
            },
          },
        },
      },
      components: {
        schemas: {},
      },
    };
  }
}
