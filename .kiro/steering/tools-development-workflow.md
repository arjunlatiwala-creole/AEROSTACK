---
inclusion: auto
---

# Tools Development Workflow

## Local Development
1. Agents: `cd tools-api/agents/<agent_name> && agentcore dev`
2. Test agents: `agentcore invoke --dev '{"prompt": "test"}'`
3. CDK synth: `cd tools-api/cdk && cdk synth`
4. CDK deploy: `cd tools-api/cdk && cdk deploy`

## New Tool Checklist
When adding a new tool (e.g., "SOW Tools"):
1. Create Lambda handler in `tools-api/functions/<tool>/`
2. If AI-powered, create agent in `tools-api/agents/<tool>_agent/`
3. Add API Gateway route in `tools-api/cdk/stacks/tools_stack.py`
4. Wire frontend component in `pwa-frontend/src/components/aerostack/<Tool>Tools.tsx`
5. Add route + nav item if not already present

## Deployment
- Stack deploys independently: `cd tools-api/cdk && cdk deploy`
- Does NOT affect partner's stacks (Aerostack-TablesStack, Aerostack-ApiStack, Aerostack-FrontendStack)
- Output: API Gateway URL → set as VITE_TOOLS_API_URL

## Agent Development with AgentCore
- Use `agentcore create` for new agents
- Use Strands framework + Bedrock models
- Test locally with `agentcore dev` + `agentcore invoke --dev`
- Deploy with `agentcore launch` or via CDK
