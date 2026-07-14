import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { EventBridgeEvent } from "aws-lambda";

const eventBridge = new EventBridgeClient({});

export const handler = async (
	event: EventBridgeEvent<"Ingest Requested", any>,
) => {
	const { integration_type } = event.detail;

	switch (integration_type) {
		case "hubspot":
			await eventBridge.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "integration.ingest",
							DetailType: "Ingest Requested",
							Detail: JSON.stringify(event.detail),
						},
					],
				}),
			);
			return;

		case "deel":
			await eventBridge.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "integration.ingest",
							DetailType: "Ingest Requested",
							Detail: JSON.stringify(event.detail),
						},
					],
				}),
			);
			return;

		case "partner-central":
			await eventBridge.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "integration.ingest",
							DetailType: "Ingest Requested",
							Detail: JSON.stringify(event.detail),
						},
					],
				}),
			);
			return;

		default:
			throw new Error(`Unsupported integration: ${integration_type}`);
	}
};
