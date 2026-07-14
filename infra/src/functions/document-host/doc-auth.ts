import type { APIGatewayProxyEvent } from "aws-lambda";

export interface DocUser {
  personId: string;
  email: string;
  role: string;
}

/**
 * Extracts user info (personId, email, role) from the API Gateway event.
 * Handles both Cognito authorizer claims and SAM local JWT decoding.
 */
export function extractUser(event: unknown): DocUser {
  const evt = event as {
    requestContext?: { authorizer?: { claims?: Record<string, string> } };
    headers?: Record<string, string>;
  };

  const claims = evt.requestContext?.authorizer?.claims;
  let personId = claims?.sub ?? "system";
  let email = claims?.email ?? "unknown";
  let role = claims?.["givenRole"] ?? claims?.["custom:givenRole"] ?? "member";

  // Also check cognito:groups for admin/superadmin
  const groups = claims?.["cognito:groups"] ?? "";
  if (groups.toLowerCase().includes("admin") || groups.toLowerCase().includes("superadmin")) {
    role = "admin";
  }

  // SAM local: decode JWT manually to get full claims
  if (process.env.AWS_SAM_LOCAL === "true") {
    const token = (evt.headers?.Authorization ?? evt.headers?.authorization ?? "").replace("Bearer ", "");
    if (token) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
          personId = payload.sub ?? personId;
          email = payload.email ?? email;
          role = payload.givenRole ?? payload["custom:givenRole"] ?? role;
          const localGroups = payload["cognito:groups"] ?? "";
          if (typeof localGroups === "string" && (localGroups.toLowerCase().includes("admin") || localGroups.toLowerCase().includes("superadmin"))) {
            role = "admin";
          }
          if (Array.isArray(localGroups) && localGroups.some((g: string) => g.toLowerCase().includes("admin"))) {
            role = "admin";
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Normalize role — handle PascalCase from Cognito (Admin, Super-Admin)
  const normalizedRole = role.toLowerCase().replace("-", "");
  if (normalizedRole === "admin" || normalizedRole === "superadmin") {
    role = "admin";
  }

  console.log(`[DOC-AUTH] User: email=${email}, role=${role}, personId=${personId}`);

  return { personId, email, role };
}

/**
 * Checks if the user can modify (edit/delete) a document.
 * - admin/superadmin: full access to all documents
 * - others: can only modify documents they own (created_by matches or owner_email matches)
 */
export function canModifyDocument(
  user: DocUser,
  document: Record<string, unknown>,
): boolean {
  // Admins can do anything
  if (user.role === "admin" || user.role === "superadmin") {
    return true;
  }

  // Owner check: match by personId (sub) or email
  const docCreatedBy = document.created_by as string | undefined;
  const docOwnerEmail = document.owner_email as string | undefined;

  if (docCreatedBy && docCreatedBy === user.personId) {
    return true;
  }

  if (docOwnerEmail && docOwnerEmail.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }

  return false;
}
