import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Shield,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Save,
  Tag,
  Wand2,
  Lock,
  ChevronUp,
  Trash2,
} from "lucide-react";
import {
  listRoleUsers,
  saveUserRole,
  saveGivenRole,
  deleteUser,
  type RoleUser,
  type GivenRole,
} from "@/api/roles";
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
import { useAuth } from "@/context/auth/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchAuthSession } from "aws-amplify/auth";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Permission = "read" | "write";

interface PermissionState {
  [key: string]: Permission[];
}

type FullPermissions = {
  "enterprise-aerostack": Permission[];
  "my-aerostack": Permission[];
  operations: PermissionState;
  tools: PermissionState;
  resources: PermissionState;
  agents: PermissionState;
  system: PermissionState;
};

// Full access — used by Admin and Super-Admin defaults
const DEFAULT_PERMISSIONS: FullPermissions = {
  "enterprise-aerostack": ["read", "write"],
  "my-aerostack": ["read", "write"],
  operations: {
    revops: ["read", "write"],
    financials: ["read", "write"],
    engineering: ["read", "write"],
    "people-ops": ["read", "write"],
  },
  tools: {
    perspex: ["read", "write"],
    engagement: ["read", "write"],
    // "content-arch": ["read", "write"],
    calcs: ["read", "write"],
    "opps-tools": ["read", "write"],
    // "sow-tools": ["read", "write"],
    "delivery-tools": ["read", "write"],
    // "csat-tools": ["read", "write"],
    // "data-tools": ["read", "write"],
    // "email-extractor": ["read", "write"],
    knowledge: ["read", "write"],
    // "slack-admin": ["read", "write"],
    "zoom-recordings": ["read", "write"],
    "hiring-tools": ["read", "write"],
  },
  resources: {
    "enterprise-work": ["read", "write"],
    // people: ["read", "write"],
    opportunities: ["read", "write"],
    delivery: ["read", "write"],
    learning: ["read", "write"],
  },
  agents: {
    agents: ["read", "write"],
    // "workflow-ledger": ["read", "write"],
  },
  system: {
    integrations: ["read", "write"],
    // mcp: ["read", "write"],
    roles: ["read", "write"],
    // setup: ["read", "write"],
  },
};

// No access — empty permissions for all items
const NO_PERMISSIONS: FullPermissions = {
  "enterprise-aerostack": [],
  "my-aerostack": [],
  operations: {
    revops: [],
    financials: [],
    engineering: [],
    "people-ops": [],
  },
  tools: {
    perspex: [],
    engagement: [],
    // "content-arch": [],
    calcs: [],
    "opps-tools": [],
    // "sow-tools": [],
    "delivery-tools": [],
    // "csat-tools": [],
    // "data-tools": [],
    // "email-extractor": [],
    knowledge: [],
    // "slack-admin": [],
    "zoom-recordings": [],
    "hiring-tools": [],
  },
  resources: {
    "enterprise-work": [],
    // people: [],
    opportunities: [],
    delivery: [],
    learning: [],
  },
  agents: {
    agents: [],
    // "workflow-ledger": []
  },
  system: {
    integrations: [],
    // mcp: [],
    roles: [],
    // setup: []
  },
};

/**
 * Default permission sets per role.
 * User: enterprise-aerostack, myaerostack, engineering, enterprise work, opportunities, delivery, learning
 * Seller: enterprise aerostack, my aerostack, perspex, engagement, people
 */
const ROLE_DEFAULT_PERMISSIONS: Record<GivenRole, FullPermissions> = {
  User: {
    ...NO_PERMISSIONS,
    "enterprise-aerostack": ["read", "write"],
    "my-aerostack": ["read", "write"],
    operations: {
      ...NO_PERMISSIONS.operations,
      engineering: ["read", "write"],
    },
    tools: {
      ...NO_PERMISSIONS.tools,
      perspex: ["read", "write"],
      engagement: ["read", "write"],
      calcs: ["read", "write"],
      // "sow-tools": ["read", "write"],
      "delivery-tools": ["read", "write"],
    },
    resources: {
      ...NO_PERMISSIONS.resources,
      "enterprise-work": ["read", "write"],
      // opportunities: ["read", "write"],
      delivery: ["read", "write"],
      learning: ["read", "write"],
    },
  },
  Seller: {
    ...NO_PERMISSIONS,
    "enterprise-aerostack": ["read", "write"],
    "my-aerostack": ["read", "write"],
    operations: {
      ...NO_PERMISSIONS.operations,
      revops: ["read", "write"],
    },
    tools: {
      ...NO_PERMISSIONS.tools,
      perspex: ["read", "write"],
      engagement: ["read", "write"],
      "opps-tools": ["read", "write"],
      // "sow-tools": ["read", "write"],
      // "csat-tools": ["read", "write"],
      // "email-extractor": ["read", "write"],
    },
    resources: {
      ...NO_PERMISSIONS.resources,
      "enterprise-work": ["read", "write"],
      opportunities: ["read", "write"],
      // delivery: ["read", "write"],
      learning: ["read", "write"],
    },
  },
  Admin: (() => {
    const perms = structuredClone(DEFAULT_PERMISSIONS);
    perms.tools["hiring-tools"] = [];
    return perms;
  })(),
  "Super-Admin": structuredClone(DEFAULT_PERMISSIONS),
};

const LABEL_MAP: Record<string, string> = {
  "enterprise-aerostack": "Enterprise Aerostack",
  "my-aerostack": "My Aerostack",
  revops: "RevOps",
  financials: "Financials",
  engineering: "Engineering",
  "people-ops": "People Ops",
  perspex: "Perspex",
  engagement: "Engagement",
  "content-arch": "Content Arch",
  calcs: "Calcs",
  "opps-tools": "Opps Tools",
  "sow-tools": "SOW Tools",
  "delivery-tools": "Delivery Tools",
  "csat-tools": "CSAT Tools",
  "data-tools": "Data Tools",
  "email-extractor": "Email Extractor",
  knowledge: "Knowledge",
  "slack-admin": "Slack Admin",
  "zoom-recordings": "Zoom Recordings",
  "hiring-tools": "Hiring",
  "enterprise-work": "Enterprise Work",
  people: "People",
  opportunities: "Opportunities",
  delivery: "Delivery",
  learning: "Learning",
  agents: "Agents",
  "workflow-ledger": "Workflow Ledger",
  integrations: "Integrations",
  mcp: "MCP",
  roles: "Roles",
  setup: "Setup",
  operations: "Operations",
  tools: "Tools",
  resources: "Resources",
  system: "System",
};

const ROLE_STYLES: Record<GivenRole, { pill: string; badge: string }> = {
  "Super-Admin": {
    pill: "from-violet-600 to-purple-700",
    badge: "bg-gradient-to-r from-violet-600 to-purple-700 text-white border-0",
  },
  Admin: {
    pill: "from-blue-600 to-indigo-700",
    badge: "bg-gradient-to-r from-blue-600 to-indigo-700 text-white border-0",
  },
  Seller: {
    pill: "from-emerald-600 to-teal-700",
    badge: "bg-gradient-to-r from-emerald-600 to-teal-700 text-white border-0",
  },
  User: {
    pill: "from-slate-500 to-slate-700",
    badge: "bg-muted text-muted-foreground",
  },
};

function label(key: string) {
  return (
    LABEL_MAP[key] ||
    key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Returns true if this user's email marks them as a hardcoded Super-Admin */
function isWillAccount(email: string): boolean {
  return email.toLowerCase() === "will@enterprise.io";
}

function mergePermissions(
  defaults: FullPermissions,
  saved: Record<string, any>,
): FullPermissions {
  const result = structuredClone(defaults);

  for (const key of ["enterprise-aerostack", "my-aerostack"] as const) {
    if (Array.isArray(saved[key])) {
      result[key] = saved[key];
    }
  }

  for (const group of [
    "operations",
    "tools",
    "resources",
    "agents",
    "system",
  ] as const) {
    if (saved[group] && typeof saved[group] === "object") {
      for (const item of Object.keys(result[group])) {
        if (Array.isArray(saved[group][item])) {
          (result[group] as PermissionState)[item] = saved[group][item];
        }
      }
    }
  }

  return result;
}

export default function RoleDetail() {
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const { refetch: refetchPermissions, givenRole: myGivenRole } =
    usePermissions();

  const [user, setUser] = useState<RoleUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<FullPermissions>(
    structuredClone(NO_PERMISSIONS),
  );
  const [selectedGivenRole, setSelectedGivenRole] = useState<GivenRole>("User");

  /**
   * assignMode = false -> Only default permissions for that role are editable. Others are disabled.
   * assignMode = true  -> All permissions are editable.
   */
  const [assignMode, setAssignMode] = useState(false);
  const [hasCustomPermissions, setHasCustomPermissions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isWillUser = user ? isWillAccount(user.email) : false;

  const canEditPermissions =
    myGivenRole === "Super-Admin" ||
    (myGivenRole === "Admin" && user?.givenRole !== "Super-Admin");

  const canAssignRole =
    myGivenRole === "Super-Admin" ||
    (myGivenRole === "Admin" && user?.givenRole !== "Super-Admin");

  const assignableRoles: GivenRole[] =
    myGivenRole === "Super-Admin"
      ? ["Super-Admin", "Admin", "Seller", "User"]
      : ["Admin", "Seller", "User"];

  const fetchUser = async () => {
    try {
      setLoading(true);
      const users = await listRoleUsers();
      const found = users.find((u) => u.personId === personId);
      if (found) {
        setUser(found);
        const effectiveRole = isWillAccount(found.email)
          ? "Super-Admin"
          : found.givenRole || "User";
        setSelectedGivenRole(effectiveRole);

        if (found.userRole && Object.keys(found.userRole).length > 0) {
          // Use saved permissions if present
          setHasCustomPermissions(true);
          setPermissions(mergePermissions(NO_PERMISSIONS, found.userRole));
        } else {
          // Otherwise use defaults for the role
          setHasCustomPermissions(false);
          setPermissions(
            structuredClone(
              ROLE_DEFAULT_PERMISSIONS[effectiveRole] ||
              ROLE_DEFAULT_PERMISSIONS.User,
            ),
          );
        }
      } else {
        setError("User not found");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load user");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, [personId]);

  // ── Permission toggles ─────────────────────────────────────────────────────

  const computeNextPerms = (
    current: Permission[],
    perm: Permission,
  ): Permission[] => {
    if (perm === "write") {
      if (current.includes("write"))
        return current.filter((p) => p !== "write");
      return ["read", "write"];
    }
    if (current.includes("write")) {
      return current.includes("read") ? current : [...current, "read"];
    }
    return current.includes("read")
      ? current.filter((p) => p !== "read")
      : [...current, "read"];
  };

  const toggleTopLevel = (key: "enterprise-aerostack" | "my-aerostack", perm: Permission) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: computeNextPerms(prev[key], perm),
    }));
  };

  const toggleGroupItem = (
    group: keyof Omit<FullPermissions, "enterprise-aerostack" | "my-aerostack">,
    item: string,
    perm: Permission,
  ) => {
    setPermissions((prev) => {
      const groupPerms = { ...(prev[group] as PermissionState) };
      groupPerms[item] = computeNextPerms(groupPerms[item] || [], perm);
      return { ...prev, [group]: groupPerms };
    });
  };

  const handleSave = async () => {
    if (!personId || !user) return;
    try {
      setSaving(true);

      const session = await fetchAuthSession({ forceRefresh: false });
      const currentEmail =
        session.tokens?.idToken?.payload?.email ||
        session.tokens?.accessToken?.payload?.username ||
        auth?.user?.username ||
        "unknown";

      // Enforce hiring-tools restriction: only Super-Admin gets access.
      const permissionsToSave = selectedGivenRole !== "Super-Admin"
        ? {
          ...permissions,
          tools: {
            ...(permissions.tools as PermissionState),
            "hiring-tools": [],
          },
        }
        : permissions;

      await Promise.all([
        saveGivenRole(
          personId,
          user.createdAt,
          selectedGivenRole,
          String(currentEmail),
        ),
        saveUserRole(
          personId,
          user.createdAt,
          permissionsToSave,
          String(currentEmail),
        ),
      ]);
      toast.success("Role & permissions saved");
      setAssignMode(false);
      setHasCustomPermissions(true);

      const isEditingSelf = auth?.user?.userId === personId;
      if (isEditingSelf) {
        await refetchPermissions();
      }

      await fetchUser(); // reload perfectly to instantly update role badges and info
    } catch (err: any) {
      setError(err.message || "Failed to save");
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!personId) return;
    setDeleting(true);
    try {
      await deleteUser(personId);
      toast.success("User removed");
      navigate("/roles");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || err.message || "Failed to remove user",
      );
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleRoleChange = (role: GivenRole) => {
    setSelectedGivenRole(role);

    const originalRole: GivenRole = user
      ? isWillAccount(user.email)
        ? "Super-Admin"
        : user.givenRole || "User"
      : "User";

    if (role === originalRole && user) {
      if (user.userRole && Object.keys(user.userRole).length > 0) {
        setHasCustomPermissions(true);
        setPermissions(mergePermissions(NO_PERMISSIONS, user.userRole));
      } else {
        setHasCustomPermissions(false);
        setPermissions(
          structuredClone(
            ROLE_DEFAULT_PERMISSIONS[originalRole] ||
            ROLE_DEFAULT_PERMISSIONS.User,
          ),
        );
      }
    } else {
      setHasCustomPermissions(false);
      setPermissions(structuredClone(ROLE_DEFAULT_PERMISSIONS[role]));
    }
  };

  // ── Rendering Helpers ──────────────────────────────────────────────────────

  /**
   * Helper to check if a permission key is part of the default set for the selected role
   */
  const isDefaultPermission = (
    group: keyof FullPermissions,
    itemKey?: string,
  ): boolean => {
    const defaultSet = ROLE_DEFAULT_PERMISSIONS[selectedGivenRole];
    if (itemKey) {
      const groupItems = defaultSet[group] as PermissionState;
      return groupItems[itemKey]?.length > 0;
    }
    return (defaultSet[group] as Permission[])?.length > 0;
  };

  const renderPermissionItem = (
    group: keyof FullPermissions,
    itemKey: string | undefined,
    labelStr: string,
    perms: Permission[],
    onToggle: (p: Permission) => void,
  ) => {
    const isDefault = isDefaultPermission(group, itemKey || undefined);
    const hasPerm = perms.includes("read") || perms.includes("write");

    // Make the card slightly faded if there are no permissions ticked,, but not "locked out" visually.
    const isVisuallyLocked = !assignMode && !isDefault && !hasPerm;
    const isUnticked = !hasPerm && !isVisuallyLocked;

    // Can we actually toggle the checkbox?
    // "for change in any permission it have to by assign permission" -> must be in assignMode
    const canToggle = assignMode && canEditPermissions;

    return (
      <div
        className={[
          "flex items-center justify-between rounded-md border p-3 transition-all group",
          isVisuallyLocked
            ? "opacity-50 bg-muted/30 border-dashed hover:opacity-40 cursor-not-allowed"
            : isUnticked
              ? "opacity-60 bg-muted/10 border-transparent hover:opacity-100"
              : "opacity-100 bg-card",
        ].join(" ")}
      >
        <div className="flex flex-col">
          <span
            className={[
              "font-medium text-sm",
              isVisuallyLocked || isUnticked
                ? "text-muted-foreground"
                : "text-foreground",
            ].join(" ")}
          >
            {labelStr}
          </span>
          {isVisuallyLocked && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-tight flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1">
              <Lock className="h-2.5 w-2.5" /> Locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label
            className={[
              "flex items-center gap-1.5 text-sm",
              !canToggle
                ? isVisuallyLocked
                  ? "cursor-not-allowed text-muted-foreground/50"
                  : "cursor-default"
                : "cursor-pointer",
            ].join(" ")}
          >
            <Checkbox
              disabled={!canToggle}
              checked={perms.includes("read")}
              onCheckedChange={() => onToggle("read")}
              className={isVisuallyLocked ? "opacity-50" : ""}
            />
            Read
          </label>
          <label
            className={[
              "flex items-center gap-1.5 text-sm",
              !canToggle
                ? isVisuallyLocked
                  ? "cursor-not-allowed text-muted-foreground/50"
                  : "cursor-default"
                : "cursor-pointer",
            ].join(" ")}
          >
            <Checkbox
              disabled={!canToggle}
              checked={perms.includes("write")}
              onCheckedChange={() => onToggle("write")}
              className={isVisuallyLocked ? "opacity-50" : ""}
            />
            Write
          </label>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading user…</span>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error || "User not found"}</span>
        </div>
      </div>
    );
  }

  const effectiveRole: GivenRole = isWillUser
    ? "Super-Admin"
    : user.givenRole || "User";
  const groupKeys = [
    "operations",
    "tools",
    "resources",
    "agents",
    "system",
  ] as const;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/roles")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Shield className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight">{user.email}</h1>
            <span
              className={[
                "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold",
                ROLE_STYLES[effectiveRole]?.badge ?? ROLE_STYLES["User"].badge,
              ].join(" ")}
            >
              {isWillUser && <Lock className="h-2.5 w-2.5" />}
              {effectiveRole}
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {user.personId}
          </p>
        </div>
        {canEditPermissions && !isWillUser && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete User
          </Button>
        )}
        <Badge variant={user.status === "CONFIRMED" ? "default" : "secondary"}>
          {user.status}
        </Badge>
      </div>

      {/* ── Role Selector ──────────────────────────────────────────────────── */}
      {canAssignRole && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" />
                Assign Role Label
              </CardTitle>
              <Button
                variant={assignMode ? "default" : "outline"}
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setAssignMode(!assignMode)}
              >
                {assignMode ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {assignMode ? "Unlock Mode" : "Assign Permission"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Switching roles applies default permissions. Click{" "}
              <span className="font-medium">"Assign Permission"</span> to unlock
              non-default items for editing.
            </p>
            <div className="flex flex-wrap gap-2">
              {assignableRoles.map((role) => {
                const isActive = selectedGivenRole === role;
                const { pill } = ROLE_STYLES[role];
                return (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(role)}
                    className={[
                      "px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 focus:outline-none",
                      isActive
                        ? `bg-gradient-to-r ${pill} text-white shadow-lg scale-105`
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    ].join(" ")}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Permissions Sections ───────────────────────────────────────────── */}
      {canEditPermissions && (
        <div className="space-y-6">
          {/* Top-Level Access */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top-Level Access</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {renderPermissionItem(
                  "enterprise-aerostack",
                  undefined,
                  label("enterprise-aerostack"),
                  permissions["enterprise-aerostack"],
                  (p) => toggleTopLevel("enterprise-aerostack", p),
                )}
                {renderPermissionItem(
                  "my-aerostack",
                  undefined,
                  label("my-aerostack"),
                  permissions["my-aerostack"],
                  (p) => toggleTopLevel("my-aerostack", p),
                )}
              </div>
            </CardContent>
          </Card>

          {/* Grouped Permissions */}
          {groupKeys.map((group) => {
            const items = permissions[group] as PermissionState;
            // Filter out hiring-tools for non-Super-Admin target roles.
            // Only Super-Admin users should ever have hiring-tools access.
            const visibleItems = Object.keys(items).filter((item) => {
              if (item === "hiring-tools" && selectedGivenRole !== "Super-Admin") {
                return false;
              }
              return true;
            });
            if (visibleItems.length === 0) return null;
            return (
              <Card key={group}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{label(group)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visibleItems.map((item) =>
                      renderPermissionItem(
                        group,
                        item,
                        label(item),
                        items[item],
                        (p) => toggleGroupItem(group, item, p),
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Save Button */}
          <div className="flex justify-end gap-3 pt-2 pb-8">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving…" : "Save Role & Permissions"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Read-Only Notice (for others) ──────────────────────────────────── */}
      {!canEditPermissions && !isWillUser && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 flex items-start gap-3">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {user.givenRole === "Super-Admin" && myGivenRole === "Admin"
              ? "Admins cannot modify Super-Admin accounts."
              : "Only Admins and Super-Admins can edit permissions."}
          </p>
        </div>
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{user.email}</span>{" "}
              from Cognito and the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
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
