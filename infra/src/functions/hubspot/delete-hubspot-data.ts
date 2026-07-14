import type {
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    Context,
} from "aws-lambda";
import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";

interface DeleteResult {
    table: string;
    deletedCount: number;
}

/**
 * Scans a DynamoDB table and batch-deletes all items.
 * All target tables use partition key + sort key (createdAt).
 */
async function deleteAllItemsFromTable(
    tableName: string,
    partitionKeyName: string,
    sortKeyName: string,
): Promise<number> {
    let deletedCount = 0;
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
        const scanResult = await ddbClient.send(
            new ScanCommand({
                TableName: tableName,
                ExclusiveStartKey: lastEvaluatedKey,
                ProjectionExpression: "#pk, #sk",
                ExpressionAttributeNames: {
                    "#pk": partitionKeyName,
                    "#sk": sortKeyName,
                },
            }),
        );

        const items = scanResult.Items || [];
        lastEvaluatedKey = scanResult.LastEvaluatedKey;

        // Batch delete in chunks of 25 (DynamoDB limit)
        for (let i = 0; i < items.length; i += 25) {
            const batch = items.slice(i, i + 25);

            await ddbClient.send(
                new BatchWriteCommand({
                    RequestItems: {
                        [tableName]: batch.map((item) => ({
                            DeleteRequest: {
                                Key: {
                                    [partitionKeyName]: item[partitionKeyName],
                                    [sortKeyName]: item[sortKeyName],
                                },
                            },
                        })),
                    },
                }),
            );

            deletedCount += batch.length;
        }
    } while (lastEvaluatedKey);

    return deletedCount;
}

const _handler = async (
    event: APIGatewayProxyEvent,
    context: Context,
): Promise<APIGatewayProxyResult> => {
    const logger = createLogger("delete-hubspot-data", context);

    // Require ENGINEER role for this operation
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const dealsTable = process.env.DEALS_TABLE_NAME;
    const companiesTable = process.env.COMPANIES_TABLE_NAME;
    const contactsTable = process.env.CONTACTS_TABLE_NAME;

    if (!dealsTable || !companiesTable || !contactsTable) {
        return err("Table environment variables not configured", 500);
    }

    logger.info("Starting HubSpot data deletion", {
        triggeredBy: auth.user.email,
        tables: [dealsTable, companiesTable, contactsTable],
    });

    const results: DeleteResult[] = [];

    try {
        // Delete all deals (PK: dealId, SK: createdAt)
        const dealsDeleted = await deleteAllItemsFromTable(dealsTable, "dealId", "createdAt");
        results.push({ table: "deals", deletedCount: dealsDeleted });
        logger.info("Deals deleted", { count: dealsDeleted });

        // Delete all companies (PK: companyId, SK: createdAt)
        const companiesDeleted = await deleteAllItemsFromTable(
            companiesTable,
            "companyId",
            "createdAt",
        );
        results.push({ table: "companies", deletedCount: companiesDeleted });
        logger.info("Companies deleted", { count: companiesDeleted });

        // Delete all contacts (PK: contactId, SK: createdAt)
        const contactsDeleted = await deleteAllItemsFromTable(
            contactsTable,
            "contactId",
            "createdAt",
        );
        results.push({ table: "contacts", deletedCount: contactsDeleted });
        logger.info("Contacts deleted", { count: contactsDeleted });

        const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);

        logger.info("HubSpot data deletion complete", {
            totalDeleted,
            results,
            triggeredBy: auth.user.email,
        });

        return ok({
            message: "HubSpot data deleted successfully",
            totalDeleted,
            results,
        });
    } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error("Failed to delete HubSpot data", {
            error: error.message,
            stack: error.stack,
        });
        return err("Failed to delete HubSpot data: " + error.message);
    }
};

export const handler = withPermissions(_handler);
