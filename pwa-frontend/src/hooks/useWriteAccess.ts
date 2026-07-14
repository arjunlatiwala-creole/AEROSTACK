import { usePermissions } from "@/context/PermissionsContext";
import { useLocation } from "react-router";
import { resolvePermissionKey } from "@/lib/permission-map";

/**
 * Hook to determine if the user has write access to the current view.
 * It checks the write permission for the current path or the 'from' path in location state.
 */
export function useWriteAccess(overrideKey?: string): { canWrite: boolean; permissionKey: string | null } {
    const { hasWriteAccess } = usePermissions();
    const location = useLocation();

    // 1. Identify current path or the source path that brought us here
    const targetPath = location.state?.from || location.pathname;

    // 2. Resolve target path to permission key if overrideKey not set
    const permissionKey = overrideKey || resolvePermissionKey(targetPath);

    // 3. Check for write access
    if (!permissionKey) return { canWrite: false, permissionKey: null };

    return { 
        canWrite: hasWriteAccess(permissionKey),
        permissionKey 
    };
}
