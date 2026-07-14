"""
KB Client — shared module for any agent Lambda to retrieve knowledge context.

Usage:
    from kb_client import KBClient

    client = KBClient(table_name="aerostack-tools-dev-knowledge-base")
    context = client.get_agent_context(
        query="AWS Lambda best practices for cold starts",
        kb_ids=["system-brand-voice", "system-platform-playbook"],
        limit=5,
    )
    # context = [{"title": "...", "content": "...", "score": 0.92}, ...]

Copy this file into any Lambda function directory that needs KB access.
All it needs is DynamoDB read permission on the KB table and
Bedrock invoke permission for the embedding model.
"""
import json
import math
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key


class KBClient:
    def __init__(self, table_name: str, embed_model_id: str = "amazon.titan-embed-text-v2:0"):
        self._table_name = table_name
        self._embed_model_id = embed_model_id
        self._ddb = None
        self._bedrock = None

    def _table(self):
        if self._ddb is None:
            self._ddb = boto3.resource("dynamodb")
        return self._ddb.Table(self._table_name)

    def _bedrock_client(self):
        if self._bedrock is None:
            self._bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
        return self._bedrock

    def _embed(self, text: str) -> list[float]:
        response = self._bedrock_client().invoke_model(
            modelId=self._embed_model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "inputText": text[:8000],
                "dimensions": 256,
                "normalize": True,
            }),
        )
        result = json.loads(response["body"].read())
        return result.get("embedding", [])

    @staticmethod
    def _cosine_sim(a: list[float], b: list[float]) -> float:
        if len(a) != len(b) or not a:
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        mag_a = math.sqrt(sum(x * x for x in a))
        mag_b = math.sqrt(sum(x * x for x in b))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)

    def get_agent_context(
        self,
        query: str,
        kb_ids: list[str],
        limit: int = 5,
        min_score: float = 0.25,
    ) -> list[dict]:
        """Retrieve relevant KB entries for an agent's query.

        Returns a list of dicts with title, content, tags, score, kb_id.
        Sorted by relevance score descending.
        """
        if not query or not kb_ids:
            return []

        query_emb = self._embed(query)
        results = []

        for kb_id in kb_ids:
            items = self._table().query(
                KeyConditionExpression=Key("pk").eq(f"KB#{kb_id}")
            ).get("Items", [])

            for item in items:
                emb = item.get("embedding", [])
                if not emb:
                    continue
                score = self._cosine_sim(query_emb, [float(v) for v in emb])
                if score < min_score:
                    continue
                results.append({
                    "title": item.get("title", ""),
                    "content": item.get("content", ""),
                    "tags": item.get("tags", []),
                    "score": round(score, 4),
                    "kb_id": kb_id,
                    "entry_id": item.get("sk", ""),
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def get_all_entries(self, kb_id: str) -> list[dict]:
        """Get all entries from a KB (no embedding search, just list)."""
        items = self._table().query(
            KeyConditionExpression=Key("pk").eq(f"KB#{kb_id}")
        ).get("Items", [])

        return [
            {
                "title": item.get("title", ""),
                "content": item.get("content", ""),
                "tags": item.get("tags", []),
                "entry_id": item.get("sk", ""),
            }
            for item in items
        ]

    def build_context_block(
        self,
        query: str,
        kb_ids: list[str],
        limit: int = 5,
        max_chars: int = 3000,
    ) -> str:
        """Build a formatted context string for injection into an LLM prompt.

        Returns a string like:
            [Brand Voice] Title: ...
            Content: ...

            [Story Library] Title: ...
            Content: ...
        """
        entries = self.get_agent_context(query, kb_ids, limit=limit)
        if not entries:
            return ""

        parts = []
        total_chars = 0
        for entry in entries:
            kb_label = entry["kb_id"].replace("system-", "").replace("-", " ").title()
            block = f"[{kb_label}] {entry['title']}\n{entry['content']}"
            if total_chars + len(block) > max_chars:
                remaining = max_chars - total_chars
                if remaining > 100:
                    parts.append(block[:remaining] + "...")
                break
            parts.append(block)
            total_chars += len(block)

        return "\n\n".join(parts)
