/**
 * PostAuthentication Lambda Trigger
 *
 * Runs after every successful Cognito login.
 * Saves the login timestamp to DynamoDB:
 *   PK = USER#{sub}  SK = LAST_LOGIN
 *   email, tenantId, lastLoginAt
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME;

export async function handler(event) {
  // Only process PostAuthentication
  if (event.triggerSource !== "PostAuthentication_Authentication") {
    return event;
  }

  const attrs = event.request.userAttributes || {};
  const sub = attrs.sub || event.userName;
  const email = attrs.email || "";
  const tenantId = attrs["custom:tenantId"] || "";
  const now = new Date().toISOString();

  console.log(`[PostAuth] Login: ${email} (sub=${sub}, tenant=${tenantId})`);

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${sub}`,
          SK: "LAST_LOGIN",
          email,
          tenantId,
          lastLoginAt: now,
        },
      })
    );
  } catch (err) {
    // Don't block login if DDB write fails
    console.error("[PostAuth] Failed to write login timestamp:", err.message);
  }

  return event;
}
