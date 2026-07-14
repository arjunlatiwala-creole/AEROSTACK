# Changelog

## [Unreleased] - Aerostack V2 + MCP Integration

### Added - MCP Tool Hub
- **🔌 MCP Integration Layer**: Complete Model Context Protocol implementation
- **MCP Dashboard**: Server registry, tool inspector, call tester, analytics
- **McpService Backend**: Server registration, tool discovery, execution routing
- **MongoDB Collections**: `mcp_servers`, `mcp_tools`, `mcp_tool_calls` for tracking
- **Sample Aerostack API Server**: MCP server exposing loop operations as tools
- **Universal Tool Access**: Both humans (via UI) and AI agents (via API) can discover and call tools
- **MCP Types**: Complete TypeScript types for servers, tools, calls, resources
- **Documentation**: `MCP-SYSTEM.md` with architecture, API reference, use cases

## [Unreleased] - Aerostack V1 UX + Flows

### Added
- Brand kit styling and modern UI shell (header/nav, buttons, tables, modals).
- Universal Tag Cloud with autocomplete (`TagInput`) used in Create Loop.
- Filters with Group by (Owner/Category/Pillar/Phase/Status/Priority) and Priority P0–P3 dropdown.
- Org dashboard actions: Effort (mid‑flight), Outcome scoring (contributors + presets), Adapt (pivot + follow‑on loop).
- Adaptation flow: `adaptLoop` executable; records `loop_changes`, updates target date/phase, optional follow‑on loop.
- Dashboard pages aligned to PRD:
  - Org: Title, Owner, Category, Pillar, Status, Priority, Due.
  - Opportunities: Title, Owner, Priority, Weighted, Due.
  - Delivery: Title, Owner, Phase, Status, Due, Tags.
  - Learning: Title, Owner, Outcome, Lesson Tags.
- Backend enrichment: `listLoops` returns `owner_name`/`owner_email` for UI.
- Contributor validation: ≤3, each 0–0.5, total ≤0.5; lesson required for ≥3 and evidence for ≥4.
- Shared types: `LoopChange`, `AdaptLoopRequest`, `TagCloudItem`, HubSpot request/type aliases; `priority_eq` in `LoopListParams`.
- Node version pinned to 20.19.2 via `.nvmrc`/`.node-version`.

### Changed
- Removed ROI from UI; kept Velocity concept for later surfacing.
- Consolidated to a single app header/nav; cleaned duplicate headers.
- `listLoops` supports filters: owner_email, category, pillar, phase, status, tag, due ranges, `priority_eq`, (`priority_min`/`priority_max` moved to Advanced).
- Frontend Squid client now hard‑fails when executables are unavailable (no hidden fallbacks).
- README updated with “All loops complete” rule, Velocity, grouping UX, P0–P3 priority, and `adaptLoop` docs.

### Fixed
- Merge conflict artifacts removed in `LoopFormModal.tsx`.
- Type import issues resolved for `Person` and HubSpot types.
- Duplicate `src/index.html` removed to satisfy Vite.

### Notes
- Collections used by showcase backend: `loops`, `people`, `loop_ownership`, `lessons`, `resume_items`, `velocity_snapshots`, `loop_changes`, `hubspot_deals`, `person_costs`.
- Slack modal openers and Jira webhook integration remain scaffolded; wire keys to enable.
