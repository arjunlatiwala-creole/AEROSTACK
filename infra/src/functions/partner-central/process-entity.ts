import crypto from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

const s3Client = new S3Client({});
const logger = createLogger("PartnerCentralProcessEntity");

interface S3PartnerCentralData {
	syncedAt: string;
	totalRecords: number;
	entity: string;
	catalog: string;
	records: any[];
}

async function fetchPartnerCentralDataFromS3(
	bucket: string,
	key: string,
): Promise<S3PartnerCentralData> {
	const response = await s3Client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);

	const bodyString = await response.Body?.transformToString();
	if (!bodyString) {
		throw new Error("Empty S3 response");
	}

	return JSON.parse(bodyString);
}

const convertUndefinedToNull = (obj: any): any => {
	if (obj === undefined) {
		return null;
	}
	if (Array.isArray(obj)) {
		return obj.map(convertUndefinedToNull);
	}
	// Only traverse plain objects
	if (obj !== null && typeof obj === "object" && obj.constructor === Object) {
		return Object.fromEntries(
			Object.entries(obj).map(([k, v]) => [k, convertUndefinedToNull(v)]),
		);
	}
	return obj;
};

const upsertRecord = async (
	tableName: string,
	partitionKeyName: string,
	externalId: string,
	recordData: any,
	sourceUpdatedAt: string | null,
) => {
	try {
		const existing = await ddbClient.send(
			new QueryCommand({
				TableName: tableName,
				KeyConditionExpression: `${partitionKeyName} = :id`,
				ExpressionAttributeValues: { ":id": externalId },
				ScanIndexForward: false,
				Limit: 1,
			}),
		);

		const existingRecord = existing.Items?.[0];

		if (!existingRecord) {
			// INSERT new record - store complete record with TTL
			await ddbClient.send(
				new PutCommand({
					TableName: tableName,
					Item: {
						...recordData,
						[partitionKeyName]: externalId,
					},
				}),
			);
		} else {
			// UPDATE existing record if source has newer data
			const existingUpdatedAt =
				existingRecord.LastModifiedDate || existingRecord.ExpirationDate;
			const newUpdatedAt = sourceUpdatedAt;

			if (
				!existingUpdatedAt ||
				(newUpdatedAt && new Date(newUpdatedAt) > new Date(existingUpdatedAt))
			) {
				await ddbClient.send(
					new PutCommand({
						TableName: tableName,
						Item: {
							...recordData,
							[partitionKeyName]: externalId,
							// Preserve original CreatedDate from existing record if available
							CreatedDate: existingRecord.CreatedDate || recordData.CreatedDate,
						},
					}),
				);
			}
		}
	} catch (e) {
		logger.error("Upsert failed", { error: e });
		throw e;
	}
};

export const handler = async (
	event: EventBridgeEvent<"Ingestion Complete", any>,
) => {
	const { entity, integration_id: integrationId, bucket, s3Key } = event.detail;
	const startTime = Date.now();

	const validEntities = [
		"opportunities",
		"engagements",
		"engagement-invitations",
	];
	if (!entity || !validEntities.includes(entity)) {
		return err(`Invalid entity. Must be ${validEntities.join(", ")}`, 400);
	}

	if (!integrationId) {
		return err("integration_id is required", 400);
	}

	if (!bucket || !s3Key) {
		return err("bucket and s3Key are required", 400);
	}

	// Tables
	const targetTables = {
		opportunities:
			process.env.PARTNER_OPPORTUNITIES_TABLE_NAME ||
			"local-partner-opportunities",
		engagements:
			process.env.PARTNER_ENGAGEMENTS_TABLE_NAME || "local-partner-engagements",
		"engagement-invitations":
			process.env.PARTNER_ENGAGEMENT_INVITATIONS_TABLE_NAME ||
			"local-partner-engagement-invitations",
	} as const;
	const targetTable = targetTables[
		entity as keyof typeof targetTables
	] as string;

	// Partition key mapping for each entity type
	const partitionKeys = {
		opportunities: "opportunityId",
		engagements: "engagementId",
		"engagement-invitations": "invitationId",
	} as const;
	const partitionKeyName = partitionKeys[
		entity as keyof typeof partitionKeys
	] as string;

	// Sync tracking
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
		await tracker.initialize({ manual_trigger: true, direction: "inbound" });
		logger.info(`Processing ${entity} from S3 to ${targetTable}`, {
			bucket,
			s3Key,
		});

		const partnerData = await fetchPartnerCentralDataFromS3(bucket, s3Key);
		logger.info(`Fetched ${partnerData.records.length} records from S3`);

		for (const record of partnerData.records) {
			const externalId = record.Id;

			try {
				// Convert undefined to null for DynamoDB compatibility
				const cleanedRecord = convertUndefinedToNull(record);

				await upsertRecord(
					targetTable,
					partitionKeyName,
					externalId,
					cleanedRecord,
					record.LastModifiedDate || record.ExpirationDate || null,
				);

				processed++;

				await tracker.recordSuccess(entity, externalId, externalId, "upsert", {
					old: {},
					new: cleanedRecord,
				});
			} catch (recordError: any) {
				failed++;
				logger.error("Record sync failed", {
					entity,
					externalId,
					error: recordError,
				});
				await tracker.recordFailure(entity, externalId, "upsert", recordError);
			}
		}

		logger.info("Partner Central entity processing complete", {
			entity,
			processed,
			failed,
			syncId,
		});

		return ok({
			message: `Partner Central ${entity} processed successfully`,
			syncId,
			processed,
			failed,
			totalRecords: partnerData.records.length,
		});
	} catch (error: any) {
		logger.error("Process entity error", { error });
		return err(error.message || "Failed to process Partner Central entities");
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
