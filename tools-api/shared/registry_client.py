"""Client for agents to self-register with the Aerostack agent registry."""
import json
import os
from urllib.request import Request, urlopen
from urllib.error import URLError


class RegistryClient:
    """Lightweight client — no external deps, usable from any agent."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (
            base_url
            or os.environ.get("Aerostack_TOOLS_API_URL", "")
        ).rstrip("/")

    def register(
        self,
        name: str,
        description: str,
        agent_type: str = "tool",
        endpoint: str = "",
        version: str = "0.1.0",
        capabilities: list[str] | None = None,
        tags: list[str] | None = None,
        owner: str = "",
    ) -> dict:
        payload = {
            "name": name,
            "description": description,
            "agent_type": agent_type,
            "endpoint": endpoint,
            "version": version,
            "capabilities": capabilities or [],
            "tags": tags or [],
            "owner": owner,
        }
        return self._post("/agents", payload)

    def heartbeat(self, agent_id: str, status: str = "active") -> dict:
        return self._put(f"/agents/{agent_id}", {"status": status})

    def deregister(self, agent_id: str) -> dict:
        return self._delete(f"/agents/{agent_id}")

    def list_agents(
        self, agent_type: str | None = None, status: str | None = None
    ) -> list[dict]:
        qs = []
        if agent_type:
            qs.append(f"type={agent_type}")
        if status:
            qs.append(f"status={status}")
        path = "/agents" + (f"?{'&'.join(qs)}" if qs else "")
        result = self._get(path)
        return result.get("agents", [])

    def _get(self, path: str) -> dict:
        req = Request(f"{self.base_url}{path}", method="GET")
        req.add_header("Content-Type", "application/json")
        return self._send(req)

    def _post(self, path: str, body: dict) -> dict:
        data = json.dumps(body).encode()
        req = Request(f"{self.base_url}{path}", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        return self._send(req)

    def _put(self, path: str, body: dict) -> dict:
        data = json.dumps(body).encode()
        req = Request(f"{self.base_url}{path}", data=data, method="PUT")
        req.add_header("Content-Type", "application/json")
        return self._send(req)

    def _delete(self, path: str) -> dict:
        req = Request(f"{self.base_url}{path}", method="DELETE")
        req.add_header("Content-Type", "application/json")
        return self._send(req)

    def _send(self, req: Request) -> dict:
        try:
            with urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except URLError as exc:
            return {"error": {"code": "NETWORK", "message": str(exc)}}
