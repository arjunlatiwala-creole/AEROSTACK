import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Users,
    Plus,
    ChevronRight,
    Clock,
    UserCheck,
    FileText,
    Phone,
    Mail,
    ArrowRight,
    RefreshCw,
    Loader2,
    X,
} from "lucide-react";
import Loader from "@/components/Loader";
import JobRecsManager from "@/components/aerostack/hiring/JobRecsManager";
import CompPlanEditor from "@/components/aerostack/hiring/CompPlanEditor";
import DeelPushPanel from "@/components/aerostack/hiring/DeelPushPanel";
import {
    listCandidates,
    createCandidate,
    advanceStage,
    createNote,
    getPipelineMetrics,
    getResumeDownloadUrl,
    type Candidate,
    type CandidateNote,
    type PipelineMetrics,
} from "@/api/hiring";

/** Pipeline stages in display order */
const PIPELINE_STAGES = [
    { key: "SUBMISSION", label: "Submission", color: "bg-slate-500" },
    { key: "REFERRAL", label: "Referral", color: "bg-cyan-500" },
    { key: "FIRST_TOUCH", label: "First Touch", color: "bg-blue-500" },
    { key: "QUALIFIED", label: "Qualified", color: "bg-emerald-500" },
    { key: "NDA", label: "NDA", color: "bg-indigo-500" },
    { key: "TEAM_FIT", label: "Team Fit", color: "bg-violet-500" },
    { key: "SKILLS_FIT", label: "Skills Fit", color: "bg-purple-500" },
    { key: "PROPOSAL", label: "Proposal", color: "bg-fuchsia-500" },
    { key: "NEGOTIATION", label: "Negotiation", color: "bg-pink-500" },
    { key: "DEEL_SETUP", label: "Deel Setup", color: "bg-orange-500" },
    { key: "JOB_OFFER", label: "Job Offer", color: "bg-rose-500" },
    { key: "SIGNING", label: "Signing", color: "bg-teal-500" },
    {
        key: "GOOGLE_WORKSPACE_CREATION",
        label: "Workspace",
        color: "bg-amber-500",
    },
    {
        key: "ONBOARDING_ASSIGNED",
        label: "Onboarding",
        color: "bg-yellow-500",
    },
    { key: "HIRED", label: "Hired", color: "bg-green-600" },
] as const;

const EXIT_STAGES = [
    { key: "REFER_OUT", label: "Referred Out", color: "bg-gray-400" },
    { key: "RECYCLE", label: "Recycled", color: "bg-amber-400" },
    { key: "BLACKBALLED", label: "Blackballed", color: "bg-red-400" },
] as const;

const STAGE_TRANSITIONS: Record<string, string[]> = {
    SUBMISSION: ["REFERRAL", "FIRST_TOUCH"],
    REFERRAL: ["FIRST_TOUCH"],
    FIRST_TOUCH: ["QUALIFIED", "NDA", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    QUALIFIED: ["NDA", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    NDA: ["TEAM_FIT", "SKILLS_FIT"],
    TEAM_FIT: ["SKILLS_FIT", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    SKILLS_FIT: ["TEAM_FIT", "PROPOSAL", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    PROPOSAL: ["NEGOTIATION"],
    NEGOTIATION: ["DEEL_SETUP", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    DEEL_SETUP: ["JOB_OFFER"],
    JOB_OFFER: ["SIGNING", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    SIGNING: ["GOOGLE_WORKSPACE_CREATION", "NEGOTIATION", "REFER_OUT", "RECYCLE", "BLACKBALLED"],
    GOOGLE_WORKSPACE_CREATION: ["ONBOARDING_ASSIGNED"],
    ONBOARDING_ASSIGNED: ["HIRED"],
    REFER_OUT: ["FIRST_TOUCH"],
    RECYCLE: ["FIRST_TOUCH"],
    BLACKBALLED: [],
};

function getStageMeta(stageKey: string) {
    return (
        [...PIPELINE_STAGES, ...EXIT_STAGES].find((s) => s.key === stageKey) ?? {
            key: stageKey,
            label: stageKey,
            color: "bg-gray-500",
        }
    );
}

const PAGE_SIZE = 20;
const BOARD_STAGE_LIMIT = 5;

/** Resolve the logged-in user's display name from the JWT. */
async function resolveActorName(): Promise<string> {
    try {
        const session = await fetchAuthSession({ forceRefresh: false });
        const payload = session.tokens?.idToken?.payload;
        if (!payload) return "unknown";
        const given = payload.given_name as string | undefined;
        const family = payload.family_name as string | undefined;
        if (given || family) return `${given ?? ""} ${family ?? ""}`.trim();
        return (payload.email as string) ?? "unknown";
    } catch {
        return "unknown";
    }
}

export default function HiringPipelineBoard() {
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshingCandidates, setRefreshingCandidates] = useState(false);
    const [refreshingMetrics, setRefreshingMetrics] = useState(false);
    const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
        null,
    );
    const [showAddForm, setShowAddForm] = useState(false);
    const [advancing, setAdvancing] = useState(false);
    const [viewMode, setViewMode] = useState<"board" | "list">("list");

    // List view pagination — cursor stack for page navigation
    const [listCursor, setListCursor] = useState<string | null>(null);
    const [listHasMore, setListHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursorStack, setCursorStack] = useState<string[]>([]);
    const [pageSize, setPageSize] = useState(20);
    const [totalPages, setTotalPages] = useState(1);

    // Board view: per-stage expanded state
    const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

    // Stage filter — empty string means "all"
    const [stageFilter, setStageFilter] = useState<string>("");
    const stageFilterRef = useRef("");

    // Current user's display name for audit trail
    const actorNameRef = useRef("system");
    useEffect(() => {
        resolveActorName().then((name) => { actorNameRef.current = name; });
    }, []);

    const loadCandidates = useCallback(async (isRefresh = false, filterStage?: string, cursor?: string | null) => {
        if (isRefresh) setRefreshingCandidates(true);
        try {
            const stage = filterStage !== undefined ? filterStage : stageFilterRef.current;
            const res = await listCandidates({
                limit: pageSize,
                ...(stage ? { stage } : {}),
                ...(cursor ? { cursor } : {}),
            });
            const data = res.data;
            setCandidates(data?.candidates ?? []);
            setListCursor(data?.nextCursor ?? null);
            setListHasMore(data?.hasMore ?? false);
            // Estimate total pages from metrics
            const total = metrics?.totalCandidates ?? (data?.candidates?.length ?? 0);
            setTotalPages(Math.max(1, Math.ceil(total / pageSize)));
            if (!isRefresh) setExpandedStages(new Set());
        } catch (error) {
            console.error("Error loading candidates:", error);
        } finally {
            if (isRefresh) setRefreshingCandidates(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize, metrics?.totalCandidates]);

    const loadMetrics = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshingMetrics(true);
        try {
            const res = await getPipelineMetrics();
            setMetrics(res.data ?? null);
        } catch (error) {
            console.error("Error loading metrics:", error);
        } finally {
            if (isRefresh) setRefreshingMetrics(false);
        }
    }, []);

    // Initial load — full spinner only on first mount
    useEffect(() => {
        const init = async () => {
            setInitialLoading(true);
            await Promise.all([loadCandidates(), loadMetrics()]);
            setInitialLoading(false);
        };
        init();
    }, [loadCandidates, loadMetrics]);

    // Refresh — inline spinners, data stays visible
    const handleRefresh = useCallback(() => {
        loadCandidates(true);
        loadMetrics(true);
    }, [loadCandidates, loadMetrics]);

    // Filter change — only refreshes candidates, not the whole component
    const handleFilterChange = useCallback((value: string) => {
        const newFilter = value === "all" ? "" : value;
        setStageFilter(newFilter);
        stageFilterRef.current = newFilter;
        setListCursor(null);
        setListHasMore(false);
        setCursorStack([]);
        loadCandidates(true, newFilter);
    }, [loadCandidates]);

    const handleNextPage = async () => {
        if (!listCursor) return;
        setLoadingMore(true);
        try {
            setCursorStack((prev) => [...prev, listCursor]);
            await loadCandidates(true, undefined, listCursor);
        } finally {
            setLoadingMore(false);
        }
    };

    const handlePreviousPage = async () => {
        if (cursorStack.length === 0) return;
        setLoadingMore(true);
        try {
            const newStack = [...cursorStack];
            newStack.pop();
            const prevCursor = newStack.length > 0 ? newStack[newStack.length - 1] : null;
            setCursorStack(newStack);
            await loadCandidates(true, undefined, prevCursor ?? undefined);
        } finally {
            setLoadingMore(false);
        }
    };

    const handlePageSizeChange = (newSize: number) => {
        setPageSize(newSize);
        setCursorStack([]);
        setListCursor(null);
        loadCandidates(true);
    };

    const handleAdvanceStage = async (
        candidateId: string,
        targetStage: string,
    ) => {
        setAdvancing(true);
        try {
            await advanceStage(candidateId, { stage: targetStage, actor: actorNameRef.current });
            // Refresh both sections silently
            loadCandidates(true);
            loadMetrics(true);
            if (selectedCandidate?.candidateId === candidateId) {
                const updated = (await listCandidates({ limit: 100 })).data?.candidates?.find(
                    (c: Candidate) => c.candidateId === candidateId,
                );
                if (updated) setSelectedCandidate(updated);
            }
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : "Failed to advance stage";
            alert(message);
        } finally {
            setAdvancing(false);
        }
    };

    const handleAddCandidate = async (formData: {
        name: string;
        email: string;
        phone?: string;
        source?: string;
        referralType?: string;
        referredBy?: string;
        notes?: string;
    }) => {
        try {
            const result = await createCandidate({
                ...formData,
                ownerId: undefined,
                submittedBy: actorNameRef.current,
            });
            // If initial notes were provided, also create a note entry so it shows in the notes section
            if (formData.notes && result.data?.candidateId) {
                await createNote(result.data.candidateId, {
                    content: formData.notes,
                    authorName: actorNameRef.current,
                    noteType: "initial",
                });
            }
            setShowAddForm(false);
            handleRefresh();
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : "Failed to add candidate";
            alert(message);
        }
    };

    const toggleStageExpand = (stageKey: string) => {
        setExpandedStages((prev) => {
            const next = new Set(prev);
            if (next.has(stageKey)) next.delete(stageKey);
            else next.add(stageKey);
            return next;
        });
    };

    if (initialLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader description="Loading Hiring Pipeline..." />
            </div>
        );
    }

    return (
        <div>
            {/* Metrics Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card className={`shadow-none transition-opacity ${refreshingMetrics ? "opacity-60" : ""}`}>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-1">
                            Total Candidates
                            {refreshingMetrics && <Loader2 className="w-3 h-3 animate-spin" />}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold">
                            {metrics?.totalCandidates ?? 0}
                        </div>
                    </CardContent>
                </Card>
                <Card className={`shadow-none transition-opacity ${refreshingMetrics ? "opacity-60" : ""}`}>
                    <CardHeader className="pb-2">
                        <CardDescription>Active Pipeline</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold text-blue-600">
                            {metrics?.totalActive ?? 0}
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-none">
                    <CardHeader className="pb-2">
                        <CardDescription>Hired</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold text-green-600">
                            {metrics?.totalHired ?? 0}
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-none">
                    <CardHeader className="pb-2">
                        <CardDescription>Exited</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-bold text-muted-foreground">
                            {metrics?.totalExited ?? 0}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Controls */}
            <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
                <div className="flex gap-2 items-center">
                    <Button
                        variant={viewMode === "list" ? "default" : "outline"}
                        onClick={() => setViewMode("list")}
                        size="sm"
                    >
                        List
                    </Button>
                    <Button
                        variant={viewMode === "board" ? "default" : "outline"}
                        onClick={() => setViewMode("board")}
                        size="sm"
                    >
                        Board
                    </Button>
                    <Select value={stageFilter || "all"} onValueChange={handleFilterChange}>
                        <SelectTrigger className="w-[160px] h-8 text-xs">
                            <SelectValue placeholder="All Stages" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Stages</SelectItem>
                            {PIPELINE_STAGES.map((s) => (
                                <SelectItem key={s.key} value={s.key}>
                                    <span className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${s.color}`} />
                                        {s.label}
                                    </span>
                                </SelectItem>
                            ))}
                            {EXIT_STAGES.map((s) => (
                                <SelectItem key={s.key} value={s.key}>
                                    <span className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${s.color}`} />
                                        {s.label}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {stageFilter && (
                        <Button variant="ghost" size="sm" className="text-xs h-8 px-2" onClick={() => handleFilterChange("all")}>
                            Clear
                        </Button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshingCandidates}>
                        <RefreshCw className={`w-4 h-4 mr-1 ${refreshingCandidates ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                    <Button size="sm" onClick={() => setShowAddForm(true)}>
                        <Plus className="w-4 h-4 mr-1" /> Add Candidate
                    </Button>
                </div>
            </div>

            {/* List View — shown first */}
            {viewMode === "list" && (
                <Card className={`shadow-none transition-opacity ${refreshingCandidates ? "opacity-60" : ""}`}>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left p-3 font-medium">Name</th>
                                        <th className="text-left p-3 font-medium">Email</th>
                                        <th className="text-left p-3 font-medium">Stage</th>
                                        <th className="text-left p-3 font-medium">Source</th>
                                        <th className="text-left p-3 font-medium">Created</th>
                                        <th className="text-left p-3 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {candidates.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={6}
                                                className="text-center py-12 text-muted-foreground"
                                            >
                                                <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                                No candidates yet
                                            </td>
                                        </tr>
                                    ) : (
                                        candidates.map((candidate) => {
                                            const stageMeta = getStageMeta(candidate.stage);
                                            return (
                                                <tr
                                                    key={candidate.candidateId}
                                                    className="border-b hover:bg-muted/50 cursor-pointer"
                                                    onClick={() => setSelectedCandidate(candidate)}
                                                >
                                                    <td className="p-3 font-medium">
                                                        {candidate.name}
                                                    </td>
                                                    <td className="p-3 text-muted-foreground">
                                                        {candidate.email}
                                                    </td>
                                                    <td className="p-3">
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-xs"
                                                        >
                                                            <div
                                                                className={`w-2 h-2 rounded-full ${stageMeta.color} mr-1`}
                                                            />
                                                            {stageMeta.label}
                                                        </Badge>
                                                    </td>
                                                    <td className="p-3 text-muted-foreground capitalize">
                                                        {candidate.source}
                                                    </td>
                                                    <td className="p-3 text-muted-foreground">
                                                        {new Date(
                                                            candidate.createdAt,
                                                        ).toLocaleDateString()}
                                                    </td>
                                                    <td className="p-3">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedCandidate(candidate);
                                                            }}
                                                        >
                                                            View
                                                        </Button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {/* Pagination — RevOps style */}
                        <div className="border-t bg-card px-4 py-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm text-muted-foreground">
                                    Showing {candidates.length} of {metrics?.totalCandidates ?? candidates.length} candidates
                                </div>
                                <div className="flex items-center gap-4">
                                    <select
                                        value={pageSize}
                                        onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                        className="rounded border px-2 py-1 text-sm cursor-pointer"
                                    >
                                        {[20, 50, 100].map((s) => (
                                            <option key={s} value={s}>
                                                {s} / page
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                                        Page {cursorStack.length + 1} of {totalPages}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            disabled={cursorStack.length === 0 || loadingMore}
                                            onClick={handlePreviousPage}
                                            className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            ◀
                                        </button>
                                        <button
                                            disabled={!listHasMore || loadingMore}
                                            onClick={handleNextPage}
                                            className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            ▶
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Board View */}
            {viewMode === "board" && (
                <>
                    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 transition-opacity ${refreshingCandidates ? "opacity-60" : ""}`}>
                        {[...PIPELINE_STAGES, ...EXIT_STAGES].map((stage) => {
                            const stageCandidates = candidates.filter(
                                (c) => c.stage === stage.key,
                            );
                            const isExpanded = expandedStages.has(stage.key);
                            const visible = isExpanded
                                ? stageCandidates
                                : stageCandidates.slice(0, BOARD_STAGE_LIMIT);
                            const hiddenCount = stageCandidates.length - BOARD_STAGE_LIMIT;

                            return (
                                <div key={stage.key}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <div
                                            className={`w-3 h-3 rounded-full ${stage.color}`}
                                        />
                                        <span className="text-xs font-semibold truncate">
                                            {stage.label}
                                        </span>
                                        <Badge variant="secondary" className="ml-auto text-xs">
                                            {metrics?.byStage[stage.key] ?? stageCandidates.length}
                                        </Badge>
                                    </div>
                                    <div className="space-y-2 min-h-[80px]">
                                        {visible.map((candidate) => (
                                            <Card
                                                key={candidate.candidateId}
                                                className="shadow-none cursor-pointer hover:shadow-md transition-shadow border-l-4"
                                                style={{
                                                    borderLeftColor: `var(--color-primary)`,
                                                }}
                                                onClick={() => setSelectedCandidate(candidate)}
                                            >
                                                <CardContent className="p-3">
                                                    <div className="font-medium text-sm truncate">
                                                        {candidate.name}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground truncate mt-1">
                                                        {candidate.email}
                                                    </div>
                                                    {candidate.source && (
                                                        <Badge
                                                            variant="outline"
                                                            className="mt-2 text-[10px]"
                                                        >
                                                            {candidate.source}
                                                        </Badge>
                                                    )}
                                                    {candidate.referralType && (
                                                        <Badge
                                                            variant={candidate.referralType === "personal" ? "default" : "secondary"}
                                                            className="mt-1 ml-1 text-[10px]"
                                                        >
                                                            {candidate.referralType}
                                                        </Badge>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        ))}
                                        {stageCandidates.length === 0 && (
                                            <div className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded-lg">
                                                No candidates
                                            </div>
                                        )}
                                        {!isExpanded && hiddenCount > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full text-xs"
                                                onClick={() => toggleStageExpand(stage.key)}
                                            >
                                                +{hiddenCount} more
                                            </Button>
                                        )}
                                        {isExpanded && hiddenCount > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full text-xs"
                                                onClick={() => toggleStageExpand(stage.key)}
                                            >
                                                Show less
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Board Pagination */}
                    <div className="border rounded-lg bg-card px-4 py-3 mt-4">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-muted-foreground">
                                Showing {candidates.length} of {metrics?.totalCandidates ?? candidates.length} candidates
                            </div>
                            <div className="flex items-center gap-4">
                                <select
                                    value={pageSize}
                                    onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                    className="rounded border px-2 py-1 text-sm cursor-pointer"
                                >
                                    {[20, 50, 100].map((s) => (
                                        <option key={s} value={s}>
                                            {s} / page
                                        </option>
                                    ))}
                                </select>
                                <div className="text-sm text-muted-foreground whitespace-nowrap">
                                    Page {cursorStack.length + 1} of {totalPages}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        disabled={cursorStack.length === 0 || loadingMore}
                                        onClick={handlePreviousPage}
                                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        ◀
                                    </button>
                                    <button
                                        disabled={!listHasMore || loadingMore}
                                        onClick={handleNextPage}
                                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        ▶
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )
            }

            {/* Job Postings Manager */}
            <div className="mt-8 pt-6 border-t">
                <JobRecsManager />
            </div>

            {/* Candidate Detail Dialog */}
            <CandidateDetailDialog
                candidate={selectedCandidate}
                onClose={() => setSelectedCandidate(null)}
                onAdvanceStage={handleAdvanceStage}
                advancing={advancing}
                actorName={actorNameRef.current}
            />

            {/* Add Candidate Dialog */}
            <AddCandidateDialog
                open={showAddForm}
                onClose={() => setShowAddForm(false)}
                onSubmit={handleAddCandidate}
            />
        </div >
    );
}

/* ─── Candidate Detail Dialog ─── */

function CandidateDetailDialog({
    candidate,
    onClose,
    onAdvanceStage,
    advancing,
    actorName,
}: {
    candidate: Candidate | null;
    onClose: () => void;
    onAdvanceStage: (candidateId: string, stage: string) => void;
    advancing: boolean;
    actorName: string;
}) {
    const [noteContent, setNoteContent] = useState("");
    const [addingNote, setAddingNote] = useState(false);
    const [notes, setNotes] = useState<CandidateNote[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // Fetch full candidate detail (with notes) when dialog opens
    useEffect(() => {
        if (!candidate) { setNotes([]); return; }
        let cancelled = false;
        const fetchDetail = async () => {
            setLoadingDetail(true);
            try {
                const { getCandidate } = await import("@/api/hiring");
                const res = await getCandidate(candidate.candidateId);
                if (cancelled) return;
                const data = res.data ?? res;
                const fetchedNotes = Array.isArray(data.notes) ? data.notes as CandidateNote[] : [];
                setNotes(fetchedNotes);
            } catch {
                if (!cancelled) setNotes([]);
            } finally {
                if (!cancelled) setLoadingDetail(false);
            }
        };
        fetchDetail();
        return () => { cancelled = true; };
    }, [candidate?.candidateId]);

    if (!candidate) return null;

    const stageMeta = getStageMeta(candidate.stage);
    const allowedTransitions = STAGE_TRANSITIONS[candidate.stage] ?? [];

    const handleAddNote = async () => {
        if (!noteContent.trim()) return;
        setAddingNote(true);
        try {
            const res = await createNote(candidate.candidateId, {
                content: noteContent,
                authorName: actorName,
            });
            // Append the new note locally so it shows immediately
            if (res.data) {
                setNotes((prev) => [res.data, ...prev]);
            }
            setNoteContent("");
        } catch (error) {
            console.error("Error adding note:", error);
        } finally {
            setAddingNote(false);
        }
    };

    return (
        <Dialog open={!!candidate} onOpenChange={onClose}>
            <DialogContent className="!max-w-3xl w-full max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl flex items-center gap-3">
                        {candidate.name}
                        <Badge variant="secondary">
                            <div
                                className={`w-2 h-2 rounded-full ${stageMeta.color} mr-1`}
                            />
                            {stageMeta.label}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        {candidate.email}
                    </div>
                    {candidate.phone && (
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            {candidate.phone}
                        </div>
                    )}
                    <div>
                        <span className="text-xs text-muted-foreground">Source</span>
                        <div className="text-sm capitalize">{candidate.source}</div>
                    </div>
                    {candidate.referredBy && (
                        <div>
                            <span className="text-xs text-muted-foreground">
                                Referred By
                            </span>
                            <div className="text-sm">{candidate.referredBy}</div>
                        </div>
                    )}
                    {candidate.referralType && (
                        <div>
                            <span className="text-xs text-muted-foreground">
                                Referral Type
                            </span>
                            <div className="text-sm capitalize">{candidate.referralType}</div>
                        </div>
                    )}
                    <div>
                        <span className="text-xs text-muted-foreground">Created</span>
                        <div className="text-sm">
                            {new Date(candidate.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                    <div>
                        <span className="text-xs text-muted-foreground">
                            Last Updated
                        </span>
                        <div className="text-sm">
                            {new Date(candidate.updatedAt).toLocaleDateString()}
                        </div>
                    </div>
                </div>

                {/* Resume */}
                {candidate.resumeS3Key && (
                    <ResumeLink s3Key={candidate.resumeS3Key} />
                )}

                {/* Stage Timeline */}
                {candidate.stageHistory && candidate.stageHistory.length > 0 && (
                    <div className="mt-6">
                        <h4 className="text-sm font-semibold mb-3">Stage History</h4>
                        <div className="space-y-2">
                            {candidate.stageHistory.map((entry, idx) => {
                                const meta = getStageMeta(entry.stage);
                                return (
                                    <div
                                        key={idx}
                                        className="flex items-center gap-3 text-sm"
                                    >
                                        <div
                                            className={`w-2.5 h-2.5 rounded-full ${meta.color}`}
                                        />
                                        <span className="font-medium">{meta.label}</span>
                                        <span className="text-muted-foreground">
                                            {new Date(entry.enteredAt).toLocaleString()}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            by {entry.actor}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Advance Stage Actions */}
                {allowedTransitions.length > 0 && (
                    <div className="mt-6">
                        <h4 className="text-sm font-semibold mb-3">Advance Stage</h4>
                        <div className="flex flex-wrap gap-2">
                            {allowedTransitions.map((targetStage) => {
                                const meta = getStageMeta(targetStage);
                                const isExit = EXIT_STAGES.some(
                                    (e) => e.key === targetStage,
                                );
                                return (
                                    <Button
                                        key={targetStage}
                                        variant={isExit ? "outline" : "default"}
                                        size="sm"
                                        disabled={advancing}
                                        onClick={() =>
                                            onAdvanceStage(candidate.candidateId, targetStage)
                                        }
                                        className={isExit ? "border-red-300 text-red-600" : ""}
                                    >
                                        {advancing ? (
                                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                        ) : (
                                            <ArrowRight className="w-3 h-3 mr-1" />
                                        )}
                                        {meta.label}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Comp Plan — visible from PROPOSAL stage onward */}
                {["PROPOSAL", "NEGOTIATION", "DEEL_SETUP", "JOB_OFFER", "GOOGLE_WORKSPACE_CREATION", "ONBOARDING_ASSIGNED", "HIRED"].includes(candidate.stage) && (
                    <div className="mt-6">
                        <h4 className="text-sm font-semibold mb-3">Compensation Plan</h4>
                        <CompPlanEditor
                            candidateId={candidate.candidateId}
                            candidateName={candidate.name}
                        />
                    </div>
                )}

                {/* Deel Push — visible at DEEL_SETUP stage */}
                {candidate.stage === "DEEL_SETUP" && (
                    <div className="mt-6">
                        <DeelPushPanel
                            candidateId={candidate.candidateId}
                            candidateName={candidate.name}
                            deelEmployeeId={candidate.deelEmployeeId}
                            onPushed={() => {
                                // Refresh candidate data
                                onAdvanceStage(candidate.candidateId, "JOB_OFFER");
                            }}
                        />
                    </div>
                )}

                {/* Notes */}
                <div className="mt-6">
                    <h4 className="text-sm font-semibold mb-3">
                        Notes {notes.length > 0 && <span className="text-muted-foreground font-normal">({notes.length})</span>}
                    </h4>
                    {loadingDetail ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <Loader2 className="w-3 h-3 animate-spin" /> Loading notes...
                        </div>
                    ) : notes.length > 0 ? (
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-1">
                            {notes.map((note) => (
                                <div key={note.noteId} className="rounded-md border p-3 text-sm">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-xs">
                                            {note.authorName ?? "Unknown"}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(note.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    {note.noteType && note.noteType !== "general" && (
                                        <Badge variant="outline" className="text-[10px] mb-1">
                                            {note.noteType}
                                        </Badge>
                                    )}
                                    <p className="text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">No notes yet</p>
                    )}
                </div>

                {/* Add Note */}
                <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2">Add Note</h4>
                    <div className="flex gap-2">
                        <textarea
                            className="flex-1 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Add a note about this candidate..."
                            value={noteContent}
                            onChange={(e) => setNoteContent(e.target.value)}
                        />
                        <Button
                            size="sm"
                            disabled={!noteContent.trim() || addingNote}
                            onClick={handleAddNote}
                            className="self-end"
                        >
                            {addingNote ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                "Add"
                            )}
                        </Button>
                    </div>
                </div>

                <Button variant="outline" onClick={onClose} className="mt-4">
                    Close
                </Button>
            </DialogContent>
        </Dialog>
    );
}

/* ─── Resume Link ─── */

function ResumeLink({ s3Key }: { s3Key: string }) {
    const [loading, setLoading] = useState(false);

    const handleView = async () => {
        setLoading(true);
        try {
            const url = await getResumeDownloadUrl(s3Key);
            window.open(url, "_blank");
        } catch (error) {
            console.error("Error getting resume URL:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-4 flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <Button variant="link" size="sm" className="p-0 h-auto" onClick={handleView} disabled={loading}>
                {loading ? (
                    <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</span>
                ) : (
                    "View Resume"
                )}
            </Button>
        </div>
    );
}

/* ─── Add Candidate Dialog ─── */

interface PersonOption {
    name: string;
    email: string;
}

function AddCandidateDialog({
    open,
    onClose,
    onSubmit,
}: {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: {
        name: string;
        email: string;
        phone?: string;
        source?: string;
        referralType?: string;
        referredBy?: string;
        notes?: string;
    }) => void;
}) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [source, setSource] = useState("direct");
    const [referralType, setReferralType] = useState<string>("");
    const [referredBy, setReferredBy] = useState("");
    const [referredBySearch, setReferredBySearch] = useState("");
    const [showPeopleDropdown, setShowPeopleDropdown] = useState(false);
    const [people, setPeople] = useState<PersonOption[]>([]);
    const [loadingPeople, setLoadingPeople] = useState(false);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Fetch people list when dialog opens
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        const fetchPeople = async () => {
            setLoadingPeople(true);
            try {
                const { getDashboard } = await import("@/api/people-ops");
                const res = await getDashboard();
                if (cancelled) return;
                const data = res.data ?? res;
                // Extract people from org_chart (flatten all nodes)
                const flattenOrgChart = (nodes: any[]): PersonOption[] => {
                    const result: PersonOption[] = [];
                    for (const node of nodes) {
                        if (node.name || node.email) {
                            result.push({
                                name: node.name || `${node.given_name ?? ""} ${node.family_name ?? ""}`.trim(),
                                email: node.email ?? "",
                            });
                        }
                        if (Array.isArray(node.direct_reports)) {
                            result.push(...flattenOrgChart(node.direct_reports));
                        }
                    }
                    return result;
                };
                const orgPeople = flattenOrgChart(data.org_chart ?? []);
                // Also add from recent_hires if not already present
                const recentHires: PersonOption[] = (data.recent_hires ?? []).map((p: any) => ({
                    name: `${p.given_name ?? ""} ${p.family_name ?? ""}`.trim() || p.name || "Unknown",
                    email: p.email ?? "",
                }));
                // Deduplicate by email
                const allPeople = [...orgPeople, ...recentHires];
                const seen = new Set<string>();
                const unique = allPeople.filter((p) => {
                    if (!p.email || seen.has(p.email)) return false;
                    seen.add(p.email);
                    return true;
                });
                unique.sort((a, b) => a.name.localeCompare(b.name));
                setPeople(unique);
            } catch {
                setPeople([]);
            } finally {
                if (!cancelled) setLoadingPeople(false);
            }
        };
        fetchPeople();
        return () => { cancelled = true; };
    }, [open]);

    const filteredPeople = people.filter(
        (p) =>
            p.name.toLowerCase().includes(referredBySearch.toLowerCase()) ||
            p.email.toLowerCase().includes(referredBySearch.toLowerCase()),
    );

    const handleSelectPerson = (person: PersonOption) => {
        setReferredBy(person.name);
        setReferredBySearch(person.name);
        setShowPeopleDropdown(false);
    };

    const handleSubmit = async () => {
        if (!name.trim() || !email.trim()) return;
        setSubmitting(true);
        try {
            await onSubmit({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim() || undefined,
                source,
                referralType: referralType || undefined,
                referredBy: referredBy.trim() || undefined,
                notes: notes.trim() || undefined,
            });
            // Reset form
            setName("");
            setEmail("");
            setPhone("");
            setSource("direct");
            setReferralType("");
            setReferredBy("");
            setReferredBySearch("");
            setNotes("");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Candidate</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Email <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="candidate@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">Phone</label>
                        <input
                            type="tel"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="+1 (555) 000-0000"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">Source</label>
                        <Select value={source} onValueChange={setSource}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="direct">Direct Application</SelectItem>
                                <SelectItem value="referral">Referral</SelectItem>
                                <SelectItem value="linkedin">LinkedIn</SelectItem>
                                <SelectItem value="website">Website</SelectItem>
                                <SelectItem value="internal">Internal</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">Referral Type</label>
                        <Select value={referralType} onValueChange={setReferralType}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select referral type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="personal">Personal Referral</SelectItem>
                                <SelectItem value="network">Network Referral</SelectItem>
                                <SelectItem value="stranger">Stranger</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="relative">
                        <label className="text-sm font-medium mb-1 block">
                            Referred By
                            {referralType === "personal" && <span className="text-red-500"> *</span>}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder={loadingPeople ? "Loading people..." : "Search by name or email..."}
                            value={referredBySearch}
                            onChange={(e) => {
                                setReferredBySearch(e.target.value);
                                setReferredBy(e.target.value);
                                setShowPeopleDropdown(true);
                            }}
                            onFocus={() => setShowPeopleDropdown(true)}
                            onBlur={() => {
                                // Delay to allow click on dropdown item
                                setTimeout(() => setShowPeopleDropdown(false), 200);
                            }}
                        />
                        {showPeopleDropdown && referredBySearch.length > 0 && filteredPeople.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 max-h-[160px] overflow-y-auto rounded-md border bg-popover shadow-md">
                                {filteredPeople.slice(0, 10).map((person) => (
                                    <button
                                        key={person.email}
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => handleSelectPerson(person)}
                                    >
                                        <div className="font-medium">{person.name}</div>
                                        <div className="text-xs text-muted-foreground">{person.email}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">Notes</label>
                        <textarea
                            className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="Initial notes about the candidate..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!name.trim() || !email.trim() || submitting}
                    >
                        {submitting ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4 mr-1" />
                        )}
                        Add Candidate
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
