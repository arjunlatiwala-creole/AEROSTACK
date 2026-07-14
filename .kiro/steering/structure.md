---
title: Project Structure
inclusion: always
---

# Project Structure

> **CUSTOMIZE THIS FILE** for each engagement. The base layout below is the enterprise Turborepo monorepo standard.

See `monorepo-standards.md` for workspace layout, package management (pnpm), and build orchestration (Turborepo). Do not deviate from the monorepo layout without architect approval.

See `frontend-architecture.md` for the full `packages/web/src/` structure.

## Workspace Packages

| Package | Purpose | Depends On |
|---------|---------|------------|
| `packages/web` | Frontend app (Vite or Next.js) | common |
| `packages/common` | Shared types, validators, constants | — |
| `packages/infra` | AWS CDK infrastructure | common |

## [Project-Specific Modules]

[Document your project's specific module boundaries, services, and how they map to workspace packages.]

## Naming Conventions

See `coding-standards.md` for naming rules. Key monorepo conventions:
- Package names in `package.json` are short (e.g., `"name": "web"`, not `"name": "@enterprise/web"`)
- Import shared code by package name: `import { User } from 'common'`
- Never use relative paths across package boundaries