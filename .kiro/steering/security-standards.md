---
title: Security Standards
inclusion: always
---

# enterprise Security Standards

## Authentication
- **Auth.js (NextAuth.js)** as the standard authentication library
- Server-side session management ONLY — no JWT in localStorage or cookies managed by client code
- Session tokens: HttpOnly, Secure, SameSite=Strict cookies
- Session expiry: configurable per client, default 24 hours with sliding window
- Multi-factor authentication support required for admin/privileged roles
- OAuth/OIDC for third-party identity providers (Cognito, Auth0, Azure AD)

## Authorization
- Role-Based Access Control (RBAC) enforced at middleware AND API layer
- Never rely solely on client-side route protection
- Server Components check permissions before rendering sensitive data
- Server Actions validate authorization before executing mutations
- API Route Handlers verify auth on every request

```typescript
// ✅ Server-side auth check in Server Component
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    redirect('/unauthorized');
  }
  // render admin content
}
```

## Secret Management
- **Production:** AWS Secrets Manager for credentials, API keys, connection strings
- **Development:** `.env.local` files (gitignored)
- **CI/CD:** GitHub Actions secrets or AWS SSM Parameter Store
- **NEVER:** Hardcoded in source, committed to git, logged, or in client bundles
- **Rotation:** Secrets must support rotation without deployment

## Input Validation
- ALL external input validated with Zod (TypeScript) or Pydantic (Python)
- Validate on BOTH client (UX) and server (security) — server is authoritative
- Sanitize HTML content — use DOMPurify for any user-generated HTML rendering
- SQL: parameterized queries ONLY — ORMs (Prisma, SQLAlchemy) handle this
- File uploads: validate type, size, content (not just extension)

## Dependency Security
- `npm audit` / `pip-audit` runs in CI — fail on high/critical vulnerabilities
- Dependabot or Renovate enabled for automated dependency updates
- Lock files (`package-lock.json`, `requirements.txt`) committed and reviewed
- No `dependencies` with known CVEs in production
- Evaluate new dependencies: maintenance status, download count, security history

## Content Security Policy
```typescript
// next.config.js — baseline CSP
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:;
  font-src 'self';
  connect-src 'self' https://*.amazonaws.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
`;
```
- Tighten per-project — remove `unsafe-eval` and `unsafe-inline` where possible
- Report-only mode first, then enforce

## OWASP Top 10 Coverage
| Threat | Mitigation |
|--------|------------|
| Injection | Zod/Pydantic validation, parameterized queries |
| Broken Auth | Auth.js server sessions, MFA for privileged roles |
| Sensitive Data Exposure | Encryption at rest/transit, data classification |
| XXE | No XML parsing of untrusted input |
| Broken Access Control | RBAC at middleware + API, Server Component checks |
| Security Misconfiguration | CDK security defaults, cdk-nag, CSP headers |
| XSS | React auto-escaping, DOMPurify, CSP |
| Insecure Deserialization | Zod/Pydantic schema validation on all inputs |
| Vulnerable Components | Automated dependency scanning in CI |
| Insufficient Logging | Structured audit logging, CloudTrail |

## API Security
- Rate limiting on all public endpoints
- CORS configured explicitly — never `*` in production
- Request size limits enforced
- API versioning for breaking changes
- No sensitive data in URL parameters — use request body or headers

## Infrastructure Security
See `enterprise-iac-standards.md` for detailed infrastructure security patterns.

## Incident Response
- Security issues tagged with `security` type in commits and PRs
- Critical vulnerabilities: patch within 24 hours
- High vulnerabilities: patch within 7 days
- Medium/Low: address in next sprint
- Document all security decisions in ADRs (Architecture Decision Records)
