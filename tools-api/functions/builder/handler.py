"""Builder.io Content Management — proxy for Builder.io Write API.

Capabilities:
- List data models (spaces/models)
- List entries in a model
- Create / update entries
- Publish / unpublish entries
- Delete entries

API key stored in AWS Secrets Manager as `builder_io_api_key`.
"""
import json
import os

_cached_keys: dict[str, str] | None = None


def _get_keys() -> dict[str, str]:
    global _cached_keys
    if _cached_keys:
        return _cached_keys

    secret_name = os.environ.get("BUILDER_SECRET_NAME", "")
    if not secret_name:
        raise RuntimeError("BUILDER_SECRET_NAME not configured")

    import boto3
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_name)
    raw = resp["SecretString"]

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        parsed = {}

    private_key = (
        parsed.get("private_key")
        or parsed.get("api_key")
        or parsed.get("builder_io_api_key")
        or raw.strip()
    )
    public_key = parsed.get("public_key", "")

    if not private_key:
        raise RuntimeError("Builder.io private API key not found in secret")

    _cached_keys = {"private": private_key, "public": public_key}
    return _cached_keys


def _get_private_key() -> str:
    return _get_keys()["private"]


def _get_public_key() -> str:
    keys = _get_keys()
    if not keys["public"]:
        raise RuntimeError("Builder.io public API key not found in secret — add 'public_key' to the secret")
    return keys["public"]


def _builder_write_api(method: str, path: str, body: dict | None = None) -> dict:
    """Call Builder.io Write API (builder.io/api/v1/write/...)."""
    import urllib.request
    import urllib.error

    api_key = _get_private_key()
    url = f"https://builder.io/api/v1{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8") if exc.fp else ""
        return {"error": True, "status": exc.code, "message": error_body}


def _builder_content_api(model_name: str, params: str = "") -> dict | list:
    """Call Builder.io Content API (cdn.builder.io/api/v2/content/...)."""
    import urllib.request
    import urllib.error

    api_key = _get_public_key()
    url = f"https://cdn.builder.io/api/v2/content/{model_name}?apiKey={api_key}&includeUnpublished=true{params}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8") if exc.fp else ""
        return {"error": True, "status": exc.code, "message": error_body}


def _builder_admin_gql(query: str) -> dict:
    """Call Builder.io Admin GraphQL API (cdn.builder.io/api/v2/admin)."""
    import urllib.request
    import urllib.error

    api_key = _get_private_key()
    url = "https://cdn.builder.io/api/v2/admin"
    data = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8") if exc.fp else ""
        return {"error": True, "status": exc.code, "message": error_body}


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {
            "message": "Builder.io Content Tools API",
            "status": "ok",
            "actions": [
                "list_models", "list_entries", "get_entry",
                "create_entry", "update_entry",
                "publish_entry", "unpublish_entry",
                "delete_entry",
            ],
        })

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")

        actions = {
            "list_models": _list_models,
            "list_entries": _list_entries,
            "get_entry": _get_entry,
            "create_entry": _create_entry,
            "update_entry": _update_entry,
            "publish_entry": _publish_entry,
            "unpublish_entry": _unpublish_entry,
            "delete_entry": _delete_entry,
        }

        handler_fn = actions.get(action)
        if not handler_fn:
            return _response(400, {"error": f"Unknown action: {action}"})

        try:
            return handler_fn(body)
        except RuntimeError as exc:
            return _response(500, {"error": str(exc)})
        except Exception as exc:
            return _response(500, {"error": f"Unexpected error: {str(exc)}"})

    return _response(405, {"error": "Method not allowed"})


# ── Model Operations ────────────────────────────────────────────


def _list_models(body: dict) -> dict:
    """List all data models in the Builder.io space via Admin GraphQL API."""
    query = "{ models { id name kind fields } }"
    result = _builder_admin_gql(query)

    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"models": [], "error": result.get("message", "Admin API error")})

    models_raw = (result.get("data") or {}).get("models") or []
    formatted = []
    for m in models_raw:
        if not isinstance(m, dict):
            continue
        raw_fields = m.get("fields") or []
        fields = []
        for f in raw_fields:
            if isinstance(f, dict):
                fields.append({
                    "name": f.get("name", ""),
                    "type": f.get("type", ""),
                    "required": f.get("required", False),
                })
        formatted.append({
            "id": m.get("id", ""),
            "name": m.get("name", ""),
            "kind": m.get("kind", "data"),
            "fields": fields,
        })

    return _response(200, {"models": formatted, "count": len(formatted)})


def _list_entries(body: dict) -> dict:
    """List entries in a specific data model via Content API."""
    model_name = body.get("model", "").strip()
    if not model_name:
        return _response(400, {"error": "model is required"})

    limit = body.get("limit", 50)
    offset = body.get("offset", 0)
    params = f"&limit={limit}&offset={offset}"

    result = _builder_content_api(model_name, params)
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"entries": [], "error": result.get("message", "Content API error")})

    entries_raw = result.get("results") if isinstance(result, dict) else result if isinstance(result, list) else []
    formatted = []
    for e in (entries_raw or []):
        if not isinstance(e, dict):
            continue
        formatted.append({
            "id": e.get("id", ""),
            "name": e.get("name", ""),
            "published": e.get("published", ""),
            "created_at": e.get("createdDate", ""),
            "updated_at": e.get("lastUpdated", ""),
            "data": e.get("data", {}),
        })

    return _response(200, {
        "model": model_name,
        "entries": formatted,
        "count": len(formatted),
    })


def _get_entry(body: dict) -> dict:
    """Get a single entry by model and entry ID via Content API."""
    model_name = body.get("model", "").strip()
    entry_id = body.get("entry_id", "").strip()
    if not model_name or not entry_id:
        return _response(400, {"error": "model and entry_id are required"})

    result = _builder_content_api(model_name, f"&query.id={entry_id}&limit=1")
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"entry": None, "error": result.get("message", "Content API error")})

    results = result.get("results") if isinstance(result, dict) else result if isinstance(result, list) else []
    if not results:
        return _response(200, {"entry": None, "error": "Entry not found"})

    e = results[0]
    return _response(200, {
        "entry": {
            "id": e.get("id", ""),
            "name": e.get("name", ""),
            "published": e.get("published", ""),
            "data": e.get("data", {}),
            "created_at": e.get("createdDate", ""),
            "updated_at": e.get("lastUpdated", ""),
        },
    })


# ── Entry CRUD ──────────────────────────────────────────────────


def _create_entry(body: dict) -> dict:
    """Create a new entry in a data model."""
    model_name = body.get("model", "").strip()
    if not model_name:
        return _response(400, {"error": "model is required"})

    entry_name = body.get("name", "").strip()
    entry_data = body.get("data", {})
    publish = body.get("publish", False)

    payload = {
        "name": entry_name,
        "data": entry_data,
    }
    if publish:
        payload["published"] = "published"

    result = _builder_write_api("POST", f"/write/{model_name}", payload)
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"created": False, "error": result.get("message", "API error")})

    return _response(200, {
        "created": True,
        "entry_id": result.get("id", ""),
        "name": entry_name,
        "model": model_name,
        "published": publish,
        "message": f"Entry '{entry_name}' created in {model_name}",
    })


def _update_entry(body: dict) -> dict:
    """Update an existing entry."""
    model_name = body.get("model", "").strip()
    entry_id = body.get("entry_id", "").strip()
    if not model_name or not entry_id:
        return _response(400, {"error": "model and entry_id are required"})

    entry_data = body.get("data", {})
    entry_name = body.get("name")

    payload: dict = {"data": entry_data}
    if entry_name:
        payload["name"] = entry_name

    result = _builder_write_api("PUT", f"/write/{model_name}/{entry_id}", payload)
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"updated": False, "error": result.get("message", "API error")})

    return _response(200, {
        "updated": True,
        "entry_id": entry_id,
        "model": model_name,
        "message": f"Entry {entry_id} updated",
    })


def _publish_entry(body: dict) -> dict:
    """Publish a draft entry."""
    model_name = body.get("model", "").strip()
    entry_id = body.get("entry_id", "").strip()
    if not model_name or not entry_id:
        return _response(400, {"error": "model and entry_id are required"})

    result = _builder_write_api("PUT", f"/write/{model_name}/{entry_id}", {"published": "published"})
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"published": False, "error": result.get("message", "API error")})

    return _response(200, {
        "published": True,
        "entry_id": entry_id,
        "model": model_name,
        "message": f"Entry {entry_id} published",
    })


def _unpublish_entry(body: dict) -> dict:
    """Unpublish (revert to draft) an entry."""
    model_name = body.get("model", "").strip()
    entry_id = body.get("entry_id", "").strip()
    if not model_name or not entry_id:
        return _response(400, {"error": "model and entry_id are required"})

    result = _builder_write_api("PUT", f"/write/{model_name}/{entry_id}", {"published": "draft"})
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"unpublished": False, "error": result.get("message", "API error")})

    return _response(200, {
        "unpublished": True,
        "entry_id": entry_id,
        "model": model_name,
        "message": f"Entry {entry_id} reverted to draft",
    })


def _delete_entry(body: dict) -> dict:
    """Delete an entry from a data model."""
    model_name = body.get("model", "").strip()
    entry_id = body.get("entry_id", "").strip()
    if not model_name or not entry_id:
        return _response(400, {"error": "model and entry_id are required"})

    result = _builder_write_api("DELETE", f"/write/{model_name}/{entry_id}")
    if isinstance(result, dict) and result.get("error"):
        return _response(200, {"deleted": False, "error": result.get("message", "API error")})

    return _response(200, {
        "deleted": True,
        "entry_id": entry_id,
        "model": model_name,
        "message": f"Entry {entry_id} deleted from {model_name}",
    })


# ── Helpers ─────────────────────────────────────────────────────


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }
