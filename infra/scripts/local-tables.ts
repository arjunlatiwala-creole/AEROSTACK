/**
 * Local DynamoDB Table Definitions
 * Single source of truth for local development tables.
 * Add new tables here - they'll be auto-created by init-local-db.ts
 */

import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";

type TableDefinition = Omit<CreateTableCommandInput, "BillingMode"> & {
	TableName: string;
};

export const LOCAL_TABLES: TableDefinition[] = [
	// Person Table
	{
		TableName: "local-person",
		KeySchema: [
			{ AttributeName: "personId", KeyType: "HASH" },
			{ AttributeName: "createdAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "personId", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
	},
	// Person Information Table
	{
		TableName: "local-person-information",
		KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "email", AttributeType: "S" },
			{ AttributeName: "start_date", AttributeType: "S" },
			{ AttributeName: "name", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_StartDate",
				KeySchema: [{ AttributeName: "start_date", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Email",
				KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Name",
				KeySchema: [{ AttributeName: "name", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Integrations Raw Table
	{
		TableName: "local-integrations-raw",
		KeySchema: [
			{ AttributeName: "sourceEntityExternalId", KeyType: "HASH" },
			{ AttributeName: "ingestedAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "sourceEntityExternalId", AttributeType: "S" },
			{ AttributeName: "ingestedAt", AttributeType: "S" },
		],
	},

	// BFPM Sessions Table
	{
		TableName: "local-bfpm-sessions",
		KeySchema: [
			{ AttributeName: "sessionId", KeyType: "HASH" },
			{ AttributeName: "createdAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "sessionId", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
	},

	// BFPM Data Table
	{
		TableName: "local-bfpm-data",
		KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }],
		AttributeDefinitions: [{ AttributeName: "sessionId", AttributeType: "S" }],
	},

	// Loops Table (with GSIs)
	{
		TableName: "local-loops",
		KeySchema: [{ AttributeName: "loop_id", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "loop_id", AttributeType: "S" },
			{ AttributeName: "entity_type", AttributeType: "S" },
			{ AttributeName: "category", AttributeType: "S" },
			{ AttributeName: "owner_email", AttributeType: "S" },
			{ AttributeName: "status", AttributeType: "S" },
			{ AttributeName: "priority", AttributeType: "N" },
			{ AttributeName: "target_completion_date", AttributeType: "S" },
			{ AttributeName: "created_at", AttributeType: "S" },
			{ AttributeName: "updated_at", AttributeType: "S" },
			{ AttributeName: "category_status", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			// Essential GSIs
			{
				IndexName: "GSI_Category",
				KeySchema: [
					{ AttributeName: "category", KeyType: "HASH" },
					{ AttributeName: "target_completion_date", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Owner",
				KeySchema: [
					{ AttributeName: "owner_email", KeyType: "HASH" },
					{ AttributeName: "updated_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Status",
				KeySchema: [
					{ AttributeName: "entity_type", KeyType: "HASH" },
					{ AttributeName: "status", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},

			// Composite for multi-filter
			{
				IndexName: "GSI_CategoryStatus",
				KeySchema: [
					{ AttributeName: "category_status", KeyType: "HASH" }, // "ENG#IN_PROGRESS"
					{ AttributeName: "priority", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},

			// Useful for sorting
			{
				IndexName: "GSI_Priority",
				KeySchema: [
					{ AttributeName: "entity_type", KeyType: "HASH" },
					{ AttributeName: "priority", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_CreatedAt",
				KeySchema: [
					{ AttributeName: "entity_type", KeyType: "HASH" },
					{ AttributeName: "created_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Loop Financials Table (with GSIs)
	{
		TableName: "local-loop-financials",
		KeySchema: [
			{ AttributeName: "financial_id", KeyType: "HASH" },
			{ AttributeName: "created_at", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "financial_id", AttributeType: "S" },
			{ AttributeName: "created_at", AttributeType: "S" },
			{ AttributeName: "loop_id", AttributeType: "S" },
			{ AttributeName: "fiscal_period", AttributeType: "S" },
			{ AttributeName: "cost_center", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_LoopId",
				KeySchema: [
					{ AttributeName: "loop_id", KeyType: "HASH" },
					{ AttributeName: "created_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_FiscalPeriod",
				KeySchema: [
					{ AttributeName: "fiscal_period", KeyType: "HASH" },
					{ AttributeName: "cost_center", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Deals Table
	{
		TableName: "local-deals",
		KeySchema: [
			{ AttributeName: "dealId", KeyType: "HASH" },
			{ AttributeName: "createdAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "dealId", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
	},

	// Companies Table
	{
		TableName: "local-companies",
		KeySchema: [
			{ AttributeName: "companyId", KeyType: "HASH" },
			{ AttributeName: "createdAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "companyId", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
	},

	// Contacts Table
	{
		TableName: "local-contacts",
		KeySchema: [
			{ AttributeName: "contactId", KeyType: "HASH" },
			{ AttributeName: "createdAt", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "contactId", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
	},

	/* Integrations Module Tables */

	// Integrations Table (Main configuration table)
	{
		TableName: "local-integrations",
		KeySchema: [{ AttributeName: "integration_id", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "integration_id", AttributeType: "S" },
			{ AttributeName: "GSI1PK", AttributeType: "S" },
			{ AttributeName: "GSI1SK", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI1",
				KeySchema: [
					{ AttributeName: "GSI1PK", KeyType: "HASH" }, // TYPE#<integration_type>
					{ AttributeName: "GSI1SK", KeyType: "RANGE" }, // STATUS#<status>#<timestamp>
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Integration Sync History Table (One record per sync operation)
	{
		TableName: "local-integration-sync-history",
		KeySchema: [
			{ AttributeName: "PK", KeyType: "HASH" }, // integration_id
			{ AttributeName: "SK", KeyType: "RANGE" }, // SYNC#<timestamp>#<sync_id>
		],
		AttributeDefinitions: [
			{ AttributeName: "PK", AttributeType: "S" },
			{ AttributeName: "SK", AttributeType: "S" },
			{ AttributeName: "GSI1PK", AttributeType: "S" },
			{ AttributeName: "GSI1SK", AttributeType: "S" },
			{ AttributeName: "GSI2PK", AttributeType: "S" },
			{ AttributeName: "GSI2SK", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI1",
				KeySchema: [
					{ AttributeName: "GSI1PK", KeyType: "HASH" }, // TYPE#<integration_type>
					{ AttributeName: "GSI1SK", KeyType: "RANGE" }, // SYNC#<timestamp>
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI2",
				KeySchema: [
					{ AttributeName: "GSI2PK", KeyType: "HASH" }, // STATUS#<status>
					{ AttributeName: "GSI2SK", KeyType: "RANGE" }, // SYNC#<timestamp>
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Integration Sync Details Table (Per-record sync details)
	{
		TableName: "local-integration-sync-details",
		KeySchema: [
			{ AttributeName: "PK", KeyType: "HASH" }, // sync_id
			{ AttributeName: "SK", KeyType: "RANGE" }, // ENTITY#<entity_type>#<entity_id>
		],
		AttributeDefinitions: [
			{ AttributeName: "PK", AttributeType: "S" },
			{ AttributeName: "SK", AttributeType: "S" },
			{ AttributeName: "GSI1PK", AttributeType: "S" },
			{ AttributeName: "GSI1SK", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI1",
				KeySchema: [
					{ AttributeName: "GSI1PK", KeyType: "HASH" }, // ERROR#<error_code>
					{ AttributeName: "GSI1SK", KeyType: "RANGE" }, // ENTITY#<entity_type>#<timestamp>
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Deel People Table
	{
		TableName: "local-deel-people",
		KeySchema: [
			{ AttributeName: "id", KeyType: "HASH" },
			{ AttributeName: "created_at", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "created_at", AttributeType: "S" },
			{ AttributeName: "active", AttributeType: "N" },
			{ AttributeName: "email", AttributeType: "S" }, // GSI_Email attribute definition added
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Active",
				KeySchema: [
					{ AttributeName: "active", KeyType: "HASH" },
					{ AttributeName: "created_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Email",
				KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	// Linear Delivery Table
	{
		TableName: "local-linear-delivery",
		KeySchema: [
			{ AttributeName: "id", KeyType: "HASH" },
			{ AttributeName: "created_at", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "created_at", AttributeType: "S" },
			{ AttributeName: "state", AttributeType: "S" },
			{ AttributeName: "updated_at", AttributeType: "S" },
			{ AttributeName: "lead_email", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_State",
				KeySchema: [
					{ AttributeName: "state", KeyType: "HASH" },
					{ AttributeName: "updated_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_LeadEmail",
				KeySchema: [
					{ AttributeName: "lead_email", KeyType: "HASH" },
					{ AttributeName: "updated_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Unified Opportunities Table
	{
		TableName: "local-unified-opportunities",
		KeySchema: [
			{ AttributeName: "opportunityId", KeyType: "HASH" },
			{ AttributeName: "source", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "opportunityId", AttributeType: "S" },
			{ AttributeName: "source", AttributeType: "S" },
			{ AttributeName: "updatedAt", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Source",
				KeySchema: [
					{ AttributeName: "source", KeyType: "HASH" },
					{ AttributeName: "updatedAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// 1. Partner Central Opportunities Table
	{
		TableName: "local-partner-opportunities",
		KeySchema: [
			{ AttributeName: "opportunityId", KeyType: "HASH" },
			// NO SORT KEY - opportunityId is unique
		],
		AttributeDefinitions: [
			{ AttributeName: "opportunityId", AttributeType: "S" },
			{ AttributeName: "lastModifiedDate", AttributeType: "S" }, // ISO 8601 format
			{ AttributeName: "lifeCycleStage", AttributeType: "S" },
			{ AttributeName: "customerId", AttributeType: "S" },
			{ AttributeName: "createdDate", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			// Query: Get opportunities by stage, sorted by last modified
			{
				IndexName: "GSI_StageModified",
				KeySchema: [
					{ AttributeName: "lifeCycleStage", KeyType: "HASH" },
					{ AttributeName: "lastModifiedDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			// Query: Get opportunities by customer, sorted by last modified
			{
				IndexName: "GSI_Customer",
				KeySchema: [
					{ AttributeName: "customerId", KeyType: "HASH" },
					{ AttributeName: "lastModifiedDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			// Query: Get opportunities by stage, sorted by creation date
			{
				IndexName: "GSI_StageCreated",
				KeySchema: [
					{ AttributeName: "lifeCycleStage", KeyType: "HASH" },
					{ AttributeName: "createdDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// 2. Partner Central Engagements Table
	{
		TableName: "local-partner-engagements",
		KeySchema: [
			{ AttributeName: "engagementId", KeyType: "HASH" },
			// NO SORT KEY - engagementId is unique
		],
		AttributeDefinitions: [
			{ AttributeName: "engagementId", AttributeType: "S" },
			{ AttributeName: "status", AttributeType: "S" },
			{ AttributeName: "createdDate", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			// Query: Get engagements by status, sorted by creation date
			{
				IndexName: "GSI_StatusCreated",
				KeySchema: [
					{ AttributeName: "status", KeyType: "HASH" },
					{ AttributeName: "createdDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// 3. Partner Central Engagement Invitations Table
	{
		TableName: "local-partner-engagement-invitations",
		KeySchema: [
			{ AttributeName: "invitationId", KeyType: "HASH" },
			// NO SORT KEY - invitationId is unique
		],
		AttributeDefinitions: [
			{ AttributeName: "invitationId", AttributeType: "S" },
			{ AttributeName: "invitationStatus", AttributeType: "S" },
			{ AttributeName: "createdDate", AttributeType: "S" },
			{ AttributeName: "participantType", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			// Query: Get invitations by status, sorted by creation date
			{
				IndexName: "GSI_StatusCreated",
				KeySchema: [
					{ AttributeName: "invitationStatus", KeyType: "HASH" },
					{ AttributeName: "createdDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			// Query: Get invitations by participant type, sorted by creation date
			{
				IndexName: "GSI_ParticipantType",
				KeySchema: [
					{ AttributeName: "participantType", KeyType: "HASH" },
					{ AttributeName: "createdDate", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	/* ── Hiring Pipeline Tables ── */

	// Hiring Candidates Table
	{
		TableName: "local-hiring-candidates",
		KeySchema: [{ AttributeName: "candidateId", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "candidateId", AttributeType: "S" },
			{ AttributeName: "stage", AttributeType: "S" },
			{ AttributeName: "updatedAt", AttributeType: "S" },
			{ AttributeName: "email", AttributeType: "S" },
			{ AttributeName: "jobRecId", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Stage",
				KeySchema: [
					{ AttributeName: "stage", KeyType: "HASH" },
					{ AttributeName: "updatedAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Email",
				KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_JobRec",
				KeySchema: [
					{ AttributeName: "jobRecId", KeyType: "HASH" },
					{ AttributeName: "stage", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Hiring Notes Table
	{
		TableName: "local-hiring-notes",
		KeySchema: [
			{ AttributeName: "candidateId", KeyType: "HASH" },
			{ AttributeName: "noteId", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "candidateId", AttributeType: "S" },
			{ AttributeName: "noteId", AttributeType: "S" },
		],
	},

	// Hiring Job Recs Table
	{
		TableName: "local-hiring-job-recs",
		KeySchema: [{ AttributeName: "jobRecId", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "jobRecId", AttributeType: "S" },
			{ AttributeName: "status", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Status",
				KeySchema: [
					{ AttributeName: "status", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	/* ── Document Host Tables ── */

	// Documents Table
	{
		TableName: "local-documents",
		KeySchema: [{ AttributeName: "document_id", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "document_id", AttributeType: "S" },
			{ AttributeName: "slug", AttributeType: "S" },
			{ AttributeName: "source_provider", AttributeType: "S" },
			{ AttributeName: "source_id", AttributeType: "S" },
			{ AttributeName: "org_id", AttributeType: "S" },
			{ AttributeName: "updated_at", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Slug",
				KeySchema: [{ AttributeName: "slug", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_Source",
				KeySchema: [
					{ AttributeName: "source_provider", KeyType: "HASH" },
					{ AttributeName: "source_id", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "GSI_OrgId",
				KeySchema: [
					{ AttributeName: "org_id", KeyType: "HASH" },
					{ AttributeName: "updated_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// Document Versions Table
	{
		TableName: "local-document-versions",
		KeySchema: [
			{ AttributeName: "document_id", KeyType: "HASH" },
			{ AttributeName: "version_number", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "document_id", AttributeType: "S" },
			{ AttributeName: "version_number", AttributeType: "N" },
		],
	},

	// Document Access Table
	{
		TableName: "local-document-access",
		KeySchema: [
			{ AttributeName: "document_id", KeyType: "HASH" },
			{ AttributeName: "access_id", KeyType: "RANGE" },
		],
		AttributeDefinitions: [
			{ AttributeName: "document_id", AttributeType: "S" },
			{ AttributeName: "access_id", AttributeType: "S" },
			{ AttributeName: "grantee_id", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_Grantee",
				KeySchema: [
					{ AttributeName: "grantee_id", KeyType: "HASH" },
					{ AttributeName: "document_id", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},

	// DocuSign Envelopes Table
	// Mirrors the CDK definition in document-host-api.ts so that the
	// docusign-create-envelope, sign-link-* and webhook Lambdas can run
	// against DynamoDB-Local during SAM development.
	{
		TableName: "local-docusign-envelopes",
		KeySchema: [{ AttributeName: "envelope_id", KeyType: "HASH" }],
		AttributeDefinitions: [
			{ AttributeName: "envelope_id", AttributeType: "S" },
			{ AttributeName: "document_id", AttributeType: "S" },
			{ AttributeName: "created_at", AttributeType: "S" },
		],
		GlobalSecondaryIndexes: [
			{
				IndexName: "GSI_DocumentId",
				KeySchema: [
					{ AttributeName: "document_id", KeyType: "HASH" },
					{ AttributeName: "created_at", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
];

/**
 * Environment variable mappings for local.json
 * Maps Lambda env vars to local table names
 */
export const LOCAL_TABLE_ENV_VARS: Record<string, string> = {
	PERSON_TABLE_NAME: "local-person",
	INTEGRATIONS_RAW_TABLE_NAME: "local-integrations-raw",
	BFPM_SESSIONS_TABLE_NAME: "local-bfpm-sessions",
	BFPM_DATA_TABLE_NAME: "local-bfpm-data",
	LOOPS_TABLE_NAME: "local-loops",
	LOOP_FINANCIALS_TABLE_NAME: "local-loop-financials",
	DEALS_TABLE_NAME: "local-deals",
	COMPANIES_TABLE_NAME: "local-companies",
	CONTACTS_TABLE_NAME: "local-contacts",
	// Integrations Module
	INTEGRATIONS_TABLE_NAME: "local-integrations",
	LINEAR_DELIVERY_TABLE_NAME: "local-linear-delivery",
	INTEGRATION_SYNC_HISTORY_TABLE_NAME: "local-integration-sync-history",
	INTEGRATION_SYNC_DETAILS_TABLE_NAME: "local-integration-sync-details",
	UNIFIED_OPPORTUNITIES_TABLE_NAME: "local-unified-opportunities",
	PARTNER_OPPORTUNITIES_TABLE_NAME: "local-partner-opportunities",
	PARTNER_ENGAGEMENTS_TABLE_NAME: "local-partner-engagements",
	PARTNER_ENGAGEMENT_INVITATIONS_TABLE_NAME:
		"local-partner-engagement-invitations",
	// Hiring Pipeline
	HIRING_CANDIDATES_TABLE_NAME: "local-hiring-candidates",
	HIRING_NOTES_TABLE_NAME: "local-hiring-notes",
	HIRING_JOB_RECS_TABLE_NAME: "local-hiring-job-recs",
	// Document Host
	DOCUMENTS_TABLE_NAME: "local-documents",
	DOCUMENT_VERSIONS_TABLE_NAME: "local-document-versions",
	DOCUMENT_ACCESS_TABLE_NAME: "local-document-access",
	DOCUSIGN_ENVELOPES_TABLE: "local-docusign-envelopes",
};
