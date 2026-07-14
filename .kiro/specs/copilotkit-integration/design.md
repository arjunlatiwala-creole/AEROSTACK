# CopilotKit Integration — Design

## Architecture

```
┌─────────────────────────────────────────────────┐
│  pwa-frontend                                   │
│                                                 │
│  main.tsx                                       │
│    └─ <CopilotKit runtimeUrl="/copilot">        │
│         └─ <AuthProvider>                       │
│              └─ <QueryClientProvider>            │
│                   └─ <RouterProvider>            │
│                                                 │
│  ContentCreator.tsx                              │
│    ├─ useCopilotReadable({ draft, brief })      │
│    ├─ useCopilotAction("revise_draft")          │
│    │    └─ calls contentApi.generateDraft()     │
│    │         with feedback in customContext      │
│    ├─ useCopilotAction("review_draft")          │
│    │    └─ calls contentApi.reviewDraft()       │
│    └─ <CopilotSidebar />                        │
│                                                 │
└──────────────────┬──────────────────────────────┘
                   │ HTTPS
                   ▼
┌─────────────────────────────────────────────────┐
│  tools-api (API Gateway + Lambda)               │
│                                                 │
│  /copilot  →  copilot/handler.py (NEW)          │
│    └─ CopilotKit runtime protocol               │
│    └─ Registers actions: revise_draft,          │
│       review_draft                              │
│    └─ Calls _call_bedrock() for LLM             │
│                                                 │
│  /content  →  content/handler.py (EXISTING)     │
│    └─ generate_draft (existing, unchanged)      │
│    └─ review_draft (NEW action)                 │
│                                                 │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  AWS Bedrock (Claude Sonnet 4)                  │
│  DynamoDB (content table, KB table)             │
└─────────────────────────────────────────────────┘
```

## Approach Decision: Frontend-Driven Actions

CopilotKit supports two patterns:
1. **Frontend actions** — `useCopilotAction` in React, calls existing API endpoints
2. **Backend runtime** — CopilotKit runtime on server, actions defined server-side

We use **frontend actions** (pattern 1) because:
- The existing `contentApi` client already handles all API calls
- No new backend runtime endpoint needed (simpler, fewer moving parts)
- Actions can directly update React state (drafts, revision count)
- Matches the existing Vite SPA architecture

CopilotKit's `<CopilotKit>` provider only needs a `publicApiKey` or self-hosted runtime URL. For the initial implementation, we'll use CopilotKit Cloud (free tier) to avoid building a custom runtime. If we need to self-host later, we add a Lambda endpoint.

## Component Changes

### main.tsx
- Wrap the app with `<CopilotKit>` provider (outermost, before AuthProvider)
- Configure with CopilotKit Cloud API key via `VITE_COPILOTKIT_PUBLIC_API_KEY` env var

### ContentCreator.tsx
- Add `useCopilotReadable` in the main `ContentCreator` component to expose:
  - `generatedDrafts` array (current drafts)
  - `wizard` state (brief parameters)
- Add `useCopilotAction("revise_draft")` with parameters:
  - `briefId: string` — which brief to revise
  - `feedback: string` — natural language revision instructions
  - Handler: calls `contentApi.generateDraft(briefId, { ...existingBrief, customContext: feedback })`
  - Updates `generatedDrafts` state with new content
- Add `useCopilotAction("review_draft")` with parameters:
  - `briefId: string` — which brief to review
  - `draftContent: string` — the draft text to review
  - Handler: calls `contentApi.reviewDraft(briefId)` (new endpoint)
  - Returns structured feedback object
- Add `<CopilotSidebar>` conditionally rendered when drafts exist

### content-api.ts
- Add `reviewDraft` method to `contentApi` object
- Calls `/content` with `action: "review_draft"`

### content/handler.py
- Add `review_draft` action to the POST router
- New `_review_draft()` function that:
  - Loads the brief and latest draft from DynamoDB
  - Pulls KB context (same as generation)
  - Builds a review-specific prompt asking for structured feedback
  - Returns: `{ brand_alignment, tone_match, platform_fit, suggestions[], overall_score }`

## State Management

Revision tracking lives in component state (not Zustand — it's local to ContentCreator):

```typescript
interface RevisionState {
  briefId: string;
  revisionCount: number;
  maxRevisions: 2;
  lastFeedback: string;
}
```

The `revise_draft` action increments `revisionCount` and blocks at 2. CopilotKit's chat will show a message like "Maximum revisions reached. Please approve or start a new brief."

## File Changes Summary

| File | Change |
|------|--------|
| `pwa-frontend/package.json` | Add `@copilotkit/react-core`, `@copilotkit/react-ui` |
| `pwa-frontend/src/main.tsx` | Wrap with `<CopilotKit>` provider |
| `pwa-frontend/src/components/aerostack/ContentCreator.tsx` | Add hooks, sidebar, revision state |
| `pwa-frontend/src/lib/content-api.ts` | Add `reviewDraft` method |
| `tools-api/functions/content/handler.py` | Add `review_draft` action |
| `pwa-frontend/.env.example` | Add `VITE_COPILOTKIT_PUBLIC_API_KEY` |
