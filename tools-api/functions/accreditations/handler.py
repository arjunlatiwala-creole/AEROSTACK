"""
Accreditations Catalog — Aerostack Tool
Manages accreditation requirements (catalog), modules, assignments, and compliance.
DynamoDB single-table design:
  PK                          SK                          Description
  REQ#{requirement_id}        META                        Requirement metadata
  REQ#{requirement_id}        MOD#{module_id}             Module within requirement
  ASSIGN#{person_email}       REQ#{requirement_id}        Person's assignment to a requirement
  ASSIGN#{person_email}       MODPROG#{req_id}#{mod_id}   Module-level progress
"""
import json
import os
import uuid
import boto3
import boto3.dynamodb.conditions
import logging
from datetime import datetime, timezone
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("ACCREDITATIONS_TABLE", "")
_ddb = None


def _table():
    global _ddb
    if _ddb is None:
        _ddb = boto3.resource("dynamodb")
    return _ddb.Table(TABLE_NAME)


def handler(event, context):
    method = event.get("httpMethod", "GET")
    path = event.get("path", "")
    qs = event.get("queryStringParameters") or {}

    try:
        if method == "GET":
            action = qs.get("action", "list_requirements")
            return _route_get(action, qs)

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action", "")
            return _route_post(action, body)

        return _resp(405, {"error": "Method not allowed"})
    except Exception as exc:
        logger.exception("accreditations handler error")
        return _resp(500, {"error": str(exc)})


# ── Routing ──────────────────────────────────────────────────────────

def _route_get(action: str, qs: dict) -> dict:
    if action == "list_requirements":
        return _list_requirements(qs)
    if action == "get_requirement":
        return _get_requirement(qs.get("requirement_id", ""))
    if action == "list_assignments":
        return _list_assignments(qs.get("email", ""))
    if action == "dashboard":
        return _get_dashboard()
    return _resp(400, {"error": f"Unknown GET action: {action}"})


def _route_post(action: str, body: dict) -> dict:
    if action == "upsert_requirement":
        return _upsert_requirement(body)
    if action == "delete_requirement":
        return _delete_requirement(body)
    if action == "upsert_module":
        return _upsert_module(body)
    if action == "delete_module":
        return _delete_module(body)
    if action == "reorder_modules":
        return _reorder_modules(body)
    if action == "assign":
        return _assign_requirement(body)
    if action == "unassign":
        return _unassign_requirement(body)
    if action == "update_module_progress":
        return _update_module_progress(body)
    if action == "update_assignment_status":
        return _update_assignment_status(body)
    if action == "seed_aws_partner":
        return _seed_aws_partner_training(body)
    return _resp(400, {"error": f"Unknown POST action: {action}"})


# ── Requirements CRUD ────────────────────────────────────────────────

def _list_requirements(qs: dict) -> dict:
    """List all requirements with their modules."""
    tbl = _table()
    # Scan for all REQ# items
    resp = tbl.scan(
        FilterExpression=boto3.dynamodb.conditions.Attr("pk").begins_with("REQ#"),
    )
    items = resp.get("Items", [])

    # Group by requirement
    reqs = {}
    for item in items:
        pk = item["pk"]
        sk = item["sk"]
        req_id = pk.replace("REQ#", "")

        if sk == "META":
            reqs.setdefault(req_id, {"modules": []})
            reqs[req_id].update(_clean(item))
        elif sk.startswith("MOD#"):
            reqs.setdefault(req_id, {"modules": []})
            reqs[req_id]["modules"].append(_clean(item))

    # Sort modules by sort_order
    result = []
    for req_id, req in reqs.items():
        req["modules"] = sorted(req.get("modules", []), key=lambda m: m.get("sort_order", 0))
        req["requirement_id"] = req_id
        result.append(req)

    result.sort(key=lambda r: r.get("created_at", ""))
    return _resp(200, {"requirements": result, "count": len(result)})


def _get_requirement(requirement_id: str) -> dict:
    if not requirement_id:
        return _resp(400, {"error": "requirement_id required"})

    tbl = _table()
    resp = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq(f"REQ#{requirement_id}"),
    )
    items = resp.get("Items", [])
    if not items:
        return _resp(404, {"error": "Requirement not found"})

    req = {}
    modules = []
    for item in items:
        if item["sk"] == "META":
            req = _clean(item)
        elif item["sk"].startswith("MOD#"):
            modules.append(_clean(item))

    req["modules"] = sorted(modules, key=lambda m: m.get("sort_order", 0))
    req["requirement_id"] = requirement_id
    return _resp(200, {"requirement": req})


def _upsert_requirement(body: dict) -> dict:
    """Create or update a requirement (metadata only, not modules)."""
    data = body.get("data", {})
    req_id = data.get("requirement_id") or str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    if not data.get("title"):
        return _resp(400, {"error": "title required"})

    item = {
        "pk": f"REQ#{req_id}",
        "sk": "META",
        "requirement_id": req_id,
        "title": data["title"],
        "description": data.get("description", ""),
        "provider": data.get("provider", ""),
        "provider_program": data.get("provider_program", ""),
        "category": data.get("category", ""),
        "assignment_type": data.get("assignment_type", "MANDATORY"),
        "is_active": data.get("is_active", True),
        "deadline_days": data.get("deadline_days"),
        "recurrence_months": data.get("recurrence_months"),
        "applies_to": data.get("applies_to", "ALL"),
        "applies_to_filter": data.get("applies_to_filter", []),
        "created_at": data.get("created_at", now),
        "updated_at": now,
        "created_by": data.get("created_by", "system"),
    }

    _table().put_item(Item=_to_dynamo(item))
    return _resp(200, {"requirement": _clean(item), "requirement_id": req_id})


def _delete_requirement(body: dict) -> dict:
    """Delete a requirement and all its modules."""
    req_id = body.get("requirement_id", "")
    if not req_id:
        return _resp(400, {"error": "requirement_id required"})

    tbl = _table()
    # Query all items under this requirement
    resp = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq(f"REQ#{req_id}"),
    )
    items = resp.get("Items", [])

    with tbl.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})

    return _resp(200, {"deleted": True, "requirement_id": req_id, "items_deleted": len(items)})


# ── Modules CRUD ─────────────────────────────────────────────────────

def _upsert_module(body: dict) -> dict:
    """Add or update a module within a requirement."""
    req_id = body.get("requirement_id", "")
    data = body.get("data", {})
    mod_id = data.get("module_id") or str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    if not req_id:
        return _resp(400, {"error": "requirement_id required"})
    if not data.get("title"):
        return _resp(400, {"error": "module title required"})

    item = {
        "pk": f"REQ#{req_id}",
        "sk": f"MOD#{mod_id}",
        "module_id": mod_id,
        "requirement_id": req_id,
        "title": data["title"],
        "description": data.get("description", ""),
        "external_url": data.get("external_url", ""),
        "estimated_hours": data.get("estimated_hours"),
        "sort_order": data.get("sort_order", 0),
        "created_at": data.get("created_at", now),
        "updated_at": now,
    }

    _table().put_item(Item=_to_dynamo(item))
    return _resp(200, {"module": _clean(item), "module_id": mod_id})


def _delete_module(body: dict) -> dict:
    req_id = body.get("requirement_id", "")
    mod_id = body.get("module_id", "")
    if not req_id or not mod_id:
        return _resp(400, {"error": "requirement_id and module_id required"})

    _table().delete_item(Key={"pk": f"REQ#{req_id}", "sk": f"MOD#{mod_id}"})
    return _resp(200, {"deleted": True, "module_id": mod_id})


def _reorder_modules(body: dict) -> dict:
    """Reorder modules: body.order = [{module_id, sort_order}, ...]"""
    req_id = body.get("requirement_id", "")
    order = body.get("order", [])
    if not req_id or not order:
        return _resp(400, {"error": "requirement_id and order required"})

    tbl = _table()
    now = datetime.now(timezone.utc).isoformat()
    for entry in order:
        tbl.update_item(
            Key={"pk": f"REQ#{req_id}", "sk": f"MOD#{entry['module_id']}"},
            UpdateExpression="SET sort_order = :o, updated_at = :t",
            ExpressionAttributeValues={":o": entry["sort_order"], ":t": now},
        )

    return _resp(200, {"reordered": True, "count": len(order)})


# ── Assignments ──────────────────────────────────────────────────────

def _assign_requirement(body: dict) -> dict:
    """Assign a requirement to a person."""
    email = body.get("email", "").lower().strip()
    req_id = body.get("requirement_id", "")
    now = datetime.now(timezone.utc).isoformat()

    if not email or not req_id:
        return _resp(400, {"error": "email and requirement_id required"})

    assignment_type = body.get("assignment_type", "MANDATORY")
    deadline = body.get("deadline")
    notes = body.get("notes", "")

    item = {
        "pk": f"ASSIGN#{email}",
        "sk": f"REQ#{req_id}",
        "person_email": email,
        "person_name": body.get("person_name", email.split("@")[0]),
        "requirement_id": req_id,
        "assignment_type": assignment_type,
        "status": "NOT_STARTED",
        "assigned_at": now,
        "deadline": deadline,
        "notes": notes,
        "created_at": now,
        "updated_at": now,
    }

    _table().put_item(Item=_to_dynamo(item))
    return _resp(200, {"assignment": _clean(item)})


def _unassign_requirement(body: dict) -> dict:
    email = body.get("email", "").lower().strip()
    req_id = body.get("requirement_id", "")
    if not email or not req_id:
        return _resp(400, {"error": "email and requirement_id required"})

    tbl = _table()
    # Delete assignment
    tbl.delete_item(Key={"pk": f"ASSIGN#{email}", "sk": f"REQ#{req_id}"})

    # Delete module progress for this assignment
    resp = tbl.query(
        KeyConditionExpression=(
            boto3.dynamodb.conditions.Key("pk").eq(f"ASSIGN#{email}")
            & boto3.dynamodb.conditions.Key("sk").begins_with(f"MODPROG#{req_id}#")
        ),
    )
    with tbl.batch_writer() as batch:
        for item in resp.get("Items", []):
            batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})

    return _resp(200, {"unassigned": True})


def _list_assignments(email: str) -> dict:
    """List all assignments for a person, including module progress."""
    if not email:
        return _resp(400, {"error": "email required"})

    email = email.lower().strip()
    tbl = _table()
    resp = tbl.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("pk").eq(f"ASSIGN#{email}"),
    )
    items = resp.get("Items", [])

    assignments = []
    module_progress = {}

    for item in items:
        sk = item["sk"]
        if sk.startswith("REQ#"):
            assignments.append(_clean(item))
        elif sk.startswith("MODPROG#"):
            # MODPROG#{req_id}#{mod_id}
            parts = sk.split("#")
            req_id = parts[1] if len(parts) > 1 else ""
            module_progress.setdefault(req_id, []).append(_clean(item))

    # Attach module progress to assignments
    for a in assignments:
        req_id = a.get("requirement_id", "")
        a["module_progress"] = module_progress.get(req_id, [])

    return _resp(200, {"assignments": assignments, "count": len(assignments)})


def _update_module_progress(body: dict) -> dict:
    """Update progress on a specific module within an assignment."""
    email = body.get("email", "").lower().strip()
    req_id = body.get("requirement_id", "")
    mod_id = body.get("module_id", "")
    status = body.get("status", "COMPLETED")
    evidence_url = body.get("evidence_url", "")
    now = datetime.now(timezone.utc).isoformat()

    if not email or not req_id or not mod_id:
        return _resp(400, {"error": "email, requirement_id, and module_id required"})

    tbl = _table()
    item = {
        "pk": f"ASSIGN#{email}",
        "sk": f"MODPROG#{req_id}#{mod_id}",
        "person_email": email,
        "requirement_id": req_id,
        "module_id": mod_id,
        "status": status,
        "evidence_url": evidence_url,
        "completed_at": now if status == "COMPLETED" else None,
        "updated_at": now,
    }
    tbl.put_item(Item=_to_dynamo(item))

    # Check if all modules are complete → auto-update assignment status
    _maybe_complete_assignment(tbl, email, req_id)

    return _resp(200, {"progress": _clean(item)})


def _update_assignment_status(body: dict) -> dict:
    email = body.get("email", "").lower().strip()
    req_id = body.get("requirement_id", "")
    status = body.get("status", "")
    now = datetime.now(timezone.utc).isoformat()

    if not email or not req_id or not status:
        return _resp(400, {"error": "email, requirement_id, and status required"})

    update_expr = "SET #s = :s, updated_at = :t"
    expr_values = {":s": status, ":t": now}
    expr_names = {"#s": "status"}

    if status == "COMPLETED":
        update_expr += ", completed_at = :c"
        expr_values[":c"] = now
    elif status == "IN_PROGRESS":
        update_expr += ", started_at = :st"
        expr_values[":st"] = now

    _table().update_item(
        Key={"pk": f"ASSIGN#{email}", "sk": f"REQ#{req_id}"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    return _resp(200, {"updated": True})


def _maybe_complete_assignment(tbl, email: str, req_id: str):
    """If all modules in the requirement are completed, mark assignment COMPLETED."""
    # Get requirement modules
    req_resp = tbl.query(
        KeyConditionExpression=(
            boto3.dynamodb.conditions.Key("pk").eq(f"REQ#{req_id}")
            & boto3.dynamodb.conditions.Key("sk").begins_with("MOD#")
        ),
    )
    total_modules = len(req_resp.get("Items", []))
    if total_modules == 0:
        return

    # Get completed module progress
    prog_resp = tbl.query(
        KeyConditionExpression=(
            boto3.dynamodb.conditions.Key("pk").eq(f"ASSIGN#{email}")
            & boto3.dynamodb.conditions.Key("sk").begins_with(f"MODPROG#{req_id}#")
        ),
    )
    completed = sum(1 for i in prog_resp.get("Items", []) if i.get("status") == "COMPLETED")

    if completed >= total_modules:
        now = datetime.now(timezone.utc).isoformat()
        tbl.update_item(
            Key={"pk": f"ASSIGN#{email}", "sk": f"REQ#{req_id}"},
            UpdateExpression="SET #s = :s, completed_at = :c, updated_at = :t",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "COMPLETED", ":c": now, ":t": now},
        )
    elif completed > 0:
        now = datetime.now(timezone.utc).isoformat()
        tbl.update_item(
            Key={"pk": f"ASSIGN#{email}", "sk": f"REQ#{req_id}"},
            UpdateExpression="SET #s = :s, updated_at = :t",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "IN_PROGRESS", ":t": now},
        )


# ── Dashboard (org-level) ────────────────────────────────────────────

def _get_dashboard() -> dict:
    """Org-level accreditations dashboard — scans all assignments."""
    tbl = _table()

    # Get all requirements
    req_resp = tbl.scan(
        FilterExpression=boto3.dynamodb.conditions.Attr("pk").begins_with("REQ#")
        & boto3.dynamodb.conditions.Attr("sk").eq("META"),
    )
    requirements = {_clean(i)["requirement_id"]: _clean(i) for i in req_resp.get("Items", [])}

    # Get all assignments
    assign_resp = tbl.scan(
        FilterExpression=boto3.dynamodb.conditions.Attr("pk").begins_with("ASSIGN#")
        & boto3.dynamodb.conditions.Attr("sk").begins_with("REQ#"),
    )
    assignments = [_clean(i) for i in assign_resp.get("Items", [])]

    # Compute per-requirement stats
    by_req = {}
    for a in assignments:
        rid = a.get("requirement_id", "")
        by_req.setdefault(rid, {
            "completed": 0,
            "in_progress": 0,
            "not_started": 0,
            "overdue": 0,
            "total": 0,
            "assigned_users": []
        })
        by_req[rid]["total"] += 1
        status = a.get("status", "NOT_STARTED")
        if status == "COMPLETED":
            by_req[rid]["completed"] += 1
        elif status == "IN_PROGRESS":
            by_req[rid]["in_progress"] += 1
        else:
            by_req[rid]["not_started"] += 1

        # Check overdue
        deadline = a.get("deadline")
        is_overdue = False
        if deadline and status not in ("COMPLETED", "WAIVED"):
            try:
                if datetime.fromisoformat(deadline.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    by_req[rid]["overdue"] += 1
                    is_overdue = True
            except (ValueError, TypeError):
                pass

        by_req[rid]["assigned_users"].append({
            "person_email": a.get("person_email", ""),
            "person_name": a.get("person_name", ""),
            "status": status,
            "deadline": deadline,
            "is_overdue": is_overdue,
            "assigned_at": a.get("assigned_at", ""),
            "completed_at": a.get("completed_at", "")
        })

    req_summaries = []
    for rid, stats in by_req.items():
        req_meta = requirements.get(rid, {})
        total = stats["total"]
        req_summaries.append({
            "requirement_id": rid,
            "title": req_meta.get("title", rid),
            "provider": req_meta.get("provider", ""),
            "assignment_type": req_meta.get("assignment_type", ""),
            "total_assigned": total,
            "completed_count": stats["completed"],
            "in_progress_count": stats["in_progress"],
            "not_started_count": stats["not_started"],
            "overdue_count": stats["overdue"],
            "completion_rate": round((stats["completed"] / total) * 100) if total > 0 else 0,
            "assigned_users": stats["assigned_users"],
        })

    # Compute per-person compliance
    people = {}
    for a in assignments:
        email = a.get("person_email", "")
        people.setdefault(email, {
            "person_email": email,
            "person_name": a.get("person_name", email),
            "active": 0, "completed": 0, "overdue": 0,
        })
        status = a.get("status", "NOT_STARTED")
        if status == "COMPLETED":
            people[email]["completed"] += 1
        else:
            people[email]["active"] += 1
        deadline = a.get("deadline")
        if deadline and status not in ("COMPLETED", "WAIVED"):
            try:
                if datetime.fromisoformat(deadline.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                    people[email]["overdue"] += 1
            except (ValueError, TypeError):
                pass

    non_compliant = []
    compliant_count = 0
    for email, p in people.items():
        has_active = p["active"] > 0
        is_compliant = has_active and p["overdue"] == 0
        if is_compliant:
            compliant_count += 1
        else:
            non_compliant.append({
                "person_email": email,
                "person_name": p["person_name"],
                "has_active_goal": has_active,
                "days_without_active_goal": 0,  # Would need assignment history for real calc
                "is_compliant": False,
                "active_assignments": p["active"],
                "completed_assignments": p["completed"],
                "overdue_assignments": p["overdue"],
            })

    # Recent completions
    recent = sorted(
        [a for a in assignments if a.get("status") == "COMPLETED" and a.get("completed_at")],
        key=lambda x: x.get("completed_at", ""),
        reverse=True,
    )[:10]
    recent_completions = [{
        "assignment_id": f"{a['person_email']}_{a['requirement_id']}",
        "person_email": a["person_email"],
        "person_name": a.get("person_name", ""),
        "requirement_title": requirements.get(a.get("requirement_id", ""), {}).get("title", a.get("requirement_id", "")),
        "completed_at": a.get("completed_at", ""),
    } for a in recent]

    total_people = len(people)
    return _resp(200, {
        "total_employees": total_people,
        "compliant_count": compliant_count,
        "non_compliant_count": len(non_compliant),
        "compliance_rate": round((compliant_count / total_people) * 100) if total_people > 0 else 0,
        "by_requirement": req_summaries,
        "non_compliant_people": non_compliant,
        "recent_completions": recent_completions,
    })


# ── Seed: AWS Partner Training ───────────────────────────────────────

def _seed_aws_partner_training(body: dict) -> dict:
    """Seed the AWS Partner Foundational Training requirement + modules."""
    force = body.get("force", False)
    tbl = _table()
    req_id = "aws-partner-foundational"
    now = datetime.now(timezone.utc).isoformat()

    # Check if already exists
    existing = tbl.get_item(Key={"pk": f"REQ#{req_id}", "sk": "META"})
    if existing.get("Item") and not force:
        return _resp(200, {"message": "AWS Partner Training already seeded", "requirement_id": req_id})

    # Requirement metadata
    req = {
        "pk": f"REQ#{req_id}",
        "sk": "META",
        "requirement_id": req_id,
        "title": "AWS Partner Foundational Training",
        "description": "Required AWS Partner Network training modules for all enterprise employees. Complete via AWS Skillbuilder with your Builder ID associated to the enterprise APN record.",
        "provider": "AWS",
        "provider_program": "AWS Partner Training (Skillbuilder)",
        "category": "Cloud Foundations",
        "assignment_type": "MANDATORY",
        "is_active": True,
        "deadline_days": 30,
        "applies_to": "ALL",
        "applies_to_filter": [],
        "created_at": now,
        "updated_at": now,
        "created_by": "system",
    }

    modules = [
        {
            "module_id": "aws-cloud-prac-essentials",
            "title": "AWS Cloud Practitioner Essentials",
            "description": "Foundational cloud concepts, AWS services, security, architecture, pricing.",
            "external_url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/134/aws-cloud-practitioner-essentials",
            "estimated_hours": 6,
            "sort_order": 1,
        },
        {
            "module_id": "aws-partner-accred-technical",
            "title": "AWS Partner: Accreditation (Technical)",
            "description": "Core AWS technical accreditation for partners.",
            "external_url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/113/aws-partner-accreditation-technical",
            "estimated_hours": 4,
            "sort_order": 2,
        },
        {
            "module_id": "aws-partner-accred-business",
            "title": "AWS Partner: Accreditation (Business)",
            "description": "AWS business value proposition and partner program benefits.",
            "external_url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/112/aws-partner-accreditation-business",
            "estimated_hours": 3,
            "sort_order": 3,
        },
        {
            "module_id": "aws-partner-cloud-economics",
            "title": "AWS Partner: Cloud Economics Accreditation",
            "description": "Cost optimization and cloud financial management for partners.",
            "external_url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/116/aws-partner-cloud-economics-accreditation",
            "estimated_hours": 3,
            "sort_order": 4,
        },
        {
            "module_id": "aws-partner-solutions-foundations",
            "title": "AWS Partner: Solutions Training (Foundations)",
            "description": "Solutions-level training for AWS partner technical staff.",
            "external_url": "https://explore.skillbuilder.aws/learn/course/external/view/elearning/118/aws-partner-solutions-training-foundations",
            "estimated_hours": 4,
            "sort_order": 5,
        },
    ]

    with tbl.batch_writer() as batch:
        batch.put_item(Item=_to_dynamo(req))
        for mod in modules:
            item = {
                "pk": f"REQ#{req_id}",
                "sk": f"MOD#{mod['module_id']}",
                "requirement_id": req_id,
                "created_at": now,
                "updated_at": now,
                **mod,
            }
            batch.put_item(Item=_to_dynamo(item))

    return _resp(200, {
        "message": "AWS Partner Training seeded",
        "requirement_id": req_id,
        "modules_count": len(modules),
    })


# ── Utilities ────────────────────────────────────────────────────────

def _clean(item: dict) -> dict:
    cleaned = {}
    for k, v in item.items():
        if isinstance(v, Decimal):
            cleaned[k] = int(v) if v == int(v) else float(v)
        elif isinstance(v, set):
            cleaned[k] = list(v)
        else:
            cleaned[k] = v
    return cleaned


def _to_dynamo(item: dict) -> dict:
    converted = {}
    for k, v in item.items():
        if v is None:
            continue  # Skip None values
        if isinstance(v, float):
            converted[k] = Decimal(str(v))
        else:
            converted[k] = v
    return converted


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
