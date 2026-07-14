import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
/**
 * User information extracted from Cognito JWT token
 */
export interface CognitoUser {
  sub: string;
  email: string;
  username: string;
  role: string;
  customAttributes: Record<string, string>;
  groups?: string[];
}

/**
 * Available user roles in the system
 */
export enum UserRole {
  ADMIN = "admin",
  ENGINEER = "engineer",
}

/**
 * High-level role label assigned to every user at signup.
 * - User       : default for all new sign-ups
 * - Seller     : marketplace / commercial access
 * - Admin      : platform administration
 * - Super-Admin: unrestricted platform access
 */
export enum GivenRole {
  USER = "User",
  SELLER = "Seller",
  ADMIN = "Admin",
  SUPER_ADMIN = "Super-Admin",
}

/**
 * Extracts authenticated user information from API Gateway event
 */
export function getCognitoUser(event: APIGatewayProxyEvent): CognitoUser | null {
  try {
    const claims =
      (event.requestContext as any).authorizer?.claims ||
      (event.requestContext as any).authorizer?.jwt?.claims;

    if (!claims) {
      return null;
    }

    const sub = claims.sub;
    const email = claims.email || claims["cognito:username"];
    const username = claims["cognito:username"] || claims.email;
    const role = claims["custom:role"] || UserRole.ENGINEER;

    const groupsString = claims["cognito:groups"];
    const groups = groupsString ? groupsString.split(",") : [];

    const customAttributes: Record<string, string> = {};
    Object.keys(claims).forEach((key) => {
      if (key.startsWith("custom:")) {
        const attrName = key.replace("custom:", "");
        customAttributes[attrName] = claims[key];
      }
    });

    return {
      sub,
      email,
      username,
      role,
      customAttributes,
      groups,
    };
  } catch (error) {
    console.error("Error extracting Cognito user:", error);
    return null;
  }
}

/**
 * Checks if user has required role based on a hierarchy:
 * admin > engineer
 */
export function hasRole(userRole: string, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<string, number> = {
    [UserRole.ENGINEER]: 1,
    [UserRole.ADMIN]: 2,
  };

  const userLevel = roleHierarchy[userRole.toLowerCase()] || 0;
  const requiredLevel = roleHierarchy[requiredRole] || 0;

  return userLevel >= requiredLevel;
}

/**
 * Checks if user has any of the specified roles
 */
export function hasAnyRole(userRole: string, allowedRoles: UserRole[]): boolean {
  return allowedRoles.some(role =>
    userRole.toLowerCase() === role.toLowerCase()
  );
}

export function unauthorizedResponse(message = "User not authenticated"): APIGatewayProxyResult {
  return {
    statusCode: 401,
    body: JSON.stringify({
      success: false,
      error: message,
      code: "UNAUTHORIZED",
    }),
  };
}

export function forbiddenResponse(
  message = "User does not have required permissions",
  requiredRole?: UserRole
): APIGatewayProxyResult {
  return {
    statusCode: 403,
    body: JSON.stringify({
      success: false,
      error: message,
      code: "FORBIDDEN",
      ...(requiredRole && { requiredRole }),
    }),
  };
}

/**
 * Middleware-style authorization checker for Lambda handlers
 */
export function authorizeUser(
  event: APIGatewayProxyEvent,
  requiredRole: UserRole = UserRole.ENGINEER
): { user: CognitoUser } | { error: APIGatewayProxyResult } {
  const user = getCognitoUser(event);


  if (user) {
    return { user };
  }

  if (process.env.AWS_SAM_LOCAL === "true") {
    console.log("Allowing unauthenticated SAM local user");
    const devUser: CognitoUser = {
      sub: "dev-user",
      email: "dev@example.com",
      username: "dev-user",
      role: requiredRole,
      customAttributes: {},
      groups: [],
    };
    return { user: devUser };
  }


  return {
    error: unauthorizedResponse("User not found in request context"),
  };
}


/**
 * Type guard to check if result is an error
 */
export function isAuthError(
  result: { user: CognitoUser } | { error: APIGatewayProxyResult }
): result is { error: APIGatewayProxyResult } {
  return "error" in result;
}

/**
 * Resolves the actor's email from various potential sources in the request.
 * Order of precedence:
 *   1. explicit value passed in the request body
 *   2. Cognito JWT claim (`email` or `cognito:username`)
 *   3. ?email query parameter
 *   4. dev placeholder (only when AWS_SAM_LOCAL is true)
 *   5. literal "unknown"
 */
export function resolveActorEmail(event: any, bodyEmail?: string): string {
  if (bodyEmail?.trim()) return bodyEmail.trim();

  const claims =
    event?.requestContext?.authorizer?.claims ||
    event?.requestContext?.authorizer?.jwt?.claims;

  if (claims?.email) return claims.email;
  if (claims?.["cognito:username"]) return claims["cognito:username"];

  if (event?.queryStringParameters?.email)
    return event.queryStringParameters.email;

  if (process.env.AWS_SAM_LOCAL === "true") return "dev@example.com";

  return "unknown";
}
