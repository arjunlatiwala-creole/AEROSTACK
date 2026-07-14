---
title: Git Standards
inclusion: always
---

# enterprise Git Standards

## Commit Messages — Conventional Commits
```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Formatting, no code change
- `refactor` — Code change that neither fixes nor adds
- `perf` — Performance improvement
- `test` — Adding or fixing tests
- `chore` — Build process, dependencies, tooling
- `ci` — CI configuration changes
- `security` — Security fix or improvement (enterprise addition)

### Scope
Use the affected domain: `auth`, `dashboard`, `api`, `cdk`, `pipeline`, `compliance`

### Examples
```
feat(dashboard): add real-time pipeline status widget
fix(auth): handle expired session redirect correctly
security(api): add rate limiting to public endpoints
chore(deps): update shadcn/ui components to latest
refactor(forms): migrate contact form to react-hook-form + zod
```

## Branch Strategy
```
main                    # Production-ready, protected
├── develop             # Integration branch (optional for larger teams)
├── feat/TICKET-123-description
├── fix/TICKET-456-description
├── security/TICKET-789-description
└── release/v1.2.0      # Release candidates
```

- Branch from `main` (or `develop` if used)
- Branch names: `{type}/{ticket}-{short-description}`
- Delete branches after merge
- No direct commits to `main` — PR required

## Pull Request Requirements
- Descriptive title following conventional commit format
- Description includes: what changed, why, how to test
- Linked to ticket/issue
- All CI checks pass
- At least 1 approval required
- No merge conflicts
- Squash merge to `main` for clean history

## PR Template
```markdown
## What
Brief description of changes.

## Why
Business context or ticket reference.

## How to Test
Steps to verify the change works.

## Checklist
- [ ] Tests added/updated
- [ ] TypeScript strict mode passes
- [ ] No new `any` types introduced
- [ ] Accessibility checked (if UI change)
- [ ] Security implications considered
- [ ] Documentation updated (if needed)
```

## .gitignore Essentials
```
node_modules/
.next/
.env*.local
.env
!.env.example
*.pem
cdk.out/
coverage/
.venv/
__pycache__/
*.pyc
.DS_Store
.turbo/
*.tsbuildinfo
amplify/#current-cloud-backend/
amplify/backend/amplify-meta.json
package-lock.json
yarn.lock
```

## Secrets
- **NEVER commit secrets, tokens, API keys, or credentials**
- Use `.env.example` with placeholder values for documentation
- Pre-commit hook scans for secret patterns
- If a secret is accidentally committed: rotate immediately, do not just remove from history
