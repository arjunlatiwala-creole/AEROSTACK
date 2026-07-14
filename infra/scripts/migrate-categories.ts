import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = "us-east-1";

// If DYNAMODB_LOCAL_ENDPOINT is set, use local table name, else use dev table name
const isLocal = Boolean(process.env.DYNAMODB_LOCAL_ENDPOINT);
const TABLE_NAME = isLocal ? "local-loops" : "aerostack-dev-loops";

const client = new DynamoDBClient({
  region: REGION,
  ...(isLocal && {
    endpoint: process.env.DYNAMODB_LOCAL_ENDPOINT,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  }),
});
const docClient = DynamoDBDocumentClient.from(client);

async function migrate() {
  console.log(`Starting category migration. Local: ${isLocal}, Table: ${TABLE_NAME}`);
  let lastEvaluatedKey: any = undefined;
  let scannedCount = 0;
  let updatedCount = 0;

  do {
    const scanRes: any = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = scanRes.Items || [];
    scannedCount += items.length;

    for (const item of items) {
      const loopId = item.loop_id;
      const category = item.category;
      const status = item.status;

      let newCategory = category;
      if (category === "LEARNING") {
        newCategory = "OAL";
      } else if (category === "LND") {
        newCategory = "PRO-DEV";
      } else if (category === "SKILLS_CERT") {
        newCategory = "ONBOARDING";
      }

      if (newCategory !== category) {
        const categoryStatus = `${newCategory}#${status || ""}`;
        console.log(`Updating loop ${loopId}: ${category} -> ${newCategory}`);
        
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { loop_id: loopId },
            UpdateExpression: "SET category = :cat, category_status = :cs, updated_at = :updated",
            ExpressionAttributeValues: {
              ":cat": newCategory,
              ":cs": categoryStatus,
              ":updated": new Date().toISOString(),
            },
          })
        );
        updatedCount++;
      }
    }

    lastEvaluatedKey = scanRes.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Migration completed. Scanned: ${scannedCount}, Updated: ${updatedCount}`);
}

migrate().catch(console.error);
