import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "./TagInput";
import { EmailTagInput } from "./EmailTagInput";
import {
  bulkAssignLearning,
  getMoodleCourses,
  getMoodleCoursesCache,
  listGoogleGroups,
  listWorkspaceUsers,
} from "@/api/loops";
import { fetchAuthSession } from "aws-amplify/auth";
import toast from "react-hot-toast";
import type { AerostackLoops } from "@enterprise/common";
import {
  Users,
  UserCheck,
  AlertTriangle,
  Building2,
  X,
  BookOpen,
  ExternalLink,
  Search,
  RefreshCw,
  Layers,
  Lock,
  Clock,
} from "lucide-react";

/** Maps a Moodle course category name to an Aerostack category value. Returns null if no match. */
function moodleCategoryToAerostack(categoryName?: string): string | null {
  if (!categoryName) return null;
  const name = categoryName.toLowerCase();
  if (/learning|oal|accredited/.test(name)) return "OAL";
  if (/pro.?dev|lnd|development|professional/.test(name)) return "PRO-DEV";
  if (/skill|cert|onboarding/.test(name)) return "ONBOARDING";
  if (/fluency|comms|communication/.test(name)) return "COMMS_FLUENCY";
  return null;
}

/** Extracts Course Hours from customfields if present. */
function getCourseHours(course?: AerostackLoops.MoodleCourse): string | null {
  if (!course?.customfields) return null;
  const hoursField = course.customfields.find((f: any) => f.shortname === "hours");
  const val = hoursField?.value || hoursField?.valueraw;
  return val ? String(val) : null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When provided, the form is pre-seeded from this Moodle course. */
  moodleCourse?: AerostackLoops.MoodleCourse;
}

type AssignMode = "everyone" | "group" | "specific";

interface GroupOption {
  email: string;
  name: string;
}

export const BulkAssignModal: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  moodleCourse,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("OAL");
  const [loopType, setLoopType] = useState<string>("OBJECTIVE");
  const [priority, setPriority] = useState(3);
  const [targetDate, setTargetDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState<AssignMode>("everyone");
  const [recipientEmails, setRecipientEmails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [actorEmail, setActorEmail] = useState("");

  // ── Internal Moodle course state (picker used when no prop is passed) ──────
  const [internalMoodleCourse, setInternalMoodleCourse] = useState<AerostackLoops.MoodleCourse | undefined>();
  const [moodleCourses, setMoodleCourses] = useState<AerostackLoops.MoodleCourse[]>([]);
  const [moodleSearch, setMoodleSearch] = useState("");
  const [moodleLoading, setMoodleLoading] = useState(false);
  const [moodlePickerOpen, setMoodlePickerOpen] = useState(false);



  // Resolved course: prop takes priority over picker selection
  const activeMoodleCourse = moodleCourse ?? internalMoodleCourse;
  // Category locked when Moodle course category matches an Aerostack category
  const lockedCategory = moodleCategoryToAerostack(activeMoodleCourse?.categoryname);

  // Load Moodle courses when picker opens
  const loadMoodleCourses = useCallback(async (force = false) => {
    const cached = getMoodleCoursesCache();
    if (cached) {
      // 1. Show cached list instantly to prevent blocking
      setMoodleCourses(cached);
      
      // 2. Fetch updates silently in the background
      getMoodleCourses(force || true)
        .then((fresh) => {
          setMoodleCourses(fresh);
        })
        .catch(() => {});
      return;
    }

    // No cache: show standard loading spinner
    setMoodleLoading(true);
    try {
      const courses = await getMoodleCourses(force);
      setMoodleCourses(courses);
    } catch {
      toast.error("Failed to load Moodle courses");
    } finally {
      setMoodleLoading(false);
    }
  }, [moodleCourses.length]);

  // Auto-seed form when a Moodle course is supplied (prop or picker)
  useEffect(() => {
    if (!open) return;
    if (activeMoodleCourse) {
      setTitle(activeMoodleCourse.fullname);
      const rawDesc = activeMoodleCourse.summary.replace(/<[^>]*>/g, "").trim();
      setDescription(rawDesc.slice(0, 500));
      // Auto-set category if Moodle category matches
      const matched = moodleCategoryToAerostack(activeMoodleCourse.categoryname);
      if (matched) setCategory(matched);
    } else {
      setTitle("");
      setDescription("");
    }
  }, [open, activeMoodleCourse]);

  // Resolve the signed-in user's email once so we can stamp it on the
  // request as `assigned_by`. Falls back to a dev placeholder only when
  // the local Cognito stub is in use.
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
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  // Google Workspace groups
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<GroupOption[]>([]);
  const groupsLoadedRef = useRef(false);

  // Pre-loaded workspace user emails for instant individual search
  const [workspaceEmails, setWorkspaceEmails] = useState<string[]>([]);
  const workspaceLoadedRef = useRef(false);

  // Pre-load workspace users when modal opens
  useEffect(() => {
    if (!open || workspaceLoadedRef.current) return;
    workspaceLoadedRef.current = true;
    listWorkspaceUsers()
      .then(setWorkspaceEmails)
      .catch(() => { });
  }, [open]);

  // Confirmation state — used for all three modes.
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [resolvedCount, setResolvedCount] = useState<number | null>(null);
  const [resolvedEmails, setResolvedEmails] = useState<string[]>([]);
  const [sourceCounts, setSourceCounts] = useState<{
    deel?: number;
    person_table?: number;
    google_workspace?: number;
  } | null>(null);
  const [groupCounts, setGroupCounts] = useState<
    Array<{ email: string; member_count: number; error?: string }> | null
  >(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Lazy-load groups when the user picks the group mode the first time.
  // We use a ref guard (instead of depending on `groups.length` /
  // `groupsLoading`) so flipping those state values during the fetch
  // doesn't re-run the effect and cancel the in-flight request.
  useEffect(() => {
    if (assignTo !== "group") return;
    if (groupsLoadedRef.current) return;
    groupsLoadedRef.current = true;

    let cancelled = false;
    setGroupsLoading(true);
    listGoogleGroups()
      .then((res) => {
        if (cancelled) return;
        setGroups(res);
        if (res.length === 0) {
          toast(
            "No Google Workspace groups available. Check Workspace integration.",
            { icon: "ℹ️" },
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Allow a retry the next time the user toggles into group mode.
        groupsLoadedRef.current = false;
        const message =
          err instanceof Error ? err.message : "Failed to load groups";
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignTo]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategory("OAL");
    setLoopType("OBJECTIVE");
    setPriority(3);
    setTargetDate("");
    setTags([]);
    setAssignTo("everyone");
    setRecipientEmails([]);
    setSelectedGroups([]);
    setShowConfirmation(false);
    setResolvedCount(null);
    setResolvedEmails([]);
    setSourceCounts(null);
    setGroupCounts(null);
    // Reset internal moodle picker
    setInternalMoodleCourse(undefined);
    setMoodlePickerOpen(false);
    setMoodleSearch("");
  };

  const addGroup = (email: string) => {
    const found = groups.find((g) => g.email === email);
    if (!found) return;
    if (selectedGroups.some((g) => g.email === email)) return;
    setSelectedGroups([...selectedGroups, found]);
  };

  const removeGroup = (email: string) => {
    setSelectedGroups(selectedGroups.filter((g) => g.email !== email));
  };

  const buildPayload = (overrides: Partial<{ dry_run: boolean }> = {}) => ({
    title: title.trim(),
    description: description.trim() || undefined,
    category: category as any,
    loop_type: loopType as any,
    priority,
    target_completion_date: targetDate,
    tags: tags.length > 0 ? tags : undefined,
    assign_to: assignTo,
    recipient_emails:
      assignTo === "specific" ? recipientEmails : undefined,
    group_emails:
      assignTo === "group" ? selectedGroups.map((g) => g.email) : undefined,
    assigned_by: actorEmail || undefined,
    // Moodle course metadata (prop takes priority over picker selection)
    ...(activeMoodleCourse && {
      moodle_course_id: activeMoodleCourse.id,
      moodle_course_name: activeMoodleCourse.fullname,
      moodle_course_url: `https://enterprise.moodlecloud.com/course/view.php?id=${activeMoodleCourse.id}`,
    }),
    ...overrides,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    if (!targetDate) {
      toast.error("Target completion date is required");
      return;
    }

    if (assignTo === "group" && selectedGroups.length === 0) {
      toast.error("Please select at least one group");
      return;
    }

    if (assignTo === "specific" && recipientEmails.length === 0) {
      toast.error("Please add at least one recipient");
      return;
    }

    if (showConfirmation) {
      await executeBulkAssign();
      return;
    }

    // Resolve recipients server-side via dry_run so the confirmation
    // shows the exact deduped count, including Google Workspace expansion.
    setLoadingCount(true);
    try {
      const preview = await bulkAssignLearning(buildPayload({ dry_run: true }));
      setResolvedCount(preview.resolved_count ?? 0);
      setResolvedEmails(preview.resolved_emails ?? []);
      setSourceCounts(preview.source_counts ?? null);
      setGroupCounts(preview.group_counts ?? null);
      if ((preview.resolved_count ?? 0) === 0) {
        toast.error("No recipients resolved for this selection");
        return;
      }
      setShowConfirmation(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to resolve recipients";
      toast.error(message);
    } finally {
      setLoadingCount(false);
    }
  };

  const executeBulkAssign = async () => {
    setSubmitting(true);
    try {
      const result = await bulkAssignLearning(buildPayload());

      const recipients = result.assigned_emails ?? [];
      const preview = recipients.slice(0, 5).join(", ");
      const extra =
        recipients.length > 5 ? ` and ${recipients.length - 5} more` : "";

      toast.success(
        `Assigned to ${result.created_count} ${result.created_count === 1 ? "person" : "people"}${result.failed_count > 0 ? ` (${result.failed_count} failed)` : ""}${recipients.length > 0 ? `: ${preview}${extra}` : ""}`,
        { duration: 8000 },
      );

      // Moodle enrollment status toasts
      if (result.moodle_enrolled_count !== undefined) {
        if (result.moodle_enrolled_count > 0) {
          toast.success(
            `✓ ${result.moodle_enrolled_count} user${result.moodle_enrolled_count !== 1 ? "s" : ""} enrolled in Moodle`,
            { duration: 6000 },
          );
        }
        if (result.moodle_created_emails && result.moodle_created_emails.length > 0) {
          toast.success(
            `🆕 ${result.moodle_created_emails.length} new Moodle account${result.moodle_created_emails.length !== 1 ? "s" : ""} created & enrolled — they'll receive a Moodle welcome email to set their password: ${result.moodle_created_emails.join(", ")}`,
            { duration: 14000 },
          );
        }
        if (result.moodle_not_found_emails && result.moodle_not_found_emails.length > 0) {
          toast.error(
            `⚠ ${result.moodle_not_found_emails.length} user${result.moodle_not_found_emails.length !== 1 ? "s" : ""} could not be provisioned in Moodle — check if username already exists with a different email: ${result.moodle_not_found_emails.join(", ")}`,
            { duration: 12000 },
          );
        }
      }

      if (result.email_delivery_error) {
        toast.error(
          `Loops were created but email delivery failed: ${result.email_delivery_error}`,
          { duration: 8000 },
        );
      }

      // eslint-disable-next-line no-console
      console.info("[BulkAssign] result", result);

      resetForm();
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to bulk assign";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Confirmation screen for all modes — shows the actual resolved count.
  if (showConfirmation) {
    const headline =
      assignTo === "everyone"
        ? "every active user across the organization"
        : assignTo === "group"
          ? `${selectedGroups.length} Google Workspace ${selectedGroups.length === 1 ? "group" : "groups"}`
          : `${recipientEmails.length} selected ${recipientEmails.length === 1 ? "recipient" : "recipients"}`;

    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Bulk Assignment
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                You are about to assign this learning requirement to{" "}
                <span className="font-bold">
                  {resolvedCount ?? 0}{" "}
                  {resolvedCount === 1 ? "person" : "people"}
                </span>{" "}
                resolved from {headline}. Duplicates across sources receive a
                single assignment.
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                This action cannot be easily undone.
              </p>
            </div>

            {assignTo === "everyone" && sourceCounts && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-foreground">
                  Pre-dedupe source breakdown
                </p>
                <p>Deel roster: {sourceCounts.deel ?? 0}</p>
                <p>Platform users: {sourceCounts.person_table ?? 0}</p>
                <p>
                  Google Workspace members:{" "}
                  {sourceCounts.google_workspace ?? 0}
                </p>
                <p className="pt-1 text-muted-foreground">
                  After dedupe (case-insensitive):{" "}
                  <span className="font-semibold text-foreground">
                    {resolvedCount ?? 0}
                  </span>
                </p>
              </div>
            )}

            {assignTo === "group" && groupCounts && groupCounts.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <p className="font-medium text-foreground">
                  Group expansion
                </p>
                {groupCounts.map((g) => (
                  <p key={g.email} className="flex justify-between gap-2">
                    <span className="truncate">{g.email}</span>
                    <span
                      className={
                        g.error
                          ? "text-destructive"
                          : "font-medium text-foreground"
                      }
                    >
                      {g.error
                        ? `error: ${g.error.slice(0, 40)}`
                        : `${g.member_count} ${g.member_count === 1 ? "member" : "members"}`}
                    </span>
                  </p>
                ))}
                <p className="pt-1 text-muted-foreground">
                  After dedupe across groups:{" "}
                  <span className="font-semibold text-foreground">
                    {resolvedCount ?? 0}
                  </span>
                </p>
              </div>
            )}

            {resolvedEmails.length > 0 && (
              <details className="rounded-md border bg-muted/20 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-foreground">
                  Preview recipients ({resolvedEmails.length})
                </summary>
                <div className="mt-2 max-h-40 overflow-y-auto space-y-0.5 text-muted-foreground">
                  {resolvedEmails.slice(0, 200).map((email) => (
                    <p key={email} className="truncate">
                      {email}
                    </p>
                  ))}
                  {resolvedEmails.length > 200 && (
                    <p className="pt-1 italic">
                      …and {resolvedEmails.length - 200} more
                    </p>
                  )}
                </div>
              </details>
            )}

            <div className="bg-muted/50 rounded-md p-3 space-y-1">
              <p className="text-sm">
                <span className="font-medium">Title:</span> {title}
              </p>
              <p className="text-sm">
                <span className="font-medium">Category:</span> {category}
              </p>
              <p className="text-sm">
                <span className="font-medium">Due:</span> {targetDate}
              </p>
              {activeMoodleCourse && (
                <p className="text-sm flex items-center gap-1 flex-wrap">
                  <span className="font-medium">Moodle Course:</span>
                  <BookOpen className="h-3.5 w-3.5 text-blue-600" />
                  <a
                    href={`https://enterprise.moodlecloud.com/course/view.php?id=${activeMoodleCourse.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline truncate mr-2"
                  >
                    {activeMoodleCourse.fullname}
                  </a>
                  {getCourseHours(activeMoodleCourse) && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/20 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                      <Clock className="h-3 w-3" />
                      {getCourseHours(activeMoodleCourse)} Hours
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmation(false)}
              disabled={submitting}
            >
              Go Back
            </Button>
            <Button
              variant={assignTo === "everyone" ? "destructive" : "default"}
              onClick={executeBulkAssign}
              disabled={submitting || (resolvedCount ?? 0) === 0}
            >
              {submitting
                ? "Assigning..."
                : `Confirm — Assign to ${resolvedCount ?? 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const availableGroups = groups.filter(
    (g) => !selectedGroups.some((s) => s.email === g.email),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Assign Learning Requirement</DialogTitle>
          {/* ── Moodle course badge / picker ──────────────────────────────── */}
          {activeMoodleCourse ? (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge className="gap-1.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-200 dark:border-blue-800">
                <BookOpen className="h-3 w-3" />
                Moodle Course
              </Badge>
              <span className="text-sm text-muted-foreground font-medium truncate">
                {activeMoodleCourse.fullname}
              </span>
              <a
                href={`https://enterprise.moodlecloud.com/course/view.php?id=${activeMoodleCourse.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
              >
                <ExternalLink className="h-3 w-3" />
                View course
              </a>
              {getCourseHours(activeMoodleCourse) && (
                <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200 border-amber-200 dark:border-amber-800">
                  <Clock className="h-3 w-3" />
                  {getCourseHours(activeMoodleCourse)} Hours
                </Badge>
              )}
              {/* Only allow clearing when not passed via prop */}
              {!moodleCourse && (
                <button
                  type="button"
                  onClick={() => { setInternalMoodleCourse(undefined); setMoodlePickerOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-foreground ml-1"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1.5 space-y-2">
              <p className="text-sm text-muted-foreground">
                Assign a learning requirement to everyone or a Google Workspace group.
              </p>
              {/* Moodle course picker — optional, only shown when no prop is passed */}
              {!moodleCourse && (
                <div>
                  <button
                    type="button"
                    onClick={() => { setMoodlePickerOpen((v) => !v); if (!moodlePickerOpen) loadMoodleCourses(); }}
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <BookOpen className="h-4 w-4" />
                    {moodlePickerOpen ? "Hide Moodle courses" : "+ Assign a Moodle course (optional)"}
                  </button>

                  {moodlePickerOpen && (
                    <div className="mt-2 border rounded-lg overflow-hidden">
                      {/* Search */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        <input
                          autoFocus
                          type="text"
                          value={moodleSearch}
                          onChange={(e) => setMoodleSearch(e.target.value)}
                          placeholder="Search courses…"
                          className="flex-1 bg-transparent text-sm outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => loadMoodleCourses(true)}
                          disabled={moodleLoading}
                          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title="Sync/Refresh Moodle courses"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${moodleLoading ? "animate-spin" : ""}`} />
                        </button>
                      </div>

                      {/* Course list */}
                      <div className="max-h-48 overflow-y-auto divide-y">
                        {moodleLoading ? (
                          <div className="py-6 text-center text-sm text-muted-foreground">Loading courses…</div>
                        ) : moodleCourses.filter((c) =>
                          c.fullname.toLowerCase().includes(moodleSearch.toLowerCase()) ||
                          (c.categoryname ?? "").toLowerCase().includes(moodleSearch.toLowerCase())
                        ).length === 0 ? (
                          <div className="py-6 text-center text-sm text-muted-foreground">No courses found</div>
                        ) : (
                          moodleCourses
                            .filter((c) =>
                              c.fullname.toLowerCase().includes(moodleSearch.toLowerCase()) ||
                              (c.categoryname ?? "").toLowerCase().includes(moodleSearch.toLowerCase())
                            )
                            .map((course) => (
                              <button
                                key={course.id}
                                type="button"
                                onClick={() => { setInternalMoodleCourse(course); setMoodlePickerOpen(false); }}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium">{course.fullname}</p>
                                    <div className="flex gap-1.5 items-center mt-0.5 text-xs text-muted-foreground flex-wrap">
                                      {course.categoryname && <span>{course.categoryname}</span>}
                                      {getCourseHours(course) && (
                                        <>
                                          <span>•</span>
                                          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-medium">
                                            <Clock className="h-3 w-3" /> {getCourseHours(course)} Hours
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                                    {course.enrolledusercount !== undefined && (
                                      <span className="text-xs text-blue-600 flex items-center gap-0.5">
                                        <Users className="h-3 w-3" />{course.enrolledusercount}
                                      </span>
                                    )}
                                    {(course.aerostack_assigned_count ?? 0) > 0 && (
                                      <span className="text-xs text-purple-600 flex items-center gap-0.5">
                                        <Layers className="h-3 w-3" />{course.aerostack_assigned_count}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-2">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="bulk-title">Title *</Label>
            <Input
              id="bulk-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Complete AWS SA Associate Certification"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="bulk-desc">Description</Label>
            <Textarea
              id="bulk-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to be accomplished and why it matters…"
              rows={3}
            />
            <p className="text-xs text-gray-500">
              Provide context so recipients understand the requirement clearly.
            </p>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 flex-wrap">
              Category *
              {activeMoodleCourse?.categoryname && (
                lockedCategory ? (
                  <span
                    title={`Auto-matched from Moodle category "${activeMoodleCourse.categoryname}" — cannot be changed`}
                    className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-normal"
                  >
                    <Lock className="h-3 w-3" /> Locked (Auto-matched: "{activeMoodleCourse.categoryname}")
                  </span>
                ) : (
                  <span
                    title={`Moodle category "${activeMoodleCourse.categoryname}" does not match our categories. Please select manually.`}
                    className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-normal"
                  >
                    <AlertTriangle className="h-3 w-3" /> Moodle category: "{activeMoodleCourse.categoryname}" (Select manually)
                  </span>
                )
              )}
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v)}
              disabled={!!lockedCategory}
            >
              <SelectTrigger className={`w-full h-auto py-2 overflow-hidden ${lockedCategory ? "opacity-70 cursor-not-allowed" : ""}`}>
                <SelectValue className="truncate text-left" />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" className="max-h-[200px] overflow-y-auto">
                 <SelectItem value="PRO-DEV" textValue="PRO-DEV">
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-sm">PRO-DEV</span>
                    <span className="text-xs text-muted-foreground">🌱 Professional development programs</span>
                  </div>
                </SelectItem>
                <SelectItem value="OAL" textValue="OAL">
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-sm">OAL</span>
                    <span className="text-xs text-muted-foreground">🎓 Organizational accredited learning programs</span>
                  </div>
                </SelectItem>
                <SelectItem value="ONBOARDING" textValue="ONBOARDING">
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-sm">ONBOARDING</span>
                    <span className="text-xs text-muted-foreground">📋 Onboarding tasks & compliance document requirements</span>
                  </div>
                </SelectItem>
                <SelectItem value="COMMS_FLUENCY" textValue="FLUENCY">
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-sm">FLUENCY</span>
                    <span className="text-xs text-muted-foreground">💬 Communication & domain fluency</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Choose the type of learning requirement
            </p>
          </div>

          {/* Priority + Target Date row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority *</Label>
              <Select
                value={String(priority)}
                onValueChange={(v) => setPriority(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">
                    <div className="flex items-center justify-between w-full">
                      <span>P1</span>
                      <span className="text-xs text-gray-500 ml-2">Critical</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="2">
                    <div className="flex items-center justify-between w-full">
                      <span>P2</span>
                      <span className="text-xs text-gray-500 ml-2">High</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="3">
                    <div className="flex items-center justify-between w-full">
                      <span>P3</span>
                      <span className="text-xs text-gray-500 ml-2">Medium</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="4">
                    <div className="flex items-center justify-between w-full">
                      <span>P4</span>
                      <span className="text-xs text-gray-500 ml-2">Low</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="5">
                    <div className="flex items-center justify-between w-full">
                      <span>P5</span>
                      <span className="text-xs text-gray-500 ml-2">Minimal</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                P1 = Highest priority, P5 = Lowest priority
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-target-date">Target Completion Date *</Label>
              <Input
                id="bulk-target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                required
              />
              <p className="text-xs text-gray-500">
                When should this be completed?
              </p>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags (optional)</Label>
            <TagInput value={tags} onChange={setTags} />
            <p className="text-xs text-gray-500">
              Add tags to organize and filter loops (e.g., revgen, channel/aws, q1-2026)
            </p>
          </div>

          {/* Assign To */}
          <div className="space-y-2">
            <Label>Assign To *</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAssignTo("everyone");
                  setSelectedGroups([]);
                  setRecipientEmails([]);
                }}
                className={`flex items-center justify-center gap-2 border rounded-md px-3 py-3 text-sm font-medium transition-colors ${assignTo === "everyone"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:bg-accent"
                  }`}
              >
                <Users className="h-4 w-4" />
                Everyone
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignTo("group");
                  setRecipientEmails([]);
                }}
                className={`flex items-center justify-center gap-2 border rounded-md px-3 py-3 text-sm font-medium transition-colors ${assignTo === "group"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:bg-accent"
                  }`}
              >
                <Building2 className="h-4 w-4" />
                Group / OU
              </button>
              <button
                type="button"
                onClick={() => {
                  setAssignTo("specific");
                  setSelectedGroups([]);
                }}
                className={`flex items-center justify-center gap-2 border rounded-md px-3 py-3 text-sm font-medium transition-colors ${assignTo === "specific"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:bg-accent"
                  }`}
              >
                <UserCheck className="h-4 w-4" />
                Individual
              </button>
            </div>
          </div>

          {/* Individual recipients */}
          {assignTo === "specific" && (
            <div className="space-y-2">
              <Label>Recipients</Label>
              <EmailTagInput
                value={recipientEmails}
                onChange={setRecipientEmails}
                placeholder="Search by email..."
                localPool={workspaceEmails}
              />
              <p className="text-xs text-gray-500">
                Search across Google Workspace, Deel, and platform users.
                <br />
                Add multiple people.
              </p>
            </div>
          )}

          {/* Group selection */}
          {assignTo === "group" && (
            <div className="space-y-2">
              <Label>Google Workspace Groups</Label>

              {selectedGroups.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedGroups.map((g) => (
                    <Badge
                      key={g.email}
                      variant="secondary"
                      className="pr-1 pl-2 py-1"
                    >
                      <span className="font-medium">{g.name}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {g.email}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-1 h-4 w-4 p-0 hover:bg-destructive/10 rounded-full"
                        onClick={() => removeGroup(g.email)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}

              <Select
                value=""
                onValueChange={addGroup}
                disabled={groupsLoading || availableGroups.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      groupsLoading
                        ? "Loading groups..."
                        : availableGroups.length === 0
                          ? groups.length === 0
                            ? "No groups available"
                            : "All groups added"
                          : "Add a group..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableGroups.map((g) => (
                    <SelectItem key={g.email} value={g.email}>
                      <span className="font-medium">{g.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {g.email}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                Members are resolved on submit. Users added to the group later
                will not auto-inherit this assignment.
              </p>
            </div>
          )}

          {assignTo === "everyone" && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                This will create a learning loop for every active user in the
                organization (Deel, platform users, and Google Workspace
                memberships, deduped). You'll be asked to confirm before it's
                sent.
              </p>
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting || loadingCount}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || loadingCount}>
              {loadingCount
                ? "Resolving..."
                : submitting
                  ? "Assigning..."
                  : "Next — Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
