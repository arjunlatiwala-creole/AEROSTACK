import React, { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getMoodleCourses } from "@/api/loops";
import toast from "react-hot-toast";
import {
  BookOpen,
  Search,
  ExternalLink,
  Users,
  ArrowRight,
  GraduationCap,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import type { AerostackLoops } from "@enterprise/common";

type MoodleCourse = AerostackLoops.MoodleCourse;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when admin clicks "Assign" on a course — opens BulkAssignModal with course pre-filled */
  onAssignCourse?: (course: MoodleCourse) => void;
}

const MOODLE_BASE_URL = "https://enterprise.moodlecloud.com";

function getCourseUrl(courseId: number): string {
  return `${MOODLE_BASE_URL}/course/view.php?id=${courseId}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleDateString();
}

export const MoodleCatalogModal: React.FC<Props> = ({
  open,
  onClose,
  onAssignCourse,
}) => {
  const [courses, setCourses] = useState<MoodleCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchCourses = async () => {
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
  };

  useEffect(() => {
    if (!open) return;
    fetchCourses();
  }, [open]);

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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <GraduationCap className="h-5 w-5 text-blue-600" />
            Moodle Course Catalog
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Browse all courses from{" "}
            <a
              href={MOODLE_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              {MOODLE_BASE_URL}
            </a>
            . Select a course to create a bulk learning assignment.
          </p>
        </DialogHeader>

        {/* Search + refresh */}
        <div className="flex gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="moodle-catalog-search"
              placeholder="Search by name, shortcode, or description…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchCourses}
            disabled={loading}
            title="Refresh course list"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" asChild>
            <a href={MOODLE_BASE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open Moodle
            </a>
          </Button>
        </div>

        {/* Course list */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
          {loading && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
              <p className="text-sm">Loading courses from Moodle…</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-amber-700 dark:text-amber-300 text-center max-w-xs">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={fetchCourses}>
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <BookOpen className="h-8 w-8" />
              <p className="text-sm">
                {search ? "No courses match your search" : "No courses found"}
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            filtered.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                onAssign={onAssignCourse}
              />
            ))}
        </div>

        {/* Footer stats */}
        {!loading && !error && courses.length > 0 && (
          <div className="shrink-0 border-t pt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing{" "}
              <span className="font-semibold text-foreground">
                {filtered.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-foreground">
                {courses.length}
              </span>{" "}
              courses
            </span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

function CourseCard({
  course,
  onAssign,
}: {
  course: MoodleCourse;
  onAssign?: (c: MoodleCourse) => void;
}) {
  const summary = stripHtml(course.summary);
  const courseUrl = getCourseUrl(course.id);

  return (
    <div className="border rounded-lg p-4 hover:bg-accent/30 transition-colors group">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="shrink-0 mt-0.5 w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
          <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="font-semibold text-sm leading-snug flex-1 min-w-0">
              {course.fullname}
            </h3>
            {course.visible === 0 && (
              <Badge variant="outline" className="text-xs shrink-0">
                Hidden
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
              {course.shortname}
            </span>
            {course.enrolledusercount !== undefined && (
              <span className="flex items-center gap-0.5">
                <Users className="h-3 w-3" />
                {course.enrolledusercount} enrolled
              </span>
            )}
            {course.startdate > 0 && (
              <span>Starts {formatDate(course.startdate)}</span>
            )}
            {course.enddate > 0 && (
              <span>Ends {formatDate(course.enddate)}</span>
            )}
          </div>

          {summary && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
              {summary}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="sm"
            variant="default"
            className="gap-1.5 text-xs h-7"
            onClick={() => onAssign?.(course)}
            disabled={!onAssign}
            id={`assign-moodle-course-${course.id}`}
          >
            Assign
            <ArrowRight className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs h-7"
            asChild
          >
            <a href={courseUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
              View
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
