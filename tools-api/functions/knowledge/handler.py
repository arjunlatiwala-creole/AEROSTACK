"""Knowledge Base Lambda — unified KB management with vector search."""
import json
import math
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

KB_TABLE = os.environ.get("KB_TABLE", "")
MODEL_ID = os.environ.get("KB_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
EMBED_MODEL_ID = os.environ.get("KB_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
STAGE = os.environ.get("STAGE", "dev")

_ddb = None
_bedrock = None

SYSTEM_KBS = {
    "system-engagement": {"name": "Engagement Knowledge", "description": "Client engagement lessons, project context, delivery patterns", "icon": "briefcase", "category": "system", "access": "team"},
    "system-architecture": {"name": "Architecture Patterns", "description": "AWS patterns, infrastructure decisions, code best practices", "icon": "cpu", "category": "system", "access": "team"},
    "system-process": {"name": "Process Knowledge", "description": "enterprise playbooks, methodologies, workflows, SOPs", "icon": "book", "category": "system", "access": "team"},
    "system-general": {"name": "General Knowledge", "description": "Organizational knowledge, market intel, competitive analysis", "icon": "globe", "category": "system", "access": "team"},
    "system-brand-voice": {"name": "Brand Voice", "description": "Tone guides, writing samples, approved language, style rules", "icon": "book", "category": "content", "access": "team"},
    "system-strategic-alignment": {"name": "Strategic Alignment", "description": "OKRs, ICPs, positioning, GTM motions, campaign goals", "icon": "briefcase", "category": "content", "access": "team"},
    "system-story-library": {"name": "Story Library", "description": "Case studies, customer wins, founder narratives, testimonials", "icon": "book", "category": "content", "access": "team"},
    "system-customer-star": {"name": "Customer STAR Library", "description": "Situation-Task-Action-Result stories for presentations", "icon": "briefcase", "category": "content", "access": "team"},
    "system-platform-playbook": {"name": "Platform Playbook", "description": "Per-platform best practices, templates, CTA patterns", "icon": "globe", "category": "content", "access": "team"},
    "system-community-blocks": {"name": "Community Blocks", "description": "Story shapes, content blocks, meetup templates", "icon": "globe", "category": "content", "access": "team"},
    "system-aws-accreditations": {"name": "AWS Accreditations", "description": "AWS certifications, partner badges, competency posts", "icon": "cpu", "category": "content", "access": "team"},
    "system-prior-content": {"name": "Prior Content", "description": "Previously published content from content ledger", "icon": "database", "category": "content", "access": "team"},
    "system-presentation-structures": {"name": "Presentation Structures", "description": "Deck structures, pitch frameworks, showcase flows", "icon": "book", "category": "content", "access": "team"},
}


def _get_ddb():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    return _bedrock


def _table():
    return _get_ddb().Table(KB_TABLE)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _uuid():
    return uuid.uuid4().hex[:12]


def _embed(text):
    client = _get_bedrock()
    response = client.invoke_model(
        modelId=EMBED_MODEL_ID, contentType="application/json", accept="application/json",
        body=json.dumps({"inputText": text[:8000], "dimensions": 256, "normalize": True}),
    )
    return json.loads(response["body"].read()).get("embedding", [])


def _cosine_similarity(a, b):
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _call_bedrock_json(prompt, max_tokens=1000):
    client = _get_bedrock()
    try:
        response = client.converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": 0.3},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        return {"parse_error": str(e)}


def _classify_entry(title, content):
    kb_descriptions = "\n".join(f'- "{k}" -- {v["description"]}' for k, v in SYSTEM_KBS.items())
    prompt = f"""Classify this knowledge entry into the most appropriate knowledge base.

Title: {title}
Content (first 2000 chars): {content[:2000]}

Available knowledge bases:
{kb_descriptions}

Return JSON: {{"kbId": "one of the KB IDs above", "tags": ["3-5 relevant tags"], "summary": "1-sentence summary", "confidence": 0.0 to 1.0}}
Return ONLY valid JSON."""
    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        return {"kbId": "system-general", "tags": [], "summary": title, "confidence": 0.5}
    if result.get("kbId") not in SYSTEM_KBS:
        result["kbId"] = "system-general"
    return result


def _ensure_system_kbs():
    table = _table()
    response = table.query(KeyConditionExpression=Key("pk").eq("KB#REGISTRY"))
    existing = {item["sk"] for item in response.get("Items", [])}
    now = _now()
    for kb_id, meta in SYSTEM_KBS.items():
        if kb_id in existing:
            continue
        table.put_item(Item={
            "pk": "KB#REGISTRY", "sk": kb_id, "name": meta["name"],
            "description": meta["description"], "icon": meta["icon"],
            "category": meta["category"], "access": meta["access"],
            "owner": "system", "entryCount": 0, "createdAt": now,
        })


def _list_kbs(qs):
    _ensure_system_kbs()
    table = _table()
    response = table.query(KeyConditionExpression=Key("pk").eq("KB#REGISTRY"))
    user_id = qs.get("userId", "")
    kbs = []
    for item in response.get("Items", []):
        access = item.get("access", "team")
        owner = item.get("owner", "system")
        if access == "private" and owner != user_id and user_id:
            continue
        kbs.append({
            "kbId": item["sk"], "name": item.get("name", ""),
            "description": item.get("description", ""), "access": access,
            "category": item.get("category", "custom"), "icon": item.get("icon", "database"),
            "owner": owner, "entryCount": int(item.get("entryCount", 0)),
            "createdAt": item.get("createdAt", ""),
        })
    kbs.sort(key=lambda x: (0 if x["category"] == "system" else 1 if x["category"] == "content" else 2, x["name"]))
    return _ok({"kbs": kbs, "count": len(kbs)})


def _create_kb(body):
    name = body.get("name", "").strip()
    if not name:
        return _err(400, "name required")
    kb_id = f"custom-{_uuid()}"
    _table().put_item(Item={
        "pk": "KB#REGISTRY", "sk": kb_id, "name": name,
        "description": body.get("description", ""), "icon": body.get("icon", "database"),
        "category": "custom", "access": body.get("access", "team"),
        "owner": body.get("userId", ""), "entryCount": 0, "createdAt": _now(),
    })
    return _ok({"kbId": kb_id, "name": name})


def _delete_kb(qs):
    kb_id = qs.get("kbId", "")
    if not kb_id:
        return _err(400, "kbId required")
    if kb_id.startswith("system-"):
        return _err(403, "Cannot delete system knowledge bases")
    table = _table()
    entries = table.query(KeyConditionExpression=Key("pk").eq(f"KB#{kb_id}"))
    with table.batch_writer() as batch:
        for item in entries.get("Items", []):
            batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    table.delete_item(Key={"pk": "KB#REGISTRY", "sk": kb_id})
    return _ok({"deleted": kb_id})


def _add_entry(body):
    kb_id = body.get("kbId", "")
    title = body.get("title", "")
    content = body.get("content", "")
    entry_type = body.get("entryType", "note")
    tags = body.get("tags", [])
    source = body.get("source", "manual")
    user_id = body.get("userId", "")
    auto_classify = body.get("autoClassify", False)
    if not title or not content:
        return _err(400, "title and content required")
    if auto_classify and not kb_id:
        classification = _classify_entry(title, content)
        kb_id = classification.get("kbId", "system-general")
        if not tags:
            tags = classification.get("tags", [])
    elif not kb_id:
        return _err(400, "kbId required (or set autoClassify=true)")
    embedding = _embed(f"{title}\n\n{content}")
    entry_id = f"entry-{_uuid()}"
    now = _now()
    _table().put_item(Item={
        "pk": f"KB#{kb_id}", "sk": entry_id, "entryType": entry_type,
        "title": title, "content": content, "tags": tags, "source": source,
        "userId": user_id,
        "embedding": [Decimal(str(round(v, 8))) for v in embedding],
        "createdAt": now, "updatedAt": now,
    })
    _update_entry_count(kb_id, 1)
    return _ok({"entryId": entry_id, "kbId": kb_id, "title": title, "tags": tags, "entryType": entry_type})


def _list_entries(qs):
    kb_id = qs.get("kbId", "")
    if not kb_id:
        return _err(400, "kbId required")
    response = _table().query(KeyConditionExpression=Key("pk").eq(f"KB#{kb_id}"))
    entries = []
    for item in response.get("Items", []):
        entries.append({
            "entryId": item["sk"], "kbId": kb_id, "title": item.get("title", ""),
            "content": item.get("content", ""), "tags": item.get("tags", []),
            "entryType": item.get("entryType", "note"), "source": item.get("source", ""),
            "userId": item.get("userId", ""), "createdAt": item.get("createdAt", ""),
            "updatedAt": item.get("updatedAt", ""),
        })
    entries.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return _ok({"entries": entries, "count": len(entries), "kbId": kb_id})


def _get_entry(qs):
    kb_id = qs.get("kbId", "")
    entry_id = qs.get("entryId", "")
    if not kb_id or not entry_id:
        return _err(400, "kbId and entryId required")
    result = _table().get_item(Key={"pk": f"KB#{kb_id}", "sk": entry_id})
    item = result.get("Item")
    if not item:
        return _err(404, "Entry not found")
    return _ok({"entry": {
        "entryId": item["sk"], "kbId": kb_id, "title": item.get("title", ""),
        "content": item.get("content", ""), "tags": item.get("tags", []),
        "entryType": item.get("entryType", "note"), "source": item.get("source", ""),
        "userId": item.get("userId", ""), "createdAt": item.get("createdAt", ""),
        "updatedAt": item.get("updatedAt", ""),
    }})


def _delete_entry(qs):
    kb_id = qs.get("kbId", "")
    entry_id = qs.get("entryId", "")
    if not kb_id or not entry_id:
        return _err(400, "kbId and entryId required")
    _table().delete_item(Key={"pk": f"KB#{kb_id}", "sk": entry_id})
    _update_entry_count(kb_id, -1)
    return _ok({"deleted": entry_id, "kbId": kb_id})


def _update_entry_count(kb_id, delta):
    try:
        _table().update_item(
            Key={"pk": "KB#REGISTRY", "sk": kb_id},
            UpdateExpression="SET entryCount = if_not_exists(entryCount, :zero) + :delta",
            ExpressionAttributeValues={":delta": delta, ":zero": 0},
        )
    except Exception:
        pass


def _search(body):
    query = body.get("query", "")
    kb_ids = body.get("kbIds", [])
    kb_id = body.get("kbId", "")
    user_id = body.get("userId", "")
    limit = int(body.get("limit", 10))
    min_score = float(body.get("minScore", 0.2))
    if not query:
        return _err(400, "query required")
    if kb_id and not kb_ids:
        kb_ids = [kb_id]
    if not kb_ids:
        kb_ids = list(SYSTEM_KBS.keys())
        if user_id:
            kb_ids.append(f"personal-{user_id}")
    query_embedding = _embed(query)
    table = _table()
    all_results = []
    for kid in kb_ids:
        response = table.query(KeyConditionExpression=Key("pk").eq(f"KB#{kid}"))
        for item in response.get("Items", []):
            emb = item.get("embedding", [])
            if not emb:
                continue
            score = _cosine_similarity(query_embedding, [float(v) for v in emb])
            if score < min_score:
                continue
            all_results.append({
                "entryId": item["sk"], "kbId": kid,
                "title": item.get("title", ""), "content": item.get("content", "")[:500],
                "tags": item.get("tags", []), "entryType": item.get("entryType", "note"),
                "source": item.get("source", ""), "score": round(score, 4),
                "createdAt": item.get("createdAt", ""),
            })
    all_results.sort(key=lambda x: x["score"], reverse=True)
    top = all_results[:limit]
    return _ok({"results": top, "count": len(top), "query": query, "searchedKbs": kb_ids})


def _agent_search(qs):
    query = qs.get("query", "")
    kb_ids_raw = qs.get("kbIds", "")
    limit = int(qs.get("limit", "5"))
    if not query:
        return _err(400, "query required")
    kb_ids = [k.strip() for k in kb_ids_raw.split(",") if k.strip()] if kb_ids_raw else list(SYSTEM_KBS.keys())
    return _search({"query": query, "kbIds": kb_ids, "limit": limit})


def _ok(body):
    return _response(200, body)


def _err(status, message):
    return _response(status, {"error": {"code": f"KB_{status}", "message": message}})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


def handler(event, context):
    method = event.get("httpMethod", "GET")
    if method == "GET":
        qs = event.get("queryStringParameters") or {}
        action = qs.get("action", "status")
        if action == "status":
            return _ok({"message": "Knowledge Base API", "status": "ok", "systemKbs": len(SYSTEM_KBS)})
        if action == "list_kbs":
            return _list_kbs(qs)
        if action == "list_entries":
            return _list_entries(qs)
        if action == "get_entry":
            return _get_entry(qs)
        if action == "agent_search":
            return _agent_search(qs)
        return _ok({"message": "Knowledge Base API", "status": "ok"})
    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action", "")
        if action == "add_entry":
            return _add_entry(body)
        if action == "search":
            return _search(body)
        if action == "classify":
            title = body.get("title", "")
            content = body.get("content", "")
            if not title or not content:
                return _err(400, "title and content required")
            return _ok({"classification": _classify_entry(title, content)})
        if action == "create_kb":
            return _create_kb(body)
        return _err(400, f"Unknown action: {action}")
    if method == "DELETE":
        qs = event.get("queryStringParameters") or {}
        action = qs.get("action", "")
        if action == "delete_entry":
            return _delete_entry(qs)
        if action == "delete_kb":
            return _delete_kb(qs)
        return _err(400, f"Unknown delete action: {action}")
    return _err(405, "Method not allowed")
