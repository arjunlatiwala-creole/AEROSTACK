import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  Wand2,
  Calendar,
  CheckCircle2,
  Send,
  BookOpen,
  Target,
  Palette,
  Layout,
  Copy,
  Loader2,
  RotateCcw,
  Sparkles,
  Plus,
  Trash2,
  FileText,
  Star,
  Users,
  Award,
  Archive,
  Presentation,
  ChevronDown,
  ArrowLeft,
  Pencil,
  ImagePlus,
  Linkedin,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PLATFORMS,
  TOPICS,
  AUDIENCES,
  TONES,
  BRAND_VOICES,
  CTA_TYPES,
  KB_TYPES,
  KB_TYPE_TO_SYSTEM_ID,
  type PlatformId,
  type TopicId,
  type AudienceId,
  type ToneId,
  type BrandVoiceId,
  type CtaTypeId,
  type KbType,
} from '@/lib/content-agent-config';
import { contentApi, uploadContentDraftImage, type BriefInput } from '@/lib/content-api';
import { knowledgeClient } from '@/lib/knowledgeClient';
import { addDays, addHours } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const KB_ICONS: Record<string, typeof Palette> = {
  brand_voice: Palette,
  strategic_alignment: Target,
  story_library: BookOpen,
  platform_playbook: Layout,
  customer_star: Star,
  community_blocks: Users,
  aws_accreditations: Award,
  prior_content: Archive,
  presentation_structures: Presentation,
};

interface WizardState {
  platforms: PlatformId[];
  topic: TopicId | '';
  audiences: AudienceId[];
  tone: ToneId | '';
  brandVoice: BrandVoiceId | '';
  ctaType: CtaTypeId | '';
  ctaLink: string;
  customContext: string;
  storyHook: string;
  scheduledDate: string;
  /** datetime-local strings per platform×audience; same iteration order as generation. */
  perDraftScheduleByCombo: Record<string, string>;
}

const INITIAL_WIZARD: WizardState = {
  platforms: [],
  topic: '',
  audiences: [],
  tone: '',
  brandVoice: '',
  ctaType: '',
  ctaLink: '',
  customContext: '',
  storyHook: '',
  scheduledDate: '',
  perDraftScheduleByCombo: {},
};

function wizardComboScheduleKey(platform: PlatformId, audience: AudienceId): string {
  return `${platform}:${audience}`;
}

function plannedDraftCombos(
  platforms: PlatformId[],
  audiences: AudienceId[],
): { platform: PlatformId; audience: AudienceId }[] {
  const combos: { platform: PlatformId; audience: AudienceId }[] = [];
  for (const platform of platforms) {
    for (const audience of audiences) {
      combos.push({ platform, audience });
    }
  }
  return combos;
}

/** Single-select option grid */
function OptionGrid({
  options,
  value,
  onChange,
}: {
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`p-3 rounded-lg border text-sm text-left transition-all ${
            value === opt.id
              ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Multi-select option grid — toggle items on/off */
function MultiOptionGrid({
  options,
  values,
  onChange,
}: {
  options: readonly { id: string; label: string }[];
  values: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (values.includes(id)) {
      onChange(values.filter((v) => v !== id));
    } else {
      onChange([...values, id]);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((opt) => {
        const selected = values.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            className={`p-3 rounded-lg border text-sm text-left transition-all ${
              selected
                ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {selected && <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WizardStep({
  step,
  title,
  children,
  isActive,
  isComplete,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <div className={`${isActive ? '' : 'opacity-50 pointer-events-none'}`}>
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            isComplete
              ? 'bg-green-500 text-white'
              : isActive
                ? 'bg-purple-600 text-white'
                : 'bg-slate-200 text-slate-500'
          }`}
        >
          {isComplete ? '✓' : step}
        </div>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      {isActive && <div className="ml-9">{children}</div>}
    </div>
  );
}

// ── Knowledge Base Panel ──────────────────────────────────────────
function KnowledgeBasePanel() {
  const [activeKb, setActiveKb] = useState<KbType>('story_library');
  const [entries, setEntries] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState({ title: '', content: '', tags: '' });

  const systemKbId = KB_TYPE_TO_SYSTEM_ID[activeKb];

  const loadEntries = async (kbType: KbType) => {
    setIsLoading(true);
    try {
      const kbId = KB_TYPE_TO_SYSTEM_ID[kbType];
      const list = await knowledgeClient.listEntries(kbId);
      setEntries(list as unknown as Record<string, unknown>[]);
    } catch {
      setEntries([]);
    }
    setIsLoading(false);
  };

  const handleKbChange = (kb: KbType) => {
    setActiveKb(kb);
    loadEntries(kb);
  };

  const handleAdd = async () => {
    if (!newEntry.title || !newEntry.content) {
      toast.error('Title and content required');
      return;
    }
    try {
      const tags = newEntry.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await knowledgeClient.addEntry({
        kbId: systemKbId,
        title: newEntry.title,
        content: newEntry.content,
        tags: tags.length > 0 ? tags : undefined,
        entryType: 'note',
        source: 'content-creator',
      });
      toast.success('Added to knowledge base');
      setNewEntry({ title: '', content: '', tags: '' });
      setShowAdd(false);
      loadEntries(activeKb);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleDelete = async (entryId: string) => {
    try {
      await knowledgeClient.deleteEntry(systemKbId, entryId);
      toast.success('Removed');
      loadEntries(activeKb);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {KB_TYPES.map((kb) => {
          const Icon = KB_ICONS[kb.id] ?? BookOpen;
          return (
            <button
              key={kb.id}
              onClick={() => handleKbChange(kb.id)}
              className={`p-3 rounded-lg border text-left transition-all ${
                activeKb === kb.id
                  ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4 mb-1 text-purple-600" />
              <div className="text-xs font-semibold">{kb.label}</div>
              <div className="text-xs text-muted-foreground line-clamp-1">{kb.description}</div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">
          {KB_TYPES.find((k) => k.id === activeKb)?.label} entries
        </span>
        <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3 h-3 mr-1" /> Add Entry
        </Button>
      </div>

      {showAdd && (
        <Card className="shadow-none border-purple-200">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input
                value={newEntry.title}
                onChange={(e) => setNewEntry((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g., Acme Corp cloud migration win"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Content</Label>
              <Textarea
                value={newEntry.content}
                onChange={(e) => setNewEntry((p) => ({ ...p, content: e.target.value }))}
                placeholder="Paste your story, brand guide section, strategy doc, or platform tips..."
                rows={4}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input
                value={newEntry.tags}
                onChange={(e) => setNewEntry((p) => ({ ...p, tags: e.target.value }))}
                placeholder="aws, migration, case-study"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No entries yet. Add stories, guides, and docs to train the agents.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={String(entry.entryId ?? entry.sk)}
              className="p-3 rounded-lg border bg-white flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{String(entry.title ?? '')}</div>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {String(entry.content ?? '')}
                </p>
                {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {(entry.tags as string[]).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(String(entry.entryId ?? entry.sk))}>
                <Trash2 className="w-3 h-3 text-red-400" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseHashtagInput(text: string): string[] {
  return text
    .split(/[\s\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Allow editing draft copy in the ledger until the brief is published. */
function briefAllowsDraftEdit(status: unknown): boolean {
  const s = String(status ?? 'draft');
  return s !== 'published';
}

/** Schedules use US Eastern (New York); API stores UTC ISO. */
const CONTENT_SCHEDULE_TZ = 'America/New_York';

/** Default datetime-local: tomorrow 09:00 Eastern. */
function defaultScheduleDateTimeInput(): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const z = toZonedTime(new Date(), CONTENT_SCHEDULE_TZ);
  const tomorrow = addDays(z, 1);
  tomorrow.setHours(9, 0, 0, 0);
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
}

/** Detect legacy date-only (YYYY-MM-DD) values vs datetime values. */
function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Format a stored scheduled_date for display in US Eastern.
 */
function formatScheduledDateTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  if (isDateOnly(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: CONTENT_SCHEDULE_TZ,
    });
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString('en-US', {
    timeZone: CONTENT_SCHEDULE_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * datetime-local parts (shown as Eastern) → UTC ISO for the API.
 */
function schedulePickerValueToUtcIso(localValue: string): string {
  const t = localValue.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(t);
  if (!m) return '';
  const y = Number(m[1]),
    mo = Number(m[2]),
    da = Number(m[3]),
    h = Number(m[4]),
    mi = Number(m[5]);
  const wall = new Date(y, mo - 1, da, h, mi, 0, 0);
  return fromZonedTime(wall, CONTENT_SCHEDULE_TZ).toISOString();
}

/** Date-only (YYYY-MM-DD) at 09:00 Eastern, or Eastern datetime-local → UTC ISO. */
function scheduleDateOrDateOnlyToUtcIso(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (isDateOnly(t)) {
    const [y, mo, d] = t.split('-').map(Number);
    const wall = new Date(y!, (mo ?? 1) - 1, d ?? 1, 9, 0, 0, 0);
    return fromZonedTime(wall, CONTENT_SCHEDULE_TZ).toISOString();
  }
  return schedulePickerValueToUtcIso(t);
}

/**
 * Stored UTC ISO → datetime-local strings representing Eastern wall time.
 */
function toDateTimeLocalInputValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (isDateOnly(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${y}-${pad(m ?? 1)}-${pad(d ?? 1)}T09:00`;
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  const z = toZonedTime(dt, CONTENT_SCHEDULE_TZ);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}T${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

function DraftImageSection({
  briefId,
  draftId,
  content,
  hashtags,
  imageUrl,
  disabled,
  onImageUrlChange,
}: {
  briefId: string;
  draftId: string;
  content: string;
  hashtags: string[];
  imageUrl?: string | null;
  disabled?: boolean;
  onImageUrlChange: (url: string | null) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const doUpload = async (file: File) => {
    if (!draftId) return;
    setBusy(true);
    try {
      const r = await uploadContentDraftImage(briefId, draftId, file, {
        content,
        suggested_hashtags: hashtags,
      });
      if (!r.success) {
        toast.error(r.error ?? 'Upload failed');
        return;
      }
      toast.success('Image attached');
      await onImageUrlChange(r.image_url ?? null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await contentApi.updateDraft(briefId, draftId, { clear_image: true });
      if (!res.success) {
        toast.error(res.error ?? 'Could not remove image');
        return;
      }
      toast.success('Image removed');
      await onImageUrlChange(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Post image (optional)</Label>
      {imageUrl ? (
        <div className="relative max-w-md overflow-hidden rounded-lg border bg-muted/30">
          <img src={imageUrl} alt="" className="max-h-48 w-full object-contain" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doUpload(f);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy || !draftId}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <ImagePlus className="mr-1 h-3 w-3" />
          )}
          {imageUrl ? 'Replace image' : 'Upload image'}
        </Button>
        {imageUrl ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={disabled || busy}
            onClick={() => void remove()}
          >
            Remove image
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── Content Ledger (History with drill-down) ──────────────────────
function ContentLedger() {
  const [briefs, setBriefs] = useState<Record<string, unknown>[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<string | null>(null);
  const [briefDetail, setBriefDetail] = useState<{
    brief: Record<string, unknown>;
    drafts: Record<string, unknown>[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ledgerDraftEdit, setLedgerDraftEdit] = useState<{
    draftId: string;
    content: string;
    hashtagsText: string;
    imageUrl?: string;
  } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{
    briefId: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [linkedinPostingKey, setLinkedinPostingKey] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await contentApi.deleteBrief(deleteTarget.briefId);
    setDeleting(false);
    if (!res.success) {
      toast.error(res.error ?? 'Could not delete post');
      return;
    }
    toast.success('Post deleted');
    setDeleteTarget(null);
    if (selectedBrief === deleteTarget.briefId) {
      setSelectedBrief(null);
      setBriefDetail(null);
    }
    await loadBriefs();
  };

  const loadBriefs = async () => {
    const result = await contentApi.listBriefs();
    if (result.success && result.data) {
      setBriefs(result.data.briefs);
    }
    setLoaded(true);
  };

  useEffect(() => {
    loadBriefs();
  }, []);

  const loadDetail = async (briefId: string) => {
    setDetailLoading(true);
    setSelectedBrief(briefId);
    const result = await contentApi.getBrief(briefId);
    if (result.success && result.data) {
      setBriefDetail({
        brief: result.data.brief,
        drafts: result.data.drafts,
      });
    }
    setDetailLoading(false);
  };

  const deleteDialog = (
    <Dialog
      open={deleteTarget !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) setDeleteTarget(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete scheduled post?</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm">
            This will permanently delete the brief, all its drafts, and any attached
            images.
          </p>
          {deleteTarget && (
            <p className="text-sm font-medium text-foreground">{deleteTarget.label}</p>
          )}
          <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={deleting}
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-red-600 hover:bg-red-700"
            disabled={deleting}
            onClick={() => void confirmDelete()}
          >
            {deleting ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Trash2 className="w-3 h-3 mr-1" />
            )}
            {deleting ? 'Deleting…' : 'Delete post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Detail view
  if (selectedBrief && briefDetail) {
    const b = briefDetail.brief;
    const briefId = selectedBrief;
    const canMarkPublished =
      b.status !== 'published' && b.status !== 'rejected';
    const canEditDrafts = briefAllowsDraftEdit(b.status);
    const showScheduleAction = b.status === 'approved' || b.status === 'scheduled';

    const saveLedgerDraftEdit = async () => {
      if (!ledgerDraftEdit) return;
      const hashtags = parseHashtagInput(ledgerDraftEdit.hashtagsText);
      const res = await contentApi.updateDraft(briefId, ledgerDraftEdit.draftId, {
        content: ledgerDraftEdit.content,
        suggested_hashtags: hashtags,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Could not save draft');
        return;
      }
      toast.success('Draft saved');
      setLedgerDraftEdit(null);
      await loadDetail(briefId);
    };

    const markPublished = async () => {
      const res = await contentApi.updateStatus(briefId, 'published');
      if (!res.success) {
        toast.error(res.error ?? 'Could not update status');
        return;
      }
      toast.success('Marked published — added to prior-content knowledge base');
      await loadDetail(briefId);
      await loadBriefs();
    };

    const confirmSchedule = async () => {
      if (!scheduleDate.trim()) {
        toast.error('Pick a publish date');
        return;
      }
      const iso = scheduleDateOrDateOnlyToUtcIso(scheduleDate.trim());
      if (!iso) {
        toast.error('Invalid schedule date');
        return;
      }
      const res = await contentApi.updateStatus(briefId, 'scheduled', {
        scheduled_date: iso,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Could not schedule');
        return;
      }
      toast.success(b.status === 'scheduled' ? 'Schedule updated' : 'Scheduled');
      setScheduleOpen(false);
      await loadDetail(briefId);
      await loadBriefs();
    };

    const isLinkedinBrief = String(b.platform ?? '').toLowerCase() === 'linkedin';
    const linkedinPosted = String(b.linkedin_last_post_urn ?? '').trim() !== '';

    const postDraftToLinkedIn = async (draftId: string) => {
      const key = `${briefId}:${draftId}`;
      setLinkedinPostingKey(key);
      try {
        const res = await contentApi.postToLinkedIn(briefId, { draftId });
        if (!res.success) {
          toast.error(res.error ?? 'LinkedIn post failed');
          return;
        }
        toast.success('Posted to LinkedIn and marked published in Aerostack');
        await loadDetail(briefId);
        await loadBriefs();
      } finally {
        setLinkedinPostingKey(null);
      }
    };

    return (
      <div className="space-y-4">
        {deleteDialog}
        <Dialog
          open={ledgerDraftEdit !== null}
          onOpenChange={(open) => {
            if (!open) setLedgerDraftEdit(null);
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit draft</DialogTitle>
            </DialogHeader>
            {ledgerDraftEdit && (
              <div className="space-y-3 overflow-y-auto py-2">
                {ledgerDraftEdit.imageUrl ? (
                  <div className="max-h-40 overflow-hidden rounded-md border">
                    <img
                      src={ledgerDraftEdit.imageUrl}
                      alt=""
                      className="max-h-40 w-full object-contain"
                    />
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label className="text-xs">Post body</Label>
                  <Textarea
                    value={ledgerDraftEdit.content}
                    onChange={(e) =>
                      setLedgerDraftEdit((p) => (p ? { ...p, content: e.target.value } : null))
                    }
                    rows={12}
                    className="text-sm min-h-[200px] resize-y"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hashtags (space-separated)</Label>
                  <Textarea
                    value={ledgerDraftEdit.hashtagsText}
                    onChange={(e) =>
                      setLedgerDraftEdit((p) => (p ? { ...p, hashtagsText: e.target.value } : null))
                    }
                    rows={2}
                    placeholder="#example #hashtags"
                    className="text-sm"
                  />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setLedgerDraftEdit(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveLedgerDraftEdit()}>
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {b.status === 'scheduled' ? 'Update schedule date' : 'Schedule post'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label className="text-xs">Go-live date &amp; time</Label>
              <Input
                type="datetime-local"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Times are US Eastern (New York). The job runs every minute in AWS and publishes when the stored UTC
                time is due. You can still post or mark published manually.
                &quot;Mark as published&quot; in the ledger when it is live.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void confirmSchedule()}>
                <Calendar className="w-3 h-3 mr-1" /> Confirm schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="ghost" size="sm" onClick={() => { setSelectedBrief(null); setBriefDetail(null); }}>
          <ArrowLeft className="w-3 h-3 mr-1" /> Back to Ledger
        </Button>

        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                {String(b.platform ?? '').toUpperCase()} · {String(b.topic ?? '').replace(/_/g, ' ')}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {showScheduleAction && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const existing = toDateTimeLocalInputValue(b.scheduled_date);
                      setScheduleDate(existing || defaultScheduleDateTimeInput());
                      setScheduleOpen(true);
                    }}
                  >
                    <Calendar className="w-3 h-3 mr-1" />{' '}
                    {b.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
                  </Button>
                )}
                {canMarkPublished && (
                  <Button
                    size="sm"
                    className="bg-purple-600 hover:bg-purple-700"
                    onClick={() => void markPublished()}
                  >
                    <Send className="w-3 h-3 mr-1" /> Mark as published
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() =>
                    setDeleteTarget({
                      briefId,
                      label: `${String(b.platform ?? '').toUpperCase()} · ${String(b.topic ?? '').replace(/_/g, ' ')}`,
                    })
                  }
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    b.status === 'approved' ? 'bg-green-50 text-green-700'
                      : b.status === 'scheduled' ? 'bg-blue-50 text-blue-700'
                      : b.status === 'published' ? 'bg-purple-50 text-purple-700'
                      : 'bg-slate-50'
                  }`}
                >
                  {String(b.status ?? 'draft')}
                </Badge>
              </div>
            </div>
            <CardDescription>
              {String(b.audience ?? '').replace(/_/g, ' ')} · {String(b.tone ?? '')} · {String(b.brand_voice ?? '').replace(/_/g, ' ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {String(b.story_hook ?? '') !== '' && (
              <div>
                <Label className="text-xs text-muted-foreground">Story Hook</Label>
                <p className="text-sm">{String(b.story_hook)}</p>
              </div>
            )}
            {String(b.custom_context ?? '') !== '' && (
              <div>
                <Label className="text-xs text-muted-foreground">Context</Label>
                <p className="text-sm">{String(b.custom_context)}</p>
              </div>
            )}
            {String(b.scheduled_date ?? '') !== '' && (
              <div>
                <Label className="text-xs text-muted-foreground">Scheduled for</Label>
                <p className="text-sm">{formatScheduledDateTime(b.scheduled_date)}</p>
              </div>
            )}
            {isLinkedinBrief && (
              <p className="text-xs text-muted-foreground">
                Post to LinkedIn from a draft below (text + hashtags). Requires AWS Secrets Manager
                credential <code className="text-[11px]">linkedin_content_publish</code> with{' '}
                <code className="text-[11px]">access_token</code> and{' '}
                <code className="text-[11px]">author_urn</code>.
                {linkedinPosted && (
                  <span className="block mt-1 text-green-700">
                    A post was already sent from this brief on LinkedIn.
                  </span>
                )}
              </p>
            )}
            <div className="text-xs text-muted-foreground">
              Created {new Date(String(b.created_at ?? '')).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <span className="text-sm font-semibold">Drafts ({briefDetail.drafts.length})</span>
          {briefDetail.drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drafts generated yet.</p>
          ) : (
            briefDetail.drafts.map((d) => (
              <Card key={String(d.draft_id)} className="shadow-none">
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      v{String(d.version ?? 1)} · {new Date(String(d.created_at ?? '')).toLocaleString()}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {canEditDrafts && String(d.draft_id ?? '') !== '' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setLedgerDraftEdit({
                              draftId: String(d.draft_id),
                              content: String(d.content ?? ''),
                              hashtagsText: Array.isArray(d.suggested_hashtags)
                                ? (d.suggested_hashtags as string[]).join(' ')
                                : '',
                              imageUrl:
                                typeof d.image_url === 'string' ? d.image_url : undefined,
                            })
                          }
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const tags = Array.isArray(d.suggested_hashtags)
                            ? (d.suggested_hashtags as string[]).join(' ')
                            : '';
                          const body = tags ? `${String(d.content ?? '')}\n\n${tags}` : String(d.content ?? '');
                          navigator.clipboard.writeText(body);
                          toast.success('Copied');
                        }}
                      >
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      {isLinkedinBrief &&
                        String(d.draft_id ?? '') !== '' &&
                        b.status !== 'rejected' && (
                        <Button
                          variant="default"
                          size="sm"
                          className="bg-[#0A66C2] hover:bg-[#004182] text-white border-0"
                          disabled={
                            linkedinPosted ||
                            linkedinPostingKey === `${briefId}:${String(d.draft_id)}`
                          }
                          onClick={() => void postDraftToLinkedIn(String(d.draft_id))}
                          title={
                            linkedinPosted
                              ? 'This brief already has a LinkedIn post from Aerostack'
                              : undefined
                          }
                        >
                          {linkedinPostingKey === `${briefId}:${String(d.draft_id)}` ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Linkedin className="w-3 h-3 mr-1" />
                          )}
                          Post to LinkedIn
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border whitespace-pre-wrap text-sm leading-relaxed">
                    {String(d.content ?? '')}
                  </div>
                  {Array.isArray(d.suggested_hashtags) && d.suggested_hashtags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {(d.suggested_hashtags as string[]).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}
                  {String(d.draft_id ?? '') !== '' && (
                    <DraftImageSection
                      briefId={briefId}
                      draftId={String(d.draft_id)}
                      content={String(d.content ?? '')}
                      hashtags={
                        Array.isArray(d.suggested_hashtags)
                          ? (d.suggested_hashtags as string[])
                          : []
                      }
                      imageUrl={typeof d.image_url === 'string' ? d.image_url : null}
                      disabled={b.status === 'published'}
                      onImageUrlChange={() => loadDetail(briefId)}
                    />
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-3">
      {deleteDialog}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Content Ledger ({briefs.length} items)</span>
        <Button variant="outline" size="sm" onClick={loadBriefs}>
          <RotateCcw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {briefs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No content yet. Create your first brief above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {briefs.map((b) => {
            const pk = String(b.pk);
            const label = `${String(b.platform ?? '').toUpperCase()} · ${String(b.topic ?? '').replace(/_/g, ' ')}`;
            return (
              <div
                key={pk}
                role="button"
                tabIndex={0}
                onClick={() => loadDetail(pk)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    loadDetail(pk);
                  }
                }}
                className="w-full p-3 rounded-lg border flex items-center justify-between hover:bg-slate-50 transition-colors text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-muted-foreground">
                    {String(b.audience ?? '').replace(/_/g, ' ')} · {String(b.tone ?? '')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Created {new Date(String(b.created_at ?? '')).toLocaleDateString()}
                    {String(b.scheduled_date ?? '').trim() !== '' && (
                      <>
                        {' · '}
                        <span className="text-blue-700">
                          Scheduled for {formatScheduledDateTime(b.scheduled_date)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      b.status === 'approved' ? 'bg-green-50 text-green-700'
                        : b.status === 'scheduled' ? 'bg-blue-50 text-blue-700'
                        : b.status === 'published' ? 'bg-purple-50 text-purple-700'
                        : 'bg-slate-50'
                    }`}
                  >
                    {String(b.status ?? 'draft')}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ briefId: pk, label });
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronDown className="w-4 h-4 text-muted-foreground -rotate-90" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Dual Calendar (enterprise events + content calendar) ─────────────
const Enterprise_EVENTS = [
  { date: '2026-03-11', title: 'AWS Community Day', type: 'event' as const, platform: 'meetup' },
  { date: '2026-03-18', title: 'enterprise Meetup — GenAI Agents', type: 'event' as const, platform: 'meetup' },
  { date: '2026-03-25', title: 'AWS Summit Preview', type: 'event' as const, platform: 'linkedin' },
  { date: '2026-04-01', title: 'Q2 Kickoff', type: 'event' as const, platform: 'blog' },
  { date: '2026-04-08', title: 'enterprise Meetup — Serverless', type: 'event' as const, platform: 'meetup' },
  { date: '2026-04-15', title: 'AWS Partner Webinar', type: 'event' as const, platform: 'linkedin' },
];

function DualCalendar() {
  const [calendarSlots, setCalendarSlots] = useState<Record<string, unknown>[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    briefId: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCalendar = async () => {
    const result = await contentApi.listCalendar();
    if (result.success && result.data) {
      setCalendarSlots(result.data.slots);
    }
    setLoaded(true);
  };

  useEffect(() => {
    loadCalendar();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await contentApi.deleteBrief(deleteTarget.briefId);
    setDeleting(false);
    if (!res.success) {
      toast.error(res.error ?? 'Could not delete post');
      return;
    }
    toast.success('Post deleted');
    setDeleteTarget(null);
    await loadCalendar();
  };

  // Merge events + content into a unified timeline
  const allItems = useMemo(() => {
    const items: {
      date: string;
      title: string;
      type: 'event' | 'content';
      platform: string;
      status?: string;
      briefId?: string;
    }[] = [];

    Enterprise_EVENTS.forEach((e) => items.push(e));

    calendarSlots.forEach((slot) => {
      items.push({
        date: String(slot.scheduled_date ?? ''),
        title: `${String(slot.topic ?? '').replace(/_/g, ' ')} — ${String(slot.audience ?? '').replace(/_/g, ' ')}`,
        type: 'content',
        platform: String(slot.platform ?? ''),
        status: String(slot.status ?? 'draft'),
        briefId: String(slot.pk ?? ''),
      });
    });

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }, [calendarSlots]);

  // Parse a date-only or datetime string into a local Date. Avoids the UTC
  // midnight pitfall where "2026-04-25" can display as Apr 24 in US timezones.
  const parseItemDate = (raw: string): Date => {
    if (isDateOnly(raw)) {
      const [y, m, d] = raw.split('-').map(Number);
      return new Date(y, (m ?? 1) - 1, d ?? 1);
    }
    return new Date(raw);
  };

  const currentYear = new Date().getFullYear();

  // Render exactly VISIBLE_WEEKS weekly rows starting with the current week,
  // so the calendar always shows "now" at the top and a fixed rolling window
  // of upcoming weeks beneath it. Items whose week falls outside this window
  // are not displayed on the calendar (they remain visible in the ledger).
  const VISIBLE_WEEKS = 8;

  const weeks = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const keyOf = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();
    const currentWeekStart = new Date(now);
    currentWeekStart.setDate(now.getDate() - now.getDay());
    currentWeekStart.setHours(0, 0, 0, 0);

    const buckets: Array<[string, typeof allItems]> = [];
    const indexByKey = new Map<string, number>();
    for (let i = 0; i < VISIBLE_WEEKS; i++) {
      const ws = new Date(currentWeekStart);
      ws.setDate(currentWeekStart.getDate() + i * 7);
      const k = keyOf(ws);
      indexByKey.set(k, i);
      buckets.push([k, []]);
    }

    allItems.forEach((item) => {
      const d = parseItemDate(item.date);
      if (Number.isNaN(d.getTime())) return;
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = keyOf(weekStart);
      const idx = indexByKey.get(key);
      if (idx === undefined) return;
      buckets[idx][1].push(item);
    });
    return buckets;
  }, [allItems]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete scheduled post?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm">
              This will permanently delete the brief, all its drafts, and any attached
              images.
            </p>
            {deleteTarget && (
              <p className="text-sm font-medium text-foreground">{deleteTarget.label}</p>
            )}
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1" />
              )}
              {deleting ? 'Deleting…' : 'Delete post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-orange-400" />
            <span className="text-xs text-muted-foreground">enterprise Events</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-purple-400" />
            <span className="text-xs text-muted-foreground">Scheduled Content</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadCalendar}>
          <RotateCcw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {weeks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No upcoming events or scheduled content. Create briefs with dates to populate.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {weeks.map(([weekKey, items], weekIdx) => {
            const weekDate = parseItemDate(weekKey);
            const weekOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
            if (weekDate.getFullYear() !== currentYear) weekOpts.year = 'numeric';
            const weekLabel = `Week of ${weekDate.toLocaleDateString('en-US', weekOpts)}${weekIdx === 0 ? ' (this week)' : ''}`;
            return (
              <div key={weekKey}>
                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  {weekLabel}
                </div>
                <div className="space-y-1.5">
                  {items.length === 0 && (
                    <div className="p-3 rounded-lg border border-dashed text-xs text-muted-foreground">
                      No events or scheduled content this week.
                    </div>
                  )}
                  {items.map((item, i) => {
                    const dt = parseItemDate(item.date);
                    const dateOpts: Intl.DateTimeFormatOptions = {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    };
                    if (!Number.isNaN(dt.getTime()) && dt.getFullYear() !== currentYear) {
                      dateOpts.year = 'numeric';
                    }
                    const dateLabel = Number.isNaN(dt.getTime())
                      ? item.date
                      : dt.toLocaleDateString('en-US', dateOpts);
                    const showTime =
                      item.type === 'content' && !isDateOnly(item.date) && !Number.isNaN(dt.getTime());
                    const timeLabel = showTime
                      ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                      : '';
                    return (
                    <div
                      key={`${item.date}-${i}`}
                      className={`p-3 rounded-lg border flex items-center gap-3 ${
                        item.type === 'event' ? 'border-orange-200 bg-orange-50/50' : 'border-purple-200 bg-purple-50/50'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        item.type === 'event' ? 'bg-orange-400' : 'bg-purple-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{item.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {dateLabel}
                          {timeLabel && <span className="ml-1">at {timeLabel}</span>}
                          {' · '}{item.platform}
                        </div>
                      </div>
                      {item.status && item.type === 'content' && (
                        <Badge variant="outline" className="text-xs">{item.status}</Badge>
                      )}
                      {item.type === 'event' && (
                        <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700 border-orange-300">event</Badge>
                      )}
                      {item.type === 'content' && item.briefId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                          aria-label={`Delete ${item.title}`}
                          onClick={() =>
                            setDeleteTarget({ briefId: item.briefId!, label: item.title })
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function ContentCreator() {
  const [activeTab, setActiveTab] = useState('create');
  const [wizard, setWizard] = useState<WizardState>(INITIAL_WIZARD);
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDrafts, setGeneratedDrafts] = useState<
    {
      platform: string;
      content: string;
      hashtags: string[];
      briefId: string;
      draftId: string;
      imageUrl?: string;
    }[]
  >([]);
  const [draftEdit, setDraftEdit] = useState<{
    index: number;
    content: string;
    hashtagsText: string;
    imageUrl?: string;
  } | null>(null);
  const [linkedinWizardKey, setLinkedinWizardKey] = useState<string | null>(null);
  /** Per-brief datetime-local strings for wizard-generated drafts (each post can differ). */
  const [scheduleLocalByBriefId, setScheduleLocalByBriefId] = useState<Record<string, string>>({});
  const [bulkScheduling, setBulkScheduling] = useState(false);

  const plannedWizardCombos = useMemo(
    () => plannedDraftCombos(wizard.platforms, wizard.audiences),
    [wizard.platforms, wizard.audiences],
  );

  const stepComplete = (step: number): boolean => {
    switch (step) {
      case 1: return wizard.platforms.length > 0;
      case 2: return wizard.topic !== '';
      case 3: return wizard.audiences.length > 0;
      case 4: return wizard.tone !== '';
      case 5: return wizard.brandVoice !== '';
      case 6: return wizard.ctaType !== '';
      default: return false;
    }
  };

  const allStepsComplete =
    stepComplete(1) && stepComplete(2) && stepComplete(3) &&
    stepComplete(4) && stepComplete(5) && stepComplete(6);

  const handleGenerate = async () => {
    if (!allStepsComplete) {
      toast.error('Complete all steps first');
      return;
    }

    setIsGenerating(true);
    setGeneratedDrafts([]);

    const combos = plannedDraftCombos(wizard.platforms, wizard.audiences);

    toast(`Generating ${combos.length} draft${combos.length > 1 ? 's' : ''}...`);

    const results: typeof generatedDrafts = [];

    for (const combo of combos) {
      const brief: BriefInput = {
        platform: combo.platform,
        topic: wizard.topic,
        audience: combo.audience,
        tone: wizard.tone,
        brandVoice: wizard.brandVoice,
        ctaType: wizard.ctaType,
        ctaLink: wizard.ctaLink,
        customContext: wizard.customContext,
        storyHook: wizard.storyHook,
        scheduledDate: '',
      };

      const briefResult = await contentApi.createBrief(brief);
      const newBriefId = briefResult.data?.brief_id ?? '';

      const draftResult = await contentApi.generateDraft(newBriefId, brief);
      if (draftResult.success && draftResult.data) {
        const draftId =
          String(draftResult.data.draft_id ?? draftResult.data.draft?.draft_id ?? '');
        results.push({
          platform: combo.platform,
          content: String(draftResult.data.draft?.content ?? ''),
          hashtags: (draftResult.data.draft?.suggested_hashtags as string[]) ?? [],
          briefId: newBriefId,
          draftId,
        });
      }
    }

    setGeneratedDrafts(results);

    const seedSchedule: Record<string, string> = {};
    const pad = (n: number) => String(n).padStart(2, '0');
    const baseNyStagger = addDays(toZonedTime(new Date(), CONTENT_SCHEDULE_TZ), 1);
    baseNyStagger.setHours(9, 0, 0, 0);

    results.forEach((r, i) => {
      const combo = combos[i];
      if (!combo) return;
      const key = wizardComboScheduleKey(combo.platform, combo.audience);
      const planned = (wizard.perDraftScheduleByCombo[key] ?? '').trim();
      if (planned) {
        seedSchedule[r.briefId] = planned;
      } else if (wizard.scheduledDate.trim()) {
        seedSchedule[r.briefId] = wizard.scheduledDate;
      } else {
        const d = addHours(baseNyStagger, i);
        seedSchedule[r.briefId] = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    });
    setScheduleLocalByBriefId(seedSchedule);

    if (results.length > 0) {
      toast.success(`${results.length} draft${results.length > 1 ? 's' : ''} generated`);
    } else {
      toast.error('Generation failed');
    }
    setIsGenerating(false);
  };

  const handleReset = () => {
    setWizard(INITIAL_WIZARD);
    setCurrentStep(1);
    setGeneratedDrafts([]);
    setScheduleLocalByBriefId({});
  };

  const applyWizardScheduleToAllDrafts = () => {
    const v = wizard.scheduledDate.trim();
    if (!v) {
      toast.error('Set a default date and time above first');
      return;
    }
    if (generatedDrafts.length === 0) {
      toast.error('Generate drafts first');
      return;
    }
    setScheduleLocalByBriefId((prev) => {
      const next = { ...prev };
      for (const d of generatedDrafts) {
        next[d.briefId] = v;
      }
      return next;
    });
    toast.success('Applied default time to all drafts');
  };

  const scheduleAllWizardDrafts = async () => {
    if (generatedDrafts.length === 0) return;
    setBulkScheduling(true);
    try {
      let ok = 0;
      let skipped = 0;
      for (const d of generatedDrafts) {
        const local = (scheduleLocalByBriefId[d.briefId] ?? '').trim();
        const iso = scheduleDateOrDateOnlyToUtcIso(local);
        if (!iso) {
          skipped++;
          continue;
        }
        const res = await contentApi.updateStatus(d.briefId, 'scheduled', {
          scheduled_date: iso,
        });
        if (res.success) ok++;
        else skipped++;
      }
      if (ok > 0) {
        toast.success(`Scheduled ${ok} post(s)${skipped ? ` (${skipped} skipped)` : ''}`);
      } else {
        toast.error(
          skipped ? 'Could not schedule — check go-live times and try again' : 'Nothing to schedule',
        );
      }
    } finally {
      setBulkScheduling(false);
    }
  };

  const saveDraftEdits = async () => {
    if (!draftEdit) return;
    const { index, content, hashtagsText } = draftEdit;
    const row = generatedDrafts[index];
    if (!row) return;

    const hashtags = parseHashtagInput(hashtagsText);

    if (row.draftId) {
      const res = await contentApi.updateDraft(row.briefId, row.draftId, {
        content,
        suggested_hashtags: hashtags,
      });
      if (!res.success) {
        toast.error(res.error ?? 'Could not save draft');
        return;
      }
    }

    setGeneratedDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, content, hashtags } : d)),
    );
    toast.success(row.draftId ? 'Draft saved' : 'Draft updated locally');
    setDraftEdit(null);
  };

  return (
    <div className="space-y-6">
      <Dialog
        open={draftEdit !== null}
        onOpenChange={(open) => {
          if (!open) setDraftEdit(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit draft</DialogTitle>
          </DialogHeader>
          {draftEdit && (
            <div className="space-y-3 overflow-y-auto py-2">
              {draftEdit.imageUrl ? (
                <div className="max-h-40 overflow-hidden rounded-md border">
                  <img
                    src={draftEdit.imageUrl}
                    alt=""
                    className="max-h-40 w-full object-contain"
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label className="text-xs">Post body</Label>
                <Textarea
                  value={draftEdit.content}
                  onChange={(e) =>
                    setDraftEdit((p) => (p ? { ...p, content: e.target.value } : null))
                  }
                  rows={12}
                  className="text-sm min-h-[200px] resize-y"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hashtags (space-separated)</Label>
                <Textarea
                  value={draftEdit.hashtagsText}
                  onChange={(e) =>
                    setDraftEdit((p) => (p ? { ...p, hashtagsText: e.target.value } : null))
                  }
                  rows={2}
                  placeholder="#example #hashtags"
                  className="text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDraftEdit(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveDraftEdits()}>
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            <CardTitle>Strategic Content Agent</CardTitle>
          </div>
          <CardDescription>
            AI-powered content pipeline — create, review, and publish strategic content across platforms
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="create" className="gap-1">
                <Wand2 className="w-4 h-4" /> Create
              </TabsTrigger>
              <TabsTrigger value="ledger" className="gap-1">
                <FileText className="w-4 h-4" /> Ledger
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1">
                <Calendar className="w-4 h-4" /> Calendar
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-1">
                <BookOpen className="w-4 h-4" /> Knowledge
              </TabsTrigger>
            </TabsList>

            {/* ── Create Tab (multi-select wizard) ── */}
            <TabsContent value="create" className="mt-6 space-y-6">
              <WizardStep step={1} title="Platforms (multi-select)" isActive={currentStep >= 1} isComplete={stepComplete(1)}>
                <MultiOptionGrid
                  options={PLATFORMS}
                  values={wizard.platforms}
                  onChange={(ids) => {
                    setWizard((p) => ({ ...p, platforms: ids as PlatformId[] }));
                    if (ids.length > 0 && currentStep === 1) setCurrentStep(2);
                  }}
                />
                {wizard.platforms.length > 1 && (
                  <p className="text-xs text-purple-600 mt-2">
                    {wizard.platforms.length} platforms selected — will generate a draft per platform × audience combo
                  </p>
                )}
              </WizardStep>

              <WizardStep step={2} title="Topic" isActive={currentStep >= 2} isComplete={stepComplete(2)}>
                <OptionGrid
                  options={TOPICS}
                  value={wizard.topic}
                  onChange={(id) => {
                    setWizard((p) => ({ ...p, topic: id as TopicId }));
                    if (currentStep === 2) setCurrentStep(3);
                  }}
                />
              </WizardStep>

              <WizardStep step={3} title="Audiences (multi-select)" isActive={currentStep >= 3} isComplete={stepComplete(3)}>
                <MultiOptionGrid
                  options={AUDIENCES}
                  values={wizard.audiences}
                  onChange={(ids) => {
                    setWizard((p) => ({ ...p, audiences: ids as AudienceId[] }));
                    if (ids.length > 0 && currentStep === 3) setCurrentStep(4);
                  }}
                />
                {wizard.audiences.length > 1 && (
                  <p className="text-xs text-purple-600 mt-2">
                    {wizard.audiences.length} audiences selected
                  </p>
                )}
              </WizardStep>

              <WizardStep step={4} title="Tone" isActive={currentStep >= 4} isComplete={stepComplete(4)}>
                <OptionGrid
                  options={TONES}
                  value={wizard.tone}
                  onChange={(id) => {
                    setWizard((p) => ({ ...p, tone: id as ToneId }));
                    if (currentStep === 4) setCurrentStep(5);
                  }}
                />
              </WizardStep>

              <WizardStep step={5} title="Brand Voice" isActive={currentStep >= 5} isComplete={stepComplete(5)}>
                <OptionGrid
                  options={BRAND_VOICES}
                  value={wizard.brandVoice}
                  onChange={(id) => {
                    setWizard((p) => ({ ...p, brandVoice: id as BrandVoiceId }));
                    if (currentStep === 5) setCurrentStep(6);
                  }}
                />
              </WizardStep>

              <WizardStep step={6} title="Call to Action" isActive={currentStep >= 6} isComplete={stepComplete(6)}>
                <OptionGrid
                  options={CTA_TYPES}
                  value={wizard.ctaType}
                  onChange={(id) => {
                    setWizard((p) => ({ ...p, ctaType: id as CtaTypeId }));
                    if (currentStep === 6) setCurrentStep(7);
                  }}
                />
                {wizard.ctaType && wizard.ctaType !== 'none' && (
                  <div className="mt-3 space-y-1">
                    <Label className="text-xs">CTA Link (optional)</Label>
                    <Input
                      value={wizard.ctaLink}
                      onChange={(e) => setWizard((p) => ({ ...p, ctaLink: e.target.value }))}
                      placeholder="https://enterprise.io/..."
                    />
                  </div>
                )}
              </WizardStep>

              {currentStep >= 7 && (
                <div className="ml-9 space-y-4 pt-2 border-t">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Story Hook (optional)</Label>
                    <Textarea
                      value={wizard.storyHook}
                      onChange={(e) => setWizard((p) => ({ ...p, storyHook: e.target.value }))}
                      placeholder="A specific story, case study, or angle to weave in..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Additional Context (optional)</Label>
                    <Textarea
                      value={wizard.customContext}
                      onChange={(e) => setWizard((p) => ({ ...p, customContext: e.target.value }))}
                      placeholder="Any extra context, links, data points..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Quick-set go-live — same date &amp; time for every draft (optional)</Label>
                    <div className="flex flex-wrap items-end gap-2">
                      <Input
                        type="datetime-local"
                        className="max-w-[240px]"
                        value={wizard.scheduledDate}
                        onChange={(e) => setWizard((p) => ({ ...p, scheduledDate: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={generatedDrafts.length === 0}
                        onClick={() => applyWizardScheduleToAllDrafts()}
                      >
                        Apply to all drafts
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Values are US Eastern dates &amp; times. Rows below override this when set. When both stay empty,
                      times default to staggered Eastern slots (+1 hour per draft).
                    </p>
                  </div>

                  {wizard.platforms.length > 0 && wizard.audiences.length > 0 && (
                    <div className="space-y-2 rounded-md border bg-slate-50/90 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-xs font-semibold leading-tight">
                          Go-live time per upcoming draft ({plannedWizardCombos.length} slot
                          {plannedWizardCombos.length !== 1 ? 's' : ''})
                        </Label>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!wizard.scheduledDate.trim()}
                            onClick={() => {
                              const v = wizard.scheduledDate.trim();
                              setWizard((p) => {
                                const combosNow = plannedDraftCombos(p.platforms, p.audiences);
                                const nextRows = { ...p.perDraftScheduleByCombo };
                                for (const c of combosNow) {
                                  nextRows[wizardComboScheduleKey(c.platform, c.audience)] = v;
                                }
                                return { ...p, perDraftScheduleByCombo: nextRows };
                              });
                              toast.success('Copied quick-set time into each row');
                            }}
                          >
                            Copy quick-set to rows
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={plannedWizardCombos.length === 0}
                            onClick={() => {
                              const combosNow = plannedWizardCombos;
                              if (combosNow.length === 0) return;
                              const pad = (n: number) => String(n).padStart(2, '0');
                              const baseNy = addDays(toZonedTime(new Date(), CONTENT_SCHEDULE_TZ), 1);
                              baseNy.setHours(9, 0, 0, 0);
                              setWizard((p) => {
                                const nextRows = { ...p.perDraftScheduleByCombo };
                                combosNow.forEach((c, i) => {
                                  const d = addHours(baseNy, i);
                                  const k = wizardComboScheduleKey(c.platform, c.audience);
                                  nextRows[k] = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                });
                                return { ...p, perDraftScheduleByCombo: nextRows };
                              });
                              toast.success(`Set ${combosNow.length} staggered time(s)`);
                            }}
                          >
                            Stagger +1 hr
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 max-h-[min(40vh,280px)] overflow-y-auto pr-1">
                        {plannedWizardCombos.map((c, i) => {
                          const k = wizardComboScheduleKey(c.platform, c.audience);
                          const platLabel = PLATFORMS.find((p) => p.id === c.platform)?.label ?? c.platform;
                          const audLabel = AUDIENCES.find((a) => a.id === c.audience)?.label ?? c.audience;
                          return (
                            <div
                              key={k}
                              className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200/80 bg-white px-2 py-1.5"
                            >
                              <span className="text-xs text-muted-foreground min-w-[7rem] shrink-0">
                                {i + 1}. {platLabel}
                              </span>
                              <span className="text-xs text-slate-600 shrink-0">→ {audLabel}</span>
                              <Input
                                type="datetime-local"
                                className="h-8 max-w-[220px] text-xs ml-auto"
                                value={wizard.perDraftScheduleByCombo[k] ?? ''}
                                onChange={(e) =>
                                  setWizard((p) => ({
                                    ...p,
                                    perDraftScheduleByCombo: {
                                      ...p.perDraftScheduleByCombo,
                                      [k]: e.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        These apply as soon as you generate. You can still adjust each card afterward; use &quot;Schedule all&quot; to
                        push every card&apos;s picker to Aerostack at once.
                      </p>
                    </div>
                  )}

                  {wizard.platforms.length > 0 && wizard.audiences.length > 0 && (
                    <div className="text-xs text-muted-foreground bg-slate-50 p-2 rounded">
                      Will generate {wizard.platforms.length * wizard.audiences.length} draft{wizard.platforms.length * wizard.audiences.length > 1 ? 's' : ''}{' '}
                      ({wizard.platforms.length} platform{wizard.platforms.length > 1 ? 's' : ''} × {wizard.audiences.length} audience{wizard.audiences.length > 1 ? 's' : ''})
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleGenerate}
                      disabled={!allStepsComplete || isGenerating}
                      className="flex-1 bg-purple-600 hover:bg-purple-700"
                    >
                      {isGenerating ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-2" />
                      )}
                      {isGenerating ? 'Generating...' : 'Generate Content'}
                    </Button>
                    <Button variant="outline" onClick={handleReset}>
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Generated drafts */}
              {generatedDrafts.length > 0 && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="font-semibold text-sm">
                        {generatedDrafts.length} Draft{generatedDrafts.length > 1 ? 's' : ''} Generated
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      disabled={bulkScheduling || generatedDrafts.length === 0}
                      onClick={() => void scheduleAllWizardDrafts()}
                    >
                      {bulkScheduling ? (
                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      ) : (
                        <Calendar className="w-3 h-3 mr-2" />
                      )}
                      Schedule all ({generatedDrafts.length})
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground -mt-2">
                    Uses each draft&apos;s go-live time shown on its card below.
                  </p>
                  {generatedDrafts.map((draft, idx) => {
                    const platLabel = PLATFORMS.find((p) => p.id === draft.platform)?.label ?? draft.platform;
                    return (
                      <Card key={`${draft.briefId}-${idx}`} className="shadow-none">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="text-xs">{platLabel}</Badge>
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const fullText = draft.hashtags.length > 0
                                    ? `${draft.content}\n\n${draft.hashtags.join(' ')}`
                                    : draft.content;
                                  navigator.clipboard.writeText(fullText);
                                  toast.success('Copied');
                                }}
                              >
                                <Copy className="w-3 h-3 mr-1" /> Copy
                              </Button>
                              {draft.platform === 'linkedin' && draft.draftId && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="bg-[#0A66C2] hover:bg-[#004182] text-white border-0"
                                  disabled={
                                    linkedinWizardKey === `${draft.briefId}:${draft.draftId}`
                                  }
                                  onClick={async () => {
                                    const key = `${draft.briefId}:${draft.draftId}`;
                                    setLinkedinWizardKey(key);
                                    try {
                                      const res = await contentApi.postToLinkedIn(draft.briefId, {
                                        draftId: draft.draftId,
                                      });
                                      if (!res.success) {
                                        toast.error(res.error ?? 'LinkedIn post failed');
                                        return;
                                      }
                                      toast.success('Posted to LinkedIn and marked published in Aerostack');
                                    } finally {
                                      setLinkedinWizardKey(null);
                                    }
                                  }}
                                >
                                  {linkedinWizardKey === `${draft.briefId}:${draft.draftId}` ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <Linkedin className="w-3 h-3 mr-1" />
                                  )}
                                  Post to LinkedIn
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-lg border whitespace-pre-wrap text-sm leading-relaxed">
                            {draft.content}
                          </div>
                          {draft.hashtags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {draft.hashtags.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                              ))}
                            </div>
                          )}
                          <DraftImageSection
                            briefId={draft.briefId}
                            draftId={draft.draftId}
                            content={draft.content}
                            hashtags={draft.hashtags}
                            imageUrl={draft.imageUrl}
                            disabled={!draft.draftId}
                            onImageUrlChange={(url) =>
                              setGeneratedDrafts((prev) =>
                                prev.map((row, j) =>
                                  j === idx ? { ...row, imageUrl: url ?? undefined } : row,
                                ),
                              )
                            }
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <Label className="text-xs text-muted-foreground shrink-0">Go-live</Label>
                            <Input
                              type="datetime-local"
                              className="h-8 max-w-[220px] text-xs"
                              value={scheduleLocalByBriefId[draft.briefId] ?? ''}
                              onChange={(e) =>
                                setScheduleLocalByBriefId((prev) => ({
                                  ...prev,
                                  [draft.briefId]: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDraftEdit({
                                  index: idx,
                                  content: draft.content,
                                  hashtagsText: draft.hashtags.join(' '),
                                  imageUrl: draft.imageUrl,
                                })
                              }
                            >
                              <Pencil className="w-3 h-3 mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={async () => {
                                await contentApi.updateStatus(draft.briefId, 'approved');
                                toast.success('Approved');
                              }}
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const iso = scheduleDateOrDateOnlyToUtcIso(
                                  (scheduleLocalByBriefId[draft.briefId] ?? '').trim(),
                                );
                                if (!iso) {
                                  toast.error('Set go-live date and time on this draft');
                                  return;
                                }
                                const res = await contentApi.updateStatus(draft.briefId, 'scheduled', {
                                  scheduled_date: iso,
                                });
                                if (!res.success) {
                                  toast.error(res.error ?? 'Could not schedule');
                                  return;
                                }
                                toast.success('Scheduled for the calendar');
                              }}
                            >
                              <Calendar className="w-3 h-3 mr-1" /> Schedule
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-purple-700 border-purple-200"
                              onClick={async () => {
                                const res = await contentApi.updateStatus(draft.briefId, 'published');
                                if (!res.success) {
                                  toast.error(res.error ?? 'Could not mark published');
                                  return;
                                }
                                toast.success('Marked published — saved to prior-content KB');
                              }}
                            >
                              <Send className="w-3 h-3 mr-1" /> Mark as published
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Ledger Tab ── */}
            <TabsContent value="ledger" className="mt-6">
              <ContentLedger />
            </TabsContent>

            {/* ── Calendar Tab ── */}
            <TabsContent value="calendar" className="mt-6">
              <DualCalendar />
            </TabsContent>

            {/* ── Knowledge Tab ── */}
            <TabsContent value="knowledge" className="mt-6">
              <KnowledgeBasePanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
