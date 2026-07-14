:rocket: *Aerostack — promoted to prod + CI hardened*

Promotion is done and everything below is live in prod (enterprise-aerostack …0661), verified green.

*Shipped to prod tonight*
• *SSO-only auth* — public login page is Google-only now; removed the email/password sign-in, signup, OTP-verify, and forgot/reset-password routes and pages entirely. (Internal break-glass access can be sorted via Cognito later; the app no longer exposes a non-SSO path.)
• *DNS cutover complete* — `aerostack.enterprise.io`, `aerostackdev.enterprise.io`, `aerostack.enterprise.ai`, `aerostackdev.enterprise.ai` all serve the new account and return 200. Cognito callback URLs updated for the custom domains.
• *RevOps + Customer Success modules* (APIs + Cloudscape consoles) now in prod.

*CI/CD failures fixed*
• The earlier "Run failed: Deploy" emails were a stale lockfile issue — already resolved.
• Bumped all GitHub Actions to Node-24 runtimes (checkout v7, setup-node v6, configure-aws-credentials v6, pnpm/action-setup v6) — clears the Node-20 deprecation before it becomes a hard failure.
• `deploy.yml` now has a manual `workflow_dispatch`, and `promote.yml` explicitly triggers the prod deploy after pushing main (a GITHUB_TOKEN push doesn't auto-trigger — that's why an earlier promote didn't deploy).

*New: agentic CI maintenance (org-wide)*
• Dependabot now opens weekly action-version bump PRs on this repo.
• Created the `enterpriseio/.github` org repo with a *reusable* "action-version drift sweep" workflow + workflow templates — any repo can adopt it in ~6 lines and self-serve Dependabot from the GitHub UI. Aerostack calls it weekly and reports drift here.
• Also wired as an on-demand Kiro hook for local runs.

*Verified*: prod CDK deploy ✅, prod Amplify build ✅, `aerostack.enterprise.io` 200 ✅, Dependabot ran and found all actions current ✅.

Clean stopping point — prod is current with dev.