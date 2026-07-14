#!/usr/bin/env bash
# =============================================================================
# enterprise Admin: Create/Update GitHub MCP Token in Secrets Manager
# =============================================================================
# Run this as an org admin to store or rotate the GitHub PAT.
# Devs then run bootstrap-github-mcp.sh to pull it locally.
#
# Usage:
#   .kiro/scripts/admin-setup-github-secret.sh
#   .kiro/scripts/admin-setup-github-secret.sh --profile admin-profile --region us-east-1
# =============================================================================

set -euo pipefail

SECRET_NAME="enterpriseio/kiro-github-mcp-token"
DEFAULT_REGION="us-east-2"
AWS_PROFILE_ARG=""
AWS_REGION="${DEFAULT_REGION}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE_ARG="--profile $2"; shift 2 ;;
    --region)  AWS_REGION="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "🔐 enterprise GitHub MCP Token Admin Setup"
read -sp "Paste the GitHub fine-grained PAT (github_pat_...): " TOKEN
echo ""
[[ -z "$TOKEN" ]] && echo "❌ No token provided." && exit 1

if aws secretsmanager describe-secret $AWS_PROFILE_ARG --region "$AWS_REGION" --secret-id "$SECRET_NAME" &>/dev/null 2>&1; then
  echo "📝 Updating existing secret..."
  aws secretsmanager put-secret-value $AWS_PROFILE_ARG --region "$AWS_REGION" --secret-id "$SECRET_NAME" --secret-string "$TOKEN"
else
  echo "🆕 Creating new secret..."
  aws secretsmanager create-secret $AWS_PROFILE_ARG --region "$AWS_REGION" --name "$SECRET_NAME" --description "GitHub PAT for Kiro MCP (enterpriseio org)" --secret-string "$TOKEN"
fi

echo "✅ Done. Tell devs to run: .kiro/scripts/bootstrap-github-mcp.sh"
