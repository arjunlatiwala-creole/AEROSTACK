"""
GWorkspace Module — Aerostack Tool
Gmail multi-mailbox reader, Admin SDK alias/user/group management,
alias audit tracking with DynamoDB persistence.
"""
import json
import os
import re
import uuid
import base64
import boto3
import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("WORKSPACE_TABLE", "")
GWORKSPACE_SECRET = os.environ.get("GWORKSPACE_SECRET_NAME", "gworkspace_service_account")
SLACK_SECRET = os.environ.get("SLACK_SECRET_NAME", "slack_bot_token")
ADMIN_DOMAIN = "enterprise.io"

SHARED_MAILBOXES = [
    "revops@enterprise.io",
    "techops@enterprise.io",
    "adminops@enterprise.io",
    "accounting@enterprise.io",
    "engineering@enterprise.io",
]

_ddb = None
_secrets_cache = {}


def _table():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(TABLE_NAME)


def _get_secret(name: str) -> str:
    if name in _secrets_cache:
        return _secrets_cache[name]
    try:
        sm = boto3.client("secretsmanager", region_name="us-east-1")
        resp = sm.get_secret_value(SecretId=name)
        _secrets_cache[name] = resp["SecretString"]
        return resp["SecretString"]
    except Exception as exc:
        logger.warning(f"Could not read secret {name}: {exc}")
        return ""


# ── Google API clients ───────────────────────────────────────────────

def _get_gmail_service(delegated_user: str):
    """Build Gmail API client with domain-wide delegation."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    key_json = _get_secret(GWORKSPACE_SECRET)
    if not key_json:
        raise ValueError("GWorkspace service account secret not configured")

    key_data = json.loads(key_json)
    creds = service_account.Credentials.from_service_account_info(
        key_data,
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
        subject=delegated_user,
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _get_admin_service():
    """Build Admin SDK Directory API client."""
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    key_json = _get_secret(GWORKSPACE_SECRET)
    if not key_json:
        raise ValueError("GWorkspace service account secret not configured")

    key_data = json.loads(key_json)
    creds = service_account.Credentials.from_service_account_info(
        key_data,
        scopes=[
            "https://www.googleapis.com/auth/admin.directory.user",
            "https://www.googleapis.com/auth/admin.directory.group",
            "https://www.googleapis.com/auth/admin.directory.orgunit",
            "https://www.googleapis.com/auth/admin.directory.user.alias",
        ],
        subject=f"admin@{ADMIN_DOMAIN}",
    )
    return build("admin", "directory_v1", credentials=creds, cache_discovery=False)


# ── Handler ──────────────────────────────────────────────────────────

def handler(event, context):
    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}

    try:
        if method == "GET":
            action = qs.get("action", "list_aliases")
            if action == "list_aliases":
                return _list_entities("alias", qs)
            if action == "inbox_summary":
                return _inbox_summary(qs)
            if action == "search_emails":
                return _search_emails(qs)
            if action == "email_detail":
                return _email_detail(qs)
            if action == "list_users":
                return _admin_list_users()
            if action == "list_groups":
                return _admin_list_groups()
            if action == "list_mailboxes":
                return _list_all_mailboxes()
            return _resp(400, {"error": f"Unknown action: {action}"})

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action", "")
            if action == "seed":
                return _seed_data(body)
            if action == "upsert":
                return _upsert_entity(body)
            if action == "delete":
                return _delete_entity(body)
            if action == "execute_alias_move":
                return _execute_alias_move(body)
            if action == "execute_change":
                return _execute_change(body)
            if action == "create_group":
                return _admin_create_group(body)
            if action == "add_alias":
                return _admin_add_alias(body)
            if action == "remove_alias":
                return _admin_remove_alias(body)
            if action == "notify_slack":
                return _notify_slack(body)
            return _resp(400, {"error": f"Unknown action: {action}"})

        if method == "DELETE":
            body = json.loads(event.get("body") or "{}")
            return _delete_entity(body)

        return _resp(405, {"error": "Method not allowed"})
    except Exception as exc:
        logger.exception("workspace-admin handler error")
        return _resp(500, {"error": str(exc)})


# ── Gmail Operations ─────────────────────────────────────────────────

def _parse_headers(headers: list) -> dict:
    wanted = {"From", "To", "Subject", "Date", "Reply-To"}
    return {h["name"]: h["value"] for h in headers if h["name"] in wanted}


def _decode_body(payload: dict) -> str:
    if payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
    parts = payload.get("parts", [])
    for part in parts:
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
    for part in parts:
        if part.get("mimeType") == "text/html" and part.get("body", {}).get("data"):
            raw = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
            text = re.sub(r"<[^>]+>", " ", raw)
            return re.sub(r"\s+", " ", text).strip()[:3000]
    for part in parts:
        if part.get("parts"):
            result = _decode_body(part)
            if result:
                return result
    return ""


def _categorize_email(subject: str, sender: str) -> str:
    s = subject.lower()
    f = sender.lower()
    if any(k in s for k in ["invoice", "payment", "receipt", "billing"]):
        return "billing"
    if any(k in s for k in ["alert", "warning", "error", "down", "incident"]):
        return "alert"
    if any(k in s for k in ["verify", "confirm", "activate", "welcome"]):
        return "onboarding"
    if any(k in f for k in ["noreply", "no-reply", "notifications", "mailer-daemon"]):
        return "automated"
    if any(k in s for k in ["support", "help", "question", "issue", "bug"]):
        return "support"
    if any(k in s for k in ["meeting", "invite", "calendar", "schedule"]):
        return "calendar"
    return "general"


def _inbox_summary(qs: dict) -> dict:
    """Get inbox summary for one or all shared mailboxes."""
    mailbox = qs.get("mailbox", "all")
    hours_back = int(qs.get("hours", "24"))
    mailboxes = [mailbox] if mailbox != "all" else SHARED_MAILBOXES

    all_results = []
    for mb in mailboxes:
        try:
            service = _get_gmail_service(mb)
            after_ts = int((datetime.now(timezone.utc) - timedelta(hours=hours_back)).timestamp())
            results = service.users().messages().list(
                userId="me", q=f"after:{after_ts}", maxResults=50,
            ).execute()

            messages = results.get("messages", [])
            unread = 0
            categories = {}
            recent = []

            for msg_ref in messages[:30]:
                msg = service.users().messages().get(
                    userId="me", id=msg_ref["id"], format="metadata",
                    metadataHeaders=["From", "Subject", "Date"],
                ).execute()
                headers = _parse_headers(msg.get("payload", {}).get("headers", []))
                labels = msg.get("labelIds", [])
                if "UNREAD" in labels:
                    unread += 1
                cat = _categorize_email(headers.get("Subject", ""), headers.get("From", ""))
                categories[cat] = categories.get(cat, 0) + 1
                recent.append({
                    "id": msg_ref["id"],
                    "subject": headers.get("Subject", "(no subject)"),
                    "from": headers.get("From", ""),
                    "date": headers.get("Date", ""),
                    "category": cat,
                    "unread": "UNREAD" in labels,
                })

            all_results.append({
                "mailbox": mb,
                "total": len(messages),
                "unread": unread,
                "categories": categories,
                "recent": recent[:10],
            })
        except Exception as exc:
            all_results.append({"mailbox": mb, "error": str(exc)})

    return _resp(200, {"mailboxes": all_results, "hours_back": hours_back})


def _search_emails(qs: dict) -> dict:
    mailbox = qs.get("mailbox", SHARED_MAILBOXES[0])
    query = qs.get("q", "is:unread")
    max_results = min(int(qs.get("max", "20")), 50)

    try:
        service = _get_gmail_service(mailbox)
        results = service.users().messages().list(
            userId="me", q=query, maxResults=max_results,
        ).execute()

        emails = []
        for msg_ref in results.get("messages", []):
            msg = service.users().messages().get(
                userId="me", id=msg_ref["id"], format="metadata",
                metadataHeaders=["From", "To", "Subject", "Date"],
            ).execute()
            headers = _parse_headers(msg.get("payload", {}).get("headers", []))
            emails.append({
                "id": msg_ref["id"],
                "subject": headers.get("Subject", ""),
                "from": headers.get("From", ""),
                "to": headers.get("To", ""),
                "date": headers.get("Date", ""),
                "snippet": msg.get("snippet", "")[:200],
                "unread": "UNREAD" in msg.get("labelIds", []),
            })

        return _resp(200, {"mailbox": mailbox, "query": query, "count": len(emails), "emails": emails})
    except Exception as exc:
        return _resp(500, {"error": str(exc), "mailbox": mailbox})


def _email_detail(qs: dict) -> dict:
    mailbox = qs.get("mailbox", SHARED_MAILBOXES[0])
    msg_id = qs.get("id", "")
    if not msg_id:
        return _resp(400, {"error": "id parameter required"})

    try:
        service = _get_gmail_service(mailbox)
        msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        payload = msg.get("payload", {})
        headers = _parse_headers(payload.get("headers", []))
        body = _decode_body(payload)

        attachments = []
        for part in payload.get("parts", []):
            if part.get("filename"):
                attachments.append({
                    "filename": part["filename"],
                    "mimeType": part.get("mimeType", ""),
                    "size": part.get("body", {}).get("size", 0),
                })

        return _resp(200, {
            "id": msg_id,
            "mailbox": mailbox,
            "subject": headers.get("Subject", ""),
            "from": headers.get("From", ""),
            "to": headers.get("To", ""),
            "date": headers.get("Date", ""),
            "body": body[:5000],
            "labels": msg.get("labelIds", []),
            "unread": "UNREAD" in msg.get("labelIds", []),
            "attachments": attachments,
            "category": _categorize_email(headers.get("Subject", ""), headers.get("From", "")),
        })
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _list_all_mailboxes() -> dict:
    return _resp(200, {"mailboxes": SHARED_MAILBOXES, "domain": ADMIN_DOMAIN})


# ── Admin SDK Operations ─────────────────────────────────────────────

def _admin_list_users() -> dict:
    try:
        service = _get_admin_service()
        results = service.users().list(domain=ADMIN_DOMAIN, maxResults=200, orderBy="email").execute()
        users = []
        for u in results.get("users", []):
            users.append({
                "email": u.get("primaryEmail", ""),
                "name": u.get("name", {}).get("fullName", ""),
                "suspended": u.get("suspended", False),
                "admin": u.get("isAdmin", False),
                "last_login": u.get("lastLoginTime", ""),
                "creation": u.get("creationTime", ""),
                "org_unit": u.get("orgUnitPath", "/"),
                "aliases": u.get("aliases", []),
            })
        return _resp(200, {"users": users, "count": len(users)})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _admin_list_groups() -> dict:
    try:
        service = _get_admin_service()
        results = service.groups().list(domain=ADMIN_DOMAIN, maxResults=200).execute()
        groups = []
        for g in results.get("groups", []):
            groups.append({
                "email": g.get("email", ""),
                "name": g.get("name", ""),
                "description": g.get("description", ""),
                "member_count": g.get("directMembersCount", "0"),
            })
        return _resp(200, {"groups": groups, "count": len(groups)})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _admin_create_group(body: dict) -> dict:
    email = body.get("email", "")
    name = body.get("name", "")
    description = body.get("description", "")
    if not email or not name:
        return _resp(400, {"error": "email and name required"})

    try:
        service = _get_admin_service()
        group = service.groups().insert(body={
            "email": email,
            "name": name,
            "description": description,
        }).execute()
        return _resp(200, {"created": True, "group": group})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _admin_add_alias(body: dict) -> dict:
    """Add an alias to a user/mailbox."""
    user_email = body.get("user_email", "")
    alias = body.get("alias", "")
    if not user_email or not alias:
        return _resp(400, {"error": "user_email and alias required"})

    try:
        service = _get_admin_service()
        result = service.users().aliases().insert(
            userKey=user_email,
            body={"alias": alias},
        ).execute()
        return _resp(200, {"added": True, "alias": alias, "to": user_email, "result": result})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _admin_remove_alias(body: dict) -> dict:
    """Remove an alias from a user/mailbox."""
    user_email = body.get("user_email", "")
    alias = body.get("alias", "")
    if not user_email or not alias:
        return _resp(400, {"error": "user_email and alias required"})

    try:
        service = _get_admin_service()
        service.users().aliases().delete(userKey=user_email, alias=alias).execute()
        return _resp(200, {"removed": True, "alias": alias, "from": user_email})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _execute_alias_move(body: dict) -> dict:
    """Execute an alias move: remove from current mailbox, add to target, update DynamoDB."""
    alias_email = body.get("alias", "")
    from_mailbox = body.get("from_mailbox", "")
    to_mailbox = body.get("to_mailbox", "")

    if not alias_email or not from_mailbox or not to_mailbox:
        return _resp(400, {"error": "alias, from_mailbox, to_mailbox required"})

    from_email = f"{from_mailbox}@{ADMIN_DOMAIN}" if "@" not in from_mailbox else from_mailbox
    to_email = f"{to_mailbox}@{ADMIN_DOMAIN}" if "@" not in to_mailbox else to_mailbox

    results = {"alias": alias_email, "from": from_email, "to": to_email, "steps": []}

    try:
        service = _get_admin_service()

        # Step 1: Remove alias from current mailbox
        try:
            service.users().aliases().delete(userKey=from_email, alias=alias_email).execute()
            results["steps"].append({"action": "remove_from_source", "status": "ok"})
        except Exception as exc:
            results["steps"].append({"action": "remove_from_source", "status": "error", "error": str(exc)})

        # Step 2: Add alias to target mailbox
        try:
            service.users().aliases().insert(
                userKey=to_email, body={"alias": alias_email}
            ).execute()
            results["steps"].append({"action": "add_to_target", "status": "ok"})
        except Exception as exc:
            results["steps"].append({"action": "add_to_target", "status": "error", "error": str(exc)})

        # Step 3: Update DynamoDB tracking
        now = datetime.now(timezone.utc).isoformat()
        try:
            _table().update_item(
                Key={"pk": "ENTITY#alias", "sk": alias_email},
                UpdateExpression="SET #s = :s, executed_at = :t, updated_at = :t",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": "executed", ":t": now},
            )
            results["steps"].append({"action": "update_tracking", "status": "ok"})
        except Exception as exc:
            results["steps"].append({"action": "update_tracking", "status": "error", "error": str(exc)})

        all_ok = all(s["status"] == "ok" for s in results["steps"])
        return _resp(200, {**results, "success": all_ok})

    except Exception as exc:
        return _resp(500, {"error": str(exc), **results})


# ── Slack Notifications ──────────────────────────────────────────────

def _notify_slack(body: dict) -> dict:
    """Send a notification to Slack about mailbox activity."""
    import urllib.request

    channel = body.get("channel", "#ops-alerts")
    text = body.get("text", "")
    mailbox = body.get("mailbox", "")

    if not text:
        return _resp(400, {"error": "text required"})

    token = _get_secret(SLACK_SECRET)
    if not token:
        return _resp(500, {"error": "Slack token not configured"})

    slack_body = json.dumps({
        "channel": channel,
        "text": f"📬 *{mailbox}*\n{text}" if mailbox else text,
        "unfurl_links": False,
    }).encode()

    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=slack_body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            return _resp(200, {"sent": result.get("ok", False), "channel": channel})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


# ── DynamoDB CRUD (alias audit tracking) ─────────────────────────────

import boto3.dynamodb.conditions


def _list_entities(entity: str, qs: dict) -> dict:
    tbl = _table()
    resp = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq(f"ENTITY#{entity}"),
    )
    items = [_clean(i) for i in resp.get("Items", [])]
    return _resp(200, {"entity": entity, "items": items, "count": len(items)})


def _upsert_entity(body: dict) -> dict:
    entity = body.get("entity", "")
    item_id = body.get("id") or str(uuid.uuid4())[:12]
    data = body.get("data", {})
    if not entity or not data:
        return _resp(400, {"error": "entity and data required"})

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": f"ENTITY#{entity}",
        "sk": item_id,
        "entity_type": entity,
        "created_at": data.get("created_at", now),
        "updated_at": now,
        **{k: v for k, v in data.items() if k not in ("pk", "sk")},
    }
    _table().put_item(Item=_to_dynamo(item))
    return _resp(200, {"item": item, "created": True})


def _delete_entity(body: dict) -> dict:
    entity = body.get("entity", "")
    item_id = body.get("id", "")
    if not entity or not item_id:
        return _resp(400, {"error": "entity and id required"})
    _table().delete_item(Key={"pk": f"ENTITY#{entity}", "sk": item_id})
    return _resp(200, {"deleted": True, "id": item_id})


def _execute_change(body: dict) -> dict:
    step_id = body.get("id", "")
    if not step_id:
        return _resp(400, {"error": "id required"})
    now = datetime.now(timezone.utc).isoformat()
    _table().update_item(
        Key={"pk": "ENTITY#alias", "sk": step_id},
        UpdateExpression="SET #s = :s, executed_at = :t, updated_at = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "executed", ":t": now},
    )
    return _resp(200, {"executed": True, "id": step_id, "at": now})


# ── Seed Data ────────────────────────────────────────────────────────

SEED_ALIASES = [
    {"alias":"finance@enterprise.io","current_mailbox":"accounting","category":"Finance","recommended_mailbox":"accounting","action":"Keep","notes":"Correctly placed","priority":"—"},
    {"alias":"aidev-lead@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"AI dev lead fits engineering","priority":"Medium"},
    {"alias":"aidev1@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"AI dev alias","priority":"Medium"},
    {"alias":"aidev@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"AI dev alias","priority":"Medium"},
    {"alias":"engaged@enterprise.io","current_mailbox":"aidlc","category":"Marketing/Sales","recommended_mailbox":"revops","action":"Move","notes":"Engagement/outreach fits RevOps","priority":"Medium"},
    {"alias":"claude@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"AI tool alias","priority":"Low"},
    {"alias":"codex@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"AI tool alias","priority":"Low"},
    {"alias":"bolt@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"Dev tool alias","priority":"Low"},
    {"alias":"lovable@enterprise.io","current_mailbox":"aidlc","category":"AI/Dev Tools","recommended_mailbox":"engineering","action":"Move","notes":"Dev tool alias","priority":"Low"},
    {"alias":"workwithus@enterprise.io","current_mailbox":"revops","category":"Marketing/Sales","recommended_mailbox":"revops","action":"Keep","notes":"Correctly placed","priority":"—"},
    {"alias":"hello@enterprise.io","current_mailbox":"revops","category":"Marketing/Sales","recommended_mailbox":"revops","action":"Keep","notes":"General contact","priority":"—"},
    {"alias":"supabase@enterprise.io","current_mailbox":"engineering","category":"Vendor/Integration","recommended_mailbox":"techops","action":"Move","notes":"Vendor fits TechOps","priority":"Medium"},
    {"alias":"aws-notifications@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS alerts → TechOps","priority":"High"},
    {"alias":"enterprise-aws-csp@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS CSP root","priority":"High"},
    {"alias":"enterprise-aws-csp-security@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS security","priority":"High"},
    {"alias":"enterprise-aws-csp-operations@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS ops","priority":"High"},
    {"alias":"enterprise-aws-mgmt-L0@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS management","priority":"High"},
    {"alias":"enterprise-aws-dev-mgmt-L0@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS dev mgmt","priority":"High"},
    {"alias":"enterprise-aws-dev-mgmt-L0-audit@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS audit","priority":"High"},
    {"alias":"enterprise-aws-dev-mgmt-L0-log@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"AWS logging","priority":"High"},
    {"alias":"supabase-admin@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"Supabase admin","priority":"High"},
    {"alias":"domains@enterprise.io","current_mailbox":"catch-all","category":"Infrastructure","recommended_mailbox":"techops","action":"Move","notes":"Domain mgmt","priority":"Medium"},
    {"alias":"npm@enterprise.io","current_mailbox":"engineering","category":"System/Dev","recommended_mailbox":"techops","action":"Move","notes":"Package registry","priority":"Medium"},
    {"alias":"second-factors@enterprise.io","current_mailbox":"engineering","category":"Security","recommended_mailbox":"techops","action":"Move","notes":"2FA/security","priority":"High"},
    {"alias":"brightdata@enterprise.io","current_mailbox":"engineering","category":"Vendor","recommended_mailbox":"techops","action":"Move","notes":"Data vendor","priority":"Medium"},
    {"alias":"zoom@enterprise.io","current_mailbox":"catch-all","category":"Vendor","recommended_mailbox":"adminops","action":"Move","notes":"Video conf → AdminOps","priority":"Medium"},
    {"alias":"getpaid@enterprise.io","current_mailbox":"catch-all","category":"Finance","recommended_mailbox":"accounting","action":"Move","notes":"Payment alias","priority":"High"},
    {"alias":"enterprise-aws-csp-billing@enterprise.io","current_mailbox":"catch-all","category":"Finance","recommended_mailbox":"accounting","action":"Move","notes":"AWS billing → Accounting","priority":"High"},
    {"alias":"social@enterprise.io","current_mailbox":"catch-all","category":"Marketing","recommended_mailbox":"revops","action":"Move","notes":"Social media","priority":"Medium"},
    {"alias":"events@enterprise.io","current_mailbox":"catch-all","category":"Marketing","recommended_mailbox":"revops","action":"Move","notes":"Events","priority":"Medium"},
    {"alias":"advocacy@enterprise.io","current_mailbox":"catch-all","category":"Marketing","recommended_mailbox":"revops","action":"Move","notes":"Advocacy","priority":"Medium"},
    {"alias":"info@enterprise.io","current_mailbox":"catch-all","category":"General","recommended_mailbox":"revops","action":"Move","notes":"Public inbox","priority":"Medium"},
    {"alias":"oppshare@enterprise.io","current_mailbox":"catch-all","category":"Sales","recommended_mailbox":"revops","action":"Move","notes":"Opp sharing","priority":"Medium"},
    {"alias":"hubspot-integration@enterprise.io","current_mailbox":"catch-all","category":"Vendor","recommended_mailbox":"revops","action":"Move","notes":"CRM integration","priority":"High"},
    {"alias":"apollo@enterprise.io","current_mailbox":"catch-all","category":"Vendor","recommended_mailbox":"revops","action":"Move","notes":"Sales outreach","priority":"Medium"},
    {"alias":"aerostack@enterprise.io","current_mailbox":"engineering","category":"Product/Project","recommended_mailbox":"engineering","action":"Keep","notes":"Product alias","priority":"—"},
    {"alias":"aerostack-noreply@enterprise.io","current_mailbox":"engineering","category":"System/Noreply","recommended_mailbox":"engineering","action":"Keep","notes":"Noreply","priority":"—"},
    {"alias":"a10dit@enterprise.io","current_mailbox":"engineering","category":"Product/Project","recommended_mailbox":"engineering","action":"Keep","notes":"Product alias","priority":"—"},
    {"alias":"gseay@enterprise.io","current_mailbox":"engineering","category":"Personal/Unknown","recommended_mailbox":"—","action":"Review","notes":"Verify purpose","priority":"High"},
    {"alias":"farmmarketreport@enterprise.io","current_mailbox":"engineering","category":"Product/Project","recommended_mailbox":"catch-all","action":"Move","notes":"Not core eng","priority":"Low"},
    {"alias":"a10dit-support@enterprise.io","current_mailbox":"engineering","category":"Support","recommended_mailbox":"catch-all","action":"Move","notes":"Support → catch-all","priority":"Medium"},
]


def _seed_data(body: dict) -> dict:
    force = body.get("force", False)
    tbl = _table()
    existing = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq("ENTITY#alias"),
        Limit=1,
    )
    if existing.get("Items") and not force:
        return _resp(200, {"message": "Already seeded", "count": 0})

    now = datetime.now(timezone.utc).isoformat()
    count = 0
    with tbl.batch_writer() as batch:
        for a in SEED_ALIASES:
            batch.put_item(Item={
                "pk": "ENTITY#alias", "sk": a["alias"], "entity_type": "alias",
                "alias": a["alias"], "current_mailbox": a["current_mailbox"],
                "category": a["category"], "recommended_mailbox": a["recommended_mailbox"],
                "action": a["action"], "notes": a["notes"], "priority": a["priority"],
                "status": "pending", "created_at": now, "updated_at": now,
            })
            count += 1
    return _resp(200, {"message": f"Seeded {count} aliases", "count": count})


# ── Utilities ────────────────────────────────────────────────────────

def _clean(item: dict) -> dict:
    return {k: (int(v) if isinstance(v, Decimal) and v == int(v) else float(v) if isinstance(v, Decimal) else v) for k, v in item.items()}


def _to_dynamo(item: dict) -> dict:
    return {k: (Decimal(str(v)) if isinstance(v, float) else v) for k, v in item.items()}


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
