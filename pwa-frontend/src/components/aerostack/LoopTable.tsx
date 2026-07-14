import "@/lib/ag-grid-config";
import type { AerostackLoops } from "@enterprise/common";
import type React from "react";
import { useMemo } from "react";
import { useWriteAccess } from "@/hooks/useWriteAccess";
type Loop = AerostackLoops.Loop;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  totalPages: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string | null;
  count: number;
}

interface Props {
  loops: PaginatedResult<Loop>;
  onScore?: (loop: Loop) => void;
  onEffort?: (loop: Loop) => void;
  onAdapt?: (loop: Loop) => void;
  currentPage: number;
  pageSize: number;
  onPageChange: (cursor?: string | null) => void;
  onPageSizeChange: (size: number) => void;
  isLoading: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  fromId?: string;
}

import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

export const LoopTable: React.FC<Props> = ({
  loops,
  onScore,
  onEffort,
  onAdapt,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSize,
  isLoading,
  hasPrev,
  fromId,
  // hasNext,
}) => {
  const navigate = useNavigate();
  const { canWrite } = useWriteAccess();

  const colDefs: ColDef<Loop>[] = useMemo(() => {
    return [
      {
        field: "title",
        headerName: "Title",
        flex: 2,
        cellRenderer: (params: ICellRendererParams<Loop>) => (
          <Button
            variant="link"
            className="text-yellow-600 font-bold"
            // onClick={() => {
            //   if (!params.data) return;
            //   navigate(ROUTES.APP.LOOP.path, {
            //     state: { loopId: params.data.loop_id },
            //   });
            // }}
            onClick={() => {
              if (!params.data) return;
              navigate(
                ROUTES.APP.LOOP.path.replace(":loopId", params.data.loop_id),
                {
                  state: {
                    loopId: params.data.loop_id,
                    from: fromId,
                  },
                },
              );
            }}
          >
            {params.value || "-"}
          </Button>
        ),
      },
      { field: "owner_email", headerName: "Owner", flex: 1 },
      {
        field: "category",
        headerName: "Category",
        flex: 1,
        valueFormatter: (params: any) => {
          const map: Record<string, string> = {
            OAL: "OAL",
            "PRO-DEV": "PRO-DEV",
            ONBOARDING: "ONBOARDING",
            COMMS_FLUENCY: "FLUENCY",
          };
          return map[params.value] || params.value;
        },
      },
      { field: "phase", headerName: "Phase", flex: 1 },
      { field: "pillar", headerName: "Pillar", flex: 1 },
      { field: "status", headerName: "Status", flex: 1 },
      {
        headerName: "Latest Comment",
        flex: 1.5,
        cellRenderer: (params: { data: Loop }) => {
          const history = params.data.progress_history;
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
      { field: "priority", headerName: "Priority", flex: 0.7 },
      {
        field: "target_completion_date",
        headerName: "Due",
        flex: 1,
      },
      ...((onScore || onEffort || onAdapt) && canWrite
        ? [
          {
            headerName: "Actions",
            pinned: "right",
            flex: 1.2,
            cellRenderer: (params: ICellRendererParams<Loop>) => (
              <div className="flex justify-end gap-2">
                {onEffort && (
                  <Button
                    className="px-2 py-1 text-xs border rounded"
                    onClick={() => params.data && onEffort(params.data)}
                  >
                    Effort
                  </Button>
                )}
                {onScore && (
                  <Button
                    className="px-2 py-1 text-xs border rounded"
                    onClick={() => params.data && onScore(params.data)}
                  >
                    Score
                  </Button>
                )}
                {onAdapt && (
                  <Button
                    className="px-2 py-1 text-xs border rounded"
                    onClick={() => params.data && onAdapt(params.data)}
                  >
                    Adapt
                  </Button>
                )}
              </div>
            ),
          } as ColDef<Loop>,
        ]
        : []),
    ];
  }, [onScore, onEffort, onAdapt, navigate, canWrite]);
  const loopItems = loops?.items ?? [];
  const totalCount = loops?.total ?? 0;
  const nextCursor = loops?.nextCursor ?? null;
  const totalPages = loops?.totalPages ?? 1;
  const hasNext = loops?.hasMore && !!loops?.nextCursor;
  const PAGE_SIZES = [20, 50, 100];
  if (!PAGE_SIZES.includes(pageSize)) PAGE_SIZES.push(pageSize);

  return (
    <div className="ag-theme-alpine w-full">
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader description="Loading loops..." />
        </div>
      ) : loopItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          {/* <NoData className="h-32" /> */}
          <p className="text-sm mt-4">No loops found</p>
        </div>
      ) : (
        <>
          <div
            className="ag-theme-alpine"
            style={{ width: "100%", height: 400 }}
          >
            <AgGridReact<Loop>
              theme="legacy"
              rowData={loopItems}
              columnDefs={colDefs}
              getRowId={(params) => params.data.loop_id}
              onGridReady={(params) => params.api.sizeColumnsToFit()}
              headerHeight={32}
              rowHeight={36}
              domLayout="normal"
              defaultColDef={{
                resizable: true,
                sortable: true,
                filter: false,
              }}
            />
          </div>

          {/* Custom Pagination Footer */}
          <div className="border-t bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {loopItems.length} of {totalCount} Loops
              </div>

              <div className="flex items-center gap-4">
                {/* Page size */}

                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="rounded border px-2 py-1 text-sm cursor-pointer"
                >
                  {PAGE_SIZES.sort((a, b) => a - b).map((s) => (
                    <option key={s} value={s}>
                      {s} / page
                    </option>
                  ))}
                </select>

                <div className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </div>

                {/* Prev / Next */}
                <div className="flex gap-2">
                  <button
                    disabled={!hasPrev}
                    onClick={() => onPageChange(undefined)}
                    className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    title="Previous"
                  >
                    ◀
                  </button>

                  <button
                    disabled={!hasNext || !nextCursor}
                    onClick={() => {
                      if (nextCursor) onPageChange(nextCursor);
                    }}
                    className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    title="Next"
                  >
                    ▶
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROUTES } from "@/lib/routes-config";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import Loader from "../Loader";
import NoData from "../NoData";

interface LoopDetailsDialogProps {
  loop: Loop | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const LoopDetailsDialog: React.FC<LoopDetailsDialogProps> = ({
  loop,
  open,
  onOpenChange,
}) => {
  if (!loop) return null;

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl! max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold text-yellow-600 pr-8">
            {loop.title}
          </DialogTitle>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className="text-xs">{loop.status}</Badge>
            <Badge variant="secondary" className="text-xs">
              {loop.phase}
            </Badge>
            <Badge
              variant="secondary"
              className="flex items-center gap-1 text-xs"
            >
              <span>Priority</span>
              <span className="w-5 h-5 rounded-full bg-yellow-600 text-white flex items-center justify-center text-[11px] font-semibold">
                {loop.priority}
              </span>
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Description */}
          {loop.description && (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Description</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {loop.description}
              </p>
            </section>
          )}

          {/* Scores */}
          <section className="space-y-1">
            <h3 className="text-sm font-medium">Scores</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Effort</p>
                <p className="text-lg font-semibold">
                  {loop.effort_score ?? "-"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Outcome</p>
                <p className="text-lg font-semibold">
                  {loop.outcome_score ?? "-"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Loop</p>
                <p className="text-lg font-semibold">
                  {loop.loop_score ?? "-"}
                </p>
              </div>
            </div>
          </section>

          <Separator />

          {/* Meta (Owner + Properties) */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Details</h3>

            {/* Owner */}
            <div className="flex flex-col gap-4">
              <div className="space-y-1 flex justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  Owner
                </p>
                {loop.owner_name && (
                  <p className="text-sm">{loop.owner_name}</p>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {loop.owner_email}
                </p>
              </div>

              <div className="flex justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Type</p>
                  <Badge variant="outline" className="text-xs">
                    {loop.loop_type}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Category</p>
                  <Badge variant="outline" className="text-xs">
                    {loop.category}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pillar</p>
                  <Badge variant="outline" className="text-xs">
                    {loop.pillar}
                  </Badge>
                </div>
                {/* {loop.jira_key && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Jira Key
                    </p>
                    <Badge variant="secondary" className="text-xs">
                      {loop.jira_key}
                    </Badge>
                  </div>
                )} */}
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Timeline</h3>
            <div className="flex justify-between  text-sm">
              {loop.start_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Start</p>
                  <p>{formatDate(loop.start_date)}</p>
                </div>
              )}
              {loop.target_completion_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Target</p>
                  <p>{formatDate(loop.target_completion_date)}</p>
                </div>
              )}
              {loop.actual_completion_date && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Actual</p>
                  <p>{formatDate(loop.actual_completion_date)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Created</p>
                <p>{formatDate(loop.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Last Updated
                </p>
                <p>{formatDate(loop.updated_at)}</p>
              </div>
              {loop.updated_by && (
                <div className="max-w-[120px]">
                  <p className="text-xs text-muted-foreground mb-1">
                    Updated By
                  </p>
                  <p className="text-[11px] truncate" title={loop.updated_by}>
                    {loop.updated_by}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Tags */}
          {loop.tags && loop.tags.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {loop.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
