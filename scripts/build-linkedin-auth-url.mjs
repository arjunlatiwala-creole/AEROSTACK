#!/usr/bin/env node
/**
 * Builds a valid LinkedIn OAuth 2.0 authorize URL using repo-root `.linkedin.env`.
 *
 * Usage:
 *   cp scripts/.linkedin.env.example .linkedin.env
 *   # edit LINKEDIN_CLIENT_ID + LINKEDIN_REDIRECT_URI
 *   node scripts/build-linkedin-auth-url.mjs
 *
 * Then open the printed URL in a browser (logged into LinkedIn).
 *
 * After LinkedIn redirects with `code`, save LINKEDIN_AUTH_CODE (+ LINKEDIN_CLIENT_SECRET)
 * and run token exchange:
 *   node scripts/linkedin-exchange-token.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envFile = join(root, ".linkedin.env");

function loadDotEnv(path) {
  if (!existsSync(path)) return null;
  const env = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

const env = loadDotEnv(envFile);
if (!env) {
  console.error(`Missing ${envFile}`);
  console.error("Run: cp scripts/.linkedin.env.example .linkedin.env  then fill LINKEDIN_CLIENT_ID and LINKEDIN_REDIRECT_URI.");
  process.exit(1);
}

const clientId = env.LINKEDIN_CLIENT_ID?.trim();
const redirectUri = env.LINKEDIN_REDIRECT_URI?.trim();
const scopes = env.LINKEDIN_SCOPES?.trim() || "openid profile w_member_social";

if (!clientId || clientId === "YOUR_CLIENT_ID") {
  console.error("LINKEDIN_CLIENT_ID is missing or still a placeholder. Paste your real Client ID from LinkedIn Auth tab.");
  process.exit(1);
}
if (!redirectUri || redirectUri.includes("YOUR_REDIRECT")) {
  console.error("LINKEDIN_REDIRECT_URI is missing or still a placeholder. It must exactly match LinkedIn Authorized redirect URLs.");
  process.exit(1);
}

const params = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  state: "DEVTEST_" + Math.random().toString(36).slice(2, 10),
  scope: scopes,
});

const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
console.log(url);
console.log("");
console.log("Open this URL in your browser → approve → copy the `code` from the redirect, then exchange it:");
console.log("  curl -s -X POST 'https://www.linkedin.com/oauth/v2/accessToken' \\");
console.log("    -H 'Content-Type: application/x-www-form-urlencoded' \\");
console.log("    --data-urlencode 'grant_type=authorization_code' \\");
console.log("    --data-urlencode 'code=PASTE_CODE' \\");
console.log(`    --data-urlencode 'redirect_uri=${redirectUri}' \\`);
console.log(`    --data-urlencode 'client_id=${clientId}' \\`);
console.log("    --data-urlencode 'client_secret=PASTE_PRIMARY_CLIENT_SECRET'");
