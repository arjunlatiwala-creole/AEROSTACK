"""Agent Registry Lambda handler — CRUD for Aerostack agent definitions."""
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("AGENT_REGISTRY_TABLE", "aerostack-agent-registry")
STAGE = os.environ.get("STAGE", "dev")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    method = event.get("httpMethod", "GET")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}
    agent_id = path_params.get("agentId")

    if method == "GET" and not agent_id:
        return _list_agents(event)
    if method == "GET" and agent_id:
        return _get_agent(agent_id)
    if method == "POST":
        return _create_agent(event)
    if method == "PUT" and agent_id:
        return _update_agent(agent_id, event)
    if method == "DELETE" and agent_id:
        return _delete_agent(agent_id)

    return _response(405, {"error": "Method not allowed"})


def _list_agents(event):
    qs = event.get("queryStringParameters") or {}
    agent_type = qs.get("type")
    status = qs.get("status")

    scan_kwargs = {}
    filter_parts = []
    expr_values = {}
    expr_names = {}

    if agent_type:
        filter_parts.append("#at = :at")
        expr_values[":at"] = agent_type
        expr_names["#at"] = "agent_type"
    if status:
        filter_parts.append("#st = :st")
        expr_values[":st"] = status
        expr_names["#st"] = "status"

    if filter_parts:
        scan_kwargs["FilterExpression"] = " AND ".join(filter_parts)
        scan_kwargs["ExpressionAttributeValues"] = expr_values
        scan_kwargs["ExpressionAttributeNames"] = expr_names

    result = table.scan(**scan_kwargs)
    items = result.get("Items", [])
    items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return _response(200, {"agents": items, "count": len(items)})


def _get_agent(agent_id: str):
    result = table.get_item(Key={"agent_id": agent_id})
    item = result.get("Item")
    if not item:
        return _response(404, {"error": {"code": "NOT_FOUND", "message": f"Agent {agent_id} not found"}})
    return _response(200, item)


def _create_agent(event):
    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    if not name:
        return _response(400, {"error": {"code": "VALIDATION", "message": "name is required"}})

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "agent_id": str(uuid.uuid4()),
        "name": name,
        "description": body.get("description", ""),
        "status": "inactive",
        "agent_type": body.get("agent_type", "tool"),
        "endpoint": body.get("endpoint", ""),
        "version": body.get("version", "0.1.0"),
        "capabilities": body.get("capabilities", []),
        "config": body.get("config", {}),
        "owner": body.get("owner", ""),
        "tags": body.get("tags", []),
        "kb_access": body.get("kb_access", []),
        "kb_write": body.get("kb_write", []),
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)
    return _response(201, item)


def _update_agent(agent_id: str, event):
    existing = table.get_item(Key={"agent_id": agent_id}).get("Item")
    if not existing:
        return _response(404, {"error": {"code": "NOT_FOUND", "message": f"Agent {agent_id} not found"}})

    body = json.loads(event.get("body", "{}"))
    now = datetime.now(timezone.utc).isoformat()

    updatable = ["name", "description", "status", "agent_type", "endpoint",
                 "version", "capabilities", "config", "owner", "tags",
                 "kb_access", "kb_write"]
    update_parts = ["#ua = :ua"]
    expr_values = {":ua": now}
    expr_names = {"#ua": "updated_at"}

    for field in updatable:
        if field in body:
            placeholder = f":{field}"
            name_placeholder = f"#{field}"
            update_parts.append(f"{name_placeholder} = {placeholder}")
            expr_values[placeholder] = body[field]
            expr_names[name_placeholder] = field

    result = table.update_item(
        Key={"agent_id": agent_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeValues=expr_values,
        ExpressionAttributeNames=expr_names,
        ReturnValues="ALL_NEW",
    )
    return _response(200, result.get("Attributes", {}))


def _delete_agent(agent_id: str):
    existing = table.get_item(Key={"agent_id": agent_id}).get("Item")
    if not existing:
        return _response(404, {"error": {"code": "NOT_FOUND", "message": f"Agent {agent_id} not found"}})

    table.delete_item(Key={"agent_id": agent_id})
    return _response(200, {"deleted": agent_id})


def _response(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }
