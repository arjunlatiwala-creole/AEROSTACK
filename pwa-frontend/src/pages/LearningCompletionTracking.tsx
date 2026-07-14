import "@/lib/ag-grid-config";
import React, { useMemo, useCallback, useState, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Loader from "@/components/Loader";
import { aerostackApiClient } from "@/api/client";
import { fetchAuthSession } from "aws-amplify/auth";
import toast from "react-hot-toast";
import { useNavigate, useLocation } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import {
  ArrowLeft,
  Download,
  ListTodo,
  Mail,
  AlertTriangle,
  Send,
} from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";

interface CompletionRecord {
  loop_id: string;
  title: string;
  owner_email: string;
  owner_name?: string;
  status: string;
  target_completion_date?: string;
  actual_completion_date?: string;
  outcome_score?: number;
  created_at: string;
  last_reminder_sent?: string;
}

interface GroupedRequirement {
  title: string;
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  overdue: number;
  records: CompletionRecord[];
}

interface PersonSummary {
  email: string;
  name?: string;
  total: number;
  completed: number;
  in_progress: number;
  not_started: number;
  overdue: number;
  records: CompletionRecord[];
}

type ViewMode = "by-task" | "by-person";

export default function LearningCompletionTracking({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const [loading, setLoading] = React.useState(false);
  const [requirements, setRequirements] = React.useState<GroupedRequirement[]>(
    [],
  );
  const [personSummaries, setPersonSummaries] = React.useState<PersonSummary[]>(
    [],
  );
  const [viewMode, setViewMode] = React.useState<ViewMode>("by-person");
  const [selectedRequirement, setSelectedRequirement] =
    React.useState<GroupedRequirement | null>(null);
  const [selectedPerson, setSelectedPerson] =
    React.useState<PersonSummary | null>(null);
  const [searchFilter, setSearchFilter] = React.useState("");
  const [actorEmail, setActorEmail] = React.useState("");

  const gridRef = React.useRef<AgGridReact>(null);

  // Resolve logged-in user email for reminder attribution
  useEffect(() => {
    const loadEmail = async () => {
      try {
        if (
          import.meta.env.DEV &&
          import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX"
        ) {
          setActorEmail("dev@local");
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setActorEmail(String(sessionEmail || ""));
      } catch {
        // silent
      }
    };
    loadEmail();
  }, []);

  const fetchCompletionData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aerostackApiClient.get("/loops/learning-completion");
      const data = res.data?.data;
      const reqs: GroupedRequirement[] = data?.requirements || [];
      setRequirements(reqs);

      // Build person summaries from the same data
      const personMap = new Map<string, PersonSummary>();
      const now = new Date();

      for (const req of reqs) {
        for (const record of req.records) {
          const email = record.owner_email;
          if (!personMap.has(email)) {
            personMap.set(email, {
              email,
              name: record.owner_name,
              total: 0,
              completed: 0,
              in_progress: 0,
              not_started: 0,
              overdue: 0,
              records: [],
            });
          }
          const person = personMap.get(email)!;
          person.total++;
          person.records.push(record);

          if (record.status === "COMPLETED") {
            person.completed++;
          } else if (
            record.status === "IN_PROGRESS" ||
            record.status === "IN_QA_REVIEW"
          ) {
            person.in_progress++;
          } else {
            person.not_started++;
          }

          if (
            record.status !== "COMPLETED" &&
            record.status !== "IN_QA_REVIEW" &&
            record.target_completion_date &&
            record.target_completion_date !== "9999-12-31" &&
            new Date(record.target_completion_date) < now
          ) {
            person.overdue++;
          }
        }
      }

      const summaries = Array.from(personMap.values()).sort((a, b) => {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        return b.total - a.total;
      });
      setPersonSummaries(summaries);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load completion data");
      setRequirements([]);
      setPersonSummaries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchCompletionData();
  }, [fetchCompletionData]);

  React.useEffect(() => {
    if (requirements.length > 0 && location.state?.selectedRequirementTitle) {
      const matched = requirements.find(
        (r) => r.title.toLowerCase() === location.state.selectedRequirementTitle.toLowerCase()
      );
      if (matched) {
        setSelectedRequirement(matched);
        // Clear router state to prevent selection from persisting on reload
        window.history.replaceState({}, document.title);
      }
    }
  }, [requirements, location.state]);

  const exportToCsv = useCallback(() => {
    if (gridRef.current) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `learning_completion_${viewMode}_${new Date().toISOString().split("T")[0]}.csv`,
      });
    }
  }, [viewMode]);

  const getStatusBadge = (status: string) => {
    const statusLabel = status.replace(/_/g, " ");
    return <span className="text-sm">{statusLabel}</span>;
  };

  // Column defs for task detail (people for a specific task)
  const taskDetailColumnDefs: any = useMemo(
    () => [
      {
        field: "owner_email",
        headerName: "Person",
        flex: 2,
        cellRenderer: (params: any) => (
          <Button
            variant="link"
            className="text-primary font-medium p-0 h-auto"
            onClick={() =>
              navigate(
                ROUTES.APP.LOOP.path.replace(":loopId", params.data.loop_id),
                {
                  state: {
                    loopId: params.data.loop_id,
                    from: "learning-completion",
                  },
                },
              )
            }
          >
            {params.data.owner_name || params.value}
          </Button>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 1.2,
        cellRenderer: (params: any) => getStatusBadge(params.value),
      },
      {
        field: "target_completion_date",
        headerName: "Due Date",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value && p.value !== "9999-12-31"
            ? new Date(p.value).toLocaleDateString()
            : "-",
      },
      {
        field: "actual_completion_date",
        headerName: "Completed On",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value ? new Date(p.value).toLocaleDateString() : "-",
      },
      {
        field: "outcome_score",
        headerName: "Score",
        flex: 0.7,
        valueFormatter: (p: any) => (p.value ? `${p.value}/5` : "-"),
      },
    ],
    [navigate],
  );

  // Column defs for person detail (tasks for a specific person)
  const personDetailColumnDefs: any = useMemo(
    () => [
      {
        field: "title",
        headerName: "Requirement",
        flex: 2.5,
        cellRenderer: (params: any) => (
          <Button
            variant="link"
            className="text-primary font-medium p-0 h-auto"
            onClick={() =>
              navigate(
                ROUTES.APP.LOOP.path.replace(":loopId", params.data.loop_id),
                {
                  state: {
                    loopId: params.data.loop_id,
                    from: "learning-completion",
                  },
                },
              )
            }
          >
            {params.value}
          </Button>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 1.2,
        cellRenderer: (params: any) => getStatusBadge(params.value),
      },
      {
        field: "target_completion_date",
        headerName: "Due Date",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value && p.value !== "9999-12-31"
            ? new Date(p.value).toLocaleDateString()
            : "-",
      },
      {
        field: "actual_completion_date",
        headerName: "Completed On",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value ? new Date(p.value).toLocaleDateString() : "-",
      },
      {
        field: "outcome_score",
        headerName: "Score",
        flex: 0.7,
        valueFormatter: (p: any) => (p.value ? `${p.value}/5` : "-"),
      },
    ],
    [navigate],
  );

  // ─── Filtered lists (must be above early returns) ──────────────────────────
  const filteredRequirements = useMemo(() => {
    if (!searchFilter) return requirements;
    const lower = searchFilter.toLowerCase();
    return requirements.filter((r) => r.title.toLowerCase().includes(lower));
  }, [requirements, searchFilter]);

  const filteredPersons = useMemo(() => {
    if (!searchFilter) return personSummaries;
    const lower = searchFilter.toLowerCase();
    return personSummaries.filter(
      (p) =>
        p.email.toLowerCase().includes(lower) ||
        (p.name && p.name.toLowerCase().includes(lower)),
    );
  }, [personSummaries, searchFilter]);

  // ─── Detail View: Task (people for a requirement) ───────────────────────────
  if (selectedRequirement) {
    const {
      title,
      total,
      completed,
      in_progress,
      not_started,
      overdue,
      records,
    } = selectedRequirement;
    const completionPercent =
      total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <div className={embedded ? "space-y-6" : "p-6 md:p-10 space-y-6"}>
        <h1 className="text-2xl font-bold text-primary">{title}</h1>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedRequirement(null)}
          className="gap-1 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryCard label="Total Assigned" value={total} />
          <SummaryCard label="Completed" value={completed} color="text-green-600" />
          <SummaryCard label="In Progress" value={in_progress} color="text-blue-600" />
          <SummaryCard label="Not Started" value={not_started} color="text-slate-600" />
          <SummaryCard label="Overdue" value={overdue} color="text-red-600" />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-medium">{completionPercent}%</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>

        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">People</CardTitle>
            {isAdminOrAbove && (
              <Button
                size="sm"
                variant="outline"
                onClick={exportToCsv}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="h-[400px] w-full">
              <div className="ag-theme-alpine h-full w-full">
                <AgGridReact
                  ref={gridRef}
                  theme="legacy"
                  rowData={records}
                  columnDefs={taskDetailColumnDefs}
                  pagination={false}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    resizable: true,
                  }}
                  rowHeight={50}
                  getRowStyle={(params: any) => {
                    if (isOverdue(params.data)) {
                      return { background: "#fff7f7" };
                    }
                    return undefined;
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Detail View: Person (tasks for a person) ──────────────────────────────
  if (selectedPerson) {
    return (
      <PersonDetailView
        person={selectedPerson}
        isAdminOrAbove={isAdminOrAbove}
        gridRef={gridRef}
        exportToCsv={exportToCsv}
        navigate={navigate}
        onBack={() => setSelectedPerson(null)}
        actorEmail={actorEmail}
        embedded={embedded}
      />
    );
  }

  // ─── List View ─────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? "space-y-6" : "p-6 md:p-10 space-y-6"}>
      {!embedded && (
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(ROUTES.APP.LEARNING.path)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Learning
          </Button>
          {/* <h1 className="text-2xl font-bold">Completion Tracking</h1> */}
        </div>
      )}

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div>
              <CardTitle>
                {viewMode === "by-task"
                  ? "By Task"
                  : "By Person"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {viewMode === "by-task"
                  ? "Click a requirement to see who has and hasn't completed it."
                  : "Click a person to see their learning progress."}
              </p>
            </div>

            {/* View mode toggle */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={viewMode === "by-person" ? "default" : "outline"}
                onClick={() => {
                  setViewMode("by-person");
                  setSearchFilter("");
                }}
                className="gap-2"
              >
                <Mail className="h-4 w-4" />
                By Person
              </Button>
              <Button
                size="sm"
                variant={viewMode === "by-task" ? "default" : "outline"}
                onClick={() => {
                  setViewMode("by-task");
                  setSearchFilter("");
                }}
                className="gap-2"
              >
                <ListTodo className="h-4 w-4" />
                By Task
              </Button>
            </div>
          </div>

          <div className="mt-3">
            <input
              type="text"
              placeholder={
                viewMode === "by-task"
                  ? "Search requirements..."
                  : "Search by name or email..."
              }
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full max-w-sm rounded border px-3 py-2 text-sm"
            />
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader description="Loading completion data..." />
            </div>
          ) : viewMode === "by-task" ? (
            // ─── By Task View ────────────────────────────────────────────
            filteredRequirements.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p className="text-sm">No learning requirements found</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {filteredRequirements.map((req) => {
                  const completionPercent =
                    req.total > 0
                      ? Math.round((req.completed / req.total) * 100)
                      : 0;

                  return (
                    <button
                      key={req.title}
                      onClick={() => setSelectedRequirement(req)}
                      className="w-full text-left border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium">{req.title}</h3>
                        <span className="text-sm text-muted-foreground">
                          {req.completed}/{req.total} completed
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        {req.overdue > 0 && (
                          <span className="text-red-600">
                            {req.overdue} overdue
                          </span>
                        )}
                        {req.in_progress > 0 && (
                          <span className="text-blue-600">
                            {req.in_progress} in progress
                          </span>
                        )}
                        {req.not_started > 0 && (
                          <span>{req.not_started} not started</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : // ─── By Person View ───────────────────────────────────────────
            filteredPersons.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <p className="text-sm">No people found</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {filteredPersons.map((person) => {
                  const completionPercent =
                    person.total > 0
                      ? Math.round((person.completed / person.total) * 100)
                      : 0;
                  const barColor =
                    completionPercent === 100
                      ? "bg-green-500"
                      : person.overdue > 0
                        ? "bg-red-500"
                        : "bg-amber-500";

                  return (
                    <button
                      key={person.email}
                      onClick={() => setSelectedPerson(person)}
                      className="w-full text-left border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h3 className="font-medium">
                            {person.name || person.email}
                          </h3>
                          {person.name && (
                            <p className="text-xs text-muted-foreground">
                              {person.email}
                            </p>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {person.completed}/{person.total} completed
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all`}
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        {person.overdue > 0 && (
                          <span className="text-red-600">
                            {person.overdue} overdue
                          </span>
                        )}
                        {person.in_progress > 0 && (
                          <span className="text-blue-600">
                            {person.in_progress} in progress
                          </span>
                        )}
                        {person.not_started > 0 && (
                          <span>{person.not_started} not started</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="border rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold ${color || ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Helper: send reminder via backend ────────────────────────────────────────
async function sendReminderEmail(
  recipientEmail: string,
  title: string,
  senderEmail?: string,
  loopId?: string,
): Promise<void> {
  await aerostackApiClient.post("/loops/send-reminder", {
    to: recipientEmail,
    title,
    sender_email: senderEmail || undefined,
    loop_id: loopId || undefined,
  });
}

// ─── Helper: check if overdue ─────────────────────────────────────────────────
function isOverdue(record: CompletionRecord): boolean {
  return (
    record.status !== "COMPLETED" &&
    record.status !== "IN_QA_REVIEW" &&
    !!record.target_completion_date &&
    record.target_completion_date !== "9999-12-31" &&
    new Date(record.target_completion_date) < new Date()
  );
}

// ─── Status filter type ───────────────────────────────────────────────────────
type StatusFilter = "all" | "overdue" | "in_progress" | "qa_review" | "completed";

// ─── Person Detail View (enhanced) ───────────────────────────────────────────
function PersonDetailView({
  person,
  isAdminOrAbove,
  gridRef,
  exportToCsv,
  navigate,
  onBack,
  actorEmail,
  embedded = false,
}: {
  person: PersonSummary;
  isAdminOrAbove: boolean;
  gridRef: any;
  exportToCsv: () => void;
  navigate: ReturnType<typeof useNavigate>;
  onBack: () => void;
  actorEmail: string;
  embedded?: boolean;
}) {
  const { email, name, total, completed, in_progress, not_started, overdue, records } =
    person;
  const completionPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sentReminders, setSentReminders] = useState<Record<string, number>>({});
  const [sendingBulk, setSendingBulk] = useState(false);

  const now = new Date();

  // Compute overdue count for records
  const overdueRecords = records.filter(isOverdue);

  // Filter records based on status chip
  const filteredRecords = useMemo(() => {
    switch (statusFilter) {
      case "overdue":
        return records.filter(isOverdue);
      case "in_progress":
        return records.filter((r) => r.status === "IN_PROGRESS");
      case "qa_review":
        return records.filter((r) => r.status === "IN_QA_REVIEW");
      case "completed":
        return records.filter((r) => r.status === "COMPLETED");
      default:
        return records;
    }
  }, [records, statusFilter]);

  const inProgressCount = records.filter(
    (r) => r.status === "IN_PROGRESS",
  ).length;
  const qaReviewCount = records.filter(
    (r) => r.status === "IN_QA_REVIEW",
  ).length;
  const completedCount = records.filter((r) => r.status === "COMPLETED").length;

  const isReminderDisabled = (loopId: string, dbLastSent?: string) => {
    const localSent = sentReminders[loopId];
    if (localSent && Date.now() - localSent < 5 * 1000) {
      return true;
    }
    return false;
  };

  const handleSendReminder = async (loopId: string, title: string) => {
    try {
      await sendReminderEmail(email, title, actorEmail, loopId);
      setSentReminders((prev) => ({ ...prev, [loopId]: Date.now() }));
      toast.success(`Reminder sent to ${name || email}`);
    } catch {
      toast.error("Failed to send reminder");
    }
  };

  const handleBulkReminder = async () => {
    setSendingBulk(true);
    let sentCount = 0;
    for (const record of overdueRecords) {
      if (isReminderDisabled(record.loop_id, record.last_reminder_sent)) continue;
      try {
        await sendReminderEmail(email, record.title, actorEmail, record.loop_id);
        setSentReminders((prev) => ({ ...prev, [record.loop_id]: Date.now() }));
        sentCount++;
      } catch {
        // continue with others
      }
    }
    setSendingBulk(false);
    if (sentCount > 0) {
      toast.success(`Sent ${sentCount} reminder(s) to ${name || email}`);
    } else {
      toast("No new reminders needed to be sent", { icon: "ℹ️" });
    }
  };

  // Column defs with Remind column
  const columnDefs: any = useMemo(
    () => [
      {
        field: "title",
        headerName: "Requirement",
        flex: 2.5,
        cellRenderer: (params: any) => (
          <Button
            variant="link"
            className="text-primary font-medium p-0 h-auto"
            onClick={() =>
              navigate(
                ROUTES.APP.LOOP.path.replace(":loopId", params.data.loop_id),
                { state: { loopId: params.data.loop_id, from: "learning-completion" } },
              )
            }
          >
            {params.value}
          </Button>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 1,
        cellRenderer: (params: any) => (
          <span className="text-sm">{params.value.replace(/_/g, " ")}</span>
        ),
      },
      {
        field: "target_completion_date",
        headerName: "Due Date",
        flex: 1,
        cellRenderer: (params: any) => {
          const val = params.value;
          if (!val || val === "9999-12-31") return <span>-</span>;
          const overdue =
            params.data.status !== "COMPLETED" && new Date(val) < now;
          return (
            <span className={overdue ? "text-red-600 font-bold" : ""}>
              {new Date(val).toLocaleDateString()}
            </span>
          );
        },
      },
      {
        field: "actual_completion_date",
        headerName: "Completed On",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value ? new Date(p.value).toLocaleDateString() : "-",
      },
      {
        field: "outcome_score",
        headerName: "Score",
        flex: 0.6,
        valueFormatter: (p: any) => (p.value ? `${p.value}/5` : "-"),
      },
      {
        field: "last_reminder_sent",
        headerName: "Last Reminder",
        flex: 1.2,
        cellRenderer: (params: any) => {
          const localSent = sentReminders[params.data.loop_id];
          const val = localSent
            ? new Date(localSent).toLocaleString()
            : (params.value ? new Date(params.value).toLocaleString() : "-");
          return <span className="text-sm">{val}</span>;
        },
      },
      ...(isAdminOrAbove
        ? [
          {
            headerName: "Remind",
            flex: 0.8,
            cellRenderer: (params: any) => {
              const disabled = isReminderDisabled(params.data.loop_id, params.data.last_reminder_sent);
              return (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || params.data.status === "COMPLETED"}
                  onClick={() =>
                    handleSendReminder(params.data.loop_id, params.data.title)
                  }
                  className="gap-1 text-xs"
                >
                  {disabled ? (
                    "Sent ✓"
                  ) : (
                    <>
                      <Send className="h-3 w-3" />
                      Send
                    </>
                  )}
                </Button>
              );
            },
          },
        ]
        : []),
    ],
    [navigate, isAdminOrAbove, sentReminders],
  );

  // Needs attention banner
  const showAttentionBanner = completionPercent === 0 && overdue > 0;

  return (
    <div className={embedded ? "space-y-6" : "p-6 md:p-10 space-y-6"}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-primary">{name || email}</h1>
        {name && <p className="text-sm text-muted-foreground">{email}</p>}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="gap-1 -ml-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      {/* Needs Attention Banner */}
      {showAttentionBanner && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {overdue} {overdue === 1 ? "requirement is" : "requirements are"} overdue
            and none have been completed. Consider sending a reminder or checking in
            directly.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <SummaryCard label="Total Assigned" value={total} />
        <SummaryCard label="Completed" value={completed} color="text-green-600" />
        <SummaryCard label="In Progress" value={in_progress} color="text-blue-600" />
        <SummaryCard label="QA Review" value={qaReviewCount} color="text-purple-600" />
        <SummaryCard label="Not Started" value={not_started} color="text-slate-600" />
        <SummaryCard label="Overdue" value={overdue} color="text-red-600" />
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: "All", count: records.length },
            { key: "overdue", label: "Overdue", count: overdueRecords.length },
            { key: "in_progress", label: "In Progress", count: inProgressCount },
            { key: "qa_review", label: "QA Review", count: qaReviewCount },
            { key: "completed", label: "Completed", count: completedCount },
          ] as const
        ).map((chip) => (
          <button
            key={chip.key}
            onClick={() => setStatusFilter(chip.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${statusFilter === chip.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-accent"
              }`}
          >
            {chip.label} ({chip.count})
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="shadow-none">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Learning Requirements</CardTitle>
          {isAdminOrAbove && (
            <Button
              size="sm"
              variant="outline"
              onClick={exportToCsv}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full">
            <div className="ag-theme-alpine h-full w-full">
              <AgGridReact
                ref={gridRef}
                theme="legacy"
                rowData={filteredRecords}
                columnDefs={columnDefs}
                pagination={false}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                }}
                rowHeight={50}
                getRowStyle={(params: any) => {
                  if (isOverdue(params.data)) {
                    return { background: "#fff7f7" };
                  }
                  return undefined;
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer: bulk send */}
      {isAdminOrAbove && overdueRecords.length > 0 && (
        <div className="flex items-center justify-end border-t pt-4 text-sm">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkReminder}
            disabled={sendingBulk}
            className="gap-2"
          >
            <Send className="h-4 w-4" />
            {sendingBulk
              ? "Sending..."
              : `Send bulk reminder for overdue items  (${overdueRecords.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}
