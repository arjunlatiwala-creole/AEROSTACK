---
title: Performance Standards
inclusion: always
---

# enterprise Performance Standards

## Core Web Vitals Targets
| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | < 2.5s | 2.5s – 4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | < 200ms | 200ms – 500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 | 0.1 – 0.25 | > 0.25 |

All pages must score "Good" on all three metrics. Measure with Lighthouse CI in pipeline.

## Bundle Size Budgets
| Asset | Budget (gzipped) |
|-------|-----------------|
| Initial JS | < 200KB |
| Per-route JS | < 50KB |
| CSS | < 50KB |
| Total page weight | < 1MB |
| Individual npm package | < 100KB |

## Next.js Performance Patterns

### Code Splitting
- `next/dynamic` for heavy client components (charts, editors, maps)
- Route-based splitting is automatic — leverage it with good route structure
- Analyze bundles: `ANALYZE=true next build` with `@next/bundle-analyzer`

### Image Optimization
- `next/image` for all images — automatic optimization, lazy loading, responsive sizes
- Specify `width` and `height` to prevent CLS
- Use `priority` prop for above-the-fold hero images (LCP optimization)
- WebP/AVIF served automatically by Next.js image optimizer

### Font Loading
- `next/font` for all fonts — automatic optimization, no layout shift
- Subset fonts to required character sets
- `font-display: swap` for text visibility during load

### Third-Party Scripts
- `next/script` with `strategy="lazyOnload"` for analytics, chat widgets
- Never block rendering for third-party scripts
- Tag manager: load asynchronously, defer non-essential tags

## Server Performance
- Server Components reduce client JS — prefer over client components
- Streaming with `<Suspense>` for slow data sources
- Database queries: indexed, paginated, no N+1 patterns
- Redis/ElastiCache for frequently accessed data
- Lambda cold starts: < 1s target, minimize package size, lazy imports

## Monitoring
- Lighthouse CI in GitHub Actions — fail PR if scores drop below thresholds
- Real User Monitoring (RUM) via Vercel Analytics or CloudWatch RUM
- Error tracking via Sentry or equivalent — capture performance spans
- Custom performance marks for business-critical interactions

## Python / Lambda Performance
- Cold start optimization: minimize imports at module level
- Connection pooling for database access
- Async handlers where I/O bound
- Profile with `aws-lambda-powertools` tracer
- Target: P95 response time < 500ms for API endpoints

## Database Performance
- Indexes for all query patterns — no table scans
- Connection pooling (RDS Proxy for Lambda)
- Read replicas for read-heavy workloads
- Query logging and slow query alerts in staging/production
- Pagination required for all list endpoints — no unbounded queries
