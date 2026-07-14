import { AerostackLoops } from "@enterprise/common";

AerostackLoops.PRIORITY_LABELS;
AerostackLoops.SCORE_LABELS;
AerostackLoops.LOOP_PHASES;

import { ArrowLeft, Calendar, Clock, Target, Edit, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loopKeys, useDeleteLoop, useLoop } from "@/hooks/useLoops";
import { ROUTES } from "@/lib/routes-config";
import { LoopEditModal } from "@/components/aerostack/LoopEditModal";
import { ProgressTracker } from "@/components/aerostack/ProgressTracker";
import { TaskComments } from "@/components/aerostack/TaskComments";
import { ConfirmDialog } from "@/components/aerostack/ConfirmDialog";
import { useQueryClient } from "@tanstack/react-query";
import { useWriteAccess } from "@/hooks/useWriteAccess";

export default function LoopDetailPage() {
  const params = useParams<{ loopId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { canWrite, permissionKey } = useWriteAccess();

  // Prefer URL param (survives refresh); fall back to router state (in-app nav)
  const loopId: string | undefined = params.loopId || location.state?.loopId;

  // If no loopId at all (direct URL visit without param), redirect home gracefully
  if (!loopId) {
    navigate("/", { replace: true });
    return null;
  }

  const { data: loop, isLoading, error } = useLoop({ loopId });
  const deleteLoop = useDeleteLoop();

  const queryClient = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isRealLoop =
    loop && typeof loop === "object" && "title" in loop && "phase" in loop;

  if (isLoading || !isRealLoop) {
    return <LoopDetailSkeleton />;
  }

  console.log("loop", loop);

  if (error || !loop) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">
              Failed to load loop details. Please try again.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="mt-4"
            >
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-4xl font-bold text-yellow-600 mb-3">
              {loop.title}
            </h1>

            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className="text-xs"
                style={{
                  backgroundColor: getColorForStatus(loop.status),
                }}
              >
                {loop.status}
              </Badge>
              <Badge
                variant="secondary"
                className="text-xs"
                style={{
                  backgroundColor: getColorForPhase(loop.phase),
                }}
              >
                {loop.phase}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {loop.loop_type}
              </Badge>
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-xs"
              >
                <span>Priority</span>
                <span className="w-5 h-5 rounded-full bg-yellow-600 text-white flex items-center justify-center text-[11px] font-semibold">
                  {loop.priority}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({AerostackLoops.PRIORITY_LABELS[loop.priority]})
                </span>
              </Badge>
            </div>
          </div>

          {(canWrite || permissionKey?.startsWith("tools/")) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditModalOpen(true)}
                disabled={!canWrite}
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>

              <Button
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                disabled={!canWrite}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
              <ConfirmDialog
                open={confirmOpen}
                title="Delete Loop?"
                description="This will permanently remove this loop. This action cannot be undone."
                confirmText="Delete"
                loading={deleteLoop.isPending}
                onCancel={() => setConfirmOpen(false)}
                onConfirm={() =>
                  deleteLoop.mutate(loop.loop_id, {
                    onSuccess: () => {
                      setConfirmOpen(false);
                      navigate(-1);
                    },
                  })
                }
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        {/* Description */}
        {loop.description && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">
                {loop.description}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Progress Report */}
        <ProgressTracker progressHistory={loop.progress_history ?? []} />

        {/* Scores */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Performance Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <ScoreCard
                label="Effort"
                score={loop.effort_score}
                icon={<Clock className="h-5 w-5" />}
              />
              <ScoreCard
                label="Outcome"
                score={loop.outcome_score}
                icon={<Target className="h-5 w-5" />}
              />
              <ScoreCard
                label="Loop Score"
                score={loop.loop_score}
                decimals={2}
              />
              <ScoreCard
                label="Weighted Score"
                score={loop.weighted_score}
                decimals={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Details Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Classification */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Classification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailRow label="Category" value={loop.category} badge />
              <DetailRow label="Pillar" value={loop.pillar} badge />
              <DetailRow label="Type" value={loop.loop_type} badge />
              {/* {loop.jira_key && (
                <DetailRow label="Jira Key" value={loop.jira_key} badge />
              )} */}
            </CardContent>
          </Card>

          {/* Owner & Contributors */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">People</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Owner</p>
                {loop.owner_name && (
                  <p className="font-medium">{loop.owner_name}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {loop.owner_email}
                </p>
              </div>

              {loop.contributors && loop.contributors.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Contributors
                  </p>
                  {loop.contributors.map((contributor) => (
                    <div
                      key={contributor.email}
                      className="flex justify-between items-center py-1"
                    >
                      <span className="text-sm">{contributor.email}</span>
                      <Badge variant="secondary" className="text-xs">
                        {(contributor.share * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {loop.start_date && (
                <DateDisplay label="Start" date={loop.start_date} />
              )}
              {loop.target_completion_date && (
                <DateDisplay
                  label="Target"
                  date={loop.target_completion_date}
                />
              )}
              {loop.actual_completion_date && (
                <DateDisplay
                  label="Completed"
                  date={loop.actual_completion_date}
                />
              )}
              <DateDisplay label="Created" date={loop.created_at} />
              <DateDisplay
                label="Updated"
                date={loop.updated_at}
                author={loop.updated_by}
              />
            </div>
          </CardContent>
        </Card>

        {/* Lesson Learned */}
        {loop.lesson && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Lesson Learned</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Abstract</p>
                <p className="text-sm leading-relaxed">
                  {loop.lesson.abstract}
                </p>
              </div>

              {loop.lesson.tags && loop.lesson.tags.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {loop.lesson.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {loop.lesson.reuse_notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Reuse Notes
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {loop.lesson.reuse_notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Adaptations */}
        {loop.adaptations && loop.adaptations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Adaptation History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loop.adaptations.map((adaptation) => (
                <div
                  key={adaptation.adapted_at}
                  className="border-l-2 border-yellow-600 pl-4 py-2"
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {formatDate(adaptation.adapted_at)}
                  </p>
                  <p className="text-sm font-medium mb-1">
                    Why: {adaptation.why}
                  </p>
                  {adaptation.what && (
                    <p className="text-sm text-muted-foreground mb-1">
                      What: {adaptation.what}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Target moved from{" "}
                    {formatDate(adaptation.previous_target_date)} →{" "}
                    {formatDate(adaptation.new_target_date)}
                  </p>
                  {adaptation.follow_on_loop_id && (
                    <Badge variant="outline" className="text-xs mt-2">
                      Follow-on: {adaptation.follow_on_loop_id}
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        {loop.tags && loop.tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {loop.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comments & Updates */}
        <TaskComments
          loopId={loop.loop_id}
          comments={loop.comments ?? []}
          contributors={loop.contributors}
          ownerEmail={loop.owner_email}
        />
      </div>
      {/* Edit Modal */}
      {loop && (
        <LoopEditModal
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          loop={loop}
          onSuccess={() => {
            queryClient.invalidateQueries({
              queryKey: loopKeys.detail(loop.loop_id),
            });
          }}
        />
      )}
    </div>
  );
}

interface ScoreCardProps {
  label: string;
  score?: number;
  icon?: React.ReactNode;
  decimals?: number;
}

function ScoreCard({ label, score, icon, decimals = 0 }: ScoreCardProps) {
  const scoreLabel =
    score && score >= 1 && score <= 5
      ? AerostackLoops.SCORE_LABELS[Math.round(score)]
      : null;

  return (
    <div className="rounded-lg bg-muted/50 p-4 border">
      <div className="flex items-center gap-2 mb-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold">
        {score !== undefined ? score.toFixed(decimals) : "-"}
      </p>
      {scoreLabel && (
        <p className="text-xs text-muted-foreground mt-1">{scoreLabel}</p>
      )}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string | number;
  badge?: boolean;
}

function DetailRow({ label, value, badge }: DetailRowProps) {
  return (
    <div className="flex justify-between items-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      {badge ? (
        <Badge variant="outline" className="text-xs">
          {value}
        </Badge>
      ) : (
        <p className="text-sm font-medium">{value}</p>
      )}
    </div>
  );
}

interface DateDisplayProps {
  label: string;
  date?: string;
  author?: string;
}

function DateDisplay({ label, date, author }: DateDisplayProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-col">
        <p className="text-sm font-medium">{formatDate(date)}</p>
        {author && (
          <p className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={author}>
            by {author}
          </p>
        )}
      </div>
    </div>
  );
}

function LoopDetailSkeleton() {
  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Skeleton className="h-10 w-32 mb-4" />
      <Skeleton className="h-12 w-3/4 mb-3" />
      <div className="flex gap-2 mb-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatDate(dateString?: string): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getColorForStatus(status: string): string {
  return (
    {
      PLANNED: "text-blue-400",
      IN_PROGRESS: "text-amber-400",
      COMPLETED: "text-emerald-400",
      ARCHIVED: "text-gray-400",
    }[status] ?? "text-gray-400"
  );
}

function getColorForPhase(phase: string): string {
  return (
    {
      PROJECTION: "text-purple-400",
      ASSERTION: "text-blue-400",
      FOCUS: "text-orange-400",
      FEEDBACK: "text-amber-400",
      ADAPTATION: "text-emerald-400",
    }[phase] ?? "text-gray-400"
  );
}
