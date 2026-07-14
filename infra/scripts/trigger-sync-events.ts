// scripts/trigger-sync-events.ts
// Run with: ts-node scripts/trigger-sync-events.ts [integration_type] [integration_id]
// Examples:
//   ts-node scripts/trigger-sync-events.ts
//   ts-node scripts/trigger-sync-events.ts hubspot int_123
//   ts-node scripts/trigger-sync-events.ts salesforce int_salesforce_456
//
// This script triggers EventBridge events to test your Lambda handlers locally

import {
	EventBridgeClient,
	PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

// Parse command-line arguments
const args = process.argv.slice(2);
const integrationType = args[0] || "hubspot";
const integrationId = args[1] || `int_test_${Date.now()}`;

const ebClient = new EventBridgeClient({
	region: process.env.AWS_REGION || "us-east-1",
	...(process.env.EVENTBRIDGE_ENDPOINT && {
		endpoint: process.env.EVENTBRIDGE_ENDPOINT,
	}),
});

// Colors for console output
const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	blue: "\x1b[34m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	bold: "\x1b[1m",
};

function log(message: string, color = colors.blue) {
	console.log(`${color}${message}${colors.reset}`);
}

function success(message: string) {
	console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

async function triggerManualSyncEvent() {
	console.log(`
${colors.cyan}${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Triggering Manual Sync Events
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}

${colors.blue}Configuration:${colors.reset}
  Integration Type: ${colors.yellow}${integrationType}${colors.reset}
  Integration ID:   ${colors.yellow}${integrationId}${colors.reset}
`);

	try {
		// ===================================================================
		// Event 1: Manual Sync Requested
		// ===================================================================
		log(
			`\n${colors.bold}📡 Publishing "Manual Sync Requested" event...${colors.reset}`,
		);

		const manualSyncEvent = {
			Source: "manual.sync",
			DetailType: "Manual Sync Requested",
			Detail: JSON.stringify({
				integration_id: integrationId,
				integration_type: integrationType,
				triggered_by: "test@example.com",
				requested_at: new Date().toISOString(),
			}),
		};

		console.log(
			`${colors.blue}Event:${colors.reset}`,
			JSON.stringify(manualSyncEvent, null, 2),
		);

		await ebClient.send(
			new PutEventsCommand({
				Entries: [manualSyncEvent],
			}),
		);

		success("Published: Manual Sync Requested");
		console.log(
			`  ${colors.cyan}→ Should trigger: ManualSyncFanoutLambda${colors.reset}`,
		);

		// Wait a bit
		await delay(2000);

		// ===================================================================
		// Event 2: Ingest Requested (for each entity)
		// ===================================================================
		log(
			`\n${colors.bold}📥 Publishing "Ingest Requested" events...${colors.reset}`,
		);

		const entities = ["deals", "contacts", "companies"];
		const syncId = `sync_${Date.now()}`;

		for (const entityType of entities) {
			const ingestEvent = {
				Source: "manual.sync",
				DetailType: "Ingest Requested",
				Detail: JSON.stringify({
					integration_id: integrationId,
					integration_type: integrationType,
					entity_type: entityType,
					sync_id: `${syncId}_${entityType}`,
				}),
			};

			console.log(
				`\n${colors.blue}Event (${entityType}):${colors.reset}`,
				JSON.stringify(ingestEvent, null, 2),
			);

			await ebClient.send(
				new PutEventsCommand({
					Entries: [ingestEvent],
				}),
			);

			success(`Published: Ingest Requested (${entityType})`);
			console.log(
				`  ${colors.cyan}→ Should trigger: IngestRouterLambda → HubspotIngestionLambda${colors.reset}`,
			);

			await delay(1000);
		}

		// Wait a bit
		await delay(2000);

		// ===================================================================
		// Event 3: Ingestion Complete (for one entity as example)
		// ===================================================================
		log(
			`\n${colors.bold}✅ Publishing "Ingestion Complete" event...${colors.reset}`,
		);

		const ingestionCompleteEvent = {
			Source: `${integrationType}.ingestion`,
			DetailType: "Ingestion Complete",
			Detail: JSON.stringify({
				integration_id: integrationId,
				integration_type: integrationType,
				entity_type: "deals",
				sync_id: `${syncId}_deals`,
				records_count: 10,
				status: "success",
			}),
		};

		console.log(
			`${colors.blue}Event:${colors.reset}`,
			JSON.stringify(ingestionCompleteEvent, null, 2),
		);

		await ebClient.send(
			new PutEventsCommand({
				Entries: [ingestionCompleteEvent],
			}),
		);

		success("Published: Ingestion Complete");
		console.log(
			`  ${colors.cyan}→ Should trigger: ProcessEntityLambda${colors.reset}`,
		);

		// ===================================================================
		// Summary
		// ===================================================================
		console.log(`
${colors.cyan}${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ All Events Published Successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}

${colors.green}Events Published:${colors.reset}
  1. ✅ Manual Sync Requested
  2. ✅ Ingest Requested (deals, contacts, companies)
  3. ✅ Ingestion Complete (deals)

${colors.yellow}Expected Lambda Flow:${colors.reset}
  Manual Sync Requested
    ↓
  ManualSyncFanoutLambda
    ↓
  Ingest Requested (×3)
    ↓
  IngestRouterLambda
    ↓
  HubspotIngestionLambda
    ↓
  Ingestion Complete
    ↓
  ProcessEntityLambda

${colors.blue}Monitor Lambda Logs:${colors.reset}
  Local (if using SAM):
    Check terminal output where SAM is running

  Deployed (AWS):
    aws logs tail /aws/lambda/ManualSyncFanoutLambda --follow
    aws logs tail /aws/lambda/IngestRouterLambda --follow
    aws logs tail /aws/lambda/HubspotIngestionLambda --follow
    aws logs tail /aws/lambda/ProcessEntityLambda --follow

${colors.cyan}Troubleshooting:${colors.reset}
  • Events published but Lambdas not triggered?
    → Check EventBridge Rules in AWS Console
    → Verify event patterns match your DetailType

  • Testing locally with SAM?
    → EventBridge events won't trigger Lambdas automatically locally
    → You need to invoke Lambdas manually with the event JSON

  • Best practice: Deploy to AWS and test there
    → cdk deploy ApiStack
    → Use the API endpoint to trigger the flow
`);
	} catch (error) {
		console.error(`${colors.cyan}❌ Error:${colors.reset}`, error);
		process.exit(1);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run
triggerManualSyncEvent().catch((error) => {
	console.error("Unhandled error:", error);
	process.exit(1);
});
