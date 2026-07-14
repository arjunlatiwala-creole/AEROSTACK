import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { EventBridgeEvent } from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";

const eventBridge = new EventBridgeClient({});
const HUBSPOT_ENTITIES = ["deals", "contacts", "companies"] as const;
const DEEL_ENTITIES = ["people"] as const;
const LINEAR_ENTITIES = ["projects"] as const;
const PARTNER_CENTRAL = [
	"opportunities",
	"engagements",
	"engagement-invitations",
] as const;

type ManualSyncDetail = {
	integration_type: string;
	integration_id: string;
	trigger: "manual";
	triggered_by: string;
	requested_at: string;
};

export const handler = async (
	event: EventBridgeEvent<"Manual Sync Requested", ManualSyncDetail>,
) => {
	const logger = createLogger("ManualSyncFanOut");

	logger.info("Fanning out manual sync", event.detail);
	let ENTITIES: readonly string[];
	switch (event.detail.integration_type) {
		case "hubspot":
			ENTITIES = HUBSPOT_ENTITIES;
			break;
		case "deel":
			ENTITIES = DEEL_ENTITIES;
			break;
		case "linear":
			ENTITIES = LINEAR_ENTITIES;
			break;
		case "partner_central":
			ENTITIES = PARTNER_CENTRAL;
			break;
		default:
			throw new Error("Unsupported integration type");
	}

	const entries = ENTITIES.map((entity) => ({
		Source: "integration.ingest",
		DetailType: "Ingest Requested",
		Detail: JSON.stringify({
			...event.detail,
			entityType: entity,
		}),
	}));

	await eventBridge.send(
		new PutEventsCommand({
			Entries: entries,
		}),
	);

	logger.info("Published ingest requests", { count: entries.length });
};
