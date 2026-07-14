#!/usr/bin/env npx ts-node
/**
 * Seed local DynamoDB from dev tables + run unified processing
 *
 * 1. Scans deals, companies, contacts, partner-opportunities from dev DynamoDB
 * 2. Writes them into local DynamoDB tables
 * 3. Runs the unified denormalization (source tables → unified-opportunities)
 *
 * Usage:
 *   npx ts-node scripts/seed-and-process-unified.ts
 *   npx ts-node scripts/seed-and-process-unified.ts --seed-only
 *   npx ts-node scripts/seed-and-process-unified.ts --process-only
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	BatchWriteCommand,
	DynamoDBDocumentClient,
	ScanCommand,
} from "@aws-sdk/lib-dynamodb";

// ── Config ──────────────────────────────────────────────────────────

const DEV_PREFIX = "aerostack-dev";
const LOCAL_ENDPOINT =
	process.env.DYNAMODB_LOCAL_ENDPOINT || "http://localhost:8000";

const TABLES_TO_SEED = [
	{ dev: `${DEV_PREFIX}-deals`, local: "local-deals" },
	{ dev: `${DEV_PREFIX}-companies`, local: "local-companies" },
	{ dev: `${DEV_PREFIX}-contacts`, local: "local-contacts" },
	{
		dev: `${DEV_PREFIX}-partner-opportunities`,
		local: "local-partner-opportunities",
	},
	{ dev: `${DEV_PREFIX}-integrations`, local: "local-integrations" },
];

// For unified processing
const UNIFIED_TABLE = "local-unified-opportunities";
const DEALS_TABLE = "local-deals";
const COMPANIES_TABLE = "local-companies";
const CONTACTS_TABLE = "local-contacts";
const PARTNER_OPPS_TABLE = "local-partner-opportunities";

// ── Clients ─────────────────────────────────────────────────────────

const marshallOptions = {
	removeUndefinedValues: true,
	convertEmptyValues: true,
};

const devClient = DynamoDBDocumentClient.from(
	new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" }),
	{ marshallOptions },
);

const localClient = DynamoDBDocumentClient.from(
	new DynamoDBClient({
		endpoint: LOCAL_ENDPOINT,
		region: "local",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
	}),
	{ marshallOptions },
);

// ── Colors ──────────────────────────────────────────────────────────

const c = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	blue: "\x1b[34m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	red: "\x1b[31m",
	bold: "\x1b[1m",
};

// ── Helpers ─────────────────────────────────────────────────────────

async function scanAll(
	client: DynamoDBDocumentClient,
	tableName: string,
): Promise<Record<string, any>[]> {
	const items: Record<string, any>[] = [];
	let lastKey: any;

	do {
		const result = await client.send(
			new ScanCommand({
				TableName: tableName,
				ExclusiveStartKey: lastKey,
			}),
		);

		items.push(...(result.Items || []));
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return items;
}

async function batchWriteLocal(
	tableName: string,
	items: Record<string, any>[],
) {
	// DynamoDB batch write limit is 25
	for (let i = 0; i < items.length; i += 25) {
		const batch = items.slice(i, i + 25);
		await localClient.send(
			new BatchWriteCommand({
				RequestItems: {
					[tableName]: batch.map((item) => ({
						PutRequest: { Item: item },
					})),
				},
			}),
		);
	}
}

// ── Step 1: Seed ────────────────────────────────────────────────────

async function seedLocalTables() {
	console.log(
		`\n${c.cyan}${c.bold}━━━ Seeding local tables from dev ━━━${c.reset}\n`,
	);

	for (const { dev, local } of TABLES_TO_SEED) {
		process.stdout.write(
			`  ${c.blue}${dev}${c.reset} → ${c.yellow}${local}${c.reset} ... `,
		);

		try {
			const items = await scanAll(devClient, dev);
			if (items.length === 0) {
				console.log(`${c.yellow}empty (0 items)${c.reset}`);
				continue;
			}

			await batchWriteLocal(local, items);
			console.log(`${c.green}${items.length} items${c.reset}`);
		} catch (error: any) {
			console.log(`${c.red}ERROR: ${error.message}${c.reset}`);
		}
	}
}

// ── Step 2: Unified Processing ──────────────────────────────────────

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
		contacts: contacts.map((ct) => ({
			firstName: ct.firstname || null,
			lastName: ct.lastname || null,
			email: ct.email || null,
			phone: ct.phone || null,
			jobTitle: ct.jobtitle || null,
		})),
		hubspot: { dealId: deal.dealId, ...deal },
		createdAt: deal.createdate || now,
		updatedAt: deal.hs_lastmodifieddate || now,
	};
}

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
		contacts: customerContacts.map((ct: any) => ({
			firstName: ct.FirstName || null,
			lastName: ct.LastName || null,
			email: ct.Email || null,
			phone: ct.Phone || null,
			jobTitle: ct.BusinessTitle || null,
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

async function processUnified() {
	console.log(
		`\n${c.cyan}${c.bold}━━━ Processing unified opportunities ━━━${c.reset}\n`,
	);

	const unified: Record<string, any>[] = [];

	// Process HubSpot deals
	process.stdout.write(`  ${c.blue}HubSpot deals${c.reset} ... `);
	const deals = await scanAll(localClient, DEALS_TABLE);
	const companies = await scanAll(localClient, COMPANIES_TABLE);
	const contacts = await scanAll(localClient, CONTACTS_TABLE);

	const companyMap = new Map(companies.map((c) => [c.companyId, c]));
	const contactMap = new Map(contacts.map((c) => [c.contactId, c]));

	for (const deal of deals) {
		const companyIds: string[] = deal.companyIds || [];
		const contactIds: string[] = deal.contactIds || [];

		const company = companyIds[0]
			? (companyMap.get(companyIds[0]) ?? null)
			: null;
		const dealContacts = contactIds
			.map((id) => contactMap.get(id))
			.filter(Boolean);

		unified.push(buildHubSpotUnified(deal, company, dealContacts));
	}
	console.log(`${c.green}${deals.length} deals${c.reset}`);

	// Process Partner Central opportunities
	process.stdout.write(
		`  ${c.blue}Partner Central opportunities${c.reset} ... `,
	);
	const partnerOpps = await scanAll(localClient, PARTNER_OPPS_TABLE);

	for (const opp of partnerOpps) {
		unified.push(buildAceUnified(opp));
	}
	console.log(`${c.green}${partnerOpps.length} opportunities${c.reset}`);

	// Write to unified table
	if (unified.length > 0) {
		process.stdout.write(
			`\n  ${c.blue}Writing to ${UNIFIED_TABLE}${c.reset} ... `,
		);
		await batchWriteLocal(UNIFIED_TABLE, unified);
		console.log(`${c.green}${unified.length} records${c.reset}`);
	} else {
		console.log(`\n  ${c.yellow}No records to write${c.reset}`);
	}
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const seedOnly = args.includes("--seed-only");
	const processOnly = args.includes("--process-only");

	console.log(`\n${c.cyan}${c.bold}Local Unified Sync${c.reset}`);
	console.log(`${c.blue}Local DDB: ${LOCAL_ENDPOINT}${c.reset}`);

	if (!processOnly) {
		await seedLocalTables();
	}

	if (!seedOnly) {
		await processUnified();
	}

	console.log(`\n${c.green}${c.bold}✅ Done${c.reset}\n`);
}

main().catch((error) => {
	console.error(`\n${c.red}❌ ${error.message}${c.reset}`);
	process.exit(1);
});
