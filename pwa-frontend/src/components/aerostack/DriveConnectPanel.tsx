import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RefreshCw, Search, Download, FileText, FileSpreadsheet, Presentation,
  Loader2, AlertCircle, Plus, ExternalLink,
} from "lucide-react";
import toast from "react-hot-toast";
import { createDocument, triggerSync, listDocuments } from "@/api/document-host";
import {
  listDriveFiles, createDriveFile,
  type DriveFile, type DriveTab, type CreateDriveFileRequest,
} from "@/api/document-host/drive-playground";

interface Props {
  currentUserEmail: string;
  onImported: (doc?: any) => void;
}

type CreateKind = CreateDriveFileRequest["type"];

const CREATE_OPTIONS: { kind: CreateKind; label: string; mime: string; icon: typeof FileText; color: string }[] = [
  { kind: "document",     label: "Google Docs",   mime: "application/vnd.google-apps.document",     icon: FileText,        color: "text-blue-600" },
  { kind: "spreadsheet",  label: "Google Sheets",  mime: "application/vnd.google-apps.spreadsheet",  icon: FileSpreadsheet, color: "text-green-600" },
  { kind: "presentation", label: "Google Slides",  mime: "application/vnd.google-apps.presentation", icon: Presentation,    color: "text-amber-600" },
];

// ─── MIME helpers ─────────────────────────────────────────────────────────────

const GOOGLE_MIME_TO_EXPORT: Record<string, { mime: string; label: string }> = {
  "application/vnd.google-apps.document":     { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
  "application/vnd.google-apps.spreadsheet":  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       label: "XLSX" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PPTX" },
  "application/vnd.google-apps.drawing":      { mime: "image/svg+xml",   label: "SVG" },
  "application/vnd.google-apps.form":         { mime: "application/pdf", label: "PDF" },
};

function friendlyMime(mimeType: string): string {
  if (mimeType in GOOGLE_MIME_TO_EXPORT) return GOOGLE_MIME_TO_EXPORT[mimeType].label;
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word"))         return "DOCX";
  if (mimeType.includes("presentation")) return "PPTX";
  if (mimeType.includes("spreadsheet"))  return "XLSX";
  if (mimeType.startsWith("image/"))     return "Image";
  return mimeType.split("/").pop()?.toUpperCase() ?? "File";
}

function slugify(name: string, email: string): string {
  const docPart = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return `${email}/${docPart}-drive`;
}

function formatBytes(bytes?: string): string {
  if (!bytes) return "";
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriveConnectPanel({ currentUserEmail, onImported }: Props) {
  const [files, setFiles]         = useState<DriveFile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [tab, setTab]             = useState<DriveTab>("shared");
  const [importing, setImporting] = useState<Record<string, boolean>>({});
  const [imported, setImported]   = useState<Record<string, boolean>>({});
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating]   = useState<CreateKind | null>(null);

  // ─── Load Drive source_ids that are already synced to S3 ──────────────────

  const loadSyncedIds = useCallback(async () => {
    try {
      const result = await listDocuments({ org_id: "enterprise", limit: 500 });
      const ids = new Set(
        result.documents
          .filter((d) => d.source_provider === "google_drive" && d.source_id && !d.is_deleted)
          .map((d) => d.source_id as string),
      );
      setSyncedIds(ids);
    } catch {
      // non-critical — sync buttons just remain visible
    }
  }, []);

  // ─── Fetch files via backend (service account impersonates the user) ──────

  const fetchFiles = useCallback(async (which: DriveTab) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDriveFiles({ tab: which });
      setFiles(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load Drive files";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles(tab);
  }, [tab, fetchFiles]);

  useEffect(() => {
    loadSyncedIds();
  }, [loadSyncedIds]);

  const refresh = () => {
    fetchFiles(tab);
    loadSyncedIds();
  };

  // ─── Create a new Drive file (Doc / Sheet / Slides) ───────────────────────

  const handleCreate = async (kind: CreateKind) => {
    const opt = CREATE_OPTIONS.find((o) => o.kind === kind)!;
    setCreating(kind);
    try {
      const defaultName = `Untitled ${opt.label.replace("Google ", "").replace(/s$/, "")}`;
      const created = await createDriveFile({ name: defaultName, type: kind });

      // Open the new file for editing immediately
      if (created.webViewLink) window.open(created.webViewLink, "_blank");

      toast.success(`Created ${opt.label} — auto-syncing to S3`);
      if (created.id) setSyncedIds((prev) => new Set(prev).add(created.id));
      onImported();

      // Show it in "My Drive"
      if (tab !== "mine") setTab("mine");
      else await fetchFiles("mine");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setCreating(null);
    }
  };

  // ─── Sync an existing Drive file to S3 ────────────────────────────────────

  const importFile = async (file: DriveFile) => {
    setImporting((p) => ({ ...p, [file.id]: true }));
    try {
      const exportInfo = GOOGLE_MIME_TO_EXPORT[file.mimeType];
      const resolvedMime = exportInfo?.mime ?? file.mimeType;
      const isNda = file.name.toLowerCase().includes("nda") || file.name.toLowerCase().includes("mnda");
      const tags = isNda ? ["nda"] : [];

      const doc = await createDocument({
        title: file.name,
        slug: slugify(file.name, currentUserEmail),
        source_provider: "google_drive",
        source_id: file.id,
        source_url: file.webViewLink,
        mime_type: resolvedMime,
        visibility: "internal",
        org_id: "enterprise",
        tags,
      });

      toast.loading(`Syncing "${file.name}" to S3…`, { id: `import-${file.id}` });

      const result = await triggerSync(doc.document_id);

      if (result.synced) {
        toast.success(`"${file.name}" synced! Auto-sync is now active.`, { id: `import-${file.id}`, duration: 4000 });
        setImported((p) => ({ ...p, [file.id]: true }));
        setSyncedIds((prev) => new Set(prev).add(file.id));
        onImported({ ...doc, tags, current_version: 1 });
      } else if (result.requiresClientUpload) {
        toast.error("Service account can't access this file. Share it with the SA email, then retry.", { id: `import-${file.id}`, duration: 7000 });
      } else {
        toast.error(result.error ?? "Sync failed — document created, retry from Documents.", { id: `import-${file.id}`, duration: 6000 });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setImporting((p) => ({ ...p, [file.id]: false }));
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const filtered = files.filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* + New (create Doc / Sheet / Slides) — temporarily disabled
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5 shadow-sm" disabled={creating !== null}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {CREATE_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.kind}
                onClick={() => handleCreate(opt.kind)}
                disabled={creating !== null}
                className="gap-2.5 py-2 cursor-pointer"
              >
                <opt.icon className={`w-4 h-4 ${opt.color}`} />
                <span className="text-sm">{opt.label}</span>
                {creating === opt.kind && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-[11px] text-muted-foreground py-1.5">
              Created files auto-sync to S3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        */}

        {/* Tab toggle */}
        <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
          {([
            { value: "shared" as const, label: "Shared with me" },
            { value: "mine" as const,   label: "My Drive" },
          ]).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Drive files…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {currentUserEmail ? `${currentUserEmail} · ` : ""}{files.length} {tab === "shared" ? "shared with you" : "in your Drive"}
          </span>
        </div>
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading Drive files…</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
          <Button size="sm" variant="outline" onClick={refresh}>Try again</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No files match your search."
              : tab === "shared"
              ? "No files shared with you in Google Drive."
              : "No files in your Drive yet. Use “New” to create one."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((file) => {
            const isImporting = importing[file.id];
            const isImported  = imported[file.id] || syncedIds.has(file.id);
            const sharedBy = file.sharingUser?.displayName ?? file.owners?.[0]?.displayName ?? "Unknown";
            const createOpt = CREATE_OPTIONS.find((o) => o.mime === file.mimeType);
            const FileIcon = createOpt?.icon ?? FileText;
            const iconColor = createOpt?.color ?? "text-muted-foreground";

            return (
              <div
                key={file.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card transition-colors ${
                  isImported ? "border-green-300 bg-green-50/40 dark:bg-green-900/10" : "hover:bg-accent/50"
                }`}
              >
                <FileIcon className={`w-4 h-4 shrink-0 ${iconColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{file.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                      {friendlyMime(file.mimeType)}
                    </Badge>
                    {file.size && (
                      <span className="text-[11px] text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {tab === "shared" ? `Shared by ${sharedBy} · ` : ""}
                    {new Date(file.modifiedTime).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  title="Open in Drive"
                  onClick={() => window.open(file.webViewLink, "_blank")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
                {!isImported && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 text-xs gap-1"
                    disabled={isImporting}
                    onClick={() => importFile(file)}
                  >
                    {isImporting
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</>
                      : <><Download className="w-3 h-3" /> Sync to S3</>
                    }
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
