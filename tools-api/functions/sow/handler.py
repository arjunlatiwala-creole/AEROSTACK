"""SOW Tools Lambda handler — SOW generation, templates, tracking."""
import json


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {"message": "SOW Tools API", "status": "ok"})

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")

        if action == "generate":
            return _response(200, {"message": "SOW generation — coming soon"})
        if action == "list_templates":
            return _response(200, {"templates": []})

        return _response(400, {"error": f"Unknown action: {action}"})

    return _response(405, {"error": "Method not allowed"})


def _response(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
