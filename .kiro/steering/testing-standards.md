---
title: Testing Standards
inclusion: always
---

# enterprise Testing Standards

## Test Stack
| Layer | Tool | Scope |
|-------|------|-------|
| Unit (JS/TS) | Vitest | Functions, hooks, utilities |
| Component | React Testing Library | UI component behavior |
| Integration | Vitest + MSW | API integration, data flow |
| E2E | Playwright | Critical user journeys |
| Infrastructure | Jest (CDK) | Stack assertions, security checks |
| Backend (Python) | pytest | Services, handlers, models |
| Performance | Lighthouse CI | Core Web Vitals gates |

## Vitest Configuration
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    // Minimal output — prevent timeout in CI
    reporters: ['default'],
    silent: true,
  },
});
```

## What to Test

### ALWAYS Test
- Server Actions — input validation, error handling, return types
- Business logic in `lib/` — calculations, transformations, decisions
- Zustand stores — state transitions, derived state
- Custom hooks — state management, side effect behavior
- Zod schemas — valid inputs accepted, invalid inputs rejected with correct messages
- CDK constructs — security properties, resource configuration
- Python services — business rules, data transformations

### Test Selectively
- React components — test BEHAVIOR, not implementation. Focus on:
  - User interactions (click, type, submit)
  - Conditional rendering based on props/state
  - Accessibility (role attributes, keyboard navigation)
  - Error states and loading states
- API Route Handlers — integration tests with MSW

### DO NOT Unit Test
- shadcn/ui components — they're tested upstream
- Tailwind class strings — not behavioral
- Static layouts with no logic
- Third-party library internals

## React Testing Library Patterns

```typescript
// ✅ Good — tests behavior, not implementation
test('submits form with valid data', async () => {
  const user = userEvent.setup();
  render(<ContactForm onSubmit={mockSubmit} />);

  await user.type(screen.getByLabelText(/name/i), 'Jane Doe');
  await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
  await user.click(screen.getByRole('button', { name: /submit/i }));

  expect(mockSubmit).toHaveBeenCalledWith({
    name: 'Jane Doe',
    email: 'jane@example.com',
  });
});

// ❌ Bad — tests implementation details
test('sets state when input changes', () => {
  const { result } = renderHook(() => useContactForm());
  act(() => result.current.setName('Jane'));
  expect(result.current.name).toBe('Jane');
});
```

### Query Priority
1. `getByRole` — accessible queries first
2. `getByLabelText` — form elements
3. `getByText` — visible text
4. `getByTestId` — last resort, add `data-testid` sparingly

## Playwright E2E Tests
- Cover critical user journeys only — login, core workflow, payment
- Run against staging environment in CI
- Use page object pattern for maintainability
- Visual regression tests for key pages

```typescript
// e2e/auth.spec.ts
test('user can log in and access dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('testpassword');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});
```

## Python Testing (pytest)
```bash
# Run command — fast, minimal output
pytest -q --tb=short -x --cov=src --cov-report=term-missing
```

- Fixtures in `conftest.py` — shared test data, mock clients
- `moto` for AWS service mocking (S3, DynamoDB, SQS, etc.)
- Factory pattern for test data generation
- Separate `unit/` and `integration/` directories

## API Contract Testing
- Every API project with an OpenAPI spec must have contract tests
- Contract tests validate that Route Handler responses match the OpenAPI schema
- Use `@apidevtools/swagger-parser` to load and validate the spec
- Use `ajv` to validate response bodies against JSON Schema from the spec
- Contract tests run in CI alongside unit and integration tests
- Test both success paths AND error responses (400, 401, 404, 500)

```typescript
// Pattern: validate real responses against OpenAPI spec
const spec = await SwaggerParser.validate('openapi.yaml');
const schema = spec.paths['/endpoint'].get.responses['200']
  .content['application/json'].schema;
const validate = ajv.compile(schema);
expect(validate(responseBody)).toBe(true);
```

## CI Integration
```yaml
# Tests must pass before merge
- name: Test
  run: |
    pnpm turbo test --filter=web -- --silent --coverage
    pnpm dlx playwright test
    pytest -q --tb=short -x
```

## Coverage Requirements
| Layer | Minimum | Target |
|-------|---------|--------|
| Business logic (`lib/`, `services/`) | 80% | 90% |
| Server Actions | 80% | 90% |
| React components | 60% | 75% |
| CDK constructs | 90% | 95% |
| Python handlers | 70% | 85% |
| E2E critical paths | N/A | 100% of defined journeys |

## GRC Testing Requirements
- Security-critical paths require dedicated test suites
- Auth flows: test unauthorized access, token expiry, session management
- Data access: test role-based visibility, data isolation between tenants
- Audit logging: verify audit events are emitted for data-modifying operations
- Input validation: fuzz testing for public-facing endpoints
