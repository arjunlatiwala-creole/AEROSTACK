---
title: Monorepo Standards
inclusion: always
---

# Monorepo Standards

> **DO NOT MODIFY this configuration without architect approval.** These patterns are load-bearing infrastructure. Changing package manager, workspace layout, or build orchestration breaks CI/CD, Amplify deployments, CDK synthesis, and every other package in the workspace. If something seems wrong, open an issue — do not "fix" it locally.

## Package Manager: pnpm (Non-Negotiable)

**pnpm is the only package manager.** No npm. No yarn. No exceptions.

```bash
# CORRECT
pnpm install
pnpm add <package>
pnpm add -D <package>
pnpm --filter web add <package>
pnpm --filter infra add <package>

# WRONG — these will break the workspace
npm install          # ← creates package-lock.json, corrupts node_modules
yarn add             # ← creates yarn.lock, different resolution algorithm
npx <tool>           # ← use pnpm dlx <tool> instead
```

### Why pnpm
- **Strict dependency resolution** — packages can only import what they explicitly declare. No phantom dependencies.
- **Disk efficient** — hard links, not copies. Monorepo with 3 packages doesn't triple your node_modules.
- **Fast** — consistently faster than npm/yarn on clean and cached installs.
- **Workspace-native** — `pnpm --filter` targets individual packages without cd-ing around.

### Lockfile Rules
- `pnpm-lock.yaml` is **always committed**. Never gitignored.
- If you see `package-lock.json` or `yarn.lock` in the repo, **delete it immediately** — it means someone used the wrong package manager.
- CI runs `pnpm install --frozen-lockfile`. If the lockfile is out of sync, CI fails. This is intentional.
- All dependency versions pinned (exact versions, no `^` or `~` in production packages).

### .npmrc Configuration
```ini
# .npmrc (committed to repo)
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
```

`shamefully-hoist=false` is critical — it enforces strict dependency isolation. Packages that work with hoisting but fail without it have undeclared dependencies. Fix the declaration, don't hoist.

## Workspace Configuration Files (Root Level)

These files live at the repo root and are **committed to git**. They standardize devex across the team so nobody's local setup drifts. Agents must not generate alternatives or overrides to these.

### .npmrc
```ini
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
engine-strict=true
```

### .nvmrc
```
20
```
Pins the Node.js version. Amplify, CI, and local dev all read this. If you use `fnm` or `volta` instead of `nvm`, they also respect this file.

### .node-version
```
20
```
Same as `.nvmrc` but for tools that prefer this format (fnm, asdf, mise). Keep both in sync.

### engines in root package.json
```json
{
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.4"
}
```
`engine-strict=true` in `.npmrc` makes this enforced, not advisory. Wrong Node version → install fails. Wrong package manager → install fails. The `packageManager` field enables Corepack — run `corepack enable` once and pnpm auto-installs at the correct version.

### .editorconfig
```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.py]
indent_size = 4
```
Every editor and IDE respects this. No more tabs-vs-spaces debates. No more CRLF sneaking in from Windows.

### .prettierrc
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

### .prettierignore
```
node_modules/
dist/
.next/
cdk.out/
coverage/
pnpm-lock.yaml
*.tsbuildinfo
.turbo/
```

### eslint.config.js (root)
```javascript
// Flat config format (ESLint v9+)
// Package-specific overrides in each package's eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    ignores: ['**/dist/', '**/cdk.out/', '**/.next/', '**/coverage/'],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

### .lintstagedrc
```json
{
  "packages/web/src/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "packages/common/src/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "packages/infra/**/*.ts": ["eslint --fix", "prettier --write"],
  "**/*.{json,md,yaml,yml}": ["prettier --write"]
}
```
Runs via `husky` pre-commit hook. Only lints/formats staged files, not the whole repo.

### .husky/pre-commit
```bash
#!/bin/sh
pnpm dlx lint-staged
```

### .husky/commit-msg
```bash
#!/bin/sh
pnpm dlx commitlint --edit $1
```

### commitlint.config.js
```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor', 'perf',
      'test', 'chore', 'ci', 'security', 'revert',
    ]],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
```

## Complete Root File Inventory

Every enterprise project root should have these files. If any are missing, the agent should flag it.
```
project-root/
├── .editorconfig           # Editor consistency
├── .eslint.config.js       # Linting (flat config)
├── .gitignore              # See git-standards.md
├── .husky/                 # Git hooks
│   ├── pre-commit          # lint-staged
│   └── commit-msg          # commitlint
├── .lintstagedrc           # Staged file processing
├── .node-version           # Node version (fnm/asdf/mise)
├── .npmrc                  # pnpm config, engine enforcement
├── .nvmrc                  # Node version (nvm)
├── .prettierrc             # Code formatting
├── .prettierignore         # Formatting exclusions
├── commitlint.config.js    # Commit message rules
├── package.json            # engines, packageManager, workspace scripts
├── pnpm-lock.yaml          # COMMITTED. ALWAYS.
├── pnpm-workspace.yaml     # Workspace package definitions
├── tsconfig.base.json      # Shared TypeScript config
└── turbo.json              # Build pipeline
```

**If a dev asks "how do I set up my local env":** `corepack enable && pnpm install`. That's it. Node version, pnpm version, formatting, linting, commit hooks — all auto-configured from these files.

## Build Orchestration: Turborepo

Turborepo manages build order, caching, and parallel execution across workspace packages.

### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "cdk.out/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:unit": {
      "dependsOn": ["^build"]
    },
    "test:integration": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "cdk:synth": {
      "dependsOn": ["^build"],
      "outputs": ["cdk.out/**"]
    },
    "cdk:deploy": {
      "dependsOn": ["cdk:synth"],
      "cache": false
    }
  }
}
```

### Key Rules
- **`dependsOn: ["^build"]`** means "build my dependencies first." `common` always builds before `web` or `infra`.
- **Never bypass Turbo** for cross-package operations. Don't `cd packages/web && pnpm build`. Use `pnpm turbo build --filter=web`.
- **Cache is on by default.** Turbo skips rebuilds when inputs haven't changed. If you think the cache is stale: `pnpm turbo build --force`. Don't disable caching globally.
- **`.turbo/` directory is gitignored.** It's local cache only.

### Common Commands
```bash
# Build everything (respects dependency order)
pnpm turbo build

# Build only the frontend
pnpm turbo build --filter=web

# Run all tests
pnpm turbo test

# Run tests in a specific package
pnpm turbo test --filter=common

# Dev server (frontend only, with common watching)
pnpm turbo dev --filter=web

# CDK operations
pnpm turbo cdk:synth --filter=infra
pnpm turbo cdk:deploy --filter=infra

# Type check everything
pnpm turbo typecheck

# Lint everything
pnpm turbo lint

# Force rebuild (ignore cache)
pnpm turbo build --force

# See what Turbo would do (dry run)
pnpm turbo build --dry-run
```

## Workspace Layout

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

```
project-root/
├── packages/
│   ├── web/              # Frontend (Vite or Next.js)
│   │   ├── src/
│   │   ├── package.json  # depends on "common": "workspace:*"
│   │   └── tsconfig.json # extends ../../tsconfig.base.json
│   ├── common/           # Shared types, validators, constants
│   │   ├── src/
│   │   ├── package.json  # no workspace dependencies
│   │   └── tsconfig.json # extends ../../tsconfig.base.json
│   └── infra/            # AWS CDK infrastructure
│       ├── lib/
│       ├── bin/
│       ├── package.json  # depends on "common": "workspace:*"
│       └── tsconfig.json # extends ../../tsconfig.base.json
├── turbo.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml        # COMMITTED. ALWAYS.
├── .npmrc                 # COMMITTED. strict isolation.
├── tsconfig.base.json     # Shared TypeScript config
├── .gitignore             # includes node_modules, .turbo, cdk.out
└── .kiro/
```

### Workspace Dependencies
Packages reference each other with `"workspace:*"`:

```json
// packages/web/package.json
{
  "name": "web",
  "dependencies": {
    "common": "workspace:*"
  }
}
```

```json
// packages/infra/package.json
{
  "name": "infra",
  "dependencies": {
    "common": "workspace:*"
  }
}
```

pnpm resolves `"workspace:*"` to the local package. No publishing, no linking, no path hacks.

### Adding a New Package
```bash
mkdir -p packages/newpkg/src
cd packages/newpkg

# Create package.json
cat > package.json << 'EOF'
{
  "name": "newpkg",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint src/"
  }
}
EOF

# Create tsconfig extending base
cat > tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
EOF

# Back to root, install
cd ../..
pnpm install
```

## TypeScript Configuration

### Base Config (Root)
```json
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

Every package extends this. Package-specific overrides go in the package's own `tsconfig.json`. Don't duplicate base settings.

### Project References
For packages that depend on `common`:
```json
// packages/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "references": [{ "path": "../common" }]
}
```

## Amplify Hosting

Amplify Hosting is the default deployment target for `packages/web`.

### amplify.yml (Monorepo-Aware)
```yaml
version: 1
applications:
  - appRoot: packages/web
    frontend:
      phases:
        preBuild:
          commands:
            - npm install -g pnpm
            - cd ../.. && pnpm install --frozen-lockfile
            - pnpm turbo build --filter=common
        build:
          commands:
            - pnpm turbo build --filter=web
      artifacts:
        baseDirectory: dist    # .next for Next.js projects
        files:
          - '**/*'
      cache:
        paths:
          - ../../node_modules/.pnpm/**/*
          - node_modules/**/*
```

### Branch Deployments
- `main` → production
- `develop` → staging
- PR branches → preview environments (automatic)

### Custom Build Images
Available for projects requiring specific Node versions, native dependencies, or custom tooling. Store build image definitions in `infra/` alongside CDK code.

### Amplify Environment Variables
- Set in Amplify Console, **never in repo**
- All `VITE_` prefixed vars are exposed to frontend at build time
- Backend environment variables go in Lambda/Fargate configuration via CDK, not Amplify

## CI/CD Integration

### GitHub Actions (if used alongside Amplify)
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint
      - run: pnpm turbo typecheck
      - run: pnpm turbo test
      - run: pnpm turbo build
```

### What CI Validates
- `--frozen-lockfile` — fails if lockfile doesn't match package.json. No silent dependency drift.
- Turbo respects the dependency graph — common builds first, then web and infra in parallel.
- Build output is deterministic. Same inputs → same outputs. Turbo cache makes repeated runs instant.

## .gitignore Additions
```
# Monorepo
node_modules/
.turbo/
*.tsbuildinfo

# Amplify
amplify/#current-cloud-backend/
amplify/backend/amplify-meta.json

# Package manager
# Keep pnpm-lock.yaml (DO NOT GITIGNORE)
package-lock.json
yarn.lock
```

## What Devs Must NOT Do

These will break the workspace. Hooks catch most of these, but agents should refuse to generate code that does any of the following:

- **Use `npm` or `yarn` for anything.** Not install, not run, not exec. `pnpm` only.
- **Run `npx`.** Use `pnpm dlx` instead.
- **Add `package-lock.json` or `yarn.lock`.** Delete on sight.
- **Set `shamefully-hoist: true`** in .npmrc. Fix the dependency declaration instead.
- **Bypass Turbo** for cross-package builds. Don't `cd` into a package and build it standalone.
- **Import from `../common/src/` directly.** Use the package name: `import { Thing } from 'common'`.
- **Put shared types in `packages/web`** instead of `packages/common`.
- **Modify `turbo.json` pipeline** without architect approval. Pipeline order is load-bearing.
- **Gitignore `pnpm-lock.yaml`.** Ever.
- **Use floating version ranges** (`^`, `~`) in production dependencies. Pin exact versions.
