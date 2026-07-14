# Aerostack Quick Reference Card

## 🚀 Start Aerostack
```bash
./dev-stack.sh
# OR
make dev

# Frontend: http://localhost:5173
# Backend: http://localhost:8000
```

## 🎯 New Dashboards

| Dashboard | URL Tab | Purpose |
|-----------|---------|---------|
| 💰 **Financials** | Click "💰 Financials" | Budget, spend, revenue, ROI tracking |
| ⚙️ **Engineering** | Click "⚙️ Engineering" | Cross-customer work board |

## 📊 Key Features

### Financial Tracking
```typescript
// Add financials to any loop
const fn = executable('FinancialService', 'createFinancials');
await fn({
  loop_id: 'your-loop-id',
  budget_usd: 100000,
  actual_spend_usd: 50000,
  revenue_generated_usd: 150000,
  fiscal_period: '2025-Q1'
});

// Get OKR rollup
const rollup = executable('FinancialService', 'getOkrFinancialRollup');
await rollup({ objective_loop_id: 'okr-id', include_key_results: true });
```

### Engineering Work
```typescript
// Create work item
const fn = executable('EngineeringService', 'createWorkItem');
await fn({
  title: 'Customer Assessment',
  work_type: 'ASSESSMENT',  // or AI_FEATURE, CN_TASK, MSP_TASK
  customer_name: 'Acme Corp',
  priority: 1,
  assigned_to: 'engineer@company.com',
  effort_estimate: 5
});

// Get cross-customer summary
const summary = executable('EngineeringService', 'getCrossCustomerSummary');
await summary();
```

### Slack Triggers
```typescript
// Auto-notify on blocked work
const fn = executable('SlackService', 'createTrigger');
await fn({
  workflow_type: 'eng_blocked',
  channel_id: 'C12345678',
  message_template: '⚠️ {{title}} is blocked!',
  conditions: {},
  enabled: true
});
```

### Linear Integration
```typescript
// Configure Linear
const fn = executable('IntegrationService', 'setLinearConfig');
await fn({
  api_key: 'lin_api_...',
  team_id: 'team-id',
  sync_enabled: true,
  sync_direction: 'bidirectional'
});

// Sync from Linear
const sync = executable('IntegrationService', 'syncFromLinear');
await sync({ system: 'linear', sync_direction: 'pull' });
```

## 🎨 Work Types

| Type | Use For |
|------|---------|
| `ASSESSMENT` | Customer assessments |
| `AI_FEATURE` | AI/ML features |
| `CN_TASK` | Cloud-native tasks |
| `MSP_TASK` | MSP todos |
| `INFRASTRUCTURE` | Infrastructure work |
| `SECURITY` | Security work |

## 📋 Statuses

```
backlog → todo → in_progress → review → done
                                      ↘ blocked
```

## 🔔 Trigger Types

- `loop_complete` - Loop completed
- `deal_won` - Deal closed won
- `eng_blocked` - Engineering work blocked
- `budget_alert` - Budget exceeded
- `okr_at_risk` - OKR approaching deadline

## 📚 Documentation

- **Aerostack-FUNCTIONAL-IMPLEMENTATION.md** - Technical guide
- **QUICK-FEATURE-GUIDE.md** - How-to guide
- **IMPLEMENTATION-SUMMARY.md** - Overview
- **This file** - Quick reference

## ✅ Health Status

| Status | Meaning |
|--------|---------|
| 🟢 On Track | < 85% of budget spent |
| 🟠 At Risk | 85-110% of budget |
| 🔴 Over Budget | > 110% of budget |
| ✅ Complete | Done |

## 🎯 Quick Checks

```bash
# Check backend services
curl http://localhost:8000

# Check MongoDB
docker ps | grep mongo

# Rebuild common package (if types change)
cd common && pnpm build
```

---

**Aerostack is ready! Start using the 💰 Financials and ⚙️ Engineering tabs now!** 🚀

