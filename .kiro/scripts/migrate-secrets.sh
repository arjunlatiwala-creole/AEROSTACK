#!/usr/bin/env bash
# Migrate Aerostack Secrets Manager secrets between AWS accounts.
#
# Aerostack old deployment was split across two accounts:
#   - infra (API/tables/frontend):  717976183293  (profile: enterprise)
#   - tools-api:                     730335467631  (profile: peregrine)
# New consolidated account:          759945100661  (enterprise-internal-aerostack, ...0661)
#
# The new-account Lambdas reference these secrets BY NAME (fromSecretNameV2),
# so they must exist in the destination account or the functions fail at runtime.
#
# Usage:
#   aws sso login --profile <SRC_PROFILE>
#   aws sso login --profile <DST_PROFILE>
#   SRC_PROFILE=enterprise DST_PROFILE=aerostack-new REGION=us-east-1 bash .kiro/scripts/migrate-secrets.sh
#   # then repeat with SRC_PROFILE=peregrine for the tools-api secrets
#
# Idempotent: creates the secret in the destination if missing, otherwise
# updates its value. Secrets absent in the source are skipped with a warning.
# Values are never printed.
set -euo pipefail

SRC_PROFILE="${SRC_PROFILE:?set SRC_PROFILE (e.g. enterprise or peregrine)}"
DST_PROFILE="${DST_PROFILE:?set DST_PROFILE (the 759945100661 profile)}"
REGION="${REGION:-us-east-1}"

# The full Aerostack secret set (names are identical across accounts).
SECRETS=(
  "hubspot_pat"
  "deel_api_token"
  "linear_api_token"
  "linear_api_token_with_admin_access"
  "google-directory-service-account"
  "aerostack/document-host/dropbox-sign-api-key"
  "slack_bot_token"
)

echo "Source:      profile=$SRC_PROFILE region=$REGION"
echo "Destination: profile=$DST_PROFILE region=$REGION"
SRC_ACCT=$(aws sts get-caller-identity --profile "$SRC_PROFILE" --query Account --output text)
DST_ACCT=$(aws sts get-caller-identity --profile "$DST_PROFILE" --query Account --output text)
echo "Source account:      $SRC_ACCT"
echo "Destination account: $DST_ACCT"
[ "$SRC_ACCT" = "$DST_ACCT" ] && { echo "SRC and DST are the same account — aborting."; exit 1; }
echo

for name in "${SECRETS[@]}"; do
  if ! val=$(aws secretsmanager get-secret-value --profile "$SRC_PROFILE" --region "$REGION" \
        --secret-id "$name" --query SecretString --output text 2>/dev/null); then
    echo "skip   $name (not found in $SRC_ACCT)"
    continue
  fi
  if aws secretsmanager describe-secret --profile "$DST_PROFILE" --region "$REGION" \
        --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --profile "$DST_PROFILE" --region "$REGION" \
        --secret-id "$name" --secret-string "$val" >/dev/null
    echo "update $name -> $DST_ACCT"
  else
    aws secretsmanager create-secret --profile "$DST_PROFILE" --region "$REGION" \
        --name "$name" --secret-string "$val" >/dev/null
    echo "create $name -> $DST_ACCT"
  fi
done

echo
echo "Done. Re-run with SRC_PROFILE=peregrine to pull tools-api secrets (e.g. slack_bot_token) from 730335467631."
