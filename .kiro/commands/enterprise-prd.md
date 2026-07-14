# /enterprise-prd — generate a conformant enterprise PRD + spec triplet

Generate a enterprise house-style PRD (§0–§16) from a brief and seed its downstream Kiro spec
triplet. Composes the registered `enterprise-prd-template` artifact. This is config/wiring, not a
hosted app.

## Contract

```
/enterprise-prd  --brief <text|file>  --tier <0|1|2|3>  --slug <name>  [--repo <target>]
  → writes  inputs/<slug>_PRD.md                          (human PRD, §0–§16, house style)
  → writes  .kiro/specs/<slug>/.config.kiro               (generationMode: requirements-first)
  → writes  .kiro/specs/<slug>/requirements.md            (EARS acceptance criteria)
  → writes  .kiro/specs/<slug>/design.md
  → writes  .kiro/specs/<slug>/tasks.md
  → validates: analyze-standards.js zero CRITICAL; all §11 governance gates present
```

### Arguments

| Flag | Required | Meaning |
|------|----------|---------|
| `--brief` | yes | Free text or a path to a file containing the idea / hand-off note. |
| `--tier` | yes | `0` ops · `1` platform · `2` architecture · `3` business app. Selects shape. |
| `--slug` | yes | kebab-case name. Drives `inputs/<slug>_PRD.md` and `.kiro/specs/<slug>/`. |
| `--repo` | no | Target repo if not the current workspace. |

## Procedure (what the agent does)

1. **Load inputs.** Read `--brief` (inline or file). Resolve `--tier` and `--slug`.
2. **Load the template + method.** Read the registered artifact
   `registry/templates/enterprise-prd/PRD_TEMPLATE.md` and `steering/method.md`. (If running in a
   repo without the registry, fall back to the standards-repo copy
   `enterprise-documentation-standards/templates/PRD_TEMPLATE.md`.)
3. **Reconcile against the codebase.** Open real source files; tag §2 capabilities
   `BUILT/PARTIAL/GAP` with real paths. Never cite an unopened file.
4. **Fill §0–§16** per the tier shape. Define the data model first (§5) with language-native
   types (`interface` FE-facing, `@dataclass` BE/runtime); every entity carries
   `tenantId`/`tenant_id`.
5. **Fill every §11 governance gate** with a real value (no placeholders). Write §12
   Safeguards in EARS.
6. **Write `inputs/<slug>_PRD.md`.**
7. **Seed the triplet** at `.kiro/specs/<slug>/`:
   - `.config.kiro` → `generationMode: requirements-first`
   - `requirements.md` (user stories + EARS acceptance criteria)
   - `design.md` (components, data model, decisions, testing strategy)
   - `tasks.md` (checkbox tasks referencing requirements)
8. **Self-check.** Confirm all §11 gates are non-empty and §15 includes the zero-CRITICAL bar.
9. **Run the gate.** `node .kiro/scripts/analyze-standards.js --format json --output /tmp/<slug>-gate.json`
   then assert `stats.critical == 0`. If not zero, fix and re-run.

## Output guarantees

- A §0–§16 PRD with every governance gate filled.
- A four-file spec triplet (`.config.kiro` + requirements/design/tasks).
- Zero CRITICAL from `analyze-standards.js`.
- No server, API, UI, or build pipeline created.

## See also

- Steering rules: `.kiro/steering/prd-generation.md`
- Template + method: `registry/templates/enterprise-prd/`
- Registry power: `registry/powers/enterprise-prd-generator/`
