---
title: Docker Best Practices
inclusion: fileMatch
fileMatchPattern: "*Dockerfile*,*docker-compose*,.dockerignore"
---

# enterprise Docker Standards

## Base Image Selection
- Use official, minimal base images: `node:20-alpine`, `python:3.11-slim`
- Pin exact versions — never use `latest` in production
- Multi-stage builds for all production images

## Multi-Stage Build Pattern
```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

## Security Rules (Non-Negotiable)
- **Never run as root** — always create and switch to non-root user
- **No secrets in images** — use build args or runtime env vars, never COPY secret files
- **No secrets in build args** — they persist in image layers
- **Minimize attack surface** — install only required packages, remove caches after install
- **Scan images** — use `docker scout` or `trivy` in CI pipeline
- **Read-only filesystem** where possible — `--read-only` flag in docker run
- **.dockerignore** — exclude node_modules, .git, .env, tests, docs

## .dockerignore Template
```
node_modules
.next
.git
.gitignore
.env*
!.env.example
*.md
tests/
coverage/
.venv/
__pycache__/
```

## Health Checks
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1
```

## Layer Optimization
- Order instructions from least to most frequently changed
- COPY package.json before source code (cache dependencies layer)
- Combine RUN commands to reduce layers
- Clean package manager caches in the same layer as install

## Container Sizing
- Alpine-based images preferred (< 100MB target for Next.js apps)
- Python slim images (< 200MB target)
- Monitor image size in CI — fail if exceeding budget

## AWS ECR Integration
- Tag images with git commit SHA + environment
- Enable image scanning on push
- Lifecycle policies to clean old images
- Cross-region replication for disaster recovery
