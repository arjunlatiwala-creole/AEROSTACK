# Model Routing Recommendation
Task: Diagnose intermittent 502 errors in production API logs
Classification: Live telemetry correlation + Multi-step orchestration

## Recommended Model Characteristics
- Context window: Large (128K+)
- Reasoning: Very High
- Speed: Medium
- Key capability: Strong temporal correlation and tool use for iterative log querying

## Execution Strategy
- Approach: Multi-turn
- Estimated turns: 3-5
- Sub-tasks: 
  1. Fetch recent ingress logs
  2. Filter by 502 errors and extract trace IDs
  3. Query backend service logs using trace IDs
  4. Synthesize root cause

## Justification
Diagnosing intermittent errors requires searching through large volumes of logs and following trace IDs across different services. This requires a model with a large context window to hold the log data, and strong reasoning capabilities to spot temporal patterns (e.g. "every time the DB spikes, 3 seconds later we get a 502"). A single-pass approach will fail because the required logs aren't known until the initial ingress errors are found.

## Warning Flags
- Context window overflow: If querying a high-traffic service without time bounds, the log dump will easily exceed context limits. Force the agent to use strict time windows (`--since 10m`) when querying logs.
