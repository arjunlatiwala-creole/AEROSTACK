import { useState, useEffect, useCallback } from "react";
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
import {
  GraduationCap,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Upload,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  MessageSquare,
  Lightbulb,
  ClipboardCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import Loader from "@/components/Loader";
import { useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";

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

interface AccreditationModuleProgress {
  module_id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  completed_at?: string;
  evidence_url?: string;
}

interface Assignment {
  requirement_id: string;
  person_email: string;
  person_name?: string;
  assignment_type: string;
  status: string;
  assigned_at: string;
  deadline?: string;
  completed_at?: string;
  notes?: string;
  module_progress: AccreditationModuleProgress[];
}

interface Requirement {
  requirement_id: string;
  title: string;
  description?: string;
  provider: string;
  provider_program?: string;
  category: string;
  assignment_type: string;
  modules: AccreditationModule[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchAssignments(email: string): Promise<Assignment[]> {
  const res = await fetch(`${TOOLS_API}/accreditations?action=list_assignments&email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.assignments || [];
}

async function fetchRequirements(): Promise<Requirement[]> {
  const res = await fetch(`${TOOLS_API}/accreditations?action=list_requirements`);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.requirements || [];
}

async function markModuleComplete(email: string, requirementId: string, moduleId: string, evidenceUrl: string): Promise<void> {
  const res = await fetch(`${TOOLS_API}/accreditations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update_module_progress",
      email,
      requirement_id: requirementId,
      module_id: moduleId,
      status: "COMPLETED",
      evidence_url: evidenceUrl,
    }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string) {
  switch (status) {
    case "COMPLETED":
      return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] py-0 px-1.5"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />Done</Badge>;
    case "IN_PROGRESS":
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] py-0 px-1.5"><Clock className="w-2.5 h-2.5 mr-0.5" />Active</Badge>;
    case "EXPIRED":
      return <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] py-0 px-1.5"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />Expired</Badge>;
    case "WAIVED":
      return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px] py-0 px-1.5">Waived</Badge>;
    default:
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[10px] py-0 px-1.5">Todo</Badge>;
  }
}

function getLoopStatusBadge(status: string) {
  const norm = (status || "").toLowerCase();
  if (norm === "completed" || norm === "done") {
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] py-0 px-1.5">✓ Done</Badge>;
  }
  return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] py-0 px-1.5">Active</Badge>;
}

function getAssignmentTypeBadge(type: string) {
  switch (type) {
    case "MANDATORY":
      return <Badge variant="destructive" className="text-[9px] py-0 px-1">Mandatory</Badge>;
    case "ONBOARDING":
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200 text-[9px] py-0 px-1">Onboarding</Badge>;
    case "REMEDIAL":
      return <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-[9px] py-0 px-1">Remedial</Badge>;
    case "AD_HOC":
      return <Badge className="bg-cyan-100 text-cyan-800 border-cyan-200 text-[9px] py-0 px-1">Ad Hoc</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] py-0 px-1">{type}</Badge>;
  }
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function categorizeItem(categoryInput?: string): "OAL" | "FLUENCY" | "PRO_DEV" | "ONBOARDING" {
  if (!categoryInput) return "ONBOARDING";
  const cat = categoryInput.toUpperCase();

  // Exact type category matches
  if (cat === "LEARNING" || cat === "OAL") return "OAL";
  if (cat === "COMMS_FLUENCY" || cat === "FLUENCY") return "FLUENCY";
  if (cat === "LND" || cat === "PRO-DEV" || cat === "PRO_DEV") return "PRO_DEV";
  if (cat === "SKILLS_CERT" || cat === "SKILLS") return "ONBOARDING";

  // Regex/Substring fuzzy matches
  if (/LEARN|OAL|ACCREDIT|CERT/i.test(cat)) return "OAL";
  if (/FLUENCY|COMMS|COMMUNICATION|DOMAIN|INDUSTRY/i.test(cat)) return "FLUENCY";
  if (/LND|PRO|DEV|CURIOSITY|INNOVATION|GROWTH/i.test(cat)) return "PRO_DEV";
  if (/SKILL|ONBOARD|REQ|DOC/i.test(cat)) return "ONBOARDING";

  return "ONBOARDING";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AccreditedLearningCardProps {
  email: string;
  loops?: any[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccreditedLearningCard({ email, loops }: AccreditedLearningCardProps) {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requirements, setRequirements] = useState<Record<string, Requirement>>({});
  const [loading, setLoading] = useState(true);
  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  const [evidenceDialog, setEvidenceDialog] = useState<{ requirementId: string; moduleId: string } | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    try {
      const [assignData, reqData] = await Promise.all([
        fetchAssignments(email),
        fetchRequirements(),
      ]);
      setAssignments(assignData);
      const reqMap: Record<string, Requirement> = {};
      for (const r of reqData) {
        reqMap[r.requirement_id] = r;
      }
      setRequirements(reqMap);
    } catch (err) {
      console.error("Failed to load accreditation data:", err);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  const handleMarkComplete = async () => {
    if (!evidenceDialog) return;
    setSubmitting(true);
    try {
      await markModuleComplete(email, evidenceDialog.requirementId, evidenceDialog.moduleId, evidenceUrl);
      toast.success("Module marked as complete");
      setEvidenceDialog(null);
      setEvidenceUrl("");
      await load();
    } catch (err) {
      toast.error("Failed to update progress");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm border-2 border-purple-200">
        <CardContent className="flex items-center justify-center h-32">
          <Loader description="Loading accredited learning..." />
        </CardContent>
      </Card>
    );
  }

  // Filter learning loops
  const learningLoops = (loops || []).filter((l) =>
    ["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category)
  );

  if (assignments.length === 0 && learningLoops.length === 0) {
    return (
      <Card className="shadow-sm border-2 border-purple-200" role="region" aria-labelledby="accredited-learning">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-purple-600" />
              <CardTitle id="accredited-learning" className="text-lg">Accredited Learning</CardTitle>
            </div>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate(ROUTES.APP.ACCREDITATIONS.path)}>
              View All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No accredited learning items assigned.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compute compliance stats for official requirements and active learning loops
  const activeLoops = learningLoops.filter((l) => l.status !== "COMPLETED");
  const completedLoops = learningLoops.filter((l) => l.status === "COMPLETED");
  const overdueLoops = learningLoops.filter((l) => {
    if (l.status === "COMPLETED") return false;
    if (!l.target_completion_date) return false;
    return new Date(l.target_completion_date) < new Date();
  });

  const activeCount = assignments.filter((a) => a.status !== "COMPLETED" && a.status !== "WAIVED").length + activeLoops.length;
  const completedCount = assignments.filter((a) => a.status === "COMPLETED").length + completedLoops.length;
  const overdueCount = assignments.filter((a) => {
    if (a.status === "COMPLETED" || a.status === "WAIVED") return false;
    if (!a.deadline) return false;
    return new Date(a.deadline) < new Date();
  }).length + overdueLoops.length;
  const isCompliant = activeCount > 0 && overdueCount === 0;
  const nextDeadline = [
    ...assignments
      .filter((a) => a.deadline && a.status !== "COMPLETED" && a.status !== "WAIVED")
      .map((a) => a.deadline as string),
    ...activeLoops
      .filter((l) => l.target_completion_date)
      .map((l) => l.target_completion_date as string)
  ].sort()[0];

  const toggleExpand = (reqId: string) => {
    setExpandedAssignment((prev) => (prev === reqId ? null : reqId));
  };

  // Group loops & assignments
  const getAssignmentCategory = (assignment: Assignment): "OAL" | "FLUENCY" | "PRO_DEV" | "ONBOARDING" => {
    const req = requirements[assignment.requirement_id];
    return categorizeItem(req?.category || assignment.requirement_id);
  };

  const oalAssignments = assignments.filter(a => getAssignmentCategory(a) === "OAL");
  const fluencyAssignments = assignments.filter(a => getAssignmentCategory(a) === "FLUENCY");
  const proDevAssignments = assignments.filter(a => getAssignmentCategory(a) === "PRO_DEV");
  const onboardingAssignments = assignments.filter(a => getAssignmentCategory(a) === "ONBOARDING");

  const oalLoops = learningLoops.filter(l => l.category === "OAL");
  const fluencyLoops = learningLoops.filter(l => l.category === "COMMS_FLUENCY");
  const proDevLoops = learningLoops.filter(l => l.category === "PRO-DEV");
  const onboardingLoops = learningLoops.filter(l => l.category === "ONBOARDING");

  const renderAssignmentItem = (assignment: Assignment) => {
    const req = requirements[assignment.requirement_id];
    const isExpanded = expandedAssignment === assignment.requirement_id;
    const totalModules = req?.modules.length ?? 0;
    const completedModules = assignment.module_progress.filter((m) => m.status === "COMPLETED").length;
    const progressPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
    const deadlineDays = daysUntil(assignment.deadline);
    const isOverdue = deadlineDays !== null && deadlineDays < 0;

    return (
      <div key={assignment.requirement_id} className={`border rounded-lg p-3 bg-white dark:bg-gray-900 shadow-sm ${isOverdue ? "border-red-300" : "border-gray-200"}`}>
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => toggleExpand(assignment.requirement_id)}
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleExpand(assignment.requirement_id); }}
        >
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {getAssignmentTypeBadge(assignment.assignment_type)}
              <h4 className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate max-w-[120px]" title={req?.title ?? assignment.requirement_id}>
                {req?.title ?? assignment.requirement_id}
              </h4>
            </div>
            {req?.provider_program && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{req.provider} — {req.provider_program}</p>
            )}
            {assignment.deadline && (
              <p className={`text-[10px] mt-0.5 ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                {isOverdue
                  ? `⚠ Overdue`
                  : `Due ${formatDate(assignment.deadline)}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="text-right">
              <p className="text-[11px] font-bold">{progressPct}%</p>
              <p className="text-[9px] text-muted-foreground">{completedModules}/{totalModules}</p>
            </div>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${progressPct === 100 ? "bg-green-500" : isOverdue ? "bg-red-400" : "bg-purple-500"
              }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Expanded module list */}
        {isExpanded && req && (
          <div className="mt-3 space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-800">
            {req.description && <p className="text-[11px] text-muted-foreground leading-relaxed">{req.description}</p>}
            {req.modules
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((mod) => {
                const progress = assignment.module_progress.find((mp) => mp.module_id === mod.module_id);
                const modStatus = progress?.status ?? "NOT_STARTED";
                return (
                  <div
                    key={mod.module_id}
                    className={`flex items-center justify-between p-2 rounded border text-[11px] ${modStatus === "COMPLETED" ? "bg-green-50/50 dark:bg-green-950/10 border-green-200"
                        : modStatus === "IN_PROGRESS" ? "bg-blue-50/50 dark:bg-blue-950/10 border-blue-200"
                          : "bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800"
                      }`}
                  >
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1">
                        {modStatus === "COMPLETED" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                        ) : modStatus === "IN_PROGRESS" ? (
                          <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-700 shrink-0" />
                        )}
                        <span className={`truncate ${modStatus === "COMPLETED" ? "line-through text-muted-foreground" : "font-medium"}`}>
                          {mod.title}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {mod.external_url && (
                        <a href={mod.external_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" aria-label={`Open ${mod.title}`}>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {modStatus !== "COMPLETED" && (
                        <Button
                          size="sm" variant="outline" className="text-[10px] h-6 px-1.5"
                          onClick={(e) => { e.stopPropagation(); setEvidenceDialog({ requirementId: assignment.requirement_id, moduleId: mod.module_id }); }}
                        >
                          <Upload className="w-2.5 h-2.5 mr-0.5" />Complete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            {assignment.notes && (
              <p className="text-[10px] text-muted-foreground italic pl-1.5 border-l border-purple-300">{assignment.notes}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLoopItem = (loop: any) => {
    return (
      <div key={loop.loop_id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-white dark:bg-gray-900 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="link"
                className="text-xs text-yellow-600 font-semibold hover:font-bold p-0 h-auto text-left justify-start truncate max-w-[120px]"
                onClick={() => {
                  navigate(
                    ROUTES.APP.LOOP.path.replace(":loopId", loop.loop_id),
                    {
                      state: {
                        loopId: loop.loop_id,
                        from: ROUTES.APP.PERSON.id,
                      },
                    },
                  );
                }}
                title={loop.title}
              >
                {loop.title}
              </Button>
            </div>
            {getLoopStatusBadge(loop.status)}
          </div>
          {loop.description && (
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2" title={loop.description}>
              {loop.description}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card
      className={`shadow-sm border-2 ${overdueCount > 0 ? "border-red-300 bg-red-50/30" : "border-purple-200"
        }`}
      role="region"
      aria-labelledby="accredited-learning"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-purple-600" />
            <CardTitle id="accredited-learning" className="text-lg">Accredited Learning</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {isCompliant ? (
              <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
                <ShieldCheck className="w-3 h-3" />Compliant
              </Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800 border-red-200 gap-1 animate-pulse">
                <ShieldAlert className="w-3 h-3" />
                {overdueCount > 0 ? `${overdueCount} overdue` : "Action needed"}
              </Badge>
            )}
            <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate(ROUTES.APP.ACCREDITATIONS.path)}>
              View All
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs font-medium text-blue-600">Active Requirements</p>
            <p className="text-2xl font-bold text-blue-900">{activeCount}</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
            <p className="text-xs font-medium text-green-600">Completed Requirements</p>
            <p className="text-2xl font-bold text-green-900">{completedCount}</p>
          </div>
          <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-xs font-medium text-red-600">Overdue Requirements</p>
            <p className="text-2xl font-bold text-red-900">{overdueCount}</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
            <p className="text-xs font-medium text-purple-600">Next Deadline</p>
            <p className="text-sm font-bold text-purple-900">{nextDeadline ? formatDate(nextDeadline) : "—"}</p>
            {nextDeadline && (() => {
              const d = daysUntil(nextDeadline);
              if (d === null) return null;
              if (d < 0) return <p className="text-xs text-red-500">{Math.abs(d)}d overdue</p>;
              if (d === 0) return <p className="text-xs text-orange-500">Due today</p>;
              return <p className="text-xs text-purple-500">{d}d remaining</p>;
            })()}
          </div>
        </div>

        {/* 4 Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
          {/* Column 1: OAL & Certifications */}
          <div className="flex flex-col bg-gray-50/50 dark:bg-gray-900/20 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-gray-200/60 dark:border-gray-800">
              <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded text-purple-700 dark:text-purple-300 shrink-0">
                <GraduationCap className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">OAL & Certifications</h3>
                <p className="text-[9px] text-muted-foreground leading-tight truncate">Enterprise accreditation paths</p>
              </div>
            </div>
            <div className="space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
              {oalAssignments.map(renderAssignmentItem)}
              {oalLoops.map(renderLoopItem)}
              {oalAssignments.length === 0 && oalLoops.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4 italic">No active items</p>
              )}
            </div>
          </div>

          {/* Column 2: Comms & Fluency */}
          <div className="flex flex-col bg-gray-50/50 dark:bg-gray-900/20 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-gray-200/60 dark:border-gray-800">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded text-blue-700 dark:text-blue-300 shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">Comms & Fluency</h3>
                <p className="text-[9px] text-muted-foreground leading-tight truncate">Communication & domain fluency</p>
              </div>
            </div>
            <div className="space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
              {fluencyAssignments.map(renderAssignmentItem)}
              {fluencyLoops.map(renderLoopItem)}
              {fluencyAssignments.length === 0 && fluencyLoops.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4 italic">No active items</p>
              )}
            </div>
          </div>

          {/* Column 3: Professional Dev */}
          <div className="flex flex-col bg-gray-50/50 dark:bg-gray-900/20 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-gray-200/60 dark:border-gray-800">
              <div className="p-1.5 bg-green-100 dark:bg-green-900/30 rounded text-green-700 dark:text-green-300 shrink-0">
                <Lightbulb className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">Professional Dev</h3>
                <p className="text-[9px] text-muted-foreground leading-tight truncate">Pro-Dev & innovation growth</p>
              </div>
            </div>
            <div className="space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
              {proDevAssignments.map(renderAssignmentItem)}
              {proDevLoops.map(renderLoopItem)}
              {proDevAssignments.length === 0 && proDevLoops.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4 italic">No active items</p>
              )}
            </div>
          </div>

          {/* Column 4: Onboarding & Req */}
          <div className="flex flex-col bg-gray-50/50 dark:bg-gray-900/20 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-gray-200/60 dark:border-gray-800">
              <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded text-amber-700 dark:text-amber-300 shrink-0">
                <ClipboardCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">Onboarding & Req</h3>
                <p className="text-[9px] text-muted-foreground leading-tight truncate">NDAs, compliance, and policies</p>
              </div>
            </div>
            <div className="space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
              {onboardingAssignments.map(renderAssignmentItem)}
              {onboardingLoops.map(renderLoopItem)}
              {onboardingAssignments.length === 0 && onboardingLoops.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-4 italic">No active items</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {/* Evidence upload dialog */}
      <Dialog open={!!evidenceDialog} onOpenChange={() => { setEvidenceDialog(null); setEvidenceUrl(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Module Complete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Provide a link to your completion evidence (screenshot, certificate URL, or Skillbuilder profile link).
            </p>
            <div>
              <Label htmlFor="evidence-url">Evidence URL (optional)</Label>
              <Input id="evidence-url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://explore.skillbuilder.aws/..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEvidenceDialog(null); setEvidenceUrl(""); }}>Cancel</Button>
            <Button onClick={handleMarkComplete} disabled={submitting}>
              {submitting ? "Saving..." : <><CheckCircle2 className="w-4 h-4 mr-1" />Mark Complete</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
