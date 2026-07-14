import "@/lib/ag-grid-config";
import React, { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Loader from "@/components/Loader";
import { aerostackApiClient } from "@/api/client";
import toast from "react-hot-toast";
import { useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import { Download, UserPlus, ArrowLeft } from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { BulkAssignModal } from "@/components/aerostack/BulkAssignModal";

interface LearningLoop {
  loop_data: {
    loop_id: string;
    title: string;
    owner_email: string;
    category: string;
    status: string;
    pillar: string;
    target_completion_date?: string;
    outcome_score?: number;
    lesson?: {
      what_went_well: string;
      what_could_improve: string;
      tags: string[];
    };
    tags?: string[];
    progress_history?: { comment?: string }[];
    phase?: string;
    priority?: string | number;
  };
  deel_person?: {
    given_name?: string;
    family_name?: string;
    name?: string;
  } | null;
}

export default function LearningOps() {
  const navigate = useNavigate();

  const [rows, setRows] = React.useState<LearningLoop[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [pageSize, setPageSize] = React.useState(20);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);

  const [category, setCategory] = React.useState<"ALL" | "OAL" | "PRO-DEV" | "ONBOARDING" | "COMMS_FLUENCY">(
    "ALL",
  );

  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const [bulkAssignOpen, setBulkAssignOpen] = React.useState(false);

  const gridRef = React.useRef<AgGridReact>(null);

  const exportToCsv = React.useCallback(() => {
    if (gridRef.current) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `learning_ops_export_${new Date().toISOString().split("T")[0]}.csv`,
      });
    }
  }, []);

  const fetchLearning = async (cursorVal?: string | null, size = pageSize) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { limit: size };
      if (cursorVal) params.nextCursor = cursorVal;
      if (category !== "ALL") params.category = category;

      const res = await aerostackApiClient.get("/loops/learning-with-people", {
        params,
      });

      const data = res.data?.data;
      setRows(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setNextCursor(data.nextCursor || null);
      setCurrentPage(cursorStack.length + 1);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load learning assignments");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchLearning(cursor);
  }, [cursor, pageSize, category]);

  const columnDefs: any = useMemo(
    () => [
      {
        field: "loop_data.title",
        headerName: "Title",
        flex: 2,
        cellRenderer: (params: any) => (
          <Button
            variant="link"
            className="text-yellow-600 font-bold p-0 h-auto text-left justify-start truncate"
            onClick={() => {
              if (!params.data) return;
              navigate(
                ROUTES.APP.LOOP.path.replace(
                  ":loopId",
                  params.data.loop_data.loop_id,
                ),
                {
                  state: {
                    loopId: params.data.loop_data.loop_id,
                    from: ROUTES.APP.LEARNING_OPS.id,
                  },
                },
              );
            }}
          >
            {params.value || "-"}
          </Button>
        ),
      },
      {
        field: "loop_data.owner_email",
        headerName: "Owner",
        flex: 1.5,
      },
      {
        field: "loop_data.category",
        headerName: "Category",
        flex: 1,
        valueFormatter: (params: any) => {
          const map: Record<string, string> = {
            OAL: "OAL",
            "PRO-DEV": "PRO-DEV",
            ONBOARDING: "ONBOARDING",
            COMMS_FLUENCY: "FLUENCY",
          };
          return map[params.value] || params.value || "—";
        },
      },
      {
        field: "loop_data.status",
        headerName: "Status",
        flex: 1,
      },
      {
        headerName: "Latest Comment",
        flex: 1.5,
        cellRenderer: (params: { data: LearningLoop }) => {
          const history = params.data.loop_data?.progress_history;
          if (!history || history.length === 0)
            return <span className="text-muted-foreground text-xs">—</span>;
          const last = history[history.length - 1];
          return (
            <span
              className="text-xs text-muted-foreground truncate block max-w-[200px]"
              title={last.comment ?? ""}
            >
              {last.comment || "—"}
            </span>
          );
        },
      },
      {
        field: "loop_data.target_completion_date",
        headerName: "Due",
        flex: 1,
      },
    ],
    [navigate],
  );

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(ROUTES.APP.LEARNING.path)}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Learning Dashboard
        </Button>
      </div>

      <h1 className="text-3xl font-bold">Learning Ops</h1>
      <p className="text-muted-foreground">
        Current status of all active learning assignments across the organization.
      </p>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Active Assignments</CardTitle>

          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between mt-2">
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  { key: "ALL", label: "All" },
                  { key: "OAL", label: "OAL & Certifications" },
                  { key: "COMMS_FLUENCY", label: "Comms & Fluency" },
                  { key: "PRO-DEV", label: "Professional Development" },
                  { key: "ONBOARDING", label: "Onboarding & Requirements" },
                ] as const
              ).map((c) => (
                <Button
                  key={c.key}
                  size="sm"
                  variant={category === c.key ? "default" : "outline"}
                  onClick={() => {
                    setCategory(c.key);
                    setCursor(null);
                    setCursorStack([]);
                  }}
                >
                  {c.label}
                </Button>
              ))}
            </div>

            {isAdminOrAbove && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setBulkAssignOpen(true)}
                  className="gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  Bulk Assign
                </Button>
                <Button size="sm" variant="outline" onClick={exportToCsv} className="gap-2">
                  <Download className="h-4 w-4" />
                  Export to CSV
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader description="Loading learning assignments..." />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm mt-4">No learning assignments found</p>
            </div>
          ) : (
            <>
              <div className="h-[500px] w-full">
                <div className="ag-theme-alpine h-full w-full">
                  <AgGridReact
                    ref={gridRef}
                    theme="legacy"
                    rowData={rows}
                    columnDefs={columnDefs}
                    getRowId={(params) => params.data.loop_data.loop_id}
                    onGridReady={(params) => params.api.sizeColumnsToFit()}
                    headerHeight={32}
                    rowHeight={36}
                    pagination={false}
                    defaultColDef={{
                      sortable: true,
                      filter: false,
                      resizable: true,
                    }}
                  />
                </div>
              </div>

              <div className="border-t bg-card px-4 py-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {rows.length} of {total}
                  </div>

                  <div className="flex items-center gap-4">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCursor(null);
                        setCursorStack([]);
                      }}
                      className="rounded border px-2 py-1 text-sm"
                    >
                      {[20, 50, 100].map((s) => (
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
                        disabled={!cursorStack.length}
                        onClick={() => {
                          setCursorStack((prev) => {
                            const stack = [...prev];
                            const prevCursor = stack.pop() || null;
                            setCursor(prevCursor);
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
                          setCursorStack((prev) => [...prev, cursor ?? ""]);
                          setCursor(nextCursor);
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

      {isAdminOrAbove && (
        <BulkAssignModal
          open={bulkAssignOpen}
          onClose={() => setBulkAssignOpen(false)}
          onSuccess={() => fetchLearning(cursor)}
        />
      )}
    </div>
  );
}
