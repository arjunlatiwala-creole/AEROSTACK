"""Email → Sheet Row extraction handler using Bedrock Claude."""
import json
import boto3

_bedrock = None

OPP_SYSTEM_PROMPT = """You extract deal/opportunity information from emails to fill an Aerostack Opportunity Control Sheet row.
Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{"Aerostack Lifecycle": "Lead|Developing|Funding-Ready|Active Funding|Ready for Signature|Closed",
"Opp Class": "RevGen|Non-Rev",
"enterprise Owner": "name or empty",
"Customer Owner": "named person at the customer, not a company or team",
"Customer": "company name",
"Opportunity Name": "short descriptive name",
"Est. Revenue": "number or empty",
"Target Close": "MM/DD/YYYY or empty",
"Verbal Contours Confirmed?": "Y|N",
"Funding Needed?": "Y|N",
"Funding Status": "None|Preparing|Submitted|Approved|Rejected",
"Next Step": "specific action",
"Next Step Owner": "who owns the next action",
"Next Step Date": "MM/DD/YYYY or empty",
"Notes": "brief factual notes"}
Rules:
- Lifecycle defaults to "Lead" unless clear evidence of further progress
- If revenue is mentioned, Opp Class = "RevGen"
- Customer Owner must be a PERSON name, not a company
- Next Step must be specific, not "follow up"
- If you cannot determine a field, leave it as empty string
- Return ONLY the JSON object, nothing else"""

AWS_CHANNEL_SYSTEM_PROMPT = """You extract AWS rep/contact information from emails to fill an AWS Channel Control Sheet row.
Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{"AWS Contact Name": "person name",
"Role Type": "Seller (AM/AE)|Sales Manager|Partner Manager (PAM/PDM)|SA / Specialist|Startup / Greenfield Lead|ISR / DG|Other",
"Segment / Coverage": "territory or segment",
"Influence Type": "Source|Gatekeeper|Validator|Accelerator|Unknown",
"Relationship Health": "Active / Responsive|Cold|Silent / Missing|New / Unproven",
"Strength (1-5)": "1-5 number",
"Opps Shared (30d)": "number",
"Opps Shared (YTD)": "number",
"Last Opp Shared Date": "MM/DD/YYYY or empty",
"Opp Quality (1-3)": "1-3 or empty",
"enterprise Relationship Owner": "name, default Prathik",
"Last Interaction Date": "MM/DD/YYYY or empty",
"Next Action": "specific action, not 'follow up'",
"Next Action Date": "MM/DD/YYYY or empty",
"Escalation Path": "manager name or empty",
"Notes": "brief factual notes"}
Rules:
- Strength: 1=name only, 2=met once, 3=responds+will take call, 4=engaged+collaborative, 5=reliably sends qualified opps
- Default Relationship Health to "New / Unproven" if unknown
- Default enterprise Relationship Owner to "Prathik" unless specified
- Next Action must be specific
- Return ONLY the JSON object, nothing else"""

SYSTEM_PROMPTS = {
    "opp": OPP_SYSTEM_PROMPT,
    "aws": AWS_CHANNEL_SYSTEM_PROMPT,
}

OPP_COLUMNS = [
    "Aerostack Lifecycle", "Opp Class", "enterprise Owner", "Customer Owner", "Customer",
    "Opportunity Name", "Est. Revenue", "Target Close",
    "Verbal Contours Confirmed?", "Funding Needed?", "Funding Status",
    "Next Step", "Next Step Owner", "Next Step Date", "Notes",
]

OPP_DEFAULTS = {
    "Aerostack Lifecycle": "Lead",
    "Opp Class": "RevGen",
    "Verbal Contours Confirmed?": "N",
    "Funding Needed?": "N",
    "Funding Status": "None",
}

AWS_COLUMNS = [
    "AWS Contact Name", "Role Type", "Segment / Coverage", "Influence Type",
    "Relationship Health", "Strength (1-5)", "Opps Shared (30d)",
    "Opps Shared (YTD)", "Last Opp Shared Date", "Opp Quality (1-3)",
    "enterprise Relationship Owner", "Last Interaction Date", "Next Action",
    "Next Action Date", "Escalation Path", "Notes",
]

AWS_DEFAULTS = {
    "Relationship Health": "New / Unproven",
    "Strength (1-5)": "1",
    "Opps Shared (30d)": "0",
    "Opps Shared (YTD)": "0",
    "Opp Quality (1-3)": "",
    "enterprise Relationship Owner": "Prathik",
}

TABS = {
    "opp": {"columns": OPP_COLUMNS, "defaults": OPP_DEFAULTS},
    "aws": {"columns": AWS_COLUMNS, "defaults": AWS_DEFAULTS},
}


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    return _bedrock


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {"message": "Email Extract API", "status": "ok"})

    if method != "POST":
        return _response(405, {"error": "Method not allowed"})

    body = json.loads(event.get("body", "{}"))
    action = body.get("action")

    if action == "extract":
        return _extract(body)

    return _response(400, {"error": f"Unknown action: {action}"})


def _extract(body):
    tab = body.get("tab", "opp")
    email_text = body.get("email_text", "").strip()

    if not email_text:
        return _response(400, {"error": "email_text is required"})

    if tab not in TABS:
        return _response(400, {"error": f"Invalid tab: {tab}"})

    system_prompt = SYSTEM_PROMPTS[tab]
    tab_config = TABS[tab]

    client = _get_bedrock()

    try:
        resp = client.converse(
            modelId="us.anthropic.claude-sonnet-4-20250514-v1:0",
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": email_text}]}],
            inferenceConfig={"maxTokens": 1024, "temperature": 0.0},
        )
    except Exception as exc:
        return _response(500, {"error": f"Bedrock error: {str(exc)}"})

    output_text = ""
    for block in resp.get("output", {}).get("message", {}).get("content", []):
        if "text" in block:
            output_text += block["text"]

    clean = output_text.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(clean)
    except json.JSONDecodeError:
        return _response(422, {
            "error": "Failed to parse model response as JSON",
            "raw": output_text[:500],
        })

    merged = {}
    for col in tab_config["columns"]:
        merged[col] = parsed.get(col, tab_config["defaults"].get(col, ""))

    return _response(200, {"extracted": merged, "tab": tab})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
