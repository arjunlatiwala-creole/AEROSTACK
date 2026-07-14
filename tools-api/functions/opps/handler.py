"""Opps Tools Lambda handler."""
import json
import os
import urllib.request
import urllib.error

_cached_pat = None


def _get_hubspot_pat():
    global _cached_pat
    if _cached_pat:
        return _cached_pat

    secret_name = os.environ.get("HUBSPOT_SECRET_NAME", "")
    if not secret_name:
        raise RuntimeError("HUBSPOT_SECRET_NAME not configured")

    import boto3
    client = boto3.client("secretsmanager")
    resp = client.get_secret_value(SecretId=secret_name)
    parsed = json.loads(resp["SecretString"])
    pat = parsed.get("hubspot_pat", "")
    if not pat:
        raise RuntimeError("hubspot_pat not found in secret")
    _cached_pat = pat
    return _cached_pat


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {"message": "Opps Tools API", "status": "ok"})

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")

        if action == "score_deal":
            return _score_deal(body)
        if action == "win_rate":
            return _win_rate(body)
        if action == "pipeline_coverage":
            return _pipeline_coverage(body)
        if action == "create_opp":
            return _create_opp(body)
        if action == "list_pipelines":
            return _list_pipelines()

        return _response(400, {"error": f"Unknown action: {action}"})

    return _response(405, {"error": "Method not allowed"})


def _list_pipelines():
    """Fetch all deal pipelines and their stages from HubSpot."""
    try:
        token = _get_hubspot_pat()
    except RuntimeError as exc:
        return _response(500, {"error": str(exc)})

    req = urllib.request.Request(
        "https://api.hubapi.com/crm/v3/pipelines/deals",
        headers={
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            hs_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        return _response(e.code, {"error": f"HubSpot API error: {error_body}"})

    pipelines = []
    for p in hs_data.get("results", []):
        stages = []
        for s in p.get("stages", []):
            stages.append({
                "id": s.get("id"),
                "label": s.get("label"),
                "display_order": s.get("displayOrder", 0),
            })
        stages.sort(key=lambda x: x["display_order"])
        pipelines.append({
            "id": p.get("id"),
            "label": p.get("label"),
            "stages": stages,
        })

    return _response(200, {"pipelines": pipelines})


def _create_opp(body):
    opp = body.get("opp", {})

    required = ["enterprise_owner", "customer", "opportunity_name", "next_step_date"]
    missing = [f for f in required if not opp.get(f)]
    if missing:
        return _response(400, {"error": f"Missing required fields: {', '.join(missing)}"})

    if opp.get("opp_class") == "RevGen" and not opp.get("est_revenue"):
        return _response(400, {"error": "Est. Revenue required for RevGen opps"})

    try:
        token = _get_hubspot_pat()
    except RuntimeError as exc:
        return _response(500, {"error": str(exc)})

    portal_id = os.environ.get("HUBSPOT_PORTAL_ID", "")

    deal_name = f"{opp['customer']} - {opp['opportunity_name']}"
    amount = str(opp.get("est_revenue", 0) or 0)

    # Use pipeline_id and dealstage_id from the payload if provided
    pipeline_id = opp.get("pipeline_id", "")
    dealstage = opp.get("dealstage_id", "")

    # Fallback to lifecycle-based stage mapping if no explicit stage provided
    if not dealstage:
        lifecycle = opp.get("lifecycle", "Lead")
        stage_map = {
            "Lead": "appointmentscheduled",
            "Developing": "qualifiedtobuy",
            "Ready for Signature": "presentationscheduled",
            "Funding-Ready": "decisionmakerboughtin",
            "Closed": "closedwon",
        }
        dealstage = stage_map.get(lifecycle, "appointmentscheduled")

    notes_parts = []
    field_labels = {
        "opp_class": "Opp Class",
        "enterprise_owner": "enterprise Owner",
        "customer_owner": "Customer Owner",
        "lifecycle": "Aerostack Lifecycle",
        "verbal_contours_confirmed": "Verbal Contours",
        "funding_needed": "Funding Needed",
        "funding_status": "Funding Status",
        "next_step": "Next Step",
        "next_step_owner": "Next Step Owner",
        "next_step_date": "Next Step Date",
        "notes": "Notes",
    }
    for key, label in field_labels.items():
        val = opp.get(key)
        if val:
            notes_parts.append(f"{label}: {val}")

    properties = {
        "dealname": deal_name,
        "amount": amount,
        "dealstage": dealstage,
        "description": "\n".join(notes_parts),
    }

    if pipeline_id:
        properties["pipeline"] = pipeline_id

    if opp.get("target_close"):
        properties["closedate"] = f"{opp['target_close']}T00:00:00.000Z"

    hs_payload = json.dumps({"properties": properties}).encode("utf-8")

    req = urllib.request.Request(
        "https://api.hubapi.com/crm/v3/objects/deals",
        data=hs_payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            hs_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        return _response(e.code, {"error": f"HubSpot API error: {error_body}"})

    deal_id = hs_data.get("id", "")
    hubspot_url = ""
    if portal_id and deal_id:
        hubspot_url = f"https://app.hubspot.com/contacts/{portal_id}/deal/{deal_id}"

    return _response(200, {
        "deal_id": deal_id,
        "deal_name": deal_name,
        "hubspot_url": hubspot_url,
        "lifecycle": opp.get("lifecycle", "Lead"),
        "opp_class": opp.get("opp_class"),
    })


def _score_deal(body):
    deal = body.get("deal", {})
    score = 0
    breakdown = {}
    for dimension in ["budget", "authority", "need", "timeline"]:
        val = min(max(deal.get(dimension, 0), 0), 25)
        breakdown[dimension] = val
        score += val
    return _response(200, {"score": score, "breakdown": breakdown})


def _win_rate(body):
    won = body.get("won", 0)
    total = body.get("total", 1)
    rate = round((won / max(total, 1)) * 100, 1)
    return _response(200, {"win_rate_pct": rate, "won": won, "total": total})


def _pipeline_coverage(body):
    pipeline_val = body.get("pipeline_value", 0)
    target = body.get("target", 1)
    ratio = round(pipeline_val / max(target, 1), 2)
    return _response(200, {"coverage_ratio": ratio, "healthy": ratio >= 3.0})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Resource-Key",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
        "body": json.dumps(body),
    }
