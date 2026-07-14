import "@/lib/ag-grid-config";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  GraduationCap,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Download,
  Plus,
  ExternalLink,
  TrendingUp,
  Trash2,
  Pencil,
  Loader2,
  Rocket,
  UserPlus,
  Search,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";
import Loader from "@/components/Loader";
import { usePermissions } from "@/context/PermissionsContext";
import {
  StatusDonut,
  RequirementStackedBar,
  MetricStatStrip,
  type StatusMetrics,
  type RequirementBar,
} from "@/components/aerostack/LearningProgressCharts";

const TOOLS_API = import.meta.env.VITE_TOOLS_API_URL ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccreditationModule {
  module_id: string;
  title: string;
  description?: string;
  external_url?: string;
  estimated_hours?: number;
  sort_order: number;
}

interface Requirement {
  requirement_id: string;
  title: string;
  description?: string;
  provider: string;
  provider_program?: string;
  category: string;
  assignment_type: string;
  is_active?: boolean;
  deadline_days?: number;
  applies_to?: string;
  modules: AccreditationModule[];
  created_at?: string;
}

interface RequirementSummary {
  requirement_id: string;
  title: string;
  provider: string;
  assignment_type: string;
  total_assigned: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
  overdue_count: number;
  completion_rate: number;
  assigned_users?: {
    person_email: string;
    person_name: string;
    status: string;
    deadline?: string;
    is_overdue?: boolean;
    assigned_at?: string;
    completed_at?: string;
  }[];
}

interface CompliancePerson {
  person_email: string;
  person_name: string;
  has_active_goal: boolean;
  days_without_active_goal: number;
  is_compliant: boolean;
  active_assignments: number;
  completed_assignments: number;
  overdue_assignments: number;
}

interface RecentCompletion {
  assignment_id: string;
  person_email: string;
  person_name: string;
  requirement_title: string;
  completed_at: string;
}

interface DashboardData {
  total_employees: number;
  compliant_count: number;
  non_compliant_count: number;
  compliance_rate: number;
  by_requirement: RequirementSummary[];
  non_compliant_people: CompliancePerson[];
  recent_completions: RecentCompletion[];
}

const ASSIGNMENT_TYPES = ["MANDATORY", "ONBOARDING", "REMEDIAL", "ELECTIVE", "AD_HOC"];
const APPLIES_TO_OPTIONS = ["ALL", "DEPARTMENT", "ROLE", "INDIVIDUAL"];

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(action: string, qs?: string): Promise<any> {
  const url = qs
    ? `${TOOLS_API}/accreditations?action=${action}&${qs}`
    : `${TOOLS_API}/accreditations?action=${action}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function apiPost(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TOOLS_API}/accreditations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardAccreditations() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"overview" | "people" | "catalog">("overview");
  const gridRef = useRef<AgGridReact>(null);
  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  // ── Dialogs ─────────────────────────────────────────────────────────────────
  const [showReqDialog, setShowReqDialog] = useState(false);
  const [editingReq, setEditingReq] = useState<Requirement | null>(null);
  const [showModuleDialog, setShowModuleDialog] = useState(false);
  const [editingModule, setEditingModule] = useState<AccreditationModule | null>(null);
  const [moduleReqId, setModuleReqId] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignReqId, setAssignReqId] = useState("");
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [viewingReqAssignments, setViewingReqAssignments] = useState<RequirementSummary | null>(null);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignStatusFilter, setAssignStatusFilter] = useState("ALL");

  const filteredAssignedUsers = useMemo(() => {
    if (!viewingReqAssignments || !viewingReqAssignments.assigned_users) return [];
    return viewingReqAssignments.assigned_users.filter((u) => {
      const matchesSearch =
        u.person_name.toLowerCase().includes(assignSearch.toLowerCase()) ||
        u.person_email.toLowerCase().includes(assignSearch.toLowerCase());

      const matchesStatus =
        assignStatusFilter === "ALL" ||
        (assignStatusFilter === "OVERDUE" && u.is_overdue) ||
        (!u.is_overdue && u.status === assignStatusFilter);

      return matchesSearch && matchesStatus;
    });
  }, [viewingReqAssignments, assignSearch, assignStatusFilter]);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [reqForm, setReqForm] = useState({
    title: "", description: "", provider: "", provider_program: "",
    category: "", assignment_type: "MANDATORY", deadline_days: "",
    applies_to: "ALL",
  });
  const [modForm, setModForm] = useState({
    title: "", description: "", external_url: "", estimated_hours: "", sort_order: "0",
  });
  const [assignForm, setAssignForm] = useState({
    email: "", person_name: "", assignment_type: "MANDATORY", deadline: "", notes: "",
  });

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dashData, reqData] = await Promise.all([
        api("dashboard"),
        api("list_requirements"),
      ]);
      setDashboard(dashData);
      setRequirements(reqData.requirements || []);
    } catch (err) {
      console.error("Failed to load accreditations:", err);
      toast.error("Failed to load accreditations data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Seed AWS Partner Training ───────────────────────────────────────────────
  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await apiPost({ action: "seed_aws_partner", force: false });
      toast.success(res.message || "Seeded successfully");
      await loadAll();
    } catch (err) {
      toast.error("Failed to seed");
    } finally {
      setSeeding(false);
    }
  };

  // ── Requirement CRUD ────────────────────────────────────────────────────────
  const openNewReq = () => {
    setEditingReq(null);
    setReqForm({ title: "", description: "", provider: "", provider_program: "", category: "", assignment_type: "MANDATORY", deadline_days: "", applies_to: "ALL" });
    setShowReqDialog(true);
  };

  const openEditReq = (req: Requirement) => {
    setEditingReq(req);
    setReqForm({
      title: req.title, description: req.description ?? "", provider: req.provider,
      provider_program: req.provider_program ?? "", category: req.category,
      assignment_type: req.assignment_type, deadline_days: req.deadline_days?.toString() ?? "",
      applies_to: req.applies_to ?? "ALL",
    });
    setShowReqDialog(true);
  };

  const saveReq = async () => {
    if (!reqForm.title.trim()) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      await apiPost({
        action: "upsert_requirement",
        data: {
          requirement_id: editingReq?.requirement_id,
          title: reqForm.title, description: reqForm.description, provider: reqForm.provider,
          provider_program: reqForm.provider_program, category: reqForm.category,
          assignment_type: reqForm.assignment_type,
          deadline_days: reqForm.deadline_days ? parseInt(reqForm.deadline_days) : null,
          applies_to: reqForm.applies_to,
        },
      });
      toast.success(editingReq ? "Requirement updated" : "Requirement created");
      setShowReqDialog(false);
      await loadAll();
    } catch (err) {
      toast.error("Failed to save requirement");
    } finally {
      setSaving(false);
    }
  };

  const deleteReq = async (reqId: string) => {
    if (!confirm("Delete this requirement and all its modules?")) return;
    try {
      await apiPost({ action: "delete_requirement", requirement_id: reqId });
      toast.success("Requirement deleted");
      await loadAll();
    } catch (err) {
      toast.error("Failed to delete");
    }
  };

  // ── Module CRUD ─────────────────────────────────────────────────────────────
  const openNewModule = (reqId: string) => {
    setModuleReqId(reqId);
    setEditingModule(null);
    const req = requirements.find((r) => r.requirement_id === reqId);
    const nextOrder = (req?.modules.length ?? 0) + 1;
    setModForm({ title: "", description: "", external_url: "", estimated_hours: "", sort_order: nextOrder.toString() });
    setShowModuleDialog(true);
  };

  const openEditModule = (reqId: string, mod: AccreditationModule) => {
    setModuleReqId(reqId);
    setEditingModule(mod);
    setModForm({
      title: mod.title, description: mod.description ?? "", external_url: mod.external_url ?? "",
      estimated_hours: mod.estimated_hours?.toString() ?? "", sort_order: mod.sort_order.toString(),
    });
    setShowModuleDialog(true);
  };

  const saveModule = async () => {
    if (!modForm.title.trim()) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      await apiPost({
        action: "upsert_module",
        requirement_id: moduleReqId,
        data: {
          module_id: editingModule?.module_id,
          title: modForm.title, description: modForm.description, external_url: modForm.external_url,
          estimated_hours: modForm.estimated_hours ? parseFloat(modForm.estimated_hours) : null,
          sort_order: parseInt(modForm.sort_order) || 0,
        },
      });
      toast.success(editingModule ? "Module updated" : "Module added");
      setShowModuleDialog(false);
      await loadAll();
    } catch (err) {
      toast.error("Failed to save module");
    } finally {
      setSaving(false);
    }
  };

  const deleteModule = async (reqId: string, modId: string) => {
    if (!confirm("Delete this module?")) return;
    try {
      await apiPost({ action: "delete_module", requirement_id: reqId, module_id: modId });
      toast.success("Module deleted");
      await loadAll();
    } catch (err) {
      toast.error("Failed to delete module");
    }
  };

  // ── Assignment ──────────────────────────────────────────────────────────────
  const openAssign = (reqId: string) => {
    setAssignReqId(reqId);
    setAssignForm({ email: "", person_name: "", assignment_type: "MANDATORY", deadline: "", notes: "" });
    setShowAssignDialog(true);
  };

  const saveAssign = async () => {
    if (!assignForm.email.trim()) { toast.error("Email required"); return; }
    setSaving(true);
    try {
      await apiPost({
        action: "assign",
        requirement_id: assignReqId,
        email: assignForm.email,
        person_name: assignForm.person_name || assignForm.email.split("@")[0],
        assignment_type: assignForm.assignment_type,
        deadline: assignForm.deadline || undefined,
        notes: assignForm.notes,
      });
      toast.success(`Assigned to ${assignForm.email}`);
      setShowAssignDialog(false);
      await loadAll();
    } catch (err) {
      toast.error("Failed to assign");
    } finally {
      setSaving(false);
    }
  };

  // ── CSV export ──────────────────────────────────────────────────────────────
  const exportToCsv = useCallback(() => {
    if (gridRef.current) {
      gridRef.current.api.exportDataAsCsv({
        fileName: `accreditations_compliance_${new Date().toISOString().split("T")[0]}.csv`,
      });
    }
  }, []);

  // ── AG Grid columns ─────────────────────────────────────────────────────────
  const complianceColumnDefs: any = useMemo(() => [
    {
      field: "person_name", headerName: "Name", flex: 1.5, filter: true,
      cellRenderer: (params: any) => (
        <div className="flex items-center gap-2">
          {!params.data.has_active_goal && <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
          <span className="font-medium">{params.value}</span>
        </div>
      ),
    },
    { field: "person_email", headerName: "Email", flex: 1.5, filter: true },
    {
      field: "has_active_goal", headerName: "Active Goal", flex: 1,
      cellRenderer: (params: any) => params.value
        ? <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Yes</Badge>
        : <Badge className="bg-red-100 text-red-800 border-red-200"><ShieldAlert className="w-3 h-3 mr-1" />No</Badge>,
    },
    {
      field: "overdue_assignments", headerName: "Overdue", flex: 0.8,
      cellRenderer: (params: any) => params.value > 0
        ? <Badge className="bg-red-100 text-red-800 border-red-200">{params.value}</Badge>
        : <span className="text-gray-400">0</span>,
    },
    { field: "completed_assignments", headerName: "Completed", flex: 0.8 },
  ], []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader description="Loading Accreditations Dashboard..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <GraduationCap className="w-8 h-8 text-purple-600" />
          Accreditations & Learning
        </h1>
        <div className="flex gap-2 flex-wrap">
          {(["overview", "people", "catalog"] as const).map((mode) => (
            <Button key={mode} onClick={() => setViewMode(mode)} variant={viewMode === mode ? "default" : "outline"} size="sm">
              {mode === "overview" && <TrendingUp className="w-4 h-4 mr-1" />}
              {mode === "people" && <Users className="w-4 h-4 mr-1" />}
              {mode === "catalog" && <GraduationCap className="w-4 h-4 mr-1" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      {dashboard && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="shadow-none">
            <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">Total Assigned</p></CardHeader>
            <CardContent><p className="text-4xl font-bold">{dashboard.total_employees}</p></CardContent>
          </Card>
          <Card className="shadow-none border-green-200">
            <CardHeader className="pb-2"><p className="text-sm text-green-600 font-medium">Compliant</p></CardHeader>
            <CardContent>
              <p className="text-4xl font-bold text-green-700">{dashboard.compliant_count}</p>
              <p className="text-xs text-muted-foreground">{dashboard.compliance_rate}% rate</p>
            </CardContent>
          </Card>
          <Card className={`shadow-none ${dashboard.non_compliant_count > 0 ? "border-red-200" : "border-green-200"}`}>
            <CardHeader className="pb-2"><p className={`text-sm font-medium ${dashboard.non_compliant_count > 0 ? "text-red-600" : "text-green-600"}`}>Non-Compliant</p></CardHeader>
            <CardContent><p className={`text-4xl font-bold ${dashboard.non_compliant_count > 0 ? "text-red-700" : "text-green-700"}`}>{dashboard.non_compliant_count}</p></CardContent>
          </Card>
          <Card className="shadow-none border-purple-200">
            <CardHeader className="pb-2"><p className="text-sm text-purple-600 font-medium">Requirements</p></CardHeader>
            <CardContent><p className="text-4xl font-bold text-purple-700">{requirements.length}</p></CardContent>
          </Card>
        </div>
      )}

      {/* ── Overview Mode ──────────────────────────────────────────────────── */}
      {viewMode === "overview" && dashboard && (() => {
        // Derive chart-ready data from dashboard
        const totalAssigned = dashboard.by_requirement.reduce((s, r) => s + r.total_assigned, 0);
        const totalCompleted = dashboard.by_requirement.reduce((s, r) => s + r.completed_count, 0);
        const totalInProgress = dashboard.by_requirement.reduce((s, r) => s + r.in_progress_count, 0);
        const totalNotStarted = dashboard.by_requirement.reduce((s, r) => s + r.not_started_count, 0);
        const totalOverdue = dashboard.by_requirement.reduce((s, r) => s + r.overdue_count, 0);

        const overallMetrics: StatusMetrics = {
          totalAssignments: totalAssigned,
          totalCompleted,
          totalInProgress,
          totalNotStarted,
          totalOverdue,
          completionRate: totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
        };

        const barData: RequirementBar[] = dashboard.by_requirement.slice(0, 8).map(r => ({
          name: r.title,
          completed: r.completed_count,
          inProgress: r.in_progress_count,
          notStarted: r.not_started_count,
          overdue: r.overdue_count,
        }));

        return (
          <div className="space-y-6">
            {/* Animated metric strip */}
            {totalAssigned > 0 && (
              <MetricStatStrip metrics={overallMetrics} label="Accreditation Assignment Status" />
            )}

            {/* Charts row */}
            {totalAssigned > 0 && (
              <div className={`grid gap-4 ${barData.length > 0 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
                <StatusDonut metrics={overallMetrics} title="Compliance Status (All Requirements)" />
                {barData.length > 0 && (
                  <RequirementStackedBar data={barData} title="Status per Requirement" />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Requirement Progress (detailed bars) */}
              <Card className="shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Requirement Completion Detail</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Click any requirement below to view details and list of assigned users.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dashboard.by_requirement.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No requirements with assignments yet.</p>
                  ) : dashboard.by_requirement.map((req) => (
                    <div
                      key={req.requirement_id}
                      className="group space-y-1.5 p-2.5 -mx-2.5 rounded-lg hover:bg-muted/60 cursor-pointer transition-all border border-transparent hover:border-border/40"
                      onClick={() => {
                        setViewingReqAssignments(req);
                        setAssignSearch("");
                        setAssignStatusFilter("ALL");
                      }}
                      title="Click to view assigned users and progress details"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate" title={req.title}>{req.title}</p>
                          <p className="text-xs text-muted-foreground">{req.provider}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <div className="text-right">
                            <p className="text-sm font-bold">{req.completion_rate}%</p>
                            <p className="text-xs text-muted-foreground">{req.completed_count}/{req.total_assigned}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200" />
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${req.completion_rate === 100 ? "bg-green-500" : req.overdue_count > 0 ? "bg-orange-400" : "bg-purple-500"}`}
                          style={{ width: `${req.completion_rate}%` }}
                        />
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-green-600">✓ {req.completed_count}</span>
                        <span className="text-blue-600">◷ {req.in_progress_count}</span>
                        <span className="text-gray-500">○ {req.not_started_count}</span>
                        {req.overdue_count > 0 && <span className="text-red-600 font-semibold">⚠ {req.overdue_count} overdue</span>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Recent completions */}
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-lg">Recent Completions</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.recent_completions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No completions yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.recent_completions.map((c, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
                          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{c.person_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{c.requirement_title}</p>
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(c.completed_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Non-compliant people */}
              {dashboard.non_compliant_people.length > 0 && (
                <Card className="shadow-none border-red-200 dark:border-red-900 lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2 text-red-700 dark:text-red-400">
                        <ShieldAlert className="w-5 h-5" />Non-Compliant ({dashboard.non_compliant_people.length})
                      </CardTitle>
                      <Button size="sm" variant="outline" onClick={() => setViewMode("people")}>View Details</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {dashboard.non_compliant_people.map((p) => (
                        <Badge key={p.person_email} className="bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 py-1 px-3">
                          {p.person_name} {p.overdue_assignments > 0 && <span className="ml-1 font-bold">({p.overdue_assignments} overdue)</span>}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── People Mode ────────────────────────────────────────────────────── */}
      {viewMode === "people" && dashboard && (
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-lg">Employee Compliance</CardTitle>
              {isAdminOrAbove && (
                <Button size="sm" variant="outline" onClick={exportToCsv} className="gap-2">
                  <Download className="h-4 w-4" />Export CSV
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.non_compliant_people.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Everyone is compliant.</p>
              </div>
            ) : (
              <div className="h-[500px] w-full">
                <div className="ag-theme-alpine h-full w-full">
                  <AgGridReact ref={gridRef} theme="legacy" rowData={dashboard.non_compliant_people} columnDefs={complianceColumnDefs} pagination={false} defaultColDef={{ sortable: true, filter: true, resizable: true }} rowHeight={50} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Catalog Mode — full CRUD ───────────────────────────────────────── */}
      {viewMode === "catalog" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-semibold">Requirements Catalog</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleSeed} disabled={seeding}>
                {seeding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}
                Seed AWS Partner Training
              </Button>
              <Button size="sm" onClick={openNewReq}>
                <Plus className="w-4 h-4 mr-1" />Add Requirement
              </Button>
            </div>
          </div>

          {requirements.length === 0 ? (
            <Card className="shadow-none">
              <CardContent className="text-center py-16 text-muted-foreground">
                <GraduationCap className="w-16 h-16 mx-auto mb-4 opacity-40" />
                <h3 className="text-lg font-semibold mb-2">No Requirements Yet</h3>
                <p className="text-sm mb-4">Create a requirement or seed the AWS Partner Training catalog.</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={handleSeed} disabled={seeding}>
                    {seeding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Rocket className="w-4 h-4 mr-1" />}
                    Seed AWS Partner Training
                  </Button>
                  <Button onClick={openNewReq}><Plus className="w-4 h-4 mr-1" />Add Requirement</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            requirements.map((req) => (
              <Card key={req.requirement_id} className="shadow-none">
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">{req.title}</CardTitle>
                        <Badge variant={req.assignment_type === "MANDATORY" ? "destructive" : "outline"} className="text-xs">{req.assignment_type}</Badge>
                        {req.is_active === false && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {req.provider}{req.provider_program ? ` — ${req.provider_program}` : ""}{req.category ? ` • ${req.category}` : ""}
                      </p>
                      {req.description && <p className="text-xs text-muted-foreground mt-1">{req.description}</p>}
                      {req.deadline_days && <p className="text-xs text-muted-foreground">Deadline: {req.deadline_days} days from assignment</p>}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openAssign(req.requirement_id)} title="Assign to person">
                        <UserPlus className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditReq(req)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => deleteReq(req.requirement_id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Modules list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-muted-foreground">Modules ({req.modules.length})</h4>
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => openNewModule(req.requirement_id)}>
                        <Plus className="w-3 h-3 mr-1" />Add Module
                      </Button>
                    </div>
                    {req.modules.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No modules yet. Add modules to define the learning path.</p>
                    ) : (
                      req.modules.sort((a, b) => a.sort_order - b.sort_order).map((mod, idx) => (
                        <div key={mod.module_id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-200">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-mono w-5">{idx + 1}.</span>
                              <span className="text-sm font-medium">{mod.title}</span>
                              {mod.estimated_hours && <span className="text-xs text-muted-foreground">~{mod.estimated_hours}h</span>}
                            </div>
                            {mod.description && <p className="text-xs text-muted-foreground ml-7 mt-0.5">{mod.description}</p>}
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            {mod.external_url && (
                              <a href={mod.external_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 p-1" aria-label={`Open ${mod.title}`}>
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditModule(req.requirement_id, mod)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteModule(req.requirement_id, mod.module_id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Requirement Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showReqDialog} onOpenChange={setShowReqDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingReq ? "Edit Requirement" : "New Requirement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="req-title">Title *</Label>
              <Input id="req-title" value={reqForm.title} onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })} placeholder="AWS Partner Foundational Training" />
            </div>
            <div>
              <Label htmlFor="req-desc">Description</Label>
              <Textarea id="req-desc" value={reqForm.description} onChange={(e) => setReqForm({ ...reqForm, description: e.target.value })} placeholder="What this requirement covers..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-provider">Provider</Label>
                <Input id="req-provider" value={reqForm.provider} onChange={(e) => setReqForm({ ...reqForm, provider: e.target.value })} placeholder="AWS" />
              </div>
              <div>
                <Label htmlFor="req-program">Program</Label>
                <Input id="req-program" value={reqForm.provider_program} onChange={(e) => setReqForm({ ...reqForm, provider_program: e.target.value })} placeholder="Skillbuilder" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-category">Category</Label>
                <Input id="req-category" value={reqForm.category} onChange={(e) => setReqForm({ ...reqForm, category: e.target.value })} placeholder="Cloud Foundations" />
              </div>
              <div>
                <Label>Assignment Type</Label>
                <Select value={reqForm.assignment_type} onValueChange={(v) => setReqForm({ ...reqForm, assignment_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSIGNMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="req-deadline">Deadline (days from assignment)</Label>
                <Input id="req-deadline" type="number" value={reqForm.deadline_days} onChange={(e) => setReqForm({ ...reqForm, deadline_days: e.target.value })} placeholder="30" />
              </div>
              <div>
                <Label>Applies To</Label>
                <Select value={reqForm.applies_to} onValueChange={(v) => setReqForm({ ...reqForm, applies_to: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {APPLIES_TO_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReqDialog(false)}>Cancel</Button>
            <Button onClick={saveReq} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Module Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showModuleDialog} onOpenChange={setShowModuleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingModule ? "Edit Module" : "Add Module"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="mod-title">Title *</Label>
              <Input id="mod-title" value={modForm.title} onChange={(e) => setModForm({ ...modForm, title: e.target.value })} placeholder="AWS Cloud Practitioner Essentials" />
            </div>
            <div>
              <Label htmlFor="mod-desc">Description</Label>
              <Textarea id="mod-desc" value={modForm.description} onChange={(e) => setModForm({ ...modForm, description: e.target.value })} rows={2} />
            </div>
            <div>
              <Label htmlFor="mod-url">External URL (Skillbuilder, Coursera, etc.)</Label>
              <Input id="mod-url" value={modForm.external_url} onChange={(e) => setModForm({ ...modForm, external_url: e.target.value })} placeholder="https://explore.skillbuilder.aws/..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mod-hours">Estimated Hours</Label>
                <Input id="mod-hours" type="number" value={modForm.estimated_hours} onChange={(e) => setModForm({ ...modForm, estimated_hours: e.target.value })} placeholder="4" />
              </div>
              <div>
                <Label htmlFor="mod-order">Sort Order</Label>
                <Input id="mod-order" type="number" value={modForm.sort_order} onChange={(e) => setModForm({ ...modForm, sort_order: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModuleDialog(false)}>Cancel</Button>
            <Button onClick={saveModule} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Assign Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Requirement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="assign-email">Employee Email *</Label>
              <Input id="assign-email" value={assignForm.email} onChange={(e) => setAssignForm({ ...assignForm, email: e.target.value })} placeholder="name@enterprise.io" />
            </div>
            <div>
              <Label htmlFor="assign-name">Display Name</Label>
              <Input id="assign-name" value={assignForm.person_name} onChange={(e) => setAssignForm({ ...assignForm, person_name: e.target.value })} placeholder="Auto-derived from email if blank" />
            </div>
            <div>
              <Label>Assignment Type</Label>
              <Select value={assignForm.assignment_type} onValueChange={(v) => setAssignForm({ ...assignForm, assignment_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="assign-deadline">Deadline</Label>
              <Input id="assign-deadline" type="date" min={new Date().toISOString().split("T")[0]} value={assignForm.deadline} onChange={(e) => setAssignForm({ ...assignForm, deadline: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="assign-notes">Notes</Label>
              <Input id="assign-notes" value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} placeholder="Complete by end of April per Will's request" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={saveAssign} disabled={saving}>{saving ? "Assigning..." : "Assign"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Assigned Users Dialog ────────────────────────────────────── */}
      <Dialog open={viewingReqAssignments !== null} onOpenChange={(open) => { if (!open) setViewingReqAssignments(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold truncate pr-6" title={viewingReqAssignments?.title}>
              Assigned Users: {viewingReqAssignments?.title}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {viewingReqAssignments?.provider} • {viewingReqAssignments?.assignment_type} • {viewingReqAssignments?.total_assigned} assigned
            </p>
          </DialogHeader>

          {/* Search and filter inputs */}
          <div className="flex gap-3 py-2 flex-wrap sm:flex-nowrap">
            <div className="flex-1">
              <Input
                placeholder="Search by name or email..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="w-full sm:w-44">
              <Select value={assignStatusFilter} onValueChange={setAssignStatusFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                  <SelectItem value="OVERDUE">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Users List */}
          <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[450px] border rounded-lg divide-y bg-card mt-2">
            {!viewingReqAssignments?.assigned_users || viewingReqAssignments.assigned_users.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                <Users className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-sm font-semibold">No one assigned yet</p>
                <p className="text-xs">Use the requirements catalog to assign this requirement to employees.</p>
              </div>
            ) : filteredAssignedUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                <Search className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-sm font-semibold">No matching users</p>
                <p className="text-xs">Try adjusting your search query or status filter.</p>
              </div>
            ) : (
              filteredAssignedUsers.map((user) => {
                let badgeClass = "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700";
                let statusLabel = user.status.replace("_", " ");
                if (user.status === "COMPLETED") {
                  badgeClass = "bg-green-100 text-green-800 border-green-200 dark:bg-green-950/20 dark:text-green-300 dark:border-green-800";
                } else if (user.status === "IN_PROGRESS") {
                  badgeClass = "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-800";
                }
                if (user.is_overdue) {
                  badgeClass = "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300 dark:border-red-850";
                  statusLabel = "OVERDUE";
                }

                return (
                  <div key={user.person_email} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 gap-2 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-snug">{user.person_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.person_email}</p>
                      <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
                        {user.assigned_at && (
                          <span>Assigned: {formatDate(user.assigned_at)}</span>
                        )}
                        {user.completed_at && user.status === "COMPLETED" && (
                          <span className="text-green-600 font-medium">Completed: {formatDate(user.completed_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex sm:flex-col items-start sm:items-end justify-between sm:justify-center gap-1.5 shrink-0">
                      <Badge className={`${badgeClass} text-[10px] py-0 px-2 font-semibold uppercase tracking-wider`}>
                        {statusLabel}
                      </Badge>
                      {user.deadline && (
                        <span className={`text-[10px] ${user.is_overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                          {user.is_overdue ? "⚠ Overdue " : "Due "}
                          {formatDate(user.deadline)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="pt-4 border-t mt-4">
            <Button variant="outline" size="sm" onClick={() => setViewingReqAssignments(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
