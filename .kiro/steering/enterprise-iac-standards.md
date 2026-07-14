---
title: AWS CDK & Infrastructure Standards
inclusion: always
---

# enterprise AWS CDK & Infrastructure Standards

## Infrastructure Tool Decision

### Default: AWS CDK (TypeScript)
- All AWS-native client projects use CDK
- Agentic CDK capabilities align with AI-driven architecture generation
- TypeScript CDK shares language with frontend — single team competency
- L2/L3 constructs preferred over L1 (CloudFormation primitives)

### When Terraform is Required
- Multi-cloud deployments (client has Azure/GCP alongside AWS)
- Client mandate / existing TF estate that must be maintained
- When using Terraform: use CDKTF (CDK for Terraform) as bridge when possible

### enterprise Reusable Architecture Modules
- Reusable modules provide a standardized interface regardless of backend (CDK or TF)
- Module contract: defined inputs (config), outputs (endpoints, ARNs), tagging, security baseline
- Natural language architecture generation targets these module interfaces
- Modules are versioned and published to internal registry

## CDK Project Structure
```
infra/
├── bin/
│   └── app.ts                  # CDK app entry point
├── lib/
│   ├── stacks/                 # Stack definitions
│   │   ├── network-stack.ts
│   │   ├── compute-stack.ts
│   │   ├── data-stack.ts
│   │   └── monitoring-stack.ts
│   ├── constructs/             # Reusable L3 constructs
│   │   ├── secure-api.ts
│   │   ├── compliant-bucket.ts
│   │   └── audited-lambda.ts
│   └── config/                 # Environment configurations
│       ├── environments.ts
│       └── tags.ts
├── test/                       # CDK tests
│   ├── stacks/
│   └── constructs/
├── cdk.json
└── tsconfig.json
```

## Stack Organization
- **One stack per deployment boundary** — resources that deploy together belong together
- **Cross-stack references via interfaces** — never import concrete stack classes
- **Environment-aware configuration** — dev/staging/prod differences via config, not conditionals
- **Stack names include environment** — `enterprise-{client}-{service}-{env}`

## Construct Patterns

### Compliant S3 Bucket (Example L3 Construct)
Every construct should enforce security and compliance defaults:
```typescript
export class CompliantBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CompliantBucketProps) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: props.retainOnDelete
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      serverAccessLogsBucket: props.accessLogBucket,
      lifecycleRules: props.dataRetentionDays
        ? [{ expiration: cdk.Duration.days(props.dataRetentionDays) }]
        : undefined,
    });
  }
}
```

## Mandatory Tagging

Every resource must be tagged with the enterprise standard tag set. Tags are applied at the App level and inherited by all resources.

### Tag Schema

| Tag | What it answers | Examples |
|-----|----------------|----------|
| `enterprise:deployed-by` | Who/what deployed this? | `kiro`, `github-actions`, `developer-name` |
| `enterprise:customer` | Which customer? | `acme-corp`, `startup-xyz` |
| `enterprise:engagement` | Which engagement/project? | `mvp-launch`, `platform-migration` |
| `enterprise:workload` | Which workload/service? | `api`, `frontend`, `data-pipeline` |
| `enterprise:module` | Which module/component? | `auth`, `payments`, `analytics` |
| `enterprise:env` | Which environment? | `dev`, `staging`, `prod` |
| `enterprise:grc` | GRC/compliance framework? | `soc2`, `hipaa`, `gdpr`, `none` |
| `enterprise:solution` | Which enterprise solution? | `onect`, `guardian`, `mira`, `custom` |

### CDK Implementation

```typescript
// lib/config/tags.ts
export interface EnterpriseTagConfig {
  deployedBy: string;
  customer: string;
  engagement: string;
  workload: string;
  module: string;
  env: string;
  grc: string;
  solution: string;
}

export function applyTags(app: cdk.App, config: EnterpriseTagConfig): void {
  cdk.Tags.of(app).add('enterprise:deployed-by', config.deployedBy);
  cdk.Tags.of(app).add('enterprise:customer', config.customer);
  cdk.Tags.of(app).add('enterprise:engagement', config.engagement);
  cdk.Tags.of(app).add('enterprise:workload', config.workload);
  cdk.Tags.of(app).add('enterprise:module', config.module);
  cdk.Tags.of(app).add('enterprise:env', config.env);
  cdk.Tags.of(app).add('enterprise:grc', config.grc);
  cdk.Tags.of(app).add('enterprise:solution', config.solution);
}

// bin/app.ts
import { applyTags } from '../lib/config/tags';

const app = new cdk.App();

const tagConfig: EnterpriseTagConfig = {
  deployedBy: app.node.tryGetContext('deployedBy') || 'kiro',
  customer: app.node.tryGetContext('customer') || 'unknown',
  engagement: app.node.tryGetContext('engagement') || 'unknown',
  workload: app.node.tryGetContext('workload') || 'unknown',
  module: app.node.tryGetContext('module') || 'core',
  env: app.node.tryGetContext('env') || 'dev',
  grc: app.node.tryGetContext('grc') || 'none',
  solution: app.node.tryGetContext('solution') || 'custom',
};

applyTags(app, tagConfig);
```

### Terraform Implementation

```hcl
# variables.tf
variable "deployed_by" {
  type        = string
  description = "Who/what deployed this infrastructure"
  default     = "kiro"
}

variable "customer" {
  type        = string
  description = "Customer name"
}

variable "engagement" {
  type        = string
  description = "Engagement/project name"
}

variable "workload" {
  type        = string
  description = "Workload/service name"
}

variable "module" {
  type        = string
  description = "Module/component name"
  default     = "core"
}

variable "env" {
  type        = string
  description = "Environment"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "Environment must be dev, staging, or prod"
  }
}

variable "grc" {
  type        = string
  description = "GRC/compliance framework"
  default     = "none"
}

variable "solution" {
  type        = string
  description = "enterprise solution name"
  default     = "custom"
}

# locals.tf
locals {
  common_tags = {
    "enterprise:deployed-by" = var.deployed_by
    "enterprise:customer"    = var.customer
    "enterprise:engagement"  = var.engagement
    "enterprise:workload"    = var.workload
    "enterprise:module"      = var.module
    "enterprise:env"         = var.env
    "enterprise:grc"         = var.grc
    "enterprise:solution"    = var.solution
  }
}

# Apply to all resources
resource "aws_s3_bucket" "example" {
  bucket = "example-bucket"
  tags   = local.common_tags
}
```

### Tag Enforcement

All eight tags are required. Use CDK Aspects or Terraform validation to enforce:

```typescript
// lib/aspects/tag-enforcement.ts
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

const REQUIRED_TAGS = [
  'enterprise:deployed-by',
  'enterprise:customer',
  'enterprise:engagement',
  'enterprise:workload',
  'enterprise:module',
  'enterprise:env',
  'enterprise:grc',
  'enterprise:solution',
];

export class TagEnforcementAspect implements cdk.IAspect {
  visit(node: IConstruct): void {
    if (cdk.TagManager.isTaggable(node)) {
      const tags = cdk.Tags.of(node);
      REQUIRED_TAGS.forEach(tag => {
        if (!tags.hasTags() || !this.hasTag(node, tag)) {
          cdk.Annotations.of(node).addError(`Missing required tag: ${tag}`);
        }
      });
    }
  }

  private hasTag(node: IConstruct, tagKey: string): boolean {
    const tagManager = cdk.TagManager.of(node);
    return tagManager?.hasTags() && 
           tagManager.tagValues()[tagKey] !== undefined;
  }
}

// Apply in app.ts
cdk.Aspects.of(app).add(new TagEnforcementAspect());
```

### Default Values

- `enterprise:solution`: Use `custom` for bespoke engagements that aren't a named enterprise solution
- `enterprise:grc`: Use `none` if no specific compliance framework applies
- `enterprise:deployed-by`: Use `kiro` for AI-assisted deployments, `github-actions` for CI/CD
- `enterprise:module`: Use `core` if no specific module boundary applies
```

## Security Defaults (Non-Negotiable)
- **S3:** Block all public access, enforce SSL, enable versioning
- **Lambda:** VPC-attached when accessing data stores, least-privilege IAM
- **API Gateway:** WAF attached, throttling configured, access logging enabled
- **RDS/Aurora:** Encryption at rest, no public accessibility, automated backups
- **Secrets:** AWS Secrets Manager — never SSM Parameter Store for secrets
- **KMS:** Customer-managed keys for data classified CONFIDENTIAL or above
- **CloudTrail:** Enabled with log file validation, multi-region
- **VPC:** No default VPC usage, private subnets for compute, NAT Gateway for outbound

## IAM Patterns
- **Least privilege always** — Start with no permissions, add explicitly
- **No inline policies** — Use managed policies attached to roles
- **No wildcard resources** — Scope to specific ARNs
- **Service-linked roles** where available
- **Permission boundaries** for developer/deployment roles
- **Conditions** for cross-account access and MFA enforcement

```typescript
// ✅ Good — scoped permissions
lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
  resources: [table.tableArn],
}));

// ❌ Bad — overly broad
lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:*'],
  resources: ['*'],
}));
```

## CDK Testing
- **Snapshot tests** for every stack — catch unintended changes
- **Fine-grained assertions** for security-critical resources
- **Validation tests** for construct input constraints
- Run with: `pnpm turbo test --filter=infra`

```typescript
test('S3 bucket blocks public access', () => {
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});
```

## CDK Synth Validation
- `pnpm turbo cdk:synth --filter=infra` must pass before any commit (see `monorepo-standards.md` for Turbo pipeline)
- Use `cdk-nag` for automated security and compliance checking
- Suppress nag rules only with documented justification
- Aspects for organization-wide policy enforcement

## Deployment Pipeline
- CDK Pipelines for self-mutating deployment
- Environment promotion: dev → staging → prod
- Manual approval gate before production
- Rollback strategy defined per stack
- Drift detection enabled in production

## Client Segment Considerations

### Startups
- Single-stack deployments acceptable
- Serverless-first (Lambda, DynamoDB, S3)
- Cost optimization: spot instances, reserved capacity planning

### SMB Transformation
- Multi-stack with shared networking
- Managed services preferred over self-hosted
- Backup and disaster recovery configured

### Enterprise / Agentic
- Multi-account strategy (AWS Organizations)
- Service Control Policies for guardrails
- Transit Gateway for network connectivity
- Centralized logging and monitoring account

### GRC / Compliance-Heavy
- AWS Config rules for continuous compliance
- GuardDuty and Security Hub enabled
- Macie for PII detection in S3
- Evidence collection automated for audit readiness
