import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import Loader from "@/components/Loader";
import { getMoodleCourses, updateMoodleCourse } from "@/api/loops";
import { BulkAssignModal } from "@/components/aerostack/BulkAssignModal";
import { ROUTES } from "@/lib/routes-config";
import { usePermissions } from "@/context/PermissionsContext";
import toast from "react-hot-toast";
import type { AerostackLoops } from "@enterprise/common";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { CourseSectionsDialog } from "@/components/aerostack/CourseSectionsDialog";
import {
  BookOpen,
  Search,
  ExternalLink,
  Users,
  ArrowRight,
  GraduationCap,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  Calendar,
  Tag,
  LayoutGrid,
  List,
  Clock,
  BookMarked,
} from "lucide-react";

type MoodleCourse = AerostackLoops.MoodleCourse;

const MOODLE_BASE_URL = "https://enterprise.moodlecloud.com";

function getCourseUrl(courseId: number): string {
  return `${MOODLE_BASE_URL}/course/view.php?id=${courseId}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function getCourseHours(course?: MoodleCourse): string | null {
  if (!course?.customfields) return null;
  const hoursField = course.customfields.find((f: any) => f.shortname === "hours");
  const val = hoursField?.value || hoursField?.valueraw;
  return val ? String(val) : null;
}

function formatDate(timestamp: number): string {
  if (!timestamp || timestamp === 0) return "";
  return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function toDateString(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toISOString().split("T")[0];
}
function toTimestamp(dateStr: string) {
  if (!dateStr) return 0;
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

type ViewMode = "grid" | "list";

export default function MoodleCatalogPage() {
  const navigate = useNavigate();
  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const [courses, setCourses] = useState<MoodleCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Bulk assign modal state
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<MoodleCourse | null>(null);

  // Edit course modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editCourse, setEditCourse] = useState<MoodleCourse | null>(null);
  const [editFullname, setEditFullname] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [editStartdate, setEditStartdate] = useState("");
  const [editEnddate, setEditEnddate] = useState("");
  const [saving, setSaving] = useState(false);

  // Course sections details dialog state
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [sectionsCourse, setSectionsCourse] = useState<MoodleCourse | null>(null);

  const handleShowSections = (course: MoodleCourse) => {
    setSectionsCourse(course);
    setSectionsOpen(true);
  };

  // Extract unique categories from the loaded courses
  const categoriesList = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of courses) {
      if (c.categoryid && c.categoryname) {
        map.set(c.categoryid, c.categoryname);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [courses]);

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMoodleCourses();
      setCourses(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load Moodle courses";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const filtered = useMemo(() => {
    if (!search.trim()) return courses;
    const q = search.toLowerCase();
    return courses.filter(
      (c) =>
        c.fullname.toLowerCase().includes(q) ||
        c.shortname.toLowerCase().includes(q) ||
        stripHtml(c.summary).toLowerCase().includes(q),
    );
  }, [courses, search]);

  const visibleCourses = filtered.filter((c) => c.visible !== 0);
  const hiddenCourses = filtered.filter((c) => c.visible === 0);

  const handleAssign = (course: MoodleCourse) => {
    setSelectedCourse(course);
    setBulkAssignOpen(true);
  };

  const handleEditClick = (course: MoodleCourse) => {
    setEditCourse(course);
    setEditFullname(course.fullname);
    setEditSummary(course.summary || "");
    setEditHours(getCourseHours(course) || "");
    setEditCategoryId(course.categoryid || 0);
    setEditStartdate(toDateString(course.startdate));
    setEditEnddate(toDateString(course.enddate));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editCourse) return;
    setSaving(true);
    try {
      const newStart = toTimestamp(editStartdate);
      const newEnd = toTimestamp(editEnddate);
      await updateMoodleCourse(
        editCourse.id,
        editFullname,
        editSummary,
        editHours,
        editCategoryId || undefined,
        newStart || undefined,
        newEnd || undefined
      );
      toast.success("Moodle course updated successfully");

      setCourses((prev) =>
        prev.map((c) =>
          c.id === editCourse.id
            ? {
                ...c,
                fullname: editFullname,
                summary: editSummary,
                categoryid: editCategoryId || c.categoryid,
                categoryname: categoriesList.find((cat) => cat.id === editCategoryId)?.name || c.categoryname,
                startdate: newStart || c.startdate,
                enddate: newEnd || c.enddate,
                customfields: [
                  ...(c.customfields || []).filter((f) => f.shortname !== "hours"),
                  {
                    name: "Course Hours",
                    shortname: "hours",
                    type: "number",
                    valueraw: editHours ? Number(editHours) : null,
                    value: editHours || null,
                  },
                ],
              }
            : c
        )
      );

      setEditOpen(false);
      setEditCourse(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update Moodle course";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader description="Loading Moodle Course Catalog…" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(ROUTES.APP.LEARNING.path)}
            className="shrink-0 mt-0.5"
            id="moodle-catalog-back-btn"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">Moodle Catalog</h1>
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-200 text-xs">
                LMS
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              All courses from{" "}
              <a
                href={MOODLE_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-primary transition-colors"
              >
                enterprise.moodlecloud.com
              </a>
              . Select a course to bulk-assign it to your team.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCourses}
            disabled={loading}
            id="moodle-catalog-refresh-btn"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={MOODLE_BASE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open Moodle
            </a>
          </Button>
        </div>
      </div>

      {/* Stats row */}
      {!error && courses.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<BookOpen className="h-5 w-5 text-blue-600" />}
            label="Total Courses"
            value={courses.length}
          />
          <StatCard
            icon={<GraduationCap className="h-5 w-5 text-emerald-600" />}
            label="Active Courses"
            value={courses.filter((c) => c.visible !== 0).length}
          />
          <StatCard
            icon={<Users className="h-5 w-5 text-purple-600" />}
            label="Total Enrollments"
            value={courses.reduce((sum, c) => sum + (c.enrolledusercount ?? 0), 0)}
          />
          <StatCard
            icon={<BookMarked className="h-5 w-5 text-amber-600" />}
            label="Hidden Courses"
            value={courses.filter((c) => c.visible === 0).length}
          />
        </div>
      )}

      {/* Search + view toggle */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="moodle-catalog-search"
            placeholder="Search courses by name, shortcode, or description…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex border rounded-md overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
          <div className="text-center">
            <p className="font-medium">Failed to load courses</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <Button onClick={fetchCourses} variant="outline">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!error && !loading && courses.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
          <BookOpen className="h-12 w-12" />
          <p className="font-medium">No courses found</p>
          <p className="text-sm">Check your Moodle connection or token permissions.</p>
        </div>
      )}

      {/* No search results */}
      {!error && !loading && courses.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
          <Search className="h-8 w-8" />
          <p className="text-sm">No courses match "{search}"</p>
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            Clear search
          </Button>
        </div>
      )}

      {/* Active courses */}
      {!error && visibleCourses.length > 0 && (
        <section className="space-y-3">
          {search === "" && (
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Active Courses ({visibleCourses.length})
            </h2>
          )}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onAssign={isAdminOrAbove ? handleAssign : undefined}
                  onEdit={isAdminOrAbove ? handleEditClick : undefined}
                  onShowSections={handleShowSections}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleCourses.map((course) => (
                <CourseRow
                  key={course.id}
                  course={course}
                  onAssign={isAdminOrAbove ? handleAssign : undefined}
                  onEdit={isAdminOrAbove ? handleEditClick : undefined}
                  onShowSections={handleShowSections}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Hidden courses */}
      {!error && !search && hiddenCourses.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Hidden Courses ({hiddenCourses.length})
          </h2>
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {hiddenCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  onAssign={isAdminOrAbove ? handleAssign : undefined}
                  onEdit={isAdminOrAbove ? handleEditClick : undefined}
                  onShowSections={handleShowSections}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {hiddenCourses.map((course) => (
                <CourseRow
                  key={course.id}
                  course={course}
                  onAssign={isAdminOrAbove ? handleAssign : undefined}
                  onEdit={isAdminOrAbove ? handleEditClick : undefined}
                  onShowSections={handleShowSections}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Footer count */}
      {!error && courses.length > 0 && (
        <p className="text-xs text-center text-muted-foreground pb-4">
          Showing{" "}
          <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
          of{" "}
          <span className="font-semibold text-foreground">{courses.length}</span>{" "}
          courses from Moodle
        </p>
      )}

      {/* Course Sections Dialog */}
      <CourseSectionsDialog
        open={sectionsOpen}
        onClose={() => { setSectionsOpen(false); setSectionsCourse(null); }}
        course={sectionsCourse}
      />

      {/* Bulk Assign Modal */}
      <BulkAssignModal
        open={bulkAssignOpen}
        onClose={() => { setBulkAssignOpen(false); setSelectedCourse(null); }}
        onSuccess={() => { setBulkAssignOpen(false); setSelectedCourse(null); }}
        moodleCourse={selectedCourse ?? undefined}
      />

      {/* Edit Course Modal */}
      <Dialog open={editOpen} onOpenChange={(v) => !v && !saving && setEditOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Moodle Course Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="catalog-edit-fullname">Course Full Name</Label>
              <Input
                id="catalog-edit-fullname"
                value={editFullname}
                onChange={(e) => setEditFullname(e.target.value)}
                placeholder="e.g. Onboarding Architect"
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="catalog-edit-category">Course Category</Label>
              <select
                id="catalog-edit-category"
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(Number(e.target.value))}
                disabled={saving}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value={0}>Select Category...</option>
                {categoriesList.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="catalog-edit-startdate">Start Date</Label>
                <Input
                  id="catalog-edit-startdate"
                  type="date"
                  value={editStartdate}
                  onChange={(e) => setEditStartdate(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catalog-edit-enddate">End Date</Label>
                <Input
                  id="catalog-edit-enddate"
                  type="date"
                  value={editEnddate}
                  onChange={(e) => setEditEnddate(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="catalog-edit-hours">Course Hours</Label>
              <Input
                id="catalog-edit-hours"
                type="number"
                value={editHours}
                onChange={(e) => setEditHours(e.target.value)}
                placeholder="e.g. 32"
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="catalog-edit-summary">Course Description / Summary</Label>
              <RichTextEditor
                value={editSummary}
                onChange={setEditSummary}
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving || !editFullname.trim()}
            >
              {saving ? "Saving..." : "Save to Moodle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
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
      <CardContent className="p-4 flex flex-col items-center text-center gap-1.5">
        {icon}
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

// ─── Grid Card ────────────────────────────────────────────────────────────────

function CourseCard({
  course,
  onAssign,
  onEdit,
  onShowSections,
}: {
  course: MoodleCourse;
  onAssign?: (c: MoodleCourse) => void;
  onEdit?: (c: MoodleCourse) => void;
  onShowSections?: (c: MoodleCourse) => void;
}) {
  const summary = stripHtml(course.summary);
  const courseUrl = getCourseUrl(course.id);
  const startDate = formatDate(course.startdate);
  const endDate = formatDate(course.enddate);

  return (
    <Card className="shadow-none group hover:shadow-md transition-shadow flex flex-col h-full">
      {/* Color bar */}
      <div className="h-1.5 rounded-t-lg bg-gradient-to-r from-blue-500 to-indigo-500" />

      <CardHeader className="pb-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold leading-snug line-clamp-2">
              {course.fullname}
            </CardTitle>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">
                {course.shortname}
              </span>
              {course.visible === 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                  Hidden
                </Badge>
              )}
              {getCourseHours(course) && (
                <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200 border-amber-200 dark:border-amber-800 text-[10px] px-1.5 py-0 h-4 font-semibold">
                  <Clock className="h-2.5 w-2.5" />
                  {getCourseHours(course)}h
                </Badge>
              )}
            </div>
          </div>
          <div className="shrink-0 w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
            <BookOpen className="h-4 w-4 text-blue-600" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 pt-0">
        {/* Summary */}
        {summary && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {summary}
          </p>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {course.enrolledusercount !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {course.enrolledusercount} enrolled
            </span>
          )}
          {course.sections_count !== undefined && (
            <button
              type="button"
              onClick={() => onShowSections?.(course)}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline transition-colors focus:outline-none"
            >
              <BookOpen className="h-3 w-3" />
              {course.sections_count} {course.sections_count === 1 ? "section" : "sections"}
            </button>
          )}
          {startDate && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {startDate}
            </span>
          )}
          {endDate && course.enddate > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Ends {endDate}
            </span>
          )}
        </div>

        {/* Tags / lang */}
        {course.lang && course.lang !== "" && (
          <div className="flex items-center gap-1">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase">{course.lang}</span>
          </div>
        )}

        {/* Actions — pushed to bottom */}
        <div className="mt-auto pt-2 flex gap-1.5">
          {onAssign && (
            <Button
              size="sm"
              className="flex-1 gap-1.5 text-xs h-8"
              onClick={() => onAssign(course)}
              id={`assign-course-${course.id}`}
            >
              Bulk Assign
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {onEdit && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs h-8 px-2.5"
              onClick={() => onEdit(course)}
            >
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" asChild>
            <a href={courseUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
              View
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────

function CourseRow({
  course,
  onAssign,
  onEdit,
  onShowSections,
}: {
  course: MoodleCourse;
  onAssign?: (c: MoodleCourse) => void;
  onEdit?: (c: MoodleCourse) => void;
  onShowSections?: (c: MoodleCourse) => void;
}) {
  const summary = stripHtml(course.summary);
  const courseUrl = getCourseUrl(course.id);
  const startDate = formatDate(course.startdate);

  return (
    <div className="flex items-center gap-4 border rounded-lg p-4 hover:bg-accent/30 transition-colors group">
      {/* Icon */}
      <div className="shrink-0 w-9 h-9 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
        <BookOpen className="h-4 w-4 text-blue-600" />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm leading-tight">{course.fullname}</span>
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">
            {course.shortname}
          </span>
          {course.visible === 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Hidden</Badge>
          )}
        </div>
        {summary && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{summary}</p>
        )}
      </div>

      {/* Meta */}
      <div className="shrink-0 hidden md:flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
        {course.enrolledusercount !== undefined && (
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {course.enrolledusercount}
          </span>
        )}
        {course.sections_count !== undefined && (
          <button
            type="button"
            onClick={() => onShowSections?.(course)}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline transition-colors focus:outline-none"
          >
            <BookOpen className="h-3 w-3" />
            {course.sections_count} sections
          </button>
        )}
        {getCourseHours(course) && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/20 px-1 py-0.5 rounded border border-amber-200 dark:border-amber-800 text-[10px] h-4">
            <Clock className="h-2.5 w-2.5" /> {getCourseHours(course)}h
          </span>
        )}
        {startDate && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {startDate}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex gap-1.5">
        {onAssign && (
          <Button
            size="sm"
            className="gap-1.5 text-xs h-7"
            onClick={() => onAssign(course)}
            id={`assign-course-row-${course.id}`}
          >
            Assign
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
        {onEdit && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs h-7 font-medium"
            onClick={() => onEdit(course)}
          >
            Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" className="gap-1 text-xs h-7" asChild>
          <a href={courseUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}
