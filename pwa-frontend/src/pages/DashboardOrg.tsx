import React, { useState, useEffect } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useAdaptLoop,
  useLoops,
  useScoreEffort,
  useScoreOutcome,
  useUpdateLoop,
  useCreateLoop,
} from "@/hooks/useLoops";
import { LoopCreateButton } from "../components/aerostack/LoopCreateButton";
import { LoopTable } from "../components/aerostack/LoopTable";

export default function DashboardOrg() {
  const [scoreTarget, setScoreTarget] = React.useState<Loop | null>(null);
  const [effortTarget, setEffortTarget] = React.useState<Loop | null>(null);
  const [filters, setFilters] = React.useState<LoopListParams>({});
  const [transitionLoop, setTransitionLoop] = React.useState<Loop | null>(null);
  const [showTransitionDialog, setShowTransitionDialog] = React.useState(false);
  // const [limit, setLimit] = React.useState<number>(20);
  const { pushCursor, popCursor, currentLastKey, hasPrev, reset } =
    useCursorStack();

  const [pageSize, setPageSize] = useState(20); // unified state
  // store cursors per page
  const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
  const [currentPage, setCurrentPage] = useState(1);
  const cursor = pageCursors[currentPage - 1];
  useLoops({ limit: pageSize, last_key: cursor });
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);

  const { data: loopsData, isLoading } = useLoops({
    filters,
    limit: pageSize,
    last_key: currentCursor,
  });

  const onScore = (loop: Loop) => {
    setScoreTarget(loop);
  };

  const onEffort = (loop: Loop) => {
    setEffortTarget(loop);
  };

  const handleNext = () => {
    if (!loopsData?.nextCursor) return;
    setCurrentCursor(loopsData.nextCursor); // ✅ set new cursor
    setPageCursors((prev) => [...prev, loopsData.nextCursor]);
    setCurrentPage((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (currentPage === 1) return;
    const prevCursor = pageCursors[currentPage - 2]; // cursor of previous page
    setCurrentCursor(prevCursor);
    setCurrentPage((prev) => prev - 1);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    setPageCursors([null]);
  };
  const hasNext: boolean = !!(loopsData?.hasMore && loopsData?.nextCursor);
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-4xl font-bold">Org Dashboard!</h1>
        <LoopCreateButton />
      </div>

      <Card className="shadow-none p-0">
        <CardContent className="pt-6 pb-6">
          <Filters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <LoopTable
        loops={loopsData}
        currentPage={currentPage}
        onScore={onScore}
        onEffort={onEffort}
        onAdapt={(loop) => {
          setTransitionLoop(loop);
          setShowTransitionDialog(true);
        }}
        onPageChange={(cursor) => {
          if (cursor) handleNext();
          else handlePrev();
        }}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
        isLoading={isLoading}
        hasPrev={currentPage > 1} // or track lastKey stack
        hasNext={hasNext}
        fromId={ROUTES.APP.ORG.id}
      />

      {/* Score Outcome Dialog */}
      {scoreTarget && (
        <ScoreDialog loop={scoreTarget} onClose={() => setScoreTarget(null)} />
      )}

      {/* Effort Dialog */}
      {effortTarget && (
        <EffortDialog
          loop={effortTarget}
          onClose={() => setEffortTarget(null)}
        />
      )}

      {showTransitionDialog && (
        <AdaptDialog
          loop={transitionLoop}
          onClose={() => setShowTransitionDialog(false)}
        />
      )}
    </div>
  );
}

import type { AerostackLoops } from "@enterprise/common";
type Loop = AerostackLoops.Loop;
type LoopListParams = AerostackLoops.LoopListParams;
type AdaptLoopInput = AerostackLoops.AdaptLoopInput;
type ScoreOutcomeInput = AerostackLoops.ScoreOutcomeInput;
import Filters from "@/components/aerostack/Filters";
import { Checkbox } from "@/components/ui/checkbox";
import { useCursorStack } from "@/hooks/useCursorStack";
import { ROUTES } from "@/lib/routes-config";

// Score Dialog Component
export function ScoreDialog({ loop, onClose }: ScoreDialogProps) {
  const [outcome, setOutcome] = React.useState<number>(3);
  const [lesson, setLesson] = React.useState("");
  const [contributors, setContributors] = React.useState<
    Array<{ email: string; share: number }>
  >([]);
  const [sessionEmail, setSessionEmail] = React.useState("");

  React.useEffect(() => {
    const loadEmail = async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        setSessionEmail(
          String(
            session.tokens?.idToken?.payload?.email ||
            session.tokens?.accessToken?.payload?.username ||
            "",
          ),
        );
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const scoreOutcomeMutation = useScoreOutcome({
    onSuccess: () => {
      toast.success("Outcome scored successfully");
      onClose();
    },
    onError: (error) => {
      toast.error("Failed to score outcome");
      console.error("Error scoring outcome:", error);
    },
  });

  React.useEffect(() => {
    if (!loop) return;
    setOutcome(loop.outcome_score || 3);
    setLesson(loop.lesson?.abstract ?? "");
    setContributors(loop?.contributors ?? []);
  }, [loop]);

  const totalContributorShare = contributors.reduce(
    (s, c) => s + (c.share || 0),
    0,
  );
  const ownerShare = Math.max(0, 1 - totalContributorShare);
  // const canSubmitOutcome =
  //   !(outcome >= 3) && contributors.length <= 3 && totalContributorShare <= 0.5;
  const addContributor = () => {
    if (contributors.length < 3)
      setContributors([...contributors, { email: "", share: 0 }]);
  };

  const updateContributor = (
    idx: number,
    patch: Partial<{ email: string; share: number }>,
  ) => {
    const next = contributors.slice();
    next[idx] = { ...next[idx], ...patch };
    setContributors(next);
  };

  const removeContributor = (idx: number) =>
    setContributors(contributors.filter((_, i) => i !== idx));

  const presetShares = (shares: number[]) => {
    const count = Math.min(3, shares.length);
    const rows = Array.from({ length: count }, (_, i) => ({
      email: contributors[i]?.email || "",
      share: shares[i],
    }));
    setContributors(rows);
  };

  const submitScore = async () => {
    if (!loop) return;

    const req: ScoreOutcomeInput = {
      loop_id: loop.loop_id,
      outcome_score: outcome,
      lesson: lesson ? { abstract: lesson } : undefined,
      contributors: contributors.filter((c) => c.email && c.share > 0),
      updated_by: sessionEmail || undefined,
    };

    await scoreOutcomeMutation.mutateAsync(req);
  };

  return (
    <Dialog open={!!loop} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Score Outcome — {loop?.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitScore();
          }}
          className="space-y-6"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="outcome-score">Outcome Score (1–5)</Label>
              <Select
                value={outcome.toString()}
                onValueChange={(v) => setOutcome(parseInt(v, 10))}
              >
                <SelectTrigger id="outcome-score" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lesson">Lesson</Label>
              <Textarea
                id="lesson"
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                placeholder="≤280 chars"
                className="min-h-[100px]"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Contributors</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => presetShares([0.1, 0.1, 0.1])}
                  >
                    3×0.1 (Owner 0.7)
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => presetShares([0.2, 0.2, 0.1])}
                  >
                    0.2/0.2/0.1
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => presetShares([0.25, 0.25])}
                  >
                    2×0.25
                  </Button>
                </div>
              </div>

              {contributors.map((c, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[2fr_1fr_auto] gap-2 items-center"
                >
                  <Input
                    placeholder="email@enterprise.io"
                    value={c.email}
                    onChange={(e) =>
                      updateContributor(idx, { email: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={0.5}
                    value={c.share}
                    onChange={(e) =>
                      updateContributor(idx, {
                        share: Math.max(
                          0,
                          Math.min(0.5, parseFloat(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => removeContributor(idx)}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <div className="flex gap-4 items-center">
                <Button
                  type="button"
                  onClick={addContributor}
                  disabled={contributors.length >= 3}
                  variant="outline"
                >
                  + Add Contributor
                </Button>
                <Badge variant="secondary">
                  Contrib total ≤ 0.5: {totalContributorShare.toFixed(2)} (Owner{" "}
                  {ownerShare.toFixed(2)})
                </Badge>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={scoreOutcomeMutation.isPending}>
              {scoreOutcomeMutation.isPending ? "Scoring..." : "Score"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Effort Dialog Component
export function EffortDialog({ loop, onClose }: EffortDialogProps) {
  const [effort, setEffort] = React.useState<number>(3);
  const [sessionEmail, setSessionEmail] = React.useState("");

  React.useEffect(() => {
    const loadEmail = async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        setSessionEmail(
          String(
            session.tokens?.idToken?.payload?.email ||
            session.tokens?.accessToken?.payload?.username ||
            "",
          ),
        );
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const scoreEffortMutation = useScoreEffort({
    onSuccess: () => {
      toast.success("Effort scored successfully");
      onClose();
    },
    onError: (error) => {
      toast.error("Failed to score effort");
      console.error("Error scoring effort:", error);
    },
  });

  React.useEffect(() => {
    if (!loop) return;
    setEffort(loop.effort_score ?? 3);
  }, [loop]);

  const submitEffort = async () => {
    if (!loop) return;

    await scoreEffortMutation.mutateAsync({
      loopId: loop.loop_id,
      effortScore: effort,
      updated_by: sessionEmail || undefined,
    } as any);
  };

  return (
    <Dialog open={!!loop} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Effort — {loop?.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitEffort();
          }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <Label htmlFor="effort-score">Effort Score (1–5)</Label>
            <Select
              value={effort.toString()}
              onValueChange={(v) => setEffort(parseInt(v, 10))}
            >
              <SelectTrigger id="effort-score" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={scoreEffortMutation.isPending}>
              {scoreEffortMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Adapt Dialog Component
export function AdaptDialog({ loop, onClose }: AdaptDialogProps) {
  const [why, setWhy] = React.useState("");
  const [what, setWhat] = React.useState("");
  const [newTargetDate, setNewTargetDate] = React.useState("");
  const [createFollowOn, setCreateFollowOn] = React.useState(false);
  const [followOnTitle, setFollowOnTitle] = React.useState("");
  const [followOnPriority, setFollowOnPriority] = React.useState<number>(3);
  const [existingAdaptations, setExistingAdaptations] = React.useState<
    Loop["adaptations"]
  >([]);
  const [sessionEmail, setSessionEmail] = React.useState("");

  React.useEffect(() => {
    const loadEmail = async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: false });
        setSessionEmail(
          String(
            session.tokens?.idToken?.payload?.email ||
            session.tokens?.accessToken?.payload?.username ||
            "",
          ),
        );
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  const updateLoopMutation = useUpdateLoop({
    showToast: false,
  });
  const createLoopMutation = useCreateLoop({
    showToast: false,
  });

  const adaptMutation = useAdaptLoop({
    onSuccess: () => {
      toast.success("Loop transitioned successfully");
      onClose();
    },
    onError: (error) => {
      toast.error("Failed to transition loop");
      console.error("Error transitioning loop:", error);
    },
  });

  React.useEffect(() => {
    if (!loop) return;
    setWhy("");
    setWhat("");
    setNewTargetDate(loop.target_completion_date || "");
    setCreateFollowOn(false);
    setFollowOnTitle("");
    setFollowOnPriority(loop.priority);
    setExistingAdaptations(loop.adaptations ?? []);
  }, [loop]);

  const removeAdaptation = (index: number) => {
    if (!loop) return;
    const next = (existingAdaptations ?? []).filter((_, i) => i !== index);
    setExistingAdaptations(next);
    createLoopMutation.mutate(
      {
        loop_id: loop.loop_id,
        title: loop.title,
        description: loop.description,
        loop_type: loop.loop_type,
        category: loop.category,
        owner_email: loop.owner_email,
        target_completion_date: loop.target_completion_date,
        priority: loop.priority,
        status: loop.status as any,
        contributors: loop.contributors as any,
        tags: loop.tags,
        // jira_key: loop.jira_key,
        adaptations: next ?? undefined,
      } as any,
      {
        onError: () => {
          setExistingAdaptations(existingAdaptations ?? []);
        },
      },
    );
  };

  const submit = async () => {
    if (!loop) return;

    const transitionData: AdaptLoopInput = {
      loop_id: loop.loop_id,
      why,
      new_target_completion_date: newTargetDate,
      what: what || undefined,
      create_follow_on: createFollowOn,
      follow_on_title:
        createFollowOn && followOnTitle ? followOnTitle : undefined,
      follow_on_priority:
        createFollowOn && followOnTitle ? followOnPriority : undefined,
      adaptations: existingAdaptations ?? undefined,
      updated_by: sessionEmail || undefined,
    };

    await adaptMutation.mutateAsync(transitionData);
  };

  return (
    <Dialog open={!!loop} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adapt — {loop?.title}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-6"
        >
          {existingAdaptations && existingAdaptations.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Previous Adaptations
              </h3>
              <div className="max-h-64 overflow-y-auto space-y-3 pr-2">
                {existingAdaptations.map((adaptation, index) => (
                  <Card key={adaptation.adapted_at ?? index} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {formatDate(adaptation.adapted_at)}
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Why:</span>{" "}
                          {adaptation.why}
                        </p>
                        {adaptation.what && (
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium">What:</span>{" "}
                            {adaptation.what}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Target moved from{" "}
                          {formatDate(adaptation.previous_target_date)} →{" "}
                          {formatDate(adaptation.new_target_date)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={
                          updateLoopMutation.isPending ||
                          createLoopMutation.isPending
                        }
                        onClick={() => removeAdaptation(index)}
                      >
                        Remove
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="why">Why (required)</Label>
              <Textarea
                id="why"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                className="min-h-20"
                required
                placeholder="Explain why this transition is needed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="what">What changed</Label>
              <Textarea
                id="what"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
                className="min-h-20"
                placeholder="Describe what has changed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="newTargetDate">New target date</Label>
              <Input
                id="newTargetDate"
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="createFollowOn"
                  checked={createFollowOn}
                  onCheckedChange={(checked) =>
                    setCreateFollowOn(checked === true)
                  }
                />
                <Label htmlFor="createFollowOn" className="cursor-pointer">
                  Create follow-on loop
                </Label>
              </div>

              {createFollowOn && (
                <div className="grid grid-cols-[2fr_1fr] gap-2 pl-6">
                  <Input
                    placeholder="Follow-on title"
                    value={followOnTitle}
                    onChange={(e) => setFollowOnTitle(e.target.value)}
                  />
                  <Select
                    value={followOnPriority.toString()}
                    onValueChange={(v) => setFollowOnPriority(parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3].map((p) => (
                        <SelectItem key={p} value={p.toString()}>
                          P{p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!why || !newTargetDate || adaptMutation.isPending}
            >
              {adaptMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ScoreDialogProps = {
  loop: Loop | null;
  onClose: () => void;
};

type EffortDialogProps = {
  loop: Loop | null;
  onClose: () => void;
};

type AdaptDialogProps = {
  loop: Loop | null;
  onClose: () => void;
};

function formatDate(dateString?: string): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
