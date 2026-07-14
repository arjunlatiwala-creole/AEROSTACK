---
title: TypeScript Standards
inclusion: always
---

# enterprise TypeScript Standards

## Compiler Configuration
```jsonc
// tsconfig.json — non-negotiable settings
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Monorepo TypeScript Configuration
All packages extend `tsconfig.base.json` at the repo root. Package-specific overrides go in each package's `tsconfig.json`. See `monorepo-standards.md` for the base config, project references, and workspace dependency patterns. Do not duplicate base compiler options in package-level configs. Import shared code by package name (`import { User } from 'common'`), never by relative path across package boundaries.
```

**`enterprise-iac-standards.md`** — find:
```
- `cdk synth` must pass before any commit
```

Replace with:
```
- `pnpm turbo cdk:synth --filter=infra` must pass before any commit (see `monorepo-standards.md` for Turbo pipeline)
```

And find:
```
- Run with: `npx jest --silent`
```

Replace with:
```
- Run with: `pnpm turbo test --filter=infra`

## Type Safety Rules
- **No `any`** — Use `unknown` and narrow with type guards
- **No `@ts-ignore`** — Use `@ts-expect-error` with explanation comment if absolutely necessary
- **No type assertions (`as`)** unless narrowing from `unknown` after validation
- **No non-null assertions (`!`)** — Handle the null case explicitly
- **Prefer `interface` for object shapes** — Use `type` for unions, intersections, and utility types
- **Zod for runtime validation** — Every external input (API response, form data, env vars) validated with Zod

## Naming Conventions
- **Interfaces/Types:** PascalCase — `UserProfile`, `DashboardProps`
- **Enums:** PascalCase with PascalCase members — `UserRole.Admin`
- **Functions/Variables:** camelCase — `getUserProfile`, `isAuthenticated`
- **Constants:** SCREAMING_SNAKE_CASE — `MAX_RETRY_COUNT`, `API_BASE_URL`
- **Files:** kebab-case — `user-profile.ts`, `dashboard-utils.ts`
- **React Components:** PascalCase files — `UserProfile.tsx` (exception to kebab-case)
- **Boolean variables:** Prefix with `is`, `has`, `should`, `can` — `isLoading`, `hasPermission`

## Error Handling — Result Pattern
For operations that can fail, use a typed Result pattern instead of try/catch at every level:

```typescript
// lib/types/result.ts
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// Usage in Server Actions
async function createUser(input: CreateUserInput): Promise<Result<User, string>> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Invalid input' };
  }
  try {
    const user = await db.user.create({ data: parsed.data });
    return { success: true, data: user };
  } catch {
    return { success: false, error: 'Failed to create user' };
  }
}
```

## Function Patterns
- **Prefer named exports** — `export function` over `export default`
- **Explicit return types** on exported functions and Server Actions
- **Early returns** for guard clauses — reduce nesting
- **No function declarations longer than 50 lines** — extract helpers
- **Pure functions where possible** — no side effects, predictable outputs

## Import Organization
```typescript
// 1. React / Next.js
import { Suspense } from 'react';
import { notFound } from 'next/navigation';

// 2. Third-party libraries
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';

// 3. Internal aliases (@/)
import { Button } from '@/components/ui/button';
import { getUserById } from '@/lib/queries/users';

// 4. Relative imports (only within same feature)
import { formatStatus } from './utils';
```

## Zod Schema Conventions
- Schemas live in `lib/validators/` organized by domain
- Schema names: `entityActionSchema` — `userCreateSchema`, `dealUpdateSchema`
- Infer types from schemas: `type UserCreate = z.infer<typeof userCreateSchema>`
- Shared between client forms and Server Actions — single source of truth
- Custom error messages for user-facing validation

## Forbidden Patterns
- `Object` — use `Record<string, unknown>` or specific interface
- `Function` — use specific function signature
- `String`, `Number`, `Boolean` — use lowercase primitives
- Nested ternaries — use early returns or switch statements
- String enums for API values — use `as const` objects with Zod
