"""Slack Admin Tools — comprehensive workspace administration.

Capabilities:
- Channel management: create, archive, rename, set topic/purpose, list
- User invites: workspace invite, single-channel guest, Slack Connect
- User management: list users, deactivate, reactivate, lookup by email
- Info: workspace info, user profile lookup
"""
import json
import os

_cached_token = None


def _get_slack_token():
    global _cached_token
    if _cached_token:
        return _cached_token

    secret_name = os.environ.get("SLACK_SECRET_NAME", "")
    if not secret_name:
        raise RuntimeError("SLACK_SECRET_NAME not configured")

    import boto3
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_name)
    parsed = json.loads(resp["SecretString"])
    token = parsed.get("slack_bot_token", "")
    if not token:
        raise RuntimeError("slack_bot_token not found in secret")
    _cached_token = token
    return _cached_token


def _slack_api(method: str, payload: dict | None = None, max_retries: int = 3) -> dict:
    import urllib.request
    import urllib.error
    import time

    token = _get_slack_token()
    data = json.dumps(payload or {}).encode("utf-8")

    for attempt in range(max_retries + 1):
        req = urllib.request.Request(
            f"https://slack.com/api/{method}",
            data=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries:
                retry_after = int(e.headers.get("Retry-After", "2"))
                time.sleep(min(retry_after, 10))
                continue
            body = e.read().decode("utf-8") if e.fp else ""
            try:
                return json.loads(body)
            except (json.JSONDecodeError, ValueError):
                return {"ok": False, "error": f"http_{e.code}", "detail": body[:200]}

    return {"ok": False, "error": "max_retries_exceeded"}


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {
            "message": "Slack Admin Tools API",
            "status": "ok",
            "actions": [
                "list_channels", "create_channel", "archive_channel",
                "rename_channel", "set_channel_topic", "set_channel_purpose",
                "invite_to_workspace", "invite_to_channel", "invite_guest",
                "invite_slack_connect", "bulk_invite",
                "list_users", "lookup_user", "deactivate_user", "reactivate_user",
            ],
        })

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")

        actions = {
            # Channels
            "list_channels": _list_channels,
            "create_channel": _create_channel,
            "archive_channel": _archive_channel,
            "rename_channel": _rename_channel,
            "set_channel_topic": _set_channel_topic,
            "set_channel_purpose": _set_channel_purpose,
            # Invites
            "invite_to_workspace": _invite_to_workspace,
            "invite_to_channel": _invite_to_channel,
            "invite_guest": _invite_guest,
            "invite_slack_connect": _invite_slack_connect,
            "bulk_invite": _bulk_invite,
            # Users
            "list_users": _list_users,
            "lookup_user": _lookup_user,
            "deactivate_user": _deactivate_user,
            "reactivate_user": _reactivate_user,
        }

        handler_fn = actions.get(action)
        if not handler_fn:
            return _response(400, {"error": f"Unknown action: {action}"})

        try:
            return handler_fn(body)
        except RuntimeError as exc:
            return _response(500, {"error": str(exc)})

    return _response(405, {"error": "Method not allowed"})


# ── Channel Management ──────────────────────────────────────────


def _list_channels(body: dict) -> dict:
    include_private = body.get("include_private", False)
    types = "public_channel,private_channel" if include_private else "public_channel"
    max_pages = body.get("max_pages", 5)

    seen_ids: set[str] = set()
    channels = []
    cursor = None
    pages_fetched = 0
    while pages_fetched < max_pages:
        payload: dict = {
            "types": types,
            "exclude_archived": not body.get("include_archived", False),
            "limit": 200,
        }
        if cursor:
            payload["cursor"] = cursor

        result = _slack_api("conversations.list", payload)
        pages_fetched += 1

        if not result.get("ok"):
            if channels:
                channels.sort(key=lambda c: c["name"])
                return _response(200, {
                    "channels": channels,
                    "count": len(channels),
                    "partial": True,
                    "error": result.get("error"),
                })
            return _response(200, {"channels": [], "error": result.get("error")})

        new_in_page = 0
        for ch in result.get("channels", []):
            if ch["id"] in seen_ids:
                continue
            seen_ids.add(ch["id"])
            new_in_page += 1
            channels.append({
                "id": ch["id"],
                "name": ch["name"],
                "is_private": ch.get("is_private", False),
                "is_archived": ch.get("is_archived", False),
                "num_members": ch.get("num_members", 0),
                "topic": ch.get("topic", {}).get("value", ""),
                "purpose": ch.get("purpose", {}).get("value", ""),
            })

        cursor = result.get("response_metadata", {}).get("next_cursor")
        if not cursor or new_in_page == 0:
            break

    channels.sort(key=lambda c: c["name"])
    return _response(200, {
        "channels": channels,
        "count": len(channels),
        "has_more": bool(cursor) and pages_fetched >= max_pages,
    })


def _create_channel(body: dict) -> dict:
    name = body.get("name", "").strip().lower().replace(" ", "-")
    if not name:
        return _response(400, {"error": "name is required"})

    is_private = body.get("is_private", False)
    result = _slack_api("conversations.create", {
        "name": name,
        "is_private": is_private,
    })

    if not result.get("ok"):
        return _response(200, {
            "created": False,
            "error_code": result.get("error"),
            "message": _friendly_error(result.get("error", "")),
        })

    channel = result["channel"]
    channel_id = channel["id"]

    # Set topic/purpose if provided
    if body.get("topic"):
        _slack_api("conversations.setTopic", {"channel": channel_id, "topic": body["topic"]})
    if body.get("purpose"):
        _slack_api("conversations.setPurpose", {"channel": channel_id, "purpose": body["purpose"]})

    return _response(200, {
        "created": True,
        "channel_id": channel_id,
        "name": channel["name"],
        "is_private": is_private,
        "message": f"Channel #{channel['name']} created",
    })


def _archive_channel(body: dict) -> dict:
    channel_id = body.get("channel_id", "").strip()
    if not channel_id:
        return _response(400, {"error": "channel_id is required"})

    join_result = _slack_api("conversations.join", {"channel": channel_id})
    if not join_result.get("ok") and join_result.get("error") not in (
        "already_in_channel", "method_not_supported_for_channel_type", "is_archived",
    ):
        return _response(200, {
            "archived": False,
            "error_code": join_result.get("error"),
            "message": f"Bot could not join channel before archiving: {join_result.get('error', 'unknown')}",
        })

    result = _slack_api("conversations.archive", {"channel": channel_id})
    if not result.get("ok"):
        return _response(200, {
            "archived": False,
            "error_code": result.get("error"),
            "message": _friendly_error(result.get("error", "")),
        })

    return _response(200, {"archived": True, "channel_id": channel_id, "message": "Channel archived"})


def _rename_channel(body: dict) -> dict:
    channel_id = body.get("channel_id", "").strip()
    new_name = body.get("name", "").strip().lower().replace(" ", "-")
    if not channel_id or not new_name:
        return _response(400, {"error": "channel_id and name are required"})

    result = _slack_api("conversations.rename", {"channel": channel_id, "name": new_name})
    if not result.get("ok"):
        return _response(200, {
            "renamed": False,
            "error_code": result.get("error"),
            "message": _friendly_error(result.get("error", "")),
        })

    return _response(200, {"renamed": True, "channel_id": channel_id, "name": new_name})


def _set_channel_topic(body: dict) -> dict:
    channel_id = body.get("channel_id", "").strip()
    topic = body.get("topic", "").strip()
    if not channel_id:
        return _response(400, {"error": "channel_id is required"})

    result = _slack_api("conversations.setTopic", {"channel": channel_id, "topic": topic})
    if not result.get("ok"):
        return _response(200, {"updated": False, "error_code": result.get("error")})

    return _response(200, {"updated": True, "channel_id": channel_id, "topic": topic})


def _set_channel_purpose(body: dict) -> dict:
    channel_id = body.get("channel_id", "").strip()
    purpose = body.get("purpose", "").strip()
    if not channel_id:
        return _response(400, {"error": "channel_id is required"})

    result = _slack_api("conversations.setPurpose", {"channel": channel_id, "purpose": purpose})
    if not result.get("ok"):
        return _response(200, {"updated": False, "error_code": result.get("error")})

    return _response(200, {"updated": True, "channel_id": channel_id, "purpose": purpose})


# ── User Invites ────────────────────────────────────────────────


def _invite_to_workspace(body: dict) -> dict:
    email = body.get("email", "").strip()
    if not email:
        return _response(400, {"error": "email is required"})

    channels = body.get("channel_ids", [])
    payload: dict = {"email": email}
    if channels:
        payload["channel_ids"] = ",".join(channels)

    result = _slack_api("admin.users.invite", payload)
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "invited": False, "email": email,
            "error_code": error, "message": _friendly_error(error),
        })

    return _response(200, {
        "invited": True, "email": email,
        "message": f"Workspace invitation sent to {email}",
    })


def _invite_to_channel(body: dict) -> dict:
    channel_id = body.get("channel_id", "").strip()
    user_ids = body.get("user_ids", [])
    if not channel_id:
        return _response(400, {"error": "channel_id is required"})
    if not user_ids:
        return _response(400, {"error": "user_ids is required (list of Slack user IDs)"})

    result = _slack_api("conversations.invite", {
        "channel": channel_id,
        "users": ",".join(user_ids),
    })
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "added": False, "channel_id": channel_id,
            "error_code": error, "message": _friendly_error(error),
        })

    return _response(200, {
        "added": True, "channel_id": channel_id,
        "user_count": len(user_ids),
        "message": f"Added {len(user_ids)} user(s) to channel",
    })


def _invite_guest(body: dict) -> dict:
    """Invite a single-channel guest to the workspace."""
    email = body.get("email", "").strip()
    channel_id = body.get("channel_id", "").strip()
    if not email:
        return _response(400, {"error": "email is required"})
    if not channel_id:
        return _response(400, {"error": "channel_id is required for guest invite"})

    result = _slack_api("admin.users.invite", {
        "email": email,
        "channel_ids": channel_id,
        "is_restricted": True,  # single-channel guest
    })
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "invited": False, "email": email,
            "error_code": error, "message": _friendly_error(error),
        })

    return _response(200, {
        "invited": True, "email": email, "channel_id": channel_id,
        "guest_type": "single_channel",
        "message": f"Single-channel guest invite sent to {email}",
    })


def _invite_slack_connect(body: dict) -> dict:
    """Send a Slack Connect invitation to an external user."""
    channel_id = body.get("channel_id", "").strip()
    email = body.get("email", "").strip()
    if not channel_id:
        return _response(400, {"error": "channel_id is required"})
    if not email:
        return _response(400, {"error": "email is required"})

    result = _slack_api("conversations.inviteShared", {
        "channel": channel_id,
        "emails": email,
    })
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "invited": False, "email": email,
            "error_code": error, "message": _friendly_error(error),
        })

    return _response(200, {
        "invited": True, "email": email, "channel_id": channel_id,
        "invite_type": "slack_connect",
        "message": f"Slack Connect invite sent to {email}",
    })


def _bulk_invite(body: dict) -> dict:
    emails = body.get("emails", [])
    if not emails:
        return _response(400, {"error": "emails list is required"})

    channels = body.get("channel_ids", [])
    invite_type = body.get("invite_type", "workspace")  # workspace | guest
    results = []

    for email in emails:
        email = email.strip()
        if not email:
            continue
        try:
            payload: dict = {"email": email}
            if channels:
                payload["channel_ids"] = ",".join(channels)
            if invite_type == "guest":
                payload["is_restricted"] = True

            result = _slack_api("admin.users.invite", payload)
            ok = result.get("ok", False)
            results.append({
                "email": email, "invited": ok,
                "error_code": result.get("error") if not ok else None,
                "message": _friendly_error(result.get("error", "")) if not ok else "Invited",
            })
        except Exception as exc:
            results.append({
                "email": email, "invited": False,
                "error_code": "internal_error", "message": str(exc),
            })

    invited = sum(1 for r in results if r["invited"])
    return _response(200, {
        "total": len(results), "invited": invited,
        "failed": len(results) - invited, "results": results,
    })


# ── User Management ─────────────────────────────────────────────


def _list_users(body: dict) -> dict:
    """List workspace members with optional filtering."""
    include_bots = body.get("include_bots", False)

    members = []
    cursor = None
    while True:
        payload: dict = {"limit": 100}
        if cursor:
            payload["cursor"] = cursor

        result = _slack_api("users.list", payload)
        if not result.get("ok"):
            return _response(200, {"users": [], "error": result.get("error")})

        for m in result.get("members", []):
            if m.get("deleted") and not body.get("include_deactivated", False):
                continue
            if m.get("is_bot") and not include_bots:
                continue
            if m.get("id") == "USLACKBOT":
                continue

            profile = m.get("profile", {})
            members.append({
                "id": m["id"],
                "name": m.get("name", ""),
                "real_name": m.get("real_name", profile.get("real_name", "")),
                "email": profile.get("email", ""),
                "title": profile.get("title", ""),
                "is_admin": m.get("is_admin", False),
                "is_owner": m.get("is_owner", False),
                "is_restricted": m.get("is_restricted", False),
                "is_ultra_restricted": m.get("is_ultra_restricted", False),
                "is_bot": m.get("is_bot", False),
                "deleted": m.get("deleted", False),
                "status_text": profile.get("status_text", ""),
                "tz": m.get("tz", ""),
            })

        cursor = result.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break

    members.sort(key=lambda u: u["real_name"].lower())

    # Summary counts
    active = sum(1 for u in members if not u["deleted"] and not u["is_bot"])
    guests = sum(1 for u in members if u["is_restricted"] or u["is_ultra_restricted"])
    deactivated = sum(1 for u in members if u["deleted"])

    return _response(200, {
        "users": members,
        "count": len(members),
        "active": active,
        "guests": guests,
        "deactivated": deactivated,
    })


def _lookup_user(body: dict) -> dict:
    """Look up a user by email address."""
    email = body.get("email", "").strip()
    if not email:
        return _response(400, {"error": "email is required"})

    result = _slack_api("users.lookupByEmail", {"email": email})
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        if error == "users_not_found":
            return _response(200, {"found": False, "email": email, "message": "No user found with that email"})
        return _response(200, {"found": False, "email": email, "error_code": error})

    user = result["user"]
    profile = user.get("profile", {})
    return _response(200, {
        "found": True,
        "user": {
            "id": user["id"],
            "name": user.get("name", ""),
            "real_name": user.get("real_name", ""),
            "email": profile.get("email", ""),
            "title": profile.get("title", ""),
            "is_admin": user.get("is_admin", False),
            "is_restricted": user.get("is_restricted", False),
            "is_ultra_restricted": user.get("is_ultra_restricted", False),
            "deleted": user.get("deleted", False),
            "status_text": profile.get("status_text", ""),
            "tz": user.get("tz", ""),
        },
    })


def _deactivate_user(body: dict) -> dict:
    """Deactivate (disable) a user — used for offboarding."""
    user_id = body.get("user_id", "").strip()
    if not user_id:
        return _response(400, {"error": "user_id is required"})

    # admin.users.remove requires the team_id
    team_id = body.get("team_id", "").strip()
    if not team_id:
        # Try to get team_id from auth.test
        auth = _slack_api("auth.test")
        team_id = auth.get("team_id", "")

    if not team_id:
        return _response(400, {"error": "team_id is required (could not auto-detect)"})

    result = _slack_api("admin.users.remove", {
        "team_id": team_id,
        "user_id": user_id,
    })
    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "deactivated": False, "user_id": user_id,
            "error_code": error, "message": _friendly_error(error),
        })

    return _response(200, {
        "deactivated": True, "user_id": user_id,
        "message": f"User {user_id} has been deactivated",
    })


def _reactivate_user(body: dict) -> dict:
    """Reactivate a previously deactivated user."""
    user_id = body.get("user_id", "").strip()
    if not user_id:
        return _response(400, {"error": "user_id is required"})

    # There's no direct reactivate API — use admin.users.invite won't work
    # for existing deactivated users. Use SCIM or admin.users.setRegular
    # as a workaround (requires Enterprise Grid or admin scopes).
    result = _slack_api("admin.users.setRegular", {
        "user_id": user_id,
        "team_id": body.get("team_id", ""),
    })

    if not result.get("ok"):
        error = result.get("error", "unknown_error")
        return _response(200, {
            "reactivated": False, "user_id": user_id,
            "error_code": error,
            "message": _friendly_error(error),
        })

    return _response(200, {
        "reactivated": True, "user_id": user_id,
        "message": f"User {user_id} has been reactivated",
    })


# ── Helpers ─────────────────────────────────────────────────────


def _friendly_error(code: str) -> str:
    errors = {
        "already_invited": "This user already has a pending invitation",
        "already_in_team": "This user is already in the workspace",
        "invalid_email": "Invalid email address",
        "user_disabled": "This user account is disabled",
        "already_in_channel": "User is already in this channel",
        "channel_not_found": "Channel not found",
        "not_in_channel": "Bot is not a member of this channel — invite the bot first for private channels",
        "cant_invite_self": "Cannot invite yourself",
        "name_taken": "A channel with that name already exists",
        "invalid_name": "Invalid channel name",
        "not_authorized": "Bot lacks required admin permissions",
        "user_not_found": "User not found",
        "users_not_found": "No user found with that email",
        "restricted_action": "This action is restricted by workspace settings",
        "team_not_found": "Workspace/team not found",
        "already_archived": "Channel is already archived",
        "is_archived": "Channel is already archived",
        "cant_archive_general": "Cannot archive the #general channel",
    }
    return errors.get(code, f"Slack API error: {code}")


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
