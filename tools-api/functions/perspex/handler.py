"""
Perspex — Cooperation Acceleration Engine (BFPM Pipeline)
Beacon → Focus → Perspex → Move

Each stage uses Bedrock Converse API for AI synthesis.
Single Lambda, action-based routing via API Gateway.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

REGION = os.environ.get("AWS_REGION", "us-east-1")
SESSIONS_TABLE = os.environ.get("PERSPEX_SESSIONS_TABLE", "")
MODEL_ID = os.environ.get("PERSPEX_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

_ddb = None
_bedrock = None


def _get_ddb():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb", region_name=REGION)
    return _ddb


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    return _bedrock


def _table():
    return _get_ddb().Table(SESSIONS_TABLE)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _uuid():
    return str(uuid.uuid4())


# ── Bedrock helpers ─────────────────────────────────────────────────

def _call_bedrock(prompt: str, max_tokens: int = 2000, temperature: float = 0.7) -> str:
    try:
        resp = _get_bedrock().converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
        )
        return resp["output"]["message"]["content"][0]["text"]
    except Exception as e:
        return f"[Bedrock unavailable] Error: {str(e)}"


def _call_bedrock_json(prompt: str, max_tokens: int = 2000) -> dict:
    raw = _call_bedrock(prompt, max_tokens, temperature=0.3)
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]  # drop ```json
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        start = cleaned.index("{")
        end = cleaned.rindex("}") + 1
        return json.loads(cleaned[start:end])
    except (ValueError, json.JSONDecodeError):
        return {"raw": raw, "parse_error": True}


# ── DynamoDB helpers ────────────────────────────────────────────────

def _put_item(item: dict):
    cleaned = json.loads(json.dumps(item, default=str), parse_float=Decimal)
    _table().put_item(Item=cleaned)


def _get_session(session_id: str) -> dict | None:
    resp = _table().get_item(Key={"pk": f"SESSION#{session_id}", "sk": "META"})
    return resp.get("Item")


def _get_stage_data(session_id: str, stage: str) -> dict | None:
    resp = _table().get_item(Key={"pk": f"SESSION#{session_id}", "sk": f"STAGE#{stage}"})
    return resp.get("Item")


def _get_stage_history(session_id: str, stage: str) -> list:
    """Get all versions of a stage (v1, v2, etc.)."""
    return _query_items(session_id, f"HISTORY#{stage}#")


def _query_items(session_id: str, sk_prefix: str) -> list:
    resp = _table().query(
        KeyConditionExpression=Key("pk").eq(f"SESSION#{session_id}") & Key("sk").begins_with(sk_prefix)
    )
    return resp.get("Items", [])


def _save_version(session_id: str, stage: str, version: int, data: dict, feedback: str = ""):
    """Store a versioned snapshot of a stage result + optional facilitator feedback."""
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": f"HISTORY#{stage}#v{version}",
        "sessionId": session_id,
        "stage": stage,
        "version": version,
        "data": data,
        "feedback": feedback,
        "createdAt": _now(),
    }
    _put_item(item)


def _get_current_version(session_id: str, stage: str) -> int:
    """Get the latest version number for a stage."""
    history = _get_stage_history(session_id, stage)
    if not history:
        return 0
    return max(int(h.get("version", 0)) for h in history)


# ── Stage transitions ───────────────────────────────────────────────

STAGE_ORDER = ["beacon", "focus", "perspex", "move", "completed"]


def _advance_session(session_id: str, current_stage: str):
    idx = STAGE_ORDER.index(current_stage)
    if idx + 1 < len(STAGE_ORDER):
        next_stage = STAGE_ORDER[idx + 1]
        _table().update_item(
            Key={"pk": f"SESSION#{session_id}", "sk": "META"},
            UpdateExpression="SET #s = :s, updated_at = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": next_stage, ":u": _now()},
        )
        return next_stage
    return current_stage


# ── Session CRUD ────────────────────────────────────────────────────

def _create_session(body: dict) -> dict:
    session_id = _uuid()
    title = body.get("title", "Untitled Session")
    session_type = body.get("sessionType", "strategic")
    participants = body.get("participants", [])

    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "META",
        "sessionId": session_id,
        "title": title,
        "sessionType": session_type,
        "status": "beacon",
        "participants": participants,
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    _put_item(item)
    return _ok({"sessionId": session_id, "title": title, "sessionType": session_type, "status": "beacon"})


def _list_sessions(qs: dict) -> dict:
    limit = int(qs.get("limit", "20"))
    table = _table()

    scan_kwargs = {"FilterExpression": Key("sk").eq("META"), "Limit": min(limit, 100)}
    last_key = qs.get("lastEvaluatedKey")
    if last_key:
        scan_kwargs["ExclusiveStartKey"] = json.loads(last_key)

    resp = table.scan(**scan_kwargs)
    items = resp.get("Items", [])

    sessions = sorted(items, key=lambda x: x.get("createdAt", ""), reverse=True)

    result = {
        "sessions": sessions,
        "hasMore": "LastEvaluatedKey" in resp,
        "limit": limit,
    }
    if "LastEvaluatedKey" in resp:
        result["lastEvaluatedKey"] = json.dumps(resp["LastEvaluatedKey"], default=str)

    return _ok(result)


def _get_session_full(session_id: str) -> dict:
    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    beacon = _get_stage_data(session_id, "beacon")
    focus = _get_stage_data(session_id, "focus")
    perspex_inputs = _query_items(session_id, "PERSPEX_INPUT#")
    perspex_summary = _get_stage_data(session_id, "perspex_summary")
    action_plan = _get_stage_data(session_id, "action_plan")

    return _ok({
        "session": session,
        "beacon": beacon,
        "focus": focus,
        "perspexInputs": perspex_inputs,
        "perspexSummary": perspex_summary,
        "actionPlan": action_plan,
    })


def _get_session_participant(session_id: str, participant_id: str = "") -> dict:
    """Participant view — no raw inputs, only synthesized output + own submission status."""
    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    beacon = _get_stage_data(session_id, "beacon")
    focus = _get_stage_data(session_id, "focus")
    perspex_inputs = _query_items(session_id, "PERSPEX_INPUT#")
    perspex_summary = _get_stage_data(session_id, "perspex_summary")
    action_plan = _get_stage_data(session_id, "action_plan")

    has_submitted = False
    if participant_id:
        has_submitted = any(
            inp.get("participantId") == participant_id for inp in perspex_inputs
        )

    safe_session = {
        "sessionId": session.get("sessionId"),
        "title": session.get("title"),
        "sessionType": session.get("sessionType"),
        "status": session.get("status"),
        "createdAt": session.get("createdAt"),
    }

    return _ok({
        "session": safe_session,
        "beacon": {
            "statement": beacon.get("statement", ""),
            "timeframe": beacon.get("timeframe", ""),
            "confidence": float(beacon.get("confidence", 0)),
            "tags": beacon.get("tags", []),
        } if beacon else None,
        "focus": {
            "challengeText": focus.get("challengeText", ""),
            "tags": focus.get("tags", []),
        } if focus else None,
        "perspexStatus": {
            "totalSubmitted": len(perspex_inputs),
            "hasSubmitted": has_submitted,
        },
        "perspexSummary": {
            "commonGround": perspex_summary.get("commonGround", []),
            "tensions": perspex_summary.get("tensions", []),
            "mergedChallenge": perspex_summary.get("mergedChallenge", ""),
            "generalizedRisks": perspex_summary.get("generalizedRisks", []),
        } if perspex_summary else None,
        "actionPlan": {
            "objectives": action_plan.get("objectives", []),
            "owners": action_plan.get("owners", []),
            "timeframe": action_plan.get("timeframe", ""),
            "supportLevel": action_plan.get("supportLevel", ""),
            "summary": action_plan.get("summary", ""),
        } if action_plan else None,
    })



# ── Stage 1: Beacon ────────────────────────────────────────────────

def _create_beacon(body: dict) -> dict:
    session_id = body.get("sessionId")
    inputs = body.get("participantInputs", [])
    session_type = body.get("sessionType", "strategic")

    if not session_id or not inputs:
        return _err(400, "sessionId and participantInputs required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    prompt = f"""You are a facilitation AI for the Perspex cooperation engine.

TASK: Synthesize these future-state visions into a single, clear beacon statement.

Session type: {session_type}
Participant visions:
{chr(10).join(f"- {v}" for v in inputs)}

Return JSON:
{{
  "statement": "A single synthesized future-state vision (1-2 sentences)",
  "timeframe": "Estimated timeframe for this vision (e.g., '6 months', '1 year')",
  "confidence": 0.0 to 1.0 confidence that participants share this vision,
  "tags": ["3-5 thematic tags extracted from the inputs"]
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        result = {"statement": " ".join(inputs), "timeframe": "6 months", "confidence": 0.7, "tags": []}

    beacon_id = _uuid()
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "STAGE#beacon",
        "beaconId": beacon_id,
        "sessionId": session_id,
        "statement": result.get("statement", ""),
        "timeframe": result.get("timeframe", "6 months"),
        "confidence": Decimal(str(result.get("confidence", 0.7))),
        "tags": result.get("tags", []),
        "rawInputs": inputs,
        "createdAt": _now(),
    }
    _put_item(item)
    _save_version(session_id, "beacon", 1, {
        "statement": result.get("statement", ""),
        "timeframe": result.get("timeframe", "6 months"),
        "confidence": result.get("confidence", 0.7),
        "tags": result.get("tags", []),
        "rawInputs": inputs,
    })
    _advance_session(session_id, "beacon")

    return _ok({
        "beaconId": beacon_id,
        "statement": item["statement"],
        "timeframe": item["timeframe"],
        "confidence": float(item["confidence"]),
        "tags": item["tags"],
        "version": 1,
    })


# ── Stage 1b: Refine Beacon ────────────────────────────────────────

def _refine_beacon(body: dict) -> dict:
    session_id = body.get("sessionId")
    feedback = body.get("feedback", "")

    if not session_id or not feedback:
        return _err(400, "sessionId and feedback required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    beacon = _get_stage_data(session_id, "beacon")
    if not beacon:
        return _err(400, "No beacon to refine — create one first")

    current_version = _get_current_version(session_id, "beacon")
    new_version = current_version + 1
    old_statement = beacon.get("statement", "")

    _save_version(session_id, "beacon_feedback", new_version, {"feedback": feedback}, feedback)

    # Check what downstream stages exist
    focus = _get_stage_data(session_id, "focus")
    perspex_summary = _get_stage_data(session_id, "perspex_summary")
    action_plan = _get_stage_data(session_id, "action_plan")

    prompt = f"""You are a facilitation AI for the Perspex cooperation engine. You are having a conversation with the facilitator to get the beacon statement right.

TASK: Refine the beacon statement based on facilitator feedback.

Current beacon statement: {old_statement}
Current timeframe: {beacon.get("timeframe", "")}
Current confidence: {beacon.get("confidence", 0.7)}
Current tags: {json.dumps(beacon.get("tags", []))}

Original participant inputs: {json.dumps(beacon.get("rawInputs", []))}

Facilitator feedback: {feedback}

Rules:
- Incorporate the feedback while staying true to the original participant inputs
- If the facilitator says "emphasize X more", shift the statement toward X
- If the facilitator says "not quite right", rework the synthesis
- Adjust confidence based on how well the refinement aligns
- In changeNotes, explain conversationally what you changed and why — speak directly to the facilitator

Return JSON:
{{
  "statement": "Refined future-state vision (1-2 sentences)",
  "timeframe": "Estimated timeframe",
  "confidence": 0.0 to 1.0,
  "tags": ["3-5 thematic tags"],
  "changeNotes": "A 1-3 sentence conversational explanation of what you changed and why, addressed to the facilitator"
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        return _err(500, "AI refinement failed — try rephrasing your feedback")

    _table().update_item(
        Key={"pk": f"SESSION#{session_id}", "sk": "STAGE#beacon"},
        UpdateExpression="SET statement = :s, timeframe = :t, confidence = :c, tags = :tg, updatedAt = :u, version = :v",
        ExpressionAttributeValues={
            ":s": result.get("statement", ""),
            ":t": result.get("timeframe", "6 months"),
            ":c": Decimal(str(result.get("confidence", 0.7))),
            ":tg": result.get("tags", []),
            ":u": _now(),
            ":v": new_version,
        },
    )

    _save_version(session_id, "beacon", new_version, {
        "statement": result.get("statement", ""),
        "timeframe": result.get("timeframe", "6 months"),
        "confidence": result.get("confidence", 0.7),
        "tags": result.get("tags", []),
        "feedback": feedback,
        "changeNotes": result.get("changeNotes", ""),
    }, feedback)

    # Flag downstream stages as stale
    stale_stages = []
    if focus:
        stale_stages.append("focus")
    if perspex_summary:
        stale_stages.append("perspex")
    if action_plan:
        stale_stages.append("move")

    return _ok({
        "statement": result.get("statement", ""),
        "timeframe": result.get("timeframe", "6 months"),
        "confidence": float(Decimal(str(result.get("confidence", 0.7)))),
        "tags": result.get("tags", []),
        "version": new_version,
        "refinedFrom": feedback,
        "changeNotes": result.get("changeNotes", ""),
        "previousStatement": old_statement,
        "staleDownstream": stale_stages,
    })


# ── Stage 2: Focus ──────────────────────────────────────────────────

def _create_focus(body: dict) -> dict:
    session_id = body.get("sessionId")
    beacon_id = body.get("beaconId")
    statements = body.get("participantStatements", [])

    if not session_id or not statements:
        return _err(400, "sessionId and participantStatements required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    beacon = _get_stage_data(session_id, "beacon")
    beacon_context = beacon.get("statement", "") if beacon else ""

    prompt = f"""You are a facilitation AI for the Perspex cooperation engine.

TASK: Merge these individual problem statements into a single shared challenge.

Beacon context (the future vision): {beacon_context}

Participant challenge statements:
{chr(10).join(f"- {s}" for s in statements)}

Rules:
- Normalize into a "How might we..." format
- Detect similarity across statements and merge overlapping ideas
- Keep the merged challenge concise (1-2 sentences)
- Extract thematic tags

Return JSON:
{{
  "challengeText": "How might we... (merged challenge statement)",
  "tags": ["3-5 thematic tags"],
  "mergeNotes": "Brief explanation of how statements were merged"
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        result = {"challengeText": statements[0] if statements else "", "tags": statements, "mergeNotes": ""}

    focus_id = _uuid()
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "STAGE#focus",
        "focusId": focus_id,
        "sessionId": session_id,
        "beaconId": beacon_id or "",
        "challengeText": result.get("challengeText", ""),
        "tags": result.get("tags", []),
        "mergeNotes": result.get("mergeNotes", ""),
        "rawStatements": statements,
        "createdAt": _now(),
    }
    _put_item(item)
    _save_version(session_id, "focus", 1, {
        "challengeText": result.get("challengeText", ""),
        "tags": result.get("tags", []),
        "mergeNotes": result.get("mergeNotes", ""),
        "rawStatements": statements,
    })
    _advance_session(session_id, "focus")

    return _ok({
        "focusId": focus_id,
        "challengeText": item["challengeText"],
        "tags": item["tags"],
        "mergeNotes": item["mergeNotes"],
        "version": 1,
    })


# ── Stage 2b: Refine Focus ─────────────────────────────────────────

def _refine_focus(body: dict) -> dict:
    session_id = body.get("sessionId")
    feedback = body.get("feedback", "")

    if not session_id or not feedback:
        return _err(400, "sessionId and feedback required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    focus = _get_stage_data(session_id, "focus")
    if not focus:
        return _err(400, "No focus to refine — create one first")

    beacon = _get_stage_data(session_id, "beacon")
    beacon_text = beacon.get("statement", "") if beacon else ""
    old_challenge = focus.get("challengeText", "")

    current_version = _get_current_version(session_id, "focus")
    new_version = current_version + 1

    _save_version(session_id, "focus_feedback", new_version, {"feedback": feedback}, feedback)

    # Check downstream stages
    perspex_summary = _get_stage_data(session_id, "perspex_summary")
    action_plan = _get_stage_data(session_id, "action_plan")

    prompt = f"""You are a facilitation AI for the Perspex cooperation engine. You are having a conversation with the facilitator to get the focus challenge right.

TASK: Refine the focus challenge statement based on facilitator feedback.

Current challenge: {old_challenge}
Current tags: {json.dumps(focus.get("tags", []))}
Beacon context: {beacon_text}

Original participant statements: {json.dumps(focus.get("rawStatements", []))}

Facilitator feedback: {feedback}

Rules:
- Incorporate the feedback while staying true to the original participant statements
- Keep the "How might we..." format
- Adjust tags if the focus has shifted
- Be concise (1-2 sentences)
- In changeNotes, explain conversationally what you changed and why — speak directly to the facilitator

Return JSON:
{{
  "challengeText": "How might we... (refined challenge)",
  "tags": ["3-5 thematic tags"],
  "mergeNotes": "Brief note on what changed in this refinement",
  "changeNotes": "A 1-3 sentence conversational explanation of what you changed and why, addressed to the facilitator"
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        return _err(500, "AI refinement failed — try rephrasing your feedback")

    _table().update_item(
        Key={"pk": f"SESSION#{session_id}", "sk": "STAGE#focus"},
        UpdateExpression="SET challengeText = :c, tags = :tg, mergeNotes = :mn, updatedAt = :u, version = :v",
        ExpressionAttributeValues={
            ":c": result.get("challengeText", ""),
            ":tg": result.get("tags", []),
            ":mn": result.get("mergeNotes", ""),
            ":u": _now(),
            ":v": new_version,
        },
    )

    _save_version(session_id, "focus", new_version, {
        "challengeText": result.get("challengeText", ""),
        "tags": result.get("tags", []),
        "mergeNotes": result.get("mergeNotes", ""),
        "feedback": feedback,
        "changeNotes": result.get("changeNotes", ""),
    }, feedback)

    # Flag downstream stages as stale
    stale_stages = []
    if perspex_summary:
        stale_stages.append("perspex")
    if action_plan:
        stale_stages.append("move")

    return _ok({
        "challengeText": result.get("challengeText", ""),
        "tags": result.get("tags", []),
        "mergeNotes": result.get("mergeNotes", ""),
        "version": new_version,
        "refinedFrom": feedback,
        "changeNotes": result.get("changeNotes", ""),
        "previousChallenge": old_challenge,
        "staleDownstream": stale_stages,
    })


# ── Stage History Query ─────────────────────────────────────────────

def _get_stage_history_action(qs: dict) -> dict:
    session_id = qs.get("sessionId", "")
    stage = qs.get("stage", "")
    if not session_id or not stage:
        return _err(400, "sessionId and stage required")

    history = _get_stage_history(session_id, stage)
    feedback_history = _get_stage_history(session_id, f"{stage}_feedback")

    versions = sorted(history, key=lambda x: int(x.get("version", 0)))
    feedbacks = sorted(feedback_history, key=lambda x: int(x.get("version", 0)))

    return _ok({
        "sessionId": session_id,
        "stage": stage,
        "versions": [{
            "version": int(v.get("version", 0)),
            "data": v.get("data", {}),
            "feedback": v.get("feedback", ""),
            "createdAt": v.get("createdAt", ""),
        } for v in versions],
        "feedbacks": [{
            "version": int(f.get("version", 0)),
            "feedback": f.get("data", {}).get("feedback", ""),
            "createdAt": f.get("createdAt", ""),
        } for f in feedbacks],
    })


# ── Stage 3a: Perspex Input ────────────────────────────────────────

def _add_perspex_input(body: dict) -> dict:
    session_id = body.get("sessionId")
    participant_id = body.get("participantId", _uuid())
    top3 = body.get("top3", [])
    risk = body.get("risk", "")

    if not session_id or len(top3) < 1 or not risk:
        return _err(400, "sessionId, top3 (array), and risk required")

    prompt = f"""Classify this perspective input as one of: individual, systemic, strategic.

Top 3 insights: {json.dumps(top3)}
Risk: {risk}

Return JSON: {{"level": "individual|systemic|strategic"}}
Return ONLY valid JSON."""

    level_result = _call_bedrock_json(prompt, max_tokens=100)
    level = level_result.get("level", "individual")

    input_id = _uuid()
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": f"PERSPEX_INPUT#{input_id}",
        "inputId": input_id,
        "sessionId": session_id,
        "participantId": participant_id,
        "top3": top3,
        "risk": risk,
        "level": level,
        "createdAt": _now(),
    }
    _put_item(item)

    return _ok({"inputId": input_id, "level": level})


# ── Stage 3b: Perspex Summary (AI Synthesis) ───────────────────────

def _create_perspex_summary(body: dict) -> dict:
    session_id = body.get("sessionId")
    if not session_id:
        return _err(400, "sessionId required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    beacon = _get_stage_data(session_id, "beacon")
    focus = _get_stage_data(session_id, "focus")
    inputs = _query_items(session_id, "PERSPEX_INPUT#")

    if not inputs:
        return _err(400, "No perspex inputs collected yet")

    beacon_text = beacon.get("statement", "Not set") if beacon else "Not set"
    focus_text = focus.get("challengeText", "Not set") if focus else "Not set"

    inputs_text = ""
    for i, inp in enumerate(inputs, 1):
        inputs_text += f"\nParticipant {i} (level: {inp.get('level', 'unknown')}):\n"
        inputs_text += f"  Top 3: {json.dumps(inp.get('top3', []))}\n"
        inputs_text += f"  Risk: {inp.get('risk', '')}\n"

    prompt = f"""You are the Perspex synthesis engine — a facilitation AI that merges multiple perspectives into shared clarity.

CONTEXT:
- Beacon (future vision): {beacon_text}
- Focus (shared challenge): {focus_text}

PARTICIPANT INPUTS:
{inputs_text}

TASK: Synthesize all perspectives into a unified understanding.

Rules:
- Identify what everyone agrees on (common ground)
- Surface where views diverge (tensions) — be specific, not vague
- Merge the challenge into a refined statement that incorporates all perspectives
- Generalize the individual risks into 3 systemic risks
- Be neutral, concise, and actionable

Return JSON:
{{
  "commonGround": ["3-5 points of agreement"],
  "tensions": ["2-4 specific points of divergence"],
  "mergedChallenge": "A refined challenge statement incorporating all perspectives",
  "generalizedRisks": ["3 systemic risks derived from individual risks"]
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        result = {
            "commonGround": [],
            "tensions": [],
            "mergedChallenge": focus_text,
            "generalizedRisks": [inp.get("risk", "") for inp in inputs[:3]],
        }

    summary_id = _uuid()
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "STAGE#perspex_summary",
        "summaryId": summary_id,
        "sessionId": session_id,
        "beaconId": beacon.get("beaconId", "") if beacon else "",
        "focusId": focus.get("focusId", "") if focus else "",
        "commonGround": result.get("commonGround", []),
        "tensions": result.get("tensions", []),
        "mergedChallenge": result.get("mergedChallenge", ""),
        "generalizedRisks": result.get("generalizedRisks", []),
        "inputCount": len(inputs),
        "createdAt": _now(),
    }
    _put_item(item)
    _advance_session(session_id, "perspex")

    return _ok({
        "summaryId": summary_id,
        "commonGround": item["commonGround"],
        "tensions": item["tensions"],
        "mergedChallenge": item["mergedChallenge"],
        "generalizedRisks": item["generalizedRisks"],
    })


# ── Stage 4: Move (Action Plan) ────────────────────────────────────

def _create_action_plan(body: dict) -> dict:
    session_id = body.get("sessionId")
    timeframe = body.get("timeframe", "30 days")
    support_level = body.get("supportLevel", "medium")

    if not session_id:
        return _err(400, "sessionId required")

    session = _get_session(session_id)
    if not session:
        return _err(404, "Session not found")

    summary = _get_stage_data(session_id, "perspex_summary")
    beacon = _get_stage_data(session_id, "beacon")
    focus = _get_stage_data(session_id, "focus")

    beacon_text = beacon.get("statement", "Not set") if beacon else "Not set"
    focus_text = focus.get("challengeText", "Not set") if focus else "Not set"

    summary_text = ""
    if summary:
        summary_text = f"""Common Ground: {json.dumps(summary.get('commonGround', []))}
Tensions: {json.dumps(summary.get('tensions', []))}
Merged Challenge: {summary.get('mergedChallenge', '')}
Risks: {json.dumps(summary.get('generalizedRisks', []))}"""
    else:
        summary_text = "No perspex summary available"

    participants = session.get("participants", [])
    participant_text = ", ".join(participants) if participants else "Team members (unspecified)"

    prompt = f"""You are the Move engine — the action generation stage of the Perspex cooperation system.

CONTEXT:
- Beacon (vision): {beacon_text}
- Focus (challenge): {focus_text}
- Perspex Summary:
{summary_text}
- Timeframe: {timeframe}
- Support level: {support_level}
- Participants: {participant_text}

TASK: Generate a concrete action plan.

Rules:
- 3-5 specific, measurable objectives
- Assign provisional owners (use participant names if available, otherwise role-based)
- Each objective should be achievable within the timeframe
- Scale ambition to the support level (low=quick wins, high=transformative)
- Be specific and actionable, not vague

Return JSON:
{{
  "objectives": ["3-5 specific objectives"],
  "owners": ["Provisional owner for each objective"],
  "timeframe": "{timeframe}",
  "supportLevel": "{support_level}",
  "summary": "A 2-sentence human-readable summary of the plan"
}}

Return ONLY valid JSON, no markdown."""

    result = _call_bedrock_json(prompt)
    if result.get("parse_error"):
        result = {
            "objectives": ["Define next steps based on alignment session"],
            "owners": ["Team"],
            "timeframe": timeframe,
            "supportLevel": support_level,
            "summary": "Action plan generation encountered an issue. Review session data manually.",
        }

    plan_id = _uuid()
    item = {
        "pk": f"SESSION#{session_id}",
        "sk": "STAGE#action_plan",
        "planId": plan_id,
        "sessionId": session_id,
        "objectives": result.get("objectives", []),
        "owners": result.get("owners", []),
        "timeframe": result.get("timeframe", timeframe),
        "supportLevel": result.get("supportLevel", support_level),
        "summary": result.get("summary", ""),
        "createdAt": _now(),
    }
    _put_item(item)
    _advance_session(session_id, "move")

    return _ok({
        "planId": plan_id,
        "objectives": item["objectives"],
        "owners": item["owners"],
        "timeframe": item["timeframe"],
        "supportLevel": item["supportLevel"],
        "summary": item["summary"],
    })


# ── Response helpers ────────────────────────────────────────────────

def _ok(body: dict) -> dict:
    return _response(200, {"success": True, "data": body})


def _err(status: int, message: str) -> dict:
    return _response(status, {"success": False, "error": message})


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, default=str),
    }


# ── Main handler ────────────────────────────────────────────────────

def handler(event, context):
    method = event.get("httpMethod", "GET")
    path = event.get("path", "")
    qs = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return _ok({"message": "ok"})

    if method == "GET":
        action = qs.get("action", "status")

        if action == "status":
            return _ok({"service": "Perspex Cooperation Engine", "version": "2.0", "status": "ok"})
        if action == "list_sessions":
            return _list_sessions(qs)
        if action == "get_session":
            session_id = qs.get("sessionId", "")
            if not session_id:
                return _err(400, "sessionId required")
            return _get_session_full(session_id)
        if action == "get_session_participant":
            session_id = qs.get("sessionId", "")
            participant_id = qs.get("participantId", "")
            if not session_id:
                return _err(400, "sessionId required")
            return _get_session_participant(session_id, participant_id)
        if action == "get_stage_history":
            return _get_stage_history_action(qs)

        return _ok({"service": "Perspex Cooperation Engine", "version": "2.0", "status": "ok"})

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")

        if action == "create_session":
            return _create_session(body)
        if action == "create_beacon":
            return _create_beacon(body)
        if action == "refine_beacon":
            return _refine_beacon(body)
        if action == "create_focus":
            return _create_focus(body)
        if action == "refine_focus":
            return _refine_focus(body)
        if action == "add_perspex_input":
            return _add_perspex_input(body)
        if action == "create_perspex_summary":
            return _create_perspex_summary(body)
        if action == "create_action_plan":
            return _create_action_plan(body)

        return _err(400, f"Unknown action: {action}")

    return _err(405, "Method not allowed")
