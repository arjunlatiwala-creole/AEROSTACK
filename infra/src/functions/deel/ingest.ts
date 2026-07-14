import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { EventBridgeEvent } from "aws-lambda";

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

const DEEL_API_BASE = "https://api.letsdeel.com/rest/v2"; //
const DEEL_API_USERS_BASE = "https://api.letsdeel.com/scim/v2";
const DEEL_SECRET_NAME = process.env.DEEL_SECRET_NAME!;
const DEEL_BUCKET_NAME = process.env.DEEL_BUCKET_NAME!;

interface DeelUser {
	id: string;
	[key: string]: any;
}

interface DeelListResponse {
	totalResults: number;
	itemsPerPage: number;
	startIndex: number;
	Resources: DeelUser[];
}

// Get Deel API token from Secrets Manager
async function getDeelToken(): Promise<string> {
	const response = await secretsClient.send(
		new GetSecretValueCommand({
			SecretId: DEEL_SECRET_NAME,
		}),
	);

	if (!response.SecretString) {
		throw new Error("Deel secret not found");
	}

	const secret = JSON.parse(response.SecretString);
	return secret.DEEL_API_TOKEN || secret.token;
}

// Fetch users list with pagination
async function listUsers(
	token: string,
	startIndex: number = 1,
	count: number = 10,
): Promise<DeelListResponse> {
	const url = `${DEEL_API_USERS_BASE}/Users?startIndex=${startIndex}&count=${count}`;

	console.log("step 1 ");
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});
	console.log("step 2");

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Deel API error (${response.status}): ${error}`);
	}

	console.log();

	const data = await response.json();
	if (
		typeof data !== "object" ||
		data === null ||
		!("totalResults" in data) ||
		!("itemsPerPage" in data) ||
		!("startIndex" in data) ||
		!("Resources" in data)
	) {
		throw new Error("Invalid Deel list response format");
	}
	return data as DeelListResponse;
}

// Fetch single person details by hris_profile_id
async function getSinglePerson(
	token: string,
	hrisProfileId: string,
): Promise<any> {
	const url = `${DEEL_API_BASE}/people/${hrisProfileId}`;
	// https://api.letsdeel.com/rest/v2/people/

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		const error = await response.text();
		console.error(
			`Failed to fetch person ${hrisProfileId}: ${response.status} - ${error}`,
		);
		return null;
	}

	return await response.json();
}

// Main handler
export async function handler(
	event: EventBridgeEvent<"Ingest Requested", any>,
) {
	const { integration_id, integration_type } = event.detail;

	if (integration_type !== "deel") {
		throw new Error(`Invalid integration_type: ${integration_type}`);
	}
	try {
		console.log("Starting Deel data sync...");

		// Get Deel API token
		const token = await getDeelToken();

		const allUsers: any[] = [];
		let startIndex = 1;
		const pageSize = 10;
		let totalResults = 0;

		// Paginate through all users
		do {
			console.log(`Fetching users page starting at index ${startIndex}...`);

			const response = await listUsers(token, startIndex, pageSize);
			totalResults = response.totalResults;

			console.log(
				`Fetched ${response.Resources.length} users (${allUsers.length + response.Resources.length}/${totalResults})`,
			);

			// Enrich each user with detailed person data
			for (const user of response.Resources) {
				try {
					console.log(`Fetching details for user: ${user.id}`);

					// Call retrieveASinglePerson with the user's id as hris_profile_id
					const personDetails = await getSinglePerson(token, user.id);

					if (personDetails) {
						// Merge person details into user object
						const enrichedUser = {
							...user,
							personDetails,
						};
						allUsers.push(enrichedUser);
					} else {
						// If details fetch failed, add user without enrichment
						allUsers.push(user);
					}
				} catch (error) {
					console.error(`Error fetching details for user ${user.id}:`, error);
					// Add user without enrichment on error
					allUsers.push(user);
				}
			}

			// Move to next page
			startIndex += pageSize;
		} while (startIndex <= totalResults);

		console.log(`Total users processed: ${allUsers.length}`);

		// Store in S3
		const timestamp = new Date().toISOString();
		const s3Key = `deel-users/${timestamp}/users.json`;

		await s3Client.send(
			new PutObjectCommand({
				Bucket: DEEL_BUCKET_NAME,
				Key: s3Key,
				Body: JSON.stringify(
					{
						syncedAt: timestamp,
						totalUsers: allUsers.length,
						users: allUsers,
					},
					null,
					2,
				),
				ContentType: "application/json",
			}),
		);

		console.log(`Data stored in S3: ${s3Key}`);

		try {
			await eventBridgeClient.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "integration.ingest",
							DetailType: "Ingestion Complete",
							Detail: JSON.stringify({
								integration_id,
								integration_type,
								usersProcessed: allUsers.length,
								s3Key,
								bucket: DEEL_BUCKET_NAME,
								completed_at: timestamp,
							}),
						},
					],
				}),
			);
			console.log("EventBridge event emitted successfully");
		} catch (eventError) {
			console.error("Failed to emit EventBridge event:", eventError);
			// Don't fail the whole operation if event emission fails
		}

		return {
			statusCode: 200,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			},
			body: JSON.stringify({
				message: "Deel data sync completed successfully",
				usersProcessed: allUsers.length,
				s3Key,
				bucket: DEEL_BUCKET_NAME,
			}),
		};
	} catch (error: any) {
		console.error("Error syncing Deel data:", error);

		return {
			statusCode: 500,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			},
			body: JSON.stringify({
				error: "Failed to sync Deel data",
				message: error.message,
			}),
		};
	}
}
