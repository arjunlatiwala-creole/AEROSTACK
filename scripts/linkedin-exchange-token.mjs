#!/usr/bin/env node
/**
 * Reads repo-root `.linkedin.env`, exchanges LinkedIn OAuth `authorization_code`
 * for an access_token, fetches `/v2/userinfo` for author URN, prints JSON for
 * AWS Secrets Manager (`linkedin_content_publish`).
 *
 * Prereqs: fresh LINKEDIN_AUTH_CODE (expires quickly). Same redirect_uri as authorize request.
 *
 * Usage:
 *   # In .linkedin.env set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI,
 *   # LINKEDIN_AUTH_CODE (from /oauth/linkedin/callback)
 *   node scripts/linkedin-exchange-token.mjs
 *
 * Options:
 *   --json-only       Print only JSON (two lines suppressed)
 *   --save FILE       Write secret JSON to FILE (don't commit FILE)
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

/** Accept raw code or `code=...` / full callback URL. */
function normalizeAuthCode(raw) {
  const s = (raw ?? "").trim();
  if (!s) return "";
  try {
    if (s.includes("code=")) {
      const u = s.startsWith("http") ? new URL(s) : new URL(s, "http://dummy.local/");
      const c = u.searchParams.get("code");
      if (c) return c;
    }
  } catch {
    /* ignore */
  }
  const m = s.match(/(?:^|[?&])code=([^&]+)/);
  if (m) return decodeURIComponent(m[1].replace(/\+/g, " "));
  return s;
}

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json-only");
const saveIdx = args.indexOf("--save");
const saveFile = saveIdx >= 0 && args[saveIdx + 1] ? args[saveIdx + 1] : "";

const env = loadDotEnv(envFile);
if (!env) {
  console.error(`Missing ${envFile}`);
  process.exit(1);
}

const clientId = env.LINKEDIN_CLIENT_ID?.trim();
const clientSecret = env.LINKEDIN_CLIENT_SECRET?.trim();
const redirectUri = env.LINKEDIN_REDIRECT_URI?.trim();
const authCodeRaw =
  env.LINKEDIN_AUTH_CODE?.trim() ||
  env.LINKEDIN_CODE?.trim() ||
  "";

if (!clientId) {
  console.error("LINKEDIN_CLIENT_ID is required in .linkedin.env");
  process.exit(1);
}
if (!clientSecret) {
  console.error(
    "LINKEDIN_CLIENT_SECRET is required (Primary Client Secret from LinkedIn Auth tab).",
  );
  process.exit(1);
}
if (!redirectUri) {
  console.error("LINKEDIN_REDIRECT_URI is required.");
  process.exit(1);
}

const authCode = normalizeAuthCode(authCodeRaw);
if (!authCode) {
  console.error(
    "Set LINKEDIN_AUTH_CODE in .linkedin.env to the OAuth `code` (expires quickly).",
  );
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: "authorization_code",
  code: authCode,
  redirect_uri: redirectUri,
  client_id: clientId,
  client_secret: clientSecret,
});

let tokenJson;
try {
  const tokRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const txt = await tokRes.text();
  tokenJson = JSON.parse(txt);
  if (!tokRes.ok) {
    console.error("Token exchange failed:", tokRes.status, txt);
    process.exit(1);
  }
} catch (e) {
  console.error("Token exchange error:", e);
  process.exit(1);
}

const accessToken = tokenJson.access_token;
if (!accessToken) {
  console.error("Unexpected token response:", tokenJson);
  process.exit(1);
}

let sub;
try {
  const uiRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const uiTxt = await uiRes.text();
  const ui = JSON.parse(uiTxt);
  if (!uiRes.ok) {
    console.error("userinfo failed:", uiRes.status, uiTxt);
    process.exit(1);
  }
  sub = ui.sub;
} catch (e) {
  console.error("userinfo error:", e);
  process.exit(1);
}

if (!sub) {
  console.error("No `sub` in userinfo response; cannot build author_urn.");
  process.exit(1);
}

const secretPayload = {
  access_token: accessToken,
  author_urn: `urn:li:person:${sub}`,
};

const outJson = JSON.stringify(secretPayload, null, 2);

if (!jsonOnly) {
  console.log("");
  console.log("OK — use this JSON as AWS Secrets Manager secret linkedin_content_publish.");
  console.log("(Do not commit this output.)\n");
}

console.log(outJson);

if (saveFile) {
  writeFileSync(saveFile, `${outJson}\n`, "utf8");
  if (!jsonOnly) console.error(`\nWrote ${saveFile}`);
}

if (!jsonOnly) {
  const awsSecretId = env.LINKEDIN_AWS_SECRET_ID?.trim() || "linkedin_content_publish";
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  const regionArg = region ? ` --region ${region}` : "";
  console.log(`
AWS CLI (dev account credentials):
  aws secretsmanager put-secret-value \\
    --secret-id ${JSON.stringify(awsSecretId)}${regionArg} \\
    --secret-string '${JSON.stringify(secretPayload)}'
`);
}

if (env.LINKEDIN_PUT_AWS === "1" || env.LINKEDIN_PUT_AWS === "true") {
  try {
    const awsSecretId = env.LINKEDIN_AWS_SECRET_ID?.trim() || "linkedin_content_publish";
    const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || "";
    const awsArgs = [
      "secretsmanager",
      "put-secret-value",
      "--secret-id",
      awsSecretId,
      "--secret-string",
      JSON.stringify(secretPayload),
    ];
    if (region) awsArgs.splice(2, 0, "--region", region);
    const r = spawnSync("aws", awsArgs, { stdio: "inherit", cwd: root });
    if (r.status !== 0) throw new Error("aws exit " + r.status);
    if (!jsonOnly) console.error("\nPosted to AWS Secrets Manager (LINKEDIN_PUT_AWS).");
  } catch {
    if (!jsonOnly) {
      console.error("LINKEDIN_PUT_AWS set but aws CLI failed; run the aws command printed above.");
    }
    process.exit(1);
  }
}
