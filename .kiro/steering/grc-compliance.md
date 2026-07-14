---
title: GRC Compliance Standards
inclusion: always
---

# enterprise GRC Compliance Standards

## Overview
These standards ensure enterprise deliverables meet governance, risk, and compliance requirements. This is not optional — it's a core differentiator in our client engagements.

## Data Classification Framework
Every data element in the system must be classifiable:

| Level | Label | Examples | Handling |
|-------|-------|----------|----------|
| 1 | **PUBLIC** | Marketing content, public APIs | No restrictions |
| 2 | **INTERNAL** | Internal docs, non-sensitive configs | Auth required, no external sharing |
| 3 | **CONFIDENTIAL** | PII, financial data, contracts | Encrypted at rest/transit, access logged, retention policy |
| 4 | **RESTRICTED** | Credentials, encryption keys, PHI | KMS encryption, MFA access, audit every access |

### Enforcement in Code

#### TypeScript / React
```typescript
// Mark data classification on types
interface UserProfile {
  id: string;                          // INTERNAL
  displayName: string;                 // INTERNAL
  email: string;                       // CONFIDENTIAL - PII
  ssn?: string;                        // RESTRICTED - PII
}

// Server Components: CONFIDENTIAL+ data never serialized to client
// unless explicitly required and justified
export default async function UserPage({ params }: Props) {
  const user = await getUser(params.id);
  // ✅ Only pass INTERNAL fields to client components
  return <UserCard name={user.displayName} />;
  // ❌ Never: <UserCard user={user} /> (leaks CONFIDENTIAL fields)
}
```

#### Python
```python
from pydantic import BaseModel, Field

class UserProfile(BaseModel):
    id: str = Field(classification="INTERNAL")
    display_name: str = Field(classification="INTERNAL")
    email: str = Field(classification="CONFIDENTIAL")
    ssn: str | None = Field(default=None, classification="RESTRICTED")

    class Config:
        # Exclude RESTRICTED fields from default serialization
        json_schema_extra = {"x-data-classification": "CONFIDENTIAL"}
```

## PII Handling Rules
- **NEVER store PII in client-side state** (Zustand, TanStack Query cache, localStorage)
- **NEVER log PII** — mask in all logging output
- **NEVER include PII in URLs** — use request body or server-side lookups
- **Encrypt PII at rest** — KMS for databases, S3 server-side encryption
- **Encrypt PII in transit** — TLS 1.2+ required for all connections
- **Retention policy** — PII must have defined retention period and automated deletion
- **Right to deletion** — systems must support data subject deletion requests

## Audit Logging
Every data-modifying operation must emit an audit event:

```typescript
interface AuditEvent {
  timestamp: string;           // ISO 8601
  requestId: string;           // Correlation ID
  userId: string;              // Who performed the action
  action: string;              // What was done (CRUD operation)
  resource: string;            // What was affected (entity type + ID)
  resourceClassification: string; // Data classification level
  outcome: 'success' | 'failure';
  sourceIp?: string;           // Request origin
  changes?: {                  // What changed (for updates)
    field: string;
    oldValue?: string;         // Masked if CONFIDENTIAL+
    newValue?: string;         // Masked if CONFIDENTIAL+
  }[];
}
```

### Audit Log Storage
- CloudWatch Logs with retention policy (minimum 1 year for SOC 2)
- Immutable — no deletion capability for audit logs
- Cross-region replication for disaster recovery
- Separate IAM permissions for audit log access

## Access Control Patterns

### Next.js Middleware (First Line)
```typescript
// middleware.ts — route-level access control
export function middleware(request: NextRequest) {
  const session = getSessionFromCookie(request);
  const requiredRole = getRouteRole(request.nextUrl.pathname);

  if (requiredRole && (!session || !hasRole(session, requiredRole))) {
    return NextResponse.redirect(new URL('/unauthorized', request.url));
  }
}
```

### Server Action (Second Line)
```typescript
// Every Server Action validates authorization independently
'use server';

export async function deleteUser(userId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'admin') {
    throw new Error('Unauthorized');
  }
  // Emit audit event before action
  await emitAuditEvent({
    userId: session.user.id,
    action: 'DELETE',
    resource: `user:${userId}`,
    resourceClassification: 'CONFIDENTIAL',
  });
  // Perform deletion
}
```

## WCAG 2.1 AA Compliance
Required for all client-facing interfaces:
- Semantic HTML structure
- ARIA attributes where native semantics insufficient
- Keyboard navigation for all interactive elements
- Color contrast ratios meeting AA standards
- Focus management for dynamic content
- Screen reader compatible (test with VoiceOver/NVDA)
- See `component-library.md` for specific component requirements

## SOC 2 Alignment
Development practices mapped to SOC 2 Trust Service Criteria:

| Criteria | Practice |
|----------|----------|
| CC6.1 — Logical Access | RBAC, middleware auth, Server Action auth checks |
| CC6.2 — Access Provisioning | Role management via admin interface, audit logged |
| CC6.3 — Access Removal | Session expiry, user deactivation workflow |
| CC7.1 — System Monitoring | Structured logging, CloudWatch alarms, error tracking |
| CC7.2 — Anomaly Detection | GuardDuty, rate limiting, failed auth monitoring |
| CC8.1 — Change Management | PR reviews, CI/CD pipeline, conventional commits |
| A1.2 — Recovery Procedures | Backup verification, disaster recovery tests |

## Compliance Automation
- **Pre-commit:** Secret scanning, dependency audit
- **CI:** Security linting, WCAG audit, coverage gates
- **Deployment:** cdk-nag rules, AWS Config compliance checks
- **Runtime:** CloudTrail, GuardDuty, Config rules continuous monitoring
- **Reporting:** Automated evidence collection for audit readiness

## Client-Specific Compliance
For engagements requiring specific frameworks:
- **HIPAA:** Additional PHI handling controls, BAA documentation
- **SOX:** Financial data controls, segregation of duties
- **GDPR:** Data processing agreements, consent management, right to erasure
- **FedRAMP:** Additional boundary controls, continuous monitoring

Create client-specific steering documents extending these base standards.
