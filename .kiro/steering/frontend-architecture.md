---
title: Frontend Architecture Standards
inclusion: always
---

# enterprise Frontend Architecture Standards

## Core Principle
**The framework is a runtime target, not an architecture. Standards operate above the framework layer so that choosing or switching runtimes is never a refactor event and never creates tech debt.**

Every enterprise frontend project shares the same component patterns, state management, testing approach, folder conventions, and API contracts. The only variance is a thin routing/data-fetching layer that adapts to the runtime. A developer moving between projects finds the same codebase shape.

## Runtime Target Decision

Made once at project kickoff. Not revisited unless requirements fundamentally change at a major milestone.

| Choose Vite + React when | Choose Next.js (App Router) when |
|--------------------------|----------------------------------|
| Agentic SaaS, MVPs, internal tools | Enterprise clients, GRC/compliance projects |
| Pure SPA / PWA behavior needed | SEO-driven pages required |
| Static hosting preferred (S3/CloudFront) | Server-side data boundary required (PII control) |
| Fastest build/dev cycle priority | Server Components simplify data architecture |

**Default: Vite + React** — unless the project has a specific, documented reason for Next.js. This aligns with enterprise's API-first, clean separation model.

**When Next.js is used:** Server Components are the documented exception to strict frontend/backend separation. The standard acknowledges this: RSC acts as a server-side data boundary, not a replacement for the API layer. APIs still exist for all business logic. Server Components consume them.

## Backend: AWS-Native First

Use AWS managed services where possible and advantageous. Fall back to containers or custom compute only when a managed service doesn't exist for the workload or when integrating with systems that require persistent processes.

### Compute Preference Hierarchy
1. **AWS Lambda** (default) — stateless request handlers, event processing, API backends
2. **ECS Fargate / App Runner** — long-running processes, WebSocket servers, legacy integrations, workloads that exceed Lambda limits (15min timeout, 10GB memory, connection pooling)
3. **EC2** (last resort) — only when a specific dependency requires a VM (GPU workloads, licensed software, stateful daemons). Must be documented and justified.

**The rule is: start serverless, escalate to containers when you hit a real constraint, escalate to VMs only when containers can't do it.** Never start at a higher tier out of habit or convenience.

| Layer | Default | Container/VM Alternative | When to Escalate |
|-------|---------|--------------------------|-----------------|
| **Compute** | Lambda (Python or Node.js) | ECS Fargate / App Runner | Long-running, WebSockets, connection pooling |
| **API** | API Gateway REST or HTTP APIs | ALB + Fargate | Custom protocols, gRPC, persistent connections |
| **Auth** | AWS Cognito | Cognito (stays the same) | — |
| **Database** | DynamoDB (default), RDS/Aurora (relational) | Same | — |
| **Storage** | S3 with CloudFront | Same | — |
| **Background Jobs** | Step Functions + Lambda | ECS tasks | Jobs > 15min, complex retry/state |
| **Infrastructure** | AWS CDK (TypeScript) | CDK (same — manages all tiers) | — |
| **AI/Agents** | Bedrock / AgentCore | Custom model hosting on SageMaker/ECS | Custom fine-tuned models, non-Bedrock providers |

### Third-Party Backends
No Squid, no Lyzr, no Supabase for new projects. If a client engagement requires integrating with an external platform or service, it connects through the API layer as an external dependency — not as a replacement for AWS infrastructure.

**API-First Rule:** Frontend communicates with backend exclusively through stateless, callable APIs. No direct database access from frontend. No embedded backend logic in frontend routing. This holds regardless of whether the backend is Lambda, Fargate, or a VM — the API contract is the same.

## Universal Stack (Identical Across Runtimes)

| Layer | Standard | Why |
|-------|----------|-----|
| **Language** | TypeScript (strict mode) | See `typescript-standards.md` |
| **Components** | shadcn/ui + Radix UI | Accessible, brandable, auditable. See `component-library.md` |
| **Styling** | Tailwind CSS | Via shadcn/ui theme tokens. Light/dark mode required. |
| **Client State** | Zustand | Pure UI state: sidebar, filters, wizard steps. ~1KB, works in both runtimes. |
| **Server State** | TanStack Query | Caching, polling, optimistic updates. Identical API in Vite and Next.js. |
| **Form State** | react-hook-form + Zod | Local to form component, never in global state. |
| **Validation** | Zod | Shared schemas between frontend and backend via `common/` |
| **Routing** | React Router (Vite) or App Router (Next.js) | Same route structure, different wiring |
| **Testing** | Vitest + React Testing Library + Playwright | Identical test suite across runtimes |
| **API Contracts** | OpenAPI 3.1 + Swagger UI | Every endpoint documented, contract-tested |
| **Auth** | AWS Cognito | Amplify client (Vite) or Auth.js server sessions (Next.js) |
| **Theme** | CSS variable system via Tailwind | Light/dark mode switcher, client-brandable |
| **Analytics** | Provider-agnostic wrapper | GA, PostHog, Chatwoot — disabled unless .env keys provided |
| **AI Chat** | Provider-agnostic interface | Bedrock-backed, swappable model, conversation persistence |

### Why Zustand + TanStack Query (not Redux)
Redux was the earlier enterprise standard. We've moved to Zustand + TanStack Query because:
- TanStack Query eliminates 80% of what Redux was doing (async data fetching, caching, loading states)
- Zustand handles the remaining UI state in ~1KB with almost no boilerplate
- Both work identically in Vite and Next.js — no framework-specific adaptation
- Moving a project between runtimes requires zero state management changes
- Redux stays acceptable in existing projects — no forced migration. New projects use Zustand + TQ.

## Universal Project Structure

```
project-root/
├── src/
│   ├── app/ OR pages/              # Runtime-specific (ONLY difference)
│   ├── components/
│   │   ├── ui/                     # shadcn/ui (generated, don't manually edit)
│   │   ├── forms/                  # Form compositions
│   │   ├── layouts/                # Page layouts, sidebar, navigation
│   │   ├── chat/                   # AI chat interface components
│   │   └── [feature]/              # Feature-specific components
│   ├── lib/
│   │   ├── api/                    # API client (typed fetch wrappers per endpoint)
│   │   ├── queries/                # TanStack Query hooks
│   │   ├── stores/                 # Zustand stores (UI state only)
│   │   ├── hooks/                  # Custom React hooks
│   │   ├── utils/                  # Pure utility functions
│   │   ├── validators/             # Zod schemas (import from common/ where shared)
│   │   └── auth/                   # Cognito auth integration
│   ├── types/                      # Frontend-specific TypeScript types
│   ├── config/                     # Feature flags, environment config
│   ├── styles/
│   │   └── globals.css             # Tailwind config, CSS variable themes
│   └── test/                       # Test setup, test utilities
├── common/                         # SHARED between frontend and backend
│   ├── types/                      # Shared TypeScript interfaces
│   ├── validators/                 # Shared Zod schemas
│   └── constants/                  # Shared enums, constants
├── infra/                          # AWS CDK infrastructure
├── openapi.yaml                    # API contract (source of truth)
├── README.md                       # Project setup, credentials, team notes
├── .env.example                    # Environment variable template (no real values)
└── .kiro/                          # Standards enforcement (this package)
    ├── steering/                   # Always-on agent context
    ├── hooks/                      # Automated quality gates
    ├── settings/                   # MCP server configuration
    ├── skills/                     # Reusable capability patterns
    └── specs/                      # Generated from upstream process artifacts
```

### The `common/` Directory
Shared types and validators between frontend and backend. This is how we maintain type safety across the API boundary without duplication.

```typescript
// common/types/user.ts
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user' | 'viewer';
}

// common/validators/user.ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  role: z.enum(['admin', 'user', 'viewer']),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// Frontend uses it in forms:
// import { createUserSchema } from '@common/validators/user';

// Backend uses it in Lambda handlers:
// import { createUserSchema } from '@common/validators/user';
```

## Spec Generation: enterprise Value Chain → Kiro Specs

The Kiro development process starts upstream with enterprise's strategic methodology:

```
MIRA GAME (Strategic Discovery)
  Working Backwards → ICP → GTM → Core Value
         ↓
TECHNICAL TRANSLATION (Architecture Inputs)
  MVJ + Core Value → System Design → Six Spec Input Artifacts
         ↓
KIRO DEVELOPMENT (This Framework)
  Spec inputs → Kiro generates .kiro/specs/ → Agent builds from specs
```

The spec inputs aren't invented during development — they're the natural output of the strategic process. No strategic clarity → no good specs → no good code.

enterprise's business process produces artifacts that flow into Kiro as spec generation inputs. The pipeline:

```
Working Backwards / ICP / GTM process
         ↓
MVJ (Minimal Viable Journeys) + Core Value Logic
         ↓
Technical Translation: system design, architecture decisions
         ↓
Artifacts fed into Kiro as spec inputs:
  - DevSpine (milestones from SOW)
  - DefOfDone (acceptance criteria per milestone)
  - MVJ (critical user flows)
  - TestPlan (what to validate)
  - Structure (modularization map — how modules/packages/boundaries are organized)
  - DbApiMap (database schema + API endpoint inventory — what data exists and how to reach it)
         ↓
Kiro generates .kiro/specs/ from these inputs
         ↓
Agent builds from specs, guided by steering docs + hooks
```

**These artifacts are inputs, not maintained files.** You don't keep a `/docs` directory current during development. You feed the upstream outputs into Kiro once (or at milestone boundaries), Kiro decomposes them into specs with tasks and acceptance criteria, and the specs drive the build.

**What the agent needs during development is already in steering:**
- Project structure → `frontend-architecture.md` (universal structure)
- API contracts → `openapi.yaml` (source of truth at project root)
- Tech stack → `tech.md` steering file
- Coding patterns → language-specific steering docs
- Security/compliance → `security-standards.md`, `grc-compliance.md`

**The only persistent project-level files are:**
- `README.md` — credentials, environment setup, team-specific notes
- `openapi.yaml` — API contract (validated by hooks)
- `.kiro/specs/` — generated from upstream artifacts

## API Client Pattern

All API communication goes through a typed client layer. Never call `fetch()` directly from components.

```typescript
// lib/api/client.ts — base API client
const API_BASE = import.meta.env.VITE_API_URL; // or process.env.NEXT_PUBLIC_API_URL

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  const token = await getAuthToken(); // Cognito token
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    return { success: false, error: `${res.status}: ${res.statusText}` };
  }
  const data = await res.json();
  return { success: true, data };
}

// lib/api/users.ts — typed endpoint functions
import type { User, CreateUserInput } from '@common/types/user';

export const usersApi = {
  list: (page = 1, limit = 20) =>
    apiRequest<User[]>(`/users?page=${page}&limit=${limit}`),
  getById: (id: string) =>
    apiRequest<User>(`/users/${id}`),
  create: (input: CreateUserInput) =>
    apiRequest<User>('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

// lib/queries/users.ts — TanStack Query hooks (used in components)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api/users';

export function useUsers(page = 1) {
  return useQuery({
    queryKey: ['users', page],
    queryFn: () => usersApi.list(page),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
```

## Auth: AWS Cognito Integration

### Vite Projects
```typescript
// lib/auth/cognito.ts
import { Amplify } from 'aws-amplify';
import { signIn, signUp, signOut, getCurrentUser, resetPassword,
         confirmResetPassword, fetchAuthSession } from 'aws-amplify/auth';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
    },
  },
});

export const auth = { signIn, signUp, signOut, getCurrentUser, resetPassword,
                      confirmResetPassword, fetchAuthSession };
```

### Next.js Projects
Use Auth.js with Cognito provider for server-side session management. See `security-standards.md`.

### Auth Pathways Required
Every project must implement these flows (prep all, integrate with Cognito):
- Sign in (email + password)
- Sign up (with email verification)
- Sign out
- Password change (authenticated)
- Password reset (forgot password via email)
- Account recovery

### User Profile
- Instantiate user profile record in database upon signup (Cognito post-confirmation trigger)
- User can independently edit all profile elements
- Profile data accessed via API, never directly from Cognito attributes for business data

## Theme System

Light/dark mode is required for all projects.

```css
/* styles/globals.css */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    /* ... shadcn/ui default tokens */
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark variants */
  }
}
```

```typescript
// lib/hooks/use-theme.ts — works in both Vite and Next.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeStore {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'enterprise-theme' }
  )
);
```

## Analytics & Integrations (Provider-Agnostic)

All integrations are disabled by default. Enabled only when API keys are present in `.env`.

```typescript
// lib/analytics/provider.ts
interface AnalyticsProvider {
  init(): void;
  track(event: string, properties?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  page(name: string): void;
}

// Implementations: Google Analytics, PostHog, etc.
// Active provider determined by which .env keys are present
// No analytics code runs if no keys configured

// .env.example
// VITE_GA_MEASUREMENT_ID=        # Google Analytics
// VITE_POSTHOG_KEY=              # PostHog
// VITE_CHATWOOT_TOKEN=           # Chatwoot support widget
// VITE_AI_CHAT_PROVIDER=bedrock  # AI chat backend
```

## AI Chat Integration (Provider-Agnostic)

```typescript
// lib/chat/provider.ts
interface ChatProvider {
  sendMessage(message: string, conversationId?: string): Promise<ChatResponse>;
  getHistory(conversationId: string): Promise<ChatMessage[]>;
  listConversations(userId: string): Promise<Conversation[]>;
}

interface ChatResponse {
  message: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
}

// Default implementation: AWS Bedrock via API Gateway
// Conversation history persisted in DynamoDB
// Provider swappable without frontend changes
```

## PWA Requirements (Vite Projects)

When building PWAs (default for Vite projects):
- Service worker via `vite-plugin-pwa`
- Offline fallback page
- App manifest with icons (192px, 512px)
- Install prompt handling
- Cache strategy: network-first for API, cache-first for static assets

## Design Patterns (Universal)

- **Single Responsibility** — one component/function does one thing
- **Separation of Concerns** — UI, state, data fetching, business logic in separate layers
- **Dependency Injection** — external services (auth, analytics, AI chat) abstracted behind interfaces
- **DRY** — shared logic in `common/`, `lib/hooks/`, or `lib/utils/`
- **Defensive Programming** — components fail safely with fallback states and loading skeletons
- **No hardcoded values** — all configuration via .env
- **No code duplication** — never create `_fixed`, `_clean`, `_backup` file variants

## Performance Requirements

See `performance-standards.md` for full budgets. Key targets:
- Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1
- Bundle: < 200KB initial JS (gzipped)
- Lighthouse: 90+ across all categories (mobile and desktop)
- Full responsive design — no overflow, no hidden fields
