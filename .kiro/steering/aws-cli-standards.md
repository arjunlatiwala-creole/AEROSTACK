---
title: AWS CLI Best Practices
inclusion: fileMatch
fileMatchPattern: "*.sh,*.bash,*aws*,*cli*"
---

# enterprise AWS CLI Standards

## Session Configuration
```bash
# Always set --no-cli-pager to prevent interactive pager in CI/scripts
export AWS_PAGER=""
# Or per-command: aws s3 ls --no-cli-pager
```

## Authentication
- **Never use long-term credentials** (access keys) in development or CI
- Use AWS SSO (`aws sso login`) for developer access
- Use OIDC (GitHub Actions → IAM role) for CI/CD
- Use IAM roles for EC2/Lambda/ECS — never embedded credentials
- If access keys are unavoidable: rotate every 90 days, never commit

## CLI Output Handling
- Use `--output json` for scripting, `--output table` for human reading
- Use `--query` (JMESPath) to filter output server-side
- Pipe JSON output to `jq` for complex transformations

```bash
# ✅ Good — filtered query, no pager
aws ec2 describe-instances \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,Tags[?Key==`Name`].Value|[0]]' \
  --output table \
  --no-cli-pager

# ❌ Bad — unfiltered, might hang in CI
aws ec2 describe-instances
```

## Profile Management
- Named profiles for each AWS account/environment
- Default profile should be the LEAST privileged (dev or read-only)
- Never set production credentials as default profile

```bash
# ~/.aws/config
[profile enterprise-dev]
sso_start_url = https://enterprise.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-east-1
output = json

[profile enterprise-prod]
sso_start_url = https://enterprise.awsapps.com/start
sso_account_id = 987654321098
sso_role_name = ReadOnlyAccess
region = us-east-1
```

## Scripting Safety
- Always check command exit codes: `set -euo pipefail` in bash scripts
- Use `--dry-run` for destructive operations when available
- Log all CLI operations in automation scripts
- Use `aws sts get-caller-identity` to verify active credentials before operations
