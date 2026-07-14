---
title: Aerostack Product Lifecycle Standards
inclusion: fileMatch
fileMatchPattern: "*deploy*,*stack*,*template*,*post-deploy*,*upgrade*,*version*,*aerostack*,*pc3*,*acp*"
---

# Aerostack Product Lifecycle Standards

## The Pattern

Every Aerostack product (PC3, ACP, future products) follows the same lifecycle managed cooperatively between two systems:

- **Product repo** (aerostack-pc3, aerostack-acp, etc.) — owns the application code, CFN templates, frontend, Lambda functions
- **Peregrine** — owns deployment orchestration, version management, post-deploy configuration, ongoing operations

The product repo builds and publishes. Peregrine deploys and manages. Neither works alone.

## Three Update Channels

Every deployed instance has three independently updatable layers:

| Channel | What Changes | How It's Applied | Downtime |
|---------|-------------|-----------------|----------|
| **Infrastructure** | CFN template (new resources, IAM changes, config) | `UpdateStack` via Peregrine | Zero (rolling) |
| **Lambda Code** | Backend logic (new features, bug fixes) | `UpdateStack` with new `LambdaCodePrefix` | Zero (Lambda versioning) |
| **Frontend** | UI (new pages, bug fixes, branding) | S3 sync + CloudFront invalidation via post-deploy | Zero (cache swap) |

Most updates are Lambda + Frontend only. Infrastructure changes are rare and risky.

## Version Contract

Every product version published to `s3://peregrine-templates-{env}/products/{productId}/{version}/` must contain:

```
{version}/
├── template.yaml          # Product stack (nests base if applicable)
├── aerostack-base.yaml         # Base platform stack (if using shared base)
├── lambdas/               # Pre-built Lambda deployment packages
│   └── {function}.zip
├── frontend-dist.zip      # Built frontend with __VITE_*__ placeholders
└── manifest.json          # Version metadata
```

### manifest.json
```json
{
  "version": "0.2.9",
  "product": "aerostack-pc3",
  "buildDate": "2026-04-19T00:00:00Z",
  "baseTemplateChanged": false,
  "lambdaCodeChanged": true,
  "frontendChanged": true,
  "changelog": "Tag fix, channel-command purge",
  "upgradeNotes": "Safe for in-place update. No resource replacements."
}
```

The `baseTemplateChanged` flag tells Peregrine whether to pass a new `BaseTemplateKey` or reuse the existing one. This prevents unnecessary nested stack updates.

## Upgrade Safety Rules

### Product Repo Responsibilities

1. **Never change resource logical IDs** between versions
2. **Never change hardcoded resource names** (DynamoDB TableName, S3 BucketName, Cognito UserPoolName) — these are set at create time and changing them requires replacement
3. **Use `UpdateReplacePolicy: Retain`** on all stateful resources (DynamoDB, S3, Cognito, Secrets Manager)
4. **Use `DeletionPolicy: Retain`** on all stateful resources
5. **Set `baseTemplateChanged: false`** in manifest when only Lambda/frontend changed
6. **Test every version upgrade** on a dev tenant before publishing as `current`
7. **Tag changes are safe** but require the deploy role to have `ListTagsOfResource` permissions
8. **New resources are safe** — adding Lambdas, tables, buckets always works
9. **Removing resources requires `DeletionPolicy: Retain`** — never delete a resource that has customer data

### Peregrine Responsibilities

1. **Track deployed base template version** per tenant — only update `BaseTemplateKey` when `baseTemplateChanged: true`
2. **Pre-upgrade validation** — read manifest, check if base template changed, warn operator
3. **Rollback capability** — if UpdateStack fails, continue-update-rollback automatically
4. **Frontend-only updates** — run `deploy_frontend` step without touching the CFN stack
5. **Lambda-only updates** — update `LambdaCodePrefix` parameter, keep `BaseTemplateKey` unchanged
6. **Role permission checks** — before deploying, verify the deploy role has required permissions for the changes in this version

## Upgrade Workflow

### Fast Path (Lambda + Frontend only — 90% of updates)
```
Product repo: build → package → upload to S3 → register version
Peregrine: UpdateStack (new LambdaCodePrefix, same BaseTemplateKey)
         → deploy_frontend (new frontend-dist.zip)
         → done
```

### Full Path (Infrastructure change — rare)
```
Product repo: build → package → upload to S3 → register version (baseTemplateChanged: true)
Peregrine: Preview change set → operator approval
         → UpdateStack (new LambdaCodePrefix + new BaseTemplateKey)
         → deploy_frontend
         → verify health
         → done
```

### Frontend Only (cosmetic/branding — instant)
```
Product repo: build frontend → upload frontend-dist.zip to S3
Peregrine: deploy_frontend step only (no CFN update)
         → done
```

## Deploy Role Evolution

The deploy role template must evolve with the product. When a new version needs a permission the role doesn't have:

1. Update `aws-infra/templates/{product}-role.yaml` in Peregrine repo
2. Upload to `s3://peregrine-templates-{env}/roles/{product}/latest/template.yaml`
3. Update the role stack in the customer account (via "Update Role" in Peregrine)
4. Then deploy the product version

Peregrine should eventually automate this: read the manifest's `requiredPermissions` field and compare against the deployed role's policies before attempting the product update.

## Post-Deploy Steps

Every Aerostack product defines its post-deploy steps. Peregrine runs them after CFN completes:

| Step | PC3 | ACP | Generic |
|------|-----|-----|---------|
| Read stack outputs | ✓ | ✓ | ✓ |
| Deploy frontend | ✓ | ✓ | ✓ |
| Create admin user | ✓ | ✓ | ✓ |
| Seed initial data | ✓ (migration steps) | ✓ (agent config) | Product-specific |
| Custom domain | ✓ (aerostackpc3.com) | ✓ (aerostackacp.com) | Product-specific |
| Health probe | ✓ (PC link) | ✓ (agent status) | Product-specific |

Each step is idempotent and individually retryable from the PC3/ACP Console in Peregrine.

## Monitoring and Operations

### What Peregrine Tracks Per Instance
- Deployed version (stack + frontend)
- Post-deploy step status
- Custom domain
- PC link status (PC3-specific)
- Last health check
- Stack status (CREATE_COMPLETE, UPDATE_COMPLETE, etc.)

### What the Product Console Shows
- Customer-facing site URL
- API endpoint
- MCP endpoint
- Cognito pool details
- Stack outputs
- Post-deploy step status with retry buttons
- Version info

### Day-2 Operations (Future)
- Cost monitoring per tenant (via `enterprise:product` tag)
- Usage telemetry rollups
- Agent fleet status (ACP)
- Migration progress (PC3)
- Automated health checks
- Alerting on failures

## Anti-Patterns

- ❌ Don't change resource names between versions
- ❌ Don't remove resources without `DeletionPolicy: Retain`
- ❌ Don't update `BaseTemplateKey` when only Lambda code changed
- ❌ Don't deploy a new version without testing upgrade on dev first
- ❌ Don't assume the deploy role has all permissions — check first
- ❌ Don't use `aws cloudformation delete-stack` to "fix" an update failure — you lose state
- ❌ Don't hardcode version numbers in templates — use parameters
