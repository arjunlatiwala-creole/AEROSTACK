import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Video,
  FileText,
  Music,
  FileJson,
  Calendar,
  Clock,
  Download,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  FolderOpen,
  Filter,
  Shield,
  Eye,
  Lock,
  Unlock,
  Search,
  X,
  Upload,
  ClipboardPaste,
  Sparkles,
  Tag,
  Brain,
  ArrowUpDown,
  Play,
  Mail,
  UserCheck,
  AlertCircle,
  RefreshCw,
  Settings,
} from "lucide-react";
import { usePermissions } from "@/context/PermissionsContext";
import { useAuth } from "@/context/auth/AuthContext";
import { fetchAuthSession } from "aws-amplify/auth";

const TOOLS_API = import.meta.env.VITE_TOOLS_API_URL;

/* ─── Types ──────────────────────────────────────────────────────── */

interface RecordingFile {
  key: string;
  name: string;
  size: number;
  extension: string;
  type: string;
  last_modified: string;
  date_folder: string;
  time_folder: string;
}

interface Meeting {
  folder: string;
  meeting_name: string;
  meeting_id: string;
  dates: string[];
  latest_date: string;
  session_count: number;
  file_count: number;
  total_size_bytes: number;
  total_size_display: string;
  files: RecordingFile[];
  has_video: boolean;
  has_transcript: boolean;
  has_audio: boolean;
  classification?: Classification | null;
  attendee_record?: AttendeeRecord | null;
}

interface ClassificationFilter {
  id: string;
  confidence: number;
  reason: string;
}

interface Classification {
  filters: ClassificationFilter[];
  primary_filter: string;
  summary: string;
  enterprise_business_tags: string[];
  lens_tags: string[];
  dominant_phase: string;
  speakers: string[];
  key_topics: string[];
  loop_categories?: string[];
  pillars?: string[];
  classified_at?: string;
  has_transcript?: boolean;
  text_chars?: number;
}

/* ─── Aerostack Filter / LENS definitions ────────────────────────────── */

type AerostackFilter =
  | "all"
  | "aerostack"
  | "medpic"
  | "bant-c"
  | "ops"
  | "engineering"
  | "customer-story";

interface FilterDef {
  id: AerostackFilter;
  label: string;
  description: string;
  color: string;
  keywords: string[];
}

const Aerostack_FILTERS: FilterDef[] = [
  {
    id: "all",
    label: "All Recordings",
    description: "Unfiltered view of all meetings",
    color: "bg-gray-100 text-gray-700",
    keywords: [],
  },
  {
    id: "aerostack",
    label: "Aerostack",
    description: "Internal Aerostack platform loops, sprints, and standups",
    color: "bg-indigo-100 text-indigo-700",
    keywords: ["aerostack", "standup", "sprint", "loop", "retro", "internal", "platform", "enterprise"],
  },
  {
    id: "medpic",
    label: "MEDPIC",
    description: "Metrics, Economic Buyer, Decision Criteria/Process, Paper Process, Identify Pain, Champion",
    color: "bg-amber-100 text-amber-700",
    keywords: ["medpic", "metrics", "economic buyer", "decision", "champion", "pain", "paper process", "qualification"],
  },
  {
    id: "bant-c",
    label: "BANT-C",
    description: "Budget, Authority, Need, Timeline, Competition",
    color: "bg-rose-100 text-rose-700",
    keywords: ["bant", "budget", "authority", "need", "timeline", "competition", "discovery", "qualification"],
  },
  {
    id: "ops",
    label: "Ops",
    description: "Operations, delivery, project management, and process meetings",
    color: "bg-emerald-100 text-emerald-700",
    keywords: ["ops", "operations", "delivery", "project", "status", "weekly", "sync", "planning", "review"],
  },
  {
    id: "engineering",
    label: "Engineering",
    description: "Technical discussions, architecture, code reviews, and showcases",
    color: "bg-blue-100 text-blue-700",
    keywords: ["engineering", "technical", "architecture", "code review", "showcase", "deploy", "infra", "cdk", "lambda", "api"],
  },
  {
    id: "customer-story",
    label: "Customer Story",
    description: "Customer interviews, testimonials, case study material, and syndication",
    color: "bg-purple-100 text-purple-700",
    keywords: ["customer", "interview", "testimonial", "case study", "story", "feedback", "success", "reference"],
  },
];

/* ─── LENS Loop Phase definitions ───────────────────────────────── */

interface LoopPhase {
  phase: string;
  question: string;
  artefacts: string;
}

const LOOP_PHASES: LoopPhase[] = [
  { phase: "Projection", question: "What potential do we see?", artefacts: "Vision statement, hypothesis" },
  { phase: "Assertion", question: "What are we committing to?", artefacts: "Clear stake, non-negotiables" },
  { phase: "Focus", question: "Where will energy flow now?", artefacts: "Tasks, sprint blocks, owners" },
  { phase: "Feedback", question: "What is reality telling us?", artefacts: "Metrics, showcases, customer signal" },
  { phase: "Adaptation", question: "What must change or scale?", artefacts: "Pivot, amplify, or exit decision" },
];

/* ─── Access control ────────────────────────────────────────────── */

/* ─── Active player singleton (only one video plays at a time) ──── */
let activeVideoElement: HTMLVideoElement | null = null;

function canAccessRawBucket(givenRole: string): boolean {
  return givenRole === "Super-Admin" || givenRole === "Admin";
}

/* ─── API helpers ────────────────────────────────────────────────── */

async function fetchRecordings(): Promise<{ meetings: Meeting[]; count: number }> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings?action=list`);
  if (!res.ok) throw new Error(`Failed to fetch recordings: ${res.status}`);
  return res.json();
}

async function fetchPresignedUrl(key: string): Promise<string> {
  const res = await fetch(
    `${TOOLS_API}/zoom-recordings?action=presign&key=${encodeURIComponent(key)}`
  );
  if (!res.ok) throw new Error("Failed to get download URL");
  const data = await res.json();
  return data.url;
}

async function fetchStreamUrl(key: string): Promise<{ url: string; content_type: string }> {
  const res = await fetch(
    `${TOOLS_API}/zoom-recordings?action=stream&key=${encodeURIComponent(key)}`
  );
  if (!res.ok) throw new Error("Failed to get stream URL");
  return res.json();
}

interface ValidationError {
  code: string;
  message: string;
}

interface UnresolvedParticipant {
  name: string;
  email: string;
  reason: string;
}

interface InvitedUser {
  email: string;
  name: string;
  session_id: string;
  granted_at: string;
  source?: string;
}

interface AttendeeRecord {
  folder: string;
  locked: boolean;
  attendees: string[];   // lowercase email array
  host_email?: string;
  attendee_count?: number;
  locked_at?: string;
  topic?: string;
  session_rules?: {
    [date: string]: {
      locked: boolean;
      attendees: string[];
    };
  };
  invited_users?: InvitedUser[];
  validation_status?: "validated" | "unresolved";
  validation_errors?: ValidationError[];
  unresolved_participants?: UnresolvedParticipant[];
  validation_override?: boolean;
  bypass_reason?: string;
}


async function overrideAttendeeValidation(
  folder: string,
  validationStatus: "validated" | "unresolved",
  bypassReason: string,
  locked?: boolean
): Promise<AttendeeRecord> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "override_validation",
      folder,
      validation_status: validationStatus,
      bypass_reason: bypassReason,
      locked: locked
    }),
  });
  if (!res.ok) throw new Error(`Override validation failed: ${res.status}`);
  const data = await res.json();
  return data.attendee_record;
}


async function fetchAttendeeRecord(folder: string): Promise<AttendeeRecord> {
  const res = await fetch(
    `${TOOLS_API}/zoom-recordings?action=attendees&folder=${encodeURIComponent(folder)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch attendee record: ${res.status}`);
  return res.json();
}

async function syncAttendeeRecord(folder: string): Promise<AttendeeRecord> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sync_attendees",
      folder,
    }),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  const data = await res.json();
  return data.attendee_record;
}

async function syncAllAttendeeRecords(): Promise<{ message: string; synced_folders: string[]; failed_folders: any[] }> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sync_all_attendees",
    }),
  });
  if (!res.ok) throw new Error(`Sync all failed: ${res.status}`);
  return res.json();
}

async function grantAttendeeAccess(folder: string, email: string, sessionId: string = "all"): Promise<AttendeeRecord> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "grant_access",
      folder,
      email,
      session_id: sessionId,
    }),
  });
  if (!res.ok) throw new Error(`Grant access failed: ${res.status}`);
  const data = await res.json();
  return data.attendee_record;
}

async function revokeAttendeeAccess(folder: string, email: string, sessionId: string = "all"): Promise<AttendeeRecord> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "revoke_access",
      folder,
      email,
      session_id: sessionId,
    }),
  });
  if (!res.ok) throw new Error(`Revoke access failed: ${res.status}`);
  const data = await res.json();
  return data.attendee_record;
}

async function sendAccessRequest(
  folder: string,
  requesterEmail: string,
  requesterName: string
): Promise<{ status: string; recipients: string[] }> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "request_access",
      folder,
      requester_email: requesterEmail,
      requester_name: requesterName,
    }),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function classifyText(
  title: string,
  text: string,
  sourceType: string = "auto"
): Promise<Classification> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "classify_text", title, text, source_type: sourceType }),
  });
  if (!res.ok) throw new Error(`Classification failed: ${res.status}`);
  const data = await res.json();
  return data.classification;
}

async function classifyMeeting(folder: string, force = false): Promise<Classification> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "classify", folder, force }),
  });
  if (!res.ok) throw new Error(`Classification failed: ${res.status}`);
  const data = await res.json();
  return data.classification;
}

interface ZoomMeeting {
  id: string;
  uuid: string;
  topic: string;
  start_time: string;
  duration: number;
  total_size: number;
  recording_count: number;
  recording_files: {
    id: string;
    file_type: string;
    file_extension: string;
    recording_type: string;
    status: string;
    file_size: number;
    recording_start: string;
  }[];
}

async function listZoomMeetings(): Promise<{ meetings: ZoomMeeting[]; count: number }> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list_zoom_meetings" }),
  });
  if (!res.ok) throw new Error(`Failed to list Zoom meetings: ${res.status}`);
  return res.json();
}

async function retrieveMeeting(meetingId: string): Promise<{ folder: string; files_stored: number; files_failed: number }> {
  const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retrieve_meeting", meeting_id: meetingId }),
  });
  if (!res.ok) throw new Error(`Retrieval failed: ${res.status}`);
  return res.json();
}

/* ─── Utilities ──────────────────────────────────────────────────── */

const FILE_ICONS: Record<string, typeof Video> = {
  video: Video,
  audio: Music,
  transcript: FileText,
  metadata: FileJson,
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Returns true if the string looks like a date (YYYY-MM-DD) */
function isDateString(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function matchesFilter(meeting: Meeting, filter: FilterDef): boolean {
  if (filter.id === "all") return true;
  // Use Bedrock classification if available
  if (meeting.classification) {
    const classifiedIds = meeting.classification.filters.map((f) => f.id);
    return classifiedIds.includes(filter.id);
  }
  // Fallback to keyword matching on title
  const name = meeting.meeting_name.toLowerCase();
  return filter.keywords.some((kw) => name.includes(kw));
}

/* ─── Sub-components ─────────────────────────────────────────────── */

/* ─── Attendee Gate ──────────────────────────────────────────────── */

function AttendeeGate({
  folder,
  meetingName,
  userEmail,
  userName,
}: {
  folder: string;
  meetingName: string;
  userEmail: string;
  userName: string;
}) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleRequest = async () => {
    setSending(true);
    setError("");
    try {
      await sendAccessRequest(folder, userEmail, userName);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <UserCheck className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-800">Request Sent!</p>
          <p className="text-xs text-emerald-600">
            The meeting host and Aerostack admin have been notified. You'll receive access once approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Lock banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <Lock className="h-4 w-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Recording Access Restricted
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            This recording is only available to verified meeting attendees.
            You were not listed as a participant.
          </p>
          {error && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="h-3 w-3" />
              {error}
            </p>
          )}
        </div>
        <button
          id={`request-access-${folder.replace(/[^a-z0-9]/gi, "-")}`}
          onClick={handleRequest}
          disabled={sending}
          className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-700 disabled:opacity-60"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mail className="h-3.5 w-3.5" />
          )}
          {sending ? "Sending…" : "Request Access"}
        </button>
      </div>
    </div>
  );
}


function FileRow({ file, canDownload, siblingFiles }: { file: RecordingFile; canDownload: boolean; siblingFiles?: RecordingFile[] }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamContentType, setStreamContentType] = useState<string>("");
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const Icon = FILE_ICONS[file.type] || FileJson;

  const isMediaPreview = file.type === "video" || file.type === "audio";
  const isTextPreview =
    file.type === "transcript" ||
    file.type === "metadata" ||
    ["txt", "json", "vtt", "srt"].includes(file.extension);
  const isPreviewable = isMediaPreview || isTextPreview;
  const isOpen = streamUrl !== null || textContent !== null;

  const handleDownload = async () => {
    if (!canDownload) return;
    setIsDownloading(true);
    try {
      const url = await fetchPresignedUrl(file.key);
      window.open(url, "_blank");
    } catch (err) {
      console.error("Download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePreview = async () => {
    if (!canDownload) return;
    if (isOpen) {
      setStreamUrl(null);
      setCaptionUrl(null);
      setTextContent(null);
      return;
    }
    setIsLoadingPreview(true);
    try {
      if (isMediaPreview) {
        const { url, content_type } = await fetchStreamUrl(file.key);
        setStreamUrl(url);
        setStreamContentType(content_type);

        // Load sibling VTT transcript as captions for video only
        if (file.type === "video") {
          const transcriptFile = siblingFiles?.find(
            (f) => f.type === "transcript" && f.extension === "vtt"
          );
          if (transcriptFile) {
            const vttRes = await fetch(
              `${TOOLS_API}/zoom-recordings?action=vtt&key=${encodeURIComponent(transcriptFile.key)}`
            );
            if (vttRes.ok) {
              const vttText = await vttRes.text();
              const blob = new Blob([vttText], { type: "text/vtt" });
              setCaptionUrl(URL.createObjectURL(blob));
            }
          }
        }
      } else if (isTextPreview) {
        const res = await fetch(
          `${TOOLS_API}/zoom-recordings?action=text&key=${encodeURIComponent(file.key)}`
        );
        if (!res.ok) throw new Error(`Failed to load preview: ${res.status}`);
        let content = await res.text();
        // Pretty-print JSON
        if (file.extension === "json") {
          try {
            content = JSON.stringify(JSON.parse(content), null, 2);
          } catch {
            // Leave content as-is if it's not valid JSON
          }
        }
        setTextContent(content);
      }
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const typeColors: Record<string, string> = {
    video: "bg-blue-100 text-blue-700",
    audio: "bg-purple-100 text-purple-700",
    transcript: "bg-green-100 text-green-700",
    metadata: "bg-gray-100 text-gray-600",
    other: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="py-2 px-3 hover:bg-gray-50 rounded-lg group">
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColors[file.type] || typeColors.other}`}>
              {file.type}
            </span>
            <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
            {file.time_folder && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {file.time_folder}
              </span>
            )}
            {!file.time_folder && file.last_modified && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(file.last_modified).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
        </div>
        {canDownload ? (
          <div className="flex items-center gap-1">
            {isPreviewable && (
              <button
                onClick={handlePreview}
                disabled={isLoadingPreview}
                className={`opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md ${
                  isOpen
                    ? "bg-red-50 hover:bg-red-100 text-red-600"
                    : file.type === "video"
                    ? "hover:bg-blue-100 text-blue-600"
                    : file.type === "audio"
                    ? "hover:bg-purple-100 text-purple-600"
                    : "hover:bg-gray-200 text-gray-600"
                }`}
                title={
                  isOpen
                    ? "Close preview"
                    : file.type === "video"
                    ? "Play video"
                    : file.type === "audio"
                    ? "Play audio"
                    : "Preview"
                }
              >
                {isLoadingPreview ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isOpen ? (
                  <X className="w-4 h-4" />
                ) : file.type === "video" ? (
                  <Play className="w-4 h-4" />
                ) : file.type === "audio" ? (
                  <Music className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            )}
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-200 text-gray-500"
              title="Download / Open"
            >
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <Lock className="w-4 h-4 text-gray-300" />
        )}
      </div>
      {streamUrl && file.type === "video" && (
        <div className="mt-2 ml-7 rounded-lg overflow-hidden bg-black">
          <video
            controls
            autoPlay
            className="w-full max-h-[400px]"
            src={streamUrl}
            onPlay={(e) => {
              const vid = e.currentTarget;
              if (activeVideoElement && activeVideoElement !== vid) {
                activeVideoElement.pause();
              }
              activeVideoElement = vid;
            }}
          >
            <source src={streamUrl} type={streamContentType} />
            {captionUrl && (
              <track
                kind="captions"
                src={captionUrl}
                srcLang="en"
                label="English"
              />
            )}
            Your browser does not support video playback.
          </video>
        </div>
      )}
      {streamUrl && file.type === "audio" && (
        <div className="mt-2 ml-7 rounded-lg overflow-hidden bg-gray-50 p-3">
          <audio
            controls
            autoPlay
            className="w-full"
            src={streamUrl}
          >
            <source src={streamUrl} type={streamContentType} />
            Your browser does not support audio playback.
          </audio>
        </div>
      )}
      {textContent !== null && (
        <div className="mt-2 ml-7 rounded-lg border border-gray-200 bg-gray-50">
          <pre className="p-3 max-h-[400px] overflow-auto text-xs text-gray-800 font-mono whitespace-pre-wrap break-words">
            {textContent}
          </pre>
        </div>
      )}
    </div>
  );
}

function DateGroup({ date, files, canDownload }: { date: string; files: RecordingFile[]; canDownload: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const videos = files.filter((f) => f.type === "video");
  const transcripts = files.filter((f) => f.type === "transcript");
  const others = files.filter((f) => f.type !== "video" && f.type !== "transcript");

  // For non-date groups, derive a display label from the file's last_modified
  let dateLabel: string;
  let isMetadataGroup = false;
  if (isDateString(date)) {
    dateLabel = formatDate(date);
  } else if (date === "other") {
    dateLabel = "Other files";
  } else {
    // It's a filename like meeting_summary_*.json — show as Metadata
    isMetadataGroup = true;
    const firstFile = files[0];
    if (firstFile?.last_modified) {
      const d = new Date(firstFile.last_modified);
      dateLabel = isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } else {
      dateLabel = "";
    }
  }

  return (
    <div className="border-l-2 border-gray-200 pl-4 ml-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 w-full"
      >
        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {isMetadataGroup ? (
          <FileJson className="w-4 h-4 text-gray-400" />
        ) : (
          <Calendar className="w-4 h-4 text-gray-400" />
        )}
        {isMetadataGroup && (
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">metadata</span>
        )}
        <span>{dateLabel}</span>
        <span className="text-xs text-gray-400 ml-auto">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </button>
      {isOpen && (
        <div className="mt-1 space-y-0.5">
          {videos.map((f) => <FileRow key={f.key} file={f} canDownload={canDownload} siblingFiles={files} />)}
          {transcripts.map((f) => <FileRow key={f.key} file={f} canDownload={canDownload} />)}
          {others.map((f) => <FileRow key={f.key} file={f} canDownload={canDownload} />)}
        </div>
      )}
    </div>
  );
}

function MeetingCard({
  meeting,
  canDownload,
  sortOrder,
  userEmail,
  userName,
  bypassAttendeeGate,
}: {
  meeting: Meeting;
  canDownload: boolean;
  sortOrder: "newest" | "oldest";
  userEmail: string;
  userName: string;
  bypassAttendeeGate: boolean;   // true for Admin / Super-Admin
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [localClassification, setLocalClassification] = useState<Classification | null>(
    meeting.classification || null
  );

  // Attendee-gate state — loaded lazily when the card is first expanded
  const [attendeeRecord, setAttendeeRecord] = useState<AttendeeRecord | null>(
    meeting.attendee_record || null
  );
  const [attendeeLoading, setAttendeeLoading] = useState(false);
  const attendeeFetched = useState(!!meeting.attendee_record);
  const fetchedRef = attendeeFetched;

  const [syncMessage, setSyncMessage] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [targetSession, setTargetSession] = useState("all");
  const [isGranting, setIsGranting] = useState(false);
  const [showInvitedList, setShowInvitedList] = useState(false);
  const [showSessionsList, setShowSessionsList] = useState(false);
  const [showManualList, setShowManualList] = useState(false);
  const [isSyncingMeeting, setIsSyncingMeeting] = useState(false);

  const handleSyncMeeting = async () => {
    setIsSyncingMeeting(true);
    setSyncMessage("");
    try {
      const updated = await syncAttendeeRecord(meeting.folder);
      setAttendeeRecord(updated);
      setSyncMessage("Attendees synced successfully!");
      setTimeout(() => setSyncMessage(""), 4000);
    } catch (err) {
      console.error(err);
      setSyncMessage("Failed to sync attendees");
      setTimeout(() => setSyncMessage(""), 4000);
    } finally {
      setIsSyncingMeeting(false);
    }
  };

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToGrant = grantEmail.trim().toLowerCase();
    if (!emailToGrant) return;

    setIsGranting(true);
    setSyncMessage("");
    try {
      const updated = await grantAttendeeAccess(meeting.folder, emailToGrant, targetSession);
      setAttendeeRecord(updated);
      setGrantEmail("");
      setSyncMessage(`Access granted to ${emailToGrant} (${targetSession === "all" ? "all sessions" : "session " + targetSession})!`);
      setTimeout(() => setSyncMessage(""), 4000);
    } catch (err) {
      console.error(err);
      setSyncMessage("Failed to grant access");
    } finally {
      setIsGranting(false);
    }
  };

  const [isRevokingEmail, setIsRevokingEmail] = useState<string | null>(null);

  const handleRevokeAccess = async (email: string, sessionId: string) => {
    setIsRevokingEmail(`${email}_${sessionId}`);
    setSyncMessage("");
    try {
      const updated = await revokeAttendeeAccess(meeting.folder, email, sessionId);
      setAttendeeRecord(updated);
      setSyncMessage(`Access revoked for ${email}!`);
      setTimeout(() => setSyncMessage(""), 4000);
    } catch (err) {
      console.error(err);
      setSyncMessage("Failed to revoke access");
    } finally {
      setIsRevokingEmail(null);
    }
  };



  const handleToggle = async () => {
    const next = !isExpanded;
    setIsExpanded(next);

    // Lazy-load attendee record on first expand
    if (next && !fetchedRef[0]) {
      fetchedRef[1](true);
      setAttendeeLoading(true);
      try {
        const rec = await fetchAttendeeRecord(meeting.folder);
        setAttendeeRecord(rec);
      } catch (err) {
        console.warn("Could not fetch attendee record:", err);
        // On error or missing file, treat as restricted (fail-closed)
        setAttendeeRecord({ folder: meeting.folder, locked: true, attendees: [] });
      } finally {
        setAttendeeLoading(false);
      }
    }
  };

  const currentRecord = attendeeRecord || meeting.attendee_record;
  const isGated = currentRecord?.locked ?? true;

  const hasAccessToSession = useCallback((date: string) => {
    if (bypassAttendeeGate) return true;
    if (!currentRecord) return false; // Fail-closed (restricted)
    if (!currentRecord.locked) return true;
    
    // Check card-level permission
    if (currentRecord.attendees.includes(userEmail.toLowerCase())) return true;
    
    // Check session-specific override permission
    const sessionRule = currentRecord.session_rules?.[date];
    if (sessionRule && sessionRule.attendees.includes(userEmail.toLowerCase())) return true;
    
    return false;
  }, [currentRecord, userEmail, bypassAttendeeGate]);

  const isAttendee = useMemo(() => {
    if (bypassAttendeeGate) return true;
    if (!currentRecord) return false; // Fail-closed (restricted)
    if (!currentRecord.locked) return true;

    // Has card-level access
    if (currentRecord.attendees.includes(userEmail.toLowerCase())) return true;

    // Has access to at least one session
    if (currentRecord.session_rules) {
      return Object.keys(currentRecord.session_rules).some((date) =>
        currentRecord.session_rules![date].attendees.includes(userEmail.toLowerCase())
      );
    }

    return false;
  }, [currentRecord, userEmail, bypassAttendeeGate]);


  const handleClassify = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsClassifying(true);
    try {
      const result = await classifyMeeting(meeting.folder, true);
      setLocalClassification(result);
    } catch (err) {
      console.error("Classification error:", err);
    } finally {
      setIsClassifying(false);
    }
  };


  const cls = localClassification;

  const filesByDate: Record<string, RecordingFile[]> = {};
  for (const f of meeting.files) {
    const d = f.date_folder || "other";
    if (!filesByDate[d]) filesByDate[d] = [];
    filesByDate[d].push(f);
  }
  // Sort: metadata groups always first, then date folders sorted by sortOrder
  const sortedDates = Object.keys(filesByDate).sort((a, b) => {
    const aIsDate = isDateString(a);
    const bIsDate = isDateString(b);
    // Non-date groups (metadata) always come first
    if (!aIsDate && !bIsDate) return a.localeCompare(b);
    if (!aIsDate) return -1;
    if (!bIsDate) return 1;
    // Date groups sorted by sortOrder
    return sortOrder === "newest" ? b.localeCompare(a) : a.localeCompare(b);
  });

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow">
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); } }}
        className="w-full p-4 flex items-start gap-4 text-left cursor-pointer"
      >
        <div className="p-2.5 bg-blue-50 rounded-lg shrink-0">
          <Video className="w-5 h-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 truncate">{meeting.meeting_name}</h3>
            {isGated && (
              isAttendee ? (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                  <Unlock className="w-2.5 h-2.5" /> Gated
                </span>
              ) : (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                  <Lock className="w-2.5 h-2.5" /> Gated
                </span>
              )
            )}

          </div>
          <div className="flex items-center gap-2 mt-1">
            <Calendar className="w-4 h-4 text-blue-500" />
            {(() => {
              const validDates = meeting.dates.filter(isDateString);
              if (validDates.length > 1) {
                const sorted = [...validDates].sort();
                const first = sorted[0];
                const last = sorted[sorted.length - 1];
                return (
                  <span className="text-sm font-medium text-gray-700">
                    {sortOrder === "newest"
                      ? `${formatDate(last)} — ${formatDate(first)}`
                      : `${formatDate(first)} — ${formatDate(last)}`}
                  </span>
                );
              }
              if (validDates.length === 1) {
                return <span className="text-sm font-medium text-gray-700">{formatDate(validDates[0])}</span>;
              }
              // Fallback: derive from file last_modified
              const firstModified = meeting.files.find((f) => f.last_modified)?.last_modified;
              if (firstModified) {
                const d = new Date(firstModified);
                return (
                  <span className="text-sm font-medium text-gray-700">
                    {d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </span>
                );
              }
              return <span className="text-sm text-gray-400">No date</span>;
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
            {meeting.meeting_id && (
              <span className="text-xs text-gray-400 font-mono">ID: {meeting.meeting_id}</span>
            )}
            <span className="text-xs text-gray-500">
              {meeting.session_count} session{meeting.session_count !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              {meeting.total_size_display}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {meeting.has_video && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">Video</span>
            )}
            {meeting.has_transcript && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">Transcript</span>
            )}
            {meeting.has_audio && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">Audio</span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">
              {meeting.file_count} files
            </span>
            {cls && cls.filters.length > 0 && cls.filters.map((f) => {
              const def = Aerostack_FILTERS.find((af) => af.id === f.id);
              return (
                <span
                  key={f.id}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${def?.color || "bg-gray-100 text-gray-600"}`}
                  title={`${f.reason} (${Math.round(f.confidence * 100)}%)`}
                >
                  {def?.label || f.id}
                </span>
              );
            })}
            {!cls && (
              <button
                onClick={handleClassify}
                disabled={isClassifying}
                className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium hover:bg-indigo-100 flex items-center gap-1"
              >
                {isClassifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Classify
              </button>
            )}
          </div>
          {cls && cls.enterprise_business_tags && cls.enterprise_business_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {cls.enterprise_business_tags.slice(0, 8).map((tag) => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 mt-1">
          {isExpanded ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {/* Attendee gate loading */}
          {attendeeLoading && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking meeting access…
            </div>
          )}

          {/* Non-attendee gate */}
          {!attendeeLoading && !isAttendee && (
            <AttendeeGate
              folder={meeting.folder}
              meetingName={meeting.meeting_name}
              userEmail={userEmail}
              userName={userName}
            />
          )}

          {/* Admin Access Control Panel */}
          {bypassAttendeeGate && attendeeRecord && !attendeeLoading && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-2">
              <div className="flex items-center justify-between pb-1 border-b border-gray-200/50">
                <span className="font-semibold text-gray-750">Access Control (Admin Only)</span>
                <button
                  type="button"
                  onClick={handleSyncMeeting}
                  disabled={isSyncingMeeting}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50/50 border border-blue-100 hover:bg-blue-50 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSyncingMeeting ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-2.5 h-2.5" />
                  )}
                  {isSyncingMeeting ? "Syncing..." : "Sync Attendees"}
                </button>
              </div>
              <div className="text-gray-600 space-y-1">
                <p>Status: {attendeeRecord.locked ? <span className="text-amber-600 font-semibold">Gated (Restricted)</span> : <span className="text-gray-500 font-semibold">Open (Unrestricted)</span>}</p>
                {attendeeRecord.host_email && <p>Host: <span className="font-mono">{attendeeRecord.host_email}</span></p>}
                <p>Attendee Count: <span className="font-semibold">{attendeeRecord.attendee_count ?? attendeeRecord.attendees.length}</span></p>
                {attendeeRecord.attendees.length > 0 && (
                  <p className="text-gray-500 text-[10px] break-all max-w-full">
                    All Sessions: {attendeeRecord.attendees.join(", ")}
                  </p>
                )}
                {attendeeRecord.session_rules && Object.keys(attendeeRecord.session_rules).some(date => attendeeRecord.session_rules![date].attendees?.length > 0) && (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setShowSessionsList(!showSessionsList)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-700 cursor-pointer focus:outline-none"
                    >
                      {showSessionsList ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span>Individual Sessions ({Object.keys(attendeeRecord.session_rules).filter(date => attendeeRecord.session_rules![date].attendees?.length > 0).length})</span>
                    </button>
                    {showSessionsList && (
                      <div className="mt-1 space-y-1 pl-1">
                        {Object.keys(attendeeRecord.session_rules).map((date) => {
                          const rule = attendeeRecord.session_rules![date];
                          if (!rule.attendees || rule.attendees.length === 0) return null;
                          return (
                            <p key={date} className="text-gray-500 text-[10px] break-all max-w-full">
                              Session ({isDateString(date) ? formatDate(date) : date}) Only: {rule.attendees.join(", ")}
                            </p>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {attendeeRecord.invited_users && attendeeRecord.invited_users.length > 0 && (() => {
                  const invitedList = attendeeRecord.invited_users || [];
                  const zoomInvitedUsers = invitedList.filter(u => u.source !== "admin_invite");
                  const manualInvitedUsers = invitedList.filter(u => u.source === "admin_invite");

                  return (
                    <>
                      {/* Invited / Alternative Hosts (Zoom source) */}
                      {zoomInvitedUsers.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-200/50">
                          <button
                            type="button"
                            onClick={() => setShowInvitedList(!showInvitedList)}
                            className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900 cursor-pointer focus:outline-none"
                          >
                            {showInvitedList ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            <span>Invited / Alternative Hosts ({zoomInvitedUsers.length})</span>
                          </button>
                          {showInvitedList && (
                            <div className="space-y-0.5 mt-1.5 text-[10px] text-gray-500 pl-1">
                              {zoomInvitedUsers.map((user, idx) => (
                                <div key={idx} className="flex items-center justify-between py-0.5 border-b border-gray-100/50 last:border-0 hover:bg-gray-100/40 px-1 rounded">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-medium text-gray-700 truncate">{user.email}</span>
                                    {user.name && <span className="text-gray-400 truncate">({user.name})</span>}
                                    <span className="text-gray-400 shrink-0">
                                      • {user.session_id === "all" ? "All" : (isDateString(user.session_id) ? formatDate(user.session_id) : user.session_id)}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeAccess(user.email, user.session_id || "all")}
                                    disabled={isRevokingEmail === `${user.email}_${user.session_id || "all"}`}
                                    className="text-red-500 hover:text-red-700 font-semibold transition-colors disabled:opacity-50 cursor-pointer shrink-0 ml-2"
                                  >
                                    {isRevokingEmail === `${user.email}_${user.session_id || "all"}` ? "..." : "Revoke"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Manual Access (Admin invited source) */}
                      {manualInvitedUsers.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-200/50">
                          <button
                            type="button"
                            onClick={() => setShowManualList(!showManualList)}
                            className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900 cursor-pointer focus:outline-none"
                          >
                            {showManualList ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            <span>Manual Access ({manualInvitedUsers.length})</span>
                          </button>
                          {showManualList && (
                            <div className="space-y-0.5 mt-1.5 text-[10px] text-gray-500 pl-1">
                              {manualInvitedUsers.map((user, idx) => (
                                <div key={idx} className="flex items-center justify-between py-0.5 border-b border-gray-100/50 last:border-0 hover:bg-gray-100/40 px-1 rounded">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-medium text-gray-700 truncate">{user.email}</span>
                                    {user.name && <span className="text-gray-400 truncate">({user.name})</span>}
                                    <span className="text-gray-400 shrink-0">
                                      • {user.session_id === "all" ? "All" : (isDateString(user.session_id) ? formatDate(user.session_id) : user.session_id)}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeAccess(user.email, user.session_id || "all")}
                                    disabled={isRevokingEmail === `${user.email}_${user.session_id || "all"}`}
                                    className="text-red-500 hover:text-red-700 font-semibold transition-colors disabled:opacity-50 cursor-pointer shrink-0 ml-2"
                                  >
                                    {isRevokingEmail === `${user.email}_${user.session_id || "all"}` ? "..." : "Revoke"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <form onSubmit={handleGrantAccess} className="flex gap-1.5 pt-2 border-t border-gray-200/50 mt-1.5">
                <input
                  type="email"
                  placeholder="Grant access to email..."
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  disabled={isGranting}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-75 text-gray-700"
                  required
                />
                <select
                  value={targetSession}
                  onChange={(e) => setTargetSession(e.target.value)}
                  disabled={isGranting}
                  className="px-2 py-1 border border-gray-300 rounded text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-75 text-gray-700 max-w-[130px]"
                >
                  <option value="all">All Sessions</option>
                  {meeting.dates.map((d) => (
                    <option key={d} value={d}>
                      {isDateString(d) ? formatDate(d) : d}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={isGranting || !grantEmail}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-sm text-[11px] shrink-0"
                >
                  {isGranting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : null}
                  Grant
                </button>
              </form>
              {syncMessage && (
                <p className={`text-[10px] font-medium ${syncMessage.includes("Failed") ? "text-red-600" : "text-emerald-600"}`}>
                  {syncMessage}
                </p>
              )}


            </div>
          )}

          {/* Attendee: show files */}
          {!attendeeLoading && isAttendee && (
            <>
              {sortedDates.map((date) => {
                const hasSessionAccess = hasAccessToSession(date);
                if (!hasSessionAccess) return null;
                return (
                  <DateGroup key={date} date={date} files={filesByDate[date]} canDownload={canDownload || hasSessionAccess} />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── LENS Loop Phase Reference ──────────────────────────────────── */

function LoopPhaseReference() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Aerostack Loop Phases (LENS)</span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-3 font-semibold text-gray-500">Phase</th>
                <th className="text-left py-2 pr-3 font-semibold text-gray-500">Guiding Question</th>
                <th className="text-left py-2 font-semibold text-gray-500">Typical Artefacts</th>
              </tr>
            </thead>
            <tbody>
              {LOOP_PHASES.map((lp) => (
                <tr key={lp.phase} className="border-b border-gray-50">
                  <td className="py-2 pr-3 font-medium text-indigo-600">{lp.phase}</td>
                  <td className="py-2 pr-3 text-gray-600">{lp.question}</td>
                  <td className="py-2 text-gray-500">{lp.artefacts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-2 italic">
            Loops recycle until objectives converge or are purposefully closed.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Zoom Retrieval Panel ────────────────────────────────────────── */

function ZoomRetrievalPanel({ onRetrieved }: { onRetrieved: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoomMeetings, setZoomMeetings] = useState<ZoomMeeting[]>([]);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [retrievingIds, setRetrievingIds] = useState<Set<string>>(new Set());
  const [retrievedIds, setRetrievedIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState("");
  const [batchStatus, setBatchStatus] = useState<{
    running: boolean;
    result: { total_found: number; retrieved: number; failed: number; months_scanned: number; users_scanned?: number } | null;
    error: string;
  }>({ running: false, result: null, error: "" });
  const [batchMonths, setBatchMonths] = useState(6);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncAllMessage, setSyncAllMessage] = useState("");

  const handleSyncAllAttendees = async () => {
    setIsSyncingAll(true);
    setSyncAllMessage("");
    try {
      const res = await syncAllAttendeeRecords();
      setSyncAllMessage(res.message || "All attendees synced successfully!");
      onRetrieved();
      setTimeout(() => setSyncAllMessage(""), 5000);
    } catch (err) {
      console.error(err);
      setSyncAllMessage("Failed to sync all attendees");
      setTimeout(() => setSyncAllMessage(""), 5000);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleLoadMeetings = async () => {
    setIsLoadingMeetings(true);
    setLoadError("");
    try {
      const data = await listZoomMeetings();
      setZoomMeetings(data.meetings);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setIsLoadingMeetings(false);
    }
  };

  const handleRetrieve = async (meetingId: string) => {
    setRetrievingIds((prev) => new Set(prev).add(meetingId));
    try {
      await retrieveMeeting(meetingId);
      setRetrievedIds((prev) => new Set(prev).add(meetingId));
      onRetrieved();
    } catch (err) {
      console.error("Retrieval error:", err);
    } finally {
      setRetrievingIds((prev) => {
        const next = new Set(prev);
        next.delete(meetingId);
        return next;
      });
    }
  };

  const handleRetrieveAll = async () => {
    for (const m of zoomMeetings) {
      if (!retrievedIds.has(String(m.id))) {
        await handleRetrieve(String(m.id));
      }
    }
  };

  const handleBatchRetrieveAll = async () => {
    setBatchStatus({ running: true, result: null, error: "" });
    try {
      const res = await fetch(`${TOOLS_API}/zoom-recordings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch_retrieve_all", months_back: batchMonths }),
      });
      if (!res.ok) throw new Error(`Batch failed: ${res.status}`);
      const data = await res.json();

      // If async (202), poll batch_status until completed
      if (data.status === "started") {
        const pollInterval = 5000; // 5 seconds
        const maxPolls = 120; // 10 minutes max
        let polls = 0;

        while (polls < maxPolls) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          polls++;

          try {
            const statusRes = await fetch(`${TOOLS_API}/zoom-recordings`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "batch_status" }),
            });
            if (!statusRes.ok) continue;
            const statusData = await statusRes.json();

            if (statusData.status === "completed") {
              setBatchStatus({ running: false, result: statusData, error: "" });
              onRetrieved();
              return;
            }
            // Still running — keep polling
          } catch {
            // Network blip — keep trying
          }
        }

        // Timed out polling
        setBatchStatus({ running: false, result: null, error: "Batch job is still running. Check back shortly." });
      } else {
        // Synchronous response (shouldn't happen normally but handle it)
        setBatchStatus({ running: false, result: data, error: "" });
        onRetrieved();
      }
    } catch (err) {
      setBatchStatus({ running: false, result: null, error: (err as Error).message });
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">Retrieve from Zoom</span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500">
            Pull recordings from Zoom cloud (last 30 days) and store them in S3 for Aerostack access.
          </p>

          {/* Batch retrieve all */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <p className="text-xs font-medium text-amber-800">
              Batch Retrieve — pull ALL recordings from Zoom (skips already stored)
            </p>
            <div className="flex items-center gap-2">
              <select
                value={batchMonths}
                onChange={(e) => setBatchMonths(Number(e.target.value))}
                className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
              >
                {[1, 2, 3, 6, 9, 12].map((n) => (
                  <option key={n} value={n}>
                    Last {n} month{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBatchRetrieveAll}
                disabled={batchStatus.running}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {batchStatus.running ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {batchStatus.running ? "Retrieving..." : "Batch Retrieve All"}
              </button>
            </div>
            {batchStatus.running && (
              <p className="text-xs text-amber-600">
                This may take several minutes depending on how many recordings exist. Do not close this page.
              </p>
            )}
            {batchStatus.result && (
              <div className="text-xs text-amber-800 space-y-1">
                <p>
                  Scanned {batchStatus.result.months_scanned} months — found {batchStatus.result.total_found} new meetings
                </p>
                <p>
                  Retrieved: {batchStatus.result.retrieved} | Failed: {batchStatus.result.failed}
                </p>
              </div>
            )}
            {batchStatus.error && (
              <p className="text-xs text-red-600">{batchStatus.error}</p>
            )}
          </div>

          {/* Batch sync attendees commented out
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <p className="text-xs font-medium text-blue-800">
              Batch Sync Attendees — sync &amp; validate attendees/invitees across all stored recordings
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncAllAttendees}
                disabled={isSyncingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
              >
                {isSyncingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {isSyncingAll ? "Syncing..." : "Sync Attendees"}
              </button>
            </div>
            {syncAllMessage && (
              <p className={`text-xs font-medium ${syncAllMessage.includes("Failed") ? "text-red-600" : "text-emerald-700"}`}>
                {syncAllMessage}
              </p>
            )}
          </div>
          */}

          <hr className="border-gray-200" />

          {/* Manual: list + retrieve individual */}
          <p className="text-xs text-gray-500">
            Or browse and retrieve individual meetings from the last 30 days:
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadMeetings}
              disabled={isLoadingMeetings}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoadingMeetings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              List Zoom Recordings
            </button>
            {zoomMeetings.length > 0 && (
              <button
                onClick={handleRetrieveAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
              >
                <Download className="w-3.5 h-3.5" />
                Retrieve All ({zoomMeetings.length - retrievedIds.size} remaining)
              </button>
            )}
          </div>

          {loadError && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{loadError}</div>
          )}

          {zoomMeetings.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {zoomMeetings.map((m) => {
                const mid = String(m.id);
                const isRetrieving = retrievingIds.has(mid);
                const isRetrieved = retrievedIds.has(mid);
                const totalMB = m.total_size ? (m.total_size / (1024 * 1024)).toFixed(1) : "?";

                return (
                  <div
                    key={mid}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      isRetrieved ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"
                    }`}
                  >
                    <Video className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{m.topic}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-400">
                          {m.start_time ? new Date(m.start_time).toLocaleDateString() : ""}
                        </span>
                        <span className="text-xs text-gray-400">{m.duration}min</span>
                        <span className="text-xs text-gray-400">{totalMB} MB</span>
                        <span className="text-xs text-gray-400">
                          {m.recording_count} file{m.recording_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    {isRetrieved ? (
                      <span className="text-xs text-green-600 font-medium px-2 py-1 rounded bg-green-100">
                        Stored
                      </span>
                    ) : (
                      <button
                        onClick={() => handleRetrieve(mid)}
                        disabled={isRetrieving}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                      >
                        {isRetrieving ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        Retrieve
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Text Classifier Panel (upload / paste) ─────────────────────── */

function ClassificationResult({ cls }: { cls: Classification }) {
  const filterColors: Record<string, string> = {
    aerostack: "bg-indigo-100 text-indigo-700",
    medpic: "bg-amber-100 text-amber-700",
    "bant-c": "bg-rose-100 text-rose-700",
    ops: "bg-emerald-100 text-emerald-700",
    engineering: "bg-blue-100 text-blue-700",
    "customer-story": "bg-purple-100 text-purple-700",
  };

  return (
    <div className="space-y-3 mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      {/* Summary */}
      {cls.summary && (
        <p className="text-sm text-gray-700">{cls.summary}</p>
      )}

      {/* Filters */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
          <Filter className="w-3 h-3" /> Aerostack Filters
        </p>
        <div className="flex flex-wrap gap-2">
          {cls.filters.map((f) => (
            <span
              key={f.id}
              className={`text-xs px-2 py-1 rounded-lg font-medium ${filterColors[f.id] || "bg-gray-100 text-gray-600"}`}
              title={f.reason}
            >
              {f.id} ({Math.round(f.confidence * 100)}%)
            </span>
          ))}
        </div>
      </div>

      {/* Business tags */}
      {cls.enterprise_business_tags && cls.enterprise_business_tags.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <Tag className="w-3 h-3" /> Business Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {cls.enterprise_business_tags.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* LENS + Phase */}
      <div className="flex flex-wrap gap-4">
        {cls.lens_tags && cls.lens_tags.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">LENS Tags</p>
            <div className="flex flex-wrap gap-1">
              {cls.lens_tags.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-mono">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {cls.dominant_phase && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Dominant Phase</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
              {cls.dominant_phase}
            </span>
          </div>
        )}
      </div>

      {/* Speakers + Topics */}
      <div className="flex flex-wrap gap-4">
        {cls.speakers && cls.speakers.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Speakers</p>
            <p className="text-xs text-gray-600">{cls.speakers.join(", ")}</p>
          </div>
        )}
        {cls.key_topics && cls.key_topics.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Key Topics</p>
            <p className="text-xs text-gray-600">{cls.key_topics.join(", ")}</p>
          </div>
        )}
      </div>

      {/* Aerostack mappings */}
      {(cls.loop_categories?.length || cls.pillars?.length) && (
        <div className="flex flex-wrap gap-4 pt-2 border-t border-gray-200">
          {cls.loop_categories && cls.loop_categories.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Loop Categories</p>
              <div className="flex gap-1">
                {cls.loop_categories.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-mono">{c}</span>
                ))}
              </div>
            </div>
          )}
          {cls.pillars && cls.pillars.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Pillars</p>
              <div className="flex gap-1">
                {cls.pillars.map((p) => (
                  <span key={p} className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-mono">{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextClassifierPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Classification | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => classifyText(title || "Untitled", text),
    onSuccess: (data) => setResult(data),
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Use filename as title if title is empty
    if (!title) {
      setTitle(file.name.replace(/\.(vtt|srt|txt)$/i, ""));
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setText(content);
    };
    reader.readAsText(file);
  }, [title]);

  const handlePaste = useCallback(async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        setText((prev) => (prev ? prev + "\n" + clipText : clipText));
      }
    } catch {
      // Clipboard API may not be available
    }
  }, []);

  const canClassify = text.trim().length > 20;

  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Classify Text / Upload Transcript</span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-gray-500">
            Paste transcript text, upload a .vtt/.srt/.txt file, or type content to classify through Aerostack filters.
          </p>

          {/* Title */}
          <input
            type="text"
            placeholder="Meeting title (optional — helps classification)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />

          {/* Text area */}
          <textarea
            placeholder="Paste or type transcript content here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 font-mono resize-y"
          />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".vtt,.srt,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload .vtt / .srt / .txt
            </button>
            <button
              onClick={handlePaste}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Paste from clipboard
            </button>

            <div className="flex-1" />

            {text && (
              <span className="text-xs text-gray-400">{text.length.toLocaleString()} chars</span>
            )}

            <button
              onClick={() => mutation.mutate()}
              disabled={!canClassify || mutation.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Classify
            </button>
          </div>

          {/* Error */}
          {mutation.isError && (
            <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {(mutation.error as Error).message}
            </div>
          )}

          {/* Result */}
          {result && <ClassificationResult cls={result} />}
        </div>
      )}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */

export default function ZoomRecordingsTools() {
  const { givenRole, hasPermission } = usePermissions();
  const auth = useAuth();

  // Current user email (used for attendee gate) resolved from Cognito ID token payload
  const [userEmail, setUserEmail] = useState<string>("");
  useEffect(() => {
    if (!auth?.user) return;
    fetchAuthSession()
      .then((session) => {
        const email = session.tokens?.idToken?.payload?.email as string | undefined;
        setUserEmail(email ?? "");
      })
      .catch(() => setUserEmail(""));
  }, [auth?.user]);

  const userName = useMemo(() => {
    if (!userEmail) return "User";
    return userEmail.split("@")[0] ?? "User";
  }, [userEmail]);

  // View access is governed by the fine-grained RBAC permission, not givenRole.
  // Admin/Super-Admin get it by default; other users can be granted it via Roles.
  const canViewZoom = hasPermission("tools/zoom-recordings", "read");
  // Raw-bucket download stays an Admin/Super-Admin-only privilege.
  const canDownload = canAccessRawBucket(givenRole);
  // Admins/Super-Admins bypass the attendee gate entirely
  const bypassAttendeeGate = givenRole === "Super-Admin" || givenRole === "Admin";

  const [activeFilter, setActiveFilter] = useState<AerostackFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [dateFilter, setDateFilter] = useState("");
  const [accessTab, setAccessTab] = useState<"accessible" | "gated">("accessible");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["zoom-recordings"],
    queryFn: fetchRecordings,
    staleTime: 5 * 60 * 1000,
    enabled: canViewZoom,
  });

  const filteredMeetings = useMemo(() => {
    if (!data) return [];
    const filterDef = Aerostack_FILTERS.find((f) => f.id === activeFilter) || Aerostack_FILTERS[0];
    let meetings = data.meetings;

    // Apply Aerostack filter
    if (activeFilter !== "all") {
      meetings = meetings.filter((m) => matchesFilter(m, filterDef));
    }

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      meetings = meetings.filter(
        (m) =>
          m.meeting_name.toLowerCase().includes(q) ||
          m.meeting_id.includes(q)
      );
    }

    // Apply date filter
    if (dateFilter) {
      meetings = meetings.filter(
        (m) => m.latest_date === dateFilter || m.dates.includes(dateFilter)
      );
    }

    // Apply sort by date — use only valid YYYY-MM-DD dates for comparison
    meetings = [...meetings].sort((a, b) => {
      const aValidDates = a.dates.filter(isDateString).sort();
      const bValidDates = b.dates.filter(isDateString).sort();
      // For "newest first" compare by newest date; for "oldest first" compare by oldest date
      const dateA = aValidDates.length > 0
        ? (sortOrder === "newest" ? aValidDates[aValidDates.length - 1] : aValidDates[0])
        : "";
      const dateB = bValidDates.length > 0
        ? (sortOrder === "newest" ? bValidDates[bValidDates.length - 1] : bValidDates[0])
        : "";
      return sortOrder === "newest"
        ? dateB.localeCompare(dateA)
        : dateA.localeCompare(dateB);
    });

    return meetings;
  }, [data, activeFilter, searchQuery, sortOrder, dateFilter, bypassAttendeeGate, userEmail]);

  const checkIsAttendee = useCallback((meeting: Meeting): boolean => {
    if (bypassAttendeeGate) return true;
    const record = meeting.attendee_record;
    if (!record) return false;
    if (!record.locked) return true;
    
    // Check card-level permission
    if (record.attendees.map(a => a.toLowerCase()).includes(userEmail.toLowerCase())) return true;
    
    // Check session-specific override permission
    if (record.session_rules) {
      return Object.keys(record.session_rules).some((date) => {
        const rule = record.session_rules?.[date];
        return rule?.attendees?.map(a => a.toLowerCase()).includes(userEmail.toLowerCase()) ?? false;
      });
    }
    
    return false;
  }, [userEmail, bypassAttendeeGate]);

  const { accessibleMeetings, gatedMeetings } = useMemo(() => {
    const accessible: Meeting[] = [];
    const gated: Meeting[] = [];
    
    for (const meeting of filteredMeetings) {
      if (checkIsAttendee(meeting)) {
        accessible.push(meeting);
      } else {
        gated.push(meeting);
      }
    }
    
    return { accessibleMeetings: accessible, gatedMeetings: gated };
  }, [filteredMeetings, checkIsAttendee]);

  // Access denied for users without the zoom-recordings permission
  if (!canViewZoom) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <Shield className="w-10 h-10 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h2>
        <p className="text-sm text-gray-500 max-w-md">
          You do not have permission to view Zoom recordings. Ask an Admin to grant you access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Video className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Zoom Recordings</h2>
            <p className="text-sm text-gray-500">
              Meeting recordings stored in S3 &amp; Google Drive
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canDownload ? (
            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
              <Shield className="w-3 h-3" /> Full Access
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
              <Eye className="w-3 h-3" /> View Only
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Aerostack Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          <span className="font-medium">Aerostack Filters</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {Aerostack_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeFilter === f.id
                  ? `${f.color} ring-2 ring-offset-1 ring-current`
                  : "bg-gray-50 text-gray-500 hover:bg-gray-100"
              }`}
              title={f.description}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + Sort + Date Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search meetings by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg pl-2.5 pr-8 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 w-[160px] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-8 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          />
          {dateFilter ? (
            <button
              onClick={() => setDateFilter("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          )}
        </div>
        <button
          onClick={() => setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"))}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors shrink-0 ${
            sortOrder === "newest"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortOrder === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">
              {activeFilter === "all" ? data.count : filteredMeetings.length}
            </p>
            <p className="text-xs text-gray-500">
              {activeFilter === "all" ? "Meetings" : `Matching "${Aerostack_FILTERS.find((f) => f.id === activeFilter)?.label}"`}
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">
              {filteredMeetings.reduce((a, m) => a + m.file_count, 0)}
            </p>
            <p className="text-xs text-gray-500">Total Files</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">
              {filteredMeetings.filter((m) => m.has_video).length}
            </p>
            <p className="text-xs text-gray-500">With Video</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">
              {formatSize(filteredMeetings.reduce((a, m) => a + m.total_size_bytes, 0))}
            </p>
            <p className="text-xs text-gray-500">Total Storage</p>
          </div>
        </div>
      )}

      {/* LENS reference */}
      <LoopPhaseReference />

      {/* Retrieve from Zoom */}
      {canDownload && <ZoomRetrievalPanel onRetrieved={() => refetch()} />}

      {/* Upload / Paste classifier */}
      <TextClassifierPanel />

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-3" />
          <span className="text-gray-500">Loading recordings from S3...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Failed to load recordings: {(error as Error).message}
        </div>
      )}

      {/* Empty state */}
      {data && filteredMeetings.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">
            {activeFilter === "all" ? "No recordings found" : `No recordings match "${Aerostack_FILTERS.find((f) => f.id === activeFilter)?.label}" filter`}
          </p>
          <p className="text-sm mt-1">
            {activeFilter === "all"
              ? "Recordings will appear here once the Zoom webhook processes them."
              : "Try a different filter or search term."}
          </p>
        </div>
      )}

      {/* Tab Selector */}
      {data && filteredMeetings.length > 0 && gatedMeetings.length > 0 && (
        <div className="flex border-b border-gray-200 gap-6 mb-4">
          <button
            onClick={() => setAccessTab("accessible")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              accessTab === "accessible"
                ? "border-amber-600 text-amber-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Unlock className="w-4 h-4" />
            Accessible ({accessibleMeetings.length})
          </button>
          <button
            onClick={() => setAccessTab("gated")}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              accessTab === "gated"
                ? "border-amber-600 text-amber-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Lock className="w-4 h-4" />
            Gated ({gatedMeetings.length})
          </button>
        </div>
      )}

      {/* Meeting list */}
      {data && filteredMeetings.length > 0 && (
        <div className="space-y-3">
          {((gatedMeetings.length === 0 || accessTab === "accessible") ? accessibleMeetings : gatedMeetings).map((meeting) => (
            <MeetingCard
              key={meeting.folder}
              meeting={meeting}
              canDownload={canDownload}
              sortOrder={sortOrder}
              userEmail={userEmail}
              userName={userName}
              bypassAttendeeGate={bypassAttendeeGate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
