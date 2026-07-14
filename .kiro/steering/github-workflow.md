---
inclusion: auto
---

# GitHub Workflow Rules

> Supplements git-standards.md and mcp-best-practices.md.
> In case of conflict, git-standards.md governs commit format, branching, and PR requirements.

## Default Organization
- Default org is `enterpriseio`. Assume `enterpriseio` unless the user specifies otherwise.
- Never create repos under personal accounts unless explicitly asked.

## Repository Creation
- Use MCP `create_repository` with `organization: "enterpriseio"` — always include the org parameter.
- Default to `private: true` unless the user explicitly asks for public.

## Template Repos
- `enterpriseio/enterprise-aidlc-kiro-standards-template` — general AIDLC projects
- `enterpriseio/enterprise-hubspot-kiro-standards-template` — HubSpot CMS projects
- `enterpriseio/enterprise-agentic-kiro-standards-template` — pure agentic/agentcore projects
- To create from template via CLI: `gh repo create enterpriseio/<new-repo> --template enterpriseio/<template-repo> --private --clone`

## Initial Push (Bootstrap Exception)
- Per git-standards.md, `main` is protected and requires PRs for normal work.
- **Exception**: When bootstrapping a brand-new repo, push the initial commit directly to `main`.
- Use conventional commit format: `chore: initial project scaffold`
- After the initial push, all subsequent work follows git-standards.md: feature branches, PRs, squash merge.

## MCP GitHub Server
- Using the official `github/github-mcp-server` (Homebrew: `/opt/homebrew/bin/github-mcp-server stdio`).
- Token vended via AWS Secrets Manager (`enterpriseio/kiro-github-mcp-token` in us-east-2, account 717976183293).
- Dev setup: `brew install github-mcp-server jq && .kiro/scripts/bootstrap-github-mcp.sh`
- MCP tools are the preferred method for all GitHub operations.
- Fall back to `gh` CLI only if MCP tools fail.

## DESTRUCTIVE OPERATIONS — BLOCKED
The following are **never** permitted via MCP or CLI without explicit user confirmation:
- Repository deletion
- Force push (`git push --force`)
- Branch deletion of `main` or `develop`
- Branch protection changes
- Organization settings changes
- Webhook creation or modification
- Team/member permission changes
- Transfer repository ownership

If needed, inform the user and let them do it manually on GitHub.

## Allowed Operations (No Confirmation Needed)
- Create repositories (under `enterpriseio` with `organization` parameter)
- Read files, search code, list repos/issues/PRs/commits
- Create and update files, push files
- Create branches, pull requests, issues
- Add comments and reviews

## PRs and Merges
- PR titles follow conventional commit format per git-standards.md.
- Squash merge to `main` per git-standards.md.

## Branch Naming
- Per git-standards.md: `{type}/{ticket}-{short-description}`
