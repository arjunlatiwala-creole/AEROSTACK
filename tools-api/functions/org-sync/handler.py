"""
Org Sync Agent — Deel → Google Workspace → Slack lifecycle sync.

Deel provisions the Google user (basic fields: name, email, title, department).
Deel does NOT set orgUnitPath. This agent fills that gap:

1. Deel webhook fires on employee.created / employee.updated
2. Agent reads pillar/OU mapping from org roster (set during hiring pipeline)
3. Agent calls Google Admin SDK to set orgUnitPath + verify title
4. Agent calls Slack API to set profile title + invite to pillar channels

Secrets (already in Secrets Manager):
  - deel_api_token
  - google-directory-service-account (domain-wide delegation)
  - slack_bot_token

OU Tree:
  /enterprise/admin     → AdminOps pillar
  /enterprise/techops   → TechOps pillar (MTA track)
  /enterprise/revops    → RevOps pillar (Growth track)
"""
import json
import os
import uuid
import boto3
import logging
from datetime import datetime, timezone
from decimal import Decimal
from urllib.request import Request, urlopen
from urllib.error import URLError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("ORG_SYNC_TABLE", "")
DEEL_SECRET = os.environ.get("DEEL_SECRET_NAME", "deel_api_token")
GOOGLE_SECRET = os.environ.get("GOOGLE_SECRET_NAME", "google-directory-service-account")
SLACK_SECRET = os.environ.get("SLACK_SECRET_NAME", "slack_bot_token")
GOOGLE_ADMIN_EMAIL = os.environ.get("GOOGLE_ADMIN_EMAIL", "admin@enterprise.io")

_ddb = None
_secrets_cache: dict = {}

PILLARS = ["Admin", "TechOps", "RevOps"]

OU_MAP = {
    "Admin": "/enterprise/admin",
    "TechOps": "/enterprise/techops",
    "RevOps": "/enterprise/revops",
}

PILLAR_SLACK_CHANNELS = {
    "Admin": ["#admin-ops"],
    "TechOps": ["#techops", "#engineering"],
    "RevOps": ["#revops", "#growth"],
}


def _table():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(TABLE_NAME)


def _get_secret(name: str) -> str:
    if name in _secrets_cache:
        return _secrets_cache[name]
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=name)
    val = resp["SecretString"]
    _secrets_cache[name] = val
    return val


def handler(event, context):
    method = event.get("httpMethod", "GET")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}
    qs = event.get("queryStringParameters") or {}

    try:
        if "/org-sync/roster" in path:
            if method == "GET":
                return _list_roster(qs)
            if method == "POST":
                return _upsert_person(event)

        if "/org-sync/person/" in path:
            person_id = path_params.get("personId", "")
            if method == "GET":
                return _get_person(person_id)
            if method == "PUT":
                return _upsert_person(event, person_id)
            if method == "DELETE":
                return _delete_person(person_id)

        if "/org-sync/sync-check" in path and method == "GET":
            return _sync_check()

        if "/org-sync/from-hiring" in path and method == "POST":
            return _import_from_hiring(event)

        if "/org-sync/provision" in path and method == "POST":
            return _provision_user(event)

        if "/org-sync/deel-webhook" in path and method == "POST":
            return _handle_deel_webhook(event)

        if "/org-sync/sync-title" in path and method == "POST":
            return _sync_title(event)

        if "/org-sync/sync-from-google" in path and method == "POST":
            return _sync_from_google()

        return _resp(404, {"error": "Not found"})
    except Exception as exc:
        logger.exception("org-sync error")
        return _resp(500, {"error": str(exc)})


# ── Roster CRUD ──────────────────────────────────────────────────────

def _list_roster(qs: dict) -> dict:
    tbl = _table()
    pillar = qs.get("pillar")
    status = qs.get("status")

    scan_kwargs: dict = {}
    filters = []
    values: dict = {}
    names: dict = {}

    if pillar:
        filters.append("#p = :p")
        values[":p"] = pillar
        names["#p"] = "pillar"
    if status:
        filters.append("#s = :s")
        values[":s"] = status
        names["#s"] = "status"

    if filters:
        scan_kwargs["FilterExpression"] = " AND ".join(filters)
        scan_kwargs["ExpressionAttributeValues"] = values
        scan_kwargs["ExpressionAttributeNames"] = names

    result = tbl.scan(**scan_kwargs)
    items = [_clean(i) for i in result.get("Items", [])]
    items.sort(key=lambda x: x.get("pillar", "") + x.get("name", ""))
    return _resp(200, {"roster": items, "count": len(items)})


def _get_person(person_id: str) -> dict:
    result = _table().get_item(Key={"person_id": person_id})
    item = result.get("Item")
    if not item:
        return _resp(404, {"error": {"code": "NOT_FOUND", "message": f"Person {person_id} not found"}})
    return _resp(200, _clean(item))


def _upsert_person(event, person_id: str | None = None) -> dict:
    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    if not name:
        return _resp(400, {"error": {"code": "VALIDATION", "message": "name is required"}})

    pid = person_id or str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    pillar = body.get("pillar", "TechOps")
    if pillar not in PILLARS:
        return _resp(400, {"error": {"code": "VALIDATION", "message": f"pillar must be one of {PILLARS}"}})

    item = {
        "person_id": pid,
        "name": name,
        "email": body.get("email", ""),
        "title": body.get("title", ""),
        "level": body.get("level", ""),
        "pillar": pillar,
        "google_ou": OU_MAP.get(pillar, ""),
        "deel_employee_id": body.get("deel_employee_id", ""),
        "google_workspace_email": body.get("google_workspace_email", ""),
        "slack_user_id": body.get("slack_user_id", ""),
        "status": body.get("status", "active"),
        "hiring_candidate_id": body.get("hiring_candidate_id", ""),
        "sync_status": {
            "deel": body.get("deel_synced", False),
            "google": body.get("google_synced", False),
            "slack": body.get("slack_synced", False),
        },
        "created_at": body.get("created_at", now),
        "updated_at": now,
    }
    _table().put_item(Item=_to_dynamo(item))
    return _resp(201 if not person_id else 200, item)


def _delete_person(person_id: str) -> dict:
    existing = _table().get_item(Key={"person_id": person_id}).get("Item")
    if not existing:
        return _resp(404, {"error": {"code": "NOT_FOUND", "message": f"Person {person_id} not found"}})
    _table().delete_item(Key={"person_id": person_id})
    return _resp(200, {"deleted": person_id})


# ── Sync Check ───────────────────────────────────────────────────────

def _sync_check() -> dict:
    result = _table().scan()
    items = [_clean(i) for i in result.get("Items", [])]

    issues = []
    for person in items:
        sync = person.get("sync_status", {})
        if not sync.get("deel") and person.get("status") == "active":
            issues.append({"person_id": person["person_id"], "name": person["name"], "issue": "Not in Deel", "severity": "high"})
        if not sync.get("google") and person.get("status") == "active":
            issues.append({"person_id": person["person_id"], "name": person["name"], "issue": "No Google Workspace / OU not set", "severity": "high"})
        if not sync.get("slack") and person.get("status") == "active":
            issues.append({"person_id": person["person_id"], "name": person["name"], "issue": "Slack profile not synced", "severity": "medium"})

    by_pillar = {}
    for person in items:
        p = person.get("pillar", "Unknown")
        by_pillar[p] = by_pillar.get(p, 0) + 1

    return _resp(200, {
        "total": len(items),
        "active": len([i for i in items if i.get("status") == "active"]),
        "by_pillar": by_pillar,
        "issues": issues,
        "issue_count": len(issues),
    })


# ── Import from Hiring Pipeline ──────────────────────────────────────

def _import_from_hiring(event) -> dict:
    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    if not name:
        return _resp(400, {"error": {"code": "VALIDATION", "message": "name is required"}})

    pid = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    pillar = body.get("pillar", "TechOps")

    item = {
        "person_id": pid,
        "name": name,
        "email": body.get("email", ""),
        "title": body.get("title", ""),
        "level": body.get("level", "L4"),
        "pillar": pillar,
        "google_ou": OU_MAP.get(pillar, ""),
        "deel_employee_id": body.get("deel_employee_id", ""),
        "google_workspace_email": "",
        "slack_user_id": "",
        "status": "onboarding",
        "hiring_candidate_id": body.get("candidate_id", ""),
        "sync_status": {"deel": bool(body.get("deel_employee_id")), "google": False, "slack": False},
        "created_at": now,
        "updated_at": now,
    }
    _table().put_item(Item=_to_dynamo(item))
    return _resp(201, {"imported": True, "person": item})


# ── Provision: Deel created user → set Google OU → sync Slack ────────

def _provision_user(event) -> dict:
    """
    Called after Deel provisions a Google user (or manually triggered).
    Reads the person's pillar from org roster, sets Google OU, syncs Slack.

    Sequence:
    1. Look up person in org roster by deel_employee_id or person_id
    2. Call Google Admin SDK: users.update → set orgUnitPath
    3. Call Slack API: users.profile.set → set title
    4. Update sync_status in roster
    """
    body = json.loads(event.get("body", "{}"))
    person_id = body.get("person_id", "")

    if not person_id:
        return _resp(400, {"error": {"code": "VALIDATION", "message": "person_id is required"}})

    item = _table().get_item(Key={"person_id": person_id}).get("Item")
    if not item:
        return _resp(404, {"error": {"code": "NOT_FOUND", "message": f"Person {person_id} not found"}})

    person = _clean(item)
    results = {"person_id": person_id, "steps": []}

    # Step 1: Set Google OU
    gw_email = person.get("google_workspace_email", "")
    target_ou = person.get("google_ou", "")
    title = person.get("title", "")

    if gw_email and target_ou:
        try:
            google_result = _google_set_ou(gw_email, target_ou, title)
            results["steps"].append({"step": "google_ou", "status": "success", "ou": target_ou, "detail": google_result})
            _update_sync_flag(person_id, "google", True)
        except Exception as exc:
            logger.exception("Google OU set failed")
            results["steps"].append({"step": "google_ou", "status": "error", "error": str(exc)})
    else:
        results["steps"].append({"step": "google_ou", "status": "skipped", "reason": "missing gw_email or target_ou"})

    # Step 2: Sync Slack profile
    slack_id = person.get("slack_user_id", "")
    if slack_id and title:
        try:
            slack_result = _slack_set_title(slack_id, title, person.get("name", ""))
            results["steps"].append({"step": "slack_title", "status": "success", "detail": slack_result})
            _update_sync_flag(person_id, "slack", True)
        except Exception as exc:
            logger.exception("Slack title sync failed")
            results["steps"].append({"step": "slack_title", "status": "error", "error": str(exc)})
    else:
        results["steps"].append({"step": "slack_title", "status": "skipped", "reason": "missing slack_user_id or title"})

    return _resp(200, results)


# ── Deel Webhook Handler ─────────────────────────────────────────────

def _handle_deel_webhook(event) -> dict:
    """
    Receives Deel webhook events (employee.created, employee.updated, employee.terminated).
    Looks up person in roster, triggers provision flow.
    """
    body = json.loads(event.get("body", "{}"))
    event_type = body.get("event_type", body.get("type", ""))
    data = body.get("data", body.get("object", {}))

    logger.info(f"Deel webhook: {event_type}")

    if event_type in ("employee.created", "contract.created"):
        deel_id = str(data.get("id", ""))
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
        email = data.get("email", "")
        title = data.get("job_title", "")

        if not deel_id:
            return _resp(400, {"error": "No employee ID in webhook payload"})

        # Find existing roster entry by deel_employee_id
        result = _table().scan(
            FilterExpression="deel_employee_id = :did",
            ExpressionAttributeValues={":did": deel_id},
        )
        items = result.get("Items", [])

        if items:
            person = _clean(items[0])
            person_id = person["person_id"]
            logger.info(f"Found existing roster entry {person_id} for Deel ID {deel_id}")
        else:
            person_id = str(uuid.uuid4())[:12]
            now = datetime.now(timezone.utc).isoformat()
            new_person = {
                "person_id": person_id,
                "name": name,
                "email": email,
                "title": title,
                "level": "",
                "pillar": "TechOps",
                "google_ou": OU_MAP.get("TechOps", ""),
                "deel_employee_id": deel_id,
                "google_workspace_email": "",
                "slack_user_id": "",
                "status": "onboarding",
                "hiring_candidate_id": "",
                "sync_status": {"deel": True, "google": False, "slack": False},
                "created_at": now,
                "updated_at": now,
            }
            _table().put_item(Item=_to_dynamo(new_person))
            logger.info(f"Created new roster entry {person_id} from Deel webhook")

        _update_sync_flag(person_id, "deel", True)
        return _resp(200, {"processed": True, "person_id": person_id, "event_type": event_type})

    if event_type in ("employee.terminated", "contract.terminated"):
        deel_id = str(data.get("id", ""))
        result = _table().scan(
            FilterExpression="deel_employee_id = :did",
            ExpressionAttributeValues={":did": deel_id},
        )
        items = result.get("Items", [])
        if items:
            person_id = items[0]["person_id"]
            now = datetime.now(timezone.utc).isoformat()
            _table().update_item(
                Key={"person_id": person_id},
                UpdateExpression="SET #s = :s, updated_at = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": "terminated", ":now": now},
            )
            return _resp(200, {"processed": True, "person_id": person_id, "status": "terminated"})

    return _resp(200, {"processed": False, "reason": f"Unhandled event type: {event_type}"})


# ── Title Sync (manual trigger for existing users) ───────────────────

def _sync_title(event) -> dict:
    """Sync title from roster to Google + Slack for a specific person."""
    body = json.loads(event.get("body", "{}"))
    person_id = body.get("person_id", "")
    if not person_id:
        return _resp(400, {"error": {"code": "VALIDATION", "message": "person_id required"}})

    # Reuse provision logic
    event["body"] = json.dumps({"person_id": person_id})
    return _provision_user(event)


# ── Sync from Google Workspace ───────────────────────────────────────

# Reverse map: OU path → pillar name
OU_TO_PILLAR = {v: k for k, v in OU_MAP.items()}

def _sync_from_google() -> dict:
    """
    Pull all users from Google Workspace via Admin SDK,
    map their orgUnitPath to a pillar, and upsert into the roster.
    This is the "read from Google, populate org chart" flow.
    """
    try:
        users = _google_list_users()
    except Exception as exc:
        logger.exception("Failed to list Google Workspace users")
        return _resp(500, {"error": f"Google API error: {exc}"})

    tbl = _table()
    now = datetime.now(timezone.utc).isoformat()
    created = 0
    updated = 0
    skipped = 0

    # Load existing roster keyed by workspace email
    existing_scan = tbl.scan()
    existing_by_email: dict[str, dict] = {}
    for item in existing_scan.get("Items", []):
        gw_email = item.get("google_workspace_email", "")
        if gw_email:
            existing_by_email[gw_email.lower()] = _clean(item)

    for user in users:
        email = user.get("primaryEmail", "")
        if not email:
            skipped += 1
            continue

        # Skip suspended users
        if user.get("suspended", False):
            skipped += 1
            continue

        ou_path = user.get("orgUnitPath", "/")
        name_data = user.get("name", {})
        full_name = f"{name_data.get('givenName', '')} {name_data.get('familyName', '')}".strip()
        if not full_name:
            full_name = email.split("@")[0]

        # Map OU to pillar — check exact match first, then prefix match
        pillar = "Unassigned"
        for ou, p in OU_TO_PILLAR.items():
            if ou_path == ou or ou_path.startswith(ou + "/"):
                pillar = p
                break

        # Extract title from organizations array if present
        title = ""
        orgs = user.get("organizations", [])
        if orgs and isinstance(orgs, list):
            title = orgs[0].get("title", "")

        # Extract department
        department = ""
        if orgs and isinstance(orgs, list):
            department = orgs[0].get("department", "")

        existing = existing_by_email.get(email.lower())

        if existing:
            # Update existing entry
            person_id = existing["person_id"]
            tbl.update_item(
                Key={"person_id": person_id},
                UpdateExpression="SET #n = :n, title = :t, pillar = :p, google_ou = :ou, #s = :s, updated_at = :now, sync_status.google = :gt",
                ExpressionAttributeNames={"#n": "name", "#s": "status"},
                ExpressionAttributeValues={
                    ":n": full_name,
                    ":t": title or existing.get("title", ""),
                    ":p": pillar,
                    ":ou": ou_path,
                    ":s": "active",
                    ":now": now,
                    ":gt": True,
                },
            )
            updated += 1
        else:
            # Create new entry
            person_id = str(uuid.uuid4())[:12]
            item = {
                "person_id": person_id,
                "name": full_name,
                "email": user.get("recoveryEmail", ""),
                "title": title,
                "level": "",
                "pillar": pillar,
                "google_ou": ou_path,
                "deel_employee_id": "",
                "google_workspace_email": email,
                "slack_user_id": "",
                "status": "active",
                "hiring_candidate_id": "",
                "sync_status": {"deel": False, "google": True, "slack": False},
                "created_at": now,
                "updated_at": now,
            }
            tbl.put_item(Item=_to_dynamo(item))
            created += 1

    return _resp(200, {
        "synced": True,
        "google_users_found": len(users),
        "created": created,
        "updated": updated,
        "skipped": skipped,
    })


def _google_list_users() -> list[dict]:
    """List all users in the Google Workspace domain via Admin SDK."""
    access_token = _get_google_access_token()

    all_users: list[dict] = []
    page_token = ""

    while True:
        url = f"https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=200&orderBy=email"
        if page_token:
            url += f"&pageToken={page_token}"

        req = Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {access_token}")

        with urlopen(req) as resp:
            data = json.loads(resp.read())

        all_users.extend(data.get("users", []))
        page_token = data.get("nextPageToken", "")
        if not page_token:
            break

    return all_users


def _get_google_access_token() -> str:
    """Get a Google OAuth2 access token using service account + domain-wide delegation."""
    import time
    import jwt as pyjwt

    sa_json = json.loads(_get_secret(GOOGLE_SECRET))
    client_email = sa_json["client_email"]
    private_key = sa_json["private_key"]

    now_ts = int(time.time())
    payload = {
        "iss": client_email,
        "sub": GOOGLE_ADMIN_EMAIL,
        "scope": "https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/admin.directory.user",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now_ts,
        "exp": now_ts + 3600,
    }

    jwt_token = pyjwt.encode(payload, private_key, algorithm="RS256")

    token_body = f"grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={jwt_token}".encode()
    token_req = Request("https://oauth2.googleapis.com/token", data=token_body, method="POST")
    token_req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urlopen(token_req) as resp:
        return json.loads(resp.read())["access_token"]

    sa_json = json.loads(_get_secret(GOOGLE_SECRET))
    client_email = sa_json["client_email"]
    private_key = sa_json["private_key"]

    # Build JWT for domain-wide delegation
    import time
    now = int(time.time())
    claims = {
        "iss": client_email,
        "sub": GOOGLE_ADMIN_EMAIL,
        "scope": "https://www.googleapis.com/auth/admin.directory.user",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }

    # Sign JWT with RS256
    import jwt as pyjwt
    token = pyjwt.encode(claims, private_key, algorithm="RS256")

    # Exchange for access token
    token_data = json.dumps({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": token,
    }).encode()
    req = Request("https://oauth2.googleapis.com/token", data=token_data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urlopen(req) as resp:
        access_token = json.loads(resp.read())["access_token"]

    # Update user OU and title
    update_body = {"orgUnitPath": ou_path}
    if title:
        update_body["organizations"] = [{"title": title, "primary": True}]

    update_data = json.dumps(update_body).encode()
    update_req = Request(
        f"https://admin.googleapis.com/admin/directory/v1/users/{email}",
        data=update_data,
        method="PUT",
    )
    update_req.add_header("Authorization", f"Bearer {access_token}")
    update_req.add_header("Content-Type", "application/json")

    with urlopen(update_req) as resp:
        return json.loads(resp.read())


# ── Google Admin SDK write calls ─────────────────────────────────────

def _google_set_ou(email: str, ou_path: str, title: str = "") -> dict:
    """Set orgUnitPath and title on a Google Workspace user."""
    access_token = _get_google_access_token()

    update_body: dict = {"orgUnitPath": ou_path}
    if title:
        update_body["organizations"] = [{"title": title, "primary": True}]

    update_data = json.dumps(update_body).encode()
    update_req = Request(
        f"https://admin.googleapis.com/admin/directory/v1/users/{email}",
        data=update_data,
        method="PUT",
    )
    update_req.add_header("Authorization", f"Bearer {access_token}")
    update_req.add_header("Content-Type", "application/json")

    with urlopen(update_req) as resp:
        return json.loads(resp.read())


# ── Slack API calls ──────────────────────────────────────────────────

def _slack_set_title(slack_user_id: str, title: str, real_name: str = "") -> dict:
    """Set Slack profile title (and optionally real_name) via users.profile.set."""
    token = _get_secret(SLACK_SECRET)

    profile: dict = {"title": title}
    if real_name:
        profile["real_name"] = real_name

    payload = json.dumps({"user": slack_user_id, "profile": profile}).encode()
    req = Request("https://slack.com/api/users.profile.set", data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json; charset=utf-8")

    with urlopen(req) as resp:
        result = json.loads(resp.read())
        if not result.get("ok"):
            raise RuntimeError(f"Slack API error: {result.get('error', 'unknown')}")
        return result


# ── DynamoDB helpers ─────────────────────────────────────────────────

def _update_sync_flag(person_id: str, system: str, synced: bool):
    now = datetime.now(timezone.utc).isoformat()
    _table().update_item(
        Key={"person_id": person_id},
        UpdateExpression="SET sync_status.#sys = :val, updated_at = :now",
        ExpressionAttributeNames={"#sys": system},
        ExpressionAttributeValues={":val": synced, ":now": now},
    )


def _clean(item: dict) -> dict:
    cleaned = {}
    for k, v in item.items():
        if isinstance(v, Decimal):
            cleaned[k] = int(v) if v == int(v) else float(v)
        elif isinstance(v, dict):
            cleaned[k] = {dk: (int(dv) if isinstance(dv, Decimal) and dv == int(dv) else float(dv) if isinstance(dv, Decimal) else dv) for dk, dv in v.items()}
        else:
            cleaned[k] = v
    return cleaned


def _to_dynamo(item: dict) -> dict:
    converted = {}
    for k, v in item.items():
        if isinstance(v, float):
            converted[k] = Decimal(str(v))
        elif isinstance(v, dict):
            converted[k] = {dk: Decimal(str(dv)) if isinstance(dv, float) else dv for dk, dv in v.items()}
        else:
            converted[k] = v
    return converted


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
        },
        "body": json.dumps(body, default=str),
    }
