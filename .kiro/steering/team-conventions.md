---
title: Team Conventions
inclusion: always
---

# Team Conventions

> **CUSTOMIZE THIS FILE** per engagement.

## Git
- Branch naming: `{type}/{ticket}-{short-description}` (e.g., `feat/REKAL-42-rent-roll-parser`)
- Types: feat, fix, refactor, docs, infra, test, chore, security
- Commit messages: Conventional Commits format (enforced by hook)
- PRs require at least 1 review before merge
- Squash merge to main

## Sprint Cadence
- Weekly sprint reviews with customer showcase
- Daily async standup in project Slack channel
- Sprint 0 outputs finalize before build begins

## Documentation
- README.md in every deployable service
- Architecture Decision Records (ADRs) for non-obvious choices in `docs/adr/`
- Runbooks for operational procedures
- No over-documentation — if the code is clear, don't repeat it in prose

## Communication
- Customer comms: professional, concise, validation-first
- Internal comms: direct, no meetings-for-meetings, async-default
- Escalation: technical -> architect -> Will (per ASA escalation ladder)

## Definition of Done
- Code reviewed and approved
- Tests pass (unit + integration)
- Security hooks pass (no secrets, no critical findings)
- Documentation updated if API or architecture changed
- Deployed to staging and verified
