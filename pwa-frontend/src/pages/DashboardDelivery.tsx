import "@/lib/ag-grid-config";
import React, { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Loader from "@/components/Loader";
import apiClient from "@/api/client";
import toast from "react-hot-toast";
import { useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  SlidersHorizontal,
  ChevronDown,
  FolderKanban,
  Users,
  CheckCircle2,
  Activity,
  CalendarIcon,
  Download,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/context/PermissionsContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns/format";
import { LOOP_PHASES, LOOP_TYPES } from "@enterprise/common";


// ─── Types ─────────────────────────────────────────────────────────────────

interface UnifiedDeliveryItem {
  id: string;
  entity: "PROJECT" | "LOOP";
  name: string;
  status_name: string;
  priority: string | null;
  progress: number;
  leadName: string | null;
  leadEmail: string | null;
  members: { email: string; name?: string }[];
  teams: { name: string }[];
  totalIssues: number;
  completedIssues: number;
  startDate: string | null;
  targetDate: string | null;
  updatedAt: string | null;
  updatedBy?: string | null;
  url: string | null;
  phase?: string | null;
  category?: string | null;
  tags?: string[];
}

interface DeliverySummary {
  total: number;
  projectCount: number;
  loopCount: number;
  internalCount: number;
  externalCount: number;
  teamCount: number;
  by_status_name: Record<string, number>;
  available_status_names: { status_name: string; count: number }[];
  loopPhases: string[];
  loopCategories: string[];
  loopTypes: string[];
  available_teams: { key: string; name: string }[];
  totalIssues: number;
  totalCompleted: number;
  overallProgress: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { label: "Backlog", value: "Backlog" },
  { label: "In Progress", value: "In Progress" },
  { label: "In QA Review", value: "In QA Review" },
  { label: "Completed", value: "Completed" },
  { label: "Canceled", value: "Canceled" },
  { label: "Delay & Incompleted", value: "Delay & Incompleted" },
  { label: "Planned", value: "Planned" },
];

const PRIORITY_OPTIONS = [
  { label: "🔴 Critical", value: "Critical" },
  { label: "🟠 High", value: "High" },
  { label: "🟡 Medium", value: "Medium" },
  { label: "🟢 Low", value: "Low" },
  { label: "⚪ Minimal", value: "Minimal" },
];

const PROGRESS_OPTIONS = [
  { label: "0%", value: "0%" },
  { label: "1–50%", value: "1-50%" },
  { label: "51–99%", value: "51-99%" },
  { label: "100%", value: "100%" },
];

const LOOP_CATEGORY_OPTIONS = [
  { label: "GTM", value: "GTM" },
  { label: "BD", value: "BD" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDateOnly(value: any): string {
  if (!value) return "-";
  if (typeof value === "string") {
    const datePart = value.split("T")[0];
    if (datePart) return datePart;
  }
  try {
    return new Date(value).toLocaleDateString("en-CA");
  } catch {
    return "-";
  }
}

function navigateToItem(
  navigate: ReturnType<typeof useNavigate>,
  item: UnifiedDeliveryItem,
) {
  if (item.entity === "LOOP") {
    const loopId = item.id.replace(/^loop_/, "");
    navigate(ROUTES.APP.LOOP.path.replace(":loopId", loopId), {
      state: { loopId, from: ROUTES.APP.DELIVERY.id },
    });
  } else {
    const id = item.id.replace(/^proj_/, "");
    navigate(ROUTES.APP.PROJECT_DETAILS.path.replace(":projectId", id), {
      state: { from: ROUTES.APP.DELIVERY.id },
    });
  }
}

function progressColor(pct: number): string {
  if (pct >= 75) return "bg-green-500";
  if (pct >= 40) return "bg-yellow-400";
  return "bg-red-400";
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

function SkeletonBox({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

// ─── Reusable filter components ────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  width = "w-40",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Select
          value={value || "_none"}
          onValueChange={(v) => onChange(v === "_none" ? "" : v)}
        >
          <SelectTrigger className={cn("h-8 shadow-none", width)}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">{placeholder}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  width = "min-w-[150px]",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-8 rounded border px-2 text-sm bg-background", width)}
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Summary Cards ─────────────────────────────────────────────────────────

function SummaryCards({
  summary,
  loading,
  // effective team count: 1 when a specific team is filtered, else summary.teamCount
  effectiveTeamCount,
}: {
  summary: DeliverySummary | null;
  loading: boolean;
  effectiveTeamCount: number;
}) {
  const cards = [
    {
      label: "Total",
      icon: FolderKanban,
      color: "text-blue-500",
      bg: "bg-blue-50",
      render: () => (
        <div className="flex flex-col gap-0.5 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Internal Projects
            </span>
            <span className="text-xl font-bold">
              {summary?.internalCount ?? 0}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Customer Projects
            </span>
            <span className="text-xl font-bold">
              {summary?.externalCount ?? 0}
            </span>
          </div>
        </div>
      ),
    },
    {
      label: "Total Teams",
      icon: Users,
      color: "text-orange-500",
      bg: "bg-orange-50",
      // ── Use effectiveTeamCount so it shows 1 when a team filter is active ──
      render: () => (
        <p className="text-2xl font-bold mt-1">{effectiveTeamCount}</p>
      ),
    },
    {
      label: "KRs Completed",
      icon: CheckCircle2,
      color: "text-green-500",
      bg: "bg-green-50",
      render: () => (
        <p className="text-2xl font-bold mt-1">
          {summary
            ? `${summary.totalCompleted} / ${summary.totalIssues}`
            : "0 / 0"}
        </p>
      ),
    },
    {
      label: "Overall Progress",
      icon: Activity,
      color: "text-yellow-500",
      bg: "bg-yellow-50",
      render: () => (
        <>
          <p className="text-2xl font-bold mt-1">
            {summary ? `${summary.overallProgress}%` : "0%"}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
            <div
              className={cn(
                "h-1.5 rounded-full",
                progressColor(summary?.overallProgress ?? 0),
              )}
              style={{ width: `${summary?.overallProgress ?? 0}%` }}
            />
          </div>
        </>
      ),
    },
  ];

  // ── Loading state — spinner inside each card ─────────────────────────────
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="shadow-none border">
              <CardContent className="p-4">
                {/* Header row: label + icon always visible */}
                <div className="flex items-start justify-between mb-2">
                  <p className="text-xs text-muted-foreground font-medium">
                    {card.label}
                  </p>
                  <div className={cn("rounded-md p-1.5", card.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", card.color)} />
                  </div>
                </div>
                {/* Centered spinner */}
                <div className="flex items-center justify-center h-10">
                  <Loader />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // ── Loaded state ─────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="shadow-none border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-1">
                <p className="text-xs text-muted-foreground font-medium">
                  {card.label}
                </p>
                <div className={cn("rounded-md p-1.5", card.bg)}>
                  <Icon className={cn("h-3.5 w-3.5", card.color)} />
                </div>
              </div>
              {card.render()}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function DashboardDelivery() {
  const navigate = useNavigate();

  const [rows, setRows] = React.useState<UnifiedDeliveryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [summary, setSummary] = React.useState<DeliverySummary | null>(null);

  // ── Track whether current load is a filter/tab change (not pagination) ──
  // Summary cards should skeleton only on filter/tab change, not on page nav
  // Initialize to true so skeleton shows on first load
  const [summaryLoading, setSummaryLoading] = React.useState(true);

  // ── In-memory cache ──────────────────────────────────────────────────────
  // Keyed by serialized filter+pagination params, expires after CACHE_TTL_MS
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  interface CacheEntry {
    rows: UnifiedDeliveryItem[];
    summary: DeliverySummary | null;
    totalCount: number;
    totalPages: number;
    nextCursor: string | null;
    currentPage: number;
    ts: number;
  }
  const cache = React.useRef<Map<string, CacheEntry>>(new Map());

  // ── Race-condition guard ──────────────────────────────────────────────────
  // Each call to fetchDelivery gets a monotonically increasing ID.
  // If a newer fetch fires before this one resolves, we discard the
  // stale response so old data never overwrites newer tab/filter data.
  const fetchIdRef = React.useRef(0);

  // ── Session ──────────────────────────────────────────────────────────────
  const [userEmail, setUserEmail] = React.useState<string>("");
  const [sessionReady, setSessionReady] = React.useState(false);

  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const gridRef = React.useRef<AgGridReact>(null);

  const exportToCsv = React.useCallback(() => {
    if (gridRef.current) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `delivery_items_export_${new Date().toISOString().split("T")[0]}.csv`,
      });
    }
  }, []);

  React.useEffect(() => {
    const loadEmail = async () => {
      try {
        // Dev mode bypass — skip Cognito calls with placeholder credentials
        if (import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX') {
          setUserEmail('dev@local');
          setSessionReady(true);
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setUserEmail(String(sessionEmail || ""));
      } catch (err) {
        console.warn("Failed to load session email", err);
      } finally {
        setSessionReady(true);
      }
    };
    loadEmail();
  }, []);

  // ── Pagination ───────────────────────────────────────────────────────────
  const [pageSize, setPageSize] = React.useState(20);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalCount, setTotalCount] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [activeCursor, setActiveCursor] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [cursorStack, setCursorStack] = React.useState<Array<string | null>>(
    [],
  );

  // ── Filter state ─────────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = React.useState(false);
  const [tab, setTab] = React.useState<"my" | "all">("my");

  // Common filters
  const [scopeFilter, setScopeFilter] = React.useState<
    "all" | "internal" | "customer"
  >("all");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState("");
  const [ownerFilter, setOwnerFilter] = React.useState("");
  const [progressFilter, setProgressFilter] = React.useState("");
  const [targetDateFilter, setTargetDateFilter] = React.useState("");

  // Team filter (always visible)
  const [projectTeam, setProjectTeam] = React.useState("");

  const activeFilterCount = [
    scopeFilter !== "all" ? "scope" : "",
    statusFilter,
    priorityFilter,
    ownerFilter,
    progressFilter,
    targetDateFilter,
    projectTeam,
  ].filter(Boolean).length;

  // ── effectiveTeamCount ───────────────────────────────────────────────────
  // When a specific team is selected show 1; otherwise use summary.teamCount.
  // This is a pure derived value — no extra API calls needed.
  const effectiveTeamCount = projectTeam ? 1 : (summary?.teamCount ?? 0);

  // ── Pagination reset ──────────────────────────────────────────────────────
  function resetPagination() {
    setActiveCursor(null);
    setNextCursor(null);
    setCursorStack([]);
    setCurrentPage(1);
  }

  function applyFilter<T>(setter: React.Dispatch<React.SetStateAction<T>>) {
    return (v: T) => {
      setter(v);
      setSummaryLoading(true);
      resetPagination();
    };
  }

  function handleTabChange(newTab: "my" | "all") {
    setTab(newTab);
    setSummaryLoading(true);
    resetPagination();
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    resetPagination();
  }

  function resetAllFilters() {
    setScopeFilter("all");
    setStatusFilter("");
    setPriorityFilter("");
    setOwnerFilter("");
    setProgressFilter("");
    setTargetDateFilter("");
    setProjectTeam("");
    setSummaryLoading(true);
    resetPagination();
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  // Build a stable string key from all params that affect the API response
  function makeCacheKey(
    cursor: string | null,
    size: number,
    tabVal: string,
    scopeVal: string,
    emailVal: string,
    status: string,
    priority: string,
    owner: string,
    progress: string,
    targetDate: string,
    team: string,
  ): string {
    return JSON.stringify([
      tabVal,
      scopeVal,
      emailVal,
      status,
      priority,
      owner,
      progress,
      targetDate,
      team,
      cursor,
      size,
    ]);
  }

  const fetchDelivery = React.useCallback(
    async (cursor: string | null, size: number) => {
      // Claim a unique ID for this invocation
      const fetchId = ++fetchIdRef.current;

      const cacheKey = makeCacheKey(
        cursor,
        size,
        tab,
        scopeFilter,
        userEmail,
        statusFilter,
        priorityFilter,
        ownerFilter,
        progressFilter,
        targetDateFilter,
        projectTeam,
      );

      // ── Cache hit ────────────────────────────────────────────────────────
      const cached = cache.current.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        // Only apply if we're still the latest request
        if (fetchId !== fetchIdRef.current) return;
        setRows(cached.rows);
        setSummary(cached.summary);
        setTotalCount(cached.totalCount);
        setTotalPages(cached.totalPages);
        setNextCursor(cached.nextCursor);
        setCurrentPage(cached.currentPage);
        setLoading(false);
        setSummaryLoading(false);
        return;
      }

      // ── Cache miss — fetch from API ───────────────────────────────────────
      setLoading(true);
      try {
        const params: Record<string, any> = {
          limit: size,
          tab,
          scope: scopeFilter,
        };
        if (tab === "my" && userEmail) params.callerEmail = userEmail;
        if (cursor) params.cursor = cursor;
        if (statusFilter) params.status = statusFilter;
        if (priorityFilter) params.priority = priorityFilter;
        if (ownerFilter) params.owner = ownerFilter;
        if (progressFilter) params.progress = progressFilter;
        if (targetDateFilter) params.targetDate = targetDateFilter;
        if (projectTeam) params.projectTeam = projectTeam;

        const res = await apiClient.get("/delivery", { params });

        // ── Discard stale response if a newer fetch has since fired ─────────────
        if (fetchId !== fetchIdRef.current) return;

        const payload = res.data?.data;
        const items: UnifiedDeliveryItem[] = payload?.data ?? [];
        const pagination = payload?.pagination;

        const nextCur = pagination?.nextCursor ?? null;
        const totCount = pagination?.totalCount ?? 0;
        const totPages = pagination?.totalPages ?? 1;
        const curPage = cursorStack.length + 1;

        setRows(items);
        setSummary(payload?.summary ?? null);
        setTotalCount(totCount);
        setTotalPages(totPages);
        setNextCursor(nextCur);
        setCurrentPage(curPage);

        // ── Write to cache ──────────────────────────────────────────────────
        cache.current.set(cacheKey, {
          rows: items,
          summary: payload?.summary ?? null,
          totalCount: totCount,
          totalPages: totPages,
          nextCursor: nextCur,
          currentPage: curPage,
          ts: Date.now(),
        });
      } catch (e) {
        if (fetchId !== fetchIdRef.current) return; // discard error from stale request too
        console.error(e);
        toast.error("Failed to load delivery items");
        setRows([]);
        setSummary(null);
      } finally {
        // Only clear loading if this is still the active request
        if (fetchId === fetchIdRef.current) {
          setLoading(false);
          setSummaryLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tab,
      scopeFilter,
      userEmail,
      statusFilter,
      priorityFilter,
      ownerFilter,
      progressFilter,
      targetDateFilter,
      projectTeam,
    ],
  );

  React.useEffect(() => {
    if (!sessionReady) return;
    fetchDelivery(activeCursor, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCursor, pageSize, sessionReady, fetchDelivery]);

  // ── Column defs ──────────────────────────────────────────────────────────
  const columnDefs: any = useMemo(
    () => [
      {
        headerName: "Type",
        field: "entity",
        flex: 0.7,
        cellRenderer: (p: any) => (
          <Badge
            variant="default"
            className={cn(
              "text-xs",
              p.value === "PROJECT" ? "default" : "",
              p.value === "LOOP" ? "bg-blue-200" : "",
            )}
          >
            {p.value}
          </Badge>
        ),
      },
      {
        headerName: "Name",
        field: "name",
        flex: 2,
        cellRenderer: (p: any) => (
          <Button
            variant="link"
            className="text-yellow-600 font-bold p-0 h-auto text-left"
            onClick={() => navigateToItem(navigate, p.data)}
          >
            {p.value || "-"}
          </Button>
        ),
      },
      {
        headerName: "Status",
        field: "status_name",
        flex: 1,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        headerName: "Priority",
        field: "priority",
        flex: 0.8,
        cellRenderer: (p: any) => {
          const v = p.value;
          if (v === null || v === undefined || v === "")
            return <span className="text-gray-400 text-xs">—</span>;

          const config: Record<string, { dot: string; text: string }> = {
            Critical: { dot: "bg-red-500", text: "text-red-600" },
            High: { dot: "bg-orange-500", text: "text-orange-600" },
            Medium: { dot: "bg-yellow-400", text: "text-yellow-600" },
            Low: { dot: "bg-green-500", text: "text-green-600" },
            Minimal: { dot: "bg-gray-400", text: "text-gray-500" },
          };
          const c = config[v] ?? { dot: "bg-gray-300", text: "text-gray-500" };
          return (
            <div className="flex items-center gap-1.5 h-full">
              <span
                className={cn("h-2 w-2 rounded-full flex-shrink-0", c.dot)}
              />
              <span className={cn("text-xs font-medium", c.text)}>{v}</span>
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
              <span className="text-xs w-8 text-right">{pct}%</span>
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
        headerName: "Members",
        field: "members",
        flex: 2,
        sortable: false,
        filter: false,
        autoHeight: true,
        valueFormatter: (p: any) => {
          const members = p.value as UnifiedDeliveryItem["members"] | undefined;
          if (!members?.length) return "";
          return members.map((m) => m.name || m.email).join(", ");
        },
        cellRenderer: (p: any) => {
          const members: UnifiedDeliveryItem["members"] = p.value ?? [];
          if (!members.length)
            return <span className="text-gray-400 text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-1 py-1">
              {members.map((m, i) => (
                <span
                  key={i}
                  title={m.email}
                  className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 border border-gray-200 whitespace-nowrap"
                >
                  {m.name || m.email}
                </span>
              ))}
            </div>
          );
        },
      },
      // {
      //   headerName: "Updated By",
      //   field: "updatedBy",
      //   flex: 1.2,
      //   cellRenderer: (p: any) => (
      //     <div className="flex items-center h-full">
      //       <span className="text-xs truncate text-muted-foreground" title={p.value || ""}>
      //         {p.value || "—"}
      //       </span>
      //     </div>
      //   ),
      // },
      {
        headerName: "Teams",
        field: "teams",
        flex: 1.5,
        sortable: false,
        filter: false,
        autoHeight: true,
        valueFormatter: (p: any) => {
          const teams = p.value as UnifiedDeliveryItem["teams"] | undefined;
          if (!teams?.length) return "";
          return teams.map((t) => t.name).join(", ");
        },
        cellRenderer: (p: any) => {
          const teams: UnifiedDeliveryItem["teams"] = p.value ?? [];
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
        headerName: "Key Results",
        flex: 0.9,
        sortable: false,
        filter: false,
        valueGetter: (p: any) => {
          const item: UnifiedDeliveryItem = p.data;
          if (item.entity === "LOOP") return "-";
          return `${item.completedIssues} / ${item.totalIssues}`;
        },
      },
      {
        headerName: "Start Date",
        field: "startDate",
        flex: 1.1,
        valueFormatter: (p: any) => formatDateOnly(p.value),
      },
      {
        headerName: "Due Date",
        field: "targetDate",
        flex: 1.1,
        valueFormatter: (p: any) => formatDateOnly(p.value),
      },
      {
        headerName: "URL",
        field: "url",
        flex: 0.8,
        sortable: false,
        filter: false,
        cellRenderer: (p: any) =>
          p.value ? (
            <a
              href={p.value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline text-sm"
            >
              Open ↗
            </a>
          ) : (
            <span className="text-gray-400">-</span>
          ),
      },
    ],
    [navigate],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-10 space-y-6">
      <h1 className="text-3xl font-bold">Delivery</h1>

      {/* Summary cards — passes effectiveTeamCount so it reacts to team filter */}
      <SummaryCards
        summary={summary}
        loading={summaryLoading}
        effectiveTeamCount={effectiveTeamCount}
      />

      <Card className="shadow-none">
        <CardHeader>
          {/* My / All & Export */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              {(["my", "all"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tab === t ? "default" : "outline"}
                  onClick={() => handleTabChange(t)}
                >
                  {t === "my" ? "My" : "All"}
                </Button>
              ))}
            </div>

            {isAdminOrAbove && (
              <Button size="sm" variant="outline" onClick={exportToCsv} className="gap-2">
                <Download className="h-4 w-4" />
                Export to CSV
              </Button>
            )}
          </div>

          {/* ── Filter Bar ── */}
          <div className="mt-4 rounded-lg border bg-card p-3">
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
                {activeFilterCount > 0 && (
                  <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] text-white font-bold">
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showFilters ? "rotate-180" : "",
                  )}
                />
              </button>
            </div>

            {showFilters && (
              <div className="mt-3 space-y-5 border-t pt-3">
                <div>
                  <div className="flex flex-wrap items-end gap-3">
                    {/* Scope */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-medium">
                        Scope
                      </label>
                      <div className="flex items-center gap-1">
                        <Select
                          value={scopeFilter}
                          onValueChange={(v) => {
                            applyFilter(setScopeFilter)(
                              v as "all" | "internal" | "customer",
                            );
                            // Reset team filter when scope changes
                            applyFilter(setProjectTeam)("");
                          }}
                        >
                          <SelectTrigger className="h-8 w-44 shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Projects</SelectItem>
                            <SelectItem value="internal">
                              Internal Projects
                            </SelectItem>
                            <SelectItem value="customer">
                              Customer Projects
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {scopeFilter !== "all" && (
                          <button
                            onClick={() => applyFilter(setScopeFilter)("all")}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Team filter — always visible, like Engineering */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-medium">
                        Team
                      </label>
                      <div className="flex items-center gap-1">
                        <Select
                          value={projectTeam || "__all__"}
                          onValueChange={(v) =>
                            applyFilter(setProjectTeam)(
                              v === "__all__" ? "" : v,
                            )
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-44 shadow-none"
                          >
                            <SelectValue placeholder="All Teams" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All Teams</SelectItem>
                            {(summary?.available_teams ?? [])
                              .filter((t) => {
                                if (scopeFilter === "customer") {
                                  return t.key.toLowerCase() !== "gint";
                                }
                                return true;
                              })
                              .map((t) => (
                                <SelectItem key={t.key} value={t.key}>
                                  {t.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {projectTeam && (
                          <button
                            onClick={() => applyFilter(setProjectTeam)("")}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    <FilterSelect
                      label="Status"
                      value={statusFilter}
                      onChange={applyFilter(setStatusFilter)}
                      options={STATUS_OPTIONS}
                      placeholder="All Statuses"
                      width="w-48"
                    />

                    <FilterSelect
                      label="Priority"
                      value={priorityFilter}
                      onChange={applyFilter(setPriorityFilter)}
                      options={PRIORITY_OPTIONS}
                      placeholder="All Priorities"
                      width="w-36"
                    />

                    {/* Target Date */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-medium">
                        Target Date
                      </label>
                      <div className="flex items-center gap-1">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="h-8 w-44 justify-start text-left font-normal shadow-none"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {targetDateFilter
                                ? format(
                                  new Date(targetDateFilter),
                                  "dd/MM/yyyy",
                                )
                                : "Choose Date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={
                                targetDateFilter
                                  ? new Date(targetDateFilter)
                                  : undefined
                              }
                              onSelect={(date) => {
                                applyFilter(setTargetDateFilter)(
                                  date ? format(date, "yyyy-MM-dd") : "",
                                );
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        {targetDateFilter && (
                          <button
                            onClick={() => applyFilter(setTargetDateFilter)("")}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    <FilterInput
                      label="Owner"
                      value={ownerFilter}
                      onChange={applyFilter(setOwnerFilter)}
                      placeholder="Email or name…"
                      width="min-w-[180px]"
                    />
                  </div>
                </div>

                {/* Clear all */}
                {activeFilterCount > 0 && (
                  <div className="flex justify-end border-t pt-2">
                    <button
                      onClick={resetAllFilters}
                      className="text-xs text-muted-foreground hover:text-destructive underline"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader description="Loading delivery items..." />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm mt-4">No delivery items found</p>
            </div>
          ) : (
            <>
              <div className="h-[560px] w-full">
                <div className="ag-theme-alpine h-full w-full">
                  <AgGridReact
                    ref={gridRef}
                    theme="legacy"
                    rowData={rows}
                    columnDefs={columnDefs}
                    pagination={false}
                    defaultColDef={{
                      sortable: true,
                      filter: true,
                      resizable: true,
                    }}
                    rowHeight={52}
                  />
                </div>
              </div>

              {/* Pagination */}
              <div className="border-t bg-card px-4 py-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing <span className="font-medium">{rows.length}</span>{" "}
                    of <span className="font-medium">{totalCount}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <select
                      value={pageSize}
                      onChange={(e) =>
                        handlePageSizeChange(Number(e.target.value))
                      }
                      className="rounded border px-2 py-1 text-sm"
                    >
                      {[5, 20, 50, 100].map((s) => (
                        <option key={s} value={s}>
                          {s} / page
                        </option>
                      ))}
                    </select>
                    <div className="text-sm">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={cursorStack.length === 0}
                        onClick={() => {
                          // pagination nav — do NOT trigger summary skeleton
                          setCursorStack((prev) => {
                            const stack = [...prev];
                            const prevCursor = stack.pop() ?? null;
                            setActiveCursor(prevCursor);
                            setCurrentPage((p) => Math.max(1, p - 1));
                            return stack;
                          });
                        }}
                        className="rounded border p-2 disabled:opacity-40"
                      >
                        ◀
                      </button>
                      <button
                        disabled={!nextCursor}
                        onClick={() => {
                          // pagination nav — do NOT trigger summary skeleton
                          setCursorStack((prev) => [...prev, activeCursor]);
                          setActiveCursor(nextCursor);
                          setCurrentPage((p) => p + 1);
                        }}
                        className="rounded border p-2 disabled:opacity-40"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
