# CopilotKit Integration — Tasks

## Phase 1: Agent Registry + KB Discovery (the "interface hack")

### Task 1: Install CopilotKit dependencies
- [x] Run `pnpm add @copilotkit/react-core @copilotkit/react-ui` in `pwa-frontend/`
- [x] Verify build still passes: `pnpm turbo build --filter=@enterprise/pwa-frontend`

#### Acceptance Criteria
- `@copilotkit/react-core` and `@copilotkit/react-ui` in `pwa-frontend/package.json`
- Build succeeds with no type errors

---

### Task 2: Add self-hosted CopilotKit runtime endpoint
- [x] Create `tools-api/functions/copilot/handler.py` — CopilotKit runtime with Bedrock adapter
- [x] Runtime uses existing `boto3` Bedrock client pattern (Claude Sonnet 4, us-east-1)
- [x] Handles CopilotKit's runtime protocol (conversation management, action routing)
- [x] CORS headers matching existing tools-api endpoints
- [x] Add Lambda + API Gateway `/copilot` route in `tools-api/cdk/stacks/tools_stack.py`
- [x] Add `copilotkit` Python dependency to tools-api requirements

#### Acceptance Criteria
- `POST /copilot` responds to CopilotKit runtime protocol
- Uses Bedrock directly — no third-party cloud, no external API key
- Data stays in our infra
- Deployed alongside existing tools-api endpoints

---

### Task 3: Add CopilotKit provider to app root
- [x] Import `CopilotKit` from `@copilotkit/react-core` in `pwa-frontend/src/main.tsx`
- [x] Wrap outermost layer with `<CopilotKit runtimeUrl={import.meta.env.VITE_TOOLS_API_URL + '/copilot'}>`
- [x] Import CopilotKit CSS: `import "@copilotkit/react-ui/styles.css"`
- [x] Verify existing app renders correctly with provider in place

#### Acceptance Criteria
- CopilotKit provider wraps the entire app tree, pointing at self-hosted runtime
- No visual or functional regressions
- CopilotKit CSS loaded

---

### Task 4: Expose agent catalog as readable context
- [x] In `App.tsx`, import `useCopilotReadable` from `@copilotkit/react-core`
- [x] Import `Aerostack_AGENT_CATALOG` from `@/lib/aerostack-agents`
- [x] Add `useCopilotReadable({ description: "Aerostack agent registry — all agents, their status, tools, and domains", value: Aerostack_AGENT_CATALOG })`
- [x] Copilot can now answer "what agents are active?" or "what tools does the opps agent have?"

#### Acceptance Criteria
- Copilot context contains the full agent catalog
- Copilot can describe agents, their tools, and status when asked
- No performance impact on page navigation

---

### Task 5: Expose KB registry as readable context
- [x] In `App.tsx`, fetch KB list on mount via `knowledgeClient.listKbs()` (or use TanStack Query)
- [x] Add `useCopilotReadable({ description: "Available Aerostack knowledge bases", value: kbs })`
- [x] Copilot can now answer "what knowledge bases exist?" or "what's in the brand voice KB?"

#### Acceptance Criteria
- Copilot context contains KB list with IDs, names, descriptions
- KB list fetched once on mount, not on every render
- Graceful fallback if KB endpoint is unavailable

---

### Task 6: Add KB search action
- [x] In `App.tsx`, import `useCopilotAction` from `@copilotkit/react-core`
- [x] Define `searchKnowledge` action with parameters:
  - `query` (string, required) — search query
  - `kbId` (string, optional) — specific KB to search, defaults to searching all
- [x] Handler calls `knowledgeClient.search(query, kbId || "all", 5)`
- [x] Returns search results to the copilot chat

#### Acceptance Criteria
- User can say "search the brand voice KB for technical content guidelines" and get results
- User can say "search all KBs for DynamoDB patterns" for cross-KB search
- Results include entry title, content snippet, and source KB

---

### Task 7: Add KB entry addition action
- [x] Define `addKnowledgeEntry` action with parameters:
  - `kbId` (string) — target knowledge base
  - `title` (string) — entry title
  - `content` (string) — entry content
  - `tags` (string array, optional) — tags for the entry
- [x] Handler calls `knowledgeClient.addEntry({ kbId, title, content, tags, entryType: "note", source: "copilot" })`
- [x] Returns confirmation with entry ID

#### Acceptance Criteria
- User can say "add this lesson learned to the engagement KB" and it creates an entry
- Entry appears in the Knowledge dashboard after creation
- Source field set to "copilot" for audit trail

---

### Task 8: Add global CopilotSidebar to App layout
- [x] Import `CopilotSidebar` from `@copilotkit/react-ui`
- [x] Add sidebar to `App.tsx` layout, positioned alongside the existing sidebar
- [x] Set default instructions: "I'm your Aerostack copilot. I can search knowledge bases, tell you about agents, and help you work across the platform. Ask me anything."
- [x] Make sidebar collapsible — default collapsed, toggle button in the header bar
- [x] Style to match existing purple/slate theme

#### Acceptance Criteria
- Sidebar available on every page
- Collapsible without losing chat history
- Matches existing UI theme
- No layout conflicts with the existing NavBar sidebar
- Works on mobile/tablet without overflow

---

## Phase 2: Cross-Tool Agent Invocation

### Task 9: Add generic agent invocation action
- [ ] In `App.tsx`, define `invokeAerostackAgent` action with parameters:
  - `agentId` (string) — agent ID from the catalog
  - `payload` (object) — input data for the agent
- [ ] Handler:
  - Looks up agent in `Aerostack_AGENT_CATALOG` by ID
  - Validates agent exists and has an `apiRoute`
  - POSTs payload to `${VITE_TOOLS_API_URL}${agent.apiRoute}`
  - Returns the response to the copilot chat
- [ ] Error handling: agent not found, no API route, endpoint failure

#### Acceptance Criteria
- User can say "score the Acme deal" → routes to opps agent
- User can say "generate a SOW for cloud migration" → routes to sow handler
- User can say "list Slack channels" → routes to slack-admin agent
- Agents without `apiRoute` return a clear "not available" message
- Planned/inactive agents return appropriate status message

---

### Task 10: Add MCP server integration (stretch)
- [ ] Evaluate CopilotKit's MCP Apps support for wiring `data-tools-server.ts`
- [ ] If supported: register MCP tools as copilot actions
- [ ] Financial calculators, team metrics, data segmentation available in chat
- [ ] If not directly supported: wrap MCP tool calls as individual `useCopilotAction` entries

#### Acceptance Criteria
- At least one MCP tool (e.g., financial calculator) callable from the copilot
- Interactive UI renders inside the chat if CopilotKit supports it
- Fallback to text-based results if interactive UI not available

---

## Phase 3: Content Pipeline Copilot

### Task 11: Add draft context readables to ContentCreator
- [ ] In `ContentCreator.tsx`, import `useCopilotReadable`
- [ ] Add readable for `generatedDrafts` — current draft content, platform, hashtags, briefId
- [ ] Add readable for `wizard` state — brief parameters (topic, audience, tone, brand voice, etc.)
- [ ] Context updates reactively when drafts are generated or wizard state changes

#### Acceptance Criteria
- Copilot context contains current draft content and brief parameters when on ContentCreator
- Context clears when navigating away from ContentCreator
- No performance impact on the wizard flow

---

### Task 12: Add conversational draft revision action
- [ ] In `ContentCreator.tsx`, define `revise_draft` action with parameters:
  - `briefId` (string) — which brief to revise
  - `feedback` (string) — natural language revision instructions
- [ ] Handler calls `contentApi.generateDraft(briefId, { ...currentBrief, customContext: feedback })`
- [ ] On success, update `generatedDrafts` state with new draft content
- [ ] Track revision count per brief: `Record<string, number>`, max 2
- [ ] Block revision if count >= 2, return "Maximum revisions reached"
- [ ] Show revision count badge near each draft in the UI

#### Acceptance Criteria
- User can say "make it more casual" and get a revised draft
- Feedback passed as `customContext` to existing generation endpoint
- Draft display updates with new content
- Revision count increments and blocks at 2
- Existing generate flow (wizard → generate button) unchanged

---

### Task 13: Add review_draft backend action
- [ ] In `tools-api/functions/content/handler.py`, add `review_draft` to POST router
- [ ] Create `_review_draft(body)` function:
  - Accepts `brief_id` and optionally `draft_content`
  - Loads brief and latest draft from DynamoDB (or uses provided `draft_content`)
  - Pulls KB context via `_get_kb_context()` (same as generation)
  - Builds review prompt asking for structured JSON feedback
  - Calls `_call_bedrock_json()` with the review prompt
  - Returns: `{ brand_alignment: 1-10, tone_match: 1-10, platform_fit: 1-10, suggestions: string[], overall_score: 1-10, summary: string }`
- [ ] In `pwa-frontend/src/lib/content-api.ts`, add `reviewDraft` method

#### Acceptance Criteria
- `POST /content` with `action: "review_draft"` returns structured review JSON
- Review uses KB context for brand/tone evaluation
- Frontend `contentApi.reviewDraft()` correctly calls the endpoint
- Existing content actions unaffected

---

### Task 14: Add advisory review copilot action
- [ ] In `ContentCreator.tsx`, define `review_draft` action with parameter: `briefId` (string)
- [ ] Handler calls `contentApi.reviewDraft(briefId, currentDraftContent)`
- [ ] Returns structured review to copilot chat: scores as mini table, suggestions as bullets, summary as paragraph
- [ ] Advisory only — no automatic status changes

#### Acceptance Criteria
- User can say "review this draft" and get structured feedback
- Feedback includes brand alignment, tone match, platform fit scores
- No side effects on brief/draft status

---

### Task 15: Wire copilot to Ledger detail view
- [ ] In `ContentLedger` component, add `useCopilotReadable` for selected brief detail and its drafts
- [ ] When a brief is selected, update copilot context with that brief's data
- [ ] Enable `revise_draft` and `review_draft` actions from ledger detail view
- [ ] Add "Revise with Copilot" button next to existing Copy button on draft cards

#### Acceptance Criteria
- Selecting a brief in the ledger updates copilot context
- User can revise or review drafts from the ledger detail view
- "Revise with Copilot" button opens/focuses the sidebar
- Revision count tracked per brief across Create and Ledger views
