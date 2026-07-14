#!/usr/bin/env node
/**
 * Cross-account DynamoDB data migration for Aerostack.
 * Scans each source table and batch-writes into the same-named table in the
 * destination account. Tables must already exist in the destination (created
 * by the CDK TablesStack / tools_stack deploy).
 *
 * Run from the infra package so @aws-sdk resolves:
 *   SRC_PROFILE=peregrine DST_PROFILE=enterprise-aerostack \
 *   node ../.kiro/scripts/migrate-dynamo.mjs --stage dev
 *
 * Flags:
 *   --stage dev|prod   which table set (default dev)
 *   --tables a,b,c     explicit table list (overrides --stage set)
 *   --dry-run          count source items only, write nothing
 *
 * Idempotent: PutItem overwrites by key, so re-runs converge.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';

// Resolve @aws-sdk from the infra package (where it's installed), independent of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
const infraPkg = path.resolve(here, '../../infra/package.json');
const require = createRequire(infraPkg);
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

// Resolve SSO creds for a profile via the AWS CLI (native SSO support, no extra SDK deps).
function credsFor(profile) {
  const out = execSync(`aws configure export-credentials --profile ${profile}`, {
    encoding: 'utf8',
  });
  const c = JSON.parse(out);
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const SRC_PROFILE = process.env.SRC_PROFILE || 'peregrine';
const DST_PROFILE = process.env.DST_PROFILE || 'enterprise-aerostack';
const REGION = process.env.REGION || 'us-east-1';
const STAGE = arg('stage', 'dev');
const DRY = !!arg('dry-run', false);

// Aerostack table sets (names identical across accounts).
const SETS = {
  dev: [
    'aerostack-dev-bfpm-data', 'aerostack-dev-bfpm-sessions', 'aerostack-dev-companies',
    'aerostack-dev-contacts', 'aerostack-dev-deals', 'aerostack-dev-deel-people',
    'aerostack-dev-document-access', 'aerostack-dev-document-versions', 'aerostack-dev-documents',
    'aerostack-dev-hiring-candidates', 'aerostack-dev-hiring-comp-plans', 'aerostack-dev-hiring-job-recs',
    'aerostack-dev-hiring-notes', 'aerostack-dev-integration-sync-details',
    'aerostack-dev-integration-sync-history', 'aerostack-dev-integrations',
    'aerostack-dev-integrations-raw', 'aerostack-dev-linear-delivery', 'aerostack-dev-loop-financials',
    'aerostack-dev-loops', 'aerostack-dev-partner-engagement-invitations',
    'aerostack-dev-partner-engagements', 'aerostack-dev-partner-opportunities', 'aerostack-dev-person',
    'aerostack-dev-person-information', 'aerostack-dev-unified-opportunities',
    // tools-api (dev)
    'aerostack-tools-dev-accreditations', 'aerostack-tools-dev-agent-registry',
    'aerostack-tools-dev-content', 'aerostack-tools-dev-knowledge-base',
    'aerostack-tools-dev-linkedin-ugc-sink', 'aerostack-tools-dev-org-sync',
    'aerostack-tools-dev-perspex-sessions', 'aerostack-tools-dev-workspace-admin',
  ],
  prod: [
    'aerostack-tools-prod-accreditations', 'aerostack-tools-prod-agent-registry',
    'aerostack-tools-prod-content', 'aerostack-tools-prod-knowledge-base',
    'aerostack-tools-prod-org-sync', 'aerostack-tools-prod-perspex-sessions',
    'aerostack-tools-prod-workspace-admin',
  ],
};

const explicit = arg('tables', null);
const tables = explicit ? String(explicit).split(',') : SETS[STAGE];
if (!tables) {
  console.error(`Unknown --stage ${STAGE}`);
  process.exit(1);
}

const mk = (profile) =>
  DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: credsFor(profile) }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

const src = mk(SRC_PROFILE);
const dst = mk(DST_PROFILE);

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function migrateTable(table) {
  let lastKey;
  let read = 0;
  let wrote = 0;
  do {
    const page = await src.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey }));
    const items = page.Items ?? [];
    read += items.length;
    if (!DRY && items.length) {
      for (const group of chunk(items, 25)) {
        let req = { [table]: group.map((Item) => ({ PutRequest: { Item } })) };
        // retry unprocessed with simple backoff
        for (let attempt = 0; attempt < 6; attempt++) {
          const res = await dst.send(new BatchWriteCommand({ RequestItems: req }));
          const un = res.UnprocessedItems?.[table];
          if (!un || un.length === 0) break;
          req = { [table]: un };
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
        wrote += group.length;
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  console.log(`${DRY ? 'count ' : 'migrate'} ${table}: ${read} items${DRY ? '' : ` -> wrote ${wrote}`}`);
  return read;
}

(async () => {
  console.log(`SRC=${SRC_PROFILE} DST=${DST_PROFILE} region=${REGION} stage=${STAGE} dryRun=${DRY}`);
  console.log(`${tables.length} tables\n`);
  let total = 0;
  for (const t of tables) {
    try {
      total += await migrateTable(t);
    } catch (e) {
      console.error(`ERROR ${t}: ${e.name} ${e.message}`);
    }
  }
  console.log(`\nTotal source items: ${total}`);
})();
