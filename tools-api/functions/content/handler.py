"""
Content Agent Lambda — strategic content pipeline with KB-powered generation.

KBs are managed by the Knowledge service (/knowledge endpoint).
This handler focuses on content briefs, drafts, and the generation pipeline.

Actions (POST):
  - create_brief: Create a content brief from wizard selections
  - generate_draft: Generate content draft using KB context + Bedrock
  - update_draft: Update draft body, hashtags, and/or attached image (S3 key)
  - presign_image_upload: Return S3 presigned PUT URL for a draft image
  - update_status: Move content through the pipeline (scheduled_date required when status is scheduled)
  - post_to_linkedin: Prod: LinkedIn text UGC. Dev sink writes canonical ugc_posts body + linkedin_post_bundle.draft_media (S3 key, presigned URL) when draft has image_s3_key; no LinkedIn HTTP.
  - delete_brief: Remove a brief, all its drafts, and their associated S3 images
Process (EventBridge Lambda scheduled_publish.handler, every minute UTC):
  - Dispatches LinkedIn briefs with status scheduled and scheduled_date <= now (UTC ISO from API)
Actions (GET):
  - list_briefs, get_brief, list_calendar, status
"""
import json
import os
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

from linkedin_ugc_contract import build_linkedin_ugc_payload, validate_linkedin_ugc_payload

CONTENT_TABLE = os.environ.get("CONTENT_TABLE", "")
KB_TABLE = os.environ.get("KB_TABLE", "")
CONTENT_ASSETS_BUCKET = os.environ.get("CONTENT_ASSETS_BUCKET", "")
STAGE = os.environ.get("STAGE", "dev")
LINKEDIN_SECRET_NAME = os.environ.get("LINKEDIN_SECRET_NAME", "linkedin_content_publish")
LINKEDIN_UGC_SINK_TABLE = (os.environ.get("LINKEDIN_UGC_SINK_TABLE") or "").strip()
# Optional: real-looking URN when using dev sink without Secrets Manager OAuth
LINKEDIN_DEADEND_AUTHOR_URN = (os.environ.get("LINKEDIN_DEADEND_AUTHOR_URN") or "").strip()

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


def _coerce_scheduled_date_iso(raw: str | None) -> str:
    """Normalize scheduled_date to UTC sortable ISO (…Z) for storage and auto-publish."""
    s = (raw or "").strip()
    if not s:
        return ""
    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            d = datetime.strptime(s, "%Y-%m-%d").date()
            dt = datetime(d.year, d.month, d.day, 9, 0, 0, tzinfo=ZoneInfo("America/New_York"))
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if s.endswith("Z"):
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return s

_s3_client = None


def _s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _presign_get_url(key: str, expires: int = 3600) -> str | None:
    if not CONTENT_ASSETS_BUCKET or not key:
        return None
    try:
        return _s3().generate_presigned_url(
            "get_object",
            Params={"Bucket": CONTENT_ASSETS_BUCKET, "Key": key},
            ExpiresIn=expires,
        )
    except Exception:
        return None


def _enrich_draft(draft: dict) -> dict:
    out = dict(draft)
    ik = out.get("image_s3_key")
    if ik:
        url = _presign_get_url(str(ik))
        if url:
            out["image_url"] = url
    return out


# ── LinkedIn (on-demand UGC text post) ───────────────────────────


def _linkedin_creds() -> dict | None:
    if not LINKEDIN_SECRET_NAME:
        return None
    try:
        sm = boto3.client("secretsmanager")
        raw = sm.get_secret_value(SecretId=LINKEDIN_SECRET_NAME).get("SecretString") or "{}"
        data = json.loads(raw)
        token = (data.get("access_token") or "").strip()
        author = (data.get("author_urn") or "").strip()
        if token and author:
            return {"access_token": token, "author_urn": author}
    except Exception:
        pass
    return None


def _compose_linkedin_post_text(draft: dict) -> str:
    body = (draft.get("content") or "").strip()
    tags = draft.get("suggested_hashtags") or []
    if isinstance(tags, list) and tags:
        body = f"{body}\n\n{' '.join(str(t) for t in tags)}"
    return body[:2900]


def _draft_media_for_sink(draft: dict) -> dict | None:
    """Image metadata persisted on dev-only sink rows (production still posts text NONE today)."""
    raw = draft.get("image_s3_key")
    key = str(raw).strip() if raw is not None else ""
    if not key:
        return None
    url = _presign_get_url(key, 86400) or ""
    return {
        "image_s3_key": key,
        "content_assets_bucket": CONTENT_ASSETS_BUCKET or "",
        "presigned_get_url": url,
        "presign_expires_seconds": 86400 if url else 0,
        "note": "Included for dev sink fidelity; IMAGE UGC requires LinkedIn Assets API in prod.",
    }


def _linkedin_ugc_sink_put_item(
    table_name: str,
    *,
    brief_id: str,
    draft_sk: str,
    payload: dict,
    linkedin_post_bundle: dict | None,
    contract_valid: bool,
    validation_errors: list[str],
    simulated_urn: str,
    body_text: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": f"LINKEDINUGC#{STAGE}",
        "sk": f"{now}#{uuid.uuid4()}",
        "brief_id": brief_id,
        "draft_sk": draft_sk or "",
        "contract_valid": contract_valid,
        "validation_errors": validation_errors[:20],
        "ugc_payload": payload,
        # Full composed post (already capped by _compose_linkedin_post_text, max ~2900)
        "composed_text_preview": body_text or "",
        "text_length": len(body_text or ""),
        "simulated_urn": simulated_urn or "",
        "sink_mode": "deadend_linkedin_post",
        "created_at": now,
    }
    if linkedin_post_bundle is not None:
        item["linkedin_post_bundle"] = linkedin_post_bundle
    _get_table(table_name).put_item(Item=item)


def _post_linkedin_ugc_http(access_token: str, payload: dict) -> tuple[bool, str, str]:
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        "https://api.linkedin.com/v2/ugcPosts",
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8")
            if raw:
                parsed = json.loads(raw)
                urn = str(parsed.get("id", "")).strip()
                return True, "", urn
        return True, "", ""
    except HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace") if exc.fp else str(exc)
        return False, f"LinkedIn HTTP {exc.code}: {err[:2000]}", ""


def _post_to_linkedin(body: dict) -> dict:
    """POST action: publish draft copy as a LinkedIn UGC text post."""
    brief_id = str(body.get("brief_id", "")).strip()
    draft_id_raw = str(body.get("draft_id", "")).strip()
    mark_published = body.get("mark_published", True)
    if isinstance(mark_published, str):
        mark_published = mark_published.lower() in ("1", "true", "yes")
    force = bool(body.get("force"))

    if not brief_id or not CONTENT_TABLE:
        return _err(400, "Missing brief_id")

    sink_table = LINKEDIN_UGC_SINK_TABLE
    creds = _linkedin_creds()
    if not creds:
        if sink_table:
            aid = LINKEDIN_DEADEND_AUTHOR_URN or "urn:li:person:deadend-dev-validation"
            creds = {"access_token": "", "author_urn": aid}
        else:
            return _err(
                503,
                "LinkedIn not configured: create Secrets Manager secret "
                f"{LINKEDIN_SECRET_NAME or 'linkedin_content_publish'} with "
                "access_token and author_urn (urn:li:person:... or urn:li:organization:...)",
            )

    table = _get_table(CONTENT_TABLE)
    response = table.query(KeyConditionExpression=Key("pk").eq(brief_id))
    items = response.get("Items", [])

    brief = None
    drafts: list[dict] = []
    for item in items:
        if item.get("sk") == "BRIEF":
            brief = item
        elif str(item.get("sk", "")).startswith("DRAFT#"):
            drafts.append(item)

    if not brief:
        return _err(404, "Brief not found")

    platform = str(brief.get("platform", "")).lower()
    if platform != "linkedin":
        return _err(400, "Only LinkedIn briefs can be posted (this brief’s platform is not linkedin)")

    if str(brief.get("linkedin_last_post_urn", "")).strip() and not force:
        return _err(
            409,
            "This brief was already posted to LinkedIn. Open LinkedIn to verify, or pass force: true to post again.",
        )

    draft: dict | None = None
    if draft_id_raw:
        sk = draft_id_raw if draft_id_raw.startswith("DRAFT#") else f"DRAFT#{draft_id_raw}"
        for d in drafts:
            if d.get("sk") == sk:
                draft = d
                break
        if not draft:
            return _err(404, "Draft not found for this brief")
    else:
        drafts.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        draft = drafts[0] if drafts else None

    if not draft:
        return _err(400, "No draft to post")

    text = _compose_linkedin_post_text(draft)
    if not text.strip():
        return _err(400, "Draft has no text to post")

    payload = build_linkedin_ugc_payload(creds["author_urn"], text)
    contract_ok, contract_errs = validate_linkedin_ugc_payload(payload)

    draft_sk_val = str(draft.get("sk", ""))

    bundle: dict = {"linkedin_ugc_posts_body": payload}
    dm = _draft_media_for_sink(draft)
    if dm:
        bundle["draft_media"] = dm

    if sink_table:
        sim = f"urn:li:ugcPost:deadend-{uuid.uuid4()}" if contract_ok else ""
        try:
            _linkedin_ugc_sink_put_item(
                sink_table,
                brief_id=brief_id,
                draft_sk=draft_sk_val,
                payload=payload,
                linkedin_post_bundle=bundle,
                contract_valid=contract_ok,
                validation_errors=contract_errs,
                simulated_urn=sim,
                body_text=text,
            )
        except Exception as exc:
            return _err(502, f"LinkedIn dev sink writes failed ({sink_table}): {exc}")

        if not contract_ok:
            return _err(
                422,
                "LinkedIn UGC contract validation failed — see sink row "
                + f"{LINKEDIN_UGC_SINK_TABLE} pk=LINKEDINUGC#{STAGE}: "
                + "; ".join(contract_errs),
            )
        urn = sim
    else:
        if not contract_ok:
            return _err(
                500,
                "Internal: UGC payload failed contract check: "
                + "; ".join(contract_errs),
            )
        ok, err_msg, urn = _post_linkedin_ugc_http(creds["access_token"], payload)
        if not ok:
            return _err(502, err_msg)

    now = datetime.now(timezone.utc).isoformat()
    if mark_published:
        table.update_item(
            Key={"pk": brief_id, "sk": "BRIEF"},
            UpdateExpression="SET #s = :pub, updated_at = :u, linkedin_last_post_urn = :urn, linkedin_posted_at = :ts",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":pub": "published",
                ":u": now,
                ":urn": urn or "",
                ":ts": now,
            },
        )
        if KB_TABLE:
            _write_to_prior_content_kb(brief_id)
    else:
        table.update_item(
            Key={"pk": brief_id, "sk": "BRIEF"},
            UpdateExpression="SET updated_at = :u, linkedin_last_post_urn = :urn, linkedin_posted_at = :ts",
            ExpressionAttributeValues={
                ":u": now,
                ":urn": urn or "",
                ":ts": now,
            },
        )

    body_out: dict = {
        "brief_id": brief_id,
        "linkedin_post_urn": urn,
        "published": bool(mark_published),
    }
    if sink_table:
        body_out["linkedin_post_deadend"] = True
        body_out["linkedin_contract_validated"] = True
    return _ok(body_out)

_ddb = None


def _get_table(table_name: str):
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(table_name)


# ── KB Context Retrieval ─────────────────────────────────────────────

CONTENT_KB_IDS = {
    "always": ["system-brand-voice", "system-strategic-alignment"],
    "story": ["system-story-library", "system-customer-star"],
    "platform": ["system-platform-playbook"],
    "community": ["system-community-blocks", "system-aws-accreditations"],
    "reference": ["system-prior-content", "system-presentation-structures"],
}


def _get_kb_context(topic: str, platform: str, audience: str) -> str:
    """Pull relevant KB entries for content generation.

    Uses the kb_client module (shared from tools-api/shared/).
    Falls back gracefully if KB table is empty or unavailable.
    """
    if not KB_TABLE:
        return ""

    try:
        from kb_client import KBClient
        client = KBClient(table_name=KB_TABLE)

        kb_ids = list(CONTENT_KB_IDS["always"])
        kb_ids.extend(CONTENT_KB_IDS["platform"])

        if topic in ("customer_success", "community_engagement"):
            kb_ids.extend(CONTENT_KB_IDS["story"])
        if topic in ("community_engagement", "aws_innovation"):
            kb_ids.extend(CONTENT_KB_IDS["community"])

        kb_ids.extend(CONTENT_KB_IDS["reference"])

        query = f"{topic.replace('_', ' ')} content for {audience.replace('_', ' ')} on {platform}"
        return client.build_context_block(query, kb_ids, limit=5, max_chars=3000)
    except Exception:
        return ""


# ── Prompt Building ──────────────────────────────────────────────────

PLATFORM_GUIDES = {
    "linkedin": "Professional networking post. 1300-1800 chars ideal. Use line breaks for readability. Hook in first line.",
    "x": "280 char max. Punchy, direct. Thread-friendly if longer.",
    "facebook": "Conversational, community-oriented. 200-500 chars ideal.",
    "meetup": "Event-focused, community building. Include logistics if relevant.",
    "blog": "Long-form, structured with headers. 800-2000 words.",
}

TONE_GUIDES = {
    "inspirational": "Uplifting, vision-forward, empowering language",
    "informative": "Data-driven, educational, clear explanations",
    "conversational": "Casual, relatable, like talking to a peer",
    "formal": "Polished, structured, business-appropriate",
    "fun": "Playful, energetic, uses humor appropriately",
}

VOICE_GUIDES = {
    "expert_authoritative": "Speak from deep experience. Reference specific outcomes. Confident but not arrogant.",
    "friendly_approachable": "Warm, inclusive, inviting. Use 'we' and 'you'. Lower the barrier.",
    "innovative_forward": "Future-focused, cutting-edge. Reference emerging trends. Bold claims backed by substance.",
    "professional_corporate": "Polished, measured, stakeholder-appropriate. Clear value propositions.",
    "dynamic_energetic": "High energy, action-oriented. Short sentences. Momentum.",
}

TOPIC_HASHTAGS = {
    "aws_innovation": ["#AWS", "#CloudInnovation", "#AWSPartner"],
    "customer_success": ["#CustomerSuccess", "#CaseStudy", "#Results"],
    "rapid_prototyping": ["#RapidPrototyping", "#MVP", "#BuildFast"],
    "smb_modernization": ["#SMB", "#DigitalTransformation", "#Modernization"],
    "genai_application": ["#GenAI", "#ArtificialIntelligence", "#AIAgents"],
    "community_engagement": ["#Community", "#AWSCommunity", "#TechCommunity"],
    "saas_development": ["#SaaS", "#Serverless", "#CloudNative"],
    "agentic_business": ["#AgenticAI", "#AutonomousBusiness", "#AIAgents"],
    "devops_culture": ["#DevOps", "#CICD", "#EngineeringCulture"],
}


def _build_content_prompt(
    platform: str, topic: str, audience: str, tone: str,
    brand_voice: str, cta_type: str, custom_context: str,
    story_hook: str, kb_context: str,
) -> str:
    parts = [
        "You are a strategic content creator for enterprise, an AWS consulting firm that builds agentic business systems.",
        f"\nPlatform: {platform}. {PLATFORM_GUIDES.get(platform, '')}",
        f"\nTopic: {topic.replace('_', ' ').title()}",
        f"\nTarget audience: {audience.replace('_', ' ').title()}",
        f"\nTone: {TONE_GUIDES.get(tone, tone)}",
        f"\nBrand voice: {VOICE_GUIDES.get(brand_voice, brand_voice)}",
    ]

    if kb_context:
        parts.append(f"\n--- KNOWLEDGE BASE CONTEXT ---\nUse the following reference material to inform your writing. Weave in relevant details naturally:\n\n{kb_context}\n--- END KB CONTEXT ---")

    if cta_type and cta_type != "none":
        parts.append(f"\nInclude a '{cta_type.replace('_', ' ').title()}' call to action.")
    if custom_context:
        parts.append(f"\nAdditional context: {custom_context}")
    if story_hook:
        parts.append(f"\nStory hook to weave in: {story_hook}")

    parts.append("\nWrite the post now. No preamble, no explanation — just the content ready to publish.")
    return "\n".join(parts)


def _build_media_prompt(platform: str, topic: str, content: str) -> str:
    return f"""Based on this {platform} post about {topic.replace('_', ' ')}, suggest media to accompany it.

Post content:
{content[:1500]}

Return JSON with these fields:
{{
  "media_type": "image|video|carousel|infographic|none",
  "description": "What the media should show",
  "alt_text": "Accessible alt text for the media",
  "stock_search_terms": ["3-5 search terms for finding stock imagery"],
  "canva_template_suggestion": "Type of Canva template that would work",
  "aspect_ratio": "1:1|16:9|4:5|9:16"
}}

Return ONLY valid JSON."""


# ── Bedrock Calls ────────────────────────────────────────────────────

def _call_bedrock(prompt: str) -> str:
    try:
        client = boto3.client("bedrock-runtime", region_name="us-east-1")
        response = client.converse(
            modelId="us.anthropic.claude-sonnet-4-20250514-v1:0",
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 2000, "temperature": 0.7},
        )
        return response["output"]["message"]["content"][0]["text"]
    except Exception as e:
        return f"[Bedrock unavailable — draft placeholder]\n\nPrompt was:\n{prompt[:500]}...\n\nError: {str(e)}"


def _call_bedrock_json(prompt: str) -> dict:
    try:
        client = boto3.client("bedrock-runtime", region_name="us-east-1")
        response = client.converse(
            modelId="us.anthropic.claude-sonnet-4-20250514-v1:0",
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 1000, "temperature": 0.3},
        )
        raw = response["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception:
        return {}


# ── Brief & Draft Actions ────────────────────────────────────────────

def _create_brief(body: dict) -> dict:
    brief = body.get("brief", {})
    brief_id = f"brief-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "pk": brief_id, "sk": "BRIEF", "type": "brief",
        "platform": brief.get("platform", "linkedin"),
        "topic": brief.get("topic", ""),
        "audience": brief.get("audience", ""),
        "tone": brief.get("tone", "conversational"),
        "brand_voice": brief.get("brandVoice", "friendly_approachable"),
        "cta_type": brief.get("ctaType", "none"),
        "cta_link": brief.get("ctaLink", ""),
        "custom_context": brief.get("customContext", ""),
        "story_hook": brief.get("storyHook", ""),
        "scheduled_date": _coerce_scheduled_date_iso(brief.get("scheduledDate", "")),
        "status": "draft",
        "created_at": now, "updated_at": now,
    }

    if CONTENT_TABLE:
        _get_table(CONTENT_TABLE).put_item(Item=item)

    return _ok({"brief_id": brief_id, "brief": item})


def _generate_draft(body: dict) -> dict:
    brief_id = body.get("brief_id", "")
    brief_data = body.get("brief", {})

    platform = brief_data.get("platform", "linkedin")
    topic = brief_data.get("topic", "")
    audience = brief_data.get("audience", "")
    tone = brief_data.get("tone", "conversational")
    brand_voice = brief_data.get("brandVoice", "friendly_approachable")
    cta_type = brief_data.get("ctaType", "none")
    custom_context = brief_data.get("customContext", "")
    story_hook = brief_data.get("storyHook", "")

    kb_context = _get_kb_context(topic, platform, audience)

    prompt = _build_content_prompt(
        platform=platform, topic=topic, audience=audience,
        tone=tone, brand_voice=brand_voice, cta_type=cta_type,
        custom_context=custom_context, story_hook=story_hook,
        kb_context=kb_context,
    )

    generated_content = _call_bedrock(prompt)

    media_suggestion = _call_bedrock_json(
        _build_media_prompt(platform, topic, generated_content)
    )

    hashtags = TOPIC_HASHTAGS.get(topic, ["#enterprise", "#AWS"])
    if platform == "x":
        hashtags = hashtags[:3]
    else:
        hashtags = hashtags[:5]

    draft_id = f"draft-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    draft = {
        "pk": brief_id or f"brief-{uuid.uuid4().hex[:12]}",
        "sk": f"DRAFT#{draft_id}",
        "type": "draft",
        "draft_id": draft_id,
        "version": 1,
        "content": generated_content,
        "suggested_hashtags": hashtags,
        "media_suggestion": media_suggestion,
        "kb_sources_used": bool(kb_context),
        "status": "draft",
        "created_at": now,
    }

    if CONTENT_TABLE:
        _get_table(CONTENT_TABLE).put_item(Item=draft)

    return _ok({"draft_id": draft_id, "draft": draft})


def _update_draft(body: dict) -> dict:
    """Persist edits to an existing draft (post-generation review)."""
    brief_id = body.get("brief_id", "")
    draft_id = body.get("draft_id", "")
    content = body.get("content")
    hashtags = body.get("suggested_hashtags")
    clear_image = bool(body.get("clear_image"))
    image_s3_key = body.get("image_s3_key")

    if not brief_id or not draft_id or not CONTENT_TABLE:
        return _err(400, "Missing brief_id or draft_id")

    sk = draft_id if str(draft_id).startswith("DRAFT#") else f"DRAFT#{draft_id}"
    now = datetime.now(timezone.utc).isoformat()
    table = _get_table(CONTENT_TABLE)

    has_update = (
        content is not None
        or hashtags is not None
        or clear_image
        or (isinstance(image_s3_key, str) and image_s3_key.strip() != "")
    )
    if not has_update:
        return _err(400, "No fields to update")

    expr_vals = {":u": now}
    update_parts = ["updated_at = :u"]
    expr_names = {}

    if content is not None:
        expr_vals[":c"] = content
        update_parts.append("content = :c")
    if hashtags is not None:
        if not isinstance(hashtags, list):
            return _err(400, "suggested_hashtags must be a list")
        expr_vals[":h"] = hashtags
        update_parts.append("suggested_hashtags = :h")
    if clear_image:
        expr_names["#ik"] = "image_s3_key"
    elif isinstance(image_s3_key, str) and image_s3_key.strip() != "":
        expr_vals[":ik"] = image_s3_key.strip()
        update_parts.append("image_s3_key = :ik")

    update_expr = "SET " + ", ".join(update_parts)
    if clear_image:
        update_expr += " REMOVE #ik"

    kwargs = {
        "Key": {"pk": brief_id, "sk": sk},
        "UpdateExpression": update_expr,
        "ExpressionAttributeValues": expr_vals,
        "ConditionExpression": "attribute_exists(pk) AND attribute_exists(sk)",
    }
    if expr_names:
        kwargs["ExpressionAttributeNames"] = expr_names

    try:
        table.update_item(**kwargs)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return _err(404, "Draft not found")
        raise

    out = {"brief_id": brief_id, "draft_id": draft_id, "updated": True}
    if clear_image:
        out["image_url"] = None
    elif isinstance(image_s3_key, str) and image_s3_key.strip():
        url = _presign_get_url(image_s3_key.strip())
        if url:
            out["image_url"] = url
    return _ok(out)


def _presign_image_upload(body: dict) -> dict:
    if not CONTENT_ASSETS_BUCKET:
        return _err(503, "Image uploads are not configured (missing CONTENT_ASSETS_BUCKET)")

    brief_id = body.get("brief_id", "")
    draft_id = body.get("draft_id", "")
    content_type = (body.get("content_type") or "").strip().lower()

    if not brief_id or not draft_id:
        return _err(400, "Missing brief_id or draft_id")

    if content_type not in ALLOWED_IMAGE_TYPES:
        return _err(400, "Unsupported content type; use image/jpeg, png, webp, or gif")

    sk = draft_id if str(draft_id).startswith("DRAFT#") else f"DRAFT#{draft_id}"
    if CONTENT_TABLE:
        item = _get_table(CONTENT_TABLE).get_item(Key={"pk": brief_id, "sk": sk}).get("Item")
        if not item:
            return _err(404, "Draft not found")

    ext = ALLOWED_IMAGE_TYPES[content_type]
    key = f"{STAGE}/drafts/{brief_id}/{draft_id.replace('DRAFT#', '')}/{uuid.uuid4().hex}.{ext}"

    try:
        upload_url = _s3().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": CONTENT_ASSETS_BUCKET,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=900,
            HttpMethod="PUT",
        )
    except Exception as e:
        return _err(500, f"Could not create upload URL: {e!s}")

    return _ok(
        {
            "upload_url": upload_url,
            "image_key": key,
            "content_type": content_type,
            "expires_in": 900,
        }
    )


# ── Read Actions ─────────────────────────────────────────────────────

def _list_briefs(qs: dict) -> dict:
    if not CONTENT_TABLE:
        return _ok({"briefs": [], "count": 0})
    table = _get_table(CONTENT_TABLE)
    response = table.scan(
        FilterExpression="sk = :sk",
        ExpressionAttributeValues={":sk": "BRIEF"},
    )
    items = response.get("Items", [])
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return _ok({"briefs": _sanitize(items), "count": len(items)})


def _get_brief(brief_id: str) -> dict:
    if not brief_id or not CONTENT_TABLE:
        return _err(400, "Missing brief_id")
    table = _get_table(CONTENT_TABLE)
    response = table.query(KeyConditionExpression=Key("pk").eq(brief_id))
    items = response.get("Items", [])

    brief = None
    drafts = []
    for item in items:
        if item.get("sk") == "BRIEF":
            brief = item
        elif item.get("sk", "").startswith("DRAFT#"):
            drafts.append(item)

    if not brief:
        return _err(404, "Brief not found")

    drafts.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    enriched = [_enrich_draft(_sanitize(d)) for d in drafts]
    return _ok({"brief": _sanitize(brief), "drafts": enriched})


def _update_status(body: dict) -> dict:
    brief_id = body.get("brief_id", "")
    new_status = body.get("status", "")
    sk = body.get("sk", "BRIEF")
    scheduled_date = body.get("scheduled_date")

    if not brief_id or not new_status or not CONTENT_TABLE:
        return _err(400, "Missing brief_id or status")

    if new_status == "scheduled":
        sd_raw = (scheduled_date or "").strip() if scheduled_date is not None else ""
        if not sd_raw:
            return _err(400, "scheduled_date is required when status is scheduled")

    table = _get_table(CONTENT_TABLE)
    now = datetime.now(timezone.utc).isoformat()
    expr_names = {"#s": "status"}
    expr_vals = {":s": new_status, ":u": now}
    set_parts = ["#s = :s", "updated_at = :u"]

    if scheduled_date is not None and str(scheduled_date).strip() != "":
        expr_names["#sd"] = "scheduled_date"
        expr_vals[":sd"] = _coerce_scheduled_date_iso(str(scheduled_date))
        set_parts.append("#sd = :sd")

    table.update_item(
        Key={"pk": brief_id, "sk": sk},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_vals,
    )

    # Write published content back to system-prior-content KB for future generation context
    if new_status == "published" and KB_TABLE:
        _write_to_prior_content_kb(brief_id)

    return _ok({"brief_id": brief_id, "status": new_status})


def _delete_brief(body: dict) -> dict:
    """Delete a brief plus all its drafts (and best-effort delete their S3 images).

    All items for a brief share the same `pk` in the content table (the brief
    row has sk="BRIEF", drafts have sk="DRAFT#<id>"). We query everything under
    the pk, collect any attached image_s3_key values, delete those S3 objects,
    then batch-delete the table items.
    """
    brief_id = body.get("brief_id", "")
    if not brief_id or not CONTENT_TABLE:
        return _err(400, "Missing brief_id")

    table = _get_table(CONTENT_TABLE)

    items: list[dict] = []
    last_key = None
    while True:
        kwargs = {"KeyConditionExpression": Key("pk").eq(brief_id)}
        if last_key is not None:
            kwargs["ExclusiveStartKey"] = last_key
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

    if not items:
        return _err(404, f"Brief {brief_id} not found")

    image_keys = [
        str(it.get("image_s3_key"))
        for it in items
        if isinstance(it.get("image_s3_key"), str) and it.get("image_s3_key")
    ]

    s3_deleted = 0
    s3_errors = 0
    if image_keys and CONTENT_ASSETS_BUCKET:
        client = _s3()
        for i in range(0, len(image_keys), 1000):
            batch = image_keys[i : i + 1000]
            try:
                result = client.delete_objects(
                    Bucket=CONTENT_ASSETS_BUCKET,
                    Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
                )
                s3_deleted += len(batch) - len(result.get("Errors", []))
                s3_errors += len(result.get("Errors", []))
            except ClientError:
                s3_errors += len(batch)

    with table.batch_writer() as batch:
        for it in items:
            batch.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})

    return _ok(
        {
            "brief_id": brief_id,
            "deleted_items": len(items),
            "deleted_images": s3_deleted,
            "image_delete_errors": s3_errors,
        }
    )


def _write_to_prior_content_kb(brief_id: str):
    """When content is published, store it in system-prior-content KB.

    This feeds future content generation with examples of past published work,
    improving brand consistency and reducing repetition.
    """
    try:
        from kb_client import KBClient
        client = KBClient(table_name=KB_TABLE)

        # Fetch the brief and its latest draft
        table = _get_table(CONTENT_TABLE)
        response = table.query(KeyConditionExpression=Key("pk").eq(brief_id))
        items = response.get("Items", [])

        brief = None
        latest_draft = None
        for item in items:
            if item.get("sk") == "BRIEF":
                brief = item
            elif item.get("sk", "").startswith("DRAFT#"):
                if latest_draft is None or item.get("created_at", "") > latest_draft.get("created_at", ""):
                    latest_draft = item

        if not brief or not latest_draft:
            return

        content_text = latest_draft.get("content", "")
        if not content_text:
            return

        platform = brief.get("platform", "unknown")
        topic = brief.get("topic", "general")
        audience = brief.get("audience", "general")
        tone = brief.get("tone", "")
        brand_voice = brief.get("brand_voice", "")
        hashtags = latest_draft.get("suggested_hashtags", [])

        title = f"{platform.upper()} — {topic.replace('_', ' ').title()} for {audience.replace('_', ' ').title()}"

        # Build rich entry content with metadata for better future retrieval
        entry_content = f"""Platform: {platform}
Topic: {topic.replace('_', ' ')}
Audience: {audience.replace('_', ' ')}
Tone: {tone}
Brand Voice: {brand_voice}
Published: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}
Hashtags: {', '.join(hashtags) if hashtags else 'none'}

---

{content_text}"""

        tags = [platform, topic.replace("_", "-"), audience.replace("_", "-"), "published"]

        # Use the KB API to add (which handles embedding automatically)
        _add_kb_entry(
            kb_id="system-prior-content",
            title=title,
            content=entry_content,
            tags=tags,
            source="content-pipeline",
        )
    except Exception:
        # Non-blocking — don't fail the status update if KB write fails
        pass


def _add_kb_entry(kb_id: str, title: str, content: str, tags: list, source: str):
    """Add an entry to a knowledge base with embedding.

    Uses the same embedding + storage pattern as the knowledge handler.
    """
    if not KB_TABLE:
        return

    import math

    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    embed_response = bedrock.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        contentType="application/json",
        accept="application/json",
        body=json.dumps({"inputText": f"{title}\n\n{content}"[:8000], "dimensions": 256, "normalize": True}),
    )
    embedding = json.loads(embed_response["body"].read()).get("embedding", [])

    from decimal import Decimal as D
    entry_id = f"entry-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    kb_table = _get_table(KB_TABLE)
    kb_table.put_item(Item={
        "pk": f"KB#{kb_id}",
        "sk": entry_id,
        "entryType": "reference",
        "title": title,
        "content": content,
        "tags": tags,
        "source": source,
        "userId": "content-agent",
        "embedding": [D(str(round(v, 8))) for v in embedding],
        "createdAt": now,
        "updatedAt": now,
    })

    # Update entry count in registry
    try:
        kb_table.update_item(
            Key={"pk": "KB#REGISTRY", "sk": kb_id},
            UpdateExpression="SET entryCount = if_not_exists(entryCount, :zero) + :one",
            ExpressionAttributeValues={":one": 1, ":zero": 0},
        )
    except Exception:
        pass


def _list_calendar(qs: dict) -> dict:
    if not CONTENT_TABLE:
        return _ok({"slots": [], "count": 0})
    table = _get_table(CONTENT_TABLE)
    items = []
    scan_kwargs = {
        "FilterExpression": "sk = :sk AND scheduled_date <> :empty",
        "ExpressionAttributeValues": {":sk": "BRIEF", ":empty": ""},
    }
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        lek = response.get("LastEvaluatedKey")
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    items.sort(key=lambda x: x.get("scheduled_date", ""))
    return _ok({"slots": _sanitize(items), "count": len(items)})


def _scheduled_fire_time_utc(stored: str | None, now_utc: datetime) -> bool:
    """Stored ISO vs now UTC — True once go-live instant has arrived."""
    coerced = _coerce_scheduled_date_iso(stored if stored is not None else "")
    if not coerced:
        return False
    try:
        suf = coerced[:-1] + "+00:00" if coerced.endswith("Z") else coerced
        dt = datetime.fromisoformat(suf.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt <= now_utc
    except ValueError:
        return False


def process_scheduled_linkedin_posts(max_per_run: int = 20) -> dict:
    """EventBridge: scheduled LinkedIn briefs past due use the same logic as manual post_to_linkedin."""
    if not CONTENT_TABLE:
        body = {"ok": False, "message": "CONTENT_TABLE not configured"}
        return {"statusCode": 500, "body": json.dumps(body)}

    now_utc = datetime.now(timezone.utc)
    table = _get_table(CONTENT_TABLE)

    scanned: list[dict] = []
    start_key = None
    filt = "sk = :b AND attribute_exists(scheduled_date) AND scheduled_date <> :empty"
    while True:
        kwargs: dict = {
            "FilterExpression": filt,
            "ExpressionAttributeValues": {":b": "BRIEF", ":empty": ""},
        }
        if start_key:
            kwargs["ExclusiveStartKey"] = start_key
        resp = table.scan(**kwargs)
        scanned.extend(resp.get("Items", []))
        start_key = resp.get("LastEvaluatedKey")
        if not start_key:
            break

    due: list[str] = []
    seen_brief: set[str] = set()
    for brief in scanned:
        if str(brief.get("status", "")).strip().lower() != "scheduled":
            continue
        if str(brief.get("platform", "")).strip().lower() != "linkedin":
            continue
        sd = brief.get("scheduled_date")
        if sd is None or str(sd).strip() == "":
            continue
        if not _scheduled_fire_time_utc(str(sd).strip(), now_utc):
            continue
        bid = str(brief.get("pk", "")).strip()
        if bid and bid not in seen_brief:
            seen_brief.add(bid)
            due.append(bid)

    processed: list[dict] = []
    for brief_id in due[:max_per_run]:
        row = table.get_item(Key={"pk": brief_id, "sk": "BRIEF"}).get("Item") or {}
        urn = str(row.get("linkedin_last_post_urn", "")).strip()
        # Dev dead-end / first run: allow publish. Real LinkedIn URN: do not double-post to prod.
        force = (not urn) or ("deadend" in urn.lower())

        resp_post = _post_to_linkedin(
            {
                "brief_id": brief_id,
                "draft_id": "",
                "mark_published": True,
                "force": force,
            },
        )
        code = resp_post.get("statusCode", 500)
        try:
            parsed = json.loads(resp_post.get("body", "{}"))
        except json.JSONDecodeError:
            parsed = {"parse_error": True}
        processed.append({"brief_id": brief_id, "statusCode": code, "force": force, "response": parsed})
        if code != 200:
            err = (parsed or {}).get("error", {}).get("message") if isinstance(parsed, dict) else None
            print(
                json.dumps(
                    {
                        "level": "WARN",
                        "scheduled_autopublish": brief_id,
                        "statusCode": code,
                        "force": force,
                        "error": err or str(parsed)[:500],
                    },
                ),
            )

    summary = {"ok": True, "due_count": len(due), "invoked": len(processed), "now_utc": now_utc.isoformat()}
    print(json.dumps(summary))
    return {
        "statusCode": 200,
        "body": json.dumps({"summary": summary, "runs": processed}, default=str),
    }


# ── Helpers ──────────────────────────────────────────────────────────

def _sanitize(data):
    if isinstance(data, list):
        return [_sanitize(i) for i in data]
    if isinstance(data, dict):
        return {k: _sanitize(v) for k, v in data.items()}
    if isinstance(data, Decimal):
        return int(data) if data == int(data) else float(data)
    return data


def _ok(body: dict) -> dict:
    return _response(200, body)


def _err(status: int, message: str) -> dict:
    return _response(status, {"error": {"code": f"CONTENT_{status}", "message": message}})


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }


# ── Router ───────────────────────────────────────────────────────────

def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        qs = event.get("queryStringParameters") or {}
        action = qs.get("action", "status")
        if action == "status":
            return _ok({"message": "Content Agent API", "status": "ok"})
        if action == "list_briefs":
            return _list_briefs(qs)
        if action == "get_brief":
            return _get_brief(qs.get("id", ""))
        if action == "list_calendar":
            return _list_calendar(qs)
        return _ok({"message": "Content Agent API", "status": "ok"})

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")
        if action == "create_brief":
            return _create_brief(body)
        if action == "generate_draft":
            return _generate_draft(body)
        if action == "update_status":
            return _update_status(body)
        if action == "update_draft":
            return _update_draft(body)
        if action == "presign_image_upload":
            return _presign_image_upload(body)
        if action == "post_to_linkedin":
            return _post_to_linkedin(body)
        if action == "delete_brief":
            return _delete_brief(body)
        return _err(400, f"Unknown action: {action}")

    return _err(405, "Method not allowed")
