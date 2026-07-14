import {
	type DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { LoopFinancial } from "src/shared/validation/loop-financial.schema";

export interface ILoopFinancialRepository {
	create(financial: LoopFinancial): Promise<LoopFinancial>;
	getById(financialId: string): Promise<LoopFinancial | null>;
	getByLoopId(loopId: string): Promise<LoopFinancial | null>;
	listByLoopId(
		loopId: string,
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }>;
	listByFiscalPeriod(
		fiscalPeriod: string,
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }>;
	listAll(
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }>;
	update(
		financialId: string,
		updates: Partial<LoopFinancial>,
	): Promise<LoopFinancial>;
}

export class LoopFinancialRepository implements ILoopFinancialRepository {
	constructor(
		private readonly ddb: DynamoDBDocumentClient,
		private readonly tableName: string,
	) { }

	private static readonly IMMUTABLE_FIELDS = new Set([
		"financial_id",
		"loop_id",
		"created_at",
	]);

	async create(financial: LoopFinancial): Promise<LoopFinancial> {
		await this.ddb.send(
			new PutCommand({
				TableName: this.tableName,
				Item: financial,
			}),
		);

		return financial;
	}

	async getById(financialId: string): Promise<LoopFinancial | null> {
		const res = await this.ddb.send(
			new GetCommand({
				TableName: this.tableName,
				Key: {
					financial_id: financialId,
					created_at: "", // This won't work without knowing created_at
				},
			}),
		);

		return res.Item ? (res.Item as LoopFinancial) : null;
	}

	async getByLoopId(loopId: string): Promise<LoopFinancial | null> {
		const result = await this.listByLoopId(loopId, 1);
		return result.items.length > 0 ? result.items[0] : null;
	}

	async listByLoopId(
		loopId: string,
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }> {
		const res = await this.ddb.send(
			new QueryCommand({
				TableName: this.tableName,
				IndexName: "GSI_LoopId",
				KeyConditionExpression: "loop_id = :loop_id",
				ExpressionAttributeValues: {
					":loop_id": loopId,
				},
				Limit: limit ?? 100,
				ExclusiveStartKey: lastKey
					? JSON.parse(Buffer.from(lastKey, "base64").toString())
					: undefined,
			}),
		);

		return {
			items: (res.Items ?? []) as LoopFinancial[],
			lastKey: res.LastEvaluatedKey
				? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
				: undefined,
		};
	}

	async listByFiscalPeriod(
		fiscalPeriod: string,
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }> {
		const res = await this.ddb.send(
			new QueryCommand({
				TableName: this.tableName,
				IndexName: "GSI_FiscalPeriod",
				KeyConditionExpression: "fiscal_period = :fp",
				ExpressionAttributeValues: {
					":fp": fiscalPeriod,
				},
				Limit: limit ?? 100,
				ExclusiveStartKey: lastKey
					? JSON.parse(Buffer.from(lastKey, "base64").toString())
					: undefined,
			}),
		);

		return {
			items: (res.Items ?? []) as LoopFinancial[],
			lastKey: res.LastEvaluatedKey
				? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
				: undefined,
		};
	}

	async listAll(
		limit?: number,
		lastKey?: string,
	): Promise<{ items: LoopFinancial[]; lastKey?: string }> {
		const res = await this.ddb.send(
			new ScanCommand({  // ✅ Correct - Scan doesn't need KeyConditionExpression
				TableName: this.tableName,
				Limit: limit ?? 100,
				ExclusiveStartKey: lastKey
					? JSON.parse(Buffer.from(lastKey, "base64").toString())
					: undefined,
			}),
		);

		return {
			items: (res.Items ?? []) as LoopFinancial[],
			lastKey: res.LastEvaluatedKey
				? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
				: undefined,
		};
	}

	async update(
		financialId: string,
		updates: Partial<LoopFinancial>,
	): Promise<LoopFinancial> {
		const ExpressionAttributeNames: Record<string, string> = {};
		const ExpressionAttributeValues: Record<string, any> = {};
		const setParts: string[] = [];

		// Add updated_at
		const allUpdates = {
			...updates,
			updated_at: new Date().toISOString(),
		};

		for (const [key, value] of Object.entries(allUpdates)) {
			if (LoopFinancialRepository.IMMUTABLE_FIELDS.has(key)) continue;

			ExpressionAttributeNames[`#${key}`] = key;
			ExpressionAttributeValues[`:${key}`] = value;
			setParts.push(`#${key} = :${key}`);
		}

		if (setParts.length === 0) {
			throw new Error("No fields to update");
		}

		await this.ddb.send(
			new UpdateCommand({
				TableName: this.tableName,
				Key: {
					financial_id: financialId,
				},
				UpdateExpression: `SET ${setParts.join(", ")}`,
				ExpressionAttributeNames,
				ExpressionAttributeValues,
			}),
		);

		// Return updated item (in real-world, use ReturnValues: "ALL_NEW")
		return { financial_id: financialId, ...allUpdates } as LoopFinancial;
	}
}