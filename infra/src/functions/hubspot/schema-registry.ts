import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { getConfig } from "../../lib/config";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

const config = getConfig();

const s3Client = new S3Client({});

interface HubSpotProperty {
	name: string;
	type: string;
	label?: string;
	fieldType?: string;
	description?: string;
	groupName?: string;
	updatedAt?: string;
	createdAt?: string;
}

interface HubSpotPropertiesResponse {
	results: HubSpotProperty[];
}

interface SchemaField {
	name: string;
	type: string;
}

const getHubSpotAccessToken = async (): Promise<string> => {
	const { SecretsManagerClient, GetSecretValueCommand } = await import(
		"@aws-sdk/client-secrets-manager"
	);

	const secretsClient = new SecretsManagerClient({});
	const secretName = process.env.HUBSPOT_SECRET_NAME;

	if (!secretName) {
		throw new Error("HUBSPOT_SECRET_NAME env var is not set");
	}

	const { SecretString } = await secretsClient.send(
		new GetSecretValueCommand({ SecretId: secretName }),
	);

	if (!SecretString) {
		throw new Error(`Secret ${secretName} has empty SecretString`);
	}

	const parsed = JSON.parse(SecretString) as { hubspot_pat: string };
	if (!parsed.hubspot_pat) {
		throw new Error("hubspot_pat not found in secret JSON");
	}

	return parsed.hubspot_pat;
};

const fetchHubSpotProperties = async (
	objectType: string,
	accessToken: string,
): Promise<HubSpotPropertiesResponse> => {
	const url = `https://api.hubapi.com/crm/v3/properties/${objectType}`;

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
	}

	// Cast the result to HubSpotPropertiesResponse to satisfy type requirement
	return (await response.json()) as HubSpotPropertiesResponse;
};

const extractSchema = (properties: HubSpotProperty[]): SchemaField[] => {
	return properties.map((prop) => ({
		name: prop.name,
		type: prop.type,
	}));
};

const saveSchemaToS3 = async (
	schema: SchemaField[],
	objectType: string,
	bucketName: string,
): Promise<string> => {
	const s3Key = `hubspot/${objectType}/v1.json`;

	const schemaObject = {
		objectType,
		version: "v1",
		generatedAt: new Date().toISOString(),
		fields: schema,
		totalFields: schema.length,
	};

	await s3Client.send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: s3Key,
			Body: JSON.stringify(schemaObject, null, 2),
			ContentType: "application/json",
		}),
	);

	return s3Key;
};

const _getSchemaRegistry: APIGatewayProxyHandler = async (event) => {
	const logger = createLogger("getSchemaRegistry");

	try {
		const authResult = authorizeUser(event, UserRole.ENGINEER);
		if (isAuthError(authResult)) {
			return authResult.error;
		}

		const { user } = authResult;
		logger.info(`getSchemaRegistry accessed by role=${user.role}`);

		const objectType = event.pathParameters?.type;
		if (!objectType) {
			return err("Object type parameter is required", 400);
		}

		const validTypes = ["deals", "contacts", "company"];
		if (!validTypes.includes(objectType)) {
			return err(
				`Invalid object type. Must be one of: ${validTypes.join(", ")}`,
				400,
			);
		}

		logger.info(`Fetching schema for object type: ${objectType}`);

		const accessToken = await getHubSpotAccessToken();

		const propertiesResponse = await fetchHubSpotProperties(
			objectType,
			accessToken,
		);

		logger.info(
			`Fetched ${propertiesResponse.results.length} properties from HubSpot`,
		);

		const schema = extractSchema(propertiesResponse.results);

		const bucketName = config.schemaRegistryBucket;
		const s3Key = await saveSchemaToS3(schema, objectType, bucketName);

		logger.info(`Schema saved to S3: s3://${bucketName}/${s3Key}`);

		return ok({
			objectType,
			totalFields: schema.length,
			s3Location: `s3://${bucketName}/${s3Key}`,
			schema,
		});
	} catch (e: any) {
		logger.error("getSchemaRegistry error:", e);
		return err(e?.message ?? "Internal error");
	}
};
export const getSchemaRegistry = withPermissions(_getSchemaRegistry);
