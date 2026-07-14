import React from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  FolderKanban,
  Users,
  Building2,
  BarChart3,
  CircleDot,
  ExternalLink,
  CheckCircle2,
  Circle,
  XCircle,
  Tag,
  Activity,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Pencil,
  Edit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Loader from "@/components/Loader";
import { cn } from "@/lib/utils";
import apiClient from "@/api/client";
import toast from "react-hot-toast";
import ProjectEditModal from "./ProjectForm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWriteAccess } from "@/hooks/useWriteAccess";

// ─── Types (mirrors get-project-by-id lambda response) ────────────────────

interface ProjectIssue {
  id: string;
  title: string;
  state_name: string;
  state_type: string;
  priority: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  labels: string[];
  due_date: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  estimate: number | null;
}

interface ProjectDetail {
  id: string;
  prefixedId: string;
  name: string;
  description: string | null;
  content: string | null;
  url: string | null;
  status_name: string;
  virtual_status: string | null;
  priority: string;
  progress: string | null;
  scope: number;
  lead: { id: string | null; name: string | null; email: string | null };
  creator: { id: string | null; name: string | null; email: string | null };
  members: { id: string; name: string; email: string; displayName: string }[];
  teams: { id: string; name: string; key: string }[];
  totalIssues: number;
  completedIssues: number;
  canceledIssues: number;
  issues: ProjectIssue[];
  startDate: string | null;
  targetDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  syncedAt: string | null;
  labels: string[];
  project_updates?: Array<{
    id: string;
    health: string;
    user_name: string | null;
    user_email: string | null;
    created_at: string;
    body: string;
  }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(value: any): string {
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

function progressColor(pct: number): string {
  if (pct >= 75) return "bg-green-500";
  if (pct >= 40) return "bg-yellow-400";
  return "bg-red-400";
}

function statusNameColor(status_name: string | null): string {
  if (!status_name) return "text-gray-600 bg-gray-100 border-gray-200";
  const s = status_name.toLowerCase();
  if (s === "completed" || s === "done")
    return "text-green-600 bg-green-50 border-green-200";
  if (s === "started" || s === "in progress")
    return "text-blue-600 bg-blue-50 border-blue-200";
  if (s.includes("qa") || s.includes("review"))
    return "text-amber-600 bg-amber-50 border-amber-200";
  if (s === "cancelled" || s === "canceled")
    return "text-red-500 bg-red-50 border-red-200";
  return "text-gray-600 bg-gray-100 border-gray-200";
}

function issueStateIcon(stateType: string) {
  const s = stateType.toLowerCase();
  if (s === "completed")
    return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (s === "canceled")
    return <XCircle className="h-4 w-4 text-red-400 shrink-0" />;
  return <Circle className="h-4 w-4 text-gray-400 shrink-0" />;
}

const PRIORITY_LABEL: Record<string, string> = {
  "0": "Minimal",
  "1": "Critical",
  "2": "High",
  "3": "Medium",
  "4": "Low",
};

function healthStatusColor(health: string): string {
  const h = health.toLowerCase();
  if (h === "ontrack" || h === "on_track")
    return "text-green-600 bg-green-50 border-green-200";
  if (h === "atrisk" || h === "at_risk")
    return "text-amber-600 bg-amber-50 border-amber-200";
  if (h === "offtrack" || h === "off_track")
    return "text-red-600 bg-red-50 border-red-200";
  return "text-gray-600 bg-gray-50 border-gray-200";
}

function healthStatusIcon(health: string) {
  const h = health.toLowerCase();
  if (h === "ontrack" || h === "on_track")
    return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (h === "atrisk" || h === "at_risk")
    return <AlertCircle className="h-4 w-4 text-amber-600" />;
  if (h === "offtrack" || h === "off_track")
    return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Activity className="h-4 w-4 text-gray-600" />;
}

const PRIORITY_OPTIONS = [
  { label: "🔴 Critical", value: "Critical" },
  { label: "🟠 High", value: "High" },
  { label: "🟡 Medium", value: "Medium" },
  { label: "🟢 Low", value: "Low" },
  { label: "⚪ Minimal", value: "Minimal" },
];
// ─── Page component ────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [editPanelOpen, setEditPanelOpen] = React.useState(false);
  const { canWrite, permissionKey } = useWriteAccess();

  React.useEffect(() => {
    if (!projectId) return;

    // const cleanId = projectId.replace(/^proj_/, "");

    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await apiClient.get(`/delivery/projects/${projectId}`, {
          headers: permissionKey ? { "X-Resource-Key": permissionKey } : {},
        });
        const proj: ProjectDetail = res.data?.data?.project;
        if (!proj) throw new Error("Project not found in response");
        setProject(proj);
      } catch (e: any) {
        const msg =
          e?.response?.data?.message || e.message || "Failed to load project";
        setFetchError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [projectId, permissionKey]);

  // When the edit panel saves, merge the returned fields into local state
  const handleSaved = React.useCallback((updated: Partial<ProjectDetail>) => {
    setProject((prev) => (prev ? { ...prev, ...updated } : prev));
    toast.success("Project updated");
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader description="Loading project details..." />
      </div>
    );
  }

  // ── Error / not found ────────────────────────────────────────────────────

  if (fetchError || !project) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold">
          {fetchError ? "Error Loading Project" : "Project Not Found"}
        </h2>
        {fetchError && (
          <p className="text-sm text-muted-foreground">{fetchError}</p>
        )}
        <Button variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    );
  }

  const pct = Number(project.progress ?? 0);
  // Stable project id to pass into the panel (strip prefix if present)
  const rawProjectId = project.id.replace(/^proj_/, "");

  return (
    <div className="min-h-screen bg-background">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 border-b bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                className="h-9 w-9"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <FolderKanban className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{project.name}</h1>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Status badge */}
              <span
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-medium capitalize",
                  statusNameColor(project.virtual_status || project.status_name),
                )}
              >
                {project.virtual_status || project.status_name}
              </span>

              {/* Edit button */}
              {(canWrite || permissionKey?.startsWith("tools/")) && (
                <Button
                  variant="default"
                  onClick={() => setEditPanelOpen(true)}
                  disabled={!canWrite}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
              {/* External Linear link */}
              {project.url && (
                <a href={project.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ExternalLink className="h-4 w-4" />
                    Linear
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* ── Overview card ── */}
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="mb-6 flex items-center gap-2 border-b pb-4">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Project Overview</h2>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <span
                  className={cn(
                    "inline-block rounded-md border px-2 py-0.5 text-sm font-medium capitalize",
                    statusNameColor(project.virtual_status || project.status_name),
                  )}
                >
                  {project.virtual_status || project.status_name}
                </span>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Priority
                </label>
                <p className="text-base font-medium">
                  {PRIORITY_LABEL[project.priority] ??
                    PRIORITY_OPTIONS.find((o) => o.value === project.priority)
                      ?.label ??
                    project.priority}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Progress
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-full bg-gray-200 h-2">
                    <div
                      className={cn("h-2 rounded-full", progressColor(pct))}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-9 text-right">
                    {pct}%
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Start Date
                </label>
                <p className="text-base font-medium">
                  {formatDate(project.startDate)}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Target Date
                </label>
                <p className="text-base font-medium">
                  {formatDate(project.targetDate)}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Created
                </label>
                <p className="text-base font-medium">
                  {formatDate(project.createdAt)}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Last Updated
                </label>
                <p className="text-base font-medium">
                  {formatDate(project.updatedAt)}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Last Updated By
                </label>
                <p className="text-base font-medium">{project.updatedBy}</p>
              </div>

              {/* Description — full width */}
              {project.description && (
                <div className="md:col-span-2 lg:col-span-4">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Description
                  </label>
                  <p className="text-base leading-relaxed text-foreground">
                    {project.description}
                  </p>
                </div>
              )}

              {project.content && (
                <div className="md:col-span-2 lg:col-span-4">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Content
                  </label>
                  <div>
                    {/* We use a custom article class to force styling */}
                    <article
                      className="prose prose-slate max-w-none
                      prose-headings:text-black prose-headings
                      prose-p:text-black prose-p:leading-relaxed
                      prose-li:text-black prose-li:my-1
                      prose-ul:list-disc prose-ul:pl-5
                      prose-hr:border-slate-200"
                    >
                      {/* <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          // This forces Headers to be bold even if markdown is weak
                          h2: ({ node, ...props }) => (
                            <h2
                              className="text-xl text-black font-bold mb-4 border-b pb-2"
                              {...props}
                            />
                          ),
                          // This forces List Items to have bullets manually
                          li: ({ node, ...props }) => (
                            <li
                              className="list-disc ml-5 mb-2 text-black"
                              {...props}
                            />
                          ),
                          p: ({ node, ...props }) => (
                            <p
                              className="text-black leading-relaxed mb-4"
                              {...props}
                            />
                          ),
                          // This forces the horizontal lines to appear
                          hr: () => <hr className="my-8 border-slate-200" />,
                        }}
                      >
                        {project.content}
                      </ReactMarkdown> */}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h2: ({ node, ...props }) => (
                            <h2
                              className="text-lg text-black font-bold mb-4 border-b pb-2"
                              {...props}
                            />
                          ),
                          h3: ({ node, ...props }) => (
                            <h3
                              className="text-lg text-black font-bold mb-4 border-b pb-2"
                              {...props}
                            />
                          ),
                          li: ({ node, ...props }) => (
                            <li
                              className="list-disc ml-5 mb-2 text-black"
                              {...props}
                            />
                          ),
                          p: ({ node, ...props }) => (
                            <p
                              className="text-black leading-relaxed mb-4"
                              {...props}
                            />
                          ),
                          hr: () => <hr className="my-8 border-slate-200" />,
                        }}
                      >
                        {project.content}
                      </ReactMarkdown>
                    </article>
                  </div>
                </div>
              )}
              {/* Labels */}
              {project.labels.length > 0 && (
                <div className="md:col-span-2 lg:col-span-4">
                  <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Tag className="h-3.5 w-3.5" /> Labels
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {project.labels.map((l, i) => (
                      <Badge key={i} variant="secondary">
                        {l}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Project Updates card ── */}
        {project.project_updates && project.project_updates.length > 0 && (
          <Card className="border-2">
            <CardContent className="p-6">
              <div className="mb-6 flex items-center gap-2 border-b pb-4">
                <Activity className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Project Updates</h2>
              </div>

              <div className="space-y-4">
                {project.project_updates.map((update) => (
                  <div
                    key={update.id}
                    className="flex gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-shrink-0 pt-1">
                      {healthStatusIcon(update.health)}
                    </div>

                    <div className="flex-grow min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-block rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                              healthStatusColor(update.health),
                            )}
                          >
                            {update.health
                              .replace(/([A-Z])/g, " $1")
                              .toLowerCase()
                              .trim()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground flex-shrink-0">
                          {formatDate(update.created_at)}
                        </p>
                      </div>

                      <p className="text-sm text-muted-foreground mb-2">
                        by{" "}
                        <span className="font-medium">
                          {update.user_name || update.user_email || "Unknown"}
                        </span>
                      </p>

                      {update.body && (
                        <p className="text-sm text-foreground leading-relaxed">
                          {update.body}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── People card ── */}
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="mb-6 flex items-center gap-2 border-b pb-4">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">People</h2>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Lead Name
                </label>
                <p className="text-base font-medium">
                  {project.lead.name || "--"}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Lead Email
                </label>
                <p className="text-base font-medium">
                  {project.lead.email || "--"}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Creator Name
                </label>
                <p className="text-base font-medium">
                  {project.creator.name || "--"}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  Creator Email
                </label>
                <p className="text-base font-medium">
                  {project.creator.email || "--"}
                </p>
              </div>
            </div>

            {project.members.length > 0 && (
              <div className="mt-6">
                <label className="mb-3 block text-sm font-medium text-muted-foreground">
                  Members ({project.members.length})
                </label>
                <div className="grid grid-cols-3 gap-4 mb-2 px-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Name
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Email
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Display Name
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {project.members.map((m) => (
                    <div
                      key={m.id}
                      className="grid grid-cols-3 gap-4 px-4 py-3"
                    >
                      <p className="text-sm font-medium">{m.name || "--"}</p>
                      <p className="text-sm text-muted-foreground">
                        {m.email || "--"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {m.displayName || "--"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Teams card ── */}
        {project.teams.length > 0 && (
          <Card className="border-2">
            <CardContent className="p-6">
              <div className="mb-6 flex items-center gap-2 border-b pb-4">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Teams</h2>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-2 px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Name
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Key
                </p>
              </div>
              <div className="divide-y rounded-md border">
                {project.teams.map((t) => (
                  <div key={t.id} className="grid grid-cols-3 gap-4 px-4 py-3">
                    <p className="text-sm font-medium">{t.name}</p>
                    <Badge variant="outline" className="w-fit">
                      {t.key}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Issues card ── */}
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="mb-6 flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-2">
                <CircleDot className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Key Results</h2>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {project.completedIssues} completed
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="h-4 w-4 text-red-400" />
                  {project.canceledIssues} canceled
                </span>
                <span className="flex items-center gap-1">
                  <Circle className="h-4 w-4 text-gray-400" />
                  {project.totalIssues -
                    project.completedIssues -
                    project.canceledIssues}{" "}
                  remaining
                </span>
              </div>
            </div>

            {project.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issues found</p>
            ) : (
              <>
                <div className="grid grid-cols-12 gap-3 mb-2 px-3">
                  <p className="col-span-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </p>
                  <p className="col-span-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Title
                  </p>
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Assignee
                  </p>
                  <p className="col-span-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Priority
                  </p>
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Due Date
                  </p>
                  <p className="col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Labels
                  </p>
                </div>

                <div className="divide-y rounded-md border">
                  {project.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className="grid grid-cols-12 gap-3 px-3 py-3 items-center hover:bg-muted/40 transition-colors"
                    >
                      <div className="col-span-1 flex items-center gap-1.5">
                        {issueStateIcon(issue.state_type)}
                      </div>

                      <div className="col-span-4">
                        <p className="text-sm font-medium leading-tight">
                          {issue.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {issue.state_name}
                        </p>
                      </div>

                      <p className="col-span-2 text-sm text-muted-foreground truncate">
                        {issue.assignee_name || "--"}
                      </p>

                      <p className="col-span-1 text-sm text-muted-foreground">
                        {PRIORITY_LABEL[issue.priority || ""] ??
                          PRIORITY_OPTIONS.find(
                            (o) => o.value === issue.priority,
                          )?.label ??
                          issue.priority}
                      </p>

                      <p className="col-span-2 text-sm text-muted-foreground">
                        {formatDate(issue.due_date)}
                      </p>

                      <div className="col-span-2 flex flex-wrap gap-1">
                        {issue.labels.length > 0 ? (
                          issue.labels.map((l, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-xs"
                            >
                              {l}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            --
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Edit modal ── */}
      {editPanelOpen && (
        <ProjectEditModal
          open={editPanelOpen}
          projectId={rawProjectId}
          project={project as any}
          onClose={() => setEditPanelOpen(false)}
          onSaved={handleSaved as any}
        />
      )}
    </div>
  );
}
