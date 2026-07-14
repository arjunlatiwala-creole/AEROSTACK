import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/** Minimal auth interface required by this construct. */
export interface IApiAuth {
  getMethodOptions(): apigw.MethodOptions;
}

export interface EnterpriseAerostackDashboardApiProps {
  api: apigw.RestApi;
  auth: IApiAuth;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
  loopsTable: dynamodb.ITable;
  loopFinancialsTable: dynamodb.ITable;
  dealsTable: dynamodb.ITable;
  deelPeopleTable: dynamodb.ITable;
  linearDeliveryTable: dynamodb.ITable;
  integrationSyncHistoryTable?: dynamodb.ITable;
  companiesTable: dynamodb.ITable;
  contactsTable: dynamodb.ITable;
  // ✅ ADD THIS — required for role resolution
  personTable: dynamodb.ITable;
}

export class EnterpriseAerostackDashboardApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: EnterpriseAerostackDashboardApiProps) {
    super(scope, id);

    const getDashboard = new nodejs.NodejsFunction(
      this,
      "GetEnterpriseAerostackSuperAdminDashboard",
      {
        ...props.lambdaDefaults,
        entry: "src/functions/enterpriseAerostack/get-super-admin-dashboard.ts",
        handler: "handler",
        environment: {
          LOOPS_TABLE_NAME: props.loopsTable.tableName,
          LOOP_FINANCIALS_TABLE_NAME: props.loopFinancialsTable.tableName,
          DEALS_TABLE_NAME: props.dealsTable.tableName,
          DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
          LINEAR_DELIVERY_TABLE_NAME: props.linearDeliveryTable.tableName,
          COMPANIES_TABLE_NAME: props.companiesTable.tableName,
          CONTACTS_TABLE_NAME: props.contactsTable.tableName,
          // ✅ ADD THIS — without it, getGivenRoleFromPersonTable returns "USER" for everyone
          PERSON_TABLE_NAME: props.personTable.tableName,
          ...(props.integrationSyncHistoryTable
            ? {
                INTEGRATION_SYNC_HISTORY_TABLE_NAME:
                  props.integrationSyncHistoryTable.tableName,
              }
            : {}),
        },
      },
    );

    props.loopsTable.grantReadData(getDashboard);
    props.loopFinancialsTable.grantReadData(getDashboard);
    props.dealsTable.grantReadData(getDashboard);
    props.deelPeopleTable.grantReadData(getDashboard);
    props.linearDeliveryTable.grantReadData(getDashboard);
    props.integrationSyncHistoryTable?.grantReadData(getDashboard);
    props.companiesTable.grantReadData(getDashboard);
    props.contactsTable.grantReadData(getDashboard);
    // ✅ ADD THIS — grant the Lambda read access to the Person table
    props.personTable.grantReadData(getDashboard);

    const enterpriseAerostack = props.api.root.addResource("enterprise-aerostack");
    const dashboard = enterpriseAerostack.addResource("dashboard");

    dashboard.addMethod("GET", new apigw.LambdaIntegration(getDashboard), {
      ...props.auth.getMethodOptions(),
      requestParameters: {
        "method.request.querystring.period": false,
        "method.request.querystring.scope": false, // ✅ also expose scope param
      },
    });

    this.openApiSpec = {
      // ... (unchanged from original)
    };
  }
}
