/**
 * Shared DynamoDB Client
 * All Lambda functions should import from here.
 * Automatically switches between local and cloud endpoints.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

console.log("DEBUG INIT Client - AWS_SAM_LOCAL:", process.env.AWS_SAM_LOCAL);
console.log(
	"DEBUG INIT Client - DYNAMODB_LOCAL_ENDPOINT:",
	process.env.DYNAMODB_LOCAL_ENDPOINT,
);

const isLocal =
	process.env.AWS_SAM_LOCAL === "true" ||
	Boolean(process.env.DYNAMODB_LOCAL_ENDPOINT);
console.log("DEBUG INIT Client - isLocal:", isLocal);

const baseClient = new DynamoDBClient({
	...(isLocal && {
		endpoint:
			process.env.DYNAMODB_LOCAL_ENDPOINT || "http://dynamodb-local:8000",
		credentials: { accessKeyId: "local", secretAccessKey: "local" },
		region: "us-east-1",
	}),
});
if (isLocal) {
	console.log("DEBUG INIT Client - using LOCAL config");
} else {
	console.log("DEBUG INIT Client - using CLOUD config");
}

/**
 * Pre-configured DynamoDB Document Client
 * Handles local vs cloud endpoint automatically
 */
export const ddbClient = DynamoDBDocumentClient.from(baseClient, {
	marshallOptions: {
		removeUndefinedValues: false,
		convertEmptyValues: true,
	},
});

/**
 * Raw DynamoDB client for advanced operations
 */
export const ddbRawClient = baseClient;

/**
 * Check if running in local mode
 */
export const isLocalDynamoDB = isLocal;
