"""
Zoom Recording Automation — Aerostack Tool
Lists recordings from S3, classifies content via Bedrock, accepts text/VTT uploads.
"""
import json
import os
import re
import boto3
import logging
import hashlib
import hmac
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

S3_BUCKET = os.environ.get("ZOOM_RECORDINGS_BUCKET", "enterprise-aerostack-zoom-recordings-0661")
ATTENDEES_FILE = "_attendees.json"
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "no-reply@enterprise.io")
# Comma-separated list of admin/superadmin emails to CC on access requests
ADMIN_EMAILS = [e.strip() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
INTERNAL_DOMAINS = [d.strip().lower() for d in os.environ.get("INTERNAL_DOMAINS", "enterprise.io").split(",") if d.strip()]
CLASSIFIER_MODEL = os.environ.get(
    "CLASSIFIER_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"
)

from botocore.config import Config
s3 = boto3.client("s3", config=Config(max_pool_connections=50))
_bedrock = None



def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    return _bedrock


# ── Aerostack / enterprise business tag taxonomy ─────────────────────────────

Aerostack_FILTERS = {
    "aerostack": "Internal Aerostack platform work: loops, sprints, standups, retros, platform development, internal tooling, enterprise team meetings",
    "medpic": "Sales qualification using MEDPIC: Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Identify Pain, Champion identification",
    "bant-c": "Sales qualification using BANT-C: Budget discussions, Authority/decision-maker identification, Need/pain discovery, Timeline urgency, Competition/alternatives",
    "ops": "Operations and delivery: project status, weekly syncs, planning sessions, resource allocation, process reviews, delivery tracking",
    "engineering": "Technical discussions: architecture reviews, code reviews, showcases, deployments, infrastructure, debugging, technical design",
    "customer-story": "Customer-facing content: interviews, testimonials, case studies, success stories, reference calls, customer feedback sessions",
}

# Maps classifier output to Aerostack LoopCategory codes
FILTER_TO_LOOP_CATEGORY = {
    "aerostack": "INT:PRODUCT",
    "medpic": "GTM",
    "bant-c": "BD",
    "ops": "OPS:SalesOps",
    "engineering": "ENG",
    "customer-story": "MSP",
}

# Maps classifier output to Aerostack Pillar
FILTER_TO_PILLAR = {
    "aerostack": "INTERNAL",
    "medpic": "REVOPS",
    "bant-c": "REVOPS",
    "ops": "ADMINOPS",
    "engineering": "TECHOPS",
    "customer-story": "CROSS",
}

# LENS vocabulary for transcript analysis
LENS_TAGS = [
    "#loop-opportunity",
    "#loop-dissonance",
    "#loop-emergence",
    "#loop-convergence",
    "#loop-inertia",
    "#loop-compression",
    "#loop-reground",
]

LOOP_PHASES = ["PROJECTION", "ASSERTION", "FOCUS", "FEEDBACK", "ADAPTATION"]

CLASSIFICATION_FILE = "_aerostack_classification.json"


# ── VTT / text parsing ───────────────────────────────────────────────

def _parse_vtt(raw: str) -> str:
    """Strip VTT timestamps and metadata, return plain text."""
    lines = raw.splitlines()
    text_lines = []
    skip_next = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped == "WEBVTT" or stripped.startswith("NOTE"):
            skip_next = False
            continue
        # Skip timestamp lines like "00:00:01.000 --> 00:00:05.000"
        if re.match(r"\d{2}:\d{2}:\d{2}\.\d{3}\s*-->", stripped):
            skip_next = False
            continue
        # Skip cue index numbers
        if stripped.isdigit():
            continue
        text_lines.append(stripped)
    return " ".join(text_lines)


def _parse_srt(raw: str) -> str:
    """Strip SRT timestamps and indices, return plain text."""
    lines = raw.splitlines()
    text_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.isdigit():
            continue
        if re.match(r"\d{2}:\d{2}:\d{2},\d{3}\s*-->", stripped):
            continue
        text_lines.append(stripped)
    return " ".join(text_lines)


def _normalize_text(raw: str, source_type: str = "auto") -> str:
    """Normalize input text from various formats to plain text."""
    if source_type == "vtt" or (source_type == "auto" and "WEBVTT" in raw[:50]):
        return _parse_vtt(raw)
    if source_type == "srt" or (source_type == "auto" and re.match(r"^\d+\s*\n\d{2}:\d{2}:\d{2},", raw)):
        return _parse_srt(raw)
    # Plain text — just clean up
    return re.sub(r"\s+", " ", raw).strip()


# ── Handler ──────────────────────────────────────────────────────────

def handler(event, context):
    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}

    # Log every invocation for debugging webhook issues
    logger.info(f"Handler invoked: method={method}, path={event.get('path', 'N/A')}, has_body={bool(event.get('body'))}")

    try:
        if method == "GET":
            action = qs.get("action", "list")
            if action == "list":
                return _list_recordings(qs)
            elif action == "detail":
                return _get_recording_detail(qs)
            elif action == "presign":
                return _get_presigned_url(qs)
            elif action == "stream":
                return _get_stream_url(qs)
            elif action == "vtt" or action == "text":
                return _get_vtt_content(qs)
            elif action == "attendees":
                return _get_recording_attendees(qs)
            return _resp(400, {"error": f"Unknown action: {action}"})

        if method == "POST":
            body_raw = event.get("body") or "{}"
            body = json.loads(body_raw)

            # Check for Zoom webhook (event field or signature header)
            event_type = body.get("event")
            headers = event.get("headers") or {}
            if event_type or headers.get("x-zm-signature"):
                return _handle_zoom_webhook(event)

            action = body.get("action", "")
            if action == "classify":
                return _classify_meeting(body)
            elif action == "classify_all":
                return _classify_all_meetings()
            elif action == "classify_text":
                return _classify_text(body)
            elif action == "list_zoom_meetings":
                return _list_zoom_meetings()
            elif action == "retrieve_meeting":
                return _retrieve_meeting(body)
            elif action == "batch_retrieve_all":
                return _batch_retrieve_all(body)
            elif action == "batch_status":
                return _get_batch_status()
            elif action == "request_access":
                return _request_recording_access(body)
            elif action == "sync_attendees":
                return _sync_attendees(body)
            elif action == "sync_all_attendees":
                return _sync_all_attendees(body)
            elif action == "grant_access":
                return _grant_recording_access(body)
            elif action == "revoke_access":
                return _revoke_recording_access(body)
            elif action == "override_validation":
                return _override_validation(body)
            return _resp(400, {"error": f"Unknown POST action: {action}"})

        return _resp(405, {"error": "Method not allowed"})

    except Exception as exc:
        logger.exception("zoom-recordings handler error")
        return _resp(500, {"error": str(exc)})


# ── Bedrock classifier ──────────────────────────────────────────────

def _build_classification_prompt(title: str, text: str) -> str:
    filter_desc = "\n".join(f"- {k}: {v}" for k, v in Aerostack_FILTERS.items() if k != "aerostack")
    lens_list = ", ".join(LENS_TAGS)
    phase_list = ", ".join(LOOP_PHASES)

    text_section = ""
    if text:
        snippet = text[:8000]
        text_section = f"\n\n## Content (first ~8000 chars)\n{snippet}"

    return f"""You are an Aerostack content classifier for enterprise. Analyze the title and content, then produce structured tags.

## Available Aerostack filters (assign all that apply)
{filter_desc}

## Aerostack LENS tags (assign any that appear in the content)
{lens_list}

## Aerostack Loop Phases (identify the dominant phase)
{phase_list}

## Rules
1. A recording can match MULTIPLE filters. Return all that apply.
2. "aerostack" is the MASTER filter — it is always included automatically. Do NOT evaluate for it.
3. Extract enterprise_business_tags: freeform business-relevant keywords found in the content (people names, company names, project names, product names, technologies, deal names). Max 15 tags.
4. Extract lens_tags: which LENS tags appear based on content signals.
5. Identify the dominant loop_phase from the content.
6. For each filter, provide confidence (0.0-1.0) and a one-sentence reason.
7. Return ONLY valid JSON, no markdown fences.

## Title
{title}
{text_section}

## Required JSON output
{{
  "filters": [
    {{"id": "<filter_id>", "confidence": 0.85, "reason": "one sentence"}}
  ],
  "primary_filter": "<highest-confidence non-aerostack filter id>",
  "summary": "one sentence summary of the content",
  "enterprise_business_tags": ["tag1", "tag2"],
  "lens_tags": ["#loop-opportunity"],
  "dominant_phase": "FOCUS",
  "speakers": ["name1", "name2"],
  "key_topics": ["topic1", "topic2"]
}}
"""


def _call_bedrock_classify(prompt: str) -> dict:
    try:
        client = _get_bedrock()
        response = client.converse(
            modelId=CLASSIFIER_MODEL,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 800, "temperature": 0.1},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as exc:
        logger.exception("Bedrock classification failed")
        return {
            "filters": [],
            "primary_filter": "ops",
            "summary": "",
            "enterprise_business_tags": [],
            "lens_tags": [],
            "dominant_phase": "FOCUS",
            "speakers": [],
            "key_topics": [],
            "error": str(exc),
        }


def _enrich_classification(result: dict) -> dict:
    """Add Aerostack loop category and pillar mappings to classification."""
    # Always inject aerostack master filter
    filter_ids = [f["id"] for f in result.get("filters", [])]
    if "aerostack" not in filter_ids:
        result["filters"].insert(
            0, {"id": "aerostack", "confidence": 1.0, "reason": "Master Aerostack filter — all content"}
        )

    # Map to Aerostack taxonomy
    result["loop_categories"] = list({
        FILTER_TO_LOOP_CATEGORY[f["id"]]
        for f in result.get("filters", [])
        if f["id"] in FILTER_TO_LOOP_CATEGORY
    })
    result["pillars"] = list({
        FILTER_TO_PILLAR[f["id"]]
        for f in result.get("filters", [])
        if f["id"] in FILTER_TO_PILLAR
    })

    return result


# ── S3 helpers ───────────────────────────────────────────────────────

def _get_transcript_text(folder_name: str) -> str:
    try:
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=f"{folder_name}/")
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
                if ext in ("vtt", "srt", "txt") and obj.get("Size", 0) > 0:
                    resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
                    raw = resp["Body"].read().decode("utf-8", errors="ignore")
                    return _normalize_text(raw, ext)
    except Exception as exc:
        logger.warning(f"Could not read transcript for {folder_name}: {exc}")
    return ""


def _read_existing_classification(folder_name: str) -> dict | None:
    try:
        key = f"{folder_name}/{CLASSIFICATION_FILE}"
        resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        return None


def _store_classification(folder_name: str, classification: dict) -> None:
    key = f"{folder_name}/{CLASSIFICATION_FILE}"
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(classification, default=str),
        ContentType="application/json",
    )


# ── POST actions ─────────────────────────────────────────────────────

def _classify_meeting(body: dict) -> dict:
    folder = body.get("folder", "")
    if not folder:
        return _resp(400, {"error": "folder parameter required"})

    force = body.get("force", False)
    if not force:
        existing = _read_existing_classification(folder)
        if existing:
            return _resp(200, {"classification": existing, "cached": True})

    meeting_name = folder
    if "(" in folder and folder.endswith(")"):
        meeting_name = folder[: folder.rfind("(")].strip()

    transcript = _get_transcript_text(folder)
    prompt = _build_classification_prompt(meeting_name, transcript)
    result = _call_bedrock_classify(prompt)
    result = _enrich_classification(result)

    classification = {
        "folder": folder,
        "meeting_name": meeting_name,
        "classified_at": datetime.utcnow().isoformat() + "Z",
        "has_transcript": bool(transcript),
        "transcript_chars": len(transcript),
        **result,
    }

    _store_classification(folder, classification)
    return _resp(200, {"classification": classification, "cached": False})


def _classify_all_meetings() -> dict:
    classified = 0
    skipped = 0
    errors = 0

    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=S3_BUCKET, Delimiter="/")

    folders = []
    for page in pages:
        for cp in page.get("CommonPrefixes", []):
            folders.append(cp["Prefix"].rstrip("/"))

    for folder in folders:
        if _read_existing_classification(folder):
            skipped += 1
            continue
        try:
            meeting_name = folder
            if "(" in folder and folder.endswith(")"):
                meeting_name = folder[: folder.rfind("(")].strip()

            transcript = _get_transcript_text(folder)
            prompt = _build_classification_prompt(meeting_name, transcript)
            result = _call_bedrock_classify(prompt)
            result = _enrich_classification(result)

            classification = {
                "folder": folder,
                "meeting_name": meeting_name,
                "classified_at": datetime.utcnow().isoformat() + "Z",
                "has_transcript": bool(transcript),
                "transcript_chars": len(transcript),
                **result,
            }
            _store_classification(folder, classification)
            classified += 1
        except Exception:
            logger.exception(f"Error classifying {folder}")
            errors += 1

    return _resp(200, {
        "classified": classified,
        "skipped": skipped,
        "errors": errors,
        "total_folders": len(folders),
    })


def _classify_text(body: dict) -> dict:
    """Classify pasted text or uploaded file content directly (no S3 folder)."""
    title = body.get("title", "Untitled")
    text = body.get("text", "")
    source_type = body.get("source_type", "auto")  # "auto", "vtt", "srt", "txt"

    if not text:
        return _resp(400, {"error": "text parameter required"})

    normalized = _normalize_text(text, source_type)
    prompt = _build_classification_prompt(title, normalized)
    result = _call_bedrock_classify(prompt)
    result = _enrich_classification(result)

    classification = {
        "title": title,
        "classified_at": datetime.utcnow().isoformat() + "Z",
        "source": "direct_upload",
        "source_type": source_type,
        "text_chars": len(normalized),
        **result,
    }

    return _resp(200, {"classification": classification})


# ── Zoom API retrieval ───────────────────────────────────────────────

ZOOM_SECRET_NAME = os.environ.get("ZOOM_SECRET_NAME", "zoom_oauth_credentials")
ZOOM_WEBHOOK_SECRET_NAME = os.environ.get("ZOOM_WEBHOOK_SECRET_NAME", "zoom_webhook_secret")

_zoom_creds = None
_zoom_webhook_secret = None


def _get_zoom_webhook_secret() -> str:
    """Load Zoom webhook secret from Secrets Manager (cached per invocation)."""
    global _zoom_webhook_secret
    if _zoom_webhook_secret is not None:
        return _zoom_webhook_secret

    if ZOOM_WEBHOOK_SECRET_NAME:
        try:
            sm = boto3.client("secretsmanager", region_name="us-east-1")
            resp = sm.get_secret_value(SecretId=ZOOM_WEBHOOK_SECRET_NAME)
            secret_data = json.loads(resp["SecretString"])
            _zoom_webhook_secret = secret_data.get("webhook_secret", "")
            return _zoom_webhook_secret
        except Exception as exc:
            logger.warning(f"Could not read Zoom webhook secret: {exc}")

    _zoom_webhook_secret = ""
    return _zoom_webhook_secret


def _get_zoom_creds() -> dict:
    """Load Zoom OAuth creds from Secrets Manager (cached per invocation)."""
    global _zoom_creds
    if _zoom_creds is not None:
        return _zoom_creds

    # Try Secrets Manager first
    if ZOOM_SECRET_NAME:
        try:
            sm = boto3.client("secretsmanager", region_name="us-east-1")
            resp = sm.get_secret_value(SecretId=ZOOM_SECRET_NAME)
            _zoom_creds = json.loads(resp["SecretString"])
            return _zoom_creds
        except Exception as exc:
            logger.warning(f"Could not read Zoom secret: {exc}")

    # Fallback to env vars (for local dev only)
    _zoom_creds = {
        "client_id": os.environ.get("ZOOM_CLIENT_ID", ""),
        "client_secret": os.environ.get("ZOOM_CLIENT_SECRET", ""),
        "account_id": os.environ.get("ZOOM_ACCOUNT_ID", ""),
    }
    return _zoom_creds

_requests = None


def _get_requests():
    """Lazy import requests — only needed for Zoom API calls."""
    global _requests
    if _requests is None:
        import urllib.request
        import urllib.error
        import urllib.parse
    return True


def _get_zoom_token() -> str | None:
    """Get Zoom Server-to-Server OAuth token."""
    import base64
    import urllib.request
    import urllib.parse

    creds = _get_zoom_creds()
    client_id = creds.get("client_id", "")
    client_secret = creds.get("client_secret", "")
    account_id = creds.get("account_id", "")

    if not client_id or not client_secret or not account_id:
        return None

    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    data = urllib.parse.urlencode({
        "grant_type": "account_credentials",
        "account_id": account_id,
    }).encode()

    req = urllib.request.Request(
        "https://zoom.us/oauth/token",
        data=data,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            token_data = json.loads(resp.read().decode())
            return token_data.get("access_token")
    except Exception as exc:
        logger.exception("Failed to get Zoom OAuth token")
        return None


def _zoom_api_get(path: str, token: str) -> dict:
    """Make a GET request to the Zoom API."""
    import urllib.request
    import urllib.error

    req = urllib.request.Request(
        f"https://api.zoom.us/v2{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise e


def _fetch_user_recordings_window(user_id: str, from_str: str, to_str: str, token: str) -> list:
    import urllib.parse
    encoded_user = urllib.parse.quote(user_id, safe="")
    recordings = []
    next_page = ""
    while True:
        path = f"/users/{encoded_user}/recordings?from={from_str}&to={to_str}&page_size=300"
        if next_page:
            path += f"&next_page_token={next_page}"
        try:
            rdata = _zoom_api_get(path, token)
            recordings.extend(rdata.get("meetings", []))
            next_page = rdata.get("next_page_token", "")
            if not next_page:
                break
        except Exception as e:
            logger.warning(f"Recordings request failed for {user_id} ({from_str}->{to_str}): {e}")
            break
    return recordings



def _list_all_zoom_users(token: str) -> list[str]:
    """List all active user IDs (emails) on the Zoom account."""
    users: list[str] = []
    next_page_token = ""
    while True:
        path = "/users?status=active&page_size=300"
        if next_page_token:
            path += f"&next_page_token={next_page_token}"
        data = _zoom_api_get(path, token)
        for u in data.get("users", []):
            email = u.get("email")
            if email:
                users.append(email)
        next_page_token = data.get("next_page_token", "")
        if not next_page_token:
            break
    return users


def _list_zoom_meetings() -> dict:
    """List meetings with recordings from Zoom API (last 30 days) for ALL users."""
    token = _get_zoom_token()
    if not token:
        return _resp(500, {"error": "Failed to get Zoom token — check ZOOM_CLIENT_ID/SECRET/ACCOUNT_ID env vars"})

    from datetime import timedelta
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=30)

    try:
        users = _list_all_zoom_users(token)
        if not users:
            users = ["me"]  # fallback to account owner

        meetings = []
        for user_id in users:
            try:
                data = _zoom_api_get(
                    f"/users/{user_id}/recordings?from={start_date.strftime('%Y-%m-%d')}&to={end_date.strftime('%Y-%m-%d')}&page_size=100",
                    token,
                )
            except Exception as user_exc:
                logger.warning(f"Failed to list recordings for {user_id}: {user_exc}")
                continue

            for m in data.get("meetings", []):
                recordings = []
                for r in m.get("recording_files", []):
                    recordings.append({
                        "id": r.get("id"),
                        "file_type": r.get("file_type"),
                        "file_extension": r.get("file_extension"),
                        "recording_type": r.get("recording_type"),
                        "status": r.get("status"),
                        "file_size": r.get("file_size"),
                        "recording_start": r.get("recording_start"),
                    })

                meetings.append({
                    "id": m.get("id"),
                    "uuid": m.get("uuid"),
                    "topic": m.get("topic"),
                    "host_email": m.get("host_email", user_id),
                    "start_time": m.get("start_time"),
                    "duration": m.get("duration"),
                    "total_size": m.get("total_size"),
                    "recording_count": m.get("recording_count"),
                    "recording_files": recordings,
                })

        return _resp(200, {
            "meetings": meetings,
            "count": len(meetings),
            "users_scanned": len(users),
            "date_range": {
                "from": start_date.strftime("%Y-%m-%d"),
                "to": end_date.strftime("%Y-%m-%d"),
            },
        })

    except Exception as exc:
        logger.exception("Error listing Zoom meetings")
        return _resp(500, {"error": str(exc)})


def _retrieve_meeting(body: dict) -> dict:
    """Download recordings from a specific Zoom meeting and store in S3."""
    meeting_id = body.get("meeting_id", "")
    if not meeting_id:
        return _resp(400, {"error": "meeting_id required"})

    token = _get_zoom_token()
    if not token:
        return _resp(500, {"error": "Failed to get Zoom token"})

    import urllib.request
    from datetime import timedelta

    try:
        # Get meeting recording details
        rec_data = _zoom_api_get(f"/meetings/{meeting_id}/recordings", token)

        topic = rec_data.get("topic", "Untitled").replace("/", "-").replace("'", "")
        mid = rec_data.get("id", meeting_id)
        folder_name = f"{topic} ({mid})"

        results = []
        for recording in rec_data.get("recording_files", []):
            if recording.get("status") != "completed":
                continue

            download_url = recording.get("download_url")
            if not download_url:
                continue

            file_ext = recording.get("file_extension", "mp4").lower()
            rec_type = recording.get("recording_type", "unknown")
            rec_id = recording.get("id", "unknown")
            file_name = f"{rec_type}_{rec_id}.{file_ext}"

            # Build S3 key with date/time structure
            rec_start = recording.get("recording_start", "")
            if rec_start:
                try:
                    utc_time = datetime.strptime(rec_start, "%Y-%m-%dT%H:%M:%SZ")
                    est_time = utc_time - timedelta(hours=5)
                    date_folder = est_time.strftime("%Y-%m-%d")
                    time_folder = est_time.strftime("%I:%M%p").lower().lstrip("0")
                except Exception:
                    date_folder = datetime.utcnow().strftime("%Y-%m-%d")
                    time_folder = "unknown"
            else:
                date_folder = datetime.utcnow().strftime("%Y-%m-%d")
                time_folder = "unknown"

            s3_key = f"{folder_name}/{date_folder}/{time_folder}/{file_name}"

            # Download from Zoom and stream to S3 (avoid buffering entire file in memory)
            dl_url = f"{download_url}?access_token={token}"
            req = urllib.request.Request(dl_url)
            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    content_length = int(resp.headers.get("Content-Length", 0))

                    # Small files (<50MB): single put is fine
                    if content_length > 0 and content_length < 50 * 1024 * 1024:
                        file_data = resp.read()
                        s3.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=file_data)
                        total_size = len(file_data)
                        del file_data
                    else:
                        # Large files: multipart upload with 10MB chunks
                        chunk_size = 10 * 1024 * 1024
                        mpu = s3.create_multipart_upload(Bucket=S3_BUCKET, Key=s3_key)
                        upload_id = mpu["UploadId"]
                        parts = []
                        part_number = 1
                        total_size = 0
                        try:
                            while True:
                                chunk = resp.read(chunk_size)
                                if not chunk:
                                    break
                                part_resp = s3.upload_part(
                                    Bucket=S3_BUCKET,
                                    Key=s3_key,
                                    UploadId=upload_id,
                                    PartNumber=part_number,
                                    Body=chunk,
                                )
                                parts.append({"ETag": part_resp["ETag"], "PartNumber": part_number})
                                total_size += len(chunk)
                                part_number += 1
                            s3.complete_multipart_upload(
                                Bucket=S3_BUCKET,
                                Key=s3_key,
                                UploadId=upload_id,
                                MultipartUpload={"Parts": parts},
                            )
                        except Exception:
                            s3.abort_multipart_upload(Bucket=S3_BUCKET, Key=s3_key, UploadId=upload_id)
                            raise

                results.append({
                    "file_name": file_name,
                    "s3_key": s3_key,
                    "size": total_size,
                    "recording_type": rec_type,
                    "status": "stored",
                })
                logger.info(f"Stored {s3_key} ({total_size} bytes)")

            except Exception as dl_exc:
                logger.exception(f"Failed to download {file_name}")
                results.append({
                    "file_name": file_name,
                    "recording_type": rec_type,
                    "status": "failed",
                    "error": str(dl_exc),
                })

        # Store meeting metadata
        metadata = {
            "meeting_id": mid,
            "topic": topic,
            "start_time": rec_data.get("start_time"),
            "duration": rec_data.get("duration"),
            "total_size": rec_data.get("total_size"),
            "recording_count": rec_data.get("recording_count"),
            "retrieved_at": datetime.utcnow().isoformat() + "Z",
            "files": results,
        }
        meta_key = f"{folder_name}/meeting_summary_{mid}.json"
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=meta_key,
            Body=json.dumps(metadata, default=str),
            ContentType="application/json",
        )

        # Fetch and store meeting participants (attendees) for lockdown/gate
        try:
            participants = []
            is_historical = False
            try:
                participants = _get_meeting_participants(str(mid), token)
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    is_historical = True
                else:
                    raise
            except Exception:
                raise
                
            host_email = rec_data.get("host_email", "").strip().lower() if rec_data else ""
            old_rec = _get_attendee_record(folder_name)
            
            attendee_record = _perform_attendee_validation(
                folder=folder_name,
                mid=str(mid),
                topic=topic,
                host_email=host_email,
                participants=participants,
                is_historical=is_historical,
                old_record=old_rec
            )
            
            attendee_key = f"{folder_name}/_attendees.json"
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=attendee_key,
                Body=json.dumps(attendee_record, default=str),
                ContentType="application/json",
            )
            logger.info(f"Stored attendee record for {folder_name} with status {attendee_record['validation_status']}.")
        except Exception as att_exc:
            logger.error(f"Failed to fetch/store attendees for {folder_name}: {att_exc}")

        return _resp(200, {
            "folder": folder_name,
            "files_stored": len([r for r in results if r["status"] == "stored"]),
            "files_failed": len([r for r in results if r["status"] == "failed"]),
            "results": results,
        })

    except Exception as exc:
        logger.exception(f"Error retrieving meeting {meeting_id}")
        return _resp(500, {"error": str(exc)})


def _batch_retrieve_all(body: dict) -> dict:
    """Retrieve ALL recordings from Zoom cloud, paging month-by-month.

    Zoom API limits listing to 30-day windows. This iterates backwards
    from today up to `months_back` (default 6, max 12) and retrieves
    every meeting that isn't already in S3.

    Because API Gateway has a hard 29-second timeout, this function
    self-invokes asynchronously when called via API Gateway. The initial
    call returns immediately with status "started". Progress is written
    to S3 as _batch_status.json.

    If `sync=true` is passed in body, it runs synchronously (for direct
    Lambda invocations or testing).
    """
    from datetime import timedelta

    # If not sync mode, self-invoke asynchronously and return immediately
    is_sync = body.get("sync", False)
    if not is_sync:
        # Write initial status
        status_obj = {
            "status": "running",
            "started_at": datetime.utcnow().isoformat() + "Z",
            "months_back": min(body.get("months_back", 6), 12),
        }
        try:
            s3.put_object(
                Bucket=S3_BUCKET,
                Key="_batch_status.json",
                Body=json.dumps(status_obj),
                ContentType="application/json",
            )
        except Exception:
            pass

        # Self-invoke this Lambda asynchronously
        try:
            lambda_client = boto3.client("lambda")
            async_body = {**body, "sync": True}
            lambda_client.invoke(
                FunctionName=os.environ.get("AWS_LAMBDA_FUNCTION_NAME", ""),
                InvocationType="Event",  # async — returns immediately
                Payload=json.dumps({
                    "httpMethod": "POST",
                    "path": "/zoom-recordings",
                    "body": json.dumps({"action": "batch_retrieve_all", **async_body}),
                    "headers": {},
                    "queryStringParameters": {},
                }).encode(),
            )
        except Exception as exc:
            logger.exception("Failed to self-invoke async")
            return _resp(500, {"error": f"Failed to start async batch: {exc}"})

        return _resp(202, {
            "status": "started",
            "message": "Batch retrieval started asynchronously. Check _batch_status.json in S3 for progress.",
            "months_back": status_obj["months_back"],
        })

    # ── Synchronous execution (self-invoked or direct) ──────────────
    months_back = min(body.get("months_back", 6), 12)

    token = _get_zoom_token()
    if not token:
        return _resp(500, {"error": "Failed to get Zoom token"})

    # Build list of existing meeting IDs in S3 so we skip duplicates
    existing_folders = set()
    try:
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=S3_BUCKET, Delimiter="/")
        for page in pages:
            for cp in page.get("CommonPrefixes", []):
                existing_folders.add(cp["Prefix"].rstrip("/"))
    except Exception:
        pass

    # Extract meeting IDs from folder names like "Topic (12345)"
    existing_ids = set()
    for f in existing_folders:
        if "(" in f and f.endswith(")"):
            mid = f[f.rfind("(") + 1 : -1]
            existing_ids.add(mid)

    # Get all users so we scan everyone's recordings (not just "me")
    users = _list_all_zoom_users(token)
    if not users:
        users = ["me"]

    # Page through months for each user
    now = datetime.utcnow()
    all_meetings = []
    for user_id in users:
        for month_offset in range(months_back):
            end_date = now - timedelta(days=30 * month_offset)
            start_date = end_date - timedelta(days=30)

            try:
                next_page_token = ""
                while True:
                    path = (
                        f"/users/{user_id}/recordings"
                        f"?from={start_date.strftime('%Y-%m-%d')}"
                        f"&to={end_date.strftime('%Y-%m-%d')}"
                        f"&page_size=100"
                    )
                    if next_page_token:
                        path += f"&next_page_token={next_page_token}"

                    data = _zoom_api_get(path, token)

                    for m in data.get("meetings", []):
                        mid = str(m.get("id", ""))
                        if mid and mid not in existing_ids:
                            all_meetings.append(m)
                            existing_ids.add(mid)  # prevent dupes across windows

                    next_page_token = data.get("next_page_token", "")
                    if not next_page_token:
                        break
            except Exception as exc:
                logger.warning(f"Error listing {user_id} month offset {month_offset}: {exc}")

    logger.info(f"Batch retrieve: {len(all_meetings)} new meetings found across {len(users)} users, {months_back} months")

    # Now retrieve each meeting
    retrieved = 0
    skipped = 0
    failed = 0
    results = []

    for m in all_meetings:
        mid = str(m.get("id", ""))
        topic = m.get("topic", "Untitled")

        try:
            result = _retrieve_meeting({"meeting_id": mid})
            result_body = json.loads(result.get("body", "{}"))

            if result.get("statusCode") == 200:
                retrieved += 1
                results.append({
                    "meeting_id": mid,
                    "topic": topic,
                    "status": "stored",
                    "files_stored": result_body.get("files_stored", 0),
                })
            else:
                failed += 1
                results.append({
                    "meeting_id": mid,
                    "topic": topic,
                    "status": "failed",
                    "error": result_body.get("error", "unknown"),
                })
        except Exception as exc:
            failed += 1
            results.append({
                "meeting_id": mid,
                "topic": topic,
                "status": "failed",
                "error": str(exc),
            })

    # Write final status to S3
    final_status = {
        "status": "completed",
        "completed_at": datetime.utcnow().isoformat() + "Z",
        "total_found": len(all_meetings),
        "retrieved": retrieved,
        "skipped": skipped,
        "failed": failed,
        "months_scanned": months_back,
        "users_scanned": len(users),
        "results": results,
    }
    try:
        s3.put_object(
            Bucket=S3_BUCKET,
            Key="_batch_status.json",
            Body=json.dumps(final_status, default=str),
            ContentType="application/json",
        )
    except Exception:
        pass

    return _resp(200, final_status)


def _is_internal_email(email: str) -> bool:
    if not email:
        return False
    email = email.strip().lower()
    for domain in INTERNAL_DOMAINS:
        if email.endswith(f"@{domain}"):
            return True
    return False


def _send_unresolved_validation_notification(folder: str, meeting_id: str, topic: str, host_email: str, validation_errors: list, unresolved_participants: list):
    recipients = list({e for e in ADMIN_EMAILS if e and "@" in e})
    if not recipients:
        logger.warning(f"No admin recipients configured for unresolved validation notification on {folder}")
        return
        
    subject = f"[Aerostack Recording] Gated Meeting Validation Unresolved: {topic}"
    
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    dashboard_url = f"{frontend_url}/zoom-recordings"
    
    errors_text = "\n".join(f"- {e.get('message')}" for e in validation_errors)
    errors_html = "".join(f"<li style='margin-bottom:6px; color:#b91c1c;'><strong>{e.get('code')}:</strong> {e.get('message')}</li>" for e in validation_errors)
    
    unresolved_text = ""
    unresolved_html = ""
    if unresolved_participants:
        unresolved_text = "\nUnresolved/External Participants:\n" + "\n".join(f"- {p.get('name')} ({p.get('email') or 'No Email'}): {p.get('reason')}" for p in unresolved_participants)
        unresolved_html = (
            f"<div style='margin-top:20px;'>"
            f"  <h3 style='font-size:14px; color:#374151; margin-bottom:8px;'>Unresolved / External Participants ({len(unresolved_participants)}):</h3>"
            f"  <table style='width:100%; border-collapse:collapse; font-size:13px; text-align:left;'>"
            f"    <thead>"
            f"      <tr style='border-bottom:2px solid #e5e7eb;'>"
            f"        <th style='padding:6px 0; color:#4b5563;'>Name</th>"
            f"        <th style='padding:6px 0; color:#4b5563;'>Email</th>"
            f"        <th style='padding:6px 0; color:#4b5563;'>Reason</th>"
            f"      </tr>"
            f"    </thead>"
            f"    <tbody>"
        )
        for p in unresolved_participants:
            unresolved_html += (
                f"      <tr style='border-bottom:1px solid #f3f4f6;'>"
                f"        <td style='padding:6px 0; color:#1f2937; font-weight:500;'>{p.get('name')}</td>"
                f"        <td style='padding:6px 0; color:#4b5563; font-family:monospace;'>{p.get('email') or '<em>N/A</em>'}</td>"
                f"        <td style='padding:6px 0; color:#b91c1c;'>{p.get('reason')}</td>"
                f"      </tr>"
            )
        unresolved_html += "    </tbody></table></div>"

    body_text = (
        f"Hi Admin,\n\n"
        f"Attendee validation for the gated Zoom recording could not be completed successfully:\n\n"
        f"  Meeting: {topic}\n"
        f"  ID:      {meeting_id}\n"
        f"  Folder:  {folder}\n"
        f"  Host:    {host_email or 'Unknown'}\n\n"
        f"Validation Errors:\n"
        f"{errors_text}\n"
        f"{unresolved_text}\n\n"
        f"Please visit the Aerostack Zoom Recordings dashboard to resolve these validation issues, review access requests, or override the validation:\n"
        f"  {dashboard_url}\n\n"
        f"— Aerostack Zoom Recordings"
    )
    
    body_html = (
        f"<html>"
        f"<body style='font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;background-color:#f6f9fc;margin:0;padding:24px;-webkit-font-smoothing:antialiased;'>"
        f"  <div style='max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);border:1px solid #eef2f5;'>"
        f"    <div style='background:linear-gradient(135deg,#b91c1c 0%,#ef4444 100%);padding:28px;text-align:center;color:#ffffff;'>"
        f"      <h1 style='margin:0;font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;'>Attendee Validation Unresolved</h1>"
        f"    </div>"
        f"    <div style='padding:32px;color:#334155;line-height:1.6;font-size:15px;'>"
        f"      <p style='margin-top:0;'>Hello Admin,</p>"
        f"      <p>Attendee validation has failed or is unresolved for a gated Zoom recording. Access to this content may be restricted for legitimate attendees.</p>"
        f"      "
        f"      <div style='background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin:24px 0;'>"
        f"        <p style='margin:0;font-size:11px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;'>Validation Errors</p>"
        f"        <ul style='margin:8px 0 0; padding-left:20px; font-size:14px;'>"
        f"          {errors_html}"
        f"        </ul>"
        f"      </div>"
        f"      "
        f"      <table style='width:100%;border-collapse:collapse;margin:24px 0;'>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;width:100px;'>Meeting</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;color:#1e293b;font-weight:600;'>{topic}</td>"
        f"        </tr>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;'>Meeting ID</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;font-family:monospace;'>{meeting_id}</td>"
        f"        </tr>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;'>Host</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;color:#1e293b;font-family:monospace;'>{host_email or 'Unknown'}</td>"
        f"        </tr>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;'>Folder</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;font-family:monospace;'>{folder}</td>"
        f"        </tr>"
        f"      </table>"
        f"      "
        f"      {unresolved_html}"
        f"      "
        f"      <p style='color:#475569;margin-top:24px;'>You can resolve these issues by overriding the validation status or manually granting access to specific users.</p>"
        f"      "
        f"      <div style='text-align:center;margin:32px 0 16px;'>"
        f"        <a href='{dashboard_url}' target='_blank' style='display:inline-block;background-color:#b91c1c;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(185,28,28,0.2);'>Resolve in Aerostack</a>"
        f"      </div>"
        f"    </div>"
        f"    <div style='background-color:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;'>"
        f"      <p style='margin:0;'>This email was sent automatically by Aerostack Zoom Recordings.</p>"
        f"    </div>"
        f"  </div>"
        f"</body>"
        f"</html>"
    )
    
    try:
        ses = boto3.client("ses", region_name="us-east-1")
        ses.send_email(
            Source=SES_FROM_EMAIL,
            Destination={"ToAddresses": recipients},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": body_text, "Charset": "UTF-8"},
                    "Html": {"Data": body_html, "Charset": "UTF-8"},
                }
            }
        )
        logger.info(f"Unresolved validation notification sent to {recipients} for {folder}")
    except Exception as exc:
        logger.error(f"Failed to send unresolved validation notification: {exc}")


def _match_name_to_invitee(participant_name: str, invited_users: list) -> dict | None:
    """
    Attempts to match a guest participant's display name to an invitee from the invited_users list.
    Returns the matched invitee dict if a match is found, otherwise None.
    """
    if not participant_name or not invited_users:
        return None

    def normalize(s: str) -> str:
        if not s:
            return ""
        return re.sub(r"[^a-z0-9]", "", s.lower())

    p_norm = normalize(participant_name)
    if not p_norm or len(p_norm) < 2:
        return None

    GENERIC_NAMES = {"iphone", "ipad", "android", "zoom", "zoomuser", "guest", "admin", "host", "notetaker", "meetingroom", "conferenceroom"}
    if p_norm in GENERIC_NAMES:
        return None

    exact_matches = []
    prefix_matches = []
    word_matches = []

    p_words = [normalize(w) for w in participant_name.split() if normalize(w)]

    for user in invited_users:
        email = user.get("email", "").strip().lower()
        name = user.get("name", "").strip()

        if not email:
            continue

        username = email.split("@")[0]
        normalized_name = normalize(name)
        normalized_username = normalize(username)

        # 1. Exact Match
        if p_norm == normalized_name or p_norm == normalized_username:
            exact_matches.append(user)
            continue

        # 2. Prefix Match
        if (normalized_username.startswith(p_norm) or p_norm.startswith(normalized_username)) or \
           (normalized_name.startswith(p_norm) or p_norm.startswith(normalized_name)):
            prefix_matches.append(user)
            continue

        # 3. Word Match
        u_parts = re.split(r"[^a-zA-Z0-9]", username.lower())
        n_parts = re.split(r"[^a-zA-Z0-9]", name.lower())
        all_invitee_words = {normalize(w) for w in (u_parts + n_parts) if normalize(w)}

        if any(w in all_invitee_words for w in p_words):
            word_matches.append(user)

    if exact_matches:
        return exact_matches[0]
    if prefix_matches:
        return prefix_matches[0]
    if word_matches:
        return word_matches[0]

    return None


def _get_global_invitees_and_users(token: str) -> list:
    """
    Builds a global list of dicts {"email": ..., "name": ...} containing:
    1. Active Zoom users from the Enterprise Zoom account.
    2. All unique invited/manual/attended users collected from existing _attendees.json files in S3.
    """
    global_users = []
    seen_emails = set()
    
    # 1. Fetch Zoom users
    if token:
        try:
            next_page_token = ""
            while True:
                path = "/users?status=active&page_size=300"
                if next_page_token:
                    path += f"&next_page_token={next_page_token}"
                data = _zoom_api_get(path, token)
                for u in data.get("users", []):
                    email = u.get("email")
                    if email:
                        email_lc = email.strip().lower()
                        if email_lc not in seen_emails:
                            first_name = u.get("first_name", "")
                            last_name = u.get("last_name", "")
                            name = f"{first_name} {last_name}".strip() or email_lc.split("@")[0]
                            global_users.append({"email": email_lc, "name": name})
                            seen_emails.add(email_lc)
                next_page_token = data.get("next_page_token", "")
                if not next_page_token:
                    break
        except Exception as e:
            logger.warning(f"Failed to fetch Zoom users for global map: {e}")

    # 2. List S3 folders and read _attendees.json in parallel
    try:
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=S3_BUCKET, Delimiter="/")
        folders = []
        for page in pages:
            for cp in page.get("CommonPrefixes", []):
                f = cp["Prefix"].rstrip("/")
                if f:
                    folders.append(f)
        
        if folders:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            
            def read_rec(f):
                try:
                    key = f"{f}/_attendees.json"
                    resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
                    rec = json.loads(resp["Body"].read().decode("utf-8"))
                    users_found = []
                    
                    def parse_entry(x):
                        if isinstance(x, dict):
                            e = x.get("email") or x.get("user_email")
                            n = x.get("name") or ""
                            return str(e).strip().lower() if e else None, str(n).strip()
                        elif isinstance(x, str):
                            return x.strip().lower(), ""
                        return None, ""

                    # Collect from invited_users
                    for u in rec.get("invited_users", []):
                        email, name = parse_entry(u)
                        if email:
                            users_found.append({"email": email, "name": name})
                    # Collect from attendees
                    for a in rec.get("attendees", []):
                        email, name = parse_entry(a)
                        if email:
                            users_found.append({"email": email, "name": name})
                    # Collect from session_rules attendees
                    rules = rec.get("session_rules", {})
                    for date, rule in rules.items():
                        if isinstance(rule, dict):
                            for a in rule.get("attendees", []):
                                email, name = parse_entry(a)
                                if email:
                                    users_found.append({"email": email, "name": name})
                    return users_found
                except Exception:
                    return []
            
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = {executor.submit(read_rec, f): f for f in folders}
                for future in as_completed(futures):
                    for u in future.result():
                        email_lc = u["email"]
                        if email_lc not in seen_emails:
                            global_users.append({"email": email_lc, "name": u["name"]})
                            seen_emails.add(email_lc)
    except Exception as e:
        logger.warning(f"Failed to load S3 records for global map: {e}")
        
    return global_users



def _perform_attendee_validation(folder: str, mid: str, topic: str, host_email: str, participants: list, is_historical: bool, old_record: dict = None, session_rules: dict = None, invited_users: list = None, global_users: list = None) -> dict:
    """
    Validates attendees, identifies external/unresolved participants, merges old overrides,
    and returns a structured attendee record dict. Also sends notifications if unresolved.
    """
    all_seen_emails = set()
    all_attendees_list = []

    # Bots/notetakers can't access Aerostack — filter them out before validation.
    # Patterns match common notetaker display names regardless of the user prefix.
    NOTETAKER_PATTERNS = (
        "fireflies",
        "otter.ai",
        "otter ",
        "read.ai",
        "read ai",
        "fathom",
        "tl;dv",
        "tldv",
        "notetaker",
        "note taker",
        "zoom ai companion",
        "ai companion",
        "grain.com",
        "grain ",
        "circleback",
        "krisp",
        "avoma",
        "gong",
        "chorus",
        "sembly",
    )

    def _is_notetaker(name: str, email: str) -> bool:
        n = (name or "").lower()
        e = (email or "").lower()
        return any(pat in n or pat in e for pat in NOTETAKER_PATTERNS)

    # Resolve final invited_users and session_rules lists early
    final_invited_users = invited_users if invited_users is not None else (old_record.get("invited_users", []) if old_record else [])
    final_session_rules = session_rules if session_rules is not None else (old_record.get("session_rules", {}) if old_record else {})

    # Fetch global mapping fallback for unresolved participants if not pre-fetched
    if global_users is None:
        token = _get_zoom_token()
        global_users = _get_global_invitees_and_users(token) if token else []

    # Pre-process participants to resolve missing emails from final_invited_users or global list
    resolved_participants = []
    for p in participants:
        p_copy = dict(p)
        email = p_copy.get("user_email", "").strip().lower() if p_copy.get("user_email") else ""
        name = (p_copy.get("name", "") or "").strip()
        
        if not email and name:
            matched_user = _match_name_to_invitee(name, final_invited_users)
            if not matched_user and global_users:
                matched_user = _match_name_to_invitee(name, global_users)
            if matched_user:
                matched_email = matched_user.get("email", "").strip().lower()
                if matched_email:
                    p_copy["user_email"] = matched_email
                    logger.info(f"Resolved participant '{name}' email to '{matched_email}' from global list in _perform_attendee_validation.")
        resolved_participants.append(p_copy)

    # First pass: build a lookup of names that have been resolved with at least one
    # email anywhere in the participant list. Used to suppress duplicate "no email"
    # entries for someone whose email was already discovered in another join event.
    names_with_resolved_email = set()
    for p in resolved_participants:
        email_lc = p.get("user_email", "").strip().lower() if p.get("user_email") else ""
        name_lc = (p.get("name", "") or "").strip().lower()
        if email_lc and name_lc:
            names_with_resolved_email.add(name_lc)

    # Dedupe trackers for the unresolved list:
    # Track by name only — unresolved means "no email available" (guest user).
    # External-domain participants are not flagged here.
    unresolved_names_seen = set()
    unresolved_participants = []

    # Process participants
    for p in resolved_participants:
        email = p.get("user_email", "").strip().lower() if p.get("user_email") else ""
        name = (p.get("name", "") or "").strip()
        name_lc = name.lower()

        # Skip notetaker/AI bots entirely — they can't sign into Aerostack.
        if _is_notetaker(name, email):
            continue

        if not email:
            # Skip if this person was already resolved-by-email elsewhere in the list,
            # or if we've already reported this name as a guest.
            if name_lc and name_lc in names_with_resolved_email:
                continue
            if name_lc in unresolved_names_seen:
                continue
            unresolved_names_seen.add(name_lc)
            unresolved_participants.append({
                "name": name,
                "email": "",
                "reason": "Email could not be retrieved from Zoom (unregistered/guest user)"
            })
            continue

        if not _is_internal_email(email):
            # External-domain participant: skip — they have a real email and can be
            # granted access manually if needed. Don't flag them as unresolved.
            pass

        if email not in all_seen_emails:
            all_seen_emails.add(email)
            all_attendees_list.append({"email": email, "name": name})

    if host_email:
        host_email_clean = host_email.strip().lower()
        if host_email_clean not in all_seen_emails:
            all_seen_emails.add(host_email_clean)
            all_attendees_list.append({"email": host_email_clean, "name": "Host"})

    # Determine validation errors
    validation_errors = []
    if is_historical:
        validation_errors.append({
            "code": "ZOOM_RECORD_EXPIRED",
            "message": "Meeting is no longer available in Zoom records (expired or historical)."
        })
    elif not is_historical and len(all_attendees_list) <= 1:
        validation_errors.append({
            "code": "ZOOM_NO_PARTICIPANTS",
            "message": "No participant records could be retrieved from Zoom."
        })
        
    if unresolved_participants:
        validation_errors.append({
            "code": "UNRESOLVED_PARTICIPANTS",
            "message": f"Found {len(unresolved_participants)} unresolved or external participant(s)."
        })
        
    # Validation status defaults to unresolved if errors exist, unless overridden by admin
    validation_override = False
    bypass_reason = ""
    locked = True
    
    if old_record:
        validation_override = old_record.get("validation_override", False)
        bypass_reason = old_record.get("bypass_reason", "")
        locked = old_record.get("locked", True)
        
        # Merge manual attendees from previous attendee_record
        for a in old_record.get("attendees", []):
            email = a.get("email", a) if isinstance(a, dict) else a
            email_clean = email.strip().lower() if email else ""
            if email_clean and email_clean not in all_seen_emails:
                all_seen_emails.add(email_clean)
                all_attendees_list.append({"email": email_clean, "name": a.get("name", "") if isinstance(a, dict) else ""})
    
    # Resolve final invited_users and session_rules lists
    final_invited_users = invited_users if invited_users is not None else (old_record.get("invited_users", []) if old_record else [])
    final_session_rules = session_rules if session_rules is not None else (old_record.get("session_rules", {}) if old_record else {})
    
    # Add invited users to the main attendees list to ensure access
    for user in final_invited_users:
        email_clean = user.get("email", "").strip().lower()
        if email_clean and email_clean not in all_seen_emails:
            all_seen_emails.add(email_clean)
            all_attendees_list.append({"email": email_clean, "name": user.get("name", "")})
            
    validation_status = "validated" if (not validation_errors or validation_override) else "unresolved"
    
    # Notify admin every sync when unresolved (unless admin has overridden validation).
    # We only notify if there are actual unresolved/unknown participants to review.
    should_notify = validation_status == "unresolved" and not validation_override and len(unresolved_participants) > 0
        
    if should_notify:
        try:
            _send_unresolved_validation_notification(
                folder=folder,
                meeting_id=mid,
                topic=topic,
                host_email=host_email,
                validation_errors=validation_errors,
                unresolved_participants=unresolved_participants
            )
        except Exception as e:
            logger.error(f"Failed to send unresolved validation notification: {e}")
            
    return {
        "meeting_id": mid,
        "topic": topic,
        "host_email": host_email,
        "locked": locked,
        "locked_at": datetime.utcnow().isoformat() + "Z",
        "attendee_count": len(all_attendees_list),
        "attendees": all_attendees_list,
        "validation_status": validation_status,
        "validation_errors": validation_errors,
        "unresolved_participants": unresolved_participants,
        "validation_override": validation_override,
        "bypass_reason": bypass_reason,
        "session_rules": final_session_rules,
        "invited_users": final_invited_users
    }


# ── Attendee Access Control ──────────────────────────────────────────

def _get_meeting_participants(meeting_id: str, token: str) -> list:
    """Fetch participants/attendees for a past meeting using Zoom APIs."""
    import urllib.parse
    encoded_id = meeting_id
    if meeting_id.startswith("/") or "//" in meeting_id:
        encoded_id = urllib.parse.quote(urllib.parse.quote(meeting_id, safe=""), safe="")
    else:
        encoded_id = urllib.parse.quote(meeting_id, safe="")

    # Try `/report/meetings/{meetingId}/participants` first
    try:
        logger.warning(f"Fetching participants from report API for meeting {meeting_id}")
        data = _zoom_api_get(f"/report/meetings/{encoded_id}/participants?page_size=300", token)
        participants = data.get("participants", [])
        logger.warning(f"Raw report API participants: {participants}")
        
        # Paginate if there's a next page token
        next_page_token = data.get("next_page_token", "")
        while next_page_token:
            data = _zoom_api_get(f"/report/meetings/{encoded_id}/participants?page_size=300&next_page_token={next_page_token}", token)
            page_participants = data.get("participants", [])
            logger.warning(f"Raw report API next page participants: {page_participants}")
            participants.extend(page_participants)
            next_page_token = data.get("next_page_token", "")
            
        return participants
    except Exception as e:
        logger.warning(f"Failed to fetch from report API for meeting {meeting_id}: {e}")

    # Fallback to `/past_meetings/{meetingId}/participants`
    try:
        logger.warning(f"Fetching participants from past_meetings API for meeting {meeting_id}")
        data = _zoom_api_get(f"/past_meetings/{encoded_id}/participants?page_size=300", token)
        participants = data.get("participants", [])
        logger.warning(f"Raw past_meetings API participants: {participants}")
        
        # Paginate if there's a next page token
        next_page_token = data.get("next_page_token", "")
        while next_page_token:
            data = _zoom_api_get(f"/past_meetings/{encoded_id}/participants?page_size=300&next_page_token={next_page_token}", token)
            page_participants = data.get("participants", [])
            logger.warning(f"Raw past_meetings API next page participants: {page_participants}")
            participants.extend(page_participants)
            next_page_token = data.get("next_page_token", "")
            
        return participants
    except Exception as e:
        logger.error(f"Failed to fetch from past_meetings API for meeting {meeting_id}: {e}")

    return []


def _get_meeting_registrants(meeting_id: str, token: str) -> list:
    """Fetch registrants for a meeting from Zoom API."""
    import urllib.parse
    encoded_id = urllib.parse.quote(meeting_id, safe="")
    registrants = []
    try:
        data = _zoom_api_get(f"/meetings/{encoded_id}/registrants?page_size=300", token)
        if data and "registrants" in data:
            registrants.extend(data["registrants"])
            next_page_token = data.get("next_page_token")
            while next_page_token:
                data = _zoom_api_get(
                    f"/meetings/{encoded_id}/registrants?page_size=300&next_page_token={next_page_token}",
                    token
                )
                if data and "registrants" in data:
                    registrants.extend(data["registrants"])
                    next_page_token = data.get("next_page_token")
                else:
                    break
    except Exception as e:
        # 404 or 400 is expected if registration is not enabled for the meeting
        logger.warning(f"Failed to fetch registrants for meeting {meeting_id}: {e}")
    return registrants


def _sync_attendees(body: dict, global_users: list = None) -> dict:
    """
    POST { action: "sync_attendees", folder }
    Re-fetches the attendee list from Zoom for ALL past instances of the meeting.
    Stores per-session attendees in session_rules[YYYY-MM-DD] and a union at top level.
    """
    import urllib.parse

    folder = body.get("folder", "").strip()
    if not folder:
        return _resp(400, {"error": "folder parameter required"})

    token = _get_zoom_token()
    if not token:
        return _resp(500, {"error": "Failed to get Zoom token"})

    mid = folder
    if "(" in folder and folder.endswith(")"):
        mid = folder[folder.rfind("(") + 1 : -1]

    topic = folder
    if "(" in folder and folder.endswith(")"):
        topic = folder[: folder.rfind("(")].strip()

    try:
        # Check if meeting is historical (no longer available in Zoom records)
        is_historical = False
        try:
            _zoom_api_get(f"/meetings/{mid}", token)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                is_historical = True
                logger.warning(f"Meeting {mid} is historical/expired: {e.code} {e.reason}")
        except Exception as e:
            logger.warning(f"Failed to check meeting details for historical status: {e}")

        # Get host email — try multiple sources in priority order
        host_email = ""

        # Source 1: /meetings/{id}/recordings (has host_email field)
        try:
            rec_data = _zoom_api_get(f"/meetings/{mid}/recordings", token)
            host_email = rec_data.get("host_email", "").strip().lower()
            logger.warning(f"[host_email] Got from recordings API: {host_email}")
        except Exception as e:
            logger.warning(f"[host_email] recordings API failed: {e}")

        # Source 2: existing S3 attendee record (already stored from previous sync)
        if not host_email:
            try:
                old_rec = _get_attendee_record(folder)
                if old_rec:
                    host_email = old_rec.get("host_email", "").strip().lower()
                    if host_email:
                        logger.warning(f"[host_email] Got from existing S3 record: {host_email}")
            except Exception as e:
                logger.warning(f"[host_email] S3 record fallback failed: {e}")

        # Source 3: /meetings/{id} detail endpoint + Settings / Registrants Lookup
        alt_hosts = []
        auth_exceptions = []
        meeting_invitees = []
        try:
            mtg_data = _zoom_api_get(f"/meetings/{mid}", token)
            
            # Extract host_email if not already resolved
            if not host_email:
                host_id = mtg_data.get("host_id", "")
                if host_id:
                    user_data = _zoom_api_get(f"/users/{host_id}", token)
                    host_email = user_data.get("email", "").strip().lower()
                    if host_email:
                        logger.warning(f"[host_email] Got from meeting details → user: {host_email}")
            
            # Extract alternative hosts
            settings = mtg_data.get("settings", {})
            alt_hosts_str = settings.get("alternative_hosts", "")
            if alt_hosts_str:
                alt_hosts = [email.strip().lower() for email in alt_hosts_str.split(",") if email.strip()]
                logger.warning(f"[Sync] Found alternative hosts in Zoom settings: {alt_hosts}")

            # Extract authentication exceptions (specified invitees)
            auth_exceptions_raw = settings.get("authentication_exception", [])
            if auth_exceptions_raw:
                for entry in auth_exceptions_raw:
                    email = entry.get("email", "").strip().lower()
                    if email:
                        auth_exceptions.append({
                            "email": email,
                            "name": entry.get("name", "").strip() or email.split("@")[0]
                        })
                logger.warning(f"[Sync] Found specified invitees in Zoom settings: {[e['email'] for e in auth_exceptions]}")

            # Extract meeting invitees (the Zoom UI "Invitees" field)
            meeting_invitees_raw = settings.get("meeting_invitees", [])
            if meeting_invitees_raw:
                for entry in meeting_invitees_raw:
                    email = entry.get("email", "").strip().lower()
                    if email:
                        meeting_invitees.append({
                            "email": email,
                            "name": entry.get("name", "").strip() or email.split("@")[0]
                        })
                logger.warning(f"[Sync] Found meeting_invitees in Zoom settings: {[e['email'] for e in meeting_invitees]}")
        except Exception as e:
            logger.warning(f"Failed to fetch meeting details/alternative hosts for {mid}: {e}")

        # Fetch registrants (if any)
        registrant_emails = []
        try:
            registrants = _get_meeting_registrants(mid, token)
            for reg in registrants:
                email = reg.get("email", "").strip().lower()
                if email:
                    registrant_emails.append({
                        "email": email,
                        "name": f"{reg.get('first_name', '')} {reg.get('last_name', '')}".strip()
                    })
            if registrant_emails:
                logger.warning(f"[Sync] Found registrants in Zoom: {[r['email'] for r in registrant_emails]}")
        except Exception as e:
            logger.warning(f"Failed to fetch registrants list for {mid}: {e}")

        logger.warning(f"[host_email] Final resolved value: '{host_email}'")

        # ── Step 0: Get alternative hosts, specified invitees, registrants, and old invited users ──
        invited_users = []
        try:
            old_record = _get_attendee_record(folder)
            if old_record:
                invited_users = old_record.get("invited_users", [])
                if not isinstance(invited_users, list):
                    invited_users = []
        except Exception as e:
            logger.warning(f"Failed to read old record: {e}")

        # Merge Zoom alternative hosts, registrants, auth exceptions, meeting invitees early
        invited_emails = {u.get("email").strip().lower() for u in invited_users if u.get("email")}
        
        # 1. Alternative hosts
        for email in alt_hosts:
            if email not in invited_emails:
                invited_users.append({
                    "email": email,
                    "name": email.split("@")[0],
                    "session_id": "all",
                    "granted_at": datetime.utcnow().isoformat() + "Z",
                    "source": "zoom_alternative_host"
                })
                invited_emails.add(email)
                logger.warning(f"[Sync] Added alternative host to invited_users early: {email}")
                
        # 2. Specified Invitees (Authentication Exceptions)
        for entry in auth_exceptions:
            email = entry["email"]
            if email not in invited_emails:
                invited_users.append({
                    "email": email,
                    "name": entry["name"],
                    "session_id": "all",
                    "granted_at": datetime.utcnow().isoformat() + "Z",
                    "source": "zoom_specified_invitee"
                })
                invited_emails.add(email)
                logger.warning(f"[Sync] Added specified invitee to invited_users early: {email}")

        # 3. Registrants
        for r in registrant_emails:
            email = r["email"]
            if email not in invited_emails:
                invited_users.append({
                    "email": email,
                    "name": r["name"] or email.split("@")[0],
                    "session_id": "all",
                    "granted_at": datetime.utcnow().isoformat() + "Z",
                    "source": "zoom_registrant"
                })
                invited_emails.add(email)
                logger.warning(f"[Sync] Added registrant to invited_users early: {email}")

        # 4. Meeting invitees (Zoom UI "Invitees" field)
        for entry in meeting_invitees:
            email = entry["email"]
            if email not in invited_emails:
                invited_users.append({
                    "email": email,
                    "name": entry["name"],
                    "session_id": "all",
                    "granted_at": datetime.utcnow().isoformat() + "Z",
                    "source": "zoom_meeting_invitee"
                })
                invited_emails.add(email)
                logger.warning(f"[Sync] Added meeting invitee to invited_users early: {email}")

        # ── Step 1: get all past instances (UUIDs + start times) ──────────────
        instances = []
        seen_uuids = set()

        # Strategy A: /past_meetings/{id}/instances (works for recurring meetings)
        try:
            inst_data = _zoom_api_get(f"/past_meetings/{urllib.parse.quote(mid, safe='')}/instances", token)
            instances = inst_data.get("meetings", [])
            for inst in instances:
                uuid = inst.get("uuid", "")
                if uuid:
                    seen_uuids.add(uuid)
        except Exception as e:
            pass

        # Strategy B: scan user recordings month-by-month to find instances (only if Strategy A failed/returned empty)
        if not instances:
            try:
                from concurrent.futures import ThreadPoolExecutor, as_completed
                # If host_email is known, scan ONLY host_email. Otherwise scan all users.
                if host_email:
                    users_to_scan = [host_email]
                else:
                    users_to_scan = _list_all_zoom_users(token)
                    if not users_to_scan:
                        users_to_scan = ["me"]
                
                # Build list of scan tasks (user, from_date, to_date)
                scan_tasks = []
                window_end = datetime.utcnow()
                for _ in range(12):  # up to 12 months back
                    window_start = window_end - timedelta(days=30)
                    to_str   = window_end.strftime("%Y-%m-%d")
                    from_str = window_start.strftime("%Y-%m-%d")
                    
                    for user_id in users_to_scan:
                        scan_tasks.append((user_id, from_str, to_str))
                    
                    window_end = window_start
                
                # Run scan tasks in parallel
                max_workers = min(30, len(scan_tasks))
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_task = {
                        executor.submit(_fetch_user_recordings_window, user_id, from_str, to_str, token): (user_id, from_str, to_str)
                        for user_id, from_str, to_str in scan_tasks
                    }
                    
                    for future in as_completed(future_to_task):
                        user_id, from_str, to_str = future_to_task[future]
                        try:
                            meetings_chunk = future.result()
                            for m in meetings_chunk:
                                if str(m.get("id", "")) == str(mid):
                                    uuid       = m.get("uuid", "")
                                    start_time = m.get("start_time", "")
                                    if uuid and uuid not in seen_uuids:
                                        seen_uuids.add(uuid)
                                        instances.append({"uuid": uuid, "start_time": start_time})
                        except Exception as task_exc:
                            pass
            except Exception as e:
                pass

        # Strategy C: use UUIDs already found to get ALL instances via report API
        # /report/meetings/{uuid}/instances returns all occurrences of a recurring meeting
        if len(instances) < 4:
            found_uuids = [inst["uuid"] for inst in instances if inst.get("uuid")]
            for known_uuid in found_uuids:
                try:
                    encoded_uuid = urllib.parse.quote(
                        urllib.parse.quote(known_uuid, safe=""), safe=""
                    )
                    report_data = _zoom_api_get(
                        f"/report/meetings/{encoded_uuid}/instances",
                        token
                    )
                    for inst in report_data.get("list", []):
                        uuid       = inst.get("uuid", "")
                        start_time = inst.get("start_time", "")
                        if uuid and uuid not in seen_uuids:
                            seen_uuids.add(uuid)
                            instances.append({"uuid": uuid, "start_time": start_time})
                    break  # one UUID is enough — all instances of the recurring meeting are returned
                except Exception as e:
                    pass

        # ── Step 1b: supplement instances from S3 date folders ────────────────
        s3_session_dates = set()
        try:
            paginator_s3 = s3.get_paginator("list_objects_v2")
            s3_pages = paginator_s3.paginate(Bucket=S3_BUCKET, Prefix=f"{folder}/", Delimiter="/")
            for s3_page in s3_pages:
                for cp in s3_page.get("CommonPrefixes", []):
                    date_part = cp["Prefix"].rstrip("/").replace(f"{folder}/", "")
                    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_part):
                        s3_session_dates.add(date_part)
            logger.warning(f"[S3 dates] Found session dates in S3: {sorted(s3_session_dates)}")
        except Exception as e:
            logger.warning(f"[S3 dates] Could not read S3 session dates: {e}")

        # Filter Zoom instances to only keep those that match an S3 session date
        instances = [
            inst for inst in instances
            if inst.get("start_time") and inst["start_time"][:10] in s3_session_dates
        ]

        # Add any S3 dates not already covered by Zoom instances
        zoom_dates = {inst["start_time"][:10] for inst in instances if inst.get("start_time")}
        for s3_date in s3_session_dates:
            if s3_date not in zoom_dates:
                logger.warning(f"[S3 dates] Adding S3-only session date {s3_date} (not in Zoom cloud)")
                instances.append({"uuid": "", "start_time": f"{s3_date}T00:00:00Z", "s3_only": True})


        # ── Step 2 init: per-session state ────────────────────────────────────
        session_rules = {}
        all_zoom_participants = []

        # Get global users list for fallback resolution during process if not pre-fetched
        if global_users is None:
            global_users = _get_global_invitees_and_users(token) if token else []

        def _process_participants(participants: list, session_date: str | None):
            """Dedup and record participants into session_rules and global list."""
            for p in participants:
                p_copy = dict(p)
                email = p_copy.get("user_email", "").strip().lower() if p_copy.get("user_email") else ""
                name  = p_copy.get("name", "").strip()
                
                # If guest user (no email), try to match against invited_users / global_users fallback
                if not email and name:
                    matched_user = _match_name_to_invitee(name, invited_users)
                    if not matched_user and global_users:
                        matched_user = _match_name_to_invitee(name, global_users)
                    if matched_user:
                        email = matched_user.get("email", "").strip().lower()
                        p_copy["user_email"] = email
                        logger.info(f"Resolved participant '{name}' email to '{email}' from global list during session processing.")
                
                all_zoom_participants.append(p_copy)
                
                if not email:
                    continue
                if session_date:
                    bucket = session_rules.setdefault(session_date, {"locked": True, "attendees": []})
                    existing = {a["email"] if isinstance(a, dict) else a for a in bucket["attendees"]}
                    if email not in existing:
                        bucket["attendees"].append({"email": email, "name": name})

        # Prepare list of Zoom participant fetch tasks
        zoom_instances = []

        if instances:
            for inst in instances:
                uuid         = inst.get("uuid", "")
                start_time   = inst.get("start_time", "")
                session_date = start_time[:10] if start_time else None
                is_s3_only   = inst.get("s3_only", False)

                if not session_date:
                    continue

                if is_s3_only:
                    # No Zoom data — seed from previously stored attendee record if available
                    logger.warning(f"[S3-only session] {session_date} — seeding from old record if present")
                    bucket = session_rules.setdefault(session_date, {"locked": True, "attendees": []})
                    try:
                        old_rec = _get_attendee_record(folder)
                        if old_rec:
                            old_sr = old_rec.get("session_rules", {}).get(session_date, {})
                            for a in old_sr.get("attendees", []):
                                email = a.get("email", a) if isinstance(a, dict) else a
                                name  = a.get("name", "") if isinstance(a, dict) else ""
                                if email:
                                    existing = {x["email"] if isinstance(x, dict) else x for x in bucket["attendees"]}
                                    if email not in existing:
                                        bucket["attendees"].append({"email": email, "name": name})
                                    # Add to flat list to be preserved in main attendee record
                                    all_zoom_participants.append({"user_email": email, "name": name})
                    except Exception:
                        pass
                    continue

                if uuid:
                    zoom_instances.append((uuid, session_date))

            # Fetch Zoom participants in parallel
            if zoom_instances:
                from concurrent.futures import ThreadPoolExecutor, as_completed
                max_workers = min(15, len(zoom_instances))
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_inst = {
                        executor.submit(_get_meeting_participants, uuid, token): (uuid, session_date)
                        for uuid, session_date in zoom_instances
                    }
                    for future in as_completed(future_to_inst):
                        uuid, session_date = future_to_inst[future]
                        try:
                            parts = future.result()
                            logger.warning(f"Parallel fetch for instance {uuid} (date={session_date}) -> {len(parts)} participants")
                            _process_participants(parts, session_date)
                        except Exception as e:
                            logger.warning(f"Parallel fetch failed for instance {uuid}: {e}")
        else:
            # No instances endpoint — fall back to fetching by meeting ID (latest session only)
            logger.warning(f"No instances found; falling back to meeting-level participant fetch for {mid}")
            parts = _get_meeting_participants(mid, token)
            _process_participants(parts, None)

        all_seen_emails = {p.get("user_email", "").strip().lower() for p in all_zoom_participants if p.get("user_email")}
        if host_email:
            all_seen_emails.add(host_email.strip().lower())


        # ── Step 3: preserve manually-granted session overrides ───────────────
        try:
            old_record = _get_attendee_record(folder)
            if old_record:
                # Retroactive migration: if anyone was in old_record["attendees"]
                # but is not a current Zoom attendee of the kept sessions,
                # and is not already in invited_users, add them to invited_users.
                current_zoom_emails = set(all_seen_emails)
                invited_emails = {u.get("email").strip().lower() for u in invited_users if u.get("email")}
                
                for a in old_record.get("attendees", []):
                    email = a.get("email", a) if isinstance(a, dict) else a
                    email_clean = email.strip().lower() if email else ""
                    if email_clean and email_clean not in current_zoom_emails and email_clean not in invited_emails:
                        name = a.get("name", "") if isinstance(a, dict) else ""
                        invited_users.append({
                            "email": email_clean,
                            "name": name or email_clean.split("@")[0],
                            "session_id": "all",
                            "granted_at": datetime.utcnow().isoformat() + "Z"
                        })
                        invited_emails.add(email_clean)
                        logger.warning(f"[Sync] Migrated old manual grant to invited_users: {email_clean}")
        except Exception as e:
            logger.warning(f"Failed retroactive migration during sync: {e}")

        logger.warning(f"[Sync] Preserving top-level manual invites: {[u.get('email') for u in invited_users]}")

        # Perform attendee validation and record consolidation
        old_record = _get_attendee_record(folder)
        attendee_record = _perform_attendee_validation(
            folder=folder,
            mid=mid,
            topic=topic,
            host_email=host_email,
            participants=all_zoom_participants,
            is_historical=is_historical,
            old_record=old_record,
            session_rules=session_rules,
            invited_users=invited_users,
            global_users=global_users
        )

        attendee_key = f"{folder}/{ATTENDEES_FILE}"
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=attendee_key,
            Body=json.dumps(attendee_record, default=str),
            ContentType="application/json",
        )

        logger.warning(
            f"Synced attendees for {folder}: status={attendee_record['validation_status']}, "
            f"count={attendee_record['attendee_count']} total across {len(session_rules)} sessions"
        )

        frontend_record = _map_attendee_record(folder, attendee_record)

        return _resp(200, {
            "status": "success",
            "folder": folder,
            "attendee_count": len(frontend_record["attendees"]),
            "session_count": len(session_rules),
            "attendee_record": frontend_record,
        })
    except Exception as e:
        logger.exception(f"Failed to sync attendees for folder {folder}")
        return _resp(500, {"error": f"Failed to sync attendees: {e}"})


def _sync_all_attendees(body: dict) -> dict:
    """
    POST { action: "sync_all_attendees" }
    Lists all folders in S3 and triggers sync_attendees for each.
    """
    # Check if this is the async execution
    is_sync = body.get("sync", False)

    if not is_sync:
        # Self-invoke this Lambda asynchronously
        try:
            lambda_client = boto3.client("lambda")
            lambda_client.invoke(
                FunctionName=os.environ.get("AWS_LAMBDA_FUNCTION_NAME", ""),
                InvocationType="Event",  # async — returns immediately
                Payload=json.dumps({
                    "httpMethod": "POST",
                    "path": "/zoom-recordings",
                    "body": json.dumps({"action": "sync_all_attendees", "sync": True, **body}),
                    "headers": {},
                    "queryStringParameters": {},
                }).encode(),
            )
        except Exception as exc:
            logger.exception("Failed to self-invoke sync_all_attendees async")
            return _resp(500, {"error": f"Failed to start async attendee sync: {exc}"})

        return _resp(200, {
            "message": "Attendee sync started in the background. It will take a few minutes to complete.",
            "synced_folders": [],
            "failed_folders": []
        })

    prefix = body.get("prefix", "")
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=S3_BUCKET, Delimiter="/", Prefix=prefix)

    folders = []
    for page in pages:
        for cp in page.get("CommonPrefixes", []):
            folder = cp["Prefix"].rstrip("/")
            if folder:
                folders.append(folder)

    if not folders:
        return _resp(200, {"message": "No folders found to sync", "synced_folders": []})

    from concurrent.futures import ThreadPoolExecutor, as_completed

    token = _get_zoom_token()
    global_users = _get_global_invitees_and_users(token) if token else []

    def sync_one(f):
        try:
            res = _sync_attendees({"folder": f}, global_users=global_users)
            body_data = json.loads(res.get("body", "{}"))
            return f, res.get("statusCode") == 200, body_data
        except Exception as e:
            return f, False, {"error": str(e)}

    synced_folders = []
    failed_folders = []

    max_workers = min(15, len(folders))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(sync_one, folder): folder for folder in folders}
        for future in as_completed(futures):
            folder = futures[future]
            try:
                folder_name, success, info = future.result()
                if success:
                    synced_folders.append(folder_name)
                else:
                    failed_folders.append({"folder": folder_name, "error": info.get("error", "Unknown error")})
            except Exception as e:
                failed_folders.append({"folder": folder, "error": str(e)})

    logger.info(f"Async sync_all_attendees completed. Synced {len(synced_folders)} folders. Failed {len(failed_folders)} folders.")

    return _resp(200, {
        "message": f"Sync completed. Successfully synced {len(synced_folders)} folders.",
        "synced_folders": synced_folders,
        "failed_folders": failed_folders
    })


def _grant_recording_access(body: dict) -> dict:
    """
    POST { action: "grant_access", folder, email, name, session_id }
    Appends the specified user email/name to _attendees.json in S3.
    """
    folder = body.get("folder", "").strip()
    email = body.get("email", "").strip().lower()
    name = body.get("name", "").strip() or email.split("@")[0]
    session_id = body.get("session_id", "all").strip()

    if not folder or not email:
        return _resp(400, {"error": "folder and email parameters are required"})

    try:
        # Get existing attendee record, or create a new one if missing
        record = _get_attendee_record(folder)
        if not record:
            mid = folder
            if "(" in folder and folder.endswith(")"):
                mid = folder[folder.rfind("(") + 1 : -1]
            topic = folder
            if "(" in folder and folder.endswith(")"):
                topic = folder[: folder.rfind("(")].strip()

            record = {
                "meeting_id": mid,
                "topic": topic,
                "host_email": "",
                "locked": True,
                "locked_at": datetime.utcnow().isoformat() + "Z",
                "attendee_count": 0,
                "attendees": [],
                "session_rules": {},
                "invited_users": []
            }
        
        # Track in invited_users list
        invited_users = record.get("invited_users", [])
        if not isinstance(invited_users, list):
            invited_users = []
        
        exists = False
        for user in invited_users:
            if user.get("email", "").strip().lower() == email:
                exists = True
                if session_id == "all" and user.get("session_id") != "all":
                    user["session_id"] = "all"
                break
        
        if not exists:
            invited_users.append({
                "email": email,
                "name": name,
                "session_id": session_id,
                "granted_at": datetime.utcnow().isoformat() + "Z",
                "source": "admin_invite"
            })
            logger.warning(f"[Grant Access] Admin manually invited user: {email} for session: {session_id}")
        record["invited_users"] = invited_users

        if session_id == "all" or not session_id:

            # Main attendee list
            existing_emails = {
                a.get("email", "").strip().lower()
                for a in record.get("attendees", [])
                if a.get("email", "").strip()
            }
            if email not in existing_emails:
                attendees = record.get("attendees", [])
                attendees.append({"email": email, "name": name})
                record["attendees"] = attendees
                record["attendee_count"] = len(attendees)
                record["locked"] = True
                record["locked_at"] = datetime.utcnow().isoformat() + "Z"
        else:
            # Session-specific attendee list
            session_rules = record.get("session_rules", {})
            if not isinstance(session_rules, dict):
                session_rules = {}
            if session_id not in session_rules:
                session_rules[session_id] = {
                    "locked": True,
                    "attendees": []
                }
            
            session_attendees = session_rules[session_id].get("attendees", [])
            if not isinstance(session_attendees, list):
                session_attendees = []
                
            session_emails = {
                a.get("email", "").strip().lower()
                for a in session_attendees
                if a.get("email")
            }
            if email not in session_emails:
                session_attendees.append({"email": email, "name": name})
                session_rules[session_id]["attendees"] = session_attendees
                record["session_rules"] = session_rules
                record["locked"] = True
                record["locked_at"] = datetime.utcnow().isoformat() + "Z"

        # Save updated record back to S3
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=f"{folder}/{ATTENDEES_FILE}",
            Body=json.dumps(record, default=str),
            ContentType="application/json"
        )

        frontend_record = _map_attendee_record(folder, record)

        return _resp(200, {
            "status": "success",
            "folder": folder,
            "attendee_record": frontend_record
        })
    except Exception as e:
        logger.exception(f"Failed to grant access to {email} for folder {folder}")
        return _resp(500, {"error": f"Failed to grant access: {e}"})


def _revoke_recording_access(body: dict) -> dict:
    """
    POST { action: "revoke_access", folder, email, session_id }
    Removes the specified user email from invited_users and attendee records in S3.
    """
    folder = body.get("folder", "").strip()
    email = body.get("email", "").strip().lower()
    session_id = body.get("session_id", "all").strip()

    if not folder or not email:
        return _resp(400, {"error": "folder and email parameters are required"})

    try:
        record = _get_attendee_record(folder)
        if not record:
            return _resp(404, {"error": "Attendee record not found"})

        # Remove from invited_users
        invited_users = record.get("invited_users", [])
        if isinstance(invited_users, list):
            new_invited_users = []
            for u in invited_users:
                if u.get("email", "").strip().lower() == email and u.get("session_id", "all").strip() == session_id:
                    logger.warning(f"[Revoke Access] Removing user {email} for session {session_id} from invited_users")
                else:
                    new_invited_users.append(u)
            record["invited_users"] = new_invited_users

        # If session_id is "all", remove from top-level attendees list
        if session_id == "all":
            attendees = record.get("attendees", [])
            if isinstance(attendees, list):
                new_attendees = []
                for a in attendees:
                    a_email = a.get("email", "").strip().lower() if isinstance(a, dict) else a.strip().lower()
                    if a_email == email:
                        logger.warning(f"[Revoke Access] Removing user {email} from top-level attendees list")
                    else:
                        new_attendees.append(a)
                record["attendees"] = new_attendees
                record["attendee_count"] = len(new_attendees)
        else:
            # Remove from session-specific rule
            session_rules = record.get("session_rules", {})
            if isinstance(session_rules, dict) and session_id in session_rules:
                rule = session_rules[session_id]
                if isinstance(rule, dict) and "attendees" in rule:
                    s_att = rule["attendees"]
                    new_s_att = []
                    for a in s_att:
                        a_email = a.get("email", "").strip().lower() if isinstance(a, dict) else a.strip().lower()
                        if a_email == email:
                            logger.warning(f"[Revoke Access] Removing user {email} from session {session_id}")
                        else:
                            new_s_att.append(a)
                    rule["attendees"] = new_s_att

        # Write updated record to S3
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=f"{folder}/_attendees.json",
            Body=json.dumps(record),
            ContentType="application/json",
        )

        frontend_record = _map_attendee_record(folder, record)
        return _resp(200, {
            "status": "success",
            "folder": folder,
            "attendee_record": frontend_record
        })

    except Exception as e:
        logger.exception(f"Failed to revoke access for user {email} in folder {folder}")
        return _resp(500, {"error": f"Failed to revoke access: {e}"})


def _get_attendee_record(folder_name: str) -> dict | None:
    """Read _attendees.json from S3 for a given folder, or None if not found."""
    try:
        key = f"{folder_name}/_attendees.json"
        resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return json.loads(resp["Body"].read().decode("utf-8"))
    except Exception:
        return None


def _map_attendee_record(folder: str, record: dict | None) -> dict | None:
    if not record:
        return None
    
    attendee_emails = [
        a.get("email", "").strip().lower()
        for a in record.get("attendees", [])
        if a.get("email", "").strip()
    ]

    session_rules_mapped = {}
    session_rules = record.get("session_rules", {})
    for date, rule in session_rules.items():
        session_rules_mapped[date] = {
            "locked": rule.get("locked", True),
            "attendees": [
                a.get("email", "").strip().lower()
                for a in rule.get("attendees", [])
                if a.get("email", "").strip()
            ]
        }

    return {
        "folder": folder,
        "locked": record.get("locked", True),
        "attendees": attendee_emails,
        "host_email": record.get("host_email", ""),
        "attendee_count": record.get("attendee_count", len(attendee_emails)),
        "locked_at": record.get("locked_at", ""),
        "meeting_id": record.get("meeting_id", ""),
        "topic": record.get("topic", ""),
        "session_rules": session_rules_mapped,
        "invited_users": record.get("invited_users", []),
        "validation_status": record.get("validation_status", "validated"),
        "validation_errors": record.get("validation_errors", []),
        "unresolved_participants": record.get("unresolved_participants", []),
        "validation_override": record.get("validation_override", False),
        "bypass_reason": record.get("bypass_reason", ""),
    }


def _override_validation(body: dict) -> dict:
    """
    POST { action: "override_validation", folder, validation_status, bypass_reason, locked }
    Allows admin to manually override/resolve validation errors or toggle lock.
    """
    folder = body.get("folder", "").strip()
    validation_status = body.get("validation_status", "validated").strip()
    bypass_reason = body.get("bypass_reason", "").strip()
    locked = body.get("locked") # can be boolean or None
    
    if not folder:
        return _resp(400, {"error": "folder parameter is required"})
        
    try:
        record = _get_attendee_record(folder)
        if not record:
            return _resp(404, {"error": "Attendee record not found"})
            
        record["validation_override"] = (validation_status == "validated")
        record["validation_status"] = validation_status
        record["bypass_reason"] = bypass_reason
        if locked is not None:
            record["locked"] = bool(locked)
            
        # Save updated record back to S3
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=f"{folder}/{ATTENDEES_FILE}",
            Body=json.dumps(record, default=str),
            ContentType="application/json"
        )
        
        frontend_record = _map_attendee_record(folder, record)
        return _resp(200, {
            "status": "success",
            "folder": folder,
            "attendee_record": frontend_record
        })
    except Exception as e:
        logger.exception(f"Failed to override validation for folder {folder}")
        return _resp(500, {"error": f"Failed to override validation: {e}"})



def _get_recording_attendees(qs: dict) -> dict:
    """
    GET ?action=attendees&folder=<folder_name>
    Returns the attendee list for a recording so the Aerostack UI can determine
    whether the current user was in the meeting.
    """
    folder = qs.get("folder", "").strip()
    if not folder:
        return _resp(400, {"error": "folder parameter required"})

    record = _get_attendee_record(folder)
    if not record:
        # No attendee record means restricted by default
        return _resp(200, {
            "folder": folder,
            "locked": True,
            "attendees": [],
            "message": "No attendee record found — access restricted",
        })

    mapped = _map_attendee_record(folder, record)
    return _resp(200, mapped)


def _request_recording_access(body: dict) -> dict:
    """
    POST { action: "request_access", folder, requester_email, requester_name }
    Sends an SES email to the meeting host + admin emails asking for access.
    """
    folder = body.get("folder", "").strip()
    requester_email = body.get("requester_email", "").strip()
    requester_name = body.get("requester_name", requester_email).strip()

    if not folder or not requester_email:
        return _resp(400, {"error": "folder and requester_email are required"})

    # Load attendee record to get host email and topic
    record = _get_attendee_record(folder)
    host_email = ""
    topic = folder  # fallback
    if record:
        host_email = record.get("host_email", "")
        topic = record.get("topic", folder)
    logger.info(f"Loaded attendee record for folder '{folder}'. host_email: '{host_email}', topic: '{topic}'")

    # Build recipient list: configured admin emails only, deduplicated
    recipients = list({e for e in ADMIN_EMAILS if e and "@" in e})
    logger.info(f"Access request target recipients: {recipients} (derived from ADMIN_EMAILS: {ADMIN_EMAILS})")
    if not recipients:
        logger.warning(f"No recipients configured for access request on {folder}")
        return _resp(503, {"error": "No admin recipients configured. Set ADMIN_EMAILS env var."})

    subject = f"[Aerostack Recording] Access Request: {topic}"
    
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    dashboard_url = f"{frontend_url}/zoom-recordings"

    body_text = (
        f"Hi,\n\n"
        f"{requester_name} ({requester_email}) has requested access to the Zoom recording:\n\n"
        f"  Meeting: {topic}\n"
        f"  Folder:  {folder}\n\n"
        f"To manage access, visit the Aerostack Zoom Recordings dashboard:\n"
        f"  {dashboard_url}\n\n"
        f"— Aerostack Zoom Recordings"
    )
    
    body_html = (
        f"<html>"
        f"<body style='font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;background-color:#f6f9fc;margin:0;padding:24px;-webkit-font-smoothing:antialiased;'>"
        f"  <div style='max-width:580px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);border:1px solid #eef2f5;'>"
        f"    <div style='background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:28px;text-align:center;color:#ffffff;'>"
        f"      <h1 style='margin:0;font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;'>Recording Access Request</h1>"
        f"    </div>"
        f"    <div style='padding:32px;color:#334155;line-height:1.6;font-size:15px;'>"
        f"      <p style='margin-top:0;'>Hello,</p>"
        f"      <p>A user has requested access to view a gated Zoom cloud recording on Aerostack.</p>"
        f"      "
        f"      <div style='background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:24px 0;'>"
        f"        <p style='margin:0;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;'>Requester</p>"
        f"        <p style='margin:4px 0 0;font-size:16px;font-weight:700;color:#0f172a;'>{requester_name}</p>"
        f"        <p style='margin:2px 0 0;font-size:14px;font-family:monospace;'><a href='mailto:{requester_email}' style='color:#2563eb;text-decoration:none;'>{requester_email}</a></p>"
        f"      </div>"
        f"      "
        f"      <table style='width:100%;border-collapse:collapse;margin:24px 0;'>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;width:100px;'>Meeting</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;color:#1e293b;font-weight:600;'>{topic}</td>"
        f"        </tr>"
        f"        <tr>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;font-weight:600;color:#64748b;'>Folder</td>"
        f"          <td style='padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;font-family:monospace;'>{folder}</td>"
        f"        </tr>"
        f"      </table>"
        f"      "
        f"      <p style='color:#475569;margin-bottom:0;'>To authorize this user, click the button below to go to the Access Control Panel on the Aerostack dashboard and grant them access.</p>"
        f"      "
        f"      <div style='text-align:center;margin:32px 0 16px;'>"
        f"        <a href='{dashboard_url}' target='_blank' style='display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(37,99,235,0.2);'>Manage Access in Aerostack</a>"
        f"      </div>"
        f"    </div>"
        f"    <div style='background-color:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;'>"
        f"      <p style='margin:0;'>This email was sent automatically by Aerostack Zoom Recordings.</p>"
        f"    </div>"
        f"  </div>"
        f"</body>"
        f"</html>"
    )

    try:
        ses = boto3.client("ses", region_name="us-east-1")
        logger.info(f"Attempting to send SES email. Source: '{SES_FROM_EMAIL}', Destination: {recipients}, ReplyTo: ['{requester_email}']")
        response = ses.send_email(
            Source=SES_FROM_EMAIL,
            Destination={"ToAddresses": recipients},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": body_text, "Charset": "UTF-8"},
                    "Html": {"Data": body_html, "Charset": "UTF-8"},
                },
            },
            ReplyToAddresses=[requester_email],
        )
        logger.info(f"Access request sent successfully! MessageId: '{response.get('MessageId')}' for {folder} from {requester_email} to {recipients}")
        return _resp(200, {
            "status": "sent",
            "folder": folder,
            "recipients": recipients,
            "requester": requester_email,
            "message_id": response.get("MessageId"),
        })
    except Exception as exc:
        logger.exception(f"Failed to send access request email from {requester_email} to {recipients}")
        return _resp(500, {"error": f"Failed to send email: {exc}"})


# ── Batch Status ─────────────────────────────────────────────────────


def _get_batch_status() -> dict:
    """Return the current batch retrieval status from S3."""
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key="_batch_status.json")
        status = json.loads(obj["Body"].read().decode())
        return _resp(200, status)
    except s3.exceptions.NoSuchKey:
        return _resp(200, {"status": "idle", "message": "No batch job has been run yet."})
    except Exception as exc:
        return _resp(500, {"error": f"Failed to read batch status: {exc}"})


# ── Webhook Handler ──────────────────────────────────────────────────

def _handle_zoom_webhook(event):
    """Handle Zoom webhooks including URL validation and recording events."""
    try:
        body_raw = event.get("body") or "{}"
        body = json.loads(body_raw)
        event_type = body.get("event")

        logger.info(f"Zoom webhook received: event_type={event_type}, body_keys={list(body.keys())}")

        # 1. Handle Endpoint URL Validation (Challenge-Response)
        if event_type == "endpoint.url_validation":
            plain_token = body.get("payload", {}).get("plainToken")
            webhook_secret = _get_zoom_webhook_secret()

            if not webhook_secret:
                logger.error("ZOOM_WEBHOOK_SECRET not set, cannot validate URL")
                return _resp(500, {"error": "ZOOM_WEBHOOK_SECRET not configured"})

            hash_for_validate = hmac.new(
                webhook_secret.encode("utf-8"),
                plain_token.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            return _resp(200, {
                "plainToken": plain_token,
                "encryptedToken": hash_for_validate,
            })

        # 2. Handle Recording Completed Event
        if event_type == "recording.completed":
            payload = body.get("payload", {})
            obj = payload.get("object", {})
            meeting_id = obj.get("id")
            meeting_uuid = obj.get("uuid", "")
            meeting_topic = obj.get("topic", "Unknown")

            logger.info(
                f"Received recording.completed for {meeting_topic} "
                f"(meeting_id={meeting_id}, uuid={meeting_uuid})"
            )

            # Prefer UUID for recurring meetings — identifies the specific occurrence
            retrieve_id = meeting_uuid if meeting_uuid else str(meeting_id) if meeting_id else ""

            if retrieve_id:
                return _retrieve_meeting({"meeting_id": retrieve_id})
            else:
                logger.error(f"No meeting_id or uuid in webhook payload. Keys: {list(obj.keys())}")
                return _resp(400, {"error": "No meeting_id in webhook payload"})

        return _resp(200, {"status": "event_received", "event": event_type})

    except Exception as exc:
        logger.exception("Error in Zoom webhook handler")
        return _resp(500, {"error": str(exc)})


# ── GET actions ──────────────────────────────────────────────────────

def _list_recordings(qs: dict) -> dict:
    prefix = qs.get("prefix", "")
    meetings = []

    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=S3_BUCKET, Delimiter="/", Prefix=prefix)

    folders = []
    for page in pages:
        for cp in page.get("CommonPrefixes", []):
            folder = cp["Prefix"].rstrip("/")
            folders.append(folder)

    # Fetch meeting info in parallel using ThreadPoolExecutor
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    max_workers = min(50, max(1, len(folders)))
    if folders:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_folder = {executor.submit(_build_meeting_info, folder): folder for folder in folders}
            for future in as_completed(future_to_folder):
                try:
                    info = future.result()
                    if info:
                        meetings.append(info)
                except Exception as e:
                    folder = future_to_folder[future]
                    logger.error(f"Error fetching info for folder {folder} in thread pool: {e}")

    meetings.sort(key=lambda m: m.get("latest_date", ""), reverse=True)
    return _resp(200, {"meetings": meetings, "count": len(meetings), "bucket": S3_BUCKET})


def _build_meeting_info(folder_name: str) -> dict | None:
    try:
        date_folders = []
        files = []
        total_size = 0
        classification = None
        attendee_raw = None

        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=f"{folder_name}/")

        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                size = obj.get("Size", 0)
                total_size += size

                parts = key.replace(f"{folder_name}/", "").split("/")
                if len(parts) >= 1 and parts[0]:
                    date_str = parts[0]
                    if date_str not in date_folders and not date_str.startswith("_"):
                        date_folders.append(date_str)

                file_name = parts[-1] if parts else ""
                if file_name and not file_name.endswith("/"):
                    # Read classification if found
                    if file_name == CLASSIFICATION_FILE:
                        try:
                            resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
                            classification = json.loads(resp["Body"].read().decode("utf-8"))
                        except Exception:
                            pass
                        continue  # Don't include classification file in file list

                    # Read attendee record if found
                    if file_name == "_attendees.json":
                        try:
                            resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
                            attendee_raw = json.loads(resp["Body"].read().decode("utf-8"))
                        except Exception:
                            pass
                        continue  # Don't include attendees file in file list

                    file_ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
                    files.append({
                        "key": key,
                        "name": file_name,
                        "size": size,
                        "extension": file_ext,
                        "type": _classify_file_type(file_name, file_ext),
                        "last_modified": obj.get("LastModified", "").isoformat()
                            if hasattr(obj.get("LastModified", ""), "isoformat")
                            else str(obj.get("LastModified", "")),
                        "date_folder": parts[0] if len(parts) >= 1 else "",
                        "time_folder": parts[1] if len(parts) >= 2 else "",
                    })

        if not files:
            return None

        meeting_name = folder_name
        meeting_id = ""
        if "(" in folder_name and folder_name.endswith(")"):
            meeting_name = folder_name[: folder_name.rfind("(")].strip()
            meeting_id = folder_name[folder_name.rfind("(") + 1 : -1]

        date_folders.sort(reverse=True)
        attendee_record = _map_attendee_record(folder_name, attendee_raw) if attendee_raw else None

        return {
            "folder": folder_name,
            "meeting_name": meeting_name,
            "meeting_id": meeting_id,
            "dates": date_folders,
            "latest_date": date_folders[0] if date_folders else "",
            "session_count": len(date_folders),
            "file_count": len(files),
            "total_size_bytes": total_size,
            "total_size_display": _format_size(total_size),
            "files": files,
            "has_video": any(f["type"] == "video" for f in files),
            "has_transcript": any(f["type"] == "transcript" for f in files),
            "has_audio": any(f["type"] == "audio" for f in files),
            "classification": classification,
            "attendee_record": attendee_record,
        }
    except Exception:
        logger.exception(f"Error building meeting info for {folder_name}")
        return None


def _get_recording_detail(qs: dict) -> dict:
    folder = qs.get("folder", "")
    if not folder:
        return _resp(400, {"error": "folder parameter required"})
    info = _build_meeting_info(folder)
    if not info:
        return _resp(404, {"error": f"No recordings found for: {folder}"})

    summary = None
    for f in info["files"]:
        if f["name"].startswith("meeting_summary") and f["extension"] == "json":
            try:
                obj = s3.get_object(Bucket=S3_BUCKET, Key=f["key"])
                summary = json.loads(obj["Body"].read().decode("utf-8"))
            except Exception:
                pass
    info["summary"] = summary
    return _resp(200, info)


def _get_presigned_url(qs: dict) -> dict:
    key = qs.get("key", "")
    if not key:
        return _resp(400, {"error": "key parameter required"})
    try:
        url = s3.generate_presigned_url(
            "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=3600
        )
        return _resp(200, {"url": url, "expires_in": 3600})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _get_stream_url(qs: dict) -> dict:
    """Generate a presigned URL with inline content disposition for in-browser playback."""
    key = qs.get("key", "")
    if not key:
        return _resp(400, {"error": "key parameter required"})

    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    content_type_map = {
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mkv": "video/x-matroska",
        "mov": "video/quicktime",
        "m4a": "audio/mp4",
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
    }
    content_type = content_type_map.get(ext, "application/octet-stream")

    try:
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": key,
                "ResponseContentDisposition": "inline",
                "ResponseContentType": content_type,
            },
            ExpiresIn=3600,
        )
        return _resp(200, {"url": url, "content_type": content_type, "expires_in": 3600})
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


def _get_vtt_content(qs: dict) -> dict:
    """Return text-based file content directly (avoids CORS issues with S3).

    Supports VTT, SRT, TXT, and JSON files for inline preview.
    """
    key = qs.get("key", "")
    if not key:
        return _resp(400, {"error": "key parameter required"})
    ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    content_type_map = {
        "vtt": "text/vtt",
        "srt": "text/plain",
        "txt": "text/plain",
        "json": "application/json",
    }
    if ext not in content_type_map:
        return _resp(400, {"error": f"Unsupported file type: {ext}"})
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        content = obj["Body"].read().decode("utf-8")
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": content_type_map[ext],
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type,Authorization",
            },
            "body": content,
        }
    except Exception as exc:
        return _resp(500, {"error": str(exc)})


# ── Utilities ────────────────────────────────────────────────────────

def _classify_file_type(name: str, ext: str) -> str:
    if ext in ("mp4", "mkv", "webm", "mov"):
        return "video"
    if ext in ("m4a", "mp3", "wav", "ogg"):
        return "audio"
    if ext in ("vtt", "srt", "txt"):
        return "transcript"
    if ext == "json":
        return "metadata"
    return "other"


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    if size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


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
