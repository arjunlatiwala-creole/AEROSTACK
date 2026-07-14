#!/usr/bin/env bash
# Migrate NATIVE (email/password) Cognito users between accounts.
#
# Google-federated users (Username starts with "Google_") are SKIPPED on
# purpose: they auto-provision in the destination pool on first Google login,
# so they need no migration once the Google OAuth redirect URI for the new
# Cognito domain is registered. Passwords cannot be exported from Cognito, so
# native users are created with their attributes and must reset their password
# (forgot-password) or be reset by an admin.
#
# Usage:
#   SRC_PROFILE=enterprise-peregrine SRC_POOL=us-east-1_AGtkuUgoC \
#   DST_PROFILE=enterprise-aerostack      DST_POOL=us-east-1_okmiaei9w \
#   REGION=us-east-1 [SEND_INVITE=0] bash .kiro/scripts/migrate-cognito-users.sh
#
# SEND_INVITE=0 (default) suppresses the Cognito welcome email (no spam).
set -euo pipefail

: "${SRC_PROFILE:?}"; : "${SRC_POOL:?}"; : "${DST_PROFILE:?}"; : "${DST_POOL:?}"
REGION="${REGION:-us-east-1}"
SEND_INVITE="${SEND_INVITE:-0}"
MSG_ACTION=$([ "$SEND_INVITE" = "1" ] && echo "" || echo "--message-action SUPPRESS")

echo "SRC: $SRC_PROFILE / $SRC_POOL  ->  DST: $DST_PROFILE / $DST_POOL  (region $REGION)"
echo "Google_* users are skipped (auto-provision via SSO). SEND_INVITE=$SEND_INVITE"
echo

created=0; skipped_google=0; skipped_exists=0
next=""
while :; do
  page=$(aws cognito-idp list-users --user-pool-id "$SRC_POOL" --profile "$SRC_PROFILE" --region "$REGION" \
          --max-items 60 ${next:+--starting-token "$next"} 2>/dev/null)
  # iterate usernames
  echo "$page" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for u in d.get("Users", []):
    un = u["Username"]
    email = next((a["Value"] for a in u.get("Attributes", []) if a["Name"]=="email"), "")
    verified = next((a["Value"] for a in u.get("Attributes", []) if a["Name"]=="email_verified"), "false")
    print("\t".join([un, email, verified]))
' | while IFS=$'\t' read -r un email verified; do
    if [[ "$un" == Google_* ]]; then
      skipped_google=$((skipped_google+1)); continue
    fi
    [ -z "$email" ] && { echo "skip (no email): $un"; continue; }
    if aws cognito-idp admin-get-user --user-pool-id "$DST_POOL" --username "$email" \
         --profile "$DST_PROFILE" --region "$REGION" >/dev/null 2>&1; then
      echo "exists: $email"; skipped_exists=$((skipped_exists+1)); continue
    fi
    aws cognito-idp admin-create-user --user-pool-id "$DST_POOL" --username "$email" \
      --profile "$DST_PROFILE" --region "$REGION" $MSG_ACTION \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value="${verified:-true}" \
      >/dev/null
    echo "created: $email"; created=$((created+1))
  done
  next=$(echo "$page" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("NextToken",""))')
  [ -z "$next" ] && break
done
echo
echo "Done. Native users created in destination pool. They must use 'Forgot password' to set a credential."
echo "Google SSO users were skipped — they provision automatically on first login."
