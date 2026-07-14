import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { createLogger } from "../shared/logger";

const logger = createLogger("PostSignupConfirmation");

export const postSignupConfirmation = async (event: any) => {
  const tableName = process.env.PERSON_TABLE_NAME;
  if (!tableName) {
    logger.error("PERSON_TABLE_NAME env variable not set");
    throw new Error("PERSON_TABLE_NAME env variable not set");
  }

  console.log("postSignupConfirmation event", event);

  const item = {
    personId: event.userName,
    createdAt: new Date().toISOString(),
    givenRole: "User" as const,
  };

  try {
    await ddbClient.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      }),
    );

    logger.info(`User ${item.personId} successfully added to Person table`);
    return event;
  } catch (error: any) {
    logger.error("Error adding user to Person table", { error });
    throw new Error(error?.message ?? "Internal error");
  }
};
