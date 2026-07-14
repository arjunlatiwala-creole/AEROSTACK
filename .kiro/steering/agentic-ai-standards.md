---
title: Agentic AI Standards (AWS Bedrock)
inclusion: fileMatch
fileMatchPattern: "*agent*,*guardrail*,*bedrock*,*knowledge-base*"
---

# enterprise Agentic AI Standards — AWS Bedrock & AgentCore

## Overview
Standards for designing, building, deploying, and governing AI agents on AWS Bedrock. These apply to all enterprise projects involving autonomous or semi-autonomous AI systems, from simple RAG pipelines to multi-agent orchestration.

## Architecture Decision Tree

### When to Use What
1. **Simple Q&A / RAG** → Bedrock Knowledge Bases + Foundation Model. No agent needed.
2. **Single-task automation** → Bedrock Agent with action groups. One agent, scoped tools.
3. **Multi-step workflow with human approval** → Bedrock Agent with return-of-control. Agent proposes, human confirms.
4. **Multi-agent orchestration** → AgentCore with supervisor pattern. Multiple specialized agents coordinated by an orchestrator.
5. **Long-running autonomous tasks** → AgentCore with persistent sessions, checkpointing, and guardrails.

**Default: Start with the simplest pattern that solves the problem. Escalate complexity only when requirements demand it.**

## Agent Design Principles

### 1. Single Responsibility per Agent
Each agent has ONE clear domain and purpose. Never build a "do everything" agent.
```
✅ Good:
- Document Analysis Agent — reads contracts, extracts clauses, flags risks
- Compliance Check Agent — validates against regulatory requirements
- Report Generation Agent — produces formatted compliance reports

❌ Bad:
- General Purpose Agent — reads docs, checks compliance, generates reports, sends emails, manages calendar
```

### 2. Explicit Tool Boundaries
Agents interact with the world through TOOLS (action groups). Each tool must:
- Have a clear, descriptive name and description (the agent reads these to decide when to use them)
- Accept well-defined input schemas (Zod/JSON Schema)
- Return structured output with success/failure indication
- Have explicit permissions — least privilege IAM
- Be idempotent where possible (safe to retry)

### 3. Human-in-the-Loop by Default
For GRC clients and sensitive operations, agents should NOT auto-execute without approval:
- **Return-of-control** for any action that modifies data, spends money, or contacts external systems
- **Confirmation prompts** before irreversible actions
- **Audit trail** of every agent decision and action taken
- **Override capability** — humans can always intervene and redirect

### 4. Guardrails Are Non-Negotiable
Every agent deployment MUST include Bedrock Guardrails:
- Content filters (toxicity, PII, prompt injection defense)
- Topic restrictions (keep agent within its domain)
- Word/phrase filters for client-specific requirements
- PII redaction for data flowing through the agent
- Grounding checks to reduce hallucination

## Bedrock Agent Configuration Standards

### Action Group Design
```python
# Action groups should be organized by domain
# Each action group = one Lambda function with related operations

# ✅ Good — scoped to one domain
action_group_contract_analysis = {
    "name": "ContractAnalysis",
    "description": "Analyze legal contracts to extract key terms, obligations, and risk factors",
    "actions": [
        {
            "name": "extractClauses",
            "description": "Extract specific clause types from a contract document",
            "parameters": {
                "documentId": {"type": "string", "required": True},
                "clauseTypes": {"type": "array", "items": {"type": "string"}}
            }
        },
        {
            "name": "assessRisk",
            "description": "Evaluate risk level of contract terms against company policy",
            "parameters": {
                "documentId": {"type": "string", "required": True},
                "policyId": {"type": "string", "required": True}
            }
        }
    ]
}

# ❌ Bad — mixed concerns
action_group_everything = {
    "name": "DoStuff",
    "description": "Does various things",
    "actions": [
        {"name": "analyzeContract", ...},
        {"name": "sendEmail", ...},
        {"name": "updateDatabase", ...},
        {"name": "generateInvoice", ...}
    ]
}
```

### Agent Instructions Pattern
Agent instructions (system prompts) must be:
- Specific about the agent's role and boundaries
- Explicit about what the agent should NOT do
- Clear about when to ask for human input vs. proceed autonomously
- Versioned and stored in source control (not just the console)

```
You are a Contract Analysis Agent for {client_name}.

YOUR ROLE:
- Analyze uploaded contract documents
- Extract key terms, obligations, deadlines, and risk factors
- Compare terms against company policy guidelines
- Flag items requiring human legal review

BOUNDARIES:
- You ONLY analyze contracts. Do not draft, modify, or sign contracts.
- You do NOT provide legal advice. Flag findings for human review.
- You do NOT access systems outside the document store and policy database.
- If asked to do anything outside contract analysis, explain your scope and suggest the appropriate team.

HUMAN ESCALATION:
- Always escalate: liability clauses exceeding ${threshold}, non-standard termination terms, data processing agreements
- Present findings with confidence levels: HIGH (direct quote), MEDIUM (inferred), LOW (uncertain)
```

### Knowledge Base Configuration
```typescript
// CDK pattern for Bedrock Knowledge Base
const knowledgeBase = new bedrock.KnowledgeBase(this, 'ContractKB', {
  name: `${projectName}-contract-kb`,
  description: 'Client contract documents and policy guidelines',
  embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2,
  instruction: 'Use this knowledge base for contract terms, company policies, and regulatory requirements.',
});

// S3 data source with proper access controls
const dataSource = knowledgeBase.addS3DataSource({
  bucket: documentBucket,
  inclusionPrefixes: ['contracts/', 'policies/'],
  // Never include: credentials, internal communications, employee data
  chunkingStrategy: bedrock.ChunkingStrategy.SEMANTIC,
});
```

### Guardrail Configuration
```typescript
const guardrail = new bedrock.Guardrail(this, 'AgentGuardrail', {
  name: `${projectName}-guardrail`,
  contentFilters: [
    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
    { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
  ],
  piiEntities: [
    // Redact PII in agent responses
    { type: 'SSN', action: 'BLOCK' },
    { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
    { type: 'US_BANK_ACCOUNT_NUMBER', action: 'BLOCK' },
    { type: 'EMAIL', action: 'ANONYMIZE' },
    { type: 'PHONE', action: 'ANONYMIZE' },
  ],
  topicRestrictions: [
    {
      name: 'OutOfScope',
      definition: 'Topics outside the agent designated domain',
      examples: ['Can you help me write code?', 'What is the weather?'],
      action: 'BLOCK',
    },
  ],
});
```

## AgentCore Standards (Multi-Agent)

### Supervisor Pattern
For multi-agent systems, use a supervisor (orchestrator) agent:
```
Supervisor Agent
├── Routes requests to specialized agents
├── Aggregates results
├── Handles failures and retries
└── Maintains conversation state

Specialized Agents
├── Agent A: Document Analysis
├── Agent B: Compliance Checking
├── Agent C: Report Generation
└── Agent D: Notification Dispatch
```

### Agent Communication
- Agents communicate through structured messages, never free-form text between agents
- Input/output schemas defined and validated at boundaries
- Correlation IDs propagated across agent calls for tracing
- Timeout and retry policies per agent interaction

### Session Management
- AgentCore sessions for stateful multi-turn interactions
- Session state encrypted at rest
- Session expiry configured per use case (default: 30 minutes idle)
- Session data classified per enterprise data classification framework
- No PII stored in session state beyond what's needed for the current interaction

## Model Selection Standards

| Use Case | Default Model | Rationale |
|----------|---------------|-----------|
| Complex reasoning, analysis | Claude Sonnet 4 | Best reasoning-to-cost ratio |
| Simple classification, routing | Claude Haiku | Fast, cheap, good enough |
| High-stakes decisions | Claude Opus | Maximum capability when accuracy is critical |
| Embeddings | Titan Embed Text v2 | AWS-native, good performance, cost-effective |
| Image analysis | Claude Sonnet 4 | Multimodal capability |

- **Never hardcode model IDs** — use configuration that can be updated without deployment
- **Always set max tokens** — prevent runaway costs
- **Temperature: 0 for factual tasks**, 0.3-0.7 for creative/generative tasks
- **Test with the cheapest model first** — upgrade only when quality requires it

## Prompt Engineering Standards

### Versioning
- All agent instructions stored in source control
- Version-tagged (semver) when deployed
- A/B testing capability for prompt improvements
- Rollback plan for every prompt change

### Structure
```
[ROLE DEFINITION]
Clear statement of who the agent is and what it does.

[CONTEXT]
Background information the agent needs.

[INSTRUCTIONS]
Step-by-step guidance for the agent's workflow.

[CONSTRAINTS]
What the agent must NOT do.

[OUTPUT FORMAT]
Expected response structure.

[EXAMPLES]
Few-shot examples of good responses.
```

### Anti-Patterns
- No "be helpful" — too vague, leads to scope creep
- No unbounded instructions — always specify limits
- No implicit permissions — if the agent can delete data, say so explicitly
- No mixing concerns — one prompt section per concern

## Testing Agentic Systems

### Unit Testing
- Test each action group Lambda independently
- Mock Bedrock API calls in unit tests
- Validate input/output schemas with test data
- Test edge cases: empty inputs, malformed data, timeout scenarios

### Integration Testing
- Test agent end-to-end with controlled inputs
- Verify guardrails block prohibited content
- Test human-in-the-loop flows (return of control)
- Validate knowledge base retrieval accuracy

### Evaluation
- Define evaluation criteria per agent (accuracy, relevance, safety)
- Maintain a golden dataset of expected agent behaviors
- Regular evaluation runs (weekly for active development, monthly for production)
- Track metrics: task completion rate, guardrail trigger rate, human escalation rate, latency

### Red Teaming
- Prompt injection testing before any production deployment
- Adversarial inputs to test guardrail effectiveness
- Cross-domain request testing (can agent be tricked into acting outside scope?)
- PII extraction attempts

## Cost Management
- **Set billing alarms** per agent deployment
- **Token budgets** per invocation (max_tokens) and per session
- **Model selection matters** — Haiku for routing/classification saves 10x vs. Sonnet
- **Cache knowledge base queries** where appropriate
- **Monitor** invocation counts, token usage, and cost per agent daily

## Observability
- CloudWatch metrics for all agent invocations
- X-Ray tracing for multi-agent flows
- Structured logging with correlation IDs
- Dashboard per agent: invocations, latency, errors, guardrail triggers, cost
- Alerts on: error rate > 5%, latency P95 > 10s, guardrail trigger rate spike

## GRC-Specific Agentic Requirements
- **Audit every agent action** — log inputs, outputs, tool calls, and decisions
- **Data residency** — ensure agent processing stays in approved regions
- **Model governance** — document which models are approved for which data classifications
- **Explainability** — agents must be able to explain their reasoning when asked
- **Consent** — if agents process personal data, ensure consent is documented
- **Incident response** — plan for agent misbehavior (wrong output, data leak, prompt injection)

## Deployment Standards
- Agents deployed via CDK (see `enterprise-iac-standards.md`)
- Agent configurations (instructions, guardrails, action groups) in source control
- Environment promotion: dev → staging → prod with evaluation gates
- Blue/green deployment for agent version updates
- Rollback capability for all agent components
- Infrastructure tagged per enterprise tagging standards
