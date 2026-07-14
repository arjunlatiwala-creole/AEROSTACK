#!/usr/bin/env bash
# Post a message to a Slack channel using the Aerostack bot token from Secrets Manager.
# Token lives in Secrets Manager as `slack_bot_token` (JSON key slack_bot_token).
# Joins the channel first if the bot isn't a member (needs channels:join scope).
#
# Usage:
#   AWS_PROFILE_SM=enterprise-aerostack CHANNEL=int-enterpriseinternal-aerostack-chat-dev-ops \
#   bash .kiro/scripts/slack-post.sh "message text (mrkdwn ok)"
set -euo pipefail

PROFILE="${AWS_PROFILE_SM:-enterprise-aerostack}"
REGION="${REGION:-us-east-1}"
CHANNEL="${CHANNEL:-int-ai-enterpriseinternal-aerostack-chat-dev-ops}"
TEXT="${1:?usage: slack-post.sh \"message\"}"

TOKEN=$(aws secretsmanager get-secret-value --profile "$PROFILE" --region "$REGION" \
  --secret-id slack_bot_token --query SecretString --output text \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['slack_bot_token'])")

api() { curl -sS --max-time 15 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json; charset=utf-8" "$@"; }

# Resolve channel ID by name (public), then ensure membership.
CID=$(api "https://slack.com/api/conversations.list?types=public_channel&limit=1000" \
  | python3 -c "import sys,json
d=json.load(sys.stdin)
ch=[c for c in d.get('channels',[]) if c.get('name')=='$CHANNEL']
print(ch[0]['id'] if ch else '')")

if [ -z "$CID" ]; then
  echo "Channel '$CHANNEL' not visible to the bot. Invite it (/invite @Aerostack-SLACK-AGENT) or check name." >&2
  exit 1
fi

# Best-effort join (no-op if already a member or private).
api -X POST "https://slack.com/api/conversations.join" -d "{\"channel\":\"$CID\"}" >/dev/null || true

RESP=$(SLACK_TOKEN="$TOKEN" SLACK_CID="$CID" SLACK_TEXT="$TEXT" python3 -c "
import os, json, urllib.request
tok=os.environ['SLACK_TOKEN']; cid=os.environ['SLACK_CID']; text=os.environ['SLACK_TEXT']
data=json.dumps({'channel':cid,'text':text,'mrkdwn':True}).encode()
req=urllib.request.Request('https://slack.com/api/chat.postMessage', data=data,
  headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json; charset=utf-8'})
r=json.loads(urllib.request.urlopen(req, timeout=15).read())
print('posted ts='+r['ts'] if r.get('ok') else 'ERROR: '+str(r.get('error')))
")
echo "$RESP"
