---
title: Peregrine Publish Pipeline
inclusion: always
---

# Peregrine Publish Pipeline

This project includes a CI/CD pipeline that packages build artifacts and ships them to Peregrine for hosting and deployment.

## Step 0: Decide Visibility

Before building, decide: **public-facing or internal?**

- **Public**: Scrub AWS account IDs, internal paths, and org-specific references from HTML. Include full SEO meta tags.
- **Internal**: Can reference internal systems. Still needs clean HTML but doesn't need SEO optimization.

This determines how much you sanitize the content.

## peregrine.json — Fill It In

The file `peregrine.json` controls what gets packaged and where it goes. **Fill it in immediately when you know the product.** Do not leave `CHANGE_ME` placeholders.

### Single-repo vs Monorepo

**Single-repo** (one product per repo, e.g. repos created from this template):
- `peregrine.json` lives at the repo root
- Tag format: `v0.1.0`
- Workflow reads from root

**Monorepo** (multiple products per repo, e.g. `enterprise-landing-pages`, `enterprise-showcase-apps`, `enterprise-onboarding-flows`):
- Each product gets a folder at root: `{slug}/peregrine.json`
- Tag format: `{slug}/v0.1.0` (e.g. `smb/v0.1.0`, `alpha/v0.2.0`)
- Workflow parses the slug from the tag and reads from `{slug}/peregrine.json`
- Copy `_template/` to `{slug}/` to start a new product
- Folders are named by slug directly at root — no `customers/` prefix needed

**Root `landing/` special case:**
If a monorepo has a root-level `landing/` (or `showcase/`, `onboarding/`) directory, that's for the tool's own page — not a customer deliverable. It lives outside the `{slug}/` pipeline. Deploy it manually via `package-release.sh` or a root-level `peregrine.json`.

### How to fill it in

```json
{
  "productId": "alpha-danelle",
  "projectType": "showcase",
  "slug": "alpha",
  "domain": "showcases.enterprise.io",
  "artifactPath": "showcase"
}
```

### Field reference

| Field | What it is | Examples |
|-------|-----------|----------|
| `productId` | Unique product identifier in Peregrine. Lowercase, hyphenated. | `alpha-danelle`, `aerostack-pc3`, `enterprise-smb-landing` |
| `projectType` | What kind of deliverable. Determines zip name and deploy handler. | `landing-page`, `showcase`, `onboarding`, `saas-app` |
| `slug` | URL slug. Becomes the subdomain: `{slug}.{domain}`. | `alpha`, `migrate`, `smb-onboard` |
| `domain` | Base domain for hosting. | `landing.enterprise.io`, `aerostackpc3.com`, `showcases.enterprise.io`, `onboarding.enterprise.ai` |
| `artifactPath` | Directory containing the build output to zip and deploy. | `landing`, `showcase`, `onboarding`, `dist` |

### Project type → domain + artifact conventions

| projectType | Default artifactPath | Zip produced | Default domain | Deploys to |
|-------------|---------------------|-------------|----------------|----------|
| `landing-page` | `landing/` | `landing-dist.zip` | `landing.enterprise.io` | `{slug}.landing.enterprise.io` |
| `showcase` | `showcase/` | `showcase-bundle.zip` | `showcases.enterprise.io` | `{slug}.showcases.enterprise.io` |
| `onboarding` | `onboarding/` | `onboarding-dist.zip` | `onboarding.enterprise.ai` | `{slug}.onboarding.enterprise.ai` |
| `saas-app` | `dist/` | `frontend-dist.zip` | custom | Customer account via product-update |

### Shared hosting lanes

| Lane | Shared S3 Bucket | Wildcard Domain |
|------|-----------------|----------------|
| Landing pages | `peregrine-landing-pages-{env}` | `*.landing.enterprise.io` |
| Showcases | `peregrine-showcases-{env}` | `*.showcases.enterprise.io` |
| Onboarding | `peregrine-onboarding-{env}` | `*.onboarding.enterprise.ai` |

## How the pipeline works

1. Build the asset in the `artifactPath` directory
2. Tag: `git tag v0.1.0 && git push --tags` (or `{slug}/v0.1.0` in monorepos)
3. GH Actions reads `peregrine.json`, zips the artifact path, uploads to S3
4. Peregrine auto-registers the slug if new, deploys, notifies Slack
5. Live at `{slug}.{domain}` after CloudFront propagation (~30s)

## Manual publish

```bash
.kiro/scripts/package-release.sh 0.1.0
```

## HTML checklist for landing pages

Every landing page `index.html` must include:
- `<meta property="og:url" content="https://{slug}.landing.enterprise.io">` — set to actual deploy URL
- `<meta property="og:image">` — social share image
- `<meta property="og:title">` and `<meta property="og:description">`
- `<link rel="icon">` — favicon
- All CSS inline (no external stylesheets for Mode A pages)

## Reference example

The Aerostack PC3 landing page at `enterpriseio/aerostack-pc3/landing/index.html` is the canonical working example. It has the correct 12-section structure, design tokens in `:root`, and all meta tags. Copy it as your starting point.

## Rules for the agent

- **Write peregrine.json early.** Replace CHANGE_ME values as soon as you know the product.
- **Match artifactPath to where you put the build output.**
- **Use the correct domain for the project type.**
- **Use lowercase hyphenated values** for productId and slug.
- **Don't invent new projectTypes.** Use: `landing-page`, `showcase`, `onboarding`, `saas-app`.
- **The slug becomes a subdomain.** Keep it short, memorable, URL-safe.
- **In monorepos, use `{slug}/v*` tags.** In single-product repos, use `v*` tags.
- **Root-level artifact directories are special cases** — not part of the monorepo pipeline.
