---
title: enterprise Coding Standards
inclusion: always
---

# enterprise Coding Standards

## Core Philosophy
- **Explicit over implicit.** No magic. Name things clearly.
- **Small functions, single responsibility.** If it needs a comment explaining what it does, it's too complex or poorly named.
- **Fail fast, fail loud.** Validate inputs at boundaries. Don't silently swallow errors.
- **No premature abstraction.** Build concrete first. Abstract when you see the pattern repeated, not when you imagine it might be.

## Error Handling
- Custom exception hierarchy per domain (not generic Exception catches)
- Structured error responses: `{ "error": { "code": "...", "message": "...", "context": {} } }`
- All errors logged with correlation ID
- Never expose internal stack traces to end users

## What Agents Must NOT Generate
- Boilerplate comments (e.g., "// This function does X")
- TODO comments — create issues instead
- Unused imports or dead code
- .env files with real values (use .env.example only)
- Duplicate files with suffixes like `_fixed`, `_clean`, `_backup`

## Code Quality Rules
- No hardcoded values — all config via .env
- No code duplication (DRY)
- Pin all dependency versions, use lockfiles
- Async/await for I/O, event-driven design
- Fault-tolerance with safe fallback states
- CI/CD ready from the start

## Package Management
pnpm is the only package manager. Turborepo orchestrates builds across workspace packages. These are non-negotiable — see `monorepo-standards.md` for all rules, commands, and enforcement. Agents must refuse to generate any code that uses npm, yarn, or npx.

## Language-Specific Standards
See `typescript-standards.md`, `python-standards.md`, and `frontend-architecture.md`.
