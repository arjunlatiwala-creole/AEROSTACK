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
const logger = createLogger("DeelProcessEntityHandler");

interface DeelUser {
	active: boolean;
	id: string;
	emails?: Array<{ value: string; type: string; primary: boolean }>;
	name?: { familyName: string; givenName: string };
	userName?: string;
	title?: string;
	userType?: string;
	addresses?: Array<any>;
	personDetails?: {
		data: {
			id: string;
			created_at: string;
			worker_id?: string;
			external_id?: string | null;
			termination_last_day?: string | null;
			start_date?: string;
			client_legal_entity?: { id: string; name: string };
			seniority?: string | null;
			completion_date?: string;
			direct_manager?: any;
			direct_reports?: any;
			direct_reports_count?: number;
			employments?: Array<any>;
			hiring_status?: string;
			new_hiring_status?: string;
			is_pwac?: boolean;
			hiring_type?: string;
			job_title?: string;
			timezone?: string;
			department?: any;
			work_location?: any;
			updated_at?: string;
			profile_organizational_structures?: Array<any>;
			worker_termination_last_date_of_work?: any;
			active_worker_termination_status?: any;
			last_day_of_work_local_date?: any;
			person_status?: any;
			custom_fields?: Array<any>;
		};
	};
}

interface S3DeelData {
	syncedAt: string;
	totalUsers: number;
	users: DeelUser[];
}

// Extract and transform Deel user data
function extractDeelPersonData(user: DeelUser): Record<string, any> {
	// Extract primary and alternate emails
	let primaryEmail = "";
	let alternateEmail = "";

	if (user.emails && user.emails.length > 0) {
		const primary = user.emails.find((e) => e.primary === true);
		const alternate = user.emails.find((e) => e.primary === false);
		primaryEmail = primary?.value || user.emails[0].value;
		alternateEmail = alternate?.value || "";
	}

	// Convert active boolean to number
	const activeStatus = user.active ? 1 : 0;

	// Extract created_at from personDetails
	const createdAt =
		user.personDetails?.data?.created_at || new Date().toISOString();

	// Build the record with all grabbed fields
	return {
		id: user.id,
		created_at: createdAt,
		active: activeStatus,
		email: primaryEmail,
		alternate_email: alternateEmail,

		// Name fields
		family_name: user.name?.familyName,
		given_name: user.name?.givenName,

		// User fields
		user_name: user.userName,
		title: user.title,
		user_type: user.userType,

		// Address
		addresses: user.addresses,

		// Person details fields
		worker_id: user.personDetails?.data?.worker_id,
		external_id: user.personDetails?.data?.external_id,
		termination_last_day: user.personDetails?.data?.termination_last_day,
		start_date: user.personDetails?.data?.start_date,
		client_legal_entity: user.personDetails?.data?.client_legal_entity,
		seniority: user.personDetails?.data?.seniority,
		completion_date: user.personDetails?.data?.completion_date,
		direct_manager: user.personDetails?.data?.direct_manager,
		direct_reports: user.personDetails?.data?.direct_reports,
		direct_reports_count: user.personDetails?.data?.direct_reports_count,
		employments: user.personDetails?.data?.employments,
		hiring_status: user.personDetails?.data?.hiring_status,
		new_hiring_status: user.personDetails?.data?.new_hiring_status,
		is_pwac: user.personDetails?.data?.is_pwac,
		hiring_type: user.personDetails?.data?.hiring_type,
		job_title: user.personDetails?.data?.job_title,
		timezone: user.personDetails?.data?.timezone,
		department: user.personDetails?.data?.department,
		work_location: user.personDetails?.data?.work_location,
		updated_at: user.personDetails?.data?.updated_at,
		profile_organizational_structures:
			user.personDetails?.data?.profile_organizational_structures,
		worker_termination_last_date_of_work:
			user.personDetails?.data?.worker_termination_last_date_of_work,
		active_worker_termination_status:
			user.personDetails?.data?.active_worker_termination_status,
		last_day_of_work_local_date:
			user.personDetails?.data?.last_day_of_work_local_date,
		person_status: user.personDetails?.data?.person_status,
		custom_fields: user.personDetails?.data?.custom_fields,
	};
}

// Fetch data from S3
async function fetchDeelDataFromS3(
	bucket: string,
	key: string,
): Promise<S3DeelData> {
	logger.info("Fetching Deel data from S3", { bucket, key });

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

export const handler = async (
	event: EventBridgeEvent<"Ingestion Complete", any>,
) => {
	const startTime = Date.now();

	// Parse body
	const {
		bucket,
		s3Key,
		usersProcessed,
		integration_id: integrationId,
		entity,
	} = event.detail;

	if (!bucket || !s3Key) {
		return err("bucket and s3Key are required", 400);
	}

	logger.info("Processing Deel entities", { bucket, s3Key, usersProcessed });

	// Table names
	const deelPeopleTable =
		process.env.DEEL_PEOPLE_TABLE_NAME! || "local-deel-people";
	const integrationsSyncHistoryTable =
		process.env.INTEGRATION_SYNC_HISTORY_TABLE_NAME! ||
		"local-integration-sync-history";
	const integrationsSyncDetailsTable =
		process.env.INTEGRATION_SYNC_DETAILS_TABLE_NAME! ||
		"local-integration-sync-details";

	const integrationsTable =
		process.env.INTEGRATIONS_TABLE_NAME! || "local-integrations";

	// Sync tracking setup
	const syncId = crypto.randomUUID();

	const integrationRepo = new IntegrationRepository(
		ddbClient,
		integrationsTable,
	);
	const syncHistoryRepo = new IntegrationSyncHistoryRepository(
		ddbClient,
		integrationsSyncHistoryTable,
	);
	const syncDetailsRepo = new IntegrationSyncDetailsRepository(
		ddbClient,
		integrationsSyncDetailsTable,
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
		// Initialize sync
		await tracker.initialize({ manual_trigger: true, direction: "inbound" });

		// Fetch data from S3
		const deelData = await fetchDeelDataFromS3(bucket, s3Key);
		logger.info(`Fetched ${deelData.users.length} users from S3`);

		// Process each user
		for (const user of deelData.users) {
			try {
				const userId = user.id;

				// Extract and transform user data
				const personData = extractDeelPersonData(user);
				console.log("personData", personData);

				// Check if record exists
				const queryResult = await ddbClient.send(
					new QueryCommand({
						TableName: deelPeopleTable,
						KeyConditionExpression: "id = :id",
						ExpressionAttributeValues: {
							":id": userId,
						},
						ScanIndexForward: false,
						Limit: 1,
					}),
				);

				const existingRecord = queryResult.Items?.[0];

				if (!existingRecord) {
					// INSERT new record
					await ddbClient.send(
						new PutCommand({
							TableName: deelPeopleTable,
							Item: personData,
						}),
					);

					await tracker.recordSuccess(entity, userId, userId, "create", {
						old: {},
						new: personData,
					});

					logger.info(`Inserted new Deel person: ${userId}`);
				} else {
					// UPDATE existing record
					const existingUpdatedAt = existingRecord.updated_at;
					const newUpdatedAt = personData.updated_at;

					// Update if source has newer data
					if (
						!existingUpdatedAt ||
						(newUpdatedAt &&
							new Date(newUpdatedAt) > new Date(existingUpdatedAt))
					) {
						await ddbClient.send(
							new PutCommand({
								TableName: deelPeopleTable,
								Item: {
									...personData,
									// Preserve original created_at from existing record
									created_at: existingRecord.created_at,
								},
							}),
						);

						await tracker.recordSuccess(entity, userId, userId, "update", {
							old: existingRecord,
							new: personData,
						});

						logger.info(`Updated Deel person: ${userId}`);
					} else {
						logger.info(`Skipped Deel person (no changes): ${userId}`);
					}
				}

				processed++;
			} catch (recordError: any) {
				failed++;
				logger.error("Record sync failed", {
					userId: user.id,
					error: recordError,
				});

				await tracker.recordFailure(entity, user.id, "upsert", recordError);
			}
		}

		logger.info("Deel entity processing complete", {
			processed,
			failed,
			syncId,
		});

		return ok({
			message: "Deel entities processed successfully",
			syncId,
			processed,
			failed,
			totalUsers: deelData.users.length,
		});
	} catch (error: any) {
		logger.error("Process entity error", error);
		return err(error.message || "Failed to process Deel entities", 500);
	} finally {
		// Moved tracker.complete() to finally block to ensure it always runs
		await tracker.complete(
			processed,
			failed,
			startTime,
			failed > 0 ? `${failed} records failed to sync` : "",
			true,
		);
	}
};
