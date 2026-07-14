import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "../src/shared/dynamodb-client";

async function run() {
  const TABLE = "local-docusign-envelopes";
  const res = await ddbClient.send(new ScanCommand({ TableName: TABLE }));
  const items = res.Items ?? [];
  const todayItems = items.filter(item => item.created_at?.startsWith("2026-06-18"));
  todayItems.sort((a, b) => a.created_at.localeCompare(b.created_at));
  
  console.log("Today's Envelopes:");
  for (const item of todayItems) {
    console.log(`- ID: ${item.envelope_id}`);
    console.log(`  Subject: ${item.email_subject}`);
    console.log(`  Status: ${item.status}`);
    console.log(`  Created At: ${item.created_at}`);
    console.log(`  Signers: ${JSON.stringify(item.signers?.map((s: any) => ({ name: s.name, email: s.email, status: s.status })))}`);
  }
}

run().catch(console.error);
