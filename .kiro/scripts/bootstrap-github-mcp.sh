#!/usr/bin/env bash
# =============================================================================
# enterprise Kiro GitHub MCP Bootstrap Script
# =============================================================================
# Pulls the GitHub PAT from AWS Secrets Manager and configures the local
# Kiro MCP server. Run once on initial setup, or again after token rotation.
#
# Prerequisites:
#   - AWS CLI configured with access to the enterpriseio AWS account
#   - brew install github-mcp-server
#   - jq installed (brew install jq)
#
# Usage:
#   .kiro/scripts/bootstrap-github-mcp.sh
#   .kiro/scripts/bootstrap-github-mcp.sh --profile myprofile
#   .kiro/scripts/bootstrap-github-mcp.sh --region us-east-1
# =============================================================================

set -euo pipefail

SECRET_NAME="enterpriseio/kiro-github-mcp-token"
DEFAULT_REGION="us-east-2"
MCP_CONFIG="$HOME/.kiro/settings/mcp.json"
MCP_SERVER_PATH="/opt/homebrew/bin/github-mcp-server"

AWS_PROFILE_ARG=""
AWS_REGION="${DEFAULT_REGION}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE_ARG="--profile $2"; shift 2 ;;
    --region)  AWS_REGION="$2"; shift 2 ;;
    --help)    echo "Usage: $0 [--profile AWS_PROFILE] [--region AWS_REGION]"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "🔍 Checking prerequisites..."
for cmd in aws jq github-mcp-server; do
  if ! command -v $cmd &>/dev/null; then
    echo "❌ $cmd not found. Install: brew install $cmd"
    exit 1
  fi
done

echo "🔑 Verifying AWS credentials..."
if ! aws sts get-caller-identity $AWS_PROFILE_ARG --region "$AWS_REGION" &>/dev/null; then
  echo "❌ AWS credentials not configured. Run: aws configure (or aws sso login)"
  exit 1
fi
echo "   Account: $(aws sts get-caller-identity $AWS_PROFILE_ARG --region "$AWS_REGION" --output text --query 'Account')"

echo "📥 Fetching GitHub token from Secrets Manager..."
TOKEN=$(aws secretsmanager get-secret-value $AWS_PROFILE_ARG --region "$AWS_REGION" --secret-id "$SECRET_NAME" --query 'SecretString' --output text 2>&1)
if [[ $? -ne 0 ]] || [[ -z "$TOKEN" ]] || [[ "$TOKEN" == *"ResourceNotFoundException"* ]]; then
  echo "❌ Secret '$SECRET_NAME' not found. Ask your org admin to create it."
  exit 1
fi
if echo "$TOKEN" | jq -e '.token' &>/dev/null 2>&1; then TOKEN=$(echo "$TOKEN" | jq -r '.token'); fi
echo "   Token retrieved (${TOKEN:0:15}...)"

mkdir -p "$(dirname "$MCP_CONFIG")"
echo "⚙️  Updating $MCP_CONFIG..."

if [[ -f "$MCP_CONFIG" ]]; then
  UPDATED=$(jq --arg token "$TOKEN" --arg path "$MCP_SERVER_PATH" \
    '.mcpServers.github = {"command": $path, "args": ["stdio"], "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": $token}, "disabled": false, "autoApprove": ["search_code","get_file_contents","search_repositories","list_commits","list_pull_requests","create_or_update_file","push_files","create_repository"]}' "$MCP_CONFIG")
  echo "$UPDATED" > "$MCP_CONFIG"
else
  jq -n --arg token "$TOKEN" --arg path "$MCP_SERVER_PATH" \
    '{"mcpServers":{"github":{"command":$path,"args":["stdio"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":$token},"disabled":false,"autoApprove":["search_code","get_file_contents","search_repositories","list_commits","list_pull_requests","create_or_update_file","push_files","create_repository"]}}}' > "$MCP_CONFIG"
fi

echo ""
echo "✅ GitHub MCP configured! Restart Kiro or open a new chat."
echo "   Test: ask Kiro to 'list repos in enterpriseio'"
