/**
 * Sync History Helper Functions
 * Wraps IntegrationSyncHistoryRepository for common sync operations
 * No modifications to existing schemas or repository code required
 */

import type {
	IntegrationRepository,
	IntegrationSyncDetailsRepository,
	IntegrationSyncHistoryRepository,
} from "src/repos/integration.repository";
import type {
	IntegrationSyncDetails,
	IntegrationSyncHistory,
	operationEnum,
} from "src/shared/validation/integrations.schema";

/**
 * Initialize a new sync operation
 * Creates a sync history record with status "in_progress"
 *
 * @param repository - IntegrationSyncHistoryRepository instance
 * @param integrationId - Integration ID
 * @param syncId - Unique sync ID (usually UUID)
 * @param integrationType - Type of integration (e.g., "hubspot", "salesforce")
 * @param options - Additional options
 * @returns Created sync history record
 *
 * @example
 * const syncId = crypto.randomUUID();
 * const syncHistory = await initializeSyncHistory(
 *   syncHistoryRepo,
 *   "int_123",
 *   syncId,
 *   "hubspot",
 *   { manual_trigger: true }
 * );
 */
export async function initializeSyncHistory(
	repository: IntegrationSyncHistoryRepository,
	integrationId: string,
	syncId: string,
	options: {
		manual_trigger?: boolean;
		direction?: "inbound" | "outbound";
	} = {},
): Promise<IntegrationSyncHistory> {
	const now = new Date().toISOString();

	const syncHistory: IntegrationSyncHistory = {
		integration_id: integrationId,
		sync_timestamp: now,
		sync_id: syncId,
		sync_type: options.manual_trigger ? "manual" : "scheduled",
		direction: options.direction || "inbound",
		started_at: now,
		completed_at: "",
		duration_ms: 0,
		status: "in_progress",
		records_processed: 0,
		records_failed: 0,
		error_summary: "",
		ttl: createTTL(),
	};

	return await repository.createSyncHistory(syncHistory);
}

/**
 * Complete a sync operation
 * Updates the sync history record with final results
 *
 * @param repository - IntegrationSyncHistoryRepository instance
 * @param integrationId - Integration ID
 * @param syncId - Sync ID
 * @param results - Sync completion results
 * @returns Updated sync history record
 *
 * @example
 * await completeSyncHistory(
 *   syncHistoryRepo,
 *   "int_123",
 *   syncId,
 *   {
 *     records_processed: 1000,
 *     records_failed: 5,
 *     start_time: startTime,
 *     error_summary: "5 records failed validation"
 *   }
 * );
 */
export async function completeSyncHistory(
	repository: IntegrationSyncHistoryRepository,
	integrationId: string,
	syncId: string,
	results: {
		records_processed: number;
		records_failed: number;
		start_time: number; // timestamp from Date.now()
		error_summary?: string;
	},
): Promise<IntegrationSyncHistory> {
	const completedAt = new Date().toISOString();
	const durationMs = Date.now() - results.start_time;

	const status =
		results.records_failed === 0
			? "succeeded"
			: results.records_failed === results.records_processed
				? "failed"
				: "partial_success";

	const updates: Partial<IntegrationSyncHistory> = {
		status: status,
		completed_at: completedAt,
		duration_ms: durationMs,
		records_processed: results.records_processed,
		records_failed: results.records_failed,
		error_summary: results.error_summary || "",
	};

	return await repository.updateSyncHistory(integrationId, syncId, updates);
}

/**
 * Update integration's last_sync_at timestamp
 *
 * @param repository - IntegrationRepository instance
 * @param integrationId - Integration ID
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns Updated integration record
 *
 * @example
 * await updateIntegrationLastSync(integrationRepo, "int_123");
 */
export async function updateIntegrationLastSync(
	repository: IntegrationRepository,
	integrationId: string,
	timestamp?: string,
) {
	const lastSyncAt = timestamp || new Date().toISOString();

	return await repository.updateIntegration(integrationId, {
		last_sync_at: lastSyncAt,
	});
}

/**
 * Helper class that wraps both repositories for easier sync tracking
 * Use this in your sync orchestrator for cleaner code
 *
 * @example
 * const tracker = new SyncHistoryTracker(
 *   syncHistoryRepo,
 *   syncDetailsRepo,
 *   integrationRepo,
 *   "int_123",
 *   syncId
 * );
 *
 * await tracker.initialize("hubspot");
 * await tracker.recordSuccess(...);
 * await tracker.recordFailure(...);
 * await tracker.complete(processed, failed, startTime);
 */
export class SyncHistoryTracker {
	private integrationId: string;
	private syncId: string;
	private historyRepo: IntegrationSyncHistoryRepository;
	private detailsRepo: IntegrationSyncDetailsRepository;
	private integrationRepo: IntegrationRepository;

	constructor(
		integrationRepository: IntegrationRepository,
		historyRepository: IntegrationSyncHistoryRepository,
		detailsRepository: IntegrationSyncDetailsRepository,

		integrationId: string,
		syncId: string,
	) {
		this.historyRepo = historyRepository;
		this.detailsRepo = detailsRepository;
		this.integrationRepo = integrationRepository;
		this.integrationId = integrationId;
		this.syncId = syncId;
	} 

	/**
	 * Initialize sync tracking
	 */
	async initialize(
		options: {
			manual_trigger?: boolean;
			direction?: "inbound" | "outbound";
		} = {},
	): Promise<IntegrationSyncHistory> {
		return await initializeSyncHistory(
			this.historyRepo,
			this.integrationId,
			this.syncId,
			options,
		);
	}

	/**
	 * Record a successful sync operation
	 */
	async recordSuccess(
		entityType: string,
		entityId: string,
		internalId: string,
		operation: operationEnum,
		changes: {
			old: Record<string, unknown>;
			new: Record<string, unknown>;
		},
	): Promise<IntegrationSyncDetails> {
		const now = new Date().toISOString();

		const detail: IntegrationSyncDetails = {
			sync_id: this.syncId,
			entity_type: entityType,
			entity_id: entityId,
			internal_id: internalId,
			operation: operation,
			changes: changes,
			status: "success",
			error: {},
			processed_at: now,
			ttl: createTTL(),
		};

		return await this.detailsRepo.createSyncDetail(detail);
	}

	/**
	 * Record a failed sync operation
	 */
	async recordFailure(
		entityType: string,
		entityId: string,
		operation: operationEnum,
		error: Error | { message: string; code?: string },
	): Promise<IntegrationSyncDetails> {
		const now = new Date().toISOString();

		const detail: IntegrationSyncDetails = {
			sync_id: this.syncId,
			entity_type: entityType,
			entity_id: entityId,
			internal_id: "",
			operation: operation,
			changes: {
				old: {},
				new: {},
			},
			status: "failure",
			error: {
				message: error.message,
				code: "code" in error ? error.code : "SYNC_ERROR",
				stack: error instanceof Error ? error.stack : undefined,
			},
			processed_at: now,
			ttl: createTTL(),
		};

		return await this.detailsRepo.createSyncDetail(detail);
	}

	/**
	 * Batch record multiple sync details
	 */
	async recordBatch(details: IntegrationSyncDetails[]): Promise<void> {
		await this.detailsRepo.batchCreateSyncDetails(details);
	}

	/**
	 * Complete the sync operation
	 * Optionally updates the integration's last_sync_at timestamp
	 */
	async complete(
		recordsProcessed: number,
		recordsFailed: number,
		startTime: number,
		errorSummary?: string,
		updateLastSync: boolean = true,
	): Promise<IntegrationSyncHistory> {
		const syncHistory = await completeSyncHistory(
			this.historyRepo,
			this.integrationId,
			this.syncId,
			{
				records_processed: recordsProcessed,
				records_failed: recordsFailed,
				start_time: startTime,
				error_summary: errorSummary,
			},
		);

		if (updateLastSync && this.integrationRepo) {
			try {
				await updateIntegrationLastSync(
					this.integrationRepo,
					this.integrationId,
				);
			} catch (error) {
				console.error("Failed to update integration last_sync_at:", error);
				// Don't throw - sync completion is more important
			}
		}

		return syncHistory;
	}

	/**
	 * Manually update the integration's last_sync_at timestamp
	 */
	async updateLastSync(timestamp?: string): Promise<void> {
		if (!this.integrationRepo) {
			throw new Error(
				"IntegrationRepository not provided to SyncHistoryTracker",
			);
		}

		await updateIntegrationLastSync(
			this.integrationRepo,
			this.integrationId,
			timestamp,
		);
	}
}

export const createTTL = (ttlDays: number = 365): number => {
	return Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
};
