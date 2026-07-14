import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { IntegrationRepository } from "src/repos/integration.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";
import { getGoogleAccessToken } from "src/shared/google-directory-client";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const smClient = new SecretsManagerClient({});

async function getSecretValue(secretName: string): Promise<any> {
	const res = await smClient.send(
		new GetSecretValueCommand({ SecretId: secretName })
	);
	if (!res.SecretString) throw new Error(`Secret ${secretName} not found`);
	return JSON.parse(res.SecretString);
}

interface ServiceAccountKey {
	client_email: string;
	private_key: string;
	token_uri: string;
}

async function getGoogleDriveAccessToken(
	impersonateEmail: string,
	scope: string = "https://www.googleapis.com/auth/drive.readonly"
): Promise<string> {
	const secretName = process.env.GOOGLE_DRIVE_SA_SECRET_NAME;
	if (!secretName) throw new Error("GOOGLE_DRIVE_SA_SECRET_NAME env var not set");

	const saKey: ServiceAccountKey = await getSecretValue(secretName);
	if (!saKey.client_email || !saKey.private_key) {
		throw new Error("Invalid service account key format in GOOGLE_DRIVE_SA_SECRET_NAME");
	}

	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iss: saKey.client_email,
			sub: impersonateEmail,
			scope,
			aud: saKey.token_uri || "https://oauth2.googleapis.com/token",
			iat: now,
			exp: now + 3600,
		}),
	).toString("base64url");

	const { createSign } = await import("node:crypto");
	const sign = createSign("RSA-SHA256");
	sign.update(`${header}.${payload}`);
	const signature = sign.sign(saKey.private_key, "base64url");

	const jwt = `${header}.${payload}.${signature}`;

	const tokenRes = await fetch(saKey.token_uri || "https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
	});

	if (!tokenRes.ok) {
		const errBody = await tokenRes.text();
		throw new Error(`Google token exchange failed: ${tokenRes.status} - ${errBody.slice(0, 200)}`);
	}

	const tokenData = (await tokenRes.json()) as { access_token: string };
	return tokenData.access_token;
}

async function getSlackToken(): Promise<string> {
	const secretName = process.env.SLACK_SECRET_NAME || "slack_bot_token";
	const secret = await getSecretValue(secretName);
	return secret.slack_bot_token || secret.token || secret.SLACK_BOT_TOKEN;
}

async function notifyDivyarajOfFailure(integrationType: string, errorMessage: string) {
	try {
		const token = await getSlackToken();
		if (!token) {
			console.error("Slack token not available");
			return;
		}

		// 1. List users to find Divyaraj
		const listResp = await fetch("https://slack.com/api/users.list", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!listResp.ok) {
			throw new Error(`Slack users.list failed: ${listResp.statusText}`);
		}
		const listData = (await listResp.json()) as any;
		if (!listData.ok) {
			throw new Error(`Slack users.list API error: ${listData.error}`);
		}

		const members = listData.members || [];
		const divyaraj = members.find((m: any) => {
			const realName = (m.real_name || "").toLowerCase();
			const email = (m.profile?.email || "").toLowerCase();
			return realName.includes("divyaraj") || realName.includes("divya") || email.includes("divyaraj") || email.includes("divya");
		});
console.log(divyaraj)
		let slackId = "";
		if (divyaraj) {
			slackId = divyaraj.id;
			console.log(`Found Divyaraj's Slack ID: ${slackId}`);
		} else {
			console.warn("Could not find Divyaraj in Slack user list, falling back to channel notification");
		}

		const displayName = integrationType.charAt(0).toUpperCase() + integrationType.slice(1);
		const messageText = `🚨 *${displayName} Integration Failure Alert* 🚨\nThe ${displayName} integration has started failing!\n*Error:* ${errorMessage}`;

		if (slackId) {
			// Send DM
			await fetch("https://slack.com/api/chat.postMessage", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					channel: slackId,
					text: messageText,
				}),
			});
		}

		// Also post to #ops-alerts
		const channelText = `🚨 *${displayName} Integration Failure Alert* 🚨\n${slackId ? `<@${slackId}>` : "Divyaraj"}, the ${displayName} integration has started failing!\n*Error:* ${errorMessage}`;
		await fetch("https://slack.com/api/chat.postMessage", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				channel: "#ops-alerts",
				text: channelText,
			}),
		});

		console.log("Slack notification sent successfully");
	} catch (err) {
		console.error("Failed to send Slack notification:", err);
	}
}

function toFriendlyGoogleError(e: any, context: "auth" | "directory" | "drive"): string {
	const msg = e.message || "";

	if (msg.includes("Secret") && msg.includes("not found")) {
		return `AWS Secrets Manager could not find the secret. Please verify the secret is deployed in this environment.`;
	}
	if (msg.includes("JSON") || msg.includes("Invalid service account")) {
		return `The secret credentials in Secrets Manager are invalid. Ensure the secret is a valid Google Service Account JSON key.`;
	}
	if (msg.includes("Token exchange failed") || msg.includes("token exchange failed")) {
		if (msg.includes("400") || msg.includes("invalid_grant")) {
			return `Google authentication rejected (400 invalid_grant). DWD (Domain-Wide Delegation) may not be configured for this Service Account in Google Admin console, or the client email does not have delegation permissions for the impersonated user.`;
		}
		if (msg.includes("401") || msg.includes("unauthorized_client")) {
			return `Unauthorized client (401). Google rejected the token assertion. Double check client ID and delegation scopes in Google Workspace Admin.`;
		}
		return `Google OAuth token exchange failed: ${msg}`;
	}
	if (msg.includes("returned 403") || msg.includes("Access Denied") || msg.includes("Forbidden")) {
		return `Access Denied (403). The Service Account lacks the required API scope, or the specific API has not been enabled in the Google Cloud Console.`;
	}
	if (msg.includes("returned 404") || msg.includes("Not Found")) {
		return `Not Found (404). Google returned not found. Verify the impersonated user or target domain exists.`;
	}
	if (msg.includes("returned 5")) {
		return `Google API server error (${msg}). Please check Google Workspace status page.`;
	}

	return msg;
}

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("test-integration", context);
	const integrationType = event.pathParameters?.integration_type;

	if (!integrationType) {
		return err("Missing integration_type parameter", 400);
	}

	const checks: Record<string, boolean> = {};
	const samples: Record<string, unknown> = {};
	let errors: Record<string, string> | undefined = undefined;
	let testError: string | null = null;

	if (integrationType === "google") {
		const adminEmail = process.env.GOOGLE_ADMIN_EMAIL || "admin@enterprise.io";
		const googleErrors: Record<string, string> = {};
		errors = googleErrors;

		checks.auth = false;
		checks.drive = false;
		checks.directory = false;

		// 1. Auth check
		let directoryToken = "";
		try {
			directoryToken = await getGoogleAccessToken(
				adminEmail,
				"https://www.googleapis.com/auth/admin.directory.group.readonly"
			);
			checks.auth = true;
			samples.auth = {
				secretName: "google-directory-service-account",
				impersonatedAs: adminEmail,
				tokenPreview: `${directoryToken.slice(0, 12)}…${directoryToken.slice(-6)}`,
				scope: "admin.directory.group.readonly",
			};
		} catch (e: any) {
			samples.auth = {
				secretName: "google-directory-service-account",
				impersonatedAs: adminEmail,
			};
			googleErrors.auth = toFriendlyGoogleError(e, "auth");
		}

		// 2. Directory check — return one group name + one user email
		if (checks.auth && directoryToken) {
			try {
				const directoryResp = await fetch(
					"https://admin.googleapis.com/admin/directory/v1/groups?customer=my_customer&maxResults=1",
					{
						headers: { Authorization: `Bearer ${directoryToken}` },
					}
				);
				if (!directoryResp.ok) {
					const bodyText = await directoryResp.text();
					throw new Error(`Directory API returned ${directoryResp.status}: ${bodyText}`);
				}
				const directoryJson = (await directoryResp.json()) as {
					groups?: Array<{ email?: string; name?: string }>;
				};
				const firstGroup = directoryJson.groups?.[0];

				// Also pull one user email to prove user.readonly works.
				let sampleUserEmail: string | undefined;
				try {
					const userToken = await getGoogleAccessToken(
						adminEmail,
						"https://www.googleapis.com/auth/admin.directory.user.readonly"
					);
					const userResp = await fetch(
						"https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=1&fields=users(primaryEmail)",
						{
							headers: { Authorization: `Bearer ${userToken}` },
						}
					);
					if (userResp.ok) {
						const userJson = (await userResp.json()) as {
							users?: Array<{ primaryEmail?: string }>;
						};
						sampleUserEmail = userJson.users?.[0]?.primaryEmail;
					}
				} catch {
					// Non-fatal
				}

				checks.directory = true;
				samples.directory = {
					secretName: "google-directory-service-account",
					impersonatedAs: adminEmail,
					groupName: firstGroup?.name ?? "(no groups returned)",
					userEmail: sampleUserEmail ?? "(user.readonly scope not granted)",
				};
			} catch (e: any) {
				samples.directory = {
					secretName: "google-directory-service-account",
					impersonatedAs: adminEmail,
				};
				googleErrors.directory = toFriendlyGoogleError(e, "directory");
			}
		} else {
			samples.directory = {
				secretName: "google-directory-service-account",
				impersonatedAs: adminEmail,
			};
			googleErrors.directory = "Skipped because Auth & Token Exchange failed.";
		}

		// 3. Drive check
		try {
			const driveToken = await getGoogleDriveAccessToken(
				adminEmail,
				"https://www.googleapis.com/auth/drive.readonly"
			);
			const driveResp = await fetch(
				"https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name,mimeType,modifiedTime)",
				{
					headers: { Authorization: `Bearer ${driveToken}` },
				}
			);
			if (!driveResp.ok) {
				const bodyText = await driveResp.text();
				throw new Error(`Drive API returned ${driveResp.status}: ${bodyText}`);
			}
			const driveJson = (await driveResp.json()) as {
				files?: Array<{ id?: string; name?: string; mimeType?: string; modifiedTime?: string }>;
			};
			checks.drive = true;
			const firstFile = driveJson.files?.[0];
			samples.drive = {
				secretName: "google-drive-sa",
				impersonatedAs: adminEmail,
				...(firstFile
					? {
						sampleFileName: firstFile.name,
						sampleFileType: firstFile.mimeType,
						modifiedTime: firstFile.modifiedTime,
					}
					: { note: "Authorized but no files returned" })
			};
		} catch (e: any) {
			samples.drive = {
				secretName: "google-drive-sa",
				impersonatedAs: adminEmail,
			};
			googleErrors.drive = toFriendlyGoogleError(e, "drive");
		}

		const failed = Object.keys(googleErrors).length > 0;
		if (failed) {
			testError = `Failed Google checks: ${Object.keys(googleErrors).join(", ")}`;
		}
	} else if (integrationType === "deel") {
		checks.auth = false;
		checks.api = false;

		try {
			// 1. Fetch token
			let deelToken = "";
			try {
				const secretName = process.env.DEEL_SECRET_NAME;
				if (!secretName) throw new Error("DEEL_SECRET_NAME env var not set");
				const parsed = await getSecretValue(secretName);
				deelToken = parsed.DEEL_API_TOKEN || parsed.token;
				if (!deelToken) throw new Error("Token field missing in secret");
				checks.auth = true;
				samples.auth = {
					tokenPreview: `${deelToken.slice(0, 6)}…${deelToken.slice(-4)}`,
					secretName,
				};
			} catch (e: any) {
				throw new Error(`Deel secret retrieval failed: ${e.message}`);
			}

			// 2. Test API Connectivity — list one person, then fetch full detail
			//    so we can pull title + email (the list endpoint omits both).
			try {
				const listResp = await fetch(
					"https://api.letsdeel.com/rest/v2/people?limit=1",
					{
						headers: {
							Authorization: `Bearer ${deelToken}`,
							"Content-Type": "application/json",
						},
					},
				);
				if (!listResp.ok) {
					const bodyText = await listResp.text();
					throw new Error(`Deel /people returned ${listResp.status}: ${bodyText}`);
				}
				const listJson = (await listResp.json()) as {
					data?: Array<{ id?: string; job_title?: string | null }>;
				};
				const personId = listJson.data?.[0]?.id;
				if (!personId) throw new Error("Deel /people returned no person id");

				// Detail endpoint includes title + email + alternate_email + employments
				const detailResp = await fetch(
					`https://api.letsdeel.com/rest/v2/people/${personId}`,
					{
						headers: {
							Authorization: `Bearer ${deelToken}`,
							"Content-Type": "application/json",
						},
					},
				);
				if (!detailResp.ok) {
					const bodyText = await detailResp.text();
					throw new Error(
						`Deel /people/{id} returned ${detailResp.status}: ${bodyText}`,
					);
				}

				const detailRaw = (await detailResp.json()) as {
					data?: {
						title?: string | null;
						job_title?: string | null;
						email?: string | null;
						alternate_email?: string | null;
						work_email?: string | null;
						employments?: Array<{
							job_title?: string | null;
							email?: string | null;
							work_email?: string | null;
						}>;
					};
				};
				const person = detailRaw.data;
				logger.info("Deel detail resolved", {
					personId,
					title: person?.title,
					job_title: person?.job_title,
					email: person?.email,
					work_email: person?.work_email,
					alternate_email: person?.alternate_email,
				});

				const employment = person?.employments?.[0];
				const resolvedTitle =
					person?.title ||
					person?.job_title ||
					employment?.job_title ||
					"(no title)";
				const resolvedEmail =
					person?.work_email ||
					person?.email ||
					employment?.work_email ||
					employment?.email ||
					person?.alternate_email ||
					"(no email)";

				checks.api = true;
				samples.api = {
					id: personId,
					title: resolvedTitle,
					email: resolvedEmail,
				};
			} catch (e: any) {
				throw new Error(`Deel API connection failed: ${e.message}`);
			}
		} catch (e: any) {
			testError = e.message;
		}

	} else if (integrationType === "linear") {
		checks.auth = false;
		checks.api = false;

		try {
			// 1. Fetch token
			let linearToken = "";
			try {
				const secretName = process.env.LINEAR_SECRET_NAME;
				if (!secretName) throw new Error("LINEAR_SECRET_NAME env var not set");
				const parsed = await getSecretValue(secretName);
				linearToken = parsed.LINEAR_API_TOKEN || parsed.token || parsed.devToken;
				if (!linearToken) throw new Error("Token field missing in secret");
				checks.auth = true;
				samples.auth = {
					tokenPreview: `${linearToken.slice(0, 6)}…${linearToken.slice(-4)}`,
					secretName,
				};
			} catch (e: any) {
				throw new Error(`Linear secret retrieval failed: ${e.message}`);
			}

			// 2. Test API Connectivity — fetch one project name
			try {
				const linearResp = await fetch("https://api.linear.app/graphql", {
					method: "POST",
					headers: {
						Authorization: linearToken,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						query: `query { projects(first: 1) { nodes { id name } } }`,
					}),
				});
				if (!linearResp.ok) {
					const bodyText = await linearResp.text();
					throw new Error(`Linear API returned ${linearResp.status}: ${bodyText}`);
				}
				const json = (await linearResp.json()) as {
					data?: { projects?: { nodes?: Array<{ id: string; name: string }> } };
					errors?: unknown[];
				};
				if (json.errors && json.errors.length > 0) {
					throw new Error(`Linear GraphQL returned errors: ${JSON.stringify(json.errors)}`);
				}
				checks.api = true;
				const firstProject = json.data?.projects?.nodes?.[0];
				samples.api = {
					projectName: firstProject?.name ?? "(no projects returned)",
				};
			} catch (e: any) {
				throw new Error(`Linear API connection failed: ${e.message}`);
			}
		} catch (e: any) {
			testError = e.message;
		}

	} else if (integrationType === "hubspot") {
		checks.auth = false;
		checks.api = false;

		try {
			// 1. Fetch token
			let hubspotToken = "";
			try {
				const secretName = process.env.HUBSPOT_SECRET_NAME;
				if (!secretName) throw new Error("HUBSPOT_SECRET_NAME env var not set");
				const parsed = await getSecretValue(secretName);
				hubspotToken =
					parsed.HUBSPOT_PAT ||
					parsed.hubspot_pat ||
					parsed.access_token ||
					parsed.token;
				if (!hubspotToken) throw new Error("Token field missing in secret");
				checks.auth = true;
				samples.auth = {
					tokenPreview: `${hubspotToken.slice(0, 6)}…${hubspotToken.slice(-4)}`,
					secretName,
				};
			} catch (e: any) {
				throw new Error(`HubSpot secret retrieval failed: ${e.message}`);
			}

			// 2. Test API connectivity — fetch one deal
			try {
				const hubspotResp = await fetch(
					"https://api.hubapi.com/crm/v3/objects/deals?limit=1&properties=dealname,amount,dealstage",
					{
						headers: {
							Authorization: `Bearer ${hubspotToken}`,
							"Content-Type": "application/json",
						},
					},
				);
				if (!hubspotResp.ok) {
					const bodyText = await hubspotResp.text();
					throw new Error(`HubSpot API returned ${hubspotResp.status}: ${bodyText}`);
				}
				const hubspotJson = (await hubspotResp.json()) as {
					results?: Array<{
						id?: string;
						properties?: {
							dealname?: string;
							amount?: string;
							dealstage?: string;
						};
					}>;
				};
				checks.api = true;
				const firstDeal = hubspotJson.results?.[0];
				const props = firstDeal?.properties;
				samples.api = firstDeal
					? {
						dealId: firstDeal.id,
						dealName: props?.dealname ?? "(no name)",
						amount: props?.amount ?? "(no amount)",
						stage: props?.dealstage ?? "(no stage)",
					}
					: { note: "Authorized but no deals returned" };
			} catch (e: any) {
				throw new Error(`HubSpot API connection failed: ${e.message}`);
			}
		} catch (e: any) {
			testError = e.message;
		}

	} else {
		return err(`Unsupported integration type: ${integrationType}`, 400);
	}

	// Now handle the database status & transition alerts
	if (integrationType !== "google") {
		try {
			const repo = new IntegrationRepository(
				ddbClient,
				process.env.INTEGRATIONS_TABLE_NAME!,
			);

			const listRes = await repo.listIntegrations({ integration_type: integrationType });
			let integration = listRes.items.find(i => i.integration_type === integrationType);

			const isSuccess = !testError;
			const newStatus = isSuccess ? "active" : "failed";

			if (!integration) {
				// Create it if it doesn't exist
				const displayName = integrationType.charAt(0).toUpperCase() + integrationType.slice(1);
				integration = await repo.createIntegration({
					integration_id: `${integrationType}-integration`,
					integration_type: integrationType,
					display_name: `${displayName} Integration`,
					description: `Automated test integration for ${displayName}.`,
					status: newStatus,
					enabled: true,
					auth_type: "api_key",
					auth_status: isSuccess,
					secrets_arn: (integrationType === "deel"
						? process.env.DEEL_SECRET_NAME
						: integrationType === "linear"
							? process.env.LINEAR_SECRET_NAME
							: process.env.HUBSPOT_SECRET_NAME) || "",
					auth_expires_at: new Date(Date.now() + 3600000).toISOString(),
					sync_enabled: true,
					sync_frequency_minutes: 60,
					last_sync_at: new Date().toISOString(),
					next_sync_at: new Date(Date.now() + 3600000).toISOString(),
					total_syncs: 1,
					successful_syncs: isSuccess ? 1 : 0,
					failed_syncs: isSuccess ? 0 : 1,
					consecutive_failures: isSuccess ? 0 : 1,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					created_by: "system",
					updated_by: "system",
				});

				if (!isSuccess) {
					await notifyDivyarajOfFailure(integrationType, testError!);
				}
			} else {
				// Update the status
				const oldStatus = integration.status;
				const updates: any = {
					status: newStatus,
					auth_status: isSuccess,
					last_sync_at: new Date().toISOString(),
					total_syncs: (integration.total_syncs || 0) + 1,
					successful_syncs: isSuccess ? (integration.successful_syncs || 0) + 1 : (integration.successful_syncs || 0),
					failed_syncs: !isSuccess ? (integration.failed_syncs || 0) + 1 : (integration.failed_syncs || 0),
					consecutive_failures: isSuccess ? 0 : (integration.consecutive_failures || 0) + 1,
				};
				await repo.updateIntegration(integration.integration_id, updates);

				// Alert transition: oldStatus was not failed, and now we failed
				if (!isSuccess && oldStatus !== "failed") {
					await notifyDivyarajOfFailure(integrationType, testError!);
				}
			}
		} catch (e: any) {
			logger.error("Failed to update integration status in DB", {
				error: e.message,
				stack: e.stack,
			});
		}
	}

	return ok({
		success: !testError,
		checks,
		samples,
		errors,
		error: testError,
	});
};

export const handler = withPermissions(_handler);
