import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResult } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const logger = createLogger("ProcessIntegrationsRawHandler");
const ddb = ddbClient;

const _handler = async (event: any): Promise<APIGatewayProxyResult> => {
	logger.info("Process integrations raw handler called");

	const authResult = authorizeUser(event, UserRole.ENGINEER);
	if (isAuthError(authResult)) return authResult.error;

	const rawTable = process.env.INTEGRATIONS_RAW_TABLE_NAME;
	const dealsTable = process.env.DEALS_TABLE_NAME;
	const companiesTable = process.env.COMPANIES_TABLE_NAME;
	const contactsTable = process.env.CONTACTS_TABLE_NAME;

	if (!rawTable || !dealsTable || !companiesTable || !contactsTable) {
		return err("Server configuration error", 500);
	}

	const processed = { deals: 0, companies: 0, contacts: 0 };
	const skipped = { deals: 0, companies: 0, contacts: 0 };
	const skippedItems = {
		deals: [] as any[],
		companies: [] as any[],
		contacts: [] as any[],
	};
	let lastEvaluatedKey: any;

	try {
		do {
			const scanResult = await ddb.send(
				new ScanCommand({
					TableName: rawTable,
					ExclusiveStartKey: lastEvaluatedKey,
				}),
			);

			for (const item of scanResult.Items || []) {
				if (!item.entity || !item.payload) {
					logger.warn("Skipping raw item with missing entity/payload", item);
					continue;
				}

				let payloadObj: any;
				try {
					payloadObj =
						typeof item.payload === "string"
							? JSON.parse(item.payload)
							: item.payload;
				} catch (parseErr) {
					logger.error("Failed to parse payload", { item, parseErr });
					if (item.entity === "deal") {
						skipped.deals++;
						skippedItems.deals.push({
							id: item.id,
							reason: "Invalid JSON payload",
						});
					} else if (item.entity === "company") {
						skipped.companies++;
						skippedItems.companies.push({
							id: item.id,
							reason: "Invalid JSON payload",
						});
					} else if (item.entity === "contact") {
						skipped.contacts++;
						skippedItems.contacts.push({
							id: item.id,
							reason: "Invalid JSON payload",
						});
					}
					continue;
				}

				if (item.entity === "deal") {
					const stored = await storeDeal(payloadObj, dealsTable);
					if (stored) processed.deals++;
					else {
						skipped.deals++;
						skippedItems.deals.push({
							id: payloadObj.id,
							reason: "Missing required fields",
						});
					}
				}

				if (item.entity === "company") {
					const stored = await storeCompany(payloadObj, companiesTable);
					if (stored) processed.companies++;
					else {
						skipped.companies++;
						skippedItems.companies.push({
							id: payloadObj.id,
							reason: "Missing required fields",
						});
					}
				}

				if (item.entity === "contact") {
					const stored = await storeContact(payloadObj, contactsTable);
					if (stored) processed.contacts++;
					else {
						skipped.contacts++;
						skippedItems.contacts.push({
							id: payloadObj.id,
							reason: "Missing required fields",
						});
					}
				}
			}

			lastEvaluatedKey = scanResult.LastEvaluatedKey;
		} while (lastEvaluatedKey);

		return ok({
			message: "Raw data processed successfully",
			processed,
			skipped,
			skippedItems,
		});
	} catch (error: any) {
		logger.error("Failed to process raw data", { error });
		return err("Failed to process raw data", 500);
	}
};
export const handler = withPermissions(_handler);

/* =======================
   Helper Functions
======================= */

async function storeDeal(payload: any, tableName: string): Promise<boolean> {
	if (!payload.id || !payload.createdAt) return false;

	const dealItem = {
		dealId: payload.id,
		createdAt: payload.createdAt,
		stage: payload.stage,
		name: payload.name,
		amount: payload.amount,
		companyName: payload.companyName,
		contactEmail: payload.contactEmail,
		contactName: payload.contactName,
		ownerId: payload.ownerId,
		updatedAt: payload.updatedAt,
	};

	try {
		await ddb.send(new PutCommand({ TableName: tableName, Item: dealItem }));
		return true;
	} catch (err) {
		logger.error("Failed to write deal", { dealId: payload.id, err });
		return false;
	}
}

async function storeCompany(payload: any, tableName: string): Promise<boolean> {
	if (!payload.id || !payload.createdAt) return false;

	const companyItem = {
		companyId: payload.id,
		createdAt: payload.createdAt,
		domain: payload.domain,
		name: payload.name,
		industry: payload.industry,
		country: payload.country,
		state: payload.state,
		city: payload.city,
		updatedAt: payload.updatedAt,
	};

	try {
		await ddb.send(new PutCommand({ TableName: tableName, Item: companyItem }));
		return true;
	} catch (err) {
		logger.error("Failed to write company", { companyId: payload.id, err });
		return false;
	}
}

async function storeContact(payload: any, tableName: string): Promise<boolean> {
	if (!payload.id || !payload.createdAt) return false;

	const contactItem = {
		contactId: payload.id,
		createdAt: payload.createdAt,
		firstName: payload.firstName,
		lastName: payload.lastName,
		phone: payload.phone,
		companyName: payload.company,
		email: payload.email,
		updatedAt: payload.updatedAt,
	};

	try {
		await ddb.send(new PutCommand({ TableName: tableName, Item: contactItem }));
		return true;
	} catch (err) {
		logger.error("Failed to write contact", { contactId: payload.id, err });
		return false;
	}
}
