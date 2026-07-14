import "@/lib/ag-grid-config";
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate } from "react-router";
import { AgGridReact } from "ag-grid-react";

import { ROUTES } from "@/lib/routes-config";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  BarChart3,
  ListTodo,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Filter,
  Users,
  FolderKanban,
  RefreshCw,
  LayoutList,
  SlidersHorizontal,
  ChevronDown,
  CheckCircle2,
  Activity,
  ArrowRight,
  X,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import apiClient, { aerostackApiClient } from "@/api/client";
import { logError } from "@/lib/logger";
import toast from "react-hot-toast";
import Loader from "@/components/Loader";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UnifiedDeliveryItem {
  id: string;
  entity: "PROJECT" | "LOOP";
  name: string;
  state: string;
  priority: string | null;
  progress: number;
  leadName: string | null;
  ownerEmail: string | null;
  members: { email: string; name?: string }[];
  teams: { name: string }[];
  totalIssues: number;
  completedIssues: number;
  startDate: string | null;
  targetDate: string | null;
  updatedAt: string | null;
  url: string | null;
}

interface TeamOption {
  key: string;
  name: string;
}

// ── normaliseItem reads virtual_status first so the board column is correct ──
function normaliseItem(raw: any): UnifiedDeliveryItem {
  return {
    id: raw.id ?? "",
    entity: raw.entity ?? "LOOP",
    name: raw.name ?? "",
    // virtual_status overrides real state for board display (e.g. IN_QA_REVIEW)
    state: raw.virtual_status || raw.status_name || "",
    priority: raw.priority ?? null,
    progress: raw.progress ?? 0,
    leadName: raw.leadName ?? null,
    ownerEmail: raw.ownerEmail ?? raw.leadEmail ?? null,
    members: raw.members ?? [],
    teams: raw.teams ?? [],
    totalIssues: raw.totalIssues ?? 0,
    completedIssues: raw.completedIssues ?? 0,
    startDate: raw.startDate ?? null,
    targetDate: raw.targetDate ?? null,
    updatedAt: raw.updatedAt ?? null,
    url: raw.url ?? null,
  };
}

type DashboardTab = "projects";

interface DeliverySummary {
  total: number;
  projectCount: number;
  loopCount: number;
  by_state: Record<string, number>;
  totalIssues: number;
  totalCompleted: number;
  overallProgress: number;
  available_teams?: TeamOption[];
}

interface PaginationInfo {
  pageSize: number;
  offset: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  nextCursor: string | null;
}

type BoardColumn = "BACKLOG" | "IN_PROGRESS" | "IN_QA_REVIEW" | "COMPLETED";

const BOARD_COLUMNS: BoardColumn[] = [
  "BACKLOG",
  "IN_PROGRESS",
  "IN_QA_REVIEW",
  "COMPLETED",
];

const COLUMN_TO_STATUS: Record<BoardColumn, string> = {
  BACKLOG: "BACKLOG",
  IN_PROGRESS: "IN_PROGRESS",
  IN_QA_REVIEW: "IN_QA_REVIEW",
  COMPLETED: "COMPLETED",
};

const COLUMN_TO_LOOP_STATUS: Record<BoardColumn, string> = {
  BACKLOG: "BACKLOG",
  IN_PROGRESS: "IN_PROGRESS",
  IN_QA_REVIEW: "IN_QA_REVIEW",
  COMPLETED: "COMPLETED",
};

// ─── Hardcoded Linear project statuses ──────────────────────────────────────
// IN_QA_REVIEW is intentionally absent — it is a virtual/DDB-only status.
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

const BACKLOG_TOKENS = new Set([
  "backlog",
  "planned",
  "not_started",
  "not started",
  "todo",
  "delay_incompleted",
  "delay & incompleted",
]);

const IN_PROGRESS_TOKENS = new Set([
  "in_progress",
  "in progress",
  "started",
  "in_review",
  "in review",
  "review",
]);

const IN_QA_REVIEW_TOKENS = new Set(["in_qa_review", "in qa review", "qa"]);

const COMPLETED_TOKENS = new Set([
  "completed",
  "complete",
  "done",
  "cancelled",
  "canceled",
  "paused",
  "resolved",
]);

function classifyItem(item: UnifiedDeliveryItem): BoardColumn {
  const s = (item.state ?? "").toLowerCase();
  if (IN_QA_REVIEW_TOKENS.has(s)) return "IN_QA_REVIEW";
  if (IN_PROGRESS_TOKENS.has(s)) return "IN_PROGRESS";
  if (COMPLETED_TOKENS.has(s)) return "COMPLETED";
  return "BACKLOG";
}

function getColumnColor(col: BoardColumn): string {
  switch (col) {
    case "BACKLOG":
      return "bg-slate-400";
    case "IN_PROGRESS":
      return "bg-blue-500";
    case "IN_QA_REVIEW":
      return "bg-amber-500";
    case "COMPLETED":
      return "bg-emerald-500";
  }
}

function getColumnAccent(col: BoardColumn): string {
  switch (col) {
    case "BACKLOG":
      return "border-slate-300 bg-slate-50/50 dark:bg-slate-900/20";
    case "IN_PROGRESS":
      return "border-blue-300 bg-blue-50/50 dark:bg-blue-900/20";
    case "IN_QA_REVIEW":
      return "border-amber-300 bg-amber-50/50 dark:bg-amber-900/20";
    case "COMPLETED":
      return "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/20";
  }
}

function getColumnLabel(col: BoardColumn): string {
  switch (col) {
    case "BACKLOG":
      return "Backlog";
    case "IN_PROGRESS":
      return "In Progress";
    case "IN_QA_REVIEW":
      return "In QA Review";
    case "COMPLETED":
      return "Completed";
  }
}

// Returns the Linear status name to use for a given board column.
// IN_QA_REVIEW maps to "In Progress" in Linear (it is virtual-only in DDB).
function getLinearStatusName(col: BoardColumn): string {
  switch (col) {
    case "BACKLOG":
      return "Backlog";
    case "IN_PROGRESS":
      return "In Progress";
    case "IN_QA_REVIEW":
      return "In Progress"; // virtual — never actually sent to Linear
    case "COMPLETED":
      return "Completed";
  }
}

function getEntityBadge(entity: "PROJECT" | "LOOP") {
  return (
    <Badge
      variant="default"
      className={cn(
        "text-[10px] font-bold px-2 py-0 h-5",
        entity === "PROJECT"
          ? "bg-orange-100 text-orange-700 border-orange-200"
          : "bg-blue-100 text-blue-700 border-blue-200",
      )}
    >
      {entity}
    </Badge>
  );
}

function getPriorityBadge(priority: string | number | null) {
  if (priority === null || priority === undefined || priority === "")
    return null;
  const p = String(priority);
  const prefixMap: Record<string, string> = {
    Critical: "P1",
    High: "P2",
    Medium: "P3",
    Low: "P4",
    Minimal: "P0",
  };
  const display = prefixMap[p] ?? p;
  let variant: "destructive" | "default" | "secondary" | "outline" =
    "secondary";
  if (p === "Critical") variant = "destructive";
  else if (p === "High") variant = "default";
  else if (p === "Medium") variant = "secondary";
  else if (p === "Low" || p === "Minimal") variant = "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {display}
    </Badge>
  );
}

function formatDate(d: string | null): string {
  if (!d || d === "N/A") return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function progressColor(pct: number): string {
  if (pct >= 75) return "bg-green-500";
  if (pct >= 40) return "bg-yellow-400";
  return "bg-red-400";
}

// ─── Status Comment Modal ────────────────────────────────────────────────────

interface StatusCommentModalProps {
  isOpen: boolean;
  item: UnifiedDeliveryItem | null;
  fromColumn: BoardColumn | null;
  toColumn: BoardColumn | null;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}

function StatusCommentModal({
  isOpen,
  item,
  fromColumn,
  toColumn,
  onConfirm,
  onCancel,
}: StatusCommentModalProps) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setComment("");
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen || !item || !fromColumn || !toColumn) return null;

  const handleConfirm = async () => {
    if (!comment.trim()) {
      textareaRef.current?.focus();
      return;
    }
    setSubmitting(true);
    onConfirm(comment.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleConfirm();
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity duration-200"
        onClick={onCancel}
        style={{ animation: "fadeIn 0.15s ease-out" }}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-md bg-background rounded-xl shadow-2xl border overflow-hidden"
          style={{
            animation: "slideUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Status Change</span>
            </div>
            <button
              onClick={onCancel}
              className="rounded-md p-1 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="text-sm font-medium text-foreground truncate">
              {item.name}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  fromColumn === "BACKLOG" && "bg-slate-100 text-slate-700",
                  fromColumn === "IN_PROGRESS" && "bg-blue-100 text-blue-700",
                  fromColumn === "IN_QA_REVIEW" &&
                    "bg-amber-100 text-amber-700",
                  fromColumn === "COMPLETED" &&
                    "bg-emerald-100 text-emerald-700",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    getColumnColor(fromColumn),
                  )}
                />
                {getColumnLabel(fromColumn)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  toColumn === "BACKLOG" && "bg-slate-100 text-slate-700",
                  toColumn === "IN_PROGRESS" && "bg-blue-100 text-blue-700",
                  toColumn === "IN_QA_REVIEW" && "bg-amber-100 text-amber-700",
                  toColumn === "COMPLETED" && "bg-emerald-100 text-emerald-700",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    getColumnColor(toColumn),
                  )}
                />
                {getColumnLabel(toColumn)}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Reason / Comment <span className="text-destructive">*</span>
              </label>
              <textarea
                ref={textareaRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={`Moving from ${getColumnLabel(fromColumn)} to ${getColumnLabel(toColumn)}…`}
                rows={3}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all placeholder:text-muted-foreground/60"
              />
              <p className="text-[10px] text-muted-foreground">
                Press{" "}
                <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                  ⌘ Enter
                </kbd>{" "}
                to confirm
              </p>
            </div>
          </div>

          <div className="flex gap-2 px-5 py-4 border-t bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleConfirm}
              disabled={submitting || !comment.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Updating…
                </>
              ) : (
                "Confirm Move"
              )}
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>
    </>
  );
}

// ─── Draggable Card ──────────────────────────────────────────────────────────

interface DraggableCardProps {
  item: UnifiedDeliveryItem;
  column: BoardColumn;
  isBeingDragged: boolean;
  onMouseDown: (
    e: React.MouseEvent,
    item: UnifiedDeliveryItem,
    fromColumn: BoardColumn,
  ) => void;
  isNew?: boolean;
}

function DraggableCard({
  item,
  column,
  isBeingDragged,
  onMouseDown,
  isNew,
}: DraggableCardProps) {
  return (
    <div
      data-item-id={item.id}
      onMouseDown={(e) => onMouseDown(e, item, column)}
      className={cn(
        "rounded-xl select-none",
        isBeingDragged
          ? "opacity-0 pointer-events-none"
          : "cursor-grab active:cursor-grabbing",
        isNew && "draggable-card-dropped",
      )}
    >
      <Card
        className={cn(
          "border-l-4 relative overflow-hidden transition-shadow duration-200",
          !isBeingDragged && "hover:shadow-xl cursor-pointer",
        )}
        style={{
          borderLeftColor:
            item.entity === "LOOP"
              ? "hsl(var(--primary))"
              : "hsl(var(--muted-foreground) / 0.3)",
        }}
      >
        <div
          className="absolute inset-0 opacity-0 hover:opacity-100 pointer-events-none transition-opacity duration-300"
          style={{
            background:
              "linear-gradient(135deg, transparent 0%, hsl(var(--primary) / 0.03) 50%, transparent 100%)",
          }}
        />

        <CardContent className="pt-4 pb-3">
          <div className="flex items-start justify-between mb-2">
            <span className="font-semibold text-sm leading-tight select-none">
              {item.name}
            </span>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </a>
            )}
          </div>

          <div className="flex gap-1 flex-wrap mb-2">
            {getEntityBadge(item.entity)}
            {item.teams.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {item.teams[0].name}
              </Badge>
            )}
          </div>

          <div className="space-y-0.5">
            {item.priority && (
              <div className="text-xs text-muted-foreground">
                Priority: {getPriorityBadge(item?.priority)}
              </div>
            )}
            {item.leadName && item.leadName !== "N/A" && (
              <div className="text-xs text-muted-foreground">
                Lead: {item.leadName}
              </div>
            )}
            {item.targetDate && item.targetDate !== "N/A" && (
              <div className="text-xs text-muted-foreground">
                Target: {formatDate(item.targetDate)}
              </div>
            )}
            {item.totalIssues > 0 && (
              <div className="text-xs text-muted-foreground">
                KRs: {item.completedIssues}/{item.totalIssues}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Drop Column ─────────────────────────────────────────────────────────────

interface DropColumnProps {
  col: BoardColumn;
  items: UnifiedDeliveryItem[];
  draggingItemId: string | null;
  isOver: boolean;
  newlyDroppedId: string | null;
  onMouseDown: (
    e: React.MouseEvent,
    item: UnifiedDeliveryItem,
    fromColumn: BoardColumn,
  ) => void;
}

function DropColumn({
  col,
  items,
  draggingItemId,
  isOver,
  newlyDroppedId,
  onMouseDown,
}: DropColumnProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${getColumnColor(col)}`} />
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            {getColumnLabel(col)}
          </h2>
        </div>
        <Badge variant="outline" className="text-xs">
          {items.filter((i) => i.id !== draggingItemId).length}
        </Badge>
      </div>

      <div
        data-column={col}
        className={cn(
          "flex-1 rounded-xl border-2 border-dashed min-h-[200px] p-2 space-y-3 transition-all duration-200",
          isOver
            ? cn(
                "border-primary bg-primary/5 scale-[1.01]",
                getColumnAccent(col),
              )
            : draggingItemId
              ? "border-muted-foreground/20 bg-muted/10 border-dashed"
              : "border-transparent",
        )}
        style={{
          boxShadow: isOver
            ? "0 0 0 3px hsl(var(--primary) / 0.15)"
            : undefined,
        }}
      >
        {isOver && draggingItemId && (
          <div className="flex items-center justify-center py-2 text-xs text-primary font-medium gap-1.5 animate-pulse">
            <ArrowRight className="w-3.5 h-3.5" />
            Drop to move here
          </div>
        )}

        {items.filter((i) => i.id !== draggingItemId).length === 0 &&
        !isOver ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderKanban className="w-8 h-8 mb-2 opacity-30" />
            <span className="text-xs">No items</span>
            {draggingItemId && (
              <span className="text-[10px] mt-1 text-muted-foreground/60">
                Drag here to move
              </span>
            )}
          </div>
        ) : (
          items
            .filter((item) => item.id !== draggingItemId)
            .map((item) => (
              <DraggableCard
                key={item.id}
                item={item}
                column={col}
                isBeingDragged={false}
                onMouseDown={onMouseDown}
                isNew={newlyDroppedId === item.id}
              />
            ))
        )}
      </div>
    </div>
  );
}

// ─── Drag State ───────────────────────────────────────────────────────────────

interface DragState {
  item: UnifiedDeliveryItem;
  fromCol: BoardColumn;
  clone: HTMLElement;
  offsetX: number;
  offsetY: number;
  currentOverCol: BoardColumn | null;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DashboardEngineering() {
  const navigate = useNavigate();

  const navigateToItem = useCallback(
    (item: UnifiedDeliveryItem) => {
      if (item.entity === "LOOP") {
        const loopId = item.id.replace(/^loop_/, "");
        navigate(ROUTES.APP.LOOP.path.replace(":loopId", loopId), {
          state: { loopId, from: ROUTES.APP.ENGINEERING.id },
        });
      } else {
        const id = item.id.replace(/^proj_/, "");
        navigate(ROUTES.APP.PROJECT_DETAILS.path.replace(":projectId", id), {
          state: { from: ROUTES.APP.ENGINEERING.id },
        });
      }
    },
    [navigate],
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [userEmail, setUserEmail] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const userEmailRef = useRef("");

  useEffect(() => {
    const loadEmail = async () => {
      try {
        if (
          import.meta.env.DEV &&
          import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX"
        ) {
          setUserEmail("dev@local");
          userEmailRef.current = "dev@local";
          setSessionReady(true);
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        const email = String(sessionEmail || "");
        setUserEmail(email);
        userEmailRef.current = email;
      } catch (err) {
        console.warn("Failed to load session email", err);
      } finally {
        setSessionReady(true);
      }
    };
    loadEmail();
  }, []);

  const [activeTab, setActiveTab] = useState<DashboardTab>("projects");
  const [scopeFilter, setScopeFilter] = useState<
    "all" | "internal" | "customer"
  >("all");
  const [viewMode, setViewMode] = useState<"board" | "summary" | "table">(
    "board",
  );
  const viewModeRef = useRef(viewMode);
  const tableCursorChangeRef = useRef(false);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const [allItems, setAllItems] = useState<UnifiedDeliveryItem[]>([]);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  const [teamFilter, setTeamFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [ownerFilter, setOwnerFilter] = useState<string>("__all__");
  const [priorityFilter, setPriorityFilter] = useState<string>("__all__");

  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<string[]>([]);
  const initialOptionsLoaded = useRef(false);

  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);

  // ── Mouse drag state ──────────────────────────────────────────────────────
  const dragStateRef = useRef<DragState | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardColumn | null>(null);
  const [newlyDroppedId, setNewlyDroppedId] = useState<string | null>(null);

  // ── Status comment modal state ────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{
    item: UnifiedDeliveryItem;
    fromCol: BoardColumn;
    toCol: BoardColumn;
  } | null>(null);

  const resetPagination = useCallback(() => {
    setActiveCursor(null);
    setCursorStack([]);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    resetPagination();
    setAllItems([]);
  };

  const handleClearFilters = () => {
    setTeamFilter("__all__");
    setStatusFilter("__all__");
    setOwnerFilter("__all__");
    setPriorityFilter("__all__");
    setScopeFilter("all");
    initialOptionsLoaded.current = false;
    resetPagination();
  };

  // ── Fetch delivery data ───────────────────────────────────────────────────
  const fetchDelivery = useCallback(
    async (cursor: string | null, append: boolean) => {
      const isFilteredRefetch = !append && allItems.length > 0;
      const currentSize =
        append || viewMode === "board" || viewMode === "summary"
          ? 50
          : pageSize;

      if (append) setLoadingMore(true);
      else if (isFilteredRefetch) setFiltering(true);
      else setLoading(true);

      try {
        const params: Record<string, any> = {
          limit: currentSize,
          tab: "all",
          scope: scopeFilter,
        };
        if (userEmail) params.callerEmail = userEmail;
        if (cursor) params.cursor = cursor;
        if (teamFilter !== "__all__") params.team = teamFilter;
        if (statusFilter !== "__all__") params.status = statusFilter;
        if (ownerFilter !== "__all__") {
          if (ownerFilter === "__me__") {
            if (userEmail) params.owner = userEmail;
          } else params.owner = ownerFilter;
        }
        if (priorityFilter !== "__all__") params.priority = priorityFilter;

        const res = await apiClient.get("/delivery", { params });
        const payload = res.data?.data;
        const items: UnifiedDeliveryItem[] = (payload?.data ?? []).map(
          normaliseItem,
        );
        const pag: PaginationInfo = payload?.pagination ?? {
          pageSize: 50,
          offset: 0,
          totalCount: 0,
          totalPages: 1,
          hasMore: false,
          nextCursor: null,
        };
        const sum: DeliverySummary = payload?.summary ?? {
          total: 0,
          projectCount: 0,
          loopCount: 0,
          by_state: {},
          totalIssues: 0,
          totalCompleted: 0,
          overallProgress: 0,
        };

        if (append) setAllItems((prev) => [...prev, ...items]);
        else setAllItems(items);

        if (!initialOptionsLoaded.current && !append) {
          const ownerSet = new Set<string>();
          for (const item of items) {
            const email = item.ownerEmail || item.leadName;
            if (email && email !== "N/A") ownerSet.add(email);
          }
          setOwnerOptions(Array.from(ownerSet).sort());
          initialOptionsLoaded.current = true;
        }

        if (!append && sum.available_teams?.length)
          setTeamOptions(sum.available_teams);

        setPagination(pag);
        setSummary(sum);
      } catch (error: any) {
        logError("Error loading engineering data:", error);
        toast.error("Failed to load engineering data");
        if (!append) {
          setAllItems([]);
          setSummary({
            total: 0,
            projectCount: 0,
            loopCount: 0,
            by_state: {},
            totalIssues: 0,
            totalCompleted: 0,
            overallProgress: 0,
          });
          setPagination(null);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setFiltering(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      userEmail,
      teamFilter,
      statusFilter,
      ownerFilter,
      scopeFilter,
      priorityFilter,
      pageSize,
    ],
  );

  useEffect(() => {
    if (!sessionReady) return;
    fetchDelivery(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, fetchDelivery]);

  useEffect(() => {
    if (
      (viewMode === "board" || viewMode === "summary") &&
      activeCursor !== null
    )
      resetPagination();
  }, [viewMode, activeCursor, resetPagination]);

  useEffect(() => {
    if (!sessionReady || viewMode !== "table") return;
    if (!tableCursorChangeRef.current) return;
    tableCursorChangeRef.current = false;
    fetchDelivery(activeCursor, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, viewMode, activeCursor, fetchDelivery]);

  useEffect(() => {
    resetPagination();
  }, [
    teamFilter,
    statusFilter,
    ownerFilter,
    scopeFilter,
    priorityFilter,
    resetPagination,
  ]);

  useEffect(() => {
    setTeamFilter("__all__");
    initialOptionsLoaded.current = false;
  }, [scopeFilter]);

  // ── Infinite scroll ────────────────────────────────────────────────────────
  const scrollSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode !== "board") return;
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          pagination?.hasMore &&
          pagination.nextCursor &&
          !loadingMore &&
          !loading
        ) {
          fetchDelivery(pagination.nextCursor, true);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewMode, pagination, loadingMore, loading, fetchDelivery]);

  // ── Board bucketing ────────────────────────────────────────────────────────
  const boardColumns = useMemo(() => {
    const cols: Record<BoardColumn, UnifiedDeliveryItem[]> = {
      BACKLOG: [],
      IN_PROGRESS: [],
      IN_QA_REVIEW: [],
      COMPLETED: [],
    };
    for (const item of allItems) cols[classifyItem(item)].push(item);
    return cols;
  }, [allItems]);

  // ── Mouse drag handlers ───────────────────────────────────────────────────
  const DRAG_THRESHOLD = 6;

  interface PendingDrag {
    item: UnifiedDeliveryItem;
    fromCol: BoardColumn;
    startX: number;
    startY: number;
    target: HTMLElement;
    rect: DOMRect;
  }
  const pendingDragRef = useRef<PendingDrag | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, item: UnifiedDeliveryItem, fromCol: BoardColumn) => {
      if (e.button !== 0) return;
      const target = e.currentTarget as HTMLElement;
      pendingDragRef.current = {
        item,
        fromCol,
        startX: e.clientX,
        startY: e.clientY,
        target,
        rect: target.getBoundingClientRect(),
      };
    },
    [],
  );

  const getColumnFromPoint = useCallback(
    (x: number, y: number): BoardColumn | null => {
      const clone = dragStateRef.current?.clone;
      if (clone) clone.style.display = "none";
      const el = document.elementFromPoint(x, y);
      if (clone) clone.style.display = "";
      const colEl = el?.closest("[data-column]");
      return (colEl?.getAttribute("data-column") as BoardColumn) ?? null;
    },
    [],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (pendingDragRef.current && !dragStateRef.current) {
        const { startX, startY, item, fromCol, target, rect } =
          pendingDragRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

        const clone = target.cloneNode(true) as HTMLElement;
        clone.style.cssText = `
          position: fixed;
          width: ${rect.width}px;
          left: ${rect.left}px;
          top: ${rect.top}px;
          pointer-events: none;
          z-index: 9999;
          opacity: 0.96;
          transform: rotate(0deg) scale(1);
          box-shadow: 0 24px 48px rgba(0,0,0,0.22), 0 8px 16px rgba(0,0,0,0.12);
          border-radius: 12px;
          will-change: transform, left, top;
        `;
        clone.classList.add("card-clone-pickup");
        document.body.appendChild(clone);

        dragStateRef.current = {
          item,
          fromCol,
          clone,
          offsetX: startX - rect.left,
          offsetY: startY - rect.top,
          currentOverCol: null,
        };
        pendingDragRef.current = null;
        setDraggingItemId(item.id);
      }

      const ds = dragStateRef.current;
      if (!ds) return;

      ds.clone.style.left = `${e.clientX - ds.offsetX}px`;
      ds.clone.style.top = `${e.clientY - ds.offsetY}px`;

      const col = getColumnFromPoint(e.clientX, e.clientY);
      if (col !== ds.currentOverCol) {
        ds.currentOverCol = col;
        setOverColumn(col);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (pendingDragRef.current) {
        const { item } = pendingDragRef.current;
        pendingDragRef.current = null;
        navigateToItem(item);
        return;
      }

      const ds = dragStateRef.current;
      if (!ds) return;

      const toCol = getColumnFromPoint(e.clientX, e.clientY);

      ds.clone.style.transition = "opacity 0.15s ease, transform 0.15s ease";
      ds.clone.style.opacity = "0";
      ds.clone.style.transform = "scale(0.92) rotate(0deg)";
      setTimeout(() => {
        if (ds.clone.parentNode) document.body.removeChild(ds.clone);
      }, 150);

      dragStateRef.current = null;
      setDraggingItemId(null);
      setOverColumn(null);

      if (toCol && toCol !== ds.fromCol) {
        const autoComment = `Status changed from ${getColumnLabel(ds.fromCol)} to ${getColumnLabel(toCol)}`;
        updateItemStatus(ds.item, ds.fromCol, toCol, autoComment);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getColumnFromPoint, navigateToItem]);

  // ── Status update API call ────────────────────────────────────────────────
  // Projects dragged to IN_QA_REVIEW → DDB-only virtual status, no Linear call.
  // Projects dragged away from IN_QA_REVIEW → clear flag + real Linear update.
  const updateItemStatus = useCallback(
    async (
      item: UnifiedDeliveryItem,
      fromColumn: BoardColumn,
      toColumn: BoardColumn,
      comment: string,
    ) => {
      const newStatusLabel = getColumnLabel(toColumn);
      const linearStatusName = getLinearStatusName(toColumn);

      // Optimistic update
      setAllItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, state: COLUMN_TO_STATUS[toColumn] } : i,
        ),
      );
      setNewlyDroppedId(item.id);
      setTimeout(() => setNewlyDroppedId(null), 900);

      try {
        if (item.entity === "LOOP") {
          const loopId = item.id.replace(/^loop_/, "");
          await aerostackApiClient.patch(`/loops/${loopId}`, {
            status: COLUMN_TO_LOOP_STATUS[toColumn],
            status_comment: comment,
            updated_by: userEmailRef.current || undefined,
          });
        } else {
          const projectId = item.id.replace(/^proj_/, "");

          if (toColumn === "IN_QA_REVIEW") {
            // ── Virtual status: DDB only, no Linear call ──────────────────
            await apiClient.patch(
              `/delivery/projects/${projectId}/virtual-status`,
              {
                virtual_status: "In QA Review",
                user_email: userEmailRef.current || undefined,
              },
            );
          } else {
            // ── Real status: clear virtual flag + update Linear ───────────
            const statusEntry =
              LINEAR_PROJECT_STATUSES[linearStatusName.toLowerCase()];
            if (!statusEntry) {
              throw new Error(
                `No matching Linear status for "${linearStatusName}"`,
              );
            }
            await apiClient.put(`/delivery/projects/${projectId}`, {
              statusId: statusEntry.id,
              status_name: statusEntry.name,
              clear_virtual_status: true,
              user_email: userEmailRef.current || undefined,
            });
          }
        }
        toast.success(`Moved to ${newStatusLabel}`);
      } catch (e: any) {
        logError("Failed to update status:", e);
        toast.error("Failed to update status — reverting");
        setAllItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      }
    },
    [],
  );

  // ── Modal handlers ────────────────────────────────────────────────────────
  const handleModalConfirm = useCallback(
    (comment: string) => {
      if (!pendingDrop) return;
      setModalOpen(false);
      updateItemStatus(
        pendingDrop.item,
        pendingDrop.fromCol,
        pendingDrop.toCol,
        comment,
      );
      setPendingDrop(null);
    },
    [pendingDrop, updateItemStatus],
  );

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
    setPendingDrop(null);
  }, []);

  // ── ag-Grid column defs ────────────────────────────────────────────────────
  const columnDefs = useMemo(
    () => [
      {
        headerName: "Type",
        field: "entity",
        width: 100,
        cellRenderer: (p: any) => getEntityBadge(p.value),
      },
      {
        headerName: "Name",
        field: "name",
        flex: 2,
        cellRenderer: (p: any) => (
          <Button
            variant="link"
            className="text-yellow-600 font-bold p-0 h-auto text-left"
            onClick={() => navigateToItem(p.data)}
          >
            {p.value || "-"}
          </Button>
        ),
      },
      {
        headerName: "Status",
        field: "state",
        flex: 1,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        headerName: "Priority",
        field: "priority",
        flex: 0.8,
        cellRenderer: (p: any) => {
          const v =
            p.value === null || p.value === undefined || p.value === ""
              ? "Minimal"
              : String(p.value);
          const config: Record<string, { dot: string; text: string }> = {
            Critical: { dot: "bg-red-500", text: "text-red-600" },
            High: { dot: "bg-orange-500", text: "text-orange-600" },
            Medium: { dot: "bg-yellow-400", text: "text-yellow-600" },
            Low: { dot: "bg-green-500", text: "text-green-600" },
            Minimal: { dot: "bg-gray-400", text: "text-gray-500" },
          };
          const c = config[v] ?? { dot: "bg-gray-300", text: "text-gray-500" };
          const prefixMap: Record<string, string> = {
            Critical: "P1",
            High: "P2",
            Medium: "P3",
            Low: "P4",
            Minimal: "P0",
          };
          return (
            <div className="flex items-center gap-1.5 h-full">
              <span
                className={cn("h-2 w-2 rounded-full flex-shrink-0", c.dot)}
              />
              <span className={cn("text-xs font-medium", c.text)}>
                {prefixMap[v] ?? v}
              </span>
            </div>
          );
        },
      },
      {
        headerName: "Progress",
        field: "progress",
        flex: 1,
        cellRenderer: (p: any) => {
          const pct: number = p.value ?? 0;
          return (
            <div className="flex items-center gap-2 h-full">
              <div className="flex-1 rounded-full bg-gray-200 h-2">
                <div
                  className={`h-2 rounded-full ${progressColor(pct)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs w-8 text-right font-medium">{pct}%</span>
            </div>
          );
        },
      },
      {
        headerName: "Lead",
        field: "leadName",
        flex: 1.2,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        headerName: "Teams",
        field: "teams",
        flex: 1.5,
        autoHeight: true,
        cellRenderer: (p: any) => {
          const teams: any[] = p.value ?? [];
          if (!teams.length)
            return <span className="text-gray-400 text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-1 py-1">
              {teams.map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 border border-blue-200 whitespace-nowrap"
                >
                  {t.name}
                </span>
              ))}
            </div>
          );
        },
      },
      {
        headerName: "KRs",
        flex: 0.9,
        valueGetter: (p: any) => {
          const item = p.data;
          if (item.entity === "LOOP") return "-";
          return `${item.completedIssues} / ${item.totalIssues}`;
        },
      },
    ],
    [navigateToItem],
  ) as any[];

  // ── Summary stats ──────────────────────────────────────────────────────────
  const computedSummary = useMemo(() => {
    const projectCount = allItems.filter((i) => i.entity === "PROJECT").length;
    const loopCount = allItems.filter((i) => i.entity === "LOOP").length;
    const byTeam: Record<string, number> = {};
    for (const item of allItems) {
      if (item.entity === "PROJECT") {
        for (const t of item.teams) {
          byTeam[t.name] = (byTeam[t.name] || 0) + 1;
        }
      }
    }
    const activeItems = allItems
      .filter((i) => {
        const s = (i.state ?? "").toLowerCase();
        return IN_PROGRESS_TOKENS.has(s) || IN_QA_REVIEW_TOKENS.has(s);
      })
      .sort((a, b) => {
        const getSortWeight = (p: string | number | null | undefined) => {
          if (!p) return 99;
          const labelMap: Record<string, number> = {
            Critical: 1,
            High: 2,
            Medium: 3,
            Low: 4,
            Minimal: 5,
          };
          return labelMap[String(p)] ?? 90;
        };
        return getSortWeight(a.priority) - getSortWeight(b.priority);
      });
    const healthIssues = allItems.filter((item) => {
      if (item.entity !== "PROJECT") return false;
      return (
        !item.leadName ||
        item.leadName === "N/A" ||
        !item.targetDate ||
        item.targetDate === "N/A" ||
        item.totalIssues === 0
      );
    });
    const healthyProjects = allItems.filter((item) => {
      if (item.entity !== "PROJECT") return false;
      return (
        item.leadName &&
        item.leadName !== "N/A" &&
        item.targetDate &&
        item.targetDate !== "N/A" &&
        item.totalIssues > 0
      );
    });
    return {
      total: allItems.length,
      projectCount,
      loopCount,
      byTeam,
      activeItems,
      healthIssues,
      healthyProjects,
      backlogCount: boardColumns.BACKLOG.length,
      inProgressCount: boardColumns.IN_PROGRESS.length,
      inQaReviewCount: boardColumns.IN_QA_REVIEW.length,
      completedCount: boardColumns.COMPLETED.length,
      blockedCount: 0,
    };
  }, [allItems, boardColumns]);

  const handleRefresh = () => {
    initialOptionsLoaded.current = false;
    setAllItems([]);
    fetchDelivery(null, false);
  };

  if (loading && allItems.length === 0) {
    return (
      <div className="h-40 min-h-screen flex justify-center items-center">
        <Loader description="Loading Engineering Board..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <style>{`
        @keyframes cardDropIn {
          0%   { opacity: 0; transform: translateY(-14px) scale(0.97); }
          55%  { opacity: 1; transform: translateY(4px) scale(1.01); }
          75%  { transform: translateY(-2px) scale(1.003); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cardGlow {
          0%   { box-shadow: 0 0 0 0   hsl(var(--primary) / 0.45); }
          50%  { box-shadow: 0 0 0 8px hsl(var(--primary) / 0.10); }
          100% { box-shadow: 0 0 0 0   hsl(var(--primary) / 0); }
        }
        .draggable-card-dropped > div {
          animation:
            cardDropIn 0.38s cubic-bezier(0.22, 1, 0.36, 1) both,
            cardGlow   0.65s ease-out 0.15s both;
        }
        @keyframes columnPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
        @keyframes cardPickup {
          0%   { transform: rotate(0deg)   scale(1); }
          30%  { transform: rotate(1deg)   scale(1.03); }
          60%  { transform: rotate(1.8deg) scale(1.05); }
          100% { transform: rotate(1.5deg) scale(1.04); }
        }
        .card-clone-pickup {
          animation: cardPickup 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        [data-item-id] { cursor: grab; }
        [data-item-id]:active { cursor: grabbing; }
        [data-item-id] * { user-select: none; -webkit-user-select: none; }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>

      {/* Status comment modal */}
      <StatusCommentModal
        isOpen={modalOpen}
        item={pendingDrop?.item ?? null}
        fromColumn={pendingDrop?.fromCol ?? null}
        toColumn={pendingDrop?.toCol ?? null}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-4xl font-bold flex items-center gap-3">
            <Settings className="w-10 h-10" />
            Engineering
          </h1>
          <div className="flex gap-2">
            <Button
              onClick={() => setViewMode("summary")}
              variant={viewMode === "summary" ? "default" : "outline"}
              size="sm"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Summary
            </Button>
            <Button
              onClick={() => setViewMode("board")}
              variant={viewMode === "board" ? "default" : "outline"}
              size="sm"
            >
              <ListTodo className="w-4 h-4 mr-2" />
              Board View
            </Button>
            <Button
              onClick={() => setViewMode("table")}
              variant={viewMode === "table" ? "default" : "outline"}
              size="sm"
            >
              <LayoutList className="w-4 h-4 mr-2" />
              Table View
            </Button>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="border-b mb-6">
          <div className="flex gap-0">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "projects"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
              onClick={() => setActiveTab("projects")}
            >
              Projects
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-lg border bg-card p-3 shadow-sm mb-8">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters((prev) => !prev)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                showFilters
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card hover:bg-muted",
              )}
            >
              <SlidersHorizontal className="h-4 w-4 text-orange-500" />
              Filters
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  showFilters ? "rotate-180" : "",
                )}
              />
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear All
            </Button>
          </div>

          {showFilters && (
            <div className="mt-4 flex gap-4 flex-wrap items-end border-t pt-4">
              {/* Scope */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                  Scope
                </label>
                <Select
                  value={scopeFilter}
                  onValueChange={(v: "all" | "internal" | "customer") =>
                    setScopeFilter(v)
                  }
                >
                  <SelectTrigger size="sm" className="min-w-40 h-9">
                    <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    <SelectItem value="internal">Internal Projects</SelectItem>
                    <SelectItem value="customer">Customer Projects</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Team */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                  Team
                </label>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger size="sm" className="min-w-40 h-9">
                    <Users className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Teams</SelectItem>
                    {teamOptions
                      .filter((t) =>
                        scopeFilter === "customer" ? t.key !== "gint" : true,
                      )
                      .map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Status */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                  Status
                </label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger size="sm" className="min-w-40 h-9">
                    <FolderKanban className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Statuses</SelectItem>
                    <SelectItem value="BACKLOG">Backlog</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="IN_QA_REVIEW">In QA Review</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Owner */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                  Owner
                </label>
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger size="sm" className="min-w-44 h-9">
                    <Users className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Owners</SelectItem>
                    <SelectItem value="__me__">Assign to Me</SelectItem>
                    {ownerOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Priority */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                  Priority
                </label>
                <Select
                  value={priorityFilter}
                  onValueChange={setPriorityFilter}
                >
                  <SelectTrigger size="sm" className="min-w-44 h-9">
                    <Settings className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Priorities</SelectItem>
                    <SelectItem value="Minimal">P0 - Minimal</SelectItem>
                    <SelectItem value="Critical">P1 - Critical</SelectItem>
                    <SelectItem value="High">P2 - High</SelectItem>
                    <SelectItem value="Medium">P3 - Medium</SelectItem>
                    <SelectItem value="Low">P4 - Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filtering overlay */}
      {filtering && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm font-medium">Filtering…</span>
          </div>
        </div>
      )}

      {/* ════ SUMMARY VIEW ════ */}
      {viewMode === "summary" && !filtering && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="shadow-none border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    Total
                  </p>
                  <div className="rounded-md p-1.5 bg-blue-50">
                    <FolderKanban className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Projects
                    </span>
                    <span className="text-xl font-bold">
                      {computedSummary.projectCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Loops</span>
                    <span className="text-xl font-bold">
                      {computedSummary.loopCount}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-none border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    Total Teams
                  </p>
                  <div className="rounded-md p-1.5 bg-orange-50">
                    <Users className="h-3.5 w-3.5 text-orange-500" />
                  </div>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {Object.keys(computedSummary.byTeam).length}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-none border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    Issues Completed
                  </p>
                  <div className="rounded-md p-1.5 bg-green-50">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  </div>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {allItems.reduce(
                    (sum, item) => sum + item.completedIssues,
                    0,
                  )}{" "}
                  / {allItems.reduce((sum, item) => sum + item.totalIssues, 0)}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-none border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    Overall Progress
                  </p>
                  <div className="rounded-md p-1.5 bg-yellow-50">
                    <Activity className="h-3.5 w-3.5 text-yellow-500" />
                  </div>
                </div>
                <p className="text-2xl font-bold mt-1">
                  {allItems.length > 0
                    ? Math.round(
                        allItems.reduce((sum, item) => sum + item.progress, 0) /
                          allItems.length,
                      )
                    : 0}
                  %
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Distribution by Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex justify-between items-center p-3 rounded-md bg-muted/50">
                    <span className="text-sm font-medium">Projects</span>
                    <Badge variant="secondary">
                      {computedSummary.projectCount}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-md bg-muted/50">
                    <span className="text-sm font-medium">Loops</span>
                    <Badge variant="default">{computedSummary.loopCount}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {Object.keys(computedSummary.byTeam).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Distribution by Team (Projects)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(computedSummary.byTeam)
                      .sort((a, b) => b[1] - a[1])
                      .map(([team, count]) => (
                        <div
                          key={team}
                          className="flex justify-between items-center p-3 rounded-md bg-muted/50"
                        >
                          <span className="text-sm font-medium">{team}</span>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {computedSummary.activeItems.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Active Work Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {computedSummary.activeItems.map((item) => (
                      <Card
                        key={item.id}
                        className="border-l-4 border-l-blue-500 cursor-pointer hover:shadow-md transition-all"
                        onClick={() => navigateToItem(item)}
                      >
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {getEntityBadge(item.entity)}
                                <span className="font-semibold text-sm">
                                  {item.name}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <div>
                                  Status:{" "}
                                  <span className="font-medium">
                                    {item.state}
                                  </span>
                                </div>
                                {item.leadName && item.leadName !== "N/A" && (
                                  <div>Owner: {item.leadName}</div>
                                )}
                                {item.targetDate &&
                                  item.targetDate !== "N/A" && (
                                    <div>
                                      Target: {formatDate(item.targetDate)}
                                    </div>
                                  )}
                                {getPriorityBadge(item.priority)}
                              </div>
                            </div>
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </a>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Project Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {computedSummary.healthIssues.length > 0 && (
                    <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200">
                      {computedSummary.healthIssues.length} Project
                      {computedSummary.healthIssues.length !== 1
                        ? "s"
                        : ""}{" "}
                      have no Lead / no Dates / no KRs
                    </div>
                  )}
                  {computedSummary.healthyProjects.length > 0 && (
                    <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200">
                      {computedSummary.healthyProjects.length} Project
                      {computedSummary.healthyProjects.length !== 1
                        ? "s"
                        : ""}{" "}
                      have timeline + scope + KRs
                    </div>
                  )}
                  {computedSummary.healthIssues.length === 0 &&
                    computedSummary.healthyProjects.length === 0 && (
                      <div className="text-muted-foreground">
                        No projects to analyze.
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ════ TABLE VIEW ════ */}
      {viewMode === "table" && !filtering && (
        <Card className="shadow-none border">
          <CardContent className="pt-6">
            <div className="h-[560px] w-full">
              <div className="ag-theme-alpine h-full w-full">
                <AgGridReact
                  theme="legacy"
                  rowData={allItems}
                  columnDefs={columnDefs}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                  }}
                  rowHeight={52}
                  animateRows={true}
                />
              </div>
            </div>
            <div className="border-t bg-card px-4 py-3 mt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="font-medium">{allItems.length}</span>{" "}
                  of{" "}
                  <span className="font-medium">
                    {pagination?.totalCount ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <select
                    value={pageSize}
                    onChange={(e) =>
                      handlePageSizeChange(Number(e.target.value))
                    }
                    className="rounded border px-2 py-1 text-sm bg-background"
                  >
                    {[5, 20, 50, 100].map((s) => (
                      <option key={s} value={s}>
                        {s} / page
                      </option>
                    ))}
                  </select>
                  <div className="text-sm">
                    Page {currentPage} of {pagination?.totalPages ?? 1}
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={cursorStack.length === 0}
                      onClick={() => {
                        setCursorStack((prev) => {
                          const stack = [...prev];
                          const prevCursor = stack.pop() ?? null;
                          tableCursorChangeRef.current = true;
                          setActiveCursor(prevCursor);
                          setCurrentPage((p) => Math.max(1, p - 1));
                          return stack;
                        });
                      }}
                      className="rounded border p-2 disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      <ChevronDown className="w-4 h-4 rotate-90" />
                    </button>
                    <button
                      disabled={!pagination?.nextCursor}
                      onClick={() => {
                        tableCursorChangeRef.current = true;
                        setCursorStack((prev) => [...prev, activeCursor]);
                        setActiveCursor(pagination?.nextCursor ?? null);
                        setCurrentPage((p) => p + 1);
                      }}
                      className="rounded border p-2 disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      <ChevronDown className="w-4 h-4 -rotate-90" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ════ BOARD VIEW ════ */}
      {viewMode === "board" && !filtering && (
        <>
          {draggingItemId && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
              <div
                className="bg-foreground/90 text-background text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2"
                style={{ animation: "fadeIn 0.15s ease-out" }}
              >
                <span
                  className={cn(
                    "w-2 h-2 rounded-full animate-pulse",
                    allItems.find((i) => i.id === draggingItemId)?.entity ===
                      "LOOP"
                      ? "bg-blue-400"
                      : "bg-orange-400",
                  )}
                />
                Drag to another column to move
                <ArrowRight className="w-3 h-3 opacity-60" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {BOARD_COLUMNS.map((col) => (
              <DropColumn
                key={col}
                col={col}
                items={boardColumns[col]}
                draggingItemId={draggingItemId}
                isOver={overColumn === col && draggingItemId !== null}
                newlyDroppedId={newlyDroppedId}
                onMouseDown={handleMouseDown}
              />
            ))}
          </div>

          <div ref={scrollSentinelRef} className="flex justify-center py-6">
            {loadingMore && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading more items…</span>
              </div>
            )}
            {pagination && !pagination.hasMore && allItems.length > 0 && (
              <span className="text-xs text-muted-foreground">
                Showing all {allItems.length} items
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
