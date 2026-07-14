---
inclusion: auto
---

# Aerostack Tools Architecture

## Guiding Principle
We are building NEW serverless features alongside an existing TypeScript CDK codebase (`infra/`).
DO NOT modify anything in `infra/` — that codebase is maintained by a partner.
All new work lives in `tools-api/` using Python + AWS CDK + Bedrock AgentCore.

## Project Structure
```
tools-api/                    # Our new Python serverless stack
├── cdk/                      # CDK app (Python)
│   ├── app.py               # CDK entry point
│   ├── stacks/
│   │   └── tools_stack.py   # Main stack: API GW + Lambdas
│   └── cdk.json
├── agents/                   # Bedrock AgentCore agents
│   ├── opps_agent/          # Opportunity scoring/analysis agent
│   ├── sow_agent/           # SOW generation agent
│   ├── csat_agent/          # CSAT analysis agent
│   └── delivery_agent/      # Delivery tracking agent
├── functions/                # Lambda handlers (non-agent)
│   ├── opps/
│   ├── sow/
│   ├── delivery/
│   └── csat/
├── shared/                   # Shared utilities
│   ├── dynamo.py
│   └── auth.py
├── requirements.txt
└── pyproject.toml
```

## Tech Stack
- Python 3.13
- AWS CDK (Python) for infrastructure
- Bedrock AgentCore for AI agents (Strands framework, Bedrock models)
- API Gateway (REST) for tool endpoints
- Lambda for compute
- DynamoDB for storage (new tables, can read existing via cross-stack refs)
- Cognito — reuse existing user pool from partner's stack

## Frontend Integration
- Frontend calls `VITE_TOOLS_API_URL` for new tool endpoints
- New tool components: OppsTools, SowTools, DeliveryTools, CsatTools
- Located in `pwa-frontend/src/components/aerostack/`

## Key Rules
1. Never modify files in `infra/` directory
2. New tables go in our tools_stack.py
3. Read-only access to existing tables via table name imports
4. All agents use Bedrock AgentCore with Strands framework
5. Python code follows standard conventions (type hints, docstrings)
6. CDK stack name prefix: `Aerostack-Tools-`
