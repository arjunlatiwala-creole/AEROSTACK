import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Shield, Loader2, AlertCircle, Lock, Trash2 } from "lucide-react";
import type { ColDef, RowClassParams, RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import "@/lib/ag-grid-config";
import { listRoleUsers, deleteUser, type RoleUser, type GivenRole } from "@/api/roles";
import { usePermissions } from "@/context/PermissionsContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ROLE_STYLES: Record<GivenRole, string> = {
  "Super-Admin":
    "bg-gradient-to-r from-violet-600 to-purple-700 text-white border-0",
  Admin: "bg-gradient-to-r from-blue-600 to-indigo-700 text-white border-0",
  Seller: "bg-gradient-to-r from-emerald-600 to-teal-700 text-white border-0",
  User: "bg-muted text-muted-foreground",
};

/** Returns true if this user's email marks them as a hardcoded Super-Admin */
function isWillAccount(email: string): boolean {
  return email.toLowerCase() === "will@enterprise.io";
}

export default function DashboardRoles() {
  const navigate = useNavigate();
  const { givenRole: myGivenRole } = usePermissions();
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoleUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const data = await listRoleUsers();
        setUsers(data);
      } catch (err: any) {
        setError(err.message || "Failed to load users");
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  /**
   * A row is "locked" when:
   * - The target user is a Will/Super-Admin account (hardcoded)
   * - OR the viewer is an Admin trying to see a Super-Admin
   */
  const isLocked = (user: RoleUser) => {
    // Super-Admin can edit everyone.
    if (myGivenRole === "Super-Admin") return false;

    // Admin cannot edit Super-Admins (including hardcoded "will" accounts).
    const isTargetSuperAdmin =
      user.givenRole === "Super-Admin" || isWillAccount(user.email);
    return myGivenRole === "Admin" && isTargetSuperAdmin;
  };

  /**
   * Can the current viewer assign role/permissions to this user?
   * - Super-Admin: can manage anyone
   * - Admin: can manage Admin, Seller, User (not Super-Admin, not Will accounts)
   */
  const canManage = (user: RoleUser) =>
    !isLocked(user) &&
    (myGivenRole === "Super-Admin" || myGivenRole === "Admin");

  /** Will accounts always display as Super-Admin */
  const displayRoleOf = (user: RoleUser): GivenRole =>
    isWillAccount(user.email) ? "Super-Admin" : user.givenRole || "User";

  const colDefs: ColDef<RoleUser>[] = useMemo(
    () => [
      {
        field: "email",
        headerName: "Email",
        flex: 1.6,
        filter: true,
        cellRenderer: (params: any) => {
          const user: RoleUser = params.data;
          return (
            <span className="flex items-center gap-2 font-medium">
              {user.email}
              {isLocked(user) && (
                <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </span>
          );
        },
      },
      {
        field: "givenRole",
        headerName: "Role",
        flex: 1,
        filter: true,
        valueGetter: (params) => displayRoleOf(params.data as RoleUser),
        cellRenderer: (params: any) => {
          const displayRole = params.value as GivenRole;
          return (
            <span
              className={[
                "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold",
                ROLE_STYLES[displayRole] || ROLE_STYLES["User"],
              ].join(" ")}
            >
              {displayRole === "Super-Admin" && <Lock className="h-2.5 w-2.5" />}
              {displayRole}
            </span>
          );
        },
      },
      {
        field: "personId",
        headerName: "Person ID",
        flex: 1.6,
        filter: true,
        cellRenderer: (params: any) => (
          <span className="text-xs font-mono text-muted-foreground">
            {params.value}
          </span>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 1,
        filter: true,
        cellRenderer: (params: any) => (
          <Badge
            variant={params.value === "CONFIRMED" ? "default" : "secondary"}
            className="text-xs"
          >
            {params.value}
          </Badge>
        ),
      },
      {
        field: "emailVerified",
        headerName: "Email Verified",
        flex: 1,
        valueFormatter: ({ value }) => (value ? "Yes" : "No"),
        cellRenderer: (params: any) => (
          <Badge variant={params.value ? "default" : "outline"} className="text-xs">
            {params.value ? "Yes" : "No"}
          </Badge>
        ),
      },
      {
        field: "createdAt",
        headerName: "Created At",
        flex: 1,
        valueFormatter: ({ value }) =>
          value ? new Date(value).toLocaleDateString() : "—",
      },
      {
        field: "updated_by",
        headerName: "Role Assigned By",
        flex: 1.3,
        filter: true,
        valueFormatter: ({ value }) => value || "—",
      },
      {
        field: "updatedAt",
        headerName: "Updated At",
        flex: 1,
        valueFormatter: ({ value }) =>
          value ? new Date(value).toLocaleDateString() : "—",
      },
      {
        headerName: "Actions",
        flex: 0.7,
        sortable: false,
        filter: false,
        cellRenderer: (params: any) => {
          const user: RoleUser = params.data;
          if (!canManage(user)) return null;
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Remove user"
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete(user);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          );
        },
      },
    ],
    // Re-evaluate lock/manage logic whenever the viewer's role changes
    [myGivenRole],
  );

  const handleRowClicked = (event: RowClickedEvent<RoleUser>) => {
    const user = event.data;
    if (!user || isLocked(user)) return;
    navigate(`/roles/${user.personId}`);
  };

  const getRowClass = (params: RowClassParams<RoleUser>) =>
    params.data && isLocked(params.data)
      ? "roles-row-locked"
      : "roles-row-clickable";

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteUser(pendingDelete.personId);
      setUsers((prev) => prev.filter((u) => u.personId !== pendingDelete.personId));
      setPendingDelete(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || "Failed to remove user");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 w-full space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
          <p className="text-muted-foreground text-sm">
            Manage user roles, permissions, and access control across the
            platform.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading users…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div
            className="ag-theme-alpine w-full"
            style={{ height: "calc(100vh - 220px)" }}
          >
            <AgGridReact<RoleUser>
              theme="legacy"
              rowData={users}
              columnDefs={colDefs}
              getRowId={(params) => params.data.personId}
              getRowClass={getRowClass}
              onRowClicked={handleRowClicked}
              rowHeight={48}
              defaultColDef={{
                sortable: true,
                filter: true,
                resizable: true,
              }}
              overlayNoRowsTemplate={`
                <div style="padding:16px; font-size:14px; color:#666;">
                  No users found.
                </div>
              `}
            />
          </div>
        </div>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {pendingDelete?.email}
              </span>{" "}
              from Cognito and the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
