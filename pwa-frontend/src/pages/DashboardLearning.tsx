import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Loader from "@/components/Loader";
import { aerostackApiClient } from "@/api/client";
import toast from "react-hot-toast";
import { useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import { usePermissions } from "@/context/PermissionsContext";
import { BulkAssignModal } from "@/components/aerostack/BulkAssignModal";
import { MoodleCatalogView } from "@/components/aerostack/MoodleCatalogView";
import LearningCompletionTracking from "./LearningCompletionTracking";
import type { AerostackLoops } from "@enterprise/common";
import {
  Target,
  Users,
  GraduationCap,
  Clock,
  ArrowRight,
  AlertTriangle,
  TrendingUp,
  ClipboardList,
  BookOpen,
  LayoutDashboard,
} from "lucide-react";

type ActiveTab = "dashboard" | "moodle";

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

interface OrgMetrics {
  totalAssignments: number;
  totalCompleted: number;
  totalInProgress: number;
  totalOverdue: number;
  completionRate: number;
  uniquePeople: number;
}

interface UpcomingDeadline {
  title: string;
  dueDate: string;
  assigneeCount: number;
  incompleteCount: number;
}

export default function DashboardLearning() {
  const navigate = useNavigate();
  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const [loading, setLoading] = useState(false);
  const [requirements, setRequirements] = useState<GroupedRequirement[]>([]);
  const [metrics, setMetrics] = useState<OrgMetrics>({
    totalAssignments: 0,
    totalCompleted: 0,
    totalInProgress: 0,
    totalOverdue: 0,
    completionRate: 0,
    uniquePeople: 0,
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");

  // Moodle course selected for bulk assign
  const [selectedMoodleCourse, setSelectedMoodleCourse] = useState<AerostackLoops.MoodleCourse | undefined>();
  // Increment to force MoodleCatalogView to re-fetch after a successful assignment
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);

  // Bulk assign modal state
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  const handleBulkAssignClose = () => {
    setBulkAssignOpen(false);
    setSelectedMoodleCourse(undefined);
  };

  const handleAssignCourse = (course: AerostackLoops.MoodleCourse) => {
    setSelectedMoodleCourse(course);
    setBulkAssignOpen(true);
  };

  const handleAssignSuccess = () => {
    fetchData();
    handleBulkAssignClose();
    // Refresh catalog so Aerostack count updates immediately
    setCatalogRefreshKey((k) => k + 1);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aerostackApiClient.get("/loops/learning-completion");
      const data = res.data?.data;
      const reqs: GroupedRequirement[] = data?.requirements || [];
      setRequirements(reqs);

      // Compute org-level metrics
      const peopleSet = new Set<string>();
      let totalAssignments = 0;
      let totalCompleted = 0;
      let totalInProgress = 0;
      let totalOverdue = 0;
      const now = new Date();
      const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      for (const req of reqs) {
        for (const record of req.records) {
          totalAssignments++;
          peopleSet.add(record.owner_email);

          if (record.status === "COMPLETED") {
            totalCompleted++;
          } else if (record.status === "IN_PROGRESS" || record.status === "IN_QA_REVIEW") {
            totalInProgress++;
          }

          if (
            record.status !== "COMPLETED" &&
            record.status !== "IN_QA_REVIEW" &&
            record.target_completion_date &&
            record.target_completion_date !== "9999-12-31" &&
            new Date(record.target_completion_date) < startOfToday
          ) {
            totalOverdue++;
          }
        }
      }

      setMetrics({
        totalAssignments,
        totalCompleted,
        totalInProgress,
        totalOverdue,
        completionRate: totalAssignments > 0 ? Math.round((totalCompleted / totalAssignments) * 100) : 0,
        uniquePeople: peopleSet.size,
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to load learning dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derive org-level objectives from requirements
  const orgObjectives = useMemo(() => {
    return requirements
      .map((req) => ({
        title: req.title,
        total: req.total,
        completed: req.completed,
        progress: req.total > 0 ? Math.round((req.completed / req.total) * 100) : 0,
        overdue: req.overdue,
        inProgress: req.in_progress,
      }))
      .sort((a, b) => b.total - a.total);
  }, [requirements]);

  // Upcoming deadlines
  const upcomingDeadlines = useMemo((): UpcomingDeadline[] => {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const thirtyDaysOut = new Date(startOfToday);
    thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
    thirtyDaysOut.setHours(23, 59, 59, 999);

    const deadlineMap = new Map<string, UpcomingDeadline>();

    for (const req of requirements) {
      for (const record of req.records) {
        if (
          record.target_completion_date &&
          record.target_completion_date !== "9999-12-31" &&
          record.status !== "COMPLETED"
        ) {
          const dueDate = new Date(record.target_completion_date);
          if (dueDate >= startOfToday && dueDate <= thirtyDaysOut) {
            const key = `${req.title}__${record.target_completion_date}`;
            const existing = deadlineMap.get(key);
            if (existing) {
              existing.assigneeCount++;
              existing.incompleteCount++;
            } else {
              deadlineMap.set(key, {
                title: req.title,
                dueDate: record.target_completion_date,
                assigneeCount: 1,
                incompleteCount: 1,
              });
            }
          }
        }
      }
    }

    return Array.from(deadlineMap.values())
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 5);
  }, [requirements]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader description="Loading Organization Learning Dashboard..." />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="px-6 md:px-10 pt-6 pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold">Organization Learning</h1>
            <p className="text-muted-foreground mt-1">
              Organization-wide learning goals and progress
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.APP.LEARNING_OPS.path)} className="gap-1.5">
              <ClipboardList className="h-4 w-4" />Learning Ops
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.APP.ACCREDITATIONS.path)} className="gap-1.5">
              <GraduationCap className="h-4 w-4" />Accreditations
            </Button>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex border-b">
          <button
            id="tab-overview"
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "dashboard"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
          >
            <LayoutDashboard className="h-4 w-4" />Overview
          </button>
          {isAdminOrAbove && (
            <button
              id="tab-moodle"
              onClick={() => setActiveTab("moodle")}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === "moodle"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              <BookOpen className="h-4 w-4" />Moodle Catalog
              <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-semibold">LMS</span>
            </button>
          )}
        </div>
      </div>

      {/* Moodle Catalog Tab */}
      {activeTab === "moodle" && (
        <MoodleCatalogView forceRefreshKey={catalogRefreshKey} onAssign={handleAssignCourse} />
      )}

      {/* Dashboard Tab */}
      {activeTab === "dashboard" && (
        <div className="p-6 md:p-10 space-y-8">

          {/* Org Metrics Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              icon={<Users className="h-5 w-5 text-blue-600" />}
              label="Team Members"
              value={metrics.uniquePeople}
            />
            <MetricCard
              icon={<Target className="h-5 w-5 text-purple-600" />}
              label="Total Assignments"
              value={metrics.totalAssignments}
            />
            <MetricCard
              icon={<TrendingUp className="h-5 w-5 text-green-600" />}
              label="Completion Rate"
              value={`${metrics.completionRate}%`}
            />
            <MetricCard
              icon={<GraduationCap className="h-5 w-5 text-emerald-600" />}
              label="Completed"
              value={metrics.totalCompleted}
            />
            <MetricCard
              icon={<Clock className="h-5 w-5 text-amber-600" />}
              label="In Progress"
              value={metrics.totalInProgress}
            />
            <MetricCard
              icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
              label="Overdue"
              value={metrics.totalOverdue}
            />
          </div>

          {/* Overdue Alert */}
          {metrics.totalOverdue > 0 && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {metrics.totalOverdue} assignment{metrics.totalOverdue !== 1 ? "s" : ""} overdue
                </p>
              </div>
            </div>
          )}

          {/* Upcoming Deadlines */}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Upcoming Deadlines
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Learning requirements due in the next 30 days
              </p>
            </CardHeader>
            <CardContent>
              {upcomingDeadlines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 text-muted-foreground">
                  <p className="text-sm">No upcoming deadlines in the next 30 days</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {upcomingDeadlines.map((deadline, idx) => {
                    const targetMidnight = new Date(deadline.dueDate);
                    targetMidnight.setHours(0, 0, 0, 0);
                    const todayMidnight = new Date();
                    todayMidnight.setHours(0, 0, 0, 0);
                    const daysUntil = Math.round(
                      (targetMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24),
                    );
                    const isUrgent = daysUntil <= 7;

                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between border rounded-lg p-3 ${isUrgent ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10" : ""
                          }`}
                      >
                        <div>
                          <p className="font-medium text-sm">{deadline.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {deadline.incompleteCount} people still need to complete
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-medium ${isUrgent ? "text-amber-600" : ""}`}>
                            {new Date(deadline.dueDate).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {daysUntil} day{daysUntil !== 1 ? "s" : ""} left
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Org-Level Objectives (Completion Tracking) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold tracking-tight">Org Learning Objectives & Completion</h2>
            </div>
            <LearningCompletionTracking embedded={true} />
          </div>

          {/* Quick Links */}
          {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickLinkCard
              title="Learning Ops"
              description="View and manage all active learning assignments"
              icon={<ClipboardList className="h-6 w-6 text-blue-600" />}
              onClick={() => navigate(ROUTES.APP.LEARNING_OPS.path)}
            />
            <QuickLinkCard
              title="Completion Tracking"
              description="Track progress by task or by person"
              icon={<Target className="h-6 w-6 text-purple-600" />}
              onClick={() => navigate(ROUTES.APP.LEARNING_COMPLETION.path)}
            />
            <QuickLinkCard
              title="Accreditations"
              description="Certifications and compliance tracking"
              icon={<GraduationCap className="h-6 w-6 text-emerald-600" />}
              onClick={() => navigate(ROUTES.APP.ACCREDITATIONS.path)}
            />
            {isAdminOrAbove && (
              <QuickLinkCard
                title="Moodle Catalog"
                description="Browse and bulk-assign Moodle LMS courses to team members"
                icon={<BookOpen className="h-6 w-6 text-blue-600" />}
                onClick={() => setActiveTab("moodle")}
              />
            )}
          </div> */}
        </div>
      )}

      {/* Bulk Assign Modal — rendered outside tab blocks so it works from both tabs */}
      <BulkAssignModal
        open={bulkAssignOpen}
        onClose={handleBulkAssignClose}
        onSuccess={handleAssignSuccess}
        moodleCourse={selectedMoodleCourse}
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-4 flex flex-col items-center text-center gap-2">
        {icon}
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function QuickLinkCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left border rounded-lg p-5 hover:bg-accent/50 transition-colors flex items-start gap-4"
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </button>
  );
}
