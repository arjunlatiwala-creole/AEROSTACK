# Blockers & Decisions Needed

_Last updated: 2026-06-28_

## ✅ RESOLVED — Account migration + branch divergence (this session)
- **Reconciled** Rudresh's new-account migration (`new-dev`/`new-main`) onto current `dev` + the new RevOps/CS modules. One clean line.
- **Unified pipeline** `.github/workflows/deploy.yml`: push `dev`→dev stage, `main`→prod stage, OIDC to **enterprise-internal-aerostack `759945100661`** (`…0661`). Retired `k8s-deploy.yml` (old account) + `deploy-new-account.yml` (split).
- **Deleted** `new-dev`/`new-main` remote branches — `dev`/`main` are the single source of truth, both → new account.
- **Deployed:** RevOps dashboard API + full reconciled Aerostack to `759945100661` (first via new-dev push run 28338816667 ✓ success; then via the unified `dev` pipeline). `main`/prod deploy triggered on the new account.
- **Slack notify** wired to channel `int-enterpriseinternal-aerostack-chat-dev-ops` (Kestrel slack-syndication pattern, `chat.postMessage`, best-effort).

### ⚠️ One action for Will (non-blocking)
- Set repo secret **`SLACK_BOT_TOKEN`** (xoxb, `chat:write`, Aerostack Slack app — the "Aerostack-SLACK-A…" app) in repo → Settings → Secrets → Actions, and make sure the bot is invited to `int-enterpriseinternal-aerostack-chat-dev-ops`. Until then the Slack notify step no-ops (deploys still succeed).
- **Old-account cleanup** still pending: old account ID is a masked GH secret (`DEFAULT_AWS_ACCOUNT_ID`). Once you confirm new-account deploys look good, give me the old account ID + a profile and I'll tear down the old Aerostack stacks.

---

## 🔴 BLOCKER 0 — Account migration is half-done; pick the deploy target (decision + creds)
**Verified via git + `gh run list` (2026-06-28):**
- **Aerostack is live in TWO accounts.** Old account (GitHub secret `DEFAULT_AWS_ACCOUNT_ID`, role id `AROA2UC3C3BXZG7PBUSHV…`, masked) deploys from `dev`/`main` via `k8s-deploy.yml` — last success **2026-06-23**, **current code**. New account **`759945100661`** (aerostack@enterprise.io → to be renamed *enterprise-internal-aerostack*) deploys from `new-dev`/`new-main` via `deploy-new-account.yml` (OIDC role `enterprise-aerostack-gha-deploy`) — last success **2026-06-22**, **stale code** (missing 17 `dev` commits since the 6-18 fork).
- **Rudresh: no commits since 2026-06-18** (confirmed after fetch). Migration was prepped on `new-dev`/`new-main` and never merged; `dev` diverged past it (17 ahead / 7 behind). Rudresh being offboarded.
- **No local SSO profile maps to `759945100661`.** Local profiles: `enterprise/miragame/aidlc`→717976183293, `pc3`→471112637545, `public`→934999988398, `peregrine`→730335467631, `mp/orgroot/full-admin`→809373129375.

**KEY UNBLOCK:** the new account deploys via **GitHub Actions OIDC** — no local SSO needed for CI deploys there. Local creds are only needed for old-account **cleanup**.

**Decision needed from Will (drives everything):**
1. **Target = new `759945100661`** (your stated intent). Plan: reconcile `new-dev`'s migration into current `dev` (bring stage-aware stacks + shared Cognito + pinned-account pipeline forward onto latest code), retarget `deploy-new-account.yml` to run on `dev`/`main`, retire `k8s-deploy.yml`, push → OIDC deploys full Aerostack to 759945100661. Then verify, then clean up the old account.
2. **Old-account cleanup** needs the old account ID (masked secret) + creds for `cdk destroy`/resource teardown — gated until new-account deploy is verified. **Will: confirm the old account ID** (or grant a profile) when ready to clean up.

I can do the branch reconciliation + pipeline retarget now (no creds needed; verify with `cdk synth`). Say go and I'll execute it.

---

## 🔴 BLOCKER 1 — AWS SSO session expired (blocks LOCAL deploys/cleanup only)
**Impact:** Cannot run `cdk deploy` to the dev environment. The "deploy a slice → review in dev" rhythm is stalled at the deploy step. Everything else (build, typecheck, unit tests, `cdk synth`) works offline and has been verified.

**Evidence:** `aws sts get-caller-identity` → "The SSO session associated with this profile has expired or is otherwise invalid." All `~/.aws/config` profiles (`default`, `enterprise`, `enterprise-deploy`, `miragame`, `enterprise-public`, `enterprise-aidlc`) use SSO against `https://enterprise.awsapps.com/start`.

**Resolution (needs Will / interactive):**
1. `aws sso login` (or `aws sso login --profile enterprise`)
2. Then deploy the RevOps slice 1 (already implemented + synth-validated):
   ```bash
   pnpm --filter infra build
   cd infra && npx cdk deploy Aerostack-ApiStack --require-approval never
   ```
3. Smoke-test the now-live endpoint:
   ```bash
   curl -H "Authorization: Bearer <token>" \
        -H "X-Resource-Key: operations/revops" \
        "$API_BASE/hubspot/revops-dashboard"
   ```
   Expect a populated `RevOpsSummary` (tenant_id `enterprise-internal`, win_rate_pct, pipeline_coverage_ratio).

I could not perform `aws sso login` — it requires interactive browser auth.

---

## 🟡 DECISION 1 — Dead `_score_deal` deletion conflicts with the Q2C PRD
**The RevOps PRD** (§2, §6 Phase 2, §15) mandates deleting the "dead/unreachable" Python `_score_deal` in `tools-api/functions/opps/handler.py`, asserting "frontend never calls it."

**But that claim is contradicted by other in-flight work:**
- `tools-api/functions/opps/handler.py` still dispatches `action == "score_deal" → _score_deal(body)`.
- `pwa-frontend/src/lib/aerostack-agents.ts` exposes `score_deal` as an opps-agent tool ("BANT-based deal scoring (0-100)").
- `docs/inputs/PRD-Aerostack-Q2C-v0.2.md` lists **"BANT deal scoring | Active | Opps handler (`score_deal` action) | Feeds into Q2C deal qualification."**

**Decision held (did NOT delete).** Per the directive "do not touch unrelated in-flight handlers," deleting `_score_deal` risks breaking the Q2C surface and the agent catalog. The two PRDs disagree on whether this is dead.
**Need from Will:** confirm whether `_score_deal` is truly retired (RevOps view) or still feeding Q2C (Q2C view). If retired, also remove the `score_deal` dispatch branch + the `aerostack-agents.ts` tool entry in the same change.

---

## 🟢 NON-BLOCKERS / NOTES
- **Worked-example file missing.** RevOps PRD §16.1 references `WORKED-EXAMPLE-revops-dashboard-api.md`; it is not in the repo. Proceeded from the PRD body directly (sufficient).
- **No test runner installed in the repo.** All package `test` scripts are stubs. Unit tests were run with ephemeral `pnpm dlx vitest@2` (per monorepo-standards: `pnpm dlx`, never `npx` for tools). To make tests first-class, add `vitest` as a dev dependency to `common` + `infra` and wire the `test` scripts — this changes `pnpm-lock.yaml`, so it's left for an explicit go-ahead to avoid disturbing in-flight work.
- **infra does not depend on `@enterprise/common`.** Canonical shared types live in `common` (for the Cloudscape frontend); the infra RevOps handler keeps an infra-local `RevOpsSummary`/aggregation module to avoid introducing a new workspace dependency (and lockfile change) mid-stream. PRD-mandated reuse of `common/src/utils/velocity.ts` in the rep-productivity handler (Task 3) WILL require wiring `@enterprise/common` into `infra` deps — flagged for that slice.
- **Stale `infra/node_modules`** was repaired with `pnpm install --frozen-lockfile` (no lockfile change). Declared deps (`jose`, `adm-zip`, `pdf-lib`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-cognito-identity-provider`) were missing on disk; install fixed it and the infra `tsc` build is now clean.
- **Cloudscape frontend not started.** This is a large net-new build (RevOps surface + CS Ops View + CS Customer View @ portal.enterprise.ai with a separate Cognito pool). Backend slices are being landed first so there's something real to render. No `@cloudscape-design/*` packages are installed yet.
