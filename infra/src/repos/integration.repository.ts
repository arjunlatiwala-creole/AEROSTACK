import {
	DeleteCommand,
	type DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
	IntegrationSchema,
	IntegrationSyncDetailsSchema,
	IntegrationSyncHistorySchema,
} from "src/shared/validation/integrations.schema";
import type { z } from "zod";

type Integration = z.infer<typeof IntegrationSchema>;
type IntegrationSyncHistory = z.infer<typeof IntegrationSyncHistorySchema>;
type IntegrationSyncDetails = z.infer<typeof IntegrationSyncDetailsSchema>;

export interface PaginationOptions {
	limit?: number;
	nextToken?: string;
}

export interface PaginatedResponse<T> {
	items: T[];
	nextToken?: string;
	hasMore: boolean;
	total?: number;
}

export interface ListIntegrationsOptions extends PaginationOptions {
	integration_type?: string;
	status?: string;
	enabled?: boolean;
}

/**
 * Repository for Integration operations
 */
export class IntegrationRepository {
	constructor(
		private readonly docClient: DynamoDBDocumentClient,
		private readonly tableName: string,
	) {}

	/**
	 * Get integration by ID
	 */
	async getIntegrationById(id: string): Promise<Integration | null> {
		const command = new GetCommand({
			TableName: this.tableName,
			Key: {
				integration_id: id,
			},
		});

		const result = await this.docClient.send(command);
		return (result.Item as Integration) || null;
	}

	/**
	 * Create a new integration
	 */
	async createIntegration(integration: Integration): Promise<Integration> {
		const existing = await this.getIntegrationById(integration.integration_id);
		if (existing) {
			throw new Error(
				`Integration with ID ${integration.integration_id} already exists`,
			);
		}

		const now = new Date().toISOString();
		const item: Integration = {
			...integration,
			created_at: now,
			updated_at: now,
			// Set GSI attributes for querying
			GSI1PK: `TYPE#${integration.integration_type}`,
			GSI1SK: `STATUS#${integration.status}#${now}`,
		} as Integration;

		const command = new PutCommand({
			TableName: this.tableName,
			Item: item,
			ConditionExpression: "attribute_not_exists(integration_id)",
		});

		await this.docClient.send(command);
		return item;
	}

	/**
	 * Update an existing integration
	 * Uses UpdateCommand for partial updates
	 */
	async updateIntegration(
		id: string,
		updates: Partial<Integration>,
	): Promise<Integration> {
		const existing = await this.getIntegrationById(id);
		if (!existing) {
			throw new Error(`Integration with ID ${id} not found`);
		}

		const now = new Date().toISOString();

		// Build update expression
		const updateExpressions: string[] = [];
		const expressionAttributeNames: Record<string, string> = {};
		const expressionAttributeValues: Record<string, any> = {};

		// Add updated_at
		updateExpressions.push("#updated_at = :updated_at");
		expressionAttributeNames["#updated_at"] = "updated_at";
		expressionAttributeValues[":updated_at"] = now;

		// Process each update field
		Object.entries(updates).forEach(([key, value]) => {
			if (
				key !== "integration_id" &&
				key !== "created_at" &&
				value !== undefined
			) {
				const placeholder = `#${key}`;
				const valuePlaceholder = `:${key}`;

				updateExpressions.push(`${placeholder} = ${valuePlaceholder}`);
				expressionAttributeNames[placeholder] = key;
				expressionAttributeValues[valuePlaceholder] = value;
			}
		});

		// Update GSI attributes if type or status changed
		if (updates.integration_type || updates.status) {
			const newType = updates.integration_type || existing.integration_type;
			const newStatus = updates.status || existing.status;

			updateExpressions.push("#GSI1PK = :GSI1PK");
			updateExpressions.push("#GSI1SK = :GSI1SK");

			expressionAttributeNames["#GSI1PK"] = "GSI1PK";
			expressionAttributeNames["#GSI1SK"] = "GSI1SK";

			expressionAttributeValues[":GSI1PK"] = `TYPE#${newType}`;
			expressionAttributeValues[":GSI1SK"] = `STATUS#${newStatus}#${now}`;
		}

		const command = new UpdateCommand({
			TableName: this.tableName,
			Key: {
				integration_id: id,
			},
			UpdateExpression: `SET ${updateExpressions.join(", ")}`,
			ExpressionAttributeNames: expressionAttributeNames,
			ExpressionAttributeValues: expressionAttributeValues,
			ConditionExpression: "attribute_exists(integration_id)",
			ReturnValues: "ALL_NEW",
		});

		const result = await this.docClient.send(command);
		return result.Attributes as Integration;
	}

	/**
	 * Delete an integration
	 */
	async deleteIntegration(id: string): Promise<void> {
		const command = new DeleteCommand({
			TableName: this.tableName,
			Key: {
				integration_id: id,
			},
			ConditionExpression: "attribute_exists(integration_id)",
		});

		try {
			await this.docClient.send(command);
		} catch (error: any) {
			if (error.name === "ConditionalCheckFailedException") {
				throw new Error(`Integration with ID ${id} not found`);
			}
			throw error;
		}
	}

	/**
	 * List all integrations with optional filters and pagination
	 */
	async listIntegrations(
		options: ListIntegrationsOptions = {},
	): Promise<PaginatedResponse<Integration>> {
		const {
			limit = 50,
			nextToken,
			integration_type,
			status,
			enabled,
		} = options;

		// If filtering by type, use GSI1
		if (integration_type) {
			return this.listByType(integration_type, { limit, nextToken, status });
		}

		// Otherwise, use Scan with filters
		const filterExpressions: string[] = [];
		const expressionAttributeNames: Record<string, string> = {};
		const expressionAttributeValues: Record<string, any> = {};

		if (status) {
			filterExpressions.push("#status = :status");
			expressionAttributeNames["#status"] = "status";
			expressionAttributeValues[":status"] = status;
		}

		if (enabled !== undefined) {
			filterExpressions.push("#enabled = :enabled");
			expressionAttributeNames["#enabled"] = "enabled";
			expressionAttributeValues[":enabled"] = enabled;
		}

		const command = new ScanCommand({
			TableName: this.tableName,
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
			FilterExpression:
				filterExpressions.length > 0
					? filterExpressions.join(" AND ")
					: undefined,
			ExpressionAttributeNames:
				Object.keys(expressionAttributeNames).length > 0
					? expressionAttributeNames
					: undefined,
			ExpressionAttributeValues:
				Object.keys(expressionAttributeValues).length > 0
					? expressionAttributeValues
					: undefined,
		});

		const [scanResult, countResult] = await Promise.all([
			this.docClient.send(command),
			this.getTotalCount(),
		]);
		return {
			items: (scanResult.Items as Integration[]) || [],
			total: countResult,
			nextToken: scanResult.LastEvaluatedKey
				? JSON.stringify(scanResult.LastEvaluatedKey)
				: undefined,
			hasMore: !!scanResult.LastEvaluatedKey,
		};
	}

	async getTotalCount(): Promise<number> {
		const command = new ScanCommand({
			TableName: this.tableName,
			Select: "COUNT",
		});
		const result = await this.docClient.send(command);
		return result.Count!;
	}

	/**
	 * List integrations by type using GSI1
	 */
	private async listByType(
		integrationType: string,
		options: PaginationOptions & { status?: string } = {},
	): Promise<PaginatedResponse<Integration>> {
		const { limit = 50, nextToken, status } = options;

		const keyConditionExpression = status
			? "GSI1PK = :pk AND begins_with(GSI1SK, :sk_prefix)"
			: "GSI1PK = :pk";

		const expressionAttributeValues: Record<string, string> = {
			":pk": `TYPE#${integrationType}`,
		};

		if (status) {
			expressionAttributeValues[":sk_prefix"] = `STATUS#${status}`;
		}

		const command = new QueryCommand({
			TableName: this.tableName,
			IndexName: "GSI1",
			KeyConditionExpression: keyConditionExpression,
			ExpressionAttributeValues: expressionAttributeValues,
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
			ScanIndexForward: false, // Most recent first
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as Integration[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get integrations by status (useful for monitoring)
	 */
	async getIntegrationsByStatus(
		status: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<Integration>> {
		const { limit = 50, nextToken } = options;

		const command = new ScanCommand({
			TableName: this.tableName,
			FilterExpression: "#status = :status",
			ExpressionAttributeNames: {
				"#status": "status",
			},
			ExpressionAttributeValues: {
				":status": status,
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as Integration[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get integrations requiring sync (enabled + sync_enabled)
	 */
	async getIntegrationsDueForSync(): Promise<Integration[]> {
		const now = new Date().toISOString();

		const command = new ScanCommand({
			TableName: this.tableName,
			FilterExpression:
				"#enabled = :enabled AND #sync_enabled = :sync_enabled AND #next_sync_at <= :now",
			ExpressionAttributeNames: {
				"#enabled": "enabled",
				"#sync_enabled": "sync_enabled",
				"#next_sync_at": "next_sync_at",
			},
			ExpressionAttributeValues: {
				":enabled": true,
				":sync_enabled": true,
				":now": now,
			},
		});

		const result = await this.docClient.send(command);
		return (result.Items as Integration[]) || [];
	}
}

/**
 * Repository for Integration Sync History operations
 */
export class IntegrationSyncHistoryRepository {
	constructor(
		private readonly docClient: DynamoDBDocumentClient,
		private readonly tableName: string,
	) {}

	/**
	 * Create a new sync history record
	 */
	async createSyncHistory(
		history: IntegrationSyncHistory,
	): Promise<IntegrationSyncHistory> {
		const item: IntegrationSyncHistory = {
			...history,
			PK: history.integration_id,
			SK: `SYNC#${history.sync_timestamp}#${history.sync_id}`,
			// GSI1 for querying by type
			GSI1PK: `TYPE#${history.sync_type || "FULL"}`,
			GSI1SK: `SYNC#${history.sync_timestamp}`,
			// GSI2 for querying by status
			GSI2PK: `STATUS#${history.status}`,
			GSI2SK: `SYNC#${history.sync_timestamp}`,
		} as IntegrationSyncHistory;

		const command = new PutCommand({
			TableName: this.tableName,
			Item: item,
		});

		await this.docClient.send(command);
		return item;
	}

	/**
	 * Get sync history for a specific integration with pagination
	 */
	async getSyncHistoryByIntegrationId(
		integrationId: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncHistory>> {
		const { limit = 50, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": integrationId,
				":sk_prefix": "SYNC#",
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
			ScanIndexForward: false, // Most recent first
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as IntegrationSyncHistory[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get a specific sync history record
	 */
	async getSyncHistoryById(
		integrationId: string,
		syncId: string,
	): Promise<IntegrationSyncHistory | null> {
		const command = new QueryCommand({
			TableName: this.tableName,
			KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": integrationId,
				":sk_prefix": `SYNC#`,
			},
			Limit: 100,
		});

		const result = await this.docClient.send(command);

		const match = result.Items?.find((item) =>
			(item.SK as string).endsWith(syncId),
		);

		return match ? (match as IntegrationSyncHistory) : null;
	}

	/**
	 * Get sync history by status
	 */
	async getSyncHistoryByStatus(
		status: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncHistory>> {
		const { limit = 50, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			IndexName: "GSI2",
			KeyConditionExpression:
				"GSI2PK = :pk AND begins_with(GSI2SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": `STATUS#${status}`,
				":sk_prefix": "SYNC#",
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
			ScanIndexForward: false,
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as IntegrationSyncHistory[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Update sync history (e.g., when sync completes)
	 */
	async updateSyncHistory(
		integrationId: string,
		syncId: string,
		updates: Partial<IntegrationSyncHistory>,
	): Promise<IntegrationSyncHistory> {
		// First, get the record to find the exact SK
		const existing: any = await this.getSyncHistoryById(integrationId, syncId);
		if (!existing) {
			throw new Error(
				`Sync history not found for integration ${integrationId} and sync ${syncId}`,
			);
		}

		const updateExpressions: string[] = [];
		const expressionAttributeNames: Record<string, string> = {};
		const expressionAttributeValues: Record<string, any> = {};

		Object.entries(updates).forEach(([key, value]) => {
			if (key !== "PK" && key !== "SK" && value !== undefined) {
				const placeholder = `#${key}`;
				const valuePlaceholder = `:${key}`;

				updateExpressions.push(`${placeholder} = ${valuePlaceholder}`);
				expressionAttributeNames[placeholder] = key;
				expressionAttributeValues[valuePlaceholder] = value;
			}
		});

		// Update GSI2 if status changed
		if (updates.status) {
			updateExpressions.push("#GSI2PK = :GSI2PK");
			expressionAttributeNames["#GSI2PK"] = "GSI2PK";
			expressionAttributeValues[":GSI2PK"] = `STATUS#${updates.status}`;
		}

		const command = new UpdateCommand({
			TableName: this.tableName,
			Key: {
				PK: existing.PK,
				SK: existing.SK,
			},
			UpdateExpression: `SET ${updateExpressions.join(", ")}`,
			ExpressionAttributeNames: expressionAttributeNames,
			ExpressionAttributeValues: expressionAttributeValues,
			ReturnValues: "ALL_NEW",
		});

		const result = await this.docClient.send(command);
		return result.Attributes as IntegrationSyncHistory;
	}

	/**
	 * Get recent sync history across all integrations
	 */
	async getRecentSyncHistory(
		limit: number = 50,
	): Promise<IntegrationSyncHistory[]> {
		const command = new ScanCommand({
			TableName: this.tableName,
			Limit: limit,
		});

		const result = await this.docClient.send(command);
		const items = (result.Items as IntegrationSyncHistory[]) || [];

		// Sort by timestamp descending
		return items.sort((a, b) =>
			b.sync_timestamp.localeCompare(a.sync_timestamp),
		);
	}
}

/**
 * Repository for Integration Sync Details operations
 */
export class IntegrationSyncDetailsRepository {
	constructor(
		private readonly docClient: DynamoDBDocumentClient,
		private readonly tableName: string,
	) {}

	/**
	 * Create sync detail record
	 */
	async createSyncDetail(
		detail: IntegrationSyncDetails,
	): Promise<IntegrationSyncDetails> {
		const item: IntegrationSyncDetails = {
			...detail,
			PK: detail.sync_id,
			SK: `ENTITY#${detail.entity_type}#${detail.entity_id}`,
			// GSI1 for error tracking
			GSI1PK: detail.error ? `ERROR#${detail.status}` : `SUCCESS`,
			GSI1SK: `ENTITY#${detail.entity_type}#${detail.processed_at}`,
		} as IntegrationSyncDetails;

		const command = new PutCommand({
			TableName: this.tableName,
			Item: item,
		});

		await this.docClient.send(command);
		return item;
	}

	/**
	 * Get sync details for a specific sync with pagination
	 */
	async getSyncDetailsBySyncId(
		syncId: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncDetails>> {
		const { limit = 100, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": syncId,
				":sk_prefix": "ENTITY#",
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
		});

		const result = await this.docClient.send(command);
		console.log("result", result);

		return {
			items: (result.Items as IntegrationSyncDetails[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get failed sync details for a specific sync
	 */
	async getFailedSyncDetails(
		syncId: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncDetails>> {
		const { limit = 100, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
			FilterExpression: "#status = :status",
			ExpressionAttributeNames: {
				"#status": "status",
			},
			ExpressionAttributeValues: {
				":pk": syncId,
				":sk_prefix": "ENTITY#",
				":status": "FAILED",
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as IntegrationSyncDetails[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get sync details by entity type
	 */
	async getSyncDetailsByEntityType(
		syncId: string,
		entityType: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncDetails>> {
		const { limit = 100, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": syncId,
				":sk_prefix": `ENTITY#${entityType}#`,
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as IntegrationSyncDetails[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Get errors across all syncs using GSI1
	 */
	async getErrorsByStatus(
		status: string,
		options: PaginationOptions = {},
	): Promise<PaginatedResponse<IntegrationSyncDetails>> {
		const { limit = 100, nextToken } = options;

		const command = new QueryCommand({
			TableName: this.tableName,
			IndexName: "GSI1",
			KeyConditionExpression:
				"GSI1PK = :pk AND begins_with(GSI1SK, :sk_prefix)",
			ExpressionAttributeValues: {
				":pk": `ERROR#${status}`,
				":sk_prefix": "ENTITY#",
			},
			Limit: limit,
			ExclusiveStartKey: nextToken ? JSON.parse(nextToken) : undefined,
			ScanIndexForward: false,
		});

		const result = await this.docClient.send(command);

		return {
			items: (result.Items as IntegrationSyncDetails[]) || [],
			nextToken: result.LastEvaluatedKey
				? JSON.stringify(result.LastEvaluatedKey)
				: undefined,
			hasMore: !!result.LastEvaluatedKey,
		};
	}

	/**
	 * Batch create sync details (useful for bulk operations)
	 */
	async batchCreateSyncDetails(
		details: IntegrationSyncDetails[],
	): Promise<void> {
		// DynamoDB batch write supports up to 25 items per request
		const batchSize = 25;
		const batches: IntegrationSyncDetails[][] = [];

		for (let i = 0; i < details.length; i += batchSize) {
			batches.push(details.slice(i, i + batchSize));
		}

		// Process batches sequentially to avoid throttling
		for (const batch of batches) {
			const promises = batch.map((detail) => this.createSyncDetail(detail));
			await Promise.all(promises);
		}
	}
}

/**
 * Factory function to create all repositories
 */
export function createIntegrationRepositories(
	docClient: DynamoDBDocumentClient,
	tableNames: {
		integrations: string;
		syncHistory: string;
		syncDetails: string;
	},
) {
	return {
		integration: new IntegrationRepository(docClient, tableNames.integrations),
		syncHistory: new IntegrationSyncHistoryRepository(
			docClient,
			tableNames.syncHistory,
		),
		syncDetails: new IntegrationSyncDetailsRepository(
			docClient,
			tableNames.syncDetails,
		),
	};
}
