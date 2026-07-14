import { APIGatewayProxyHandler } from "aws-lambda";
import { UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "crypto";
import {
  authorizeUser,
  isAuthError,
  UserRole,
  resolveActorEmail,
} from "../shared/auth-utils";
import { ddbClient } from "src/shared/dynamodb-client";
import { withPermissions } from "../shared/permission-middleware";
import { err, ok } from "../shared/response";

// ─── Config ────────────────────────────────────────────────────────────────
const linearDeliveryTable =
  process.env.LINEAR_DELIVERY_TABLE_NAME! || "local-linear-delivery";
const LINEAR_API_URL = "https://api.linear.app/graphql";
const LINEAR_SECRET_NAME = process.env.LINEAR_SECRET_NAME!;
const LINEAR_ADMIN_SECRET_NAME = process.env.LINEAR_ADMIN_SECRET_NAME;

const secretsClient = new SecretsManagerClient({});

// ─── Priority maps ─────────────────────────────────────────────────────────
const PRIORITY_LABEL_TO_NUM: Record<string, number> = {
  Critical: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  Minimal: 0,
};

const PRIORITY_NUM_TO_LABEL: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  0: "Minimal",
};

// ─── Interfaces ────────────────────────────────────────────────────────────
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  content?: string;
  statusId?: string;
  status_name?: string;
  priority?: string;
  targetDate?: string;
}

export interface AddProjectUpdateInput {
  body: string;
  health: "onTrack" | "atRisk" | "offTrack";
  user_email?: string;
}

export interface AddUpdateCommentInput {
  body: string;
  user_email?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
async function getLinearToken(): Promise<string> {
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: LINEAR_SECRET_NAME }),
  );
  if (!response.SecretString) throw new Error("Linear secret not found");
  const secret = JSON.parse(response.SecretString);
  return secret.LINEAR_API_TOKEN || secret.token || secret.devToken;
}

async function getLinearAdminToken(): Promise<string> {
  if (!LINEAR_ADMIN_SECRET_NAME) {
    return getLinearToken();
  }
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: LINEAR_ADMIN_SECRET_NAME }),
  );
  if (!response.SecretString) throw new Error("Linear admin secret not found");
  const secret = JSON.parse(response.SecretString);
  return secret.LINEAR_API_TOKEN || secret.token || secret.adminToken;
}

async function linearGraphQL(
  token: string,
  query: string,
  variables: Record<string, any> = {},
): Promise<any> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear API error (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { errors?: any[]; data: any };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ─── GraphQL mutations / queries ───────────────────────────────────────────

const UPDATE_PROJECT_MUTATION = `
mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) {
    success
    project {
      id
      name
      description
      content
      priority
      targetDate
      updatedAt
      status {
        id
        name
        type
      }
    }
  }
}
`;

const CREATE_PROJECT_UPDATE_MUTATION = `
mutation ProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
  projectUpdateCreate(input: $input) {
    success
    projectUpdate {
      id
      health
      body
      createdAt
      user {
        id
        name
        email
      }
    }
  }
}
`;

const GET_PROJECT_STATUSES_QUERY = `
query ProjectStatuses {
  projectStatuses {
    nodes {
      id
      name
      type
      color
    }
  }
}
`;

const GET_PROJECT_UPDATE_COMMENTS_QUERY = `
query GetProjectUpdateComments($id: String!) {
  projectUpdate(id: $id) {
    comments {
      nodes {
        id
        body
        createdAt
        parent {
          id
        }
        user {
          id
          name
          email
        }
      }
    }
  }
}
`;

const CREATE_COMMENT_MUTATION = `
mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment {
      id
      body
    }
  }
}
`;

const DELETE_COMMENT_MUTATION = `
mutation CommentDelete($id: String!) {
  commentDelete(id: $id) {
    success
    lastSyncId
  }
}
`;

const ARCHIVE_PROJECT_UPDATE_MUTATION = `
mutation ProjectUpdateArchive($projectUpdateArchiveId: String!) {
  projectUpdateArchive(id: $projectUpdateArchiveId) {
    success
    lastSyncId
  }
}
`;

const DELETE_PROJECT_UPDATE_MUTATION = `
mutation ProjectUpdateDelete($id: String!) {
  projectUpdateDelete(id: $id) {
    success
    lastSyncId
  }
}
`;

// ─── Linear helpers ────────────────────────────────────────────────────────

async function getLinearThreadRootId(
  token: string,
  projectUpdateId: string,
): Promise<string | null> {
  try {
    const data = await linearGraphQL(token, GET_PROJECT_UPDATE_COMMENTS_QUERY, {
      id: projectUpdateId,
    });

    const nodes: any[] = data?.projectUpdate?.comments?.nodes ?? [];
    if (nodes.length === 0) return null;

    const root = nodes.find((c) => !c.parent?.id);
    if (root) {
      console.log(
        `[getLinearThreadRootId] Found thread root=${root.id} for update=${projectUpdateId}`,
      );
      return root.id;
    }

    const sorted = [...nodes].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const fallbackParent = sorted[0]?.parent?.id ?? sorted[0]?.id ?? null;
    console.warn(
      `[getLinearThreadRootId] No root found, using fallback=${fallbackParent}`,
    );
    return fallbackParent;
  } catch (e: any) {
    console.error(`[getLinearThreadRootId] Query failed:`, e.message);
    return null;
  }
}

async function createLinearComment(
  token: string,
  projectUpdateId: string,
  commentBody: string,
  actorEmail: string,
  knownThreadRootId?: string | null,
): Promise<{ linearCommentId: string | null; threadRootId: string | null }> {
  const formattedBody = `_${actorEmail}_: ${commentBody}`;

  try {
    let threadRootId: string | null =
      knownThreadRootId !== undefined
        ? knownThreadRootId
        : await getLinearThreadRootId(token, projectUpdateId);

    const input: Record<string, any> = {
      projectUpdateId,
      body: formattedBody,
    };

    if (threadRootId) {
      input.parentId = threadRootId;
      console.log(
        `[createLinearComment] Replying to thread root=${threadRootId} on update=${projectUpdateId}`,
      );
    } else {
      console.log(
        `[createLinearComment] Creating new thread root on update=${projectUpdateId}`,
      );
    }

    const data = await linearGraphQL(token, CREATE_COMMENT_MUTATION, {
      input,
    });

    if (!data.commentCreate?.success) {
      console.warn(`[createLinearComment] Linear returned success=false`);
      return { linearCommentId: null, threadRootId };
    }

    const linearCommentId = data.commentCreate.comment?.id ?? null;

    if (!threadRootId && linearCommentId) {
      threadRootId = linearCommentId;
    }

    console.log(
      `[createLinearComment] Created comment id=${linearCommentId}, threadRootId=${threadRootId}`,
    );
    return { linearCommentId, threadRootId };
  } catch (e: any) {
    console.error(
      `[createLinearComment] Failed to create Linear comment:`,
      e.message,
    );
    return { linearCommentId: null, threadRootId: knownThreadRootId ?? null };
  }
}

async function deleteLinearComment(
  token: string,
  linearCommentId: string,
): Promise<void> {
  try {
    const data = await linearGraphQL(token, DELETE_COMMENT_MUTATION, {
      id: linearCommentId,
    });

    if (!data.commentDelete?.success) {
      console.warn(
        `[deleteLinearComment] Linear returned success=false for comment=${linearCommentId}`,
      );
    } else {
      console.log(
        `[deleteLinearComment] Successfully deleted Linear comment=${linearCommentId}`,
      );
    }
  } catch (e: any) {
    console.error(
      `[deleteLinearComment] Failed to delete Linear comment=${linearCommentId}:`,
      e.message,
    );
  }
}

async function resolveLinearCommentIdByBody(
  token: string,
  projectUpdateId: string,
  commentBody: string,
  actorEmail: string | null,
): Promise<string | null> {
  try {
    const data = await linearGraphQL(token, GET_PROJECT_UPDATE_COMMENTS_QUERY, {
      id: projectUpdateId,
    });

    const nodes: any[] = data?.projectUpdate?.comments?.nodes ?? [];
    if (nodes.length === 0) {
      console.warn(
        `[resolveLinearCommentIdByBody] No Linear comments found for update=${projectUpdateId}`,
      );
      return null;
    }
    const candidateFormats: string[] = [];

    if (actorEmail) {
      candidateFormats.push(`_${actorEmail}_: ${commentBody}`);
      candidateFormats.push(`_Updated by: ${actorEmail}_\n\n${commentBody}`);
    }

    for (const fmt of candidateFormats) {
      const match = nodes.find((c) => c.body === fmt);
      if (match) {
        console.log(
          `[resolveLinearCommentIdByBody] Exact match found, id=${match.id}, format="${fmt.slice(0, 40)}"`,
        );
        return match.id;
      }
    }

    const rawMatch = nodes.find((c) => c.body === commentBody);
    if (rawMatch) {
      console.log(
        `[resolveLinearCommentIdByBody] Matched via raw body exact match, id=${rawMatch.id}`,
      );
      return rawMatch.id;
    }

    console.warn(
      `[resolveLinearCommentIdByBody] Could not find an exact match for body="${commentBody.slice(0, 60)}" — Linear comment will not be deleted.`,
    );
    return null;
  } catch (e: any) {
    console.error(`[resolveLinearCommentIdByBody] Query failed:`, e.message);
    return null;
  }
}

async function deleteLinearProjectUpdate(
  token: string,
  linearUpdateId: string,
): Promise<void> {
  try {
    const data = await linearGraphQL(token, DELETE_PROJECT_UPDATE_MUTATION, {
      id: linearUpdateId,
    });

    if (data.projectUpdateDelete?.success) {
      console.log(
        `[deleteLinearProjectUpdate] Hard-deleted Linear update=${linearUpdateId}`,
      );
      return;
    }
    console.warn(
      `[deleteLinearProjectUpdate] projectUpdateDelete returned success=false for update=${linearUpdateId}, trying archive...`,
    );
  } catch (e: any) {
    const isForbidden =
      e.message?.includes("403") ||
      e.message?.includes("FORBIDDEN") ||
      e.message?.includes("admin required") ||
      e.message?.includes("only be modified by its author");

    if (isForbidden) {
      console.warn(
        `[deleteLinearProjectUpdate] No permission to hard-delete update=${linearUpdateId}, trying archive...`,
      );
    } else {
      console.error(
        `[deleteLinearProjectUpdate] Unexpected error on delete for update=${linearUpdateId}:`,
        e.message,
      );
    }
  }

  try {
    const data = await linearGraphQL(token, ARCHIVE_PROJECT_UPDATE_MUTATION, {
      projectUpdateArchiveId: linearUpdateId,
    });

    if (data.projectUpdateArchive?.success) {
      console.log(
        `[deleteLinearProjectUpdate] Archived Linear update=${linearUpdateId}`,
      );
    } else {
      console.warn(
        `[deleteLinearProjectUpdate] Both delete and archive failed for update=${linearUpdateId}. ` +
        `DDB record is removed — Linear entry may need manual cleanup.`,
      );
    }
  } catch (e: any) {
    const isForbidden =
      e.message?.includes("403") ||
      e.message?.includes("FORBIDDEN") ||
      e.message?.includes("admin required") ||
      e.message?.includes("only be modified by its author");

    if (isForbidden) {
      console.warn(
        `[deleteLinearProjectUpdate] Permission denied for both delete and archive on update=${linearUpdateId}. ` +
        `DDB record is removed — Linear entry may need manual cleanup by the update author.`,
      );
    } else {
      console.error(
        `[deleteLinearProjectUpdate] Archive fallback failed for update=${linearUpdateId}:`,
        e.message,
      );
    }
  }
}

// ─── DynamoDB helpers ──────────────────────────────────────────────────────
async function getProjectFromDDB(projectId: string): Promise<any | null> {
  const result = await ddbClient.send(
    new QueryCommand({
      TableName: linearDeliveryTable,
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": projectId,
      },
    }),
  );

  if (result.Items && result.Items.length > 0) {
    return result.Items[0];
  }
  return null;
}

async function updateProjectInDDB(
  projectId: string,
  createdAt: string,
  fields: Record<string, any>,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;

  const setExpressions: string[] = [];
  const attrNames: Record<string, string> = {};
  const attrValues: Record<string, any> = {};

  for (const [key, value] of Object.entries(fields)) {
    const nameToken = `#f_${key}`;
    const valueToken = `:v_${key}`;
    setExpressions.push(`${nameToken} = ${valueToken}`);
    attrNames[nameToken] = key;
    attrValues[valueToken] = value;
  }

  await ddbClient.send(
    new UpdateCommand({
      TableName: linearDeliveryTable,
      Key: {
        id: projectId,
        created_at: createdAt,
      },
      UpdateExpression: `SET ${setExpressions.join(", ")}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    }),
  );
}

// ─── Handler: updateProject ────────────────────────────────────────────────
const _updateProject: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawId = event.pathParameters?.id ?? "";
    if (!rawId) return err("Missing path parameter: id", 400);
    const projectId = rawId.startsWith("proj_")
      ? rawId.slice("proj_".length)
      : rawId;

    let body: UpdateProjectInput;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return err("Invalid JSON body", 400);
    }

    const {
      name,
      description,
      content,
      statusId,
      status_name,
      priority,
      targetDate,
    } = body;

    const hasAnyField =
      name !== undefined ||
      description !== undefined ||
      content !== undefined ||
      statusId !== undefined ||
      priority !== undefined ||
      targetDate !== undefined;

    if (!hasAnyField) {
      return err(
        "At least one field required: name, description, content, statusId, priority, targetDate",
        400,
      );
    }

    if (priority !== undefined && !(priority in PRIORITY_LABEL_TO_NUM)) {
      return err(
        `Invalid priority: "${priority}". Valid values: ${Object.keys(PRIORITY_LABEL_TO_NUM).join(", ")}`,
        400,
      );
    }

    // ── clear_virtual_status flag ──────────────────────────────────────────
    const clearVirtualStatus = (body as any).clear_virtual_status === true;

    const existing = await getProjectFromDDB(projectId);
    if (!existing) return err(`Project not found: ${projectId}`, 404);
    if (existing.entity_type && existing.entity_type !== "PROJECT")
      return err(`Item ${projectId} is not a project`, 400);

    const linearInput: Record<string, any> = {};
    if (name !== undefined) linearInput.name = name;
    if (description !== undefined)
      linearInput.description = description === "" ? "" : description;
    if (content !== undefined) {
      linearInput.content = content === "" ? " " : content;
    }
    if (statusId !== undefined) linearInput.statusId = statusId;
    if (targetDate !== undefined) linearInput.targetDate = targetDate;
    if (priority !== undefined)
      linearInput.priority = PRIORITY_LABEL_TO_NUM[priority];

    const token = await getLinearToken();

    console.log(
      `[updateProject] projectId=${projectId} linearInput=`,
      JSON.stringify(linearInput, null, 2),
    );

    const linearData = await linearGraphQL(token, UPDATE_PROJECT_MUTATION, {
      id: projectId,
      input: linearInput,
    });

    if (!linearData.projectUpdate?.success) {
      return err("Linear projectUpdate returned success=false", 502);
    }

    const lp = linearData.projectUpdate.project;

    const actorEmail = resolveActorEmail(event, (body as any).user_email);

    const ddbFields: Record<string, any> = {
      updated_at: lp.updatedAt ?? new Date().toISOString(),
      updated_by: actorEmail,
    };
    if (name !== undefined) ddbFields.name = name;
    if (description !== undefined)
      ddbFields.description = description === "" ? null : description;
    if (content !== undefined)
      ddbFields.content = content === "" ? null : content;
    if (targetDate !== undefined) ddbFields.target_date = targetDate;
    if (priority !== undefined)
      ddbFields.priority = PRIORITY_LABEL_TO_NUM[priority];
    if (statusId !== undefined) {
      ddbFields.status_name =
        status_name ?? lp.status?.name ?? existing.status_name;
    }

    // ── Clear virtual_status when moving to a real Linear status ──────────
    if (clearVirtualStatus) {
      ddbFields.virtual_status = null;
    }

    await updateProjectInDDB(projectId, existing.created_at, ddbFields);

    return ok({
      success: true,
      project: {
        id: `proj_${projectId}`,
        name: ddbFields.name ?? existing.name,
        description:
          description !== undefined
            ? (ddbFields.description ?? null)
            : (existing.description ?? null),
        content:
          content !== undefined
            ? (ddbFields.content ?? null)
            : (existing.content ?? null),
        status_name: ddbFields.status_name ?? existing.status_name,
        priority:
          priority ?? PRIORITY_NUM_TO_LABEL[Number(existing.priority)] ?? null,
        targetDate: ddbFields.target_date ?? existing.target_date,
        updatedAt: ddbFields.updated_at,
      },
    });
  } catch (e: any) {
    console.error("[updateProject] error:", e);
    return err(e.message || "Internal error");
  }
};
export const updateProject = withPermissions(_updateProject);

// ─── Handler: setVirtualStatus ─────────────────────────────────────────────
// Sets a virtual status on a project in DDB only — no Linear call is made.
// Used for the IN_QA_REVIEW board column which does not exist in Linear.
const _setVirtualStatus: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawId = event.pathParameters?.id ?? "";
    if (!rawId) return err("Missing path parameter: id", 400);
    const projectId = rawId.startsWith("proj_") ? rawId.slice(5) : rawId;

    const body = JSON.parse(event.body ?? "{}");
    const { virtual_status } = body;

    if (!virtual_status) return err("virtual_status is required", 400);

    const existing = await getProjectFromDDB(projectId);
    if (!existing) return err(`Project not found: ${projectId}`, 404);

    const actorEmail = resolveActorEmail(event, body.user_email);

    await updateProjectInDDB(projectId, existing.created_at, {
      virtual_status,
      updated_at: new Date().toISOString(),
      updated_by: actorEmail,
    });

    return ok({ success: true, virtual_status });
  } catch (e: any) {
    console.error("[setVirtualStatus] error:", e);
    return err(e.message || "Internal error");
  }
};
export const setVirtualStatus = withPermissions(_setVirtualStatus);

// ─── Handler: addProjectUpdate ─────────────────────────────────────────────
const _addProjectUpdate: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawId = event.pathParameters?.id ?? "";
    if (!rawId) return err("Missing path parameter: id", 400);

    let body: AddProjectUpdateInput;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return err("Invalid JSON body", 400);
    }

    const { body: noteBody, health, user_email } = body;

    if (!noteBody?.trim()) return err("body is required", 400);

    const validHealth = ["onTrack", "atRisk", "offTrack"];
    if (!validHealth.includes(health)) {
      return err(
        `Invalid health. Must be one of: ${validHealth.join(", ")}`,
        400,
      );
    }

    const actorEmail = resolveActorEmail(event, user_email);
    const bodyWithAuthor = `_Updated by: ${actorEmail}_\n\n${noteBody}`;

    const existing = await getProjectFromDDB(rawId);
    if (!existing) return err(`Project not found: ${rawId}`, 404);

    const token = await getLinearToken();

    const linearData = await linearGraphQL(
      token,
      CREATE_PROJECT_UPDATE_MUTATION,
      {
        input: {
          projectId: rawId,
          body: bodyWithAuthor,
          health,
        },
      },
    );

    if (!linearData.projectUpdateCreate?.success) {
      return err("Linear projectUpdateCreate returned success=false", 502);
    }

    const created = linearData.projectUpdateCreate.projectUpdate;

    const existingUpdates: any[] = Array.isArray(existing.project_updates)
      ? existing.project_updates
      : [];

    const newEntry = {
      id: created.id,
      health: created.health,
      body: noteBody,
      created_at: created.createdAt,
      user_name: actorEmail,
      user_email: actorEmail,
      comments: [],
      linear_thread_root_id: null,
    };

    await updateProjectInDDB(rawId, existing.created_at, {
      project_updates: [...existingUpdates, newEntry],
      updated_at: new Date().toISOString(),
      updated_by: actorEmail,
    });

    return ok({
      success: true,
      projectUpdate: {
        id: newEntry.id,
        health: newEntry.health,
        body: newEntry.body,
        created_at: newEntry.created_at,
        user_name: newEntry.user_name,
        user_email: newEntry.user_email,
        comments: [],
      },
    });
  } catch (e: any) {
    console.error("[addProjectUpdate] error:", e);
    return err(e.message || "Internal error");
  }
};
export const addProjectUpdate = withPermissions(_addProjectUpdate);

// ─── Handler: getProjectStatuses ───────────────────────────────────────────
const _getProjectStatuses: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const token = await getLinearToken();
    const data = await linearGraphQL(token, GET_PROJECT_STATUSES_QUERY);

    const statuses = (data.projectStatuses?.nodes ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      color: s.color ?? null,
    }));

    return ok({ statuses });
  } catch (e: any) {
    console.error("[getProjectStatuses] error:", e);
    return err(e.message || "Internal error");
  }
};
export const getProjectStatuses = withPermissions(_getProjectStatuses);

// ─── Handler: addUpdateComment ─────────────────────────────────────────────
const _addUpdateComment: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawProjectId = event.pathParameters?.id ?? "";
    const updateId = event.pathParameters?.updateId ?? "";

    if (!rawProjectId) return err("Missing path parameter: id", 400);
    if (!updateId) return err("Missing path parameter: updateId", 400);

    let body: AddUpdateCommentInput;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return err("Invalid JSON body", 400);
    }

    const { body: commentBody, user_email } = body;
    if (!commentBody?.trim()) return err("body is required", 400);

    const actorEmail = resolveActorEmail(event, user_email);

    const existing = await getProjectFromDDB(rawProjectId);
    if (!existing) return err(`Project not found: ${rawProjectId}`, 404);

    const existingUpdates: any[] = Array.isArray(existing.project_updates)
      ? existing.project_updates
      : [];

    const updateIndex = existingUpdates.findIndex((u) => u.id === updateId);
    if (updateIndex === -1)
      return err(`Project update not found: ${updateId}`, 404);

    const targetUpdate = existingUpdates[updateIndex];

    let linearCommentId: string | null = null;
    let newThreadRootId: string | null =
      targetUpdate.linear_thread_root_id ?? null;

    try {
      const token = await getLinearToken();
      const result = await createLinearComment(
        token,
        updateId,
        commentBody.trim(),
        actorEmail,
        newThreadRootId,
      );
      linearCommentId = result.linearCommentId;
      if (result.threadRootId && !targetUpdate.linear_thread_root_id) {
        newThreadRootId = result.threadRootId;
      }
    } catch (syncErr: any) {
      console.error("[addUpdateComment] Linear sync error:", syncErr.message);
    }

    const newComment = {
      id: randomUUID(),
      linear_comment_id: linearCommentId,
      body: commentBody.trim(),
      created_at: new Date().toISOString(),
      user_name: actorEmail,
      user_email: actorEmail,
    };

    const updatedUpdates = [...existingUpdates];
    updatedUpdates[updateIndex] = {
      ...targetUpdate,
      linear_thread_root_id: newThreadRootId,
      comments: [...(targetUpdate.comments ?? []), newComment],
    };

    await updateProjectInDDB(rawProjectId, existing.created_at, {
      project_updates: updatedUpdates,
      updated_at: new Date().toISOString(),
      updated_by: actorEmail,
    });

    return ok({
      success: true,
      comment: {
        id: newComment.id,
        body: newComment.body,
        created_at: newComment.created_at,
        user_name: newComment.user_name,
        user_email: newComment.user_email,
      },
    });
  } catch (e: any) {
    console.error("[addUpdateComment] error:", e);
    return err(e.message || "Internal error");
  }
};
export const addUpdateComment = withPermissions(_addUpdateComment);

// ─── Handler: deleteProjectUpdate ──────────────────────────────────────────
const _deleteProjectUpdate: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawProjectId = event.pathParameters?.id ?? "";
    const updateId = event.pathParameters?.updateId ?? "";

    if (!rawProjectId) return err("Missing path parameter: id", 400);
    if (!updateId) return err("Missing path parameter: updateId", 400);

    const existing = await getProjectFromDDB(rawProjectId);
    if (!existing) return err(`Project not found: ${rawProjectId}`, 404);

    const existingUpdates: any[] = Array.isArray(existing.project_updates)
      ? existing.project_updates
      : [];

    const updateIndex = existingUpdates.findIndex((u) => u.id === updateId);
    if (updateIndex === -1)
      return err(`Project update not found: ${updateId}`, 404);

    try {
      const token = await getLinearAdminToken();
      await deleteLinearProjectUpdate(token, updateId);
    } catch (linearErr: any) {
      const isForbidden =
        linearErr.statusCode === 403 ||
        linearErr.message?.includes("Admin role is required") ||
        linearErr.message?.includes("admin required") ||
        linearErr.message?.includes("only be modified by its author");

      if (isForbidden) {
        console.warn(
          `[deleteProjectUpdate] Linear permission denied for update=${updateId}. DDB unchanged.`,
        );
        return err(
          "You do not have permission to delete this project update. " +
          "Admin role is required to delete updates created by other users.",
          403,
        );
      }

      console.error(
        `[deleteProjectUpdate] Linear error for update=${updateId}:`,
        linearErr.message,
      );
      return err(
        `Failed to delete project update in Linear: ${linearErr.message}`,
        502,
      );
    }

    const filteredUpdates = existingUpdates.filter((u) => u.id !== updateId);

    await updateProjectInDDB(rawProjectId, existing.created_at, {
      project_updates: filteredUpdates,
      updated_at: new Date().toISOString(),
      updated_by: resolveActorEmail(event),
    });

    console.log(
      `[deleteProjectUpdate] Linear deleted and DDB updated. Removed update=${updateId} from project=${rawProjectId}`,
    );

    return ok({ success: true });
  } catch (e: any) {
    console.error("[deleteProjectUpdate] error:", e);
    return err(e.message || "Internal error");
  }
};
export const deleteProjectUpdate = withPermissions(_deleteProjectUpdate);

// ─── Handler: deleteUpdateComment ──────────────────────────────────────────
const _deleteUpdateComment: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = authorizeUser(event, UserRole.ENGINEER);
    if (isAuthError(auth)) return auth.error;

    const rawProjectId = event.pathParameters?.id ?? "";
    const updateId = event.pathParameters?.updateId ?? "";
    const commentId = event.pathParameters?.commentId ?? "";

    if (!rawProjectId) return err("Missing path parameter: id", 400);
    if (!updateId) return err("Missing path parameter: updateId", 400);
    if (!commentId) return err("Missing path parameter: commentId", 400);

    const existing = await getProjectFromDDB(rawProjectId);
    if (!existing) return err(`Project not found: ${rawProjectId}`, 404);

    const existingUpdates: any[] = Array.isArray(existing.project_updates)
      ? existing.project_updates
      : [];

    const updateIndex = existingUpdates.findIndex((u) => u.id === updateId);
    if (updateIndex === -1)
      return err(`Project update not found: ${updateId}`, 404);

    const targetUpdate = existingUpdates[updateIndex];
    const existingComments: any[] = Array.isArray(targetUpdate.comments)
      ? targetUpdate.comments
      : [];

    const targetComment = existingComments.find((c) => c.id === commentId);
    if (!targetComment) return err(`Comment not found: ${commentId}`, 404);

    const isFirstComment = existingComments[0]?.id === commentId;
    const commentsToDeleteFromLinear = isFirstComment
      ? existingComments
      : [targetComment];
    const updatedComments = isFirstComment
      ? []
      : existingComments.filter((c) => c.id !== commentId);

    const updatedUpdates = [...existingUpdates];
    updatedUpdates[updateIndex] = {
      ...targetUpdate,
      comments: updatedComments,
      ...(updatedComments.length === 0 ? { linear_thread_root_id: null } : {}),
    };

    await updateProjectInDDB(rawProjectId, existing.created_at, {
      project_updates: updatedUpdates,
      updated_at: new Date().toISOString(),
      updated_by: resolveActorEmail(event),
    });

    console.log(
      `[deleteUpdateComment] DDB updated. isFirstComment=${isFirstComment}, deleted=${commentsToDeleteFromLinear.length} comment(s) from update=${updateId}`,
    );

    try {
      const token = await getLinearAdminToken();

      for (const comment of commentsToDeleteFromLinear) {
        let linearCommentId: string | null = comment.linear_comment_id ?? null;

        if (!linearCommentId) {
          console.log(
            `[deleteUpdateComment] No stored linear_comment_id for comment=${comment.id} — resolving by body match.`,
          );
          linearCommentId = await resolveLinearCommentIdByBody(
            token,
            updateId,
            comment.body,
            comment.user_email ?? comment.user_name ?? null,
          );
        }

        if (linearCommentId) {
          await deleteLinearComment(token, linearCommentId);
        } else {
          console.warn(
            `[deleteUpdateComment] Could not resolve Linear comment for comment=${comment.id} — skipping.`,
          );
        }
      }

      console.log(
        `[deleteUpdateComment] Deleted ${commentsToDeleteFromLinear.length} comment(s) from Linear for update=${updateId}`,
      );
    } catch (syncErr: any) {
      console.error(
        "[deleteUpdateComment] Linear sync error:",
        syncErr.message,
      );
    }

    return ok({ success: true });
  } catch (e: any) {
    console.error("[deleteUpdateComment] error:", e);
    return err(e.message || "Internal error");
  }
};
export const deleteUpdateComment = withPermissions(_deleteUpdateComment);