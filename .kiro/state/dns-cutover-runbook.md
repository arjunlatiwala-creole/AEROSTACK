# Aerostack DNS Cutover Runbook (enterprise.io / enterprise.ai → new account)

## ✅ EXECUTED 2026-06-28 (supervised, with Will present) — COMPLETE

All Aerostack custom domains now serve the new account (759945100661). Verified live:
- `https://aerostack.enterprise.io` → 200, CNAME → `d2nnhtakukdlta.cloudfront.net` (new main app `d2nmzejx4gfawo`)
- `https://aerostackdev.enterprise.io` → 200, CNAME → `d1kvfit4i2msk1.cloudfront.net` (new dev app `dya49i66ic3c7`)
- `https://aerostack.enterprise.ai` → 200 (new main app)
- `https://aerostackdev.enterprise.ai` → 200 (new dev app)

All four Amplify domain associations reached `AVAILABLE` (ACM validated in <2 min; CloudFront deploy ~few min).

### What was done
1. Released old-account associations: `enterprise.ai` (FAILED/safe) then `enterprise.io` (live) from app `d240kmblleqxy3` (enterprise-peregrine).
2. Created new-account associations: main `d2nmzejx4gfawo` (aerostack/main) + dev `dya49i66ic3c7` (aerostackdev/dev) on both `enterprise.io` and `enterprise.ai`.
3. Added Route53 records in enterprise-public (Z10454942EYW6PBCJ66Z4 / Z0894530ZR5OIL5Q1U2J): shared ACM cert-validation CNAME per domain + subdomain CNAME targets (UPSERT, replacing old `d3o0aub8s02b92` targets).
4. Updated Cognito app-client callback/logout URLs:
   - dev pool `us-east-1_okmiaei9w` (client `5e9ria9ab3prc2mkqvdapg769j`): + `https://aerostackdev.enterprise.io`, `https://aerostackdev.enterprise.ai`
   - prod pool `us-east-1_Txy7hXCuz` (client `6d560jf3d5vrgcf3kc7pa6e374`): + `https://aerostack.enterprise.io`, `https://aerostack.enterprise.ai`

### Remaining follow-ups
- Old-account `dev-aerostack.enterprise.io` / `preview-aerostack.enterprise.io` Route53 records still point at old CloudFront and are now orphaned (old assoc released). Delete them in enterprise-public when convenient — not serving anything critical.
- Verify Google SSO end-to-end on `https://aerostack.enterprise.io` (callback URLs now allowed; Google OAuth redirect URIs for the Cognito Hosted-UI domain are a separate Console item tracked in migration-status.md #1).
- Old-account Amplify app `d240kmblleqxy3` no longer holds any Aerostack domains; tear down with the rest of the old stacks after sign-off.
