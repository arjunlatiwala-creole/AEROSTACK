import * as cdk from "aws-cdk-lib";
import { Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import { getConfig } from "../config";
import { DynamoTable } from "../constructs/database/dynamodb";

export class TablesStack extends Stack {
	public readonly personTable: DynamoTable;
	public readonly personInformationTable: DynamoTable;
	public readonly integrationsRawTable: DynamoTable;
	public readonly bfpmSessionsTable: DynamoTable;
	public readonly bfpmDataTable: DynamoTable;
	public readonly loopsTable: DynamoTable;
	public readonly loopFinancialsTable: DynamoTable;
	public readonly dealsTable: DynamoTable;
	public readonly companiesTable: DynamoTable;
	public readonly contactsTable: DynamoTable;
	public readonly integrationsTable: DynamoTable;
	public readonly integrationSyncDetailsTable: DynamoTable;
	public readonly integrationSyncHistoryTable: DynamoTable;
	public readonly deelPeopleTable: DynamoTable;
	public readonly linearDeliveryTable: DynamoTable;
	public readonly partnerOpportunitiesTable: DynamoTable;
	public readonly partnerEngagementsTable: DynamoTable;
	public readonly partnerEngagementInvitationsTable: DynamoTable;
	public readonly unifiedOpportunitiesTable: DynamoTable;
	public readonly hiringCandidatesTable: DynamoTable;
	public readonly hiringNotesTable: DynamoTable;
	public readonly hiringJobRecsTable: DynamoTable;
	public readonly hiringCompPlansTable: DynamoTable;
	public readonly documentsTable: DynamoTable;
	public readonly documentVersionsTable: DynamoTable;
	public readonly documentAccessTable: DynamoTable;
	public readonly csTicketsTable: DynamoTable;
	public readonly csCoreTable: DynamoTable;
	public readonly revopsMboTable: DynamoTable;
	public readonly revopsCadenceTable: DynamoTable;

	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		const cfg = getConfig();
		const env = this.node.tryGetContext("env") || "dev";

		this.personTable = new DynamoTable(this, "PersonTable", {
			tableName: `${cfg.prefix}-${cfg.tables.person}`,
			partitionKey: { name: "personId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.personInformationTable = new DynamoTable(
			this,
			"PersonInformationTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.personInformation}`,
				partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_StartDate",
						partitionKey: {
							name: "start_date",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_Email",
						partitionKey: {
							name: "email",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_Name",
						partitionKey: {
							name: "name",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.integrationsRawTable = new DynamoTable(this, "IntegrationsRawTable", {
			tableName: `${cfg.prefix}-${cfg.tables.integrationsRaw}`,
			partitionKey: {
				name: "sourceEntityExternalId",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: { name: "ingestedAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.bfpmDataTable = new DynamoTable(this, "BfpmDataTable", {
			tableName: `${cfg.prefix}-${cfg.tables.bfpm}`,
			partitionKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "dataType", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.bfpmSessionsTable = new DynamoTable(this, "BfpmSessionsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.bfpmSession}`,
			partitionKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.loopsTable = new DynamoTable(this, "LoopsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.loops}`,
			partitionKey: { name: "loop_id", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Category",
					partitionKey: {
						name: "category",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "target_completion_date",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Owner",
					partitionKey: {
						name: "owner_email",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "updated_at", type: dynamodb.AttributeType.STRING },
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Status",
					partitionKey: {
						name: "entity_type",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_CategoryStatus",
					partitionKey: {
						name: "category_status",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "priority", type: dynamodb.AttributeType.NUMBER },
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Priority",
					partitionKey: {
						name: "entity_type",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "priority", type: dynamodb.AttributeType.NUMBER },
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_CreatedAt",
					partitionKey: {
						name: "entity_type",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		this.loopFinancialsTable = new DynamoTable(this, "LoopFinancialsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.loopFinancials || "loop-financials"
				}`,
			partitionKey: {
				name: "financial_id",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },

			globalSecondaryIndexes: [
				{
					indexName: "GSI_LoopId",
					partitionKey: {
						name: "loop_id",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_FiscalPeriod",
					partitionKey: {
						name: "fiscal_period",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: { name: "cost_center", type: dynamodb.AttributeType.STRING },
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		this.dealsTable = new DynamoTable(this, "DealsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.deals}`,
			partitionKey: { name: "dealId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.contactsTable = new DynamoTable(this, "ContactsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.contacts}`,
			partitionKey: { name: "contactId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.companiesTable = new DynamoTable(this, "CompaniesTable", {
			tableName: `${cfg.prefix}-${cfg.tables.companies}`,
			partitionKey: { name: "companyId", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.integrationsTable = new DynamoTable(this, "IntegrationsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.integrations}`,
			partitionKey: {
				name: "integration_id",
				type: dynamodb.AttributeType.STRING,
			},
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI1",
					partitionKey: {
						name: "GSI1PK",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "GSI1SK",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		this.integrationSyncHistoryTable = new DynamoTable(
			this,
			"IntegrationSyncHistoryTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.integrationSyncHistory}`,
				partitionKey: {
					name: "PK",
					type: dynamodb.AttributeType.STRING,
				},
				sortKey: {
					name: "SK",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: {
							name: "GSI1PK",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "GSI1SK",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI2",
						partitionKey: {
							name: "GSI2PK",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "GSI2SK",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.integrationSyncDetailsTable = new DynamoTable(
			this,
			"IntegrationSyncDetailsTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.integrationSyncDetails}`,
				partitionKey: {
					name: "PK",
					type: dynamodb.AttributeType.STRING,
				},
				sortKey: {
					name: "SK",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI1",
						partitionKey: {
							name: "GSI1PK",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "GSI1SK",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.deelPeopleTable = new DynamoTable(this, "DeelPeopleTable", {
			tableName: `${cfg.prefix}-${cfg.tables.deelPeople}`,
			partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Active",
					partitionKey: {
						name: "active",
						type: dynamodb.AttributeType.NUMBER, // 0 = inactive, 1 = active
					},
					sortKey: {
						name: "created_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Email",
					partitionKey: {
						name: "email",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		// Linear Delivery Table
		this.linearDeliveryTable = new DynamoTable(this, "LinearDeliveryTable", {
			tableName: `${cfg.prefix}-${cfg.tables.linearDelivery}`,
			partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_State",
					partitionKey: {
						name: "state",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_LeadEmail",
					partitionKey: {
						name: "lead_email",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		// Partner Central Tables (matching local-tables.ts exactly)
		this.partnerOpportunitiesTable = new DynamoTable(
			this,
			"PartnerOpportunitiesTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.partnerOpportunities}`,
				partitionKey: {
					name: "opportunityId",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_StageModified",
						partitionKey: {
							name: "lifeCycleStage",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "lastModifiedDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_Customer",
						partitionKey: {
							name: "customerId",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "lastModifiedDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_StageCreated",
						partitionKey: {
							name: "lifeCycleStage",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "createdDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.partnerEngagementsTable = new DynamoTable(
			this,
			"PartnerEngagementsTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.partnerEngagements}`,
				partitionKey: {
					name: "engagementId",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_StatusCreated",
						partitionKey: {
							name: "status",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "createdDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.partnerEngagementInvitationsTable = new DynamoTable(
			this,
			"PartnerEngagementInvitationsTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.partnerEngagementInvitations}`,
				partitionKey: {
					name: "invitationId",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_StatusCreated",
						partitionKey: {
							name: "invitationStatus",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "createdDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_ParticipantType",
						partitionKey: {
							name: "participantType",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "createdDate",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		// Unified Opportunities Table (denormalized from HubSpot + APN-ACE)
		this.unifiedOpportunitiesTable = new DynamoTable(
			this,
			"UnifiedOpportunitiesTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.unifiedOpportunities}`,
				partitionKey: {
					name: "opportunityId",
					type: dynamodb.AttributeType.STRING,
				},
				sortKey: {
					name: "source",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_Source",
						partitionKey: {
							name: "source",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "updatedAt",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		// ── Hiring Pipeline Tables ──

		this.hiringCandidatesTable = new DynamoTable(
			this,
			"HiringCandidatesTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.hiringCandidates}`,
				partitionKey: {
					name: "candidateId",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_Stage",
						partitionKey: {
							name: "stage",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "updatedAt",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_Email",
						partitionKey: {
							name: "email",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
					{
						indexName: "GSI_JobRec",
						partitionKey: {
							name: "jobRecId",
							type: dynamodb.AttributeType.STRING,
						},
						sortKey: {
							name: "stage",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		this.hiringNotesTable = new DynamoTable(this, "HiringNotesTable", {
			tableName: `${cfg.prefix}-${cfg.tables.hiringNotes}`,
			partitionKey: {
				name: "candidateId",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: { name: "noteId", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
		});

		this.hiringJobRecsTable = new DynamoTable(this, "HiringJobRecsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.hiringJobRecs}`,
			partitionKey: {
				name: "jobRecId",
				type: dynamodb.AttributeType.STRING,
			},
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Status",
					partitionKey: {
						name: "status",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "createdAt",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		this.hiringCompPlansTable = new DynamoTable(
			this,
			"HiringCompPlansTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.hiringCompPlans}`,
				partitionKey: {
					name: "compPlanId",
					type: dynamodb.AttributeType.STRING,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
				globalSecondaryIndexes: [
					{
						indexName: "GSI_Candidate",
						partitionKey: {
							name: "candidateId",
							type: dynamodb.AttributeType.STRING,
						},
						projectionType: dynamodb.ProjectionType.ALL,
					},
				],
			},
		);

		// ── Document Host Tables ──

		this.documentsTable = new DynamoTable(this, "DocumentsTable", {
			tableName: `${cfg.prefix}-${cfg.tables.documents}`,
			partitionKey: {
				name: "document_id",
				type: dynamodb.AttributeType.STRING,
			},
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Slug",
					partitionKey: {
						name: "slug",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Source",
					partitionKey: {
						name: "source_provider",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "source_id",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_OrgId",
					partitionKey: {
						name: "org_id",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		this.documentVersionsTable = new DynamoTable(
			this,
			"DocumentVersionsTable",
			{
				tableName: `${cfg.prefix}-${cfg.tables.documentVersions}`,
				partitionKey: {
					name: "document_id",
					type: dynamodb.AttributeType.STRING,
				},
				sortKey: {
					name: "version_number",
					type: dynamodb.AttributeType.NUMBER,
				},
				removalPolicy: cdk.RemovalPolicy.DESTROY,
				tags: { Project: cfg.prefix, Environment: env },
			},
		);

		this.documentAccessTable = new DynamoTable(this, "DocumentAccessTable", {
			tableName: `${cfg.prefix}-${cfg.tables.documentAccess}`,
			partitionKey: {
				name: "document_id",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: {
				name: "access_id",
				type: dynamodb.AttributeType.STRING,
			},
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Grantee",
					partitionKey: {
						name: "grantee_id",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "document_id",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		// ── Customer Success Tables (CS-1: support ticketing) ──
		// Customer relationship data → RETAIN (never destroy on stack update).
		this.csTicketsTable = new DynamoTable(this, "CsTicketsTable", {
			tableName: `${cfg.prefix}-cs-tickets`,
			partitionKey: { name: "tenant_id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Status",
					partitionKey: {
						name: "status",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
				{
					indexName: "GSI_Assignee",
					partitionKey: {
						name: "assignee_email",
						type: dynamodb.AttributeType.STRING,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});

		// ── Customer Success core table (accounts/renewals/csat/escalations/plans) ──
		this.csCoreTable = new DynamoTable(this, "CsCoreTable", {
			tableName: `${cfg.prefix}-cs-core`,
			partitionKey: { name: "tenant_id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			tags: { Project: cfg.prefix, Environment: env },
		});

		// ── RevOps Productivity Tables ──
		// MBO outcome targets (no quotas) — additive, RETAIN.
		this.revopsMboTable = new DynamoTable(this, "RevopsMboTable", {
			tableName: `${cfg.prefix}-revops-mbo`,
			partitionKey: { name: "tenant_id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			tags: { Project: cfg.prefix, Environment: env },
		});

		// Cadence-state overlay on loops (separate field; NOT a LoopStatusEnum change).
		this.revopsCadenceTable = new DynamoTable(this, "RevopsCadenceTable", {
			tableName: `${cfg.prefix}-revops-cadence`,
			partitionKey: { name: "tenant_id", type: dynamodb.AttributeType.STRING },
			sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			tags: { Project: cfg.prefix, Environment: env },
			globalSecondaryIndexes: [
				{
					indexName: "GSI_Block",
					partitionKey: {
						name: "block",
						type: dynamodb.AttributeType.NUMBER,
					},
					sortKey: {
						name: "updated_at",
						type: dynamodb.AttributeType.STRING,
					},
					projectionType: dynamodb.ProjectionType.ALL,
				},
			],
		});
	}
}
