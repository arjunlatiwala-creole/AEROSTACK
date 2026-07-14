---
inclusion: fileMatch
fileMatchPattern: '*_PRD.md'
---

# PRD Generation Rules

These rules govern any PRD authored or edited in this repo (files matching `*_PRD.md` and
anything under `inputs/**`), and are the contract the `/enterprise-prd` command follows. The goal:
every PRD is a conformant, governance-gated, buildable seed for an AIDLC spec.

## Shape — the §0–§16 skeleton

- Use the §0–§16 skeleton from `registry/templates/enterprise-prd/PRD_TEMPLATE.md` (canonical
  home: `enterprise-documentation-standards/templates/PRD_TEMPLATE.md`). Do not drop sections.
- **Data-model-first:** define entities (§5) before UI or API. Use language-native types —
  TypeScript `interface` for frontend-facing shapes, Python `@dataclass` for backend/runtime
  shapes. Every entity carries `tenantId` / `tenant_id` (multi-tenant flexibility pattern).
- **Real source paths only:** §0 and §2 must cite real, verified file paths. Never reference
  a file you have not opened. Reconcile each §2 capability as `BUILT` / `PARTIAL` / `GAP`.

## Tier selector

`--tier` shifts emphasis, never removes sections:
- Tier 0 (ops): infra, IAM, tagging, rollback, runbooks.
- Tier 1 (platform): registry/reuse fit, ≥2-caller admission test, API contracts.
- Tier 2 (architecture): cross-system seams, data flow, integration contracts.
- Tier 3 (business app): personas, UX, Cloudscape, WCAG, end-to-end journeys.

## Governance gates are REQUIRED fields

§11 gates must be filled with real values — an empty or placeholder gate is a generation
failure, not a TODO. Required:

- Data classification (PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED) + reason
- IAM least-privilege (scoped actions + resource ARNs; no `*` wildcards)
- `tenant_id` flexibility pattern
- RBAC (roles → permissions)
- Audit logging (which events emit records)
- Test / coverage plan (per `testing-standards.md` thresholds)
- Rollback (`DeletionPolicy: Retain` on stateful resources)
- The 7 `enterprise:*` tags (deployed-by, customer, engagement, workload, module, env, grc)
- Secrets (Secrets Manager) + encryption (KMS where ≥ CONFIDENTIAL)
- WCAG 2.1 AA + Cloudscape consistency (where customer/internal UI is involved)
- Commit-before-code
- Deploy-for-review loop

## Safeguards in EARS

Express §12 Safeguards in EARS form: `WHEN <trigger> THEN the system SHALL <behavior>`,
`WHERE <precondition> the system SHALL <behavior>`, `IF <edge/error> THEN the system SHALL
<behavior>`.

## Output must pass the gate

- The generated PRD/spec must pass `analyze-standards.js` with **zero CRITICAL**.
- Self-check all §11 fields are non-empty before declaring done.
- Acceptance criteria (§15) must include the zero-CRITICAL bar and "all governance gates filled".

## Hand-off

- Seed `.kiro/specs/<slug>/` (`.config.kiro` = `generationMode: requirements-first`, plus
  requirements/design/tasks).
- Map registry artifacts in §16.3; apply the ≥2-caller admission test (promote to a registry
  power/block/library/module/template when reused).

## Do not

- Do not build a hosted PRD-generator app or UI — this is a Kiro command + steering only.
- Do not invent scope or source paths.
- Do not leave governance gates as placeholders.
