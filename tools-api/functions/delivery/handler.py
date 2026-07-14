"""Delivery Tools Lambda handler — delivery tracking utilities."""
import json


def handler(event, context):
    method = event.get("httpMethod", "GET")

    if method == "GET":
        return _response(200, {"message": "Delivery Tools API", "status": "ok"})

    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        action = body.get("action")
        return _response(200, {"message": f"Delivery action '{action}' — coming soon"})

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
