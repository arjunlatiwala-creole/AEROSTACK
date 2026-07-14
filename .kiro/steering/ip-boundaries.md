---
title: IP Boundaries
inclusion: always
---

# Intellectual Property Boundaries

## enterprise Platform IP (We Own, We Reuse)
- Infrastructure-as-code patterns and CDK constructs
- Agent orchestration frameworks and base patterns
- Reusable utility libraries (logging, error handling, auth middleware)
- Assessment templates, SOW generators, compliance tooling
- CI/CD pipeline definitions and deployment automation
- This Kiro standards framework itself

## Customer-Specific IP (Customer Owns per MSA)
- Domain-specific prompts, knowledge bases, and training data
- Customer-branded UI/UX and visual design
- Business logic specific to customer's operations
- Integrations with customer's existing systems
- Customer data, outputs, and generated reports

## Boundary Rules for Agent-Generated Code
- If Kiro generates code that extends a enterprise framework: platform IP
- If Kiro generates code specific to customer business logic: customer IP
- If ambiguous: document and flag for architect review before merge
- Never commit customer data (even test data) to enterprise repos
- Customer data directories must be in .gitignore
