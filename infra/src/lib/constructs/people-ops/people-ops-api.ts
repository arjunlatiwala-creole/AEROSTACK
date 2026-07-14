import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";

export interface PeopleOpsDashboardApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  deelPeopleTable: dynamodb.ITable;
  personInformationTable: dynamodb.ITable;
  loopsTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  linearDeliveryTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class PeopleOpsDashboardApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: PeopleOpsDashboardApiProps) {
    super(scope, id);

    /* -------- Lambda -------- */

    const getDashboard = new nodejs.NodejsFunction(
      this,
      "GetPeopleOpsDashboard",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/people-ops/get-people-ops-dashboard.ts",
        handler: "handler",
        environment: {
          DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
        },
      },
    );

    const getPersonByEmail = new nodejs.NodejsFunction(
      this,
      "GetPersonByEmail",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/people-ops/get-person-by-email.ts",
        handler: "handler",
        environment: {
          DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
          PERSON_INFORMATION_TABLE_NAME: props.personInformationTable.tableName,
          LOOPS_TABLE_NAME: props.loopsTable.tableName,
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
          CONTACTS_TABLE_NAME: props.contactsTable.tableName,
          LINEAR_DELIVERY_TABLE_NAME: props.linearDeliveryTable.tableName,
        },
      },
    );

    const upsertPersonInformation = new nodejs.NodejsFunction(
      this,
      "UpsertPersonInformation",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/people-ops/upsert-person-information.ts",
        handler: "handler",
        environment: {
          PERSON_INFORMATION_TABLE_NAME: props.personInformationTable.tableName,
        },
      },
    );

    props.deelPeopleTable.grantReadData(getDashboard);

    props.deelPeopleTable.grantReadData(getPersonByEmail);
    props.personInformationTable.grantReadData(getPersonByEmail);
    props.loopsTable.grantReadData(getPersonByEmail);
    props.personInformationTable.grantReadWriteData(upsertPersonInformation);
    props.dealsTable.grantReadData(getPersonByEmail);
    props.companiesTable.grantReadData(getPersonByEmail);
    props.contactsTable.grantReadData(getPersonByEmail);
    props.linearDeliveryTable.grantReadData(getPersonByEmail);

    /* -------- API -------- */

    const peopleOps = props.api.root.addResource("people-ops");
    const dashboard = peopleOps.addResource("dashboard");
    const person = peopleOps.addResource("person");
    const personInformation = peopleOps.addResource("person-information");

    dashboard.addMethod(
      "GET",
      new apigw.LambdaIntegration(getDashboard),
      props.auth.getMethodOptions(),
    );

    person.addMethod(
      "GET",
      new apigw.LambdaIntegration(getPersonByEmail),
      props.auth.getMethodOptions(),
    );

    personInformation.addMethod(
      "PUT",
      new apigw.LambdaIntegration(upsertPersonInformation),
      props.auth.getMethodOptions(),
    );

    /* -------- OpenAPI -------- */

    this.openApiSpec = {
      tags: [
        {
          name: "People Ops",
          description: "People operations dashboard APIs",
        },
      ],
      paths: {
        "/people-ops/dashboard": {
          get: {
            summary: "People Ops Dashboard",
            tags: ["People Ops"],
            responses: {
              "200": {
                description: "People ops dashboard data",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        total_employees: { type: "number" },
                        by_status: {
                          type: "object",
                          additionalProperties: { type: "number" },
                        },
                        by_department: {
                          type: "object",
                          additionalProperties: { type: "number" },
                        },
                        by_type: {
                          type: "object",
                          additionalProperties: { type: "number" },
                        },
                        by_location: {
                          type: "object",
                          additionalProperties: { type: "number" },
                        },
                        recent_hires: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: true,
                          },
                        },
                        org_chart: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/people-ops/person": {
          get: {
            summary: "Get Person by Email",
            description: "Retrieve person details by email address",
            tags: ["People Ops"],
            parameters: [
              {
                name: "email",
                in: "query",
                required: false,
                schema: {
                  type: "string",
                  format: "email",
                },
                description:
                  "Email address of the person (defaults to authenticated user)",
              },
            ],
            responses: {
              "200": {
                description: "Person details",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        person_id: { type: "string" },
                        name: { type: "string" },
                        given_name: { type: "string" },
                        family_name: { type: "string" },
                        email: { type: "string" },
                        job_title: { type: "string" },
                        department: { type: "object" },
                        title: { type: "string" },
                        direct_reports: {
                          type: "array",
                          items: { type: "string" },
                        },
                        level: { type: "number" },
                        employment_status: { type: "string" },
                        addresses: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              country: { type: "string" },
                              streetAddress: { type: "string" },
                              postalCode: { type: "string" },
                              locality: { type: "string" },
                              region: { type: "string" },
                              type: { type: "string" },
                            },
                          },
                        },
                        start_date: { type: "string" },
                      },
                    },
                  },
                },
              },
              "400": { description: "Bad request - email parameter missing" },
              "404": { description: "Person not found" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/people-ops/person-information": {
          put: {
            summary: "Upsert Person Information",
            description:
              "Create or update personal, employment, and address information for the authenticated user",
            tags: ["People Ops"],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      given_name: { type: "string" },
                      family_name: { type: "string" },
                      alternate_email: { type: "string" },
                      employment_status: { type: "string" },
                      job_title: { type: "string" },
                      title: { type: "string" },
                      level: { type: "number" },
                      start_date: { type: "string" },
                      direct_reports: {
                        type: "array",
                        items: { type: "string" },
                      },
                      addresses: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Person information upserted",
              },
              "400": { description: "Bad request" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },
      },
    };
  }
}
