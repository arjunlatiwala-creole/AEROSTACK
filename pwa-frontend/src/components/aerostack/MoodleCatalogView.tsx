/**
 * MoodleCatalogView
 * Inline catalog view embedded inside DashboardLearning (Moodle tab).
 * Shows all courses with search, grid/list toggle, and Assign button.
 * Courses are cached in Redux (5-min TTL) so repeated tab switches are instant.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { CourseSectionsDialog } from "@/components/aerostack/CourseSectionsDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { usePermissions } from "@/context/PermissionsContext";
import { updateMoodleCourse } from "@/api/loops";
import toast from "react-hot-toast";
import type { AerostackLoops } from "@enterprise/common";
import type { AppDispatch } from "@/store";
import {
  fetchMoodleCourses,
  refreshMoodleCourses,
  selectMoodleCourses,
  selectMoodleLoading,
  selectMoodleError,
  selectMoodleCacheAge,
} from "@/features/moodle/moodle.slice";
import {
  BookOpen,
  Search,
  ExternalLink,
  Users,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  LayoutGrid,
  List,
  Calendar,
  GraduationCap,
  Layers,
  Clock,
} from "lucide-react";

type MoodleCourse = AerostackLoops.MoodleCourse;

const MOODLE_BASE = "https://enterprise.moodlecloud.com";

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").trim();
}
function getCourseHours(course?: MoodleCourse): string | null {
  if (!course?.customfields) return null;
  const hoursField = course.customfields.find((f: any) => f.shortname === "hours");
  const val = hoursField?.value || hoursField?.valueraw;
  return val ? String(val) : null;
}
function fmt(ts: number) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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
function fmtAge(ms: number | null) {
  if (ms === null) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

interface Props {
  onAssign: (course: MoodleCourse) => void;
  /** When this increments, forces a cache-busting refresh (used after bulk assign). */
  forceRefreshKey?: number;
}

export function MoodleCatalogView({ onAssign, forceRefreshKey }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const courses  = useSelector(selectMoodleCourses);
  const loading  = useSelector(selectMoodleLoading);
  const error    = useSelector(selectMoodleError);
  const cacheAge = useSelector(selectMoodleCacheAge);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  // Edit course modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editCourse, setEditCourse] = useState<MoodleCourse | null>(null);
  const [editFullname, setEditFullname] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [editStartdate, setEditStartdate] = useState("");
  const [editEnddate, setEditEnddate] = useState("");
  const [updating, setUpdating] = useState(false);

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

  const handleEditClick = (course: MoodleCourse) => {
    setEditCourse(course);
    setEditFullname(course.fullname || "");
    setEditSummary(course.summary || "");
    setEditHours(getCourseHours(course) || "");
    setEditCategoryId(course.categoryid || 0);
    setEditStartdate(toDateString(course.startdate));
    setEditEnddate(toDateString(course.enddate));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editCourse) return;
    setUpdating(true);
    try {
      await updateMoodleCourse(
        editCourse.id,
        editFullname,
        editSummary,
        editHours,
        editCategoryId || undefined,
        toTimestamp(editStartdate) || undefined,
        toTimestamp(editEnddate) || undefined
      );
      toast.success("Course details queued for update in Moodle.");
      setEditOpen(false);
      dispatch(refreshMoodleCourses());
    } catch (err: any) {
      toast.error(err.message || "Failed to update course in Moodle.");
    } finally {
      setUpdating(false);
    }
  };

  // Initial load: fetch immediately in the background on mount, and setup 30s polling
  useEffect(() => {
    // Background update on mount
    dispatch(refreshMoodleCourses())
      .unwrap()
      .catch(() => {}); // silent catch for background fetch

    // Poll every 30 seconds for real-time updates
    const timer = setInterval(() => {
      dispatch(refreshMoodleCourses())
        .unwrap()
        .catch(() => {}); // silent catch for background polling
    }, 30000);

    return () => clearInterval(timer);
  }, [dispatch]);

  // Force refresh when parent increments forceRefreshKey (e.g. after bulk assign)
  useEffect(() => {
    if (forceRefreshKey === undefined || forceRefreshKey === 0) return;
    dispatch(refreshMoodleCourses())
      .unwrap()
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to refresh courses";
        toast.error(msg);
      });
  }, [forceRefreshKey, dispatch]);

  const handleManualRefresh = () => {
    dispatch(refreshMoodleCourses())
      .unwrap()
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to refresh courses";
        toast.error(msg);
      });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.fullname.toLowerCase().includes(q) ||
        c.shortname.toLowerCase().includes(q) ||
        stripHtml(c.summary).toLowerCase().includes(q),
    );
  }, [courses, search]);

  const coursesByCategory = useMemo(() => {
    const groups: Record<string, MoodleCourse[]> = {};
    for (const c of filtered) {
      const cat = c.categoryname || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(c);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="px-6 md:px-10 py-6 space-y-5">
      {/* Toolbar */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="moodle-search"
            placeholder="Search courses…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon" onClick={handleManualRefresh} disabled={loading} title="Refresh from Moodle">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={MOODLE_BASE} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-1.5" />Open Moodle
          </a>
        </Button>
        <div className="flex border rounded-md overflow-hidden">
          <button onClick={() => setView("grid")} className={`p-2 transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button onClick={() => setView("list")} className={`p-2 transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      {!error && courses.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
            <span className="font-semibold text-foreground">{courses.length}</span> courses
          </span>
          {courses.some((c) => c.enrolledusercount !== undefined) && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <GraduationCap className="h-3.5 w-3.5 text-blue-500" />
              <span className="font-semibold text-foreground">
                {courses.reduce((s, c) => s + (c.enrolledusercount ?? 0), 0)}
              </span> Moodle enrolled
            </span>
          )}
          {courses.some((c) => (c.aerostack_assigned_count ?? 0) > 0) && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Layers className="h-3.5 w-3.5 text-purple-500" />
              <span className="font-semibold text-foreground">
                {courses.reduce((s, c) => s + (c.aerostack_assigned_count ?? 0), 0)}
              </span> Aerostack assignments
            </span>
          )}
          {/* Cache age indicator */}
          {fmtAge(cacheAge) && (
            <span className="ml-auto text-xs text-muted-foreground/60 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Updated {fmtAge(cacheAge)}
            </span>
          )}
        </div>
      )}

      {/* States */}
      {loading && courses.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm">Loading Moodle courses…</p>
        </div>
      )}
      {!loading && error && courses.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-center text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={handleManualRefresh}>Retry</Button>
        </div>
      )}
      {(courses.length > 0 || (!loading && !error)) && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm">{search ? "No courses match your search" : "No courses found"}</p>
        </div>
      )}

      {/* Grid */}
      {courses.length > 0 && filtered.length > 0 && view === "grid" && (
        <div className="space-y-8">
          {Object.entries(coursesByCategory).map(([categoryName, catCourses]) => (
            <div key={categoryName} className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <h3 className="text-lg font-bold text-foreground tracking-tight">{categoryName}</h3>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-none font-semibold">
                  {catCourses.length} {catCourses.length === 1 ? "course" : "courses"}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {catCourses.map((c) => (
                  <GridCard
                    key={c.id}
                    course={c}
                    onAssign={onAssign}
                    onEdit={isAdminOrAbove ? handleEditClick : undefined}
                    onShowSections={handleShowSections}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {courses.length > 0 && filtered.length > 0 && view === "list" && (
        <div className="space-y-8">
          {Object.entries(coursesByCategory).map(([categoryName, catCourses]) => (
            <div key={categoryName} className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <h3 className="text-lg font-bold text-foreground tracking-tight">{categoryName}</h3>
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-none font-semibold">
                  {catCourses.length} {catCourses.length === 1 ? "course" : "courses"}
                </Badge>
              </div>
              <div className="space-y-2">
                {catCourses.map((c) => (
                  <ListRow
                    key={c.id}
                    course={c}
                    onAssign={onAssign}
                    onEdit={isAdminOrAbove ? handleEditClick : undefined}
                    onShowSections={handleShowSections}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Course Sections Dialog */}
      <CourseSectionsDialog
        open={sectionsOpen}
        onClose={() => { setSectionsOpen(false); setSectionsCourse(null); }}
        course={sectionsCourse}
      />

      {/* Edit Course Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Edit Moodle Course Details
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="edit-fullname">Course Full Name</Label>
              <Input
                id="edit-fullname"
                value={editFullname}
                onChange={(e) => setEditFullname(e.target.value)}
                placeholder="e.g. Advanced TypeScript Onboarding"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-category">Course Category</Label>
              <select
                id="edit-category"
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(Number(e.target.value))}
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
              <div className="space-y-1">
                <Label htmlFor="edit-startdate">Start Date</Label>
                <Input
                  id="edit-startdate"
                  type="date"
                  value={editStartdate}
                  onChange={(e) => setEditStartdate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-enddate">End Date</Label>
                <Input
                  id="edit-enddate"
                  type="date"
                  value={editEnddate}
                  onChange={(e) => setEditEnddate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-summary">Summary / Description</Label>
              <RichTextEditor
                value={editSummary}
                onChange={setEditSummary}
                disabled={updating}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-hours" className="flex items-center gap-1">
                Course Duration (Hours)
                <Badge variant="outline" className="text-[10px] py-0 h-4 border-blue-200 text-blue-700 bg-blue-50/50">
                  Custom Field
                </Badge>
              </Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-hours"
                  type="number"
                  className="pl-9"
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                  placeholder="e.g. 8"
                  min={0}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Sets the estimated learning duration/hours for this course in Moodle.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updating}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updating || !editFullname.trim()}>
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Grid Card ────────────────────────────────────────────────────────────────

function GridCard({
  course,
  onAssign,
  onEdit,
  onShowSections,
}: {
  course: MoodleCourse;
  onAssign: (c: MoodleCourse) => void;
  onEdit?: (c: MoodleCourse) => void;
  onShowSections: (c: MoodleCourse) => void;
}) {
  const summary = stripHtml(course.summary);
  const hours = getCourseHours(course);
  return (
    <div className="border rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow group bg-card">
      <div className="h-1 rounded-full bg-gradient-to-r from-blue-500 to-indigo-400 -mt-1 -mx-1 mb-1" />
      <div className="flex items-start gap-2">
        <div className="shrink-0 w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
          <BookOpen className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-snug line-clamp-2">{course.fullname}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{course.shortname}</span>
            {course.visible === 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Hidden</Badge>}
            {hours && (
              <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200 border-amber-200 dark:border-amber-800 text-[10px] px-1.5 py-0 h-4 font-semibold">
                <Clock className="h-2.5 w-2.5" />
                {hours}h
              </Badge>
            )}
          </div>
        </div>
      </div>

      {summary && <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{summary}</p>}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <GraduationCap className="h-3 w-3" />
          {course.enrolledusercount ?? 0} in Moodle
        </span>
        {course.sections_count !== undefined && (
          <button
            type="button"
            onClick={() => onShowSections(course)}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline transition-colors focus:outline-none"
          >
            <BookOpen className="h-3 w-3" />
            {course.sections_count} {course.sections_count === 1 ? "section" : "sections"}
          </button>
        )}
        {(course.aerostack_assigned_count ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
            <Layers className="h-3 w-3" />
            {course.aerostack_assigned_count} in Aerostack
          </span>
        )}
        {course.startdate > 0 && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />{fmt(course.startdate)}
          </span>
        )}
      </div>

      <div className="mt-auto flex gap-2 pt-1">
        <Button size="sm" className="flex-1 gap-1 text-xs h-8" onClick={() => onAssign(course)} id={`assign-${course.id}`}>
          Bulk Assign<ArrowRight className="h-3 w-3" />
        </Button>
        {onEdit && (
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => onEdit(course)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 px-2" asChild>
          <a href={`${MOODLE_BASE}/course/view.php?id=${course.id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}

// ── List Row ─────────────────────────────────────────────────────────────────

function ListRow({
  course,
  onAssign,
  onEdit,
  onShowSections,
}: {
  course: MoodleCourse;
  onAssign: (c: MoodleCourse) => void;
  onEdit?: (c: MoodleCourse) => void;
  onShowSections: (c: MoodleCourse) => void;
}) {
  const summary = stripHtml(course.summary);
  const hours = getCourseHours(course);
  return (
    <div className="flex items-center gap-3 border rounded-lg px-4 py-3 hover:bg-accent/30 transition-colors group">
      <div className="shrink-0 w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
        <BookOpen className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{course.fullname}</span>
          <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{course.shortname}</span>
          {course.visible === 0 && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Hidden</Badge>}
          {hours && (
            <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200 border-amber-200 dark:border-amber-800 text-[10px] px-1.5 py-0 h-4 font-semibold">
              <Clock className="h-2.5 w-2.5" />
              {hours}h
            </Badge>
          )}
        </div>
        {summary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{summary}</p>}
      </div>
      <span className="hidden md:flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 shrink-0">
        <GraduationCap className="h-3 w-3" />{course.enrolledusercount ?? 0}
      </span>
      {course.sections_count !== undefined && (
        <button
          type="button"
          onClick={() => onShowSections(course)}
          className="hidden md:flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline shrink-0 transition-colors focus:outline-none"
        >
          <BookOpen className="h-3 w-3" />{course.sections_count} sections
        </button>
      )}
      {(course.aerostack_assigned_count ?? 0) > 0 && (
        <span className="hidden md:flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 shrink-0">
          <Layers className="h-3 w-3" />{course.aerostack_assigned_count}
        </span>
      )}
      <div className="shrink-0 flex gap-1.5">
        <Button size="sm" className="gap-1 text-xs h-7" onClick={() => onAssign(course)} id={`assign-row-${course.id}`}>
          Assign<ArrowRight className="h-3 w-3" />
        </Button>
        {onEdit && (
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => onEdit(course)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
          <a href={`${MOODLE_BASE}/course/view.php?id=${course.id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      </div>
    </div>
  );
}
