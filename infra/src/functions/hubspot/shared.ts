import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { Client } from "@hubspot/api-client";

const secrets = new SecretsManagerClient({});
let hubspot: Client | undefined;

export async function getClient(): Promise<Client> {
	if (!hubspot) {
		const secretName = process.env.HUBSPOT_SECRET_NAME;
		if (!secretName) {
			throw new Error("HUBSPOT_SECRET_NAME env var is not set");
		}

		const { SecretString } = await secrets.send(
			new GetSecretValueCommand({ SecretId: secretName }),
		);

		if (!SecretString) {
			throw new Error(`Secret ${secretName} has empty SecretString`);
		}

		const parsed = JSON.parse(SecretString) as { hubspot_pat: string };
		if (!parsed.hubspot_pat) {
			throw new Error("hubspot_pat not found in secret JSON");
		}

		hubspot = new Client({ accessToken: parsed.hubspot_pat });
	}

	return hubspot;
}
