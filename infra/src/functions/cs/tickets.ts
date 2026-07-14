import { randomUUID } from "node:crypto";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandler } from "aws-lambda";
import { ddbClient } from "src/shared/dynamodb-client";
import { authorizeUser, isAuthError, UserRole } from "../shared/auth-utils";
import { createLogger } from "../shared/logger";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

/* ------------------------------------------------------------------ */
/* Aerostack Customer Success — Support ticketing (CS-1)                    */
/* Single-table: PK tenant_id, SK = TICKET#{id} | TICKET#{id}#MSG#{ts} */
/* Source PRD: docs/inputs/PRD-Aerostack-Customer-Success-v0.1.md           */
/* ------------------------------------------------------------------ */

const TABLE = process.env.CS_TICKETS_TABLE_NAME!;
const DEFAULT_TENANT = process.env.CS_TENANT_ID || "enterprise-internal";

type Priority = "P0" | "P1" | "P2" | "P3";
const HOUR = 3600_000;
const BIZ_DAY = 9 * HOUR;

/** SLA targets (PRD §6): first-response + resolution windows from open. */
function computeSla(priority: Priority, openedAtIso: string) {
  const t = new Date(openedAtIso).getTime();
  const map: Record<Priority, [number, number | null]> = {
    P0: [1 * HOUR, 4 * HOUR],
    P1: [4 * HOUR, 1 * BIZ_DAY],
    P2: [8 * HOUR, 3 * BIZ_DAY],
    P3: [2 * BIZ_DAY, null],
  };
  const [fr, res] = map[priority];
  return {
    sla_first_response_due: new Date(t + fr).toISOString(),
    sla_resolution_due: res === null ? null : new Date(t + res).toISOString(),
  };
}

function tenantOf(event: any): string {
  return (
    event.headers?.["X-Tenant-Id"] ||
    event.headers?.["x-tenant-id"] ||
    event.queryStringParameters?.tenant_id ||
    DEFAULT_TENANT
  );
}

function callerEmail(event: any): string | null {
  const c =
    event.requestContext?.authorizer?.claims ||
    event.requestContext?.authorizer?.jwt?.claims;
  return c?.email || c?.["cognito:username"] || null;
}

/* ------------------------------ CREATE ---------------------------- */
const _createTicket: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-createTicket");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const body = JSON.parse(event.body || "{}");
    if (!body.subject) return err("subject required", 400);
    const priority: Priority = ["P0", "P1", "P2", "P3"].includes(body.priority)
      ? body.priority
      : "P2";

    const tenant_id = tenantOf(event);
    const ticket_id = randomUUID();
    const now = new Date().toISOString();
    const sla = computeSla(priority, now);

    const ticket = {
      tenant_id,
      sk: `TICKET#${ticket_id}`,
      ticket_id,
      account_id: body.account_id ?? null,
      subject: String(body.subject),
      priority,
      status: "open" as const,
      assignee_email: body.assignee_email ?? null,
      ...sla,
      sla_breached: false,
      data_classification: "CONFIDENTIAL" as const,
      created_at: now,
      updated_at: now,
    };

    await ddbClient.send(new PutCommand({ TableName: TABLE, Item: ticket }));
    logger.info(`ticket created ${ticket_id}`);
    return ok(ticket, 201);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ------------------------------- LIST ----------------------------- */
const _listTickets: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-listTickets");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const tenant_id = tenantOf(event);
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "tenant_id = :t AND begins_with(sk, :p)",
        ExpressionAttributeValues: { ":t": tenant_id, ":p": "TICKET#" },
      }),
    );
    // Only ticket roots (exclude #MSG# / #EVENT# rows).
    const tickets = (res.Items ?? []).filter(
      (i) => !String(i.sk).includes("#MSG#") && !String(i.sk).includes("#EVENT#"),
    );
    const statusFilter = event.queryStringParameters?.status;
    const filtered = statusFilter
      ? tickets.filter((t) => t.status === statusFilter)
      : tickets;
    return ok({ tickets: filtered, count: filtered.length });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ------------------------------- GET ------------------------------ */
const _getTicket: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-getTicket");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const ticket_id = event.pathParameters?.id;
    if (!ticket_id) return err("ticket id required", 400);
    const tenant_id = tenantOf(event);

    const res = await ddbClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "tenant_id = :t AND begins_with(sk, :p)",
        ExpressionAttributeValues: {
          ":t": tenant_id,
          ":p": `TICKET#${ticket_id}`,
        },
      }),
    );
    const items = res.Items ?? [];
    const ticket = items.find((i) => i.sk === `TICKET#${ticket_id}`);
    if (!ticket) return err("Ticket not found", 404);

    // Customer View strips internal-only messages (enterprise ops see all).
    const customerView = event.queryStringParameters?.view === "customer";
    const messages = items
      .filter((i) => String(i.sk).includes("#MSG#"))
      .filter((m) => (customerView ? !m.internal_only : true))
      .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));

    return ok({ ...ticket, messages });
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* ------------------------------ UPDATE ---------------------------- */
const _updateTicket: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-updateTicket");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const ticket_id = event.pathParameters?.id;
    if (!ticket_id) return err("ticket id required", 400);
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");

    const got = await ddbClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { tenant_id, sk: `TICKET#${ticket_id}` },
      }),
    );
    if (!got.Item) return err("Ticket not found", 404);

    const now = new Date().toISOString();
    const updated: Record<string, unknown> = { ...got.Item, updated_at: now };
    if (body.status) updated.status = body.status;
    if (body.assignee_email !== undefined)
      updated.assignee_email = body.assignee_email;
    if (body.priority && ["P0", "P1", "P2", "P3"].includes(body.priority)) {
      updated.priority = body.priority;
      // Recompute SLA from original open time on priority change.
      Object.assign(
        updated,
        computeSla(body.priority, String(updated.created_at)),
      );
    }

    await ddbClient.send(new PutCommand({ TableName: TABLE, Item: updated }));
    return ok(updated);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

/* --------------------------- ADD MESSAGE -------------------------- */
const _addMessage: APIGatewayProxyHandler = async (event) => {
  const logger = createLogger("cs-addMessage");
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const ticket_id = event.pathParameters?.id;
    if (!ticket_id) return err("ticket id required", 400);
    const tenant_id = tenantOf(event);
    const body = JSON.parse(event.body || "{}");
    if (!body.body) return err("message body required", 400);

    const ts = new Date().toISOString();
    const message = {
      tenant_id,
      sk: `TICKET#${ticket_id}#MSG#${ts}`,
      ticket_id,
      ts,
      author_email: callerEmail(event) || body.author_email || "unknown",
      body: String(body.body),
      internal_only: Boolean(body.internal_only),
      data_classification: "CONFIDENTIAL" as const,
    };

    await ddbClient.send(new PutCommand({ TableName: TABLE, Item: message }));
    return ok(message, 201);
  } catch (e: any) {
    logger.error(e);
    return err(e.message || "Internal error");
  }
};

export const createTicket = withPermissions(_createTicket);
export const listTickets = withPermissions(_listTickets);
export const getTicket = withPermissions(_getTicket);
export const updateTicket = withPermissions(_updateTicket);
export const addMessage = withPermissions(_addMessage);
