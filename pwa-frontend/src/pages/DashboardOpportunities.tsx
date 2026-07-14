import "@/lib/ag-grid-config";
import React, { useMemo, useRef, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Loader from "@/components/Loader";
import toast from "react-hot-toast";
import { useNavigate } from "react-router";
import { getDeals } from "@/api/hubspot";
import { cn } from "@/lib/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import { ROUTES } from "@/lib/routes-config";


type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";
type Phase =
  | "LEAD"
  | "DEVELOPING"
  | "ACTIVELY_FUNDING"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "LAUNCHED"
  | "PROPOSED";

interface Deal {
  deal_id?: string;
  id?: string;
  name: string;
  company: string;
  companyName?: string;
  amount: number;
  health_status: HealthStatus;
  phase?: Phase;
  stage_name?: string;
  closedate?: string;
  ownerEmail?: string;
  companyOwnerEmail?: string;
  contacts?: { fullName: string }[];
}

interface CachedData {
  deals: Deal[];
  total: number;
  totalPages: number;
  nextCursor: string | null;
}

const HEALTH_COLORS: Record<HealthStatus, string> = {
  GREEN: "text-emerald-500",
  YELLOW: "text-yellow-400",
  ORANGE: "text-orange-500",
  RED: "text-red-500",
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

export default function DashboardOpportunities() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = React.useState<string | null>(null);
  const [sessionReady, setSessionReady] = React.useState(false);

  // Cache keyed by "filter_cursor_pageSize"
  const cacheRef = useRef<Record<string, CachedData>>({});

  // ✅ Tracks the ACTIVE filter at all times — updated synchronously before any fetch
  // This is the source of truth, not React state (which batches and lags)
  const activeFilterRef = useRef<"my" | "all">("my");

  // ✅ AbortController — aborts the actual HTTP request, not just the response handling
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const [deals, setDeals] = React.useState<Deal[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(20);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);

  const [oppFilter, setOppFilter] = React.useState<"my" | "all">("my");
  const [stageFilter, setStageFilter] = React.useState("");
  const [allStageOptions, setAllStageOptions] = React.useState<string[]>([]);

  // ✅ fetchDeals always takes explicit args — never reads from stale closure state
  const fetchDeals = useCallback(
    async (
      currentOppFilter: "my" | "all",
      cur: string | null,
      size: number,
      currentUserEmail: string | null,
    ) => {
      const cacheKey = `${currentOppFilter}_${cur ?? "start"}_${size}`;

      // ✅ CACHE HIT — show instantly, no network call
      if (cacheRef.current[cacheKey]) {
        const cached = cacheRef.current[cacheKey];
        setDeals(cached.deals);
        setTotal(cached.total);
        setTotalPages(cached.totalPages);
        setNextCursor(cached.nextCursor);
        setLoading(false);
        return;
      }

      // ✅ ABORT previous HTTP request — this kills the actual network call
      // so its response can NEVER overwrite state
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);

      // Only clear deals if this filter has never been loaded before
      const filterHasCache = Object.keys(cacheRef.current).some((k) =>
        k.startsWith(`${currentOppFilter}_`),
      );
      if (!filterHasCache) {
        setDeals([]);
      }

      try {
        const response = await getDeals(
          size,
          cur ?? undefined,
          currentOppFilter,
          stageFilter || undefined,
          undefined,
          undefined,
          currentOppFilter === "my"
            ? (currentUserEmail ?? undefined)
            : undefined,
        );

        // ✅ GUARD: after await, check if this filter is still the active one
        // If user switched tabs while this was in flight, discard result
        if (
          controller.signal.aborted ||
          activeFilterRef.current !== currentOppFilter
        ) {
          return;
        }

        if (response.data?.data) {
          const data = response.data.data;

          const result: CachedData = {
            deals: data.deals || [],
            total: data.total_deals || 0,
            totalPages: data.totalPages || 1,
            nextCursor: data.nextCursor || null,
          };

          cacheRef.current[cacheKey] = result;

          // ✅ Final check before touching state
          if (activeFilterRef.current !== currentOppFilter) return;

          setDeals(result.deals);
          setTotal(result.total);
          setTotalPages(result.totalPages);
          setNextCursor(result.nextCursor);

          const incoming = new Set<string>();
          data.pipeline?.forEach((p: any) =>
            p.deals?.forEach((d: any) => {
              if (d.stage_name) incoming.add(d.stage_name);
            }),
          );
          data.deals?.forEach((d: any) => {
            if (d.stage_name) incoming.add(d.stage_name);
          });
          if (incoming.size > 0) {
            setAllStageOptions((prev) => {
              const merged = new Set([...prev, ...Array.from(incoming)]);
              return Array.from(merged).sort();
            });
          }
        } else {
          toast.error("Failed to fetch opportunities");
          setDeals([]);
        }
      } catch (e: any) {
        if (e?.name === "AbortError" || e?.code === "ERR_CANCELED") return;
        console.error(e);
        toast.error("Failed to load opportunities");
        setDeals([]);
      } finally {
        if (
          !controller.signal.aborted &&
          activeFilterRef.current === currentOppFilter
        ) {
          setLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageFilter],
  );

  React.useEffect(() => {
    if (!sessionReady) return;
    // ✅ Pass everything explicitly — no stale closure risk
    fetchDeals(oppFilter, cursor, pageSize, userEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, pageSize, oppFilter, stageFilter, sessionReady]);

  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleOppFilter = (val: "my" | "all") => {
    if (val === oppFilter) return;
    // ✅ Update the ref FIRST — synchronously, before React batches the state update
    // So any in-flight request will immediately see the new active filter
    activeFilterRef.current = val;
    // Abort immediately too
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setOppFilter(val);
    setCursor(null);
    setCursorStack([]);
  };

  const handleStageFilter = (val: string) => {
    cacheRef.current = {};
    setStageFilter(val);
    setCursor(null);
    setCursorStack([]);
  };

  const columnDefs: any = useMemo(
    () => [
      {
        field: "name",
        headerName: "Opportunity Name",
        flex: 2,
        filter: true,
        cellRenderer: (params: any) => (
          <button
            className="text-left font-medium hover:underline hover:text-blue-600"
            onClick={() =>
              navigate(
                `/revops/dealdetail/${params.data.deal_id || params.data.id}`,
                { state: { from: ROUTES.APP.OPPORTUNITIES.id } },
              )
            }
          >
            {params.value || "-"}
          </button>
        ),
      },
      {
        field: "stage_name",
        headerName: "Aerostack LifeCycle",
        flex: 1.2,
        filter: true,
      },
      {
        field: "ownerEmail",
        headerName: "Enterprise Owner",
        flex: 1.5,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "companyOwnerEmail",
        headerName: "Customer Owner",
        flex: 1.5,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "companyName",
        headerName: "Company",
        flex: 1,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "phase",
        headerName: "Phase",
        flex: 1,
        cellStyle: (params: { value: Phase }) => ({
          backgroundColor: PHASE_NODE_COLORS[params.value] || "#fff",
        }),
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "amount",
        headerName: "Amount",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value ? `$${Number(p.value).toLocaleString()}` : "-",
      },
      {
        field: "health_status",
        headerName: "Health",
        flex: 1,
        cellRenderer: (params: { value: HealthStatus }) => (
          <span className={cn("font-bold", HEALTH_COLORS[params.value] || "")}>
            ● {params.value || "-"}
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
        valueFormatter: (params: { value: { fullName: string }[] }) =>
          params.value
            ?.map((c) => c.fullName)
            .filter(Boolean)
            .join(", ") || "-",
      },
    ],
    [navigate],
  );

  const currentPage = cursorStack.length + 1;

  return (
    <div className="p-6 md:p-10 space-y-6">
      <h1 className="text-3xl font-bold">Prioritized Opportunities</h1>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Opportunities</CardTitle>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex rounded-md border overflow-hidden">
              <button
                onClick={() => handleOppFilter("my")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors",
                  oppFilter === "my"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted",
                )}
              >
                My Opp
              </button>
              <button
                onClick={() => handleOppFilter("all")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors border-l",
                  oppFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted",
                )}
              >
                All Opp
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader description="Loading opportunities..." />
            </div>
          ) : deals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm">No opportunities found</p>
            </div>
          ) : (
            <>
              <div className="h-[500px] w-full">
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
                    rowHeight={50}
                  />
                </div>
              </div>

              <div className="border-t bg-card px-4 py-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {deals.length} of {total} opportunities
                  </div>
                  <div className="flex items-center gap-4">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        cacheRef.current = {};
                        setPageSize(Number(e.target.value));
                        setCursor(null);
                        setCursorStack([]);
                      }}
                      className="rounded border px-2 py-1 text-sm cursor-pointer"
                    >
                      {[20, 50, 100].map((s) => (
                        <option key={s} value={s}>
                          {s} / page
                        </option>
                      ))}
                    </select>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={!cursorStack.length}
                        onClick={() => {
                          setCursorStack((prev) => {
                            const stack = [...prev];
                            const prevCursor = stack.pop() || null;
                            setCursor(prevCursor);
                            return stack;
                          });
                        }}
                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        ◀
                      </button>
                      <button
                        disabled={!nextCursor}
                        onClick={() => {
                          setCursorStack((prev) => [...prev, cursor ?? ""]);
                          setCursor(nextCursor);
                        }}
                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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
