import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "src/functions/shared/response";
import { withPermissions } from "../shared/permission-middleware";

const DEEL_TABLE = process.env.DEEL_PEOPLE_TABLE_NAME!;
const PERSON_TABLE = process.env.PERSON_TABLE_NAME;

/**
 * Searches Deel people + Person table by email prefix.
 * Google Workspace users are pre-loaded client-side via /loops/workspace-users
 * and filtered locally for instant results.
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const q = event.queryStringParameters?.q?.toLowerCase();

    if (!q || q.length < 2) return ok([]);

    // Run both DynamoDB queries in parallel
    const [deelRes, personRes] = await Promise.all([
      ddbClient.send(
        new ScanCommand({
          TableName: DEEL_TABLE,
          FilterExpression: "begins_with(email, :q)",
          ExpressionAttributeValues: { ":q": q },
          Limit: 15,
          ProjectionExpression: "email",
        }),
      ),
      PERSON_TABLE
        ? ddbClient.send(
            new ScanCommand({
              TableName: PERSON_TABLE,
              FilterExpression: "begins_with(email, :q)",
              ExpressionAttributeValues: { ":q": q },
              Limit: 15,
              ProjectionExpression: "email",
            }),
          )
        : Promise.resolve({ Items: [] }),
    ]);

    // Merge and dedupe
    const merged = new Set<string>();
    for (const item of deelRes.Items || []) {
      if (item.email && typeof item.email === "string") {
        merged.add(item.email.toLowerCase());
      }
    }
    for (const item of personRes.Items || []) {
      if (item.email && typeof item.email === "string") {
        merged.add(item.email.toLowerCase());
      }
    }

    const emails = Array.from(merged).slice(0, 15);

    return ok(emails);
  } catch (e: any) {
    console.error("SEARCH FAILED:", e);
    return err(e.message || "Search failed", 500);
  }
};

export const handler = withPermissions(_handler);
