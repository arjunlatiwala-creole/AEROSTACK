import crypto from "node:crypto";
import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { EventBridgeEvent } from "aws-lambda";
import {
	IntegrationRepository,
	IntegrationSyncDetailsRepository,
	IntegrationSyncHistoryRepository,
} from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { SyncHistoryTracker } from "../integrations/helpers/sync-history";
import { createLogger } from "../shared/logger";
import { err, ok } from "../shared/response";

const logger = createLogger("UnifiedProcessEntity");

const UNIFIED_TABLE = process.env.UNIFIED_OPPORTUNITIES_TABLE_NAME!;
const DEALS_TABLE = process.env.DEALS_TABLE_NAME!;
const COMPANIES_TABLE = process.env.COMPANIES_TABLE_NAME!;
const CONTACTS_TABLE = process.env.CONTACTS_TABLE_NAME!;
const PARTNER_OPPORTUNITIES_TABLE =
	process.env.PARTNER_OPPORTUNITIES_TABLE_NAME!;

// ─── HubSpot helpers ────────────────────────────────────────────────

async function fetchCompanyById(companyId: string): Promise<any | null> {
	const result = await ddbClient.send(
		new QueryCommand({
			TableName: COMPANIES_TABLE,
			KeyConditionExpression: "companyId = :id",
			ExpressionAttributeValues: { ":id": companyId },
			ScanIndexForward: false,
			Limit: 1,
		}),
	);
	return result.Items?.[0] ?? null;
}

async function fetchContactById(contactId: string): Promise<any | null> {
	const result = await ddbClient.send(
		new QueryCommand({
			TableName: CONTACTS_TABLE,
			KeyConditionExpression: "contactId = :id",
			ExpressionAttributeValues: { ":id": contactId },
			ScanIndexForward: false,
			Limit: 1,
		}),
	);
	return result.Items?.[0] ?? null;
}

function buildHubSpotUnified(deal: any, company: any, contacts: any[]) {
	const opportunityId = `hs-${deal.dealId}`;
	const now = new Date().toISOString();

	return {
		opportunityId,
		source: "hubspot",
		title: deal.dealname || deal.name || null,
		description: deal.description || null,
		stage: deal.dealstageName || deal.dealstage || null,
		pipeline: deal.pipelineName || deal.pipeline || null,
		amount: deal.amount ? Number(deal.amount) : null,
		currency: deal.deal_currency_code || null,
		closeDate: deal.closedate || null,
		ownerName: null,
		ownerEmail: null,
		companyName: company?.name || null,
		companyDomain: company?.domain || null,
		companyIndustry: company?.industry || null,
		contacts: contacts.map((c) => ({
			firstName: c.firstname || null,
			lastName: c.lastname || null,
			email: c.email || null,
			phone: c.phone || null,
			jobTitle: c.jobtitle || null,
		})),
		hubspot: {
			dealId: deal.dealId,
			...deal,
		},
		createdAt: deal.createdate || now,
		updatedAt: deal.hs_lastmodifieddate || now,
	};
}

// ─── APN-ACE helpers ────────────────────────────────────────────────

function buildAceUnified(opp: any) {
	const opportunityId = `ace-${opp.opportunityId}`;
	const now = new Date().toISOString();

	const customer = opp.Customer ?? {};
	const account = customer.Account ?? {};
	const customerContacts = customer.Contacts ?? [];
	const project = opp.Project ?? {};
	const lifeCycle = opp.LifeCycle ?? {};
	const team = opp.OpportunityTeam ?? [];

	const owner = team.find((m: any) => m.BusinessTitle === "OpportunityOwner");

	const spend = project.ExpectedCustomerSpend;
	const firstSpend = Array.isArray(spend) ? spend[0] : null;

	return {
		opportunityId,
		source: "apn-ace",
		title: project.Title || null,
		description: project.CustomerProblem || null,
		stage: lifeCycle.Stage || null,
		pipeline: null,
		amount: firstSpend?.Amount ? Number(firstSpend.Amount) : null,
		currency: firstSpend?.CurrencyCode || null,
		closeDate: lifeCycle.TargetCloseDate || null,
		ownerName: owner
			? `${owner.FirstName || ""} ${owner.LastName || ""}`.trim() || null
			: null,
		ownerEmail: owner?.Email || null,
		companyName: account.CompanyName || null,
		companyDomain: account.WebsiteUrl || null,
		companyIndustry: account.Industry || null,
		contacts: customerContacts.map((c: any) => ({
			firstName: c.FirstName || null,
			lastName: c.LastName || null,
			email: c.Email || null,
			phone: c.Phone || null,
			jobTitle: c.BusinessTitle || null,
		})),
		apnAce: {
			opportunityId: opp.opportunityId,
			reviewStatus: lifeCycle.ReviewStatus || null,
			useCase: project.CustomerUseCase || null,
			deliveryModels: project.DeliveryModels || [],
			awsProducts: opp.RelatedEntityIdentifiers?.AwsProducts || [],
			solutions: opp.RelatedEntityIdentifiers?.Solutions || [],
			campaignName: opp.Marketing?.CampaignName || null,
			engagementType: project.OtherSolutionDescription || null,
			catalog: opp.Catalog || null,
		},
		createdAt: opp.CreatedDate || now,
		updatedAt: opp.LastModifiedDate || now,
	};
}

// ─── Upsert logic ───────────────────────────────────────────────────

async function upsertUnifiedRecord(
	record: any,
): Promise<"create" | "update" | "skip"> {
	const existing = await ddbClient.send(
		new GetCommand({
			TableName: UNIFIED_TABLE,
			Key: {
				opportunityId: record.opportunityId,
				source: record.source,
			},
		}),
	);

	if (!existing.Item) {
		await ddbClient.send(
			new PutCommand({ TableName: UNIFIED_TABLE, Item: record }),
		);
		return "create";
	}

	const existingUpdatedAt = existing.Item.updatedAt;
	if (
		!existingUpdatedAt ||
		new Date(record.updatedAt) > new Date(existingUpdatedAt)
	) {
		await ddbClient.send(
			new PutCommand({
				TableName: UNIFIED_TABLE,
				Item: {
					...record,
					createdAt: existing.Item.createdAt || record.createdAt,
				},
			}),
		);
		return "update";
	}

	return "skip";
}

// ─── Handler ────────────────────────────────────────────────────────

export const handler = async (
	event: EventBridgeEvent<"Ingestion Complete", any>,
) => {
	const {
		entity,
		integration_id: integrationId,
		integration_type: integrationType,
	} = event.detail;

	const startTime = Date.now();

	// Only process relevant entities
	if (integrationType === "hubspot" && entity !== "deals") {
		return ok({ message: `Skipping hubspot entity: ${entity}` });
	}
	if (integrationType === "partner_central" && entity !== "opportunities") {
		return ok({ message: `Skipping partner_central entity: ${entity}` });
	}

	const syncId = crypto.randomUUID();
	const syncHistoryRepo = new IntegrationSyncHistoryRepository(
		ddbClient,
		process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME!,
	);
	const syncDetailsRepo = new IntegrationSyncDetailsRepository(
		ddbClient,
		process.env.INTEGRATION_SYNC_DETAILS_TABLE_NAME!,
	);
	const integrationRepo = new IntegrationRepository(
		ddbClient,
		process.env.INTEGRATIONS_TABLE_NAME!,
	);
	const tracker = new SyncHistoryTracker(
		integrationRepo,
		syncHistoryRepo,
		syncDetailsRepo,
		integrationId,
		syncId,
	);

	let processed = 0;
	let failed = 0;

	try {
		await tracker.initialize({
			manual_trigger: true,
			direction: "inbound",
		});

		if (integrationType === "hubspot") {
			// Scan all deals and denormalize
			let lastKey: any;
			do {
				const scan = await ddbClient.send(
					new ScanCommand({
						TableName: DEALS_TABLE,
						ExclusiveStartKey: lastKey,
					}),
				);

				for (const deal of scan.Items || []) {
					try {
						const companyIds: string[] = deal.companyIds || [];
						const contactIds: string[] = deal.contactIds || [];

						const company = companyIds[0]
							? await fetchCompanyById(companyIds[0])
							: null;

						console.log("company log ", company);

						const contacts = await Promise.all(
							contactIds.map((id) => fetchContactById(id)),
						);
						const validContacts = contacts.filter(Boolean);

						const unified = buildHubSpotUnified(deal, company, validContacts);
						const op = await upsertUnifiedRecord(unified);

						if (op !== "skip") {
							await tracker.recordSuccess(
								"unified-opportunity",
								unified.opportunityId,
								deal.dealId,
								op,
								{ old: {}, new: unified },
							);
						}

						processed++;
					} catch (e: any) {
						failed++;
						logger.error("Failed to process HubSpot deal", {
							dealId: deal.dealId,
							error: e,
						});
						await tracker.recordFailure(
							"unified-opportunity",
							deal.dealId,
							"upsert",
							e,
						);
					}
				}

				lastKey = scan.LastEvaluatedKey;
			} while (lastKey);
		} else if (integrationType === "partner_central") {
			// Scan all partner opportunities and denormalize
			let lastKey: any;
			do {
				const scan = await ddbClient.send(
					new ScanCommand({
						TableName: PARTNER_OPPORTUNITIES_TABLE,
						ExclusiveStartKey: lastKey,
					}),
				);

				for (const opp of scan.Items || []) {
					try {
						const unified = buildAceUnified(opp);
						const op = await upsertUnifiedRecord(unified);

						if (op !== "skip") {
							await tracker.recordSuccess(
								"unified-opportunity",
								unified.opportunityId,
								opp.opportunityId,
								op,
								{ old: {}, new: unified },
							);
						}

						processed++;
					} catch (e: any) {
						failed++;
						logger.error("Failed to process APN-ACE opportunity", {
							opportunityId: opp.opportunityId,
							error: e,
						});
						await tracker.recordFailure(
							"unified-opportunity",
							opp.opportunityId,
							"upsert",
							e,
						);
					}
				}

				lastKey = scan.LastEvaluatedKey;
			} while (lastKey);
		}

		logger.info("Unified entity processing complete", {
			integrationType,
			entity,
			processed,
			failed,
			syncId,
		});

		return ok({
			message: `Unified ${integrationType} processing complete`,
			syncId,
			processed,
			failed,
		});
	} catch (error: any) {
		logger.error("Unified process entity error", { error });
		return err(error.message || "Failed to process unified entities");
	} finally {
		await tracker.complete(
			processed,
			failed,
			startTime,
			failed > 0 ? `${failed} records failed to sync` : "",
			true,
		);
	}
};
