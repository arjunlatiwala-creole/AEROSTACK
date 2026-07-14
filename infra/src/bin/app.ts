#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { type Env, getConfig } from "../lib/config";
import { ApiStack } from "../lib/stacks/api-stack";
import { FrontendStack } from "../lib/stacks/frontend-stack";
import { IngestionStack } from "../lib/stacks/ingestion-stack";
import { TablesStack } from "../lib/stacks/table-stack";
import { ApiAerostackStack } from "../lib/stacks/api-aerostack-stack";
import { HiringApiStack } from "../lib/stacks/hiring-api-stack";
import { ModulesApiStack } from "../lib/stacks/modules-api-stack";

const app = new cdk.App();

const stage = (process.env.NODE_ENV as Env) || "dev";
const sfx = stage === "dev" ? "" : "-" + stage;
const config = getConfig(stage);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// Add tags to all resources
const tags = {
  Project: "enterprise-aerostack",
  Environment: process.env.NODE_ENV || "development",
  ManagedBy: "CDK",
};

// Apply tags to all resources in the app
Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

/**
 * Data layer (DynamoDB)
 */
const tablesStack = new TablesStack(app, `Aerostack-TablesStack${sfx}`, {
  env,
  stackName: `Aerostack-TablesStack${sfx}`,
});

/**
 * API + Auth layer
 */
const apiStack = new ApiStack(app, `Aerostack-ApiStack${sfx}`, {
  env,
  // Core tables
  personTable: tablesStack.personTable.table,
  personInformationTable: tablesStack.personInformationTable.table,
  bfpmSessionsTable: tablesStack.bfpmSessionsTable.table,
  bfpmDataTable: tablesStack.bfpmDataTable.table,
  loopsTable: tablesStack.loopsTable.table,
  loopFinancialsTable: tablesStack.loopFinancialsTable.table,

  // Integrations
  integrationsRawTable: tablesStack.integrationsRawTable.table,
  integrationsTable: tablesStack.integrationsTable.table,
  integrationSyncDetailsTable: tablesStack.integrationSyncDetailsTable.table,
  integrationSyncHistoryTable: tablesStack.integrationSyncHistoryTable.table,

  // HubSpot
  dealsTable: tablesStack.dealsTable.table,
  companiesTable: tablesStack.companiesTable.table,
  contactsTable: tablesStack.contactsTable.table,

  // Deel
  deelPeopleTable: tablesStack.deelPeopleTable.table,

  // Linear
  linearDeliveryTable: tablesStack.linearDeliveryTable.table,

  // Partner Central tables
  partnerOpportunitiesTable: tablesStack.partnerOpportunitiesTable.table,

  partnerEngagementsTable: tablesStack.partnerEngagementsTable.table,

  partnerEngagementInvitationsTable:
    tablesStack.partnerEngagementInvitationsTable.table,

  stackName: `Aerostack-ApiStack${sfx}`,
});

/**
 * Ingestion & Processing pipeline (EventBridge-driven)
 */
const ingestionStack = new IngestionStack(app, `Aerostack-IngestionStack${sfx}`, {
  env,

  // HubSpot
  integrationsRawTable: tablesStack.integrationsRawTable.table,
  dealsTable: tablesStack.dealsTable.table,
  companiesTable: tablesStack.companiesTable.table,
  contactsTable: tablesStack.contactsTable.table,

  // Integrations
  integrationsTable: tablesStack.integrationsTable.table,
  integrationSyncDetailsTable: tablesStack.integrationSyncDetailsTable.table,
  integrationSyncHistoryTable: tablesStack.integrationSyncHistoryTable.table,

  // Deel
  deelPeopleTable: tablesStack.deelPeopleTable.table,

  // Linear
  linearDeliveryTable: tablesStack.linearDeliveryTable.table,

  // Partner Central
  partnerOpportunitiesTable: tablesStack.partnerOpportunitiesTable.table,
  partnerEngagementsTable: tablesStack.partnerEngagementsTable.table,
  partnerEngagementInvitationsTable:
    tablesStack.partnerEngagementInvitationsTable.table,

  stackName: `Aerostack-IngestionStack${sfx}`,
});

/**
 * Frontend Deployment (Amplify)
 */
const frontendStack = new FrontendStack(app, `Aerostack-FrontendStack${sfx}`, {
  env,
  stackName: `Aerostack-FrontendStack${sfx}`,
});

/**
 * Api stack
 */
const apiAerostackStack = new ApiAerostackStack(app, `Aerostack-ApiAerostackStack${sfx}`, {
  env,
  // Share ApiStack's User Pool — prevents duplicate pool name + CFn export collisions
  userPool: apiStack.auth.userPool,
  // Core tables
  personTable: tablesStack.personTable.table,
  loopsTable: tablesStack.loopsTable.table,
  loopFinancialsTable: tablesStack.loopFinancialsTable.table,

  integrationSyncHistoryTable: tablesStack.integrationSyncHistoryTable.table,

  // HubSpot
  dealsTable: tablesStack.dealsTable.table,
  companiesTable: tablesStack.companiesTable.table,
  contactsTable: tablesStack.contactsTable.table,

  // Deel
  deelPeopleTable: tablesStack.deelPeopleTable.table,

  // Linear
  linearDeliveryTable: tablesStack.linearDeliveryTable.table,

  // Document Host
  documentsTable: tablesStack.documentsTable.table,
  documentVersionsTable: tablesStack.documentVersionsTable.table,
  documentAccessTable: tablesStack.documentAccessTable.table,

  stackName: `Aerostack-ApiAerostackStack${sfx}`,
});

/**
 * Hiring Pipeline API (separate stack — ApiStack at resource limit)
 */
const hiringApiStack = new HiringApiStack(app, `Aerostack-HiringApiStack${sfx}`, {
  env,
  userPool: apiStack.auth.userPool,
  personTable: tablesStack.personTable.table,
  hiringCandidatesTable: tablesStack.hiringCandidatesTable.table,
  hiringNotesTable: tablesStack.hiringNotesTable.table,
  hiringJobRecsTable: tablesStack.hiringJobRecsTable.table,
  hiringCompPlansTable: tablesStack.hiringCompPlansTable.table,
  stackName: `Aerostack-HiringApiStack${sfx}`,
});

/**
 * RevOps Productivity + Customer Success module APIs (separate stack — keeps
 * ApiStack under the 500-resource limit; shares the Aerostack Cognito pool).
 */
const modulesApiStack = new ModulesApiStack(app, `Aerostack-ModulesApiStack${sfx}`, {
  env,
  userPool: apiStack.auth.userPool,
  personTable: tablesStack.personTable.table,
  dealsTable: tablesStack.dealsTable.table,
  companiesTable: tablesStack.companiesTable.table,
  loopsTable: tablesStack.loopsTable.table,
  revopsMboTable: tablesStack.revopsMboTable.table,
  revopsCadenceTable: tablesStack.revopsCadenceTable.table,
  csTicketsTable: tablesStack.csTicketsTable.table,
  csCoreTable: tablesStack.csCoreTable.table,
  stackName: `Aerostack-ModulesApiStack${sfx}`,
});

// Set dependencies
apiStack.addDependency(tablesStack);
ingestionStack.addDependency(tablesStack);
frontendStack.addDependency(apiStack);
apiAerostackStack.addDependency(apiStack);
hiringApiStack.addDependency(apiStack);
modulesApiStack.addDependency(apiStack);
modulesApiStack.addDependency(tablesStack);

app.synth();
