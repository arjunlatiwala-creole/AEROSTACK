import type React from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, formatDistanceToNow } from "date-fns";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  AlertCircle,
  TrendingDown,
  Activity,
  MessageSquare,
  Send,
  Loader2,
  Trash2,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import apiClient from "@/api/client";
import toast from "react-hot-toast";
import { useWriteAccess } from "@/hooks/useWriteAccess";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ProjectStatus {
  id: string;
  name: string;
  type: string;
  color: string | null;
}

interface UpdateComment {
  id: string;
  body: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

interface ProjectUpdateEntry {
  id: string;
  health: string;
  body: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  comments?: UpdateComment[];
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  status_name: string;
  // virtual_status is stored in DDB and overrides status_name for board display
  virtual_status?: string | null;
  priority: string | null;
  targetDate: string | null;
  updatedAt: string | null;
  leadName: string | null;
  project_updates?: ProjectUpdateEntry[];
}

// ─── Virtual status sentinel ────────────────────────────────────────────────
// This special value is used as the <Select> value when the project has a
// virtual_status of "IN_QA_REVIEW". It is never sent to Linear directly.
const VIRTUAL_QA_SELECT_VALUE = "__virtual_in_qa_review__";

// ─── Constants ─────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { label: "Critical", value: "Critical", num: 1, icon: "🔴" },
  { label: "High", value: "High", num: 2, icon: "🟠" },
  { label: "Medium", value: "Medium", num: 3, icon: "🟡" },
  { label: "Low", value: "Low", num: 4, icon: "🟢" },
  { label: "Minimal", value: "Minimal", num: 0, icon: "⚪" },
] as const;

type PriorityValue = (typeof PRIORITY_OPTIONS)[number]["value"];

const HEALTH_OPTIONS = [
  { label: "On Track", value: "onTrack" },
  { label: "At Risk", value: "atRisk" },
  { label: "Off Track", value: "offTrack" },
] as const;

type HealthValue = (typeof HEALTH_OPTIONS)[number]["value"];

// ─── Hardcoded Linear statuses (mirrors DashboardEngineering) ──────────────
const LINEAR_PROJECT_STATUSES: Record<string, { id: string; name: string }> = {
  completed: { id: "3bca65c0-5fe6-4352-9cc7-1b83d88b6c3d", name: "Completed" },
  planned: { id: "36d394bc-da86-493e-8bbe-864b64770c7e", name: "Planned" },
  backlog: { id: "2bdd2ff8-4f32-42c5-8ce2-74d00a56297a", name: "Backlog" },
  "in progress": {
    id: "171babf3-36b2-404c-bc7c-cd1485171608",
    name: "In Progress",
  },
  canceled: { id: "0cec08f0-b893-40fb-8e36-0968e80eb35c", name: "Canceled" },
};

// ─── Zod schemas ───────────────────────────────────────────────────────────

const editProjectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  description: z.string().optional(),
  content: z.string().optional(),
  // statusId can be the VIRTUAL sentinel or a real Linear status ID
  statusId: z.string().optional(),
  status_name: z.string().optional(),
  priority: z.enum(["Critical", "High", "Medium", "Low", "Minimal"]).optional(),
  targetDate: z.string().optional(),
});

const addUpdateSchema = z.object({
  body: z.string().min(1, "Update body is required"),
  // @ts-ignore
  health: z.enum(["onTrack", "atRisk", "offTrack"], {
    required_error: "Health status is required",
  }),
});

type EditProjectFormData = z.infer<typeof editProjectSchema>;
type AddUpdateFormData = z.infer<typeof addUpdateSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the display status label for a project, preferring virtual_status.
 * "IN_QA_REVIEW" → "In QA Review", everything else falls through to status_name.
 */
function resolveDisplayStatus(proj: ProjectDetail): string {
  if (proj.virtual_status === "In QA Review") return "In QA Review";
  return proj.status_name ?? "";
}

/**
 * True when the project is currently sitting in the virtual QA column.
 */
function isVirtualQA(proj: ProjectDetail | null): boolean {
  return proj?.virtual_status === "In QA Review";
}

function healthColor(health: string): string {
  const h = health.toLowerCase();
  if (h === "ontrack") return "text-green-600 bg-green-50 border-green-200";
  if (h === "atrisk") return "text-amber-600 bg-amber-50 border-amber-200";
  if (h === "offtrack") return "text-red-600 bg-red-50 border-red-200";
  return "text-gray-600 bg-gray-50 border-gray-200";
}

function HealthIcon({ health }: { health: string }) {
  const h = health.toLowerCase();
  if (h === "ontrack") return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (h === "atrisk") return <AlertCircle className="h-4 w-4 text-amber-600" />;
  if (h === "offtrack")
    return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Activity className="h-4 w-4 text-gray-500" />;
}

function avatarColor(email: string): string {
  const colours = [
    "bg-violet-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++)
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colours[Math.abs(hash) % colours.length];
}

function Avatar({ email }: { email: string | null }) {
  const label = email ? email[0].toUpperCase() : "?";
  const colour = avatarColor(email ?? "");
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
        colour,
      )}
    >
      {label}
    </span>
  );
}

// ─── ConfirmDialog ─────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  open,
  title = "Are you sure?",
  description = "This action cannot be undone.",
  confirmText = "Confirm",
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className="bg-[#eb9605] hover:bg-[#E2AE55] text-black border-none"
          >
            {loading ? "Deleting..." : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Delete icon button ────────────────────────────────────────────────────

function DeleteIconButton({
  onClick,
  className,
  disabled,
}: {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors text-muted-foreground hover:text-red-600 hover:bg-red-50",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Comment thread sub-component ──────────────────────────────────────────

interface CommentThreadProps {
  projectId: string;
  updateId: string;
  comments: UpdateComment[];
  sessionEmail: string;
  onCommentsChange: (updateId: string, comments: UpdateComment[]) => void;
  permissionKey: string | null;
  canWrite: boolean;
}

const CommentThread: React.FC<CommentThreadProps> = ({
  projectId,
  updateId,
  comments,
  sessionEmail,
  onCommentsChange,
  permissionKey,
  canWrite,
}) => {
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<{ id: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handlePost = async () => {
    const body = commentText.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await apiClient.post(
        `/delivery/projects/${projectId}/updates/${updateId}/comments`,
        { body, user_email: sessionEmail },
        { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
      );
      if (res.data?.data?.success) {
        const newComment: UpdateComment = res.data.data.comment;
        onCommentsChange(updateId, [...comments, newComment]);
        setCommentText("");
      } else {
        toast.error(res.data?.message ?? "Failed to post comment");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    setConfirmDelete(null);
    try {
      const res = await apiClient.delete(
        `/delivery/projects/${projectId}/updates/${updateId}/comments/${commentId}`,
        { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
      );
      if (res.data?.data?.success) {
        const isFirstComment = comments[0]?.id === commentId;
        onCommentsChange(
          updateId,
          isFirstComment ? [] : comments.filter((c) => c.id !== commentId),
        );
        toast.success(
          isFirstComment && comments.length > 1
            ? "Comments deleted"
            : "Comment deleted",
        );
      } else {
        toast.error(res.data?.message ?? "Failed to delete comment");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to delete comment");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <div className="pt-3 space-y-4">
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete comment?"
        description={
          confirmDelete &&
          comments[0]?.id === confirmDelete.id &&
          comments.length > 1
            ? `This is the first comment. Deleting it will remove all ${comments.length} comments. This action cannot be undone.`
            : "This comment will be permanently removed. This action cannot be undone."
        }
        confirmText="Delete"
        loading={!!deletingCommentId}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteComment(confirmDelete.id)}
      />

      {comments.length > 0 && (
        <div className="space-y-4">
          {comments.map((c) => {
            const timeAgo = c.created_at
              ? formatDistanceToNow(new Date(c.created_at), { addSuffix: true })
              : "";
            return (
              <div key={c.id} className="flex gap-3 group">
                <Avatar email={c.user_email} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {c.user_email || c.user_name || "Unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo}
                      </span>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <DeleteIconButton
                        onClick={() => setConfirmDelete({ id: c.id })}
                        disabled={!canWrite}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap leading-relaxed">
                    {c.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-3 items-center">
        <Avatar email={sessionEmail || null} />
        <div
          className={cn(
            "flex flex-1 items-center gap-2 rounded-full border bg-background px-4 py-2 transition-all",
            "focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50",
          )}
        >
          <textarea
            ref={inputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={canWrite ? "Leave a reply…" : "Read only"}
            disabled={!canWrite}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[20px] max-h-28"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={handlePost}
            disabled={posting || !commentText.trim() || !canWrite}
            className={cn(
              "flex-shrink-0 rounded-full p-1 transition-colors",
              commentText.trim() && canWrite
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground cursor-not-allowed",
            )}
          >
            {posting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  project?: ProjectDetail;
  onSaved?: (updated: ProjectDetail) => void;
}

// ─── Component ─────────────────────────────────────────────────────────────

export const ProjectEditModal: React.FC<Props> = ({
  open,
  onClose,
  projectId,
  project: projectProp,
  onSaved,
}) => {
  const { canWrite, permissionKey } = useWriteAccess();
  const normalizeStatusName = useCallback(
    (value: string | null | undefined) => value?.trim().toLowerCase() ?? "",
    [],
  );

  const findStatusForProject = useCallback(
    (proj: ProjectDetail, statusList: ProjectStatus[]) => {
      // If virtual QA is active, don't try to match a Linear status — we handle
      // it separately via the VIRTUAL_QA_SELECT_VALUE sentinel.
      if (isVirtualQA(proj)) return undefined;

      const projectStatusId =
        ((proj as any).statusId as string | undefined) ??
        ((proj as any).status_id as string | undefined) ??
        ((proj as any).status?.id as string | undefined);

      if (projectStatusId) {
        const byId = statusList.find((s) => s.id === projectStatusId);
        if (byId) return byId;
      }

      const normalizedProjectStatus = normalizeStatusName(proj.status_name);
      return statusList.find(
        (s) => normalizeStatusName(s.name) === normalizedProjectStatus,
      );
    },
    [normalizeStatusName],
  );

  const [project, setProject] = useState<ProjectDetail | null>(
    projectProp ?? null,
  );
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<"edit" | "update">("edit");
  const [openCommentThreadId, setOpenCommentThreadId] = useState<string | null>(
    null,
  );
  const [sessionEmail, setSessionEmail] = useState<string>("");
  const [deletingUpdateId, setDeletingUpdateId] = useState<string | null>(null);
  const [confirmDeleteUpdate, setConfirmDeleteUpdate] = useState<{
    id: string;
  } | null>(null);

  const statusesLoaded = useRef(false);

  useEffect(() => {
    const loadEmail = async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        const email =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setSessionEmail(String(email));
      } catch (err) {
        console.warn("[ProjectEditModal] Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const editForm = useForm<EditProjectFormData>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: {
      name: "",
      description: "",
      content: "",
      statusId: "",
      status_name: "",
      priority: undefined,
      targetDate: "",
    },
  });

  const updateForm = useForm<AddUpdateFormData>({
    resolver: zodResolver(addUpdateSchema),
    defaultValues: { body: "", health: "onTrack" },
  });

  // ── Helper: fetch full project from API ───────────────────────────────────
  const fetchProject = useCallback(async (): Promise<ProjectDetail | null> => {
    try {
      const res = await apiClient.get(`/delivery/projects/${projectId}`, {
        headers: permissionKey ? { "X-Resource-Key": permissionKey } : {},
      });
      return res?.data?.data?.project ?? null;
    } catch (e: any) {
      console.error("[ProjectEditModal] fetchProject failed", e);
      return null;
    }
  }, [projectId, permissionKey]);

  // ── Helper: reset edit form from a project object ─────────────────────────
  // When the project has a virtual_status of IN_QA_REVIEW we set the statusId
  // to the sentinel value so the dropdown shows "In QA Review".
  const resetFormFromProject = useCallback(
    (proj: ProjectDetail, fetchedStatuses?: ProjectStatus[]) => {
      const statusList = fetchedStatuses ?? statuses;

      let selectedStatusId: string;
      let selectedStatusName: string;

      if (isVirtualQA(proj)) {
        // Show the virtual QA option in the dropdown
        selectedStatusId = VIRTUAL_QA_SELECT_VALUE;
        selectedStatusName = "In QA Review";
      } else {
        const matchedStatus = findStatusForProject(proj, statusList);
        selectedStatusId = matchedStatus?.id ?? "";
        selectedStatusName = matchedStatus?.name ?? proj.status_name ?? "";
      }

      editForm.reset({
        name: proj.name ?? "",
        description: proj.description ?? "",
        content: proj.content ?? "",
        statusId: selectedStatusId,
        status_name: selectedStatusName,
        priority: (proj.priority as PriorityValue) ?? undefined,
        targetDate: proj.targetDate ? proj.targetDate.split("T")[0] : "",
      });
    },
    [editForm, statuses, findStatusForProject],
  );

  // ── Load project + statuses when modal opens ──────────────────────────────
  useEffect(() => {
    if (!open) return;

    const load = async () => {
      setLoadingProject(true);

      if (projectProp) {
        resetFormFromProject(projectProp);
        setProject(projectProp);
      }

      try {
        const needsProjectFetch = !projectProp || !projectProp.project_updates;
        const needsStatusFetch = !statusesLoaded.current;

        const requests: [Promise<any> | null, Promise<any> | null] = [
          needsProjectFetch
            ? apiClient.get(`/delivery/projects/${projectId}`, {
                headers: permissionKey
                  ? { "X-Resource-Key": permissionKey }
                  : {},
              })
            : null,
          needsStatusFetch
            ? apiClient.get("/delivery/projects/statuses", {
                headers: permissionKey
                  ? { "X-Resource-Key": permissionKey }
                  : {},
              })
            : null,
        ];

        const [projRes, statusRes] = await Promise.all(requests);

        const proj: ProjectDetail | null = needsProjectFetch
          ? (projRes?.data?.data?.project ?? null)
          : (projectProp as ProjectDetail);

        let fetchedStatuses: ProjectStatus[] = statuses;
        if (needsStatusFetch) {
          const statusPayload = statusRes?.data;
          const rawStatuses =
            statusPayload?.data?.statuses ??
            statusPayload?.statuses ??
            statusPayload?.data ??
            [];
          fetchedStatuses = Array.isArray(rawStatuses) ? rawStatuses : [];
          setStatuses(fetchedStatuses);
          statusesLoaded.current = true;
        }

        if (proj) {
          setProject(proj);
          resetFormFromProject(proj, fetchedStatuses);
        }
      } catch (e: any) {
        toast.error(e?.response?.data?.message ?? "Failed to load project");
      } finally {
        setLoadingProject(false);
      }
    };

    load();
    setActiveTab("edit");
    setOpenCommentThreadId(null);
    updateForm.reset({ body: "", health: "onTrack" });
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !project || statuses.length === 0) return;

    const currentStatusId = editForm.getValues("statusId");
    if (currentStatusId) return;

    // Re-run sentinel logic after statuses load
    if (isVirtualQA(project)) {
      editForm.setValue("statusId", VIRTUAL_QA_SELECT_VALUE, {
        shouldDirty: false,
      });
      editForm.setValue("status_name", "In QA Review", { shouldDirty: false });
      return;
    }

    const matchedStatus = findStatusForProject(project, statuses);
    if (!matchedStatus) return;

    editForm.setValue("statusId", matchedStatus.id, { shouldDirty: false });
    editForm.setValue("status_name", matchedStatus.name, {
      shouldDirty: false,
    });
  }, [open, project, statuses, editForm, findStatusForProject]);

  // ── Status dropdown change handler ────────────────────────────────────────
  // Handles both the virtual QA sentinel and real Linear status IDs.
  const handleStatusChange = useCallback(
    (statusId: string) => {
      if (statusId === VIRTUAL_QA_SELECT_VALUE) {
        editForm.setValue("statusId", VIRTUAL_QA_SELECT_VALUE);
        editForm.setValue("status_name", "In QA Review");
        return;
      }
      const s = statuses.find((st) => st.id === statusId);
      editForm.setValue("statusId", statusId);
      editForm.setValue("status_name", s?.name ?? "");
    },
    [statuses, editForm],
  );

  // ── Submit: edit project ──────────────────────────────────────────────────
  // Three cases for the status field:
  //   1. User picked "In QA Review" (virtual sentinel) → PATCH virtual-status
  //   2. User picked a real Linear status while project was in virtual QA
  //      → PUT with clear_virtual_status: true
  //   3. Normal Linear status change → PUT
  const onSubmitEdit = async (values: EditProjectFormData) => {
    if (!project) return;

    const currentDisplayStatus = resolveDisplayStatus(project);
    const selectedIsVirtualQA = values.statusId === VIRTUAL_QA_SELECT_VALUE;

    // Build the diff payload for non-status fields
    const basePayload: Record<string, any> = {
      user_email: sessionEmail,
    };
    if (values.name && values.name !== project.name)
      basePayload.name = values.name;
    if (values.description !== (project.description ?? ""))
      basePayload.description = values.description ?? "";
    if (values.content !== (project.content ?? ""))
      basePayload.content = values.content ?? "";
    if (values.priority && values.priority !== project.priority)
      basePayload.priority = values.priority;
    if (values.targetDate !== (project.targetDate?.split("T")[0] ?? ""))
      basePayload.targetDate = values.targetDate ?? "";

    // Did the status actually change?
    const statusChanged = selectedIsVirtualQA
      ? !isVirtualQA(project) // was not QA, now QA
      : isVirtualQA(project) || // was QA, now real
        values.statusId !== editForm.formState.defaultValues?.statusId;

    if (!statusChanged && Object.keys(basePayload).length === 1) {
      // only user_email in payload — nothing changed
      toast("No changes to save", { icon: "ℹ️" });
      return;
    }

    setSavingEdit(true);
    try {
      const rawProjectId = projectId.replace(/^proj_/, "");

      // ── Case 1: moving TO virtual QA ──────────────────────────────────────
      if (statusChanged && selectedIsVirtualQA) {
        // First save any other field changes via PUT (without status)
        if (Object.keys(basePayload).length > 1) {
          // find current real Linear status to keep it unchanged
          const currentLinearStatus = findStatusForProject(project, statuses);
          if (currentLinearStatus) {
            await apiClient.put(
              `/delivery/projects/${rawProjectId}`,
              {
                ...basePayload,
                statusId: currentLinearStatus.id,
                status_name: currentLinearStatus.name,
              },
              {
                headers: permissionKey
                  ? { "X-Resource-Key": permissionKey }
                  : {},
              },
            );
          }
        }

        // Then set the virtual status
        await apiClient.patch(
          `/delivery/projects/${rawProjectId}/virtual-status`,
          {
            virtual_status: "In QA Review",
            user_email: sessionEmail,
          },
          { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
        );
      }
      // ── Case 2 & 3: moving to a real Linear status ────────────────────────
      else {
        const payload = { ...basePayload };

        if (statusChanged && values.statusId) {
          // Validate it's a real status ID (not the sentinel — already handled above)
          const statusEntry = statuses.find((s) => s.id === values.statusId);
          if (!statusEntry) {
            toast.error("Invalid status selected");
            setSavingEdit(false);
            return;
          }
          payload.statusId = statusEntry.id;
          payload.status_name = statusEntry.name;

          // If the project was previously in virtual QA, tell backend to clear it
          if (isVirtualQA(project)) {
            payload.clear_virtual_status = true;
          }
        }

        const res = await apiClient.put(
          `/delivery/projects/${rawProjectId}`,
          payload,
          { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
        );

        if (!res.data?.data?.success) {
          toast.error(res.data?.message ?? "Update failed");
          return;
        }
      }

      // Re-fetch the fresh project so virtual_status is up to date
      const freshProject = await fetchProject();

      if (freshProject) {
        setProject(freshProject);
        resetFormFromProject(freshProject);
        onSaved?.(freshProject);
      } else {
        // Optimistic local update so the UI doesn't look stale
        setProject((prev) => {
          if (!prev) return prev;
          const updated: ProjectDetail = {
            ...prev,
            ...(values.name && { name: values.name }),
            ...(values.description !== undefined && {
              description: values.description || null,
            }),
            ...(values.priority && { priority: values.priority }),
            ...(values.targetDate !== undefined && {
              targetDate: values.targetDate || null,
            }),
          };
          if (selectedIsVirtualQA) {
            updated.virtual_status = "In QA Review";
          } else if (statusChanged) {
            updated.virtual_status = null;
            updated.status_name =
              statuses.find((s) => s.id === values.statusId)?.name ??
              values.status_name ??
              prev.status_name;
          }
          return updated;
        });
        onSaved?.(project!);
      }

      toast.success("Project updated");
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to update project");
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Submit: add project update ─────────────────────────────────────────────
  const onSubmitUpdate = async (values: AddUpdateFormData) => {
    setSavingUpdate(true);
    try {
      const res = await apiClient.post(
        `/delivery/projects/${projectId}/updates`,
        {
          body: values.body,
          health: values.health,
          user_email: sessionEmail,
        },
        { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
      );

      if (res.data?.data?.success) {
        const newEntry: ProjectUpdateEntry = {
          ...res.data.data.projectUpdate,
          comments: [],
        };
        setProject((prev) =>
          prev
            ? {
                ...prev,
                project_updates: [...(prev.project_updates ?? []), newEntry],
              }
            : prev,
        );
        toast.success("Project update posted");
        updateForm.reset({ body: "", health: "onTrack" });
      } else {
        toast.error(res.data?.message ?? "Failed to post update");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to post update");
    } finally {
      setSavingUpdate(false);
    }
  };

  // ── Delete project update ─────────────────────────────────────────────────
  const handleDeleteUpdate = async (updateId: string) => {
    setDeletingUpdateId(updateId);
    setConfirmDeleteUpdate(null);
    try {
      const res = await apiClient.delete(
        `/delivery/projects/${projectId}/updates/${updateId}`,
        { headers: permissionKey ? { "X-Resource-Key": permissionKey } : {} },
      );
      if (res.data?.data?.success) {
        setProject((prev) =>
          prev
            ? {
                ...prev,
                project_updates: prev.project_updates?.filter(
                  (u) => u.id !== updateId,
                ),
              }
            : prev,
        );
        setOpenCommentThreadId((prev) => (prev === updateId ? null : prev));
        toast.success("Update deleted");
      } else {
        toast.error(res.data?.message ?? "Failed to delete update");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to delete update");
    } finally {
      setDeletingUpdateId(null);
    }
  };

  const toggleCommentThread = (updateId: string) => {
    setOpenCommentThreadId((prev) => (prev === updateId ? null : updateId));
  };

  const handleCommentsChange = (
    updateId: string,
    updatedComments: UpdateComment[],
  ) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        project_updates: prev.project_updates?.map((u) =>
          u.id === updateId ? { ...u, comments: updatedComments } : u,
        ),
      };
    });
  };

  const updatesCount = project?.project_updates?.length ?? 0;
  const projectInVirtualQA = isVirtualQA(project);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <DialogTitle>{project?.name}</DialogTitle>
            {/* ── Virtual QA badge shown in header ── */}
            {projectInVirtualQA && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                <FlaskConical className="h-3 w-3" />
                In QA Review
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Update project details or post a new status update. Changes sync to
            Linear and DynamoDB.
          </p>
        </DialogHeader>

        {/* ── Confirm delete update dialog ── */}
        <ConfirmDialog
          open={!!confirmDeleteUpdate}
          title="Delete this update?"
          description="This status update will be permanently removed along with all its comments. This action cannot be undone."
          confirmText="Delete"
          loading={!!deletingUpdateId}
          onCancel={() => setConfirmDeleteUpdate(null)}
          onConfirm={() =>
            confirmDeleteUpdate && handleDeleteUpdate(confirmDeleteUpdate.id)
          }
        />

        {/* ── Tabs ── */}
        <div className="flex gap-0 border-b -mx-6 px-6">
          <button
            type="button"
            onClick={() => setActiveTab("edit")}
            className={cn(
              "pb-2 pr-4 text-sm font-medium border-b-2 transition-colors",
              activeTab === "edit"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Edit Project
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("update")}
            className={cn(
              "pb-2 px-4 text-sm font-medium border-b-2 transition-colors",
              activeTab === "update"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Status Updates
            {updatesCount > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {updatesCount}
              </Badge>
            )}
          </button>
        </div>

        {/* ════ TAB: Edit Project ════ */}
        {activeTab === "edit" && (
          <form
            onSubmit={editForm.handleSubmit(onSubmitEdit)}
            className="space-y-5 pt-2"
          >
            <div className="space-y-2">
              <Label>Project Name *</Label>
              <Input
                {...editForm.register("name")}
                placeholder="e.g., Q4 Infrastructure Revamp"
                disabled={!canWrite}
              />
              {editForm.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                {...editForm.register("description")}
                rows={3}
                placeholder="What needs to be accomplished and why it matters…"
                disabled={!canWrite}
              />
              <p className="text-xs text-gray-500">
                Short summary shown in project cards and lists.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                {...editForm.register("content")}
                rows={8}
                placeholder="Detailed project overview, goals, specs, etc. Markdown supported."
                disabled={!canWrite}
              />
              <p className="text-xs text-gray-500">
                Markdown supported. Rendered on the project detail page.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Controller
                  name="statusId"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={handleStatusChange}
                      disabled={!canWrite}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select status…" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* ── Virtual QA option always shown at top ── */}
                        <SelectItem value={VIRTUAL_QA_SELECT_VALUE}>
                          <div className="flex items-center gap-2">
                            <FlaskConical className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                            <span>In QA Review</span>
                            <span className="text-[10px] text-muted-foreground ml-1">
                              (internal)
                            </span>
                          </div>
                        </SelectItem>

                        {/* ── Real Linear statuses ── */}
                        {statuses.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            Loading statuses…
                          </div>
                        ) : (
                          statuses.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                {s.color && (
                                  <span
                                    className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                                    style={{ background: s.color }}
                                  />
                                )}
                                {s.name}
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-gray-500">
                  "In QA Review" is internal only — other statuses sync to
                  Linear.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Controller
                  name="priority"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v as PriorityValue)}
                      disabled={!canWrite}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select priority…" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            <div className="flex items-center gap-2 w-full">
                              <span className="inline-flex items-center justify-center h-5 w-5 rounded text-xs font-bold bg-muted text-muted-foreground flex-shrink-0">
                                {p.num}
                              </span>
                              <span>{p.icon}</span>
                              <span>{p.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-gray-500">
                  Critical = highest · Minimal = lowest.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Target Date</Label>
              <Controller
                name="targetDate"
                control={editForm.control}
                render={({ field: { value, onChange } }) => (
                  <Popover
                    open={openDatePicker}
                    onOpenChange={setOpenDatePicker}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        type="button"
                        className="w-full justify-start text-left font-normal"
                        disabled={!canWrite}
                      >
                        {value && !isNaN(new Date(value).getTime())
                          ? format(new Date(value), "PPP")
                          : "Select date…"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={
                          value && !isNaN(new Date(value).getTime())
                            ? new Date(value)
                            : undefined
                        }
                        onSelect={(date) => {
                          if (!date) {
                            onChange("");
                            return;
                          }
                          onChange(format(date, "yyyy-MM-dd"));
                          setOpenDatePicker(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              />
              <p className="text-xs text-gray-500">
                When should this project be completed?
              </p>
              {editForm.formState.errors.targetDate && (
                <p className="text-sm text-red-500">
                  {editForm.formState.errors.targetDate.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={onClose}
                disabled={savingEdit}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingEdit || loadingProject || !canWrite}
              >
                {savingEdit ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ════ TAB: Status Updates ════ */}
        {activeTab === "update" && (
          <div className="space-y-6 pt-2">
            <form
              onSubmit={updateForm.handleSubmit(onSubmitUpdate)}
              className="space-y-4 rounded-lg border bg-muted/30 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  Post New Update
                </p>
                {sessionEmail && (
                  <span className="text-xs text-muted-foreground">
                    Posting as{" "}
                    <span className="font-medium text-foreground">
                      {sessionEmail}
                    </span>
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label>Health Status *</Label>
                <Controller
                  name="health"
                  control={updateForm.control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as HealthValue)}
                      disabled={!canWrite}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select health…" />
                      </SelectTrigger>
                      <SelectContent>
                        {HEALTH_OPTIONS.map((h) => (
                          <SelectItem key={h.value} value={h.value}>
                            <div className="flex items-center gap-2">
                              <HealthIcon health={h.value} />
                              {h.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {updateForm.formState.errors.health && (
                  <p className="text-sm text-red-500">
                    {updateForm.formState.errors.health.message}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  On Track = progressing well · At Risk = potential blockers ·
                  Off Track = needs immediate attention.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Update Body *</Label>
                <Textarea
                  {...updateForm.register("body")}
                  rows={3}
                  placeholder="Describe what's happening — e.g., All milestones hit this sprint."
                  disabled={!canWrite}
                />
                <p className="text-xs text-gray-500">
                  Markdown supported. Recorded in Linear project history.
                </p>
                {updateForm.formState.errors.body && (
                  <p className="text-sm text-red-500">
                    {updateForm.formState.errors.body.message}
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={savingUpdate || !canWrite}>
                  {savingUpdate ? "Posting…" : "Post Update"}
                </Button>
              </div>
            </form>

            {updatesCount > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">
                  History ({updatesCount})
                </p>
                {[...(project?.project_updates ?? [])].reverse().map((u) => {
                  const commentCount = u.comments?.length ?? 0;
                  const isThreadOpen = openCommentThreadId === u.id;
                  const isDeleting = deletingUpdateId === u.id;

                  return (
                    <div
                      key={u.id}
                      className={cn(
                        "rounded-lg border bg-card transition-colors",
                        isDeleting && "opacity-50 pointer-events-none",
                      )}
                    >
                      <div className="flex gap-3 p-4">
                        <div className="flex-shrink-0 pt-0.5">
                          <HealthIcon health={u.health} />
                        </div>
                        <div className="flex-grow min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "inline-block rounded-md border px-2 py-0.5 text-xs font-medium",
                                healthColor(u.health),
                              )}
                            >
                              {HEALTH_OPTIONS.find((h) => h.value === u.health)
                                ?.label ?? u.health}
                            </span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {u.created_at
                                  ? format(new Date(u.created_at), "PPP")
                                  : "-"}
                              </span>
                              <DeleteIconButton
                                onClick={() =>
                                  setConfirmDeleteUpdate({ id: u.id })
                                }
                                disabled={!canWrite}
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            by{" "}
                            <span className="font-medium">
                              {u.user_name || u.user_email || "Unknown"}
                            </span>
                          </p>
                          {(() => {
                            const bodyText = (u as any).body || "";
                            return bodyText ? (
                              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap mt-1">
                                {bodyText}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 border-t px-4 py-2">
                        {commentCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleCommentThread(u.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                              isThreadOpen
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border bg-background text-foreground hover:bg-muted",
                            )}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {commentCount}{" "}
                            {commentCount === 1 ? "comment" : "comments"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleCommentThread(u.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                              isThreadOpen
                                ? "text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted",
                            )}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Add comment
                          </button>
                        )}
                      </div>

                      {isThreadOpen && (
                        <div className="border-t px-4 pb-4">
                          <CommentThread
                            projectId={projectId}
                            updateId={u.id}
                            comments={u.comments ?? []}
                            sessionEmail={sessionEmail}
                            onCommentsChange={handleCommentsChange}
                            permissionKey={permissionKey}
                            canWrite={canWrite}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No updates yet. Post the first one above!
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProjectEditModal;
