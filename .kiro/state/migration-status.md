# Aerostack Account Migration — Status

_Updated: 2026-06-28 · enterprise-peregrine (730335467631) → enterprise-aerostack (759945100661)_

## Account map (canonical profiles)
| Profile | Account | Email | Role | Purpose |
|---------|---------|-------|------|---------|
| `enterprise-aidlc` | 717976183293 | aidlc@enterprise.io | AdministratorAccess | (no Aerostack stacks) |
| `enterprise-peregrine` | 730335467631 | peregrine@enterprise.io | AdministratorAccess | OLD Aerostack lives here |
| `enterprise-aerostack` | 759945100661 | aerostack@enterprise.io | AWSAdministratorAccess | NEW Aerostack target |

All three SSO sessions verified working.

## ✅ Done
- **Branches/pipeline:** `dev`/`main` are the single source of truth → deploy to `enterprise-aerostack` via OIDC (`deploy.yml`). `new-dev`/`new-main` deleted; old `k8s-deploy.yml` retired. Reconciled migration + RevOps/CS modules.
- **Deployed:** infra + tools stacks live in `enterprise-aerostack` (dev + prod stages). RevOps dashboard API included.
- **Secrets:** all 7 Aerostack secrets verified **byte-identical** in `enterprise-aerostack` (hubspot_pat, deel_api_token, linear_api_token, linear_api_token_with_admin_access, google-directory-service-account, aerostack/document-host/dropbox-sign-api-key, slack_bot_token). No action needed.
- **DynamoDB data:** migrated `enterprise-peregrine` → `enterprise-aerostack` (idempotent PutItem). Dev = **65,856 items / 34 tables**; prod tools = 152 items / 7 tables. Verified: loops 0→37, deals 167→507, person→57. Script: `.kiro/scripts/migrate-dynamo.mjs`.
- **Cognito config parity:** new `aerostack-dev-user-pool` (us-east-1_okmiaei9w) + `aerostack-prod-user-pool` (us-east-1_Txy7hXCuz) both have the Google IdP with the **same OAuth client** (`261838299817-…`) and scopes (`openid email profile`) as old. ✓

## ⚠️ Remaining (to fully match old)
1. **Google SSO redirect URIs (MANUAL — only thing blocking Google login).** The Cognito Hosted-UI domain changed (`aerostack-dev-enterprise` → `aerostack-dev-enterprise-759945100661`). Add these to Google OAuth client `261838299817-np3cock2tscip7lsb9gomgb6nur5jos3` (project `enterprise-recaptcha-map`) → Authorized redirect URIs (keep the old ones):
   - `https://aerostack-dev-enterprise-759945100661.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   - `https://aerostack-prod-enterprise-759945100661.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   (No gcloud installed and the `aerostack-google` service account is Directory-API only, so I can't script this — Console action.)
2. **Cognito users:** Google-federated users (enterprise.io) auto-provision on first login once #1 is done — no migration needed. Native email/password users (subset of the 54) can be migrated with `.kiro/scripts/migrate-cognito-users.sh` (they reset password; Google users skipped). Optional/disruptive — run only if needed.
3. **S3 object data** (documents, zoom/meeting recordings, deel/linear/schema data): not yet copied. Stable-named buckets can be `aws s3 sync`'d; document/content buckets have per-account random suffixes and need an old→new name map. Flag if these are needed for parity.
4. **SLACK_BOT_TOKEN GH secret** for deploy notifications (token already in Secrets Manager) — set it or rewire `deploy.yml` to read `slack_bot_token` from Secrets Manager post-OIDC (cleaner).

## Old-account cleanup (after sign-off)
Old Aerostack stacks in `enterprise-peregrine` (730335467631): `Aerostack-TablesStack, Aerostack-ApiStack, Aerostack-ApiAerostackStack, Aerostack-IngestionStack, Aerostack-FrontendStack, Aerostack-HiringApiStack, Aerostack-Tools-dev, Aerostack-Tools-prod`. Tear down only after new account is signed off.
