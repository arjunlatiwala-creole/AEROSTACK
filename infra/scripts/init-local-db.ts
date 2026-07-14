#!/usr/bin/env npx ts-node
/**
 * Initialize Local DynamoDB Tables
 * Run: pnpm run local:init
 *
 * Creates all tables defined in local-tables.ts
 * Safe to run multiple times - skips existing tables
 */

import {
	CreateTableCommand,
	DynamoDBClient,
	ListTablesCommand,
	ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { LOCAL_TABLES } from "./local-tables";

const ENDPOINT = process.env.DYNAMODB_LOCAL_ENDPOINT || "http://localhost:8000";

const client = new DynamoDBClient({
	endpoint: ENDPOINT,
	region: "local",
	credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

async function getExistingTables(): Promise<Set<string>> {
	const response = await client.send(new ListTablesCommand({}));
	return new Set(response.TableNames || []);
}

async function createTable(
	table: (typeof LOCAL_TABLES)[number],
): Promise<void> {
	try {
		await client.send(
			new CreateTableCommand({
				...table,
				BillingMode: "PAY_PER_REQUEST",
			}),
		);
		console.log(`✅ Created table: ${table.TableName}`);
	} catch (error) {
		if (error instanceof ResourceInUseException) {
			console.log(`⏭️  Table already exists: ${table.TableName}`);
		} else {
			throw error;
		}
	}
}

async function main() {
	console.log(`\n🚀 Initializing Local DynamoDB at ${ENDPOINT}\n`);

	const existingTables = await getExistingTables();
	console.log(`Found ${existingTables.size} existing tables\n`);

	for (const table of LOCAL_TABLES) {
		await createTable(table);
	}

	console.log(`\n✨ Done! ${LOCAL_TABLES.length} tables configured.\n`);

	// Show summary
	const finalTables = await getExistingTables();
	console.log("Current tables:");
	finalTables.forEach((t) => {
		console.log(`  - ${t}`);
	});
}

main().catch((error) => {
	console.error("❌ Failed to initialize tables:", error.message);
	process.exit(1);
});
