---
title: Python Standards
inclusion: fileMatch
fileMatchPattern: "*.py,*pytest*,*requirements*"
---

# enterprise Python Standards

## Runtime & Environment
- Python 3.11+ required (AWS Lambda runtime alignment)
- Virtual environments mandatory: `python -m venv .venv`
- Dependencies in `requirements.txt` with pinned versions
- Dev dependencies in `requirements-dev.txt`
- Use `pyproject.toml` for package configuration when building distributable modules

## Code Style
- Formatter: `black` (line length 88)
- Linter: `ruff` (replaces flake8, isort, pyflakes)
- Type checking: `mypy` with strict mode
- All functions must have type annotations
- All public functions must have docstrings

```python
# ✅ Good
def calculate_risk_score(
    deal_value: float,
    industry: str,
    compliance_flags: list[str],
) -> RiskAssessment:
    """Calculate risk score for a deal based on value, industry, and compliance flags.

    Args:
        deal_value: Total deal value in USD.
        industry: Industry vertical code.
        compliance_flags: List of applicable compliance requirement codes.

    Returns:
        RiskAssessment with score and recommendations.
    """
    ...
```

## Project Structure
```
src/
├── handlers/           # Lambda handler entry points
│   ├── api/            # API Gateway handlers
│   └── events/         # EventBridge / SQS handlers
├── services/           # Business logic layer
├── models/             # Pydantic models
├── repositories/       # Data access layer
├── utils/              # Shared utilities
└── config/             # Configuration and settings
tests/
├── unit/
├── integration/
└── conftest.py         # Shared fixtures
```

## FastAPI Patterns
- Pydantic v2 models for all request/response bodies
- Dependency injection for database sessions, auth context
- Router organization by domain (users, deals, compliance)
- Middleware for request ID tracking and audit logging
- Exception handlers that return structured error responses — never expose stack traces

```python
# ✅ Structured API responses
from pydantic import BaseModel

class APIResponse[T](BaseModel):
    success: bool
    data: T | None = None
    error: str | None = None
    request_id: str
```

## AWS Lambda Patterns
- Single responsibility per handler
- Cold start optimization: lazy imports, minimize package size
- Structured logging with `aws-lambda-powertools`
- Idempotency via `@idempotent` decorator for write operations
- Environment variable validation at module level, not per-invocation

```python
from aws_lambda_powertools import Logger, Tracer, Metrics
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
tracer = Tracer()
metrics = Metrics()

@logger.inject_lambda_context
@tracer.capture_lambda_handler
@metrics.log_metrics
def handler(event: dict, context: LambdaContext) -> dict:
    ...
```

## Testing — pytest
- Test files: `test_[module].py`
- Fixtures in `conftest.py` at appropriate directory level
- Minimum 80% coverage for business logic (`services/`)
- Integration tests use localstack or moto for AWS service mocking
- Run with: `pytest -q --tb=short -x` (fail fast, minimal output)

```python
# ✅ Good test structure
class TestRiskScoreCalculation:
    def test_high_value_deal_increases_score(self, sample_deal):
        result = calculate_risk_score(deal_value=1_000_000, ...)
        assert result.score > 70

    def test_compliance_flags_add_weight(self, sample_deal):
        result = calculate_risk_score(compliance_flags=["SOX", "HIPAA"], ...)
        assert result.flags_weight > 0
```

## Pydantic Models
- All external data validated through Pydantic models
- Use `model_validator` for cross-field validation
- Sensitive fields use `SecretStr` type
- Serialization aliases for API compatibility (`alias_generator`)

## Security
- No hardcoded secrets — use AWS Secrets Manager or SSM Parameter Store
- Input sanitization on all external inputs
- SQL parameterization only — never string formatting for queries
- Dependency scanning via `pip-audit` in CI
- No `eval()`, `exec()`, or `pickle.loads()` on external data

## GRC-Specific Python Patterns
- Audit logging decorator for all data-modifying operations
- PII fields marked with custom Pydantic field metadata for data classification
- Data retention policies enforced at the repository layer
- Request correlation IDs propagated through all service calls
