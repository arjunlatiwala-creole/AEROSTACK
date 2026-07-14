import { Check, Circle, AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AerostackLoops } from "@enterprise/common";

type StatusHistoryRecord = NonNullable<AerostackLoops.Loop["progress_history"]>[number];

interface ProgressTrackerProps {
    progressHistory: StatusHistoryRecord[];
}

/** Ordered list of all possible statuses for the progress bar */
const STATUS_ORDER: AerostackLoops.LoopStatus[] = [
    "BACKLOG",
    "IN_PROGRESS",
    "IN_QA_REVIEW",
    "COMPLETED",
    "DELAY_INCOMPLETED",
];

const STATUS_LABELS: Record<string, string> = {
    BACKLOG: "Backlog",
    IN_PROGRESS: "In Progress",
    IN_QA_REVIEW: "In QA Review",
    COMPLETED: "Completed",
    DELAY_INCOMPLETED: "Incomplete / Delay",
};

const STEP_CONFIG: Record<
    string,
    { color: string; bgColor: string; borderColor: string; glowColor: string }
> = {
    BACKLOG: {
        color: "text-slate-400",
        bgColor: "bg-slate-500/20",
        borderColor: "border-slate-500/40",
        glowColor: "shadow-slate-500/20",
    },
    IN_PROGRESS: {
        color: "text-blue-400",
        bgColor: "bg-blue-500/20",
        borderColor: "border-blue-500/40",
        glowColor: "shadow-blue-500/30",
    },
    IN_QA_REVIEW: {
        color: "text-amber-400",
        bgColor: "bg-amber-500/20",
        borderColor: "border-amber-500/40",
        glowColor: "shadow-amber-500/30",
    },
    COMPLETED: {
        color: "text-emerald-400",
        bgColor: "bg-emerald-500/20",
        borderColor: "border-emerald-500/40",
        glowColor: "shadow-emerald-500/30",
    },
    DELAY_INCOMPLETED: {
        color: "text-red-400",
        bgColor: "bg-red-500/20",
        borderColor: "border-red-500/40",
        glowColor: "shadow-red-500/30",
    },
};

function formatDateTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

/**
 * Build step states from progress_history.
 * Steps that appear in progress_history are "completed" (or "active" if last).
 * Steps after the last recorded status are "upcoming".
 */
function buildStepStates(progressHistory: StatusHistoryRecord[]) {
    // Map history by status for quick lookup (latest entry per status wins)
    const historyByStatus = new Map<string, StatusHistoryRecord>();
    for (const entry of progressHistory) {
        historyByStatus.set(entry.status, entry);
    }

    // The active step is the LAST entry in progress_history (chronologically),
    // not the highest in STATUS_ORDER. This handles backward status changes
    // (e.g., COMPLETED → IN_PROGRESS) correctly.
    const lastEntry = progressHistory[progressHistory.length - 1];
    const activeIndex = lastEntry
        ? STATUS_ORDER.indexOf(lastEntry.status as AerostackLoops.LoopStatus)
        : -1;

    return STATUS_ORDER.map((status, index) => {
        const historyEntry = historyByStatus.get(status);
        let state: "completed" | "active" | "upcoming";

        if (index === activeIndex) {
            state = "active";
        } else if (index < activeIndex && historyEntry) {
            state = "completed";
        } else if (index < activeIndex) {
            // Skipped step (no history entry but before the active)
            state = "completed";
        } else {
            state = "upcoming";
        }

        return {
            status,
            label: STATUS_LABELS[status] || status,
            state,
            date: historyEntry?.changed_at,
            comment: historyEntry?.comment,
            config: STEP_CONFIG[status] || STEP_CONFIG.BACKLOG,
        };
    });
}

export function ProgressTracker({ progressHistory }: ProgressTrackerProps) {
    const [expandedStep, setExpandedStep] = useState<string | null>(null);
    const steps = buildStepStates(progressHistory);

    const toggleStep = (status: string) => {
        setExpandedStep((prev) => (prev === status ? null : status));
    };

    return (
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-[hsl(var(--card))] to-[hsl(var(--card)/0.8)]"
            style={{ boxShadow: "0 0 40px rgba(0,0,0,0.08)" }}
        >
            <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                    Progress Report
                </CardTitle>
            </CardHeader>
            <CardContent>
                {progressHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No progress history recorded yet.
                    </p>
                ) : (
                    <>
                        {/* Desktop horizontal stepper */}
                        <div className="hidden md:block">
                            <div className="relative flex items-start justify-between">
                                {steps.map((step, index) => {
                                    const isLast = index === steps.length - 1;
                                    const isDelay = step.status === "DELAY_INCOMPLETED";
                                    const isExpanded = expandedStep === step.status;
                                    const hasComment = !!step.comment;

                                    return (
                                        <div
                                            key={step.status}
                                            className="flex flex-col items-center relative"
                                            style={{ flex: 1 }}
                                        >
                                            {/* Connector line */}
                                            {!isLast && (
                                                <div
                                                    className="absolute top-5 h-[3px] rounded-full"
                                                    style={{
                                                        left: "50%",
                                                        right: "-50%",
                                                        width: "100%",
                                                        background:
                                                            step.state === "completed"
                                                                ? "linear-gradient(90deg, #22c55e, #22c55e)"
                                                                : step.state === "active"
                                                                    ? "linear-gradient(90deg, #22c55e, hsl(var(--muted)))"
                                                                    : "hsl(var(--muted))",
                                                        transition: "background 0.5s ease",
                                                    }}
                                                />
                                            )}

                                            {/* Step circle with tooltip */}
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() => hasComment && toggleStep(step.status)}
                                                        className={`
                                                            relative z-10 flex items-center justify-center
                                                            w-10 h-10 rounded-full border-2 transition-all duration-500
                                                            ${hasComment ? "cursor-pointer hover:scale-110" : "cursor-default"}
                                                            ${step.state === "completed"
                                                                ? "bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/30"
                                                                : step.state === "active"
                                                                    ? `${step.config.bgColor} ${step.config.borderColor} shadow-lg ${step.config.glowColor} ring-2 ring-offset-2 ring-offset-[hsl(var(--card))] ring-current ${step.config.color}`
                                                                    : "bg-muted/30 border-muted-foreground/20"
                                                            }
                                                            ${step.state === "active" ? "scale-110" : ""}
                                                        `}
                                                    >
                                                        {step.state === "completed" ? (
                                                            <Check className="h-5 w-5 text-emerald-400" strokeWidth={3} />
                                                        ) : isDelay && step.state === "active" ? (
                                                            <AlertTriangle className="h-5 w-5 text-red-400" />
                                                        ) : (
                                                            <Circle
                                                                className={`h-4 w-4 ${step.state === "active" ? step.config.color : "text-muted-foreground/30"
                                                                    }`}
                                                                fill={step.state === "active" ? "currentColor" : "none"}
                                                            />
                                                        )}
                                                    </button>
                                                </TooltipTrigger>
                                                {step.state === "active" && hasComment && (
                                                    <TooltipContent
                                                        side="top"
                                                        sideOffset={8}
                                                        className="max-w-[220px] px-3 py-2 rounded-lg bg-foreground text-background shadow-xl"
                                                    >
                                                        <p className="text-xs font-semibold mb-1">
                                                            {step.label}
                                                        </p>
                                                        <p className="text-[11px] leading-snug opacity-90">
                                                            {step.comment}
                                                        </p>
                                                        {step.date && (
                                                            <p className="text-[10px] opacity-60 mt-1">
                                                                {formatDateTime(step.date)}
                                                            </p>
                                                        )}
                                                    </TooltipContent>
                                                )}
                                            </Tooltip>

                                            {/* Label */}
                                            <p
                                                className={`mt-3 text-xs font-semibold tracking-wide text-center transition-colors duration-300 ${step.state === "completed"
                                                    ? "text-emerald-400"
                                                    : step.state === "active"
                                                        ? step.config.color
                                                        : "text-muted-foreground/40"
                                                    }`}
                                            >
                                                {step.label}
                                            </p>

                                            {/* Date */}
                                            <p
                                                className={`mt-1 text-[10px] text-center transition-colors duration-300 ${step.state === "upcoming"
                                                    ? "text-muted-foreground/30"
                                                    : "text-muted-foreground/70"
                                                    }`}
                                            >
                                                {step.date ? formatDateTime(step.date) : "—"}
                                            </p>

                                            {/* Comment indicator */}
                                            {hasComment && (
                                                <ChevronDown
                                                    className={`mt-1 h-3 w-3 text-muted-foreground/50 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                                />
                                            )}

                                            {/* Expanded comment */}
                                            {isExpanded && step.comment && (
                                                <div className="mt-2 w-full max-w-[140px] px-2 py-1.5 rounded-md bg-muted/50 border border-muted-foreground/10">
                                                    <p className="text-[11px] text-muted-foreground leading-tight text-center">
                                                        {step.comment}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Mobile vertical stepper */}
                        <div className="md:hidden space-y-0">
                            {steps.map((step, index) => {
                                const isLast = index === steps.length - 1;
                                const isDelay = step.status === "DELAY_INCOMPLETED";
                                const hasComment = !!step.comment;

                                return (
                                    <div key={step.status} className="flex items-start gap-3">
                                        {/* Vertical line + circle */}
                                        <div className="flex flex-col items-center">
                                            <button
                                                type="button"
                                                onClick={() => hasComment && toggleStep(step.status)}
                                                className={`
                                                    flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all duration-500
                                                    ${hasComment ? "cursor-pointer" : "cursor-default"}
                                                    ${step.state === "completed"
                                                        ? "bg-emerald-500/20 border-emerald-500"
                                                        : step.state === "active"
                                                            ? `${step.config.bgColor} ${step.config.borderColor} ring-2 ring-offset-1 ring-offset-[hsl(var(--card))] ring-current ${step.config.color}`
                                                            : "bg-muted/30 border-muted-foreground/20"
                                                    }
                                                `}
                                            >
                                                {step.state === "completed" ? (
                                                    <Check className="h-4 w-4 text-emerald-400" strokeWidth={3} />
                                                ) : isDelay && step.state === "active" ? (
                                                    <AlertTriangle className="h-4 w-4 text-red-400" />
                                                ) : (
                                                    <Circle
                                                        className={`h-3 w-3 ${step.state === "active" ? step.config.color : "text-muted-foreground/30"
                                                            }`}
                                                        fill={step.state === "active" ? "currentColor" : "none"}
                                                    />
                                                )}
                                            </button>
                                            {!isLast && (
                                                <div
                                                    className={`w-[2px] h-8 ${step.state === "completed" ? "bg-emerald-500" : "bg-muted"
                                                        }`}
                                                />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="pb-6 flex-1">
                                            <p
                                                className={`text-sm font-semibold ${step.state === "completed"
                                                    ? "text-emerald-400"
                                                    : step.state === "active"
                                                        ? step.config.color
                                                        : "text-muted-foreground/40"
                                                    }`}
                                            >
                                                {step.label}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground/60">
                                                {step.date ? formatDateTime(step.date) : "—"}
                                            </p>
                                            {step.comment && (
                                                <p className="text-[11px] text-muted-foreground/80 mt-1 italic">
                                                    "{step.comment}"
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
