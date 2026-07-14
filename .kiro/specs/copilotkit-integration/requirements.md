# CopilotKit Integration — Requirements

## Overview
Integrate CopilotKit as the conversational interface layer for the entire Aerostack platform. A single chat sidebar that can reach every Aerostack agent, search every KB, and invoke any tool endpoint — through natural language. The "interface hack" that turns Aerostack from a dashboard-per-tool platform into a unified conversational operating system.

## Background
Aerostack has 16+ agents across 5 domains, 13+ knowledge bases, and growing tool endpoints — each with its own dashboard page and form-based UI. Users navigate between pages, click through wizards, and context-switch constantly. CopilotKit provides an in-app copilot layer that sits on top of the existing tools-api, wiring the agent registry, KB registry, and tool endpoints directly into a conversational surface.

The agent catalog (`Aerostack_AGENT_CATALOG`) already declares tools, consumes/feeds graphs, KB access, and API routes per agent — CopilotKit's action system maps 1:1 to these declarations.

## Phased Delivery

- **Phase 1**: Agent registry auto-discovery + KB search via chat (the platform-wide "interface hack")
- **Phase 2**: Cross-tool agent invocation — any Aerostack agent callable by name through the copilot
- **Phase 3**: Content pipeline review loop (conversational draft revision + advisory review)

## Requirements

### Phase 1: Agent Registry + KB Discovery

1. **FR-1: CopilotKit Provider Setup**
   - Install CopilotKit packages (`@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/runtime`)
   - Add `CopilotKit` provider to the app root in `main.tsx`
   - Self-hosted runtime: `runtimeUrl` points to a `/copilot` endpoint on the tools-api (no third-party CopilotKit Cloud dependency)
   - Runtime endpoint uses existing Bedrock integration (Claude Sonnet 4) — data stays in our infra
   - Provider wraps existing providers (QueryClient, Redux, Auth) without breaking them

2. **FR-2: Agent Catalog as Readable Context**
   - `useCopilotReadable` exposes `Aerostack_AGENT_CATALOG` — all agents, status, tools, domains
   - Copilot knows what agents exist, what they do, and which are active
   - Updates when registry changes (future: poll DynamoDB registry)

3. **FR-3: KB Registry as Readable Context**
   - `useCopilotReadable` exposes available knowledge bases from `knowledgeClient.listKbs()`
   - Copilot knows what knowledge domains exist and their descriptions

4. **FR-4: KB Search Action**
   - `useCopilotAction("searchKnowledge")` — semantic search across Aerostack KBs
   - Parameters: `query` (string), `kbId` (optional string, defaults to "all")
   - Calls `knowledgeClient.search()`
   - User can say "search the brand voice KB for technical content guidelines"

5. **FR-5: KB Entry Addition**
   - `useCopilotAction("addKnowledgeEntry")` — add entries to any KB
   - Parameters: `kbId`, `title`, `content`, `tags`
   - Calls `knowledgeClient.addEntry()`
   - User can say "add this lesson learned to the engagement KB"

6. **FR-6: CopilotKit Chat Sidebar (Global)**
   - `CopilotSidebar` in the app layout (App.tsx), available on all pages
   - Contextual instructions based on current route
   - Collapsible, theme-matched (purple/slate)

### Phase 2: Cross-Tool Agent Invocation

7. **FR-7: Invoke Any Agent by Name**
   - `useCopilotAction("invokeAerostackAgent")` — route to any agent's API endpoint
   - Parameters: `agentId` (string), `payload` (object)
   - Looks up agent in `Aerostack_AGENT_CATALOG`, finds `apiRoute`, POSTs payload
   - User can say "score the Acme deal" → routes to opps agent
   - User can say "generate a SOW for cloud migration" → routes to sow handler

8. **FR-8: MCP Server Integration**
   - Wire existing `data-tools-server.ts` MCP tools into CopilotKit
   - Financial calculators, team metrics, data segmentation available in chat
   - CopilotKit's MCP Apps support renders interactive UI inside the chat

9. **FR-9: Module Lifecycle via Chat (Future)**
   - `useAgent` hook wraps an Aerostack "builder" agent for feature scaffolding
   - AG-UI protocol syncs module installation progress back to UI
   - Maps to `AerostackModule.install() / enable() / disable()` lifecycle

### Phase 3: Content Pipeline Copilot

10. **FR-10: Draft Context Awareness**
    - `useCopilotReadable` feeds current draft content, brief parameters (platform, topic, audience, tone, brand voice), and hashtags into copilot context
    - Context updates when drafts are generated or a different brief is selected in the Ledger

11. **FR-11: Conversational Draft Revision**
    - `useCopilotAction("revise_draft")` enables natural language revision requests
    - Calls existing `contentApi.generateDraft()` with feedback injected into `customContext`
    - Max 2 revision rounds per draft (matching pipeline architecture)

12. **FR-12: Advisory Draft Review**
    - `useCopilotAction("review_draft")` provides structured quality feedback
    - Returns: brand alignment score, tone match, platform fit, suggestions
    - New `review_draft` action in `tools-api/functions/content/handler.py`
    - Advisory only — no automatic status changes

13. **FR-13: Content Sidebar Context**
    - Sidebar instructions update when on ContentCreator page
    - "Revise with Copilot" button on draft cards in Ledger detail view

### Non-Functional Requirements

14. **NFR-1: No Breaking Changes** — all existing flows continue unchanged
15. **NFR-2: Bundle Size** — CopilotKit must not push initial JS over 200KB gzipped; lazy-load if needed
16. **NFR-3: pnpm Only** — all installations via `pnpm add`
17. **NFR-4: Self-Hosted Runtime** — CopilotKit runtime runs on our Lambda via tools-api, uses existing Bedrock (Claude Sonnet 4), no third-party cloud dependency, data stays in our infra
