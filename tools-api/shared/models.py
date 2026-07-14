"""Agent registry data models."""
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional
import uuid
import json


@dataclass
class AgentDefinition:
    """An agent registered in the Aerostack agent registry."""
    agent_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    description: str = ""
    status: str = "inactive"  # inactive | active | error | deploying
    agent_type: str = "tool"  # tool | autonomous | workflow | assistant
    endpoint: str = ""        # AgentCore runtime URL or Lambda ARN
    version: str = "0.1.0"
    capabilities: list[str] = field(default_factory=list)
    config: dict = field(default_factory=dict)
    owner: str = ""
    tags: list[str] = field(default_factory=list)
    kb_access: list[str] = field(default_factory=list)  # KB IDs this agent can read
    kb_write: list[str] = field(default_factory=list)   # KB IDs this agent can write to
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict) -> "AgentDefinition":
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)
