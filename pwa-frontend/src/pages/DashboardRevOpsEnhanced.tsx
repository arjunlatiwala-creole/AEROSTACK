import "@/lib/ag-grid-config";
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { AgGridReact } from "ag-grid-react";
import ReactFlow, {
  type Node,
  type Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Table,
  LayoutGrid,
  Inbox,
  Maximize2,
  X,
  RefreshCw,
  CalendarIcon,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import Loader from "@/components/Loader";
import toast from "react-hot-toast";
import { getDeals } from "@/api/hubspot";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";


type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";
type Phase =
  | "LEAD"
  | "DEVELOPING"
  | "ACTIVELY_FUNDING"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "LAUNCHED"
  | "PROPOSED";

const HEALTH_COLORS: Record<HealthStatus, string> = {
  GREEN: "text-emerald-500",
  YELLOW: "text-yellow-400",
  ORANGE: "text-orange-500",
  RED: "text-red-500",
};

const HEALTH_BG_COLORS: Record<HealthStatus, string> = {
  GREEN: "border-emerald-500",
  YELLOW: "border-yellow-400",
  ORANGE: "border-orange-500",
  RED: "border-red-500",
};

const PHASE_BG_COLORS: Record<Phase, string> = {
  LEAD: "bg-emerald-50",
  DEVELOPING: "bg-yellow-50",
  ACTIVELY_FUNDING: "bg-amber-100",
  CLOSED_WON: "bg-green-100",
  CLOSED_LOST: "bg-red-100",
  LAUNCHED: "bg-blue-100",
  PROPOSED: "bg-purple-100",
};

const PHASE_NODE_COLORS: Record<Phase, string> = {
  LEAD: "#E8F5E9",
  DEVELOPING: "#FFF9C4",
  ACTIVELY_FUNDING: "#FFE082",
  CLOSED_WON: "#C8E6C9",
  CLOSED_LOST: "#FFCDD2",
  LAUNCHED: "#7abbf0",
  PROPOSED: "#E1BEE7",
};

const HEALTH_HEX_COLORS: Record<HealthStatus, string> = {
  GREEN: "#4CAF50",
  YELLOW: "#FFEB3B",
  ORANGE: "#FF9800",
  RED: "#F44336",
};

export type ContactInfo = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

interface Deal {
  deal_id?: string;
  id?: string;
  closedate?: string;
  name: string;
  company: string;
  amount: number;
  health_status: HealthStatus;
  phase?: Phase;
  stage?: string;
  stage_name?: string;
  priority?: number;
  confidence_score?: number;
  contacts?: ContactInfo[];
  owner_email?: string;
}

interface PipelinePhase {
  phase: Phase;
  stages: string[];
  deal_count: number;
  total_value: number;
  health_distribution: Partial<Record<HealthStatus, number>>;
  deals: Deal[];
}

interface DashboardData {
  pipeline: PipelinePhase[];
  summary: {
    total_deals: number;
    total_pipeline_value: number;
    deals_by_phase: Partial<Record<Phase, number>>;
    health_distribution: Partial<Record<HealthStatus, number>>;
  };
  recent_activity: unknown[];
}

interface StageView {
  stage: string;
  phase: Phase;
  deals: Deal[];
  deal_count: number;
  total_value: number;
}

type ViewMode = "cards" | "table" | "flow";

export default function DashboardRevOpsEnhanced() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("flow");
  const [isFullscreenFlow, setIsFullscreenFlow] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [totalDeals, setTotalDeals] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingTable, setLoadingTable] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cardsDeals, setCardsDeals] = useState<DashboardData | null>(null);
  const [totalPipelineValue, setTotalPipelineValue] = useState(0);
  const [health_distribution, setHealthDistribution] = useState<
    Partial<Record<HealthStatus, number>>
  >({});
  const [activeDeals, setActiveDeals] = useState(0);
  const [availablePhases, setAvailablePhases] = useState<
    { phase: Phase; count: number }[]
  >([]);

  // ── Two separate loading flags ────────────────────────────────────────────
  // isInitialLoad: first page load → show Loader in cards
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // isFilterLoading: filter/tab changed (not pagination) → show Loader in cards
  const [isFilterLoading, setIsFilterLoading] = useState(false);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [oppFilter, setOppFilter] = useState<"enterprise" | "all">("enterprise");
  const [phaseFilter, setPhaseFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [availableStages, setAvailableStages] = useState<
    { stage: string; count: number }[]
  >([]);

  const [pipelineFilter, setPipelineFilter] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [pipelineNames, setPipelineNames] = useState<string[]>([]);

  useEffect(() => {
    fetchDealsPage(cursor, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cursor,
    pageSize,
    oppFilter,
    phaseFilter,
    stageFilter,
    pipelineFilter,
    closeDate,
  ]);

  useEffect(() => {
    if (!cardsDeals) return;
    buildFlowData(cardsDeals, deals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsDeals, deals]);

  // ── Filter handlers — mark isFilterLoading & reset cursor ─────────────────
  const handleOppFilter = (val: "enterprise" | "all") => {
    // Opp type change → reset ALL filters (scope changes completely)
    setOppFilter(val);
    setPipelineFilter("");
    setPhaseFilter("");
    setStageFilter("");
    setCloseDate("");
    setIsFilterLoading(true);
    setCursor(null);
    setCursorStack([]);
  };

  const handlePipelineFilter = (val: string) => {
    // Pipeline change → keep stage/date filters intact.
    // If the selected stage does not exist in the new pipeline,
    // the backend returns no items — correct behaviour, no need to clear.
    setPipelineFilter(val);
    setIsFilterLoading(true);
    setCursor(null);
    setCursorStack([]);
  };

  const handlePhaseFilter = (val: string) => {
    setPhaseFilter(val);
    setIsFilterLoading(true);
    setCursor(null);
    setCursorStack([]);
  };
  const handleStageFilter = (val: string) => {
    setStageFilter(val);
    setIsFilterLoading(true);
    setCursor(null);
    setCursorStack([]);
  };

  const handleCloseDate = (val: string) => {
    setCloseDate(val);
    setIsFilterLoading(true);
    setCursor(null);
    setCursorStack([]);
  };

  // ── Pagination handlers — do NOT set isFilterLoading ──────────────────────
  const handlePreviousPage = () => {
    setCursorStack((prev) => {
      const stack = [...prev];
      const prevCursor = stack.pop() || null;
      setCursor(prevCursor);
      return stack;
    });
    // no isFilterLoading — cards keep their current values
  };

  const handleNextPage = () => {
    setCursorStack((prev) => [...prev, cursor ?? ""]);
    setCursor(nextCursor);
    // no isFilterLoading
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCursor(null);
    setCursorStack([]);
    // no isFilterLoading
  };

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchDealsPage = async (
    cur?: string | null,
    size: number = pageSize,
  ) => {
    setLoadingTable(true);
    try {
      const response = await getDeals(
        size,
        cur ?? undefined,
        oppFilter,
        phaseFilter || undefined,
        stageFilter || undefined,
        closeDate || undefined,
        undefined,
        pipelineFilter || undefined,
      );
      if (response.data?.data) {
        const data = response.data.data;
        setDeals(data.deals ?? []);
        setCardsDeals({
          pipeline: data.pipeline ?? [],
          summary: data.summary ?? {
            total_deals: 0,
            total_pipeline_value: 0,
            deals_by_phase: {},
            health_distribution: {},
          },
          recent_activity: [],
        });
        setTotalDeals(data.total_deals || 0);
        setTotalPipelineValue(data.total_pipeline_value || 0);
        setActiveDeals(data.total_active_deals || 0);
        setHealthDistribution(data.health_distribution || {});
        setTotalPages(data.totalPages || 1);
        setNextCursor(data.nextCursor || null);

        if (Array.isArray(data.available_phases)) {
          setAvailablePhases(data.available_phases);
        }
        if (Array.isArray(data.available_stages)) {
          setAvailableStages(data.available_stages);
        }
        if (Array.isArray(data.pipeline_names)) {
          setPipelineNames(data.pipeline_names);
        }
      } else {
        toast.error("Failed to fetch opportunities");
        setDeals([]);
      }
    } catch (err) {
      console.error(err);
      setDeals([]);
    } finally {
      setLoadingTable(false);
      setIsInitialLoad(false);
      setIsFilterLoading(false); // always clear after fetch
    }
  };

  // ── Whether to show the loader inside summary cards ───────────────────────
  // True on: first load OR filter change. False on: pagination.
  const showCardLoader = (isInitialLoad && loadingTable) || isFilterLoading;

  const handleDealClick = (deal: Deal) => {
    const dealId = deal.deal_id || deal.id;
    navigate(`/revops/dealdetail/${dealId}`);
  };

  const stageViews = useMemo<StageView[]>(() => {
    if (!cardsDeals?.pipeline) return [];

    // ✅ Group deals by PHASE (not stage) — one card per phase
    const dealsByPhase = new Map<string, Deal[]>();
    deals.forEach((d) => {
      const phase = d.phase ?? "";
      if (!phase) return;
      if (!dealsByPhase.has(phase)) dealsByPhase.set(phase, []);
      dealsByPhase.get(phase)!.push(d);
    });

    return cardsDeals.pipeline.map((pipelinePhase) => {
      const pageDeals = dealsByPhase.get(pipelinePhase.phase) ?? [];

      return {
        stage: pipelinePhase.phase, // internal key
        phase: pipelinePhase.phase,
        deals: pageDeals,
        deal_count:
          pipelinePhase.deal_count || pipelinePhase.deals?.length || 0,
        total_value:
          (pipelinePhase.total_value ||
            pipelinePhase.deals?.reduce(
              (sum, d) => sum + (Number(d.amount) || 0),
              0,
            )) ??
          0,
      };
    });
  }, [cardsDeals, deals]);
  const buildFlowData = (data: DashboardData, currentPageDeals: Deal[]) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    let xPos = 0;
    const spacing = 300;

    if (!data?.pipeline) return;

    // Group deals by phase
    const dealsByPhase = new Map<string, Deal[]>();

    currentPageDeals.forEach((d) => {
      const phase = d.phase ?? "";
      if (!phase) return;

      if (!dealsByPhase.has(phase)) dealsByPhase.set(phase, []);
      dealsByPhase.get(phase)!.push(d);
    });

    data.pipeline.forEach((pipelinePhase, index) => {
      const pageDealsForPhase = dealsByPhase.get(pipelinePhase.phase) ?? [];

      const pageValueForPhase = pageDealsForPhase.reduce(
        (sum, d) => sum + (Number(d.amount) || 0),
        0,
      );

      const totalDealsInPhase = pipelinePhase.deals?.length ?? 0;

      const nodeId = `phase-${pipelinePhase.phase}`;

      // PHASE NODE
      newNodes.push({
        id: nodeId,
        position: { x: xPos, y: 80 },
        data: {
          label: (
            <div className="p-4 text-center">
              <div className="mb-2 text-sm font-bold">
                {pipelinePhase.phase.replace(/_/g, " ")}
              </div>
              <div className="text-3xl font-bold">
                {pageDealsForPhase.length}
              </div>
              <div className="text-sm text-muted-foreground">
                ${pageValueForPhase.toLocaleString()}
              </div>
              <div className="text-xs italic text-muted-foreground">
                of {totalDealsInPhase} total
              </div>
            </div>
          ),
        },
        style: {
          background: PHASE_NODE_COLORS[pipelinePhase.phase] || "#f5f5f5",
          border: "3px solid #2c3e50",
          borderRadius: "16px",
          width: 220,
          strokeWidth: 4, // 👈 make line bold
        },
      });

      // DEAL NODES
      pageDealsForPhase.forEach((deal, dealIndex) => {
        const dealNodeId = `deal-${deal.deal_id || deal.id}-${pipelinePhase.phase}`;

        newNodes.push({
          id: dealNodeId,
          position: { x: xPos, y: 250 + dealIndex * 90 },
          data: {
            label: (
              <div
                className="p-2 cursor-pointer hover:underline"
                onClick={() => handleDealClick(deal)}
              >
                <div className="font-semibold">{deal.name}</div>
                <div className="text-xs text-muted-foreground">
                  {deal.company}
                </div>
                <div className="text-sm font-bold">
                  ${(Number(deal.amount) || 0).toLocaleString()}
                </div>
              </div>
            ),
          },
          style: {
            background: "white",
            border: `3px solid ${
              HEALTH_HEX_COLORS[deal.health_status] || "#ccc"
            }`,
            borderRadius: "10px",
            width: 200,
          },
        });

        newEdges.push({
          id: `${dealNodeId}-to-${nodeId}`,
          source: dealNodeId,
          target: nodeId,
        });
      });

      // Connect phases horizontally
      if (index > 0) {
        newEdges.push({
          id: `phase-${index}`,
          source: `phase-${data.pipeline[index - 1].phase}`,
          target: nodeId,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#2c3e50", strokeWidth: 3 },
        });
      }

      xPos += spacing;
    });

    setNodes(newNodes);
    setEdges(newEdges);
  };

  const columnDefs: any = useMemo(
    () => [
      {
        field: "name",
        headerName: "Opportunity Name",
        flex: 2,
        filter: true,
        sortable: true,
        cellRenderer: (params: any) => (
          <button
            className="text-left hover:underline font-medium hover:text-blue-600"
            onClick={() => handleDealClick(params.data)}
          >
            {params.value}
          </button>
        ),
      },
      {
        field: "stage_name",
        headerName: "Stage",
        flex: 1.5,
        filter: true,
      },
      {
        field: "ownerEmail",
        headerName: "Enterprise Owner",
        flex: 1.5,
        filter: true,
      },
      {
        field: "companyOwnerEmail",
        headerName: "Customer Owner",
        flex: 1.5,
        filter: true,
      },
      { field: "companyName", headerName: "Company", flex: 1, filter: true },
      {
        field: "phase",
        headerName: "Aerostack LifeCycle",
        flex: 1,
        cellStyle: (params: { value: Phase }) => ({
          backgroundColor: PHASE_NODE_COLORS[params.value] || "#fff",
        }),
      },
      {
        field: "amount",
        headerName: "Amount",
        flex: 1,
        valueFormatter: (params: { value: number }) =>
          params.value ? `$${params.value.toLocaleString()}` : "-",
      },
      {
        field: "health_status",
        headerName: "Health",
        flex: 1,
        cellRenderer: (params: { value: HealthStatus }) => (
          <span className={cn("font-bold", HEALTH_COLORS[params.value])}>
            ● {params.value}
          </span>
        ),
      },
      {
        field: "closedate",
        headerName: "Target Close Date",
        flex: 1.5,
        filter: true,
        valueFormatter: ({ value }: { value: string }) =>
          value ? value.split("T")[0].split("-").reverse().join("/") : "",
      },
      {
        field: "contacts",
        headerName: "Contacts",
        flex: 2,
        filter: true,
        valueFormatter: (params: { value: ContactInfo[] }) =>
          params.value
            ?.map((c) => c.fullName)
            .filter(Boolean)
            .join(", ") || "-",
      },
    ],
    [],
  );

  const allDeals = deals;

  const PaginationControls = () => (
    <div className="border-t bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {deals.length} of {totalDeals} opportunities
        </div>
        <div className="flex items-center gap-4">
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className="rounded border px-2 py-1 text-sm cursor-pointer"
          >
            {[20, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            Page {cursorStack.length + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              disabled={!cursorStack.length}
              onClick={handlePreviousPage}
              className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              ◀
            </button>
            <button
              disabled={!nextCursor}
              onClick={handleNextPage}
              className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const NoDealsFound = () => (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <h2 className="flex h-full items-center justify-center">
        No opportunities Found
      </h2>
    </div>
  );

  return (
    <>
      <div className="flex h-screen flex-col p-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              RevOps Pipeline
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor and analyze your sales pipeline in real-time
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === "flow" ? "default" : "outline"}
              onClick={() => setViewMode("flow")}
              className="gap-2"
            >
              <BarChart3 className="h-4 w-4" /> Flow
            </Button>
            <Button
              variant={viewMode === "table" ? "default" : "outline"}
              onClick={() => setViewMode("table")}
              className="gap-2"
            >
              <Table className="h-4 w-4" /> Table
            </Button>
            <Button
              variant={viewMode === "cards" ? "default" : "outline"}
              onClick={() => setViewMode("cards")}
              className="gap-2"
            >
              <LayoutGrid className="h-4 w-4" /> Cards
            </Button>
          </div>
        </div>

        {/* ── Summary Cards — loader only on filter/first load, not pagination ── */}
        <div className="mb-4 grid grid-cols-4 gap-4">
          <Card className="transition-all hover:shadow-md shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total opportunities
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showCardLoader ? (
                <Loader />
              ) : (
                <>
                  <div className="text-3xl font-bold">{totalDeals}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Active in pipeline
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-md shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pipeline Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showCardLoader ? (
                <Loader />
              ) : (
                <>
                  <div className="text-3xl font-bold">
                    ${totalPipelineValue.toLocaleString() || 0}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Total opportunity value
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-md shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Health Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showCardLoader ? (
                <Loader />
              ) : (
                <>
                  <div className="flex gap-3 text-sm font-semibold">
                    <span className={HEALTH_COLORS.GREEN}>
                      ● {health_distribution?.GREEN || 0}
                    </span>
                    <span className={HEALTH_COLORS.YELLOW}>
                      ● {health_distribution?.YELLOW || 0}
                    </span>
                    <span className={HEALTH_COLORS.ORANGE}>
                      ● {health_distribution?.ORANGE || 0}
                    </span>
                    <span className={HEALTH_COLORS.RED}>
                      ● {health_distribution?.RED || 0}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Distribution across pipeline
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-md shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active opportunities
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showCardLoader ? (
                <Loader />
              ) : (
                <>
                  <div className="text-3xl font-bold">{activeDeals}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    In development & funding
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Filter Bar */}
        <div className="mb-4 rounded-lg border bg-card p-3">
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
          </div>

          {showFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
              <Select
                value={oppFilter}
                onValueChange={(v) => handleOppFilter(v as "enterprise" | "all")}
              >
                <SelectTrigger className="h-8 w-36 shadow-none">
                  <SelectValue placeholder="Opportunity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enterprise">Enterprise Opp</SelectItem>
                  <SelectItem value="all">All Opp</SelectItem>
                </SelectContent>
              </Select>

              {pipelineNames.length > 0 && (
                <div className="flex items-center gap-2">
                  <Select
                    value={pipelineFilter || "_none"}
                    onValueChange={(v) =>
                      handlePipelineFilter(v === "_none" ? "" : v)
                    }
                  >
                    <SelectTrigger className="h-8 w-44 shadow-none">
                      <SelectValue placeholder="All Pipelines" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">All Pipelines</SelectItem>
                      {pipelineNames.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pipelineFilter && (
                    <button
                      onClick={() => handlePipelineFilter("")}
                      className="text-sm text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Select
                  value={phaseFilter || "_none"}
                  onValueChange={(v) =>
                    handlePhaseFilter(v === "_none" ? "" : v)
                  }
                >
                  <SelectTrigger className="h-8 w-52 shadow-none">
                    <SelectValue placeholder="All Stages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">All Aerostack LifeCycles</SelectItem>
                    {availablePhases.map(({ phase, count }) => (
                      <SelectItem key={phase} value={phase}>
                        {phase}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {/* ({count}) */}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {phaseFilter && (
                  <button
                    onClick={() => handlePhaseFilter("")}
                    className="text-sm text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                )}
              </div>
              {/* Stage Filter */}
              <div className="flex items-center gap-2">
                <Select
                  value={stageFilter || "_none"}
                  onValueChange={(v) =>
                    handleStageFilter(v === "_none" ? "" : v)
                  }
                >
                  <SelectTrigger className="h-8 w-52 shadow-none">
                    <SelectValue placeholder="All Stages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">All Stages</SelectItem>
                    {availableStages.map(({ stage, count }) => (
                      <SelectItem key={stage} value={stage}>
                        {stage}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {/* ({count}) */}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {stageFilter && (
                  <button
                    onClick={() => handleStageFilter("")}
                    className="text-sm text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-8 w-44 justify-start text-left font-normal shadow-none"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {closeDate
                        ? format(new Date(closeDate), "dd/MM/yyyy")
                        : "Target Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={closeDate ? new Date(closeDate) : undefined}
                      onSelect={(date) =>
                        handleCloseDate(date ? format(date, "yyyy-MM-dd") : "")
                      }
                    />
                  </PopoverContent>
                </Popover>
                {closeDate && (
                  <button
                    onClick={() => handleCloseDate("")}
                    className="text-sm text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                )}
              </div>

              {(phaseFilter ||
                closeDate ||
                pipelineFilter ||
                oppFilter !== "enterprise") && (
                <button
                  onClick={() => {
                    setIsFilterLoading(true);
                    setOppFilter("enterprise");
                    setPipelineFilter("");
                    setPhaseFilter("");
                    setCloseDate("");
                    setCursor(null);
                    setCursorStack([]);
                  }}
                  className="ml-auto text-xs text-muted-foreground hover:text-destructive underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main Content */}
        <Card className="flex-1 overflow-hidden border-0 shadow-lg">
          <CardContent className="h-full p-0">
            {/* Flow View */}
            {viewMode === "flow" && (
              <div className="relative h-full flex flex-col">
                <div className="flex-1 relative">
                  {loadingTable ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader description="Loading opportunities..." />
                    </div>
                  ) : allDeals.length === 0 ? (
                    <NoDealsFound />
                  ) : (
                    <ReactFlow
                      nodes={nodes}
                      edges={edges}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      defaultViewport={{ x: 100, y: 0, zoom: 0 }}
                      className="h-full w-full"
                    >
                      <Background />
                      <Controls />
                      <MiniMap />
                    </ReactFlow>
                  )}
                  <Button
                    onClick={() => setIsFullscreenFlow(true)}
                    className="absolute right-4 top-4 z-10 gap-2 shadow-lg transition-all hover:scale-105"
                    size="sm"
                  >
                    <Maximize2 className="h-4 w-4" /> Full Screen
                  </Button>
                </div>
                <PaginationControls />
              </div>
            )}

            {/* Table View */}
            {viewMode === "table" && (
              <div className="h-full flex flex-col">
                {!loadingTable && allDeals.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                    <BarChart3 className="mb-5 h-16 w-16" />
                    <h2 className="text-lg font-semibold text-foreground">
                      No Opportunities Found
                    </h2>
                    <p className="text-sm">
                      Try adjusting your filters or sync from HubSpot
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 p-4 overflow-hidden">
                      {loadingTable ? (
                        <div className="flex h-full items-center justify-center">
                          <Loader description="Loading opportunities..." />
                        </div>
                      ) : (
                        <div className="ag-theme-alpine h-full w-full">
                          <AgGridReact
                            theme="legacy"
                            rowData={deals}
                            columnDefs={columnDefs}
                            pagination={false}
                            defaultColDef={{
                              sortable: true,
                              filter: true,
                              resizable: true,
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <PaginationControls />
                  </>
                )}
              </div>
            )}

            {/* Cards View */}
            {viewMode === "cards" && (
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-hidden">
                  {loadingTable ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader description="Loading opportunities..." />
                    </div>
                  ) : stageViews.length === 0 ? (
                    <NoDealsFound />
                  ) : (
                    <ScrollArea className="h-full p-6">
                      <div className="grid grid-cols-3 gap-5">
                        {stageViews.map((sv) => (
                          <Card
                            key={sv.phase}
                            className={cn(
                              "shadow-md transition-all hover:shadow-xl",
                              PHASE_BG_COLORS[sv.phase],
                            )}
                          >
                            <CardHeader className="pb-3">
                              <CardTitle className="text-lg font-bold">
                                {sv.phase}
                              </CardTitle>
                              {/* <p className="text-xs text-muted-foreground uppercase tracking-wide">
                                {sv.phase.replace(/_/g, " ")}
                              </p> */}
                              <p className="text-sm font-semibold text-foreground">
                                {sv.deals.length} on page
                                {sv.deal_count > 0 &&
                                sv.deal_count !== sv.deals.length
                                  ? ` of ${sv.deal_count} total`
                                  : ""}
                                {sv.deals.length > 0 &&
                                  ` • $${sv.deals.reduce((s, d) => s + (Number(d.amount) || 0), 0).toLocaleString()}`}
                              </p>
                            </CardHeader>
                            <CardContent>
                              {sv.deals.length === 0 ? (
                                <div className="flex flex-col items-center rounded-lg bg-card p-6 text-center text-muted-foreground">
                                  <Inbox className="mb-2 h-10 w-10 opacity-40" />
                                  <span className="text-sm font-medium">
                                    No opportunities on this page
                                  </span>
                                  {sv.deal_count > 0 && (
                                    <span className="mt-1 text-xs text-muted-foreground">
                                      {sv.deal_count} opportunity
                                      {sv.deal_count !== 1 ? "s" : ""} exist in
                                      this stage
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="max-h-80 space-y-3 overflow-y-auto">
                                  {sv.deals.map((deal, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => handleDealClick(deal)}
                                      className={cn(
                                        "rounded-lg border-l-4 bg-card p-3 shadow-sm transition-all hover:shadow-md cursor-pointer",
                                        HEALTH_BG_COLORS[deal.health_status] ||
                                          "border-muted",
                                      )}
                                    >
                                      <div className="font-semibold hover:underline hover:text-blue-600">
                                        {deal.name}
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {deal.company}
                                      </div>
                                      <div className="mt-2 flex items-center justify-between">
                                        <span className="text-sm font-bold">
                                          $
                                          {(
                                            Number(deal.amount) || 0
                                          ).toLocaleString()}
                                        </span>
                                        <span
                                          className={cn(
                                            "text-xs font-semibold",
                                            HEALTH_COLORS[deal.health_status],
                                          )}
                                        >
                                          {deal.health_status}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
                <PaginationControls />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fullscreen Flow */}
      {isFullscreenFlow && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="flex items-center justify-between border-b bg-card px-6 py-4 shadow-sm">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-bold">Pipeline Flow View</h2>
                <p className="text-sm text-muted-foreground">
                  {totalDeals} opportunities • $
                  {(totalPipelineValue || 0).toLocaleString()} total value
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => toast.success("View reset")}
              >
                <RefreshCw className="h-4 w-4" /> Reset View
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFullscreenFlow(false)}
                className="h-9 w-9 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="h-[calc(100vh-73px)]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              defaultViewport={{ x: 100, y: 0, zoom: 0 }}
              className="h-full w-full"
            >
              <Background />
              <Controls />
              <MiniMap
                className="bg-card! border! border-border!"
                nodeColor={(node) => {
                  const deal = allDeals.find(
                    (d) =>
                      `deal-${d.deal_id || d.id}` ===
                      node.id.split("-").slice(0, -1).join("-"),
                  );
                  return deal
                    ? HEALTH_HEX_COLORS[deal.health_status]
                    : "#e0e0e0";
                }}
              />
            </ReactFlow>
          </div>
        </div>
      )}
    </>
  );
}
