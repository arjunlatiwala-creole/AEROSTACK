export interface Integration {
	integration_id: string;
	integration_type: string;
	display_name: string;
	description: string;
	status: string;
	enabled: boolean;
	sync_enabled: boolean;
	sync_frequency_minutes: number;
	auth_type: string;
	auth_status: boolean;
	auth_expires_at: string | null;
	secrets_arn: string | null;
	settings: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	created_by: string;
	updated_by: string;
	last_sync_at: string | null;
	next_sync_at: string | null;
	total_syncs: number;
	successful_syncs: number;
	failed_syncs: number;
	consecutive_failures: number;
}

export interface IntegrationSyncHistory {
	sync_id: string;
	integration_id: string;
	sync_type: string;
	sync_timestamp: string;
	started_at: string;
	completed_at: string;
	duration_ms: number;
	status: string;
	direction: string;
	records_processed: number;
	records_failed: number;
	error_summary: string | null;
	ttl: number;
}

export interface IntegrationSyncDetail {
	sync_id: string;
	entity_type: string;
	entity_id: string;
	internal_id: string;
	operation: string;
	changes: {
		old: Record<string, unknown>;
		new: Record<string, unknown>;
	};
	status: string;
	error: Record<string, unknown>;
	processed_at: string;
	ttl: number;
}

export interface SyncHistoryResponse {
	success: boolean;
	data: {
		integration_id: string;
		items: IntegrationSyncHistory[];
		nextToken?: string;
		hasMore: boolean;
	};
}

export interface SyncDetailsResponse {
	success: boolean;
	data: {
		sync_id: string;
		items: IntegrationSyncDetail[];
		nextToken?: string;
		hasMore: boolean;
	};
}

export interface IntegrationsListResponse {
	success: boolean;
	data: {
		items: Integration[];
		total: number;
		hasMore: boolean;
	};
}
