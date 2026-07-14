import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Client } from "@hubspot/api-client";
import type { EventBridgeEvent } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { createLogger } from "../shared/logger";
import { err, ok } from "../shared/response";
import { getClient } from "./shared";

const eventBridgeClient = new EventBridgeClient({});

// Helper to build sourceEntityExternalId
const buildSourceEntityId = (
	source: string,
	entity: string,
	externalId: string,
) => `${source}#${entity}#${externalId}`;

// Helper to fetch and cache pipeline and stage mappings
const fetchPipelineAndStageMappings = async (
	client: Client,
): Promise<{
	pipelineMap: Map<string, string>;
	stageMap: Map<string, { pipelineId: string; stageName: string }>;
}> => {
	const pipelineMap = new Map<string, string>();
	const stageMap = new Map<string, { pipelineId: string; stageName: string }>();
	const logger = createLogger("fetchPipelineAndStageMappings");

	try {
		// Fetch all pipelines for deals
		const pipelinesResponse = await client.crm.pipelines.pipelinesApi.getAll(
			"deals",
		);
		const pipelines = pipelinesResponse.results || [];

		// Build pipeline ID to name mapping and fetch stages
		for (const pipeline of pipelines) {
			if (!pipeline.id) continue;

			// Store pipeline name
			pipelineMap.set(pipeline.id, pipeline.label || pipeline.id);

			// Fetch stages for this pipeline
			try {
				const stagesResponse =
					await client.crm.pipelines.pipelineStagesApi.getAll(
						"deals",
						pipeline.id,
					);
				const stages = stagesResponse.results || [];

				// Store stage names with composite key: pipelineId#stageId
				for (const stage of stages) {
					if (stage.id) {
						const key = `${pipeline.id}#${stage.id}`;
						stageMap.set(key, {
							pipelineId: pipeline.id,
							stageName: stage.label || stage.id,
						});
					}
				}
			} catch (stageErr) {
				logger.warn(
					`Failed to fetch stages for pipeline ${pipeline.id}`,
					{ error: stageErr },
				);
			}
		}
	} catch (err) {
		logger.error("Failed to fetch pipeline mappings", { error: err });
		// Return empty maps if fetch fails - we'll still store IDs
	}

	return { pipelineMap, stageMap };
};



// Helper to resolve pipeline and stage names from IDs
const resolvePipelineAndStageNames = (
	pipelineId: string | null | undefined,
	dealstageId: string | null | undefined,
	pipelineMap: Map<string, string>,
	stageMap: Map<string, { pipelineId: string; stageName: string }>,
): { pipelineName: string | null; dealstageName: string | null } => {
	let pipelineName: string | null = null;
	let dealstageName: string | null = null;

	if (pipelineId) {
		pipelineName = pipelineMap.get(pipelineId) || pipelineId;
	}

	if (pipelineId && dealstageId) {
		const key = `${pipelineId}#${dealstageId}`;
		const stageInfo = stageMap.get(key);
		dealstageName = stageInfo?.stageName || dealstageId;
	} else if (dealstageId) {
		dealstageName = dealstageId;
	}

	console.log("pipelineName", pipelineName);
	console.log("dealstageId", dealstageId);
	console.log("dealstageName", dealstageName);
	return { pipelineName, dealstageName };
};




// Helper to calculate TTL (90 days from now)
const calculateTTL = (): number => {
	const now = new Date();
	const ttlDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
	return Math.floor(ttlDate.getTime() / 1000);
};

// Helper to format deal for payload
const formatDealPayload = (
	deal: any,
	pipelineName?: string | null,
	dealstageName?: string | null,
	ownerInfo?: { name: string; email: string } | null,
) => {
	const props = deal.properties ?? {};
	console.log("deal", deal);
	if ("hs_object_id" in props) {
		delete props["hs_object_id"];
	}

	const companyIds = Array.from(
		new Set(deal.associations?.companies?.results?.map((a: any) => a.id) ?? []),
	);

	const contactIds = Array.from(
		new Set(deal.associations?.contacts?.results?.map((a: any) => a.id) ?? []),
	);

	return {
		id: deal.id,
		...props,
		companyIds,
		contactIds,
		pipelineName: pipelineName || null,
		dealstageName: dealstageName || null,
		// Keep original IDs for reference
		pipeline: props.pipeline || null,
		dealstage: props.dealstage || null,
		// Owner information
		ownerId: props.hubspot_owner_id || null,
		ownerName: ownerInfo?.name || null,
		ownerEmail: ownerInfo?.email || null,
		// name: props.dealname || null,
		// amount: props.amount || null,
		// stage: props.dealstage || null,
		// createdAt: props.createdate || null,
		// updatedAt: props.lastmodifieddate || null,
		// companyName: companyName || null,
		// contactName: contactName || null,
		// contactEmail: contactEmail || null,
	};
};

// Helper to format contact for payload
const formatContactPayload = (contact: any, companyName?: string) => {
	const props = contact.properties ?? {};

	if ("hs_object_id" in props) {
		delete props["hs_object_id"];
	}

	return {
		id: contact.id,
		...props,
		// firstName: props.firstname || null,
		// lastName: props.lastname || null,
		// email: props.email || null,
		// phone: props.phone || null,
		// company: companyName || null,
		// createdAt: props.createdate || null,
		// updatedAt: props.lastmodifieddate || null,
	};
};

// Helper to format company for payload
const formatCompanyPayload = (
	company: any,
	ownerInfo?: { name: string; email: string } | null,
) => {
	console.log("company log", company);
	console.log("ownerInfo", ownerInfo);
	const props = company.properties ?? {};

	if ("hs_object_id" in props) {
		delete props["hs_object_id"];
	}

	return {
		id: company.id,
		...props,
		// Owner information
		ownerId: props.hubspot_owner_id || null,
		ownerName: ownerInfo?.name || null,
		ownerEmail: ownerInfo?.email || null,
	};
};

// Helper to chunk array into batches
const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
};

// Helper to batch fetch companies with chunking
const batchFetchCompanies = async (
	client: Client,
	companyIds: Set<string>,
): Promise<Map<string, string>> => {
	const companyMap: Map<string, string> = new Map();
	if (companyIds.size === 0) {
		return companyMap;
	}

	const companyIdsArray = Array.from(companyIds);
	const chunks = chunkArray(companyIdsArray, 100);

	for (const chunk of chunks) {
		const companiesRes = await client.crm.companies.batchApi.read({
			inputs: chunk.map((id) => ({ id })),
			properties: ["name"],
			propertiesWithHistory: [],
		});
		companiesRes.results.forEach((c) => {
			companyMap.set(c.id, c.properties?.name ?? "");
		});
	}

	return companyMap;
};

// Helper to batch fetch contacts with chunking
const batchFetchContacts = async (
	client: Client,
	contactIds: Set<string>,
): Promise<Map<string, { fullName: string; email: string }>> => {
	const contactMap: Map<string, { fullName: string; email: string }> =
		new Map();
	if (contactIds.size === 0) {
		return contactMap;
	}

	const contactIdsArray = Array.from(contactIds);
	const chunks = chunkArray(contactIdsArray, 100);

	for (const chunk of chunks) {
		const contactsRes = await client.crm.contacts.batchApi.read({
			inputs: chunk.map((id) => ({ id })),
			properties: ["firstname", "lastname", "email"],
			propertiesWithHistory: [],
		});
		contactsRes.results.forEach((ct) => {
			const props = ct.properties ?? {};
			const fullName = [props.firstname, props.lastname]
				.filter(Boolean)
				.join(" ");
			contactMap.set(ct.id, {
				fullName,
				email: props.email || "",
			});
		});
	}

	return contactMap;
};

// Helper to batch fetch owners with chunking
const batchFetchOwners = async (
	client: Client,
	ownerIds: Set<string>,
): Promise<Map<string, { name: string; email: string }>> => {
	const ownerMap: Map<string, { name: string; email: string }> = new Map();
	if (ownerIds.size === 0) {
		return ownerMap;
	}

	const ownerIdsArray = Array.from(ownerIds);
	const logger = createLogger("batchFetchOwners");

	// Fetch owners individually (HubSpot Owners API doesn't have batch endpoint)
	let scopeErrorLogged = false;
	for (const ownerId of ownerIdsArray) {
		try {
			// Convert ownerId to number (HubSpot owner IDs are numeric)
			const ownerIdNum = parseInt(ownerId, 10);
			if (isNaN(ownerIdNum)) {
				logger.warn(`Invalid owner ID format: ${ownerId}, skipping`);
				continue;
			}
			const owner = await client.crm.owners.ownersApi.getById(ownerIdNum);
			console.log("owner", owner);
			if (owner.id) {
				const fullName = [owner.firstName, owner.lastName]
					.filter(Boolean)
					.join(" ");
				ownerMap.set(String(owner.id), {
					name: fullName || owner.email || "",
					email: owner.email || "",
				});
			}
		} catch (err: any) {
			// Check if it's a scope error
			if (
				err?.body?.category === "MISSING_SCOPES" &&
				err?.body?.errors?.[0]?.context?.requiredGranularScopes?.includes(
					"crm.objects.owners.read",
				)
			) {
				if (!scopeErrorLogged) {
					logger.warn(
						"Missing required scope 'crm.objects.owners.read' for fetching owner details. Owner names/emails will not be available. Please add this scope to your HubSpot app.",
					);
					scopeErrorLogged = true;
				}
			} else {
				logger.warn(`Failed to fetch owner ${ownerId}:`, { error: err });
			}
			// Continue with other owners even if one fails
		}
	}

	return ownerMap;
};

// Insert record into DynamoDB
const insertRecord = async (
	tableName: string,
	source: string,
	entity: string,
	externalId: string,
	payload: any,
	sourceCreatedAt: string | null,
	sourceUpdatedAt: string | null,
) => {
	const ingestedAt = new Date().toISOString();
	const sourceEntityExternalId = buildSourceEntityId(
		source,
		entity,
		externalId,
	);

	const item = {
		sourceEntityExternalId,
		ingestedAt,
		source,
		entity,
		externalId,
		payload,
		sourceCreatedAt,
		sourceUpdatedAt,
		ingestionType: "API_GATEWAY",
		receivedAt: ingestedAt,
		ttl: calculateTTL(),
	};

	await ddbClient.send(
		new PutCommand({
			TableName: tableName,
			Item: item,
		}),
	);
};

// Upsert record into DynamoDB (insert or update if updatedAt changed)
const upsertRecord = async (
	tableName: string,
	source: string,
	entity: string,
	externalId: string,
	payload: any,
	sourceCreatedAt: string | null,
	sourceUpdatedAt: string | null,
) => {
	const ingestedAt = new Date().toISOString();
	const sourceEntityExternalId = buildSourceEntityId(
		source,
		entity,
		externalId,
	);

	// Query for existing records by partition key (get the latest one)
	const existingRecords = await ddbClient.send(
		new QueryCommand({
			TableName: tableName,
			KeyConditionExpression: "sourceEntityExternalId = :pk",
			ExpressionAttributeValues: {
				":pk": sourceEntityExternalId,
			},
			ScanIndexForward: false, // Sort descending by ingestedAt
			Limit: 1, // Only get the latest record
		}),
	);

	const existingRecord = existingRecords.Items?.[0];

	// If record exists, compare updatedAt
	if (existingRecord) {
		const existingUpdatedAt = existingRecord.payload?.updatedAt;
		const newUpdatedAt = payload.updatedAt;

		// If updatedAt is the same, skip update
		if (existingUpdatedAt === newUpdatedAt) {
			return;
		}

		// Record doesn't exist or updatedAt is different - insert/update
		// Use the existing ingestedAt if updating, otherwise use new one
		const item = {
			sourceEntityExternalId,
			ingestedAt: existingRecord?.ingestedAt || ingestedAt, // Keep original ingestedAt if updating
			source,
			entity,
			externalId,
			payload,
			sourceCreatedAt: existingRecord?.sourceCreatedAt || sourceCreatedAt, // Keep original if updating
			sourceUpdatedAt, // Always update this when record changes
			ingestionType: "API_GATEWAY",
			receivedAt: existingRecord?.receivedAt || ingestedAt, // Keep original receivedAt if updating
			ttl: calculateTTL(),
		};

		await ddbClient.send(
			new PutCommand({
				TableName: tableName,
				Item: item,
			}),
		);
		return;
	}
	// Record doesn't exist - insert new one
	const item = {
		sourceEntityExternalId,
		ingestedAt,
		source,
		entity,
		externalId,
		payload,
		sourceCreatedAt,
		sourceUpdatedAt,
		ingestionType: "EVENT_BRIDGE",
		receivedAt: ingestedAt,
		ttl: calculateTTL(),
	};

	await ddbClient.send(
		new PutCommand({
			TableName: tableName,
			Item: item,
		}),
	);
};

// Main handler
export const ingestHubspotData = async (
	event: EventBridgeEvent<"Ingest Requested", any>,
) => {
	const logger = createLogger("ingestHubspotData");

	const { entityType, integration_id, integration_type } = event.detail;

	try {
		if (!entityType) {
			return err(
				"Entity type is required (deals, contacts, or companies)",
				400,
			);
		}

		// Validate entity type
		const validEntities = ["deals", "contacts", "companies"];
		if (!validEntities.includes(entityType)) {
			return err(
				`Invalid entity type. Must be one of: ${validEntities.join(", ")}`,
				400,
			);
		}

		const tableName = process.env.INTEGRATIONS_RAW_TABLE_NAME;
		if (!tableName) {
			throw new Error(
				"INTEGRATIONS_RAW_TABLE_NAME environment variable not set",
			);
		}

		const client: Client = await getClient();
		let totalIngested = 0;
		let hasMore = true;
		let after: string | undefined;

		logger.info(`Starting ingestion for entity: ${entityType}`);

		// Fetch pipeline and stage mappings for deals (only once at start)
		let pipelineMap: Map<string, string> = new Map();
		let stageMap: Map<
			string,
			{ pipelineId: string; stageName: string }
		> = new Map();

		if (entityType === "deals") {
			logger.info("Fetching pipeline and stage mappings...");
			const mappings = await fetchPipelineAndStageMappings(client);
			pipelineMap = mappings.pipelineMap;
			stageMap = mappings.stageMap;
			logger.info(
				`Loaded ${pipelineMap.size} pipelines and ${stageMap.size} stages`,
			);
		}

		// Pagination loop
		while (hasMore) {
			let pageResults: any[] = [];
			let paging: any;

			// Fetch data based on entity type
			if (entityType === "deals") {
				const dealsPage = await client.crm.deals.basicApi.getPage(
					100,
					after,
					[
						"amount",
						"closedate",
						"createdate",
						"dealname",
						"dealstage",
						"hs_lastmodifieddate",
						"hs_object_id",
						"pipeline",
						"hubspot_owner_id",
					],
					undefined,
					["companies", "contacts"],
					false,
				);
				pageResults = dealsPage.results;
				paging = dealsPage.paging;

				// Collect owner IDs for batch fetch
				const ownerIds = new Set<string>();
				pageResults.forEach((deal) => {
					const ownerId = deal.properties?.hubspot_owner_id;
					if (ownerId) {
						ownerIds.add(ownerId);
					}
				});

				// Batch fetch owners
				const ownerMap = await batchFetchOwners(client, ownerIds);

				// Insert each deal
				for (const deal of pageResults) {
					console.log("deal log ", deal);
					const pipelineId = deal.properties?.pipeline || null;
					const dealstageId = deal.properties?.dealstage || null;

					// Resolve pipeline and stage names
					const { pipelineName, dealstageName } =
						resolvePipelineAndStageNames(
							pipelineId,
							dealstageId,
							pipelineMap,
							stageMap,
						);

					// Get owner info
					const ownerId = deal.properties?.hubspot_owner_id;
					const ownerInfo = ownerId ? ownerMap.get(ownerId) : null;

					const payload = formatDealPayload(
						deal,
						pipelineName,
						dealstageName,
						ownerInfo || null,
					);
					console.log("payload", payload);
					await upsertRecord(
						tableName,
						"hubspot",
						"deal",
						deal.id,
						payload,
						deal.properties?.createdate || null,
						deal.properties?.hs_lastmodifieddate || null,
					);
				}
			} else if (entityType === "contacts") {
				const contactsPage = await client.crm.contacts.basicApi.getPage(
					100,
					after,
					undefined,
					undefined,
					["companies"],
					false,
				);
				pageResults = contactsPage.results;
				paging = contactsPage.paging;

				// Collect company IDs for batch fetch
				const companyIds = new Set<string>();
				pageResults.forEach((contact) => {
					const companyAssocs = contact.associations?.companies?.results;
					if (companyAssocs && Array.isArray(companyAssocs)) {
						companyAssocs.forEach((a) => companyIds.add(a.id));
					}
				});

				// Batch fetch companies
				const companyMap = await batchFetchCompanies(client, companyIds);



				// Insert each contact
				for (const contact of pageResults) {
					const companyResults = contact.associations?.companies?.results;
					const firstCompanyId =
						companyResults &&
							Array.isArray(companyResults) &&
							companyResults.length > 0
							? companyResults[0].id
							: undefined;

					const companyName = firstCompanyId
						? companyMap.get(firstCompanyId)
						: undefined;
					const payload = formatContactPayload(contact, companyName);

					await upsertRecord(
						tableName,
						"hubspot",
						"contact",
						contact.id,
						payload,
						contact.properties?.createdate || null,
						contact.properties?.lastmodifieddate || null,
					);
				}
			} else if (entityType === "companies") {
				const companiesPage = await client.crm.companies.basicApi.getPage(
					100,
					after,
					[
						"name",
						"domain",
						"industry",
						"city",
						"state",
						"country",
						"createdate",
						"hs_lastmodifieddate",
						"hs_object_id",
						"hubspot_owner_id",
					],
					undefined,
					undefined,
					false,
				);
				pageResults = companiesPage.results;
				paging = companiesPage.paging;

				// Collect owner IDs for batch fetch
				const ownerIds = new Set<string>();
				pageResults.forEach((company) => {
					const ownerId = company.properties?.hubspot_owner_id;
					if (ownerId) {
						ownerIds.add(ownerId);
					}
				});

				// Batch fetch owners
				const ownerMap = await batchFetchOwners(client, ownerIds);

				// Insert each company
				for (const company of pageResults) {
					const ownerId = company.properties?.hubspot_owner_id;
					const ownerInfo = ownerId ? ownerMap.get(ownerId) : null;

					const payload = formatCompanyPayload(company, ownerInfo || null);

					await upsertRecord(
						tableName,
						"hubspot",
						"company",
						company.id,
						payload,
						company.properties?.createdate || null,
						company.properties?.hs_lastmodifieddate || null,
					);
				}
			}

			totalIngested += pageResults.length;
			logger.info(
				`Ingested ${pageResults.length} ${entityType}, total: ${totalIngested}`,
			);

			// Check if there are more pages
			hasMore = !!paging?.next?.after;
			after = paging?.next?.after;
		}

		logger.info(
			`Completed ingestion for ${entityType}. Total records: ${totalIngested}`,
		);

		await eventBridgeClient.send(
			new PutEventsCommand({
				Entries: [
					{
						Source: "integration.ingest",
						DetailType: "Ingestion Complete",
						Detail: JSON.stringify({
							integration_id,
							integration_type,
							entity: entityType,
							completed_at: new Date().toISOString(),
						}),
					},
				],
			}),
		);

		return ok({
			success: true,
			entity: entityType,
			totalIngested,
			message: `Successfully ingested ${totalIngested} ${entityType}`,
		});
	} catch (e: any) {
		logger.error("ingestHubspotData error:", e);
		return err(e?.message ?? "Internal error");
	}
};
