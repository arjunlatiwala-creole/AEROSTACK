import { z } from "zod";

const integrationStatusEnum = z.enum([
	"active",
	"inactive",
	"synced",
	"syncing",
	"failed",
	"connected",
]);
export const IntegrationSchema = z.object({
	integration_id: z.string(),
	integration_type: z.string(),
	display_name: z.string(),
	description: z.string(),
	status: integrationStatusEnum,
	enabled: z.boolean(),
	auth_type: z.string(),
	auth_status: z.boolean(),
	secrets_arn: z.string(),
	auth_expires_at: z.string(),
	sync_enabled: z.boolean(),
	sync_frequency_minutes: z.number(),
	last_sync_at: z.string(),
	next_sync_at: z.string(),
	total_syncs: z.number(),
	successful_syncs: z.number(),
	failed_syncs: z.number(),
	consecutive_failures: z.number(),
	settings: z.record(z.string(), z.unknown()).optional(),
	created_at: z.string(),
	updated_at: z.string(),
	created_by: z.string(),
	updated_by: z.string(),
});

export type Integration = z.infer<typeof IntegrationSchema>;

export const directionEnum = z.enum(["inbound", "outbound"]);
export const syncTypeEnum = z.enum(["manual", "scheduled"]);
export const syncStatusEnum = z.enum([
	"pending",
	"in_progress",
	"succeeded",
	"failed",
	"partial_success",
	"cancelled",
	"timed_out",
]);

export const IntegrationSyncHistorySchema = z.object({
	integration_id: z.string(),
	sync_timestamp: z.string(),
	sync_id: z.string(),
	sync_type: z.string(),
	direction: directionEnum,
	started_at: z.string(),
	completed_at: z.string(),
	duration_ms: z.number(),
	status: syncStatusEnum,
	records_processed: z.number(),
	records_failed: z.number(),
	error_summary: z.string(),
	ttl: z.number(),
});

export type IntegrationSyncHistory = z.infer<
	typeof IntegrationSyncHistorySchema
>;

export const CreateIntegrationSyncHistoryInputSchema =
	IntegrationSyncHistorySchema.pick({
		integration_id: true,
		sync_timestamp: true,
		sync_id: true,
		sync_type: true,
		direction: true,
		started_at: true,
		status: true,
	});

export type CreateIntegrationSyncHistoryInput = z.infer<
	typeof CreateIntegrationSyncHistoryInputSchema
>;

export const operationEnum = z.enum(["create", "update", "delete", "skip", "upsert"]);

export type operationEnum = z.infer<typeof operationEnum>;

export const syncDetailStatusEnum = z.enum(["success", "failure"]);

export type syncDetailStatusEnum = z.infer<typeof syncDetailStatusEnum>;

export const IntegrationSyncDetailsSchema = z.object({
	sync_id: z.string(),
	entity_type: z.string(),
	entity_id: z.string(),
	internal_id: z.string(),
	operation: operationEnum,
	changes: z.object({
		old: z.record(z.string(), z.unknown()),
		new: z.record(z.string(), z.unknown()),
	}),
	status: syncDetailStatusEnum,
	error: z.record(z.string(), z.unknown()),
	processed_at: z.string(),
	ttl: z.number(),
});

export type IntegrationSyncDetails = z.infer<
	typeof IntegrationSyncDetailsSchema
>;

export const CreateIntegrationInputSchema = IntegrationSchema.pick({
	integration_type: true,
	display_name: true,
	description: true,
	auth_type: true,
	enabled: true,
	sync_enabled: true,
	sync_frequency_minutes: true,
	settings: true,
});

export const UpdateIntegrationInputSchema = IntegrationSchema.pick({
	display_name: true,
	description: true,
	enabled: true,
	status: true,
	sync_enabled: true,
	sync_frequency_minutes: true,
	settings: true,
}).partial({
	display_name: true,
	description: true,
	enabled: true,
	status: true,
	sync_enabled: true,
	sync_frequency_minutes: true,
	settings: true,
});

export type CreateIntegrationInput = z.infer<
	typeof CreateIntegrationInputSchema
>;

export type UpdateIntegrationInput = z.infer<
	typeof UpdateIntegrationInputSchema
>;
