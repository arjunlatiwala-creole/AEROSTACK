#!/usr/bin/env npx ts-node
/**
 * Assign a Cognito user to a platform role group.
 *
 * Usage:
 *   pnpm run assign-group -- --email user@example.com --group Admin
 *   pnpm run assign-group -- --email user@example.com --group Super-Admin
 *   pnpm run assign-group -- --email user@example.com --group Seller
 *   pnpm run assign-group -- --email user@example.com --group User
 *
 * Valid groups: User | Seller | Admin | Super-Admin
 *
 * The script removes the user from all other platform groups first,
 * then adds them to the target group — same logic as save-given-role.ts.
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const PLATFORM_GROUPS = ["User", "Seller", "Admin", "Super-Admin"];
const USER_POOL_ID = "us-east-1_AGtkuUgoC";
const REGION = "us-east-1";

function parseArgs(): { email: string; group: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const email = get("--email");
  const group = get("--group");

  if (!email || !group) {
    console.error("Usage: pnpm run assign-group -- --email <email> --group <group>");
    console.error(`Valid groups: ${PLATFORM_GROUPS.join(" | ")}`);
    process.exit(1);
  }

  if (!PLATFORM_GROUPS.includes(group)) {
    console.error(`❌  Invalid group "${group}". Must be one of: ${PLATFORM_GROUPS.join(", ")}`);
    process.exit(1);
  }

  return { email, group };
}

async function main() {
  const { email, group } = parseArgs();
  const client = new CognitoIdentityProviderClient({ region: REGION });

  // 1. Look up user by email
  // ListUsers filter uses prefix-match; paginate if needed to find an exact match.
  console.log(`🔍  Looking up user: ${email}`);
  let username: string | undefined;
  let paginationToken: string | undefined;

  do {
    const listResult = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email = "${email}"`,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );

    const match = (listResult.Users ?? []).find((u) =>
      u.Attributes?.some(
        (a) => a.Name === "email" && a.Value?.toLowerCase() === email.toLowerCase(),
      ),
    );

    if (match) {
      username = match.Username!;
      break;
    }

    paginationToken = listResult.PaginationToken;
  } while (paginationToken);

  if (!username) {
    console.error(`❌  No user found with email: ${email}`);
    console.error(`   Tip: Make sure the user has signed in at least once so Cognito has their record.`);
    process.exit(1);
  }
  console.log(`✅  Found user: ${username}`);

  // 2. Show current groups
  const groupsResult = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }),
  );
  const currentGroups = (groupsResult.Groups ?? []).map((g) => g.GroupName!);
  console.log(`📋  Current groups: ${currentGroups.length > 0 ? currentGroups.join(", ") : "(none)"}`);

  // 3. Remove from all other platform groups
  const groupsToRemove = PLATFORM_GROUPS.filter(
    (g) => g !== group && currentGroups.includes(g),
  );

  for (const g of groupsToRemove) {
    console.log(`➖  Removing from group: ${g}`);
    await client.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: g,
      }),
    );
  }

  // 4. Add to target group (skip if already a member)
  if (currentGroups.includes(group)) {
    console.log(`ℹ️   Already in group: ${group}`);
  } else {
    console.log(`➕  Adding to group: ${group}`);
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: group,
      }),
    );
  }

  console.log(`\n🎉  Done! ${email} → ${group}`);
  console.log(`   The user's next login will include givenRole="${group}" in their JWT.`);
}

main().catch((err) => {
  console.error("❌  Error:", err?.message ?? err);
  if (err?.name) console.error("    Name:", err.name);
  if (err?.code) console.error("    Code:", err.code);
  if (err?.$metadata) console.error("    HTTP status:", err.$metadata.httpStatusCode);
  process.exit(1);
});
