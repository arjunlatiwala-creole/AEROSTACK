"""Content Publisher Agent — transforms raw input into Builder.io model entries.

Takes unstructured content (JD, customer story, event details, etc.),
detects or accepts a target Builder.io model, uses Bedrock to map the
content into the model's field schema, and creates/publishes the entry.

Reuses the Builder.io secret (private + public keys) from Secrets Manager.
"""
import json
import os

_cached_keys: dict[str, str] | None = None
_cached_schemas: dict[str, list[dict]] = {}

BUILDER_SECRET_NAME = os.environ.get("BUILDER_SECRET_NAME", "")
MODEL_ID = os.environ.get("PUBLISHER_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0")


def _get_keys() -> dict[str, str]:
    global _cached_keys
    if _cached_keys:
        return _cached_keys

    if not BUILDER_SECRET_NAME:
        raise RuntimeError("BUILDER_SECRET_NAME not configured")

    import boto3
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=BUILDER_SECRET_NAME)
    raw = resp["SecretString"]
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        parsed = {}

    private_key = parsed.get("private_key") or parsed.get("api_key") or raw.strip()
    public_key = parsed.get("public_key", "")
    if not private_key:
        raise RuntimeError("Builder.io private key not found")

    _cached_keys = {"private": private_key, "public": public_key}
    return _cached_keys


def _builder_api(method: str, path: str, body: dict | None = None) -> dict:
    import urllib.request
    import urllib.error

    key = _get_keys()["private"]
    url = f"https://builder.io/api/v1{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8") if exc.fp else ""
        return {"error": True, "status": exc.code, "message": error_body}


def _admin_gql(query: str) -> dict:
    import urllib.request
    import urllib.error

    key = _get_keys()["private"]
    url = "https://cdn.builder.io/api/v2/admin"
    data = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8") if exc.fp else ""
        return {"error": True, "status": exc.code, "message": error_body}


def _get_model_schema(model_name: str) -> list[dict]:
    if model_name in _cached_schemas:
        return _cached_schemas[model_name]

    result = _admin_gql("{ models { name kind fields } }")
    models = (result.get("data") or {}).get("models") or []
    for m in models:
        if not isinstance(m, dict):
            continue
        name = m.get("name", "")
        fields = []
        for f in (m.get("fields") or []):
            if isinstance(f, dict):
                fields.append({
                    "name": f.get("name", ""),
                    "type": f.get("type", ""),
                    "required": f.get("required", False),
                    "subFields": [
                        {"name": sf.get("name", ""), "type": sf.get("type", "")}
                        for sf in (f.get("subFields") or [])
                        if isinstance(sf, dict)
                    ],
                })
        _cached_schemas[name] = fields

    return _cached_schemas.get(model_name, [])


def _get_all_model_names() -> list[str]:
    if _cached_schemas:
        return list(_cached_schemas.keys())
    _get_model_schema("__warmup__")
    return list(_cached_schemas.keys())


def _call_bedrock(prompt: str, max_tokens: int = 2000, temperature: float = 0.3) -> str:
    import boto3
    client = boto3.client("bedrock-runtime", region_name="us-east-1")
    response = client.converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
    )
    return response["output"]["message"]["content"][0]["text"]


def _call_bedrock_json(prompt: str, max_tokens: int = 4000) -> dict:
    raw = _call_bedrock(prompt, max_tokens=max_tokens, temperature=0.2)
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
    return json.loads(raw)


def _detect_model(content: str) -> str:
    models = _get_all_model_names()
    data_models = [m for m in models if _cached_schemas.get(m) and
                   any(f["type"] != "uiBlocks" for f in _cached_schemas[m])]

    prompt = f"""You are a content classifier. Given the following raw content, determine which Builder.io data model it best fits.

Available models: {json.dumps(data_models)}

Raw content (first 2000 chars):
{content[:2000]}

Respond with ONLY the model name string, nothing else. If unsure, respond with the closest match."""

    result = _call_bedrock(prompt, max_tokens=50, temperature=0.1).strip().strip('"').strip("'")
    if result in data_models:
        return result
    for m in data_models:
        if m.lower() in result.lower() or result.lower() in m.lower():
            return m
    return "blog-post"


def _transform_content(content: str, model_name: str, entry_name: str) -> dict:
    schema = _get_model_schema(model_name)
    if not schema:
        raise ValueError(f"No schema found for model '{model_name}'")

    schema_desc = json.dumps(schema, indent=2)

    prompt = f"""You are a content transformation agent for Builder.io CMS.

Target model: {model_name}
Entry name: {entry_name}

Model field schema:
{schema_desc}

Raw input content:
{content}

Transform the raw content into a JSON object that matches the model's field schema.
Rules:
- For "text" fields: extract or generate appropriate short text
- For "longText" fields: extract or generate appropriate long-form content
- For "list" fields with subFields: create an array of objects matching the subFields
- For "list" fields without subFields: create an array of objects with reasonable field names inferred from the content
- For "date" / "timestamp" fields: use ISO 8601 format
- For "url" fields: extract URLs or leave empty string
- For "file" fields: leave as empty string (media uploaded separately)
- For "select" fields: pick the most appropriate option or use a reasonable value
- Fill ALL fields, even optional ones, with best-effort content from the input
- If the input doesn't contain enough info for a field, generate reasonable placeholder content that fits the model's purpose

Respond with ONLY valid JSON — no markdown, no explanation."""

    return _call_bedrock_json(prompt)


# ── Actions ─────────────────────────────────────────────────────


def _action_detect(body: dict) -> dict:
    content = body.get("content", "").strip()
    if not content:
        return _err(400, "content is required")

    model = _detect_model(content)
    schema = _get_model_schema(model)
    return _ok({
        "detected_model": model,
        "schema": schema,
        "all_models": _get_all_model_names(),
    })


def _action_transform(body: dict) -> dict:
    content = body.get("content", "").strip()
    model = body.get("model", "").strip()
    entry_name = body.get("name", "").strip()

    if not content:
        return _err(400, "content is required")
    if not model:
        model = _detect_model(content)
    if not entry_name:
        entry_name = content[:60].strip()

    try:
        transformed = _transform_content(content, model, entry_name)
    except ValueError as exc:
        return _err(400, str(exc))
    except json.JSONDecodeError:
        return _err(500, "Bedrock returned invalid JSON — try again or simplify input")

    return _ok({
        "model": model,
        "name": entry_name,
        "data": transformed,
        "schema": _get_model_schema(model),
    })


def _action_publish(body: dict) -> dict:
    model = body.get("model", "").strip()
    entry_name = body.get("name", "").strip()
    data = body.get("data", {})
    publish = body.get("publish", False)
    entry_id = body.get("entry_id", "").strip()

    if not model:
        return _err(400, "model is required")
    if not entry_name:
        return _err(400, "name is required")
    if not data:
        return _err(400, "data is required")

    payload: dict = {"name": entry_name, "data": data}
    if publish:
        payload["published"] = "published"

    if entry_id:
        result = _builder_api("PUT", f"/write/{model}/{entry_id}", payload)
    else:
        result = _builder_api("POST", f"/write/{model}", payload)

    if isinstance(result, dict) and result.get("error"):
        return _ok({"published": False, "error": result.get("message", "Write API error")})

    return _ok({
        "published": True,
        "entry_id": entry_id or result.get("id", ""),
        "model": model,
        "name": entry_name,
        "is_live": publish,
    })


def _action_transform_and_publish(body: dict) -> dict:
    content = body.get("content", "").strip()
    model = body.get("model", "").strip()
    entry_name = body.get("name", "").strip()
    publish = body.get("publish", False)

    if not content:
        return _err(400, "content is required")
    if not model:
        model = _detect_model(content)
    if not entry_name:
        entry_name = content[:60].strip()

    try:
        transformed = _transform_content(content, model, entry_name)
    except ValueError as exc:
        return _err(400, str(exc))
    except json.JSONDecodeError:
        return _err(500, "Bedrock returned invalid JSON — try again")

    payload: dict = {"name": entry_name, "data": transformed}
    if publish:
        payload["published"] = "published"

    result = _builder_api("POST", f"/write/{model}", payload)
    if isinstance(result, dict) and result.get("error"):
        return _ok({
            "published": False,
            "error": result.get("message", "Write API error"),
            "data": transformed,
            "model": model,
        })

    return _ok({
        "published": True,
        "entry_id": result.get("id", ""),
        "model": model,
        "name": entry_name,
        "is_live": publish,
        "data": transformed,
    })


def _action_list_models(_body: dict) -> dict:
    models = _get_all_model_names()
    schemas = {}
    for m in models:
        s = _get_model_schema(m)
        if s and any(f["type"] != "uiBlocks" for f in s):
            schemas[m] = s
    return _ok({"models": list(schemas.keys()), "schemas": schemas})


# ── Helpers ─────────────────────────────────────────────────────


def _ok(body: dict) -> dict:
    return _response(200, body)


def _err(status: int, message: str) -> dict:
    return _response(status, {"error": {"code": f"PUBLISHER_{status}", "message": message}})


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


ACTIONS = {
    "detect": _action_detect,
    "transform": _action_transform,
    "publish": _action_publish,
    "transform_and_publish": _action_transform_and_publish,
    "list_models": _action_list_models,
}


def handler(event, _context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _ok({
            "service": "Content Publisher Agent",
            "actions": list(ACTIONS.keys()),
            "description": "Transform raw content into Builder.io model entries using AI",
        })

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action", "")
        fn = ACTIONS.get(action)
        if not fn:
            return _err(400, f"Unknown action: {action}. Available: {list(ACTIONS.keys())}")
        try:
            return fn(body)
        except RuntimeError as exc:
            return _err(500, str(exc))
        except Exception as exc:
            return _err(500, f"Unexpected: {str(exc)}")

    return _err(405, "Method not allowed")
