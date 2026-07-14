import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/context/auth/AuthContext";
import { getMyRole, type GivenRole } from "@/api/roles";
import { checkPermission, hasAnyAccess, checkWritePermission } from "@/lib/permission-map";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permission-defaults";
import { getPermissionsFromClaims } from "@/lib/claims-permissions";

interface PermissionsContextType {
  userRole: Record<string, any> | null;
  givenRole: GivenRole;
  loading: boolean;
  hasPermission: (permissionKey: string, accessType?: "read" | "write") => boolean;
  hasWriteAccess: (permissionKey: string) => boolean;
  canAccess: (permissionKey: string) => boolean;
  refetch: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  userRole: null,
  givenRole: "User",
  loading: true,
  hasPermission: () => true,
  hasWriteAccess: () => true,
  canAccess: () => true,
  refetch: async () => { },
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [userRole, setUserRole] = useState<Record<string, any> | null>(null);
  const [givenRole, setGivenRole] = useState<GivenRole>("User");
  const [loading, setLoading] = useState(true);

  const fetchPermissions = async () => {
    try {
      // ------------------------------------------------------------------
      // Claims path (Phase 2+): read permissions from JWT token claims.
      // Only active once the Pre-Token Generation Lambda is deployed and the
      // user has been assigned to a Cognito group. Returns null otherwise.
      // ------------------------------------------------------------------
      const claimsResult = await getPermissionsFromClaims();

      if (claimsResult) {
        // Apply will@enterprise.io override on the claims path too.
        const email = auth?.user?.username || "";
        const given: GivenRole =
          email.toLowerCase() === "will@enterprise.io"
            ? "Super-Admin"
            : claimsResult.givenRole;

        let role =
          email.toLowerCase() === "will@enterprise.io"
            ? ROLE_DEFAULT_PERMISSIONS["Super-Admin"]
            : claimsResult.userRole;

        // Enforce hiring-tools restriction: only Super-Admin gets access.
        if (given !== "Super-Admin" && role) {
          role = {
            ...role,
            tools: { ...(role.tools ?? {}), "hiring-tools": [] },
          };
        }

        setUserRole(role);
        setGivenRole(given);
        return;
      }

      // ------------------------------------------------------------------
      // DynamoDB fallback (Phase 1 / unmigrated users): existing behavior.
      // ------------------------------------------------------------------
      const data = await getMyRole();

      let given = data.givenRole || "User";
      let role = data.userRole;

      // Hardcoded Super-Admin for "will@enterprise.io"
      const email = auth?.user?.username || "";
      if (email.toLowerCase() === "will@enterprise.io") {
        given = "Super-Admin";
      }

      // Super-Admin always gets FULL_ACCESS — ignore stale stored role
      if (given === "Super-Admin" || given === "Admin") {
        role = ROLE_DEFAULT_PERMISSIONS[given];
      } else if (!role || Object.keys(role).length === 0) {
        role = ROLE_DEFAULT_PERMISSIONS[given] || ROLE_DEFAULT_PERMISSIONS.User;
      }

      // Enforce hiring-tools restriction: only Super-Admin gets access.
      // This runs after role resolution to catch stale stored roles that
      // predate the hiring-tools key being added to the permission schema.
      if (given !== "Super-Admin" && role) {
        role = {
          ...role,
          tools: {
            ...(role.tools ?? {}),
            "hiring-tools": [],
          },
        };
      }

      setUserRole(role);
      setGivenRole(given as GivenRole);
    } catch (error) {
      console.warn("Failed to fetch permissions:", error);
      // Dev mode: default to Super-Admin so all nav items are visible
      const isDevMode = import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX";
      if (isDevMode) {
        setUserRole(ROLE_DEFAULT_PERMISSIONS["Super-Admin"]);
        setGivenRole("Super-Admin");
      } else {
        setUserRole(ROLE_DEFAULT_PERMISSIONS.User);
        setGivenRole("User");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth?.user) {
      fetchPermissions();
    } else {
      setLoading(false);
    }
  }, [auth?.user]);

  const hasPermission = (
    permissionKey: string,
    accessType: "read" | "write" = "read",
  ): boolean => {
    return checkPermission(userRole, permissionKey, accessType);
  };

  const hasWriteAccess = (permissionKey: string): boolean => {
    return checkWritePermission(userRole, permissionKey);
  };

  const canAccess = (permissionKey: string): boolean => {
    return hasAnyAccess(userRole, permissionKey);
  };

  return (
    <PermissionsContext.Provider
      value={{ userRole, givenRole, loading, hasPermission, hasWriteAccess, canAccess, refetch: fetchPermissions }}
    >
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionsContext);
