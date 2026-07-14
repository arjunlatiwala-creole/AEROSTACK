import crypto from "node:crypto";
import { PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
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

export const handler = async (
	event: EventBridgeEvent<"Ingestion Complete", any>,
) => {
	const { entity, integration_id: integrationId } = event.detail;

	const logger = createLogger("ProcessEntityHandler");
	const startTime = Date.now();

	if (!entity || !["deals", "contacts", "companies"].includes(entity)) {
		return err(
			"Invalid entityType. Must be deals, contacts, or companies",
			400,
		);
	}

	const entityTypeMapping: Record<"deals" | "contacts" | "companies", string> =
	{
		deals: "deal",
		contacts: "contact",
		companies: "company",
	};

	const entityType =
		entityTypeMapping[entity as keyof typeof entityTypeMapping];

	if (!integrationId) {
		return err("integration_id is required", 400);
	}

	const rawTable = process.env.INTEGRATIONS_RAW_TABLE_NAME!;
	const dealsTable = process.env.DEALS_TABLE_NAME!;
	const companiesTable = process.env.COMPANIES_TABLE_NAME!;
	const contactsTable = process.env.CONTACTS_TABLE_NAME!;
	const integrationsSyncHistoryTable =
		process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME!;
	const integrationsSyncDetailsTable =
		process.env.INTEGRATION_SYNC_DETAILS_TABLE_NAME!;
	const integrationTable = process.env.INTEGRATIONS_TABLE_NAME!;

	const tableMapping = {
		deal: { table: dealsTable, idField: "dealId" },
		company: { table: companiesTable, idField: "companyId" },
		contact: { table: contactsTable, idField: "contactId" },
	};

	const { table: targetTable, idField } =
		tableMapping[entityType as keyof typeof tableMapping];

	// Sync tracking setup
	const syncId = crypto.randomUUID();
	const syncHistoryRepo = new IntegrationSyncHistoryRepository(
		ddbClient,
		integrationsSyncHistoryTable,
	);
	const syncDetailsRepo = new IntegrationSyncDetailsRepository(
		ddbClient,
		integrationsSyncDetailsTable,
	);

	const integrationRepo = new IntegrationRepository(
		ddbClient,
		integrationTable,
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
	let lastEvaluatedKey: any;

	try {
		// Initialize sync
		await tracker.initialize({ manual_trigger: true, direction: "inbound" });

		do {
			const scanResult = await ddbClient.send(
				new ScanCommand({
					TableName: rawTable,
					FilterExpression: "entity = :entityType",
					ExpressionAttributeValues: {
						":entityType": entityType,
					},
					ExclusiveStartKey: lastEvaluatedKey,
				}),
			);

			for (const rawItem of scanResult.Items || []) {
				const externalId = rawItem.externalId;
				const sourceUpdatedAt = rawItem.sourceUpdatedAt;
				const payload = rawItem.payload;

				try {
					const queryResult = await ddbClient.send(
						new QueryCommand({
							TableName: targetTable,
							KeyConditionExpression: "#id = :externalId",
							ExpressionAttributeNames: {
								"#id": idField,
							},
							ExpressionAttributeValues: {
								":externalId": externalId,
							},
							ScanIndexForward: false,
							Limit: 1,
						}),
					);

					const existingRecord = queryResult.Items?.[0];

					// Extract owner fields for deals and companies
					const ownerFields =
						entityType === "deal" || entityType === "company"
							? {
								ownerId: payload.ownerId || null,
								ownerEmail: payload.ownerEmail || null,
								ownerName: payload.ownerName || null,
							}
							: {};

					// INSERT
					if (!existingRecord) {
						await ddbClient.send(
							new PutCommand({
								TableName: targetTable,
								Item: {
									[idField]: externalId,
									...payload,
									...ownerFields,
									createdAt: payload.createdate || new Date().toISOString(),
								},
							}),
						);

						await tracker.recordSuccess(
							entityType,
							externalId,
							externalId,
							"create",
							{ old: {}, new: payload },
						);
					}
					// UPDATE
					else {
						const existingUpdatedAt = existingRecord.hs_lastmodifieddate;

						if (new Date(sourceUpdatedAt) > new Date(existingUpdatedAt)) {
							await ddbClient.send(
								new PutCommand({
									TableName: targetTable,
									Item: {
										[idField]: externalId,
										...payload,
										...ownerFields,
										createdAt: existingRecord.createdAt,
									},
								}),
							);

							await tracker.recordSuccess(
								entityType,
								externalId,
								externalId,
								"update",
								{
									old: existingRecord,
									new: payload,
								},
							);
						}
					}

					processed++;
				} catch (recordError: any) {
					failed++;
					logger.error("Record sync failed", {
						entityType,
						externalId,
						error: recordError,
					});

					await tracker.recordFailure(
						entityType,
						externalId,
						"update",
						recordError,
					);
				}
			}

			lastEvaluatedKey = scanResult.LastEvaluatedKey;
		} while (lastEvaluatedKey);

		return ok({
			entityType,
			syncId,
			processed,
			failed,
		});
	} catch (error: any) {
		logger.error("Process entity error", error);
		throw error;
	} finally {
		await tracker.complete(
			processed,
			failed,
			startTime,
			failed ? "Some records failed to sync" : "",
			true,
		);
	}
};
