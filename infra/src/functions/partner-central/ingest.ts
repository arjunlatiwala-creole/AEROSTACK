import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EventBridgeEvent } from "aws-lambda";

import { PartnerRepository } from "src/repos/partner-central.repository";

import { createLogger } from "../shared/logger";
import { err, ok } from "../shared/response";

const eventBridgeClient = new EventBridgeClient({});
const s3Client = new S3Client({});
const logger = createLogger("partner-central-ingest");

const logError = (label: string, error: any) => {
	logger.error(label, {
		message: error?.message,
		name: error?.name,
		code: error?.code,
		stack: error?.stack,
		cause: error?.cause,
	});
};

export const handler = async (
	event: EventBridgeEvent<"Ingest Requested", any>,
) => {
	const { entityType, integration_id, integration_type } = event.detail;

	try {
		if (integration_type !== "partner_central") {
			return err(`Invalid integration_type: ${integration_type}`, 400);
		}

		if (!entityType) {
			return err("Missing entityType", 400);
		}

		const validEntities = [
			"opportunities",
			"engagements",
			"engagement-invitations",
		];

		if (!validEntities.includes(entityType)) {
			return err(`Invalid entity type: ${entityType}`, 400);
		}

		const bucketName = process.env.PARTNER_CENTRAL_BUCKET_NAME;
		const roleArn = process.env.PARTNER_ROLE_ARN;

		if (!bucketName) {
			throw new Error("PARTNER_CENTRAL_BUCKET_NAME not set");
		}

		if (!roleArn) {
			throw new Error("PARTNER_ROLE_ARN not set");
		}

		const repo = new PartnerRepository(roleArn);

		try {
			await repo.init();
		} catch (e) {
			logError("PartnerRepository init failed", e);
			throw e;
		}

		const allRecords: any[] = [];
		const catalog = "AWS";

		logger.info("Starting ingestion", {
			entityType,
			catalog,
		});

		if (entityType === "opportunities") {
			let nextToken: string | undefined;

			do {
				let result;

				try {
					result = await repo.listOpportunities(catalog, 100, nextToken);
				} catch (e) {
					logError("listOpportunities failed", e);
					throw e;
				}

				for (const opp of result.opportunities) {
					let fullOpp;

					try {
						fullOpp = await repo.getOpportunity(opp.Id, catalog);
					} catch (e) {
						logError("getOpportunity failed", {
							id: opp.Id,
							error: e,
						});
						throw e;
					}

					allRecords.push(fullOpp);
				}

				nextToken = result.nextToken;

				logger.info("Opportunities batch done", {
					batch: result.opportunities.length,
					total: allRecords.length,
				});
			} while (nextToken);
		}

		if (entityType === "engagements") {
			let nextToken: string | undefined;

			do {
				let result;

				try {
					result = await repo.listEngagements(catalog, 100, nextToken);
				} catch (e) {
					logError("listEngagements failed", e);
					throw e;
				}

				for (const eng of result.engagements) {
					const full = await repo.getEngagement(eng.Id, catalog);
					allRecords.push(full);
				}

				nextToken = result.nextToken;

				logger.info("Engagements batch done", {
					batch: result.engagements.length,
					total: allRecords.length,
				});
			} while (nextToken);
		}

		if (entityType === "engagement-invitations") {
			let nextToken: string | undefined;

			do {
				let result;

				try {
					result = await repo.listEngagementInvitations(
						catalog,
						"RECEIVER",
						100,
						nextToken,
					);
				} catch (e) {
					logError("listEngagementInvitations failed", e);
					throw e;
				}

				for (const inv of result.invitations) {
					const full = await repo.getEngagementInvitation(inv.Id, catalog);
					allRecords.push(full);
				}

				nextToken = result.nextToken;

				logger.info("Invitations batch done", {
					batch: result.invitations.length,
					total: allRecords.length,
				});
			} while (nextToken);
		}

		const timestamp = new Date().toISOString();
		const s3Key = `partner-central-${entityType}/${timestamp}/${entityType}.json`;

		await s3Client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: s3Key,
				Body: JSON.stringify(
					{
						syncedAt: timestamp,
						totalRecords: allRecords.length,
						entity: entityType,
						catalog,
						records: allRecords,
					},
					null,
					2,
				),
				ContentType: "application/json",
			}),
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
							completed_at: timestamp,
							records_ingested: allRecords.length,
							s3Key,
							bucket: bucketName,
						}),
					},
				],
			}),
		);

		logger.info("Ingestion completed", {
			entityType,
			totalIngested: allRecords.length,
			s3Key,
		});

		return ok({
			success: true,
			entity: entityType,
			totalIngested: allRecords.length,
			s3Key,
			bucket: bucketName,
			message: `Successfully ingested ${allRecords.length} ${entityType}`,
		});
	} catch (e: any) {
		logger.error("Partner Central ingest error:", {
			message: e.message,
			stack: e.stack,
			code: e.code,
			name: e.name,
		});

		return err(e?.message ?? "Internal server error", 500);
	}
};
