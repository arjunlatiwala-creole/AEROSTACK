---
title: AWS Marketplace SaaS Standards
inclusion: fileMatch
fileMatchPattern: "*marketplace*,*fulfillment*,*metering*,*mp-*,*saas*"
---

# AWS Marketplace SaaS Standards — Customer-Deployed Pattern

## Our Model

We build customer-deployed SaaS: the product runs in the customer's AWS account, not ours. The customer pays AWS for infrastructure. We charge a software license fee via Marketplace. This is AWS Architecture Pattern #2 and is explicitly endorsed by AWS for data sovereignty and compliance.

This is NOT traditional hosted SaaS where you run everything and the customer just gets a URL. The customer owns the infrastructure, the data, and the runtime. We own the product code, the deployment automation, and the management plane.

## Why This Works for Marketplace

- Customer subscribes on MP → pays license fee to us
- Customer's infrastructure spend is attributed to us via PRM → drives partner metrics
- Customer owns their data → strongest data sovereignty story
- We manage via cross-account role → standard AWS pattern (Service Catalog, Control Tower do this)
- CloudFormation deployment → auditable, repeatable, version-controlled

## Concurrent Agreements (Required for all new listings)

Starting June 1, 2026, all new SaaS products must support concurrent agreements — multiple purchases of the same product on one AWS account during the same agreement period.

### What this means for us:
- A customer could buy PC3 twice on the same account (e.g., for different business units)
- Each purchase gets its own `CustomerIdentifier` and agreement
- Our fulfillment must handle multiple active subscriptions per account
- Tenant ID must be unique per agreement, not per account

### Implementation:
- Use the `agreement-id` from EventBridge events to distinguish purchases
- Store agreement ID alongside tenant record
- Don't assume one tenant per AWS account
- Metering records must include the correct `CustomerIdentifier` per agreement

## Integration Requirements Checklist

### Fulfillment (Registration URL)
- [ ] POST endpoint receives `x-amzn-marketplace-token`
- [ ] Call `ResolveCustomer` → get CustomerIdentifier, CustomerAWSAccountId, ProductCode, LicenseArn
- [ ] Persist ALL four values in tenant record
- [ ] Show customer-facing first-use experience (not operator portal)
- [ ] Handle `subscribe-fail` — don't grant access until `subscribe-success`

### Subscription Lifecycle (SNS → EventBridge)
- [ ] Subscribe to `aws-mp-subscription-notification-{productcode}` topic
- [ ] Handle `subscribe-success` → activate tenant, start metering
- [ ] Handle `subscribe-fail` → mark payment failed, don't grant access
- [ ] Handle `unsubscribe-pending` → send final metering records
- [ ] Handle `unsubscribe-success` → suspend tenant, revoke access
- [ ] Use SQS queue between SNS and Lambda (reliability)
- [ ] Dead letter queue for failed processing

### Entitlement (Contract model only)
- [ ] Subscribe to `aws-mp-entitlement-notification-{productcode}` topic
- [ ] On `entitlement-updated` → call `GetEntitlements` API
- [ ] Update tenant entitlement in DynamoDB
- [ ] Handle expiration → suspend access

### Metering (All pricing models)
- [ ] Hourly Lambda calls `BatchMeterUsage`
- [ ] Send records even if usage is 0 (AWS best practice)
- [ ] De-duplicate on the hour (records are cumulative)
- [ ] Handle metering failures with retry + DLQ
- [ ] Log all metering calls for audit
- [ ] For $0/free: still send records, just with 0 values

### Subscription Verification
- [ ] Daily check: all active tenants still have valid MP subscriptions
- [ ] Call `ResolveCustomer` or `GetEntitlements` to verify
- [ ] Suspend tenants whose subscriptions lapsed
- [ ] Alert operators on mismatches

### PRM (Partner Revenue Measurement)
- [ ] `aws-apn-id: pc:{product-code}` tag on CFN stack (propagates to all resources)
- [ ] User Agent String on Peregrine API calls (for control plane attribution)
- [ ] Verify attribution appears in Cost Explorer within 48 hours

## Architecture Catches for Customer-Deployed SaaS

### The customer pays for infrastructure — this is expected
- Product description MUST clearly state: "This product deploys resources into your AWS account. You will incur standard AWS charges for these resources."
- Provide cost estimates in documentation
- Use serverless (Lambda, DynamoDB on-demand) to minimize idle cost
- This is NOT a bug — it's the model. AWS endorses it.

### Cross-account access must be minimal and auditable
- Deploy role has only the permissions needed
- All actions logged via CloudTrail in customer account
- Role can be revoked by customer at any time
- No persistent credentials — STS AssumeRole with session tokens

### Customer can see everything
- CloudFormation template is visible to the customer
- Lambda code is in their account — they can read it
- DynamoDB data is in their account — they own it
- This is a feature, not a risk. Transparency builds trust.

### IP protection in customer-deployed model
- The code runs in the customer's account — they can see Lambda source
- Protection comes from: continuous updates, management plane value, agent intelligence
- The product's value is in the platform + automation, not in hiding code
- This is the same model as Datadog Agent, New Relic, Sumo Logic collectors
- AWS explicitly supports this — it's how most observability/security tools work

### Pricing strategy for customer-deployed
- Software license fee via MP (subscription or contract)
- Infrastructure cost paid by customer directly to AWS
- Total cost = license + infrastructure
- Position infrastructure cost as "you control your own costs"
- Offer cost optimization guidance as part of the product

## EventBridge Integration (New standard)

AWS is moving from SNS to EventBridge for MP notifications. New listings should use EventBridge.

```
EventBridge Rule:
  Source: aws.marketplace
  Detail-type: [
    "AWS Marketplace Subscription Notification",
    "AWS Marketplace Entitlement Notification"
  ]
  Target: Lambda function
```

### Event structure:
```json
{
  "source": "aws.marketplace",
  "detail-type": "AWS Marketplace Subscription Notification",
  "detail": {
    "action": "subscribe-success",
    "customer-identifier": "X01EXAMPLEX",
    "product-code": "abc123",
    "offer-identifier": "offer-xyz",
    "agreement-id": "agmt-123"
  }
}
```

## Testing Requirements

Before submitting for public visibility:
1. Subscribe to your own product (limited visibility)
2. Verify ResolveCustomer works
3. Verify metering records are accepted
4. Verify SNS/EventBridge notifications are received
5. Test unsubscribe flow
6. Cancel test subscription before going public
7. AWS Seller Ops reviews (7-10 business days)

## Anti-Patterns

- ❌ Don't grant access before `subscribe-success` confirmation
- ❌ Don't skip metering even at $0 — AWS checks for it
- ❌ Don't assume one subscription per account (concurrent agreements)
- ❌ Don't store MP tokens — they're temporary, use CustomerIdentifier
- ❌ Don't delete customer data on unsubscribe — suspend access, retain data
- ❌ Don't hide infrastructure costs — be transparent in product description
