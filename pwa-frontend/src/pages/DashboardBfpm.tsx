import React, { useState, useEffect } from "react";
import { perspexClient as bfpmClient } from "../lib/perspexClient";
import {
  Compass,
  Target,
  Search,
  Rocket,
  CheckCircle,
  Plus,
  X,
  AlertCircle,
  Loader2,
  ChevronRight,
  CompassIcon,
  FocusIcon,
  LucideTarget,
  ArrowRight,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

import type {
  BfpmSession,
  BeaconSession,
  FocusSession,
  PerspexInput,
  PerspexSummary,
  ActionPlan,
} from "@enterprise/common";
import toast from "react-hot-toast";
import Loader from "@/components/Loader";

interface SessionData {
  session: BfpmSession;
  beacon?: BeaconSession;
  focus?: FocusSession;
  perspexInputs: PerspexInput[];
  perspexSummary?: PerspexSummary;
  actionPlan?: ActionPlan;
}

export default function DashboardBfpm() {
  const [sessions, setSessions] = useState<BfpmSession[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionData | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const [loadingMore, setLoadingMore] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [pagination, setPagination] = useState<{
    lastEvaluatedKey?: string;
    hasMore?: boolean;
    limit?: number;
  }>({});

  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [newSessionType, setNewSessionType] = useState<
    "strategic" | "tactical" | "operational"
  >("strategic");

  const [beaconInputs, setBeaconInputs] = useState<string[]>([""]);
  const [focusInputs, setFocusInputs] = useState<string[]>([""]);
  const [actionTimeframe, setActionTimeframe] = useState("30 days");
  const [actionSupport, setActionSupport] = useState<"low" | "medium" | "high">(
    "medium"
  );
  const [beaconFeedback, setBeaconFeedback] = useState("");
  const [focusFeedback, setFocusFeedback] = useState("");
  const [refiningBeacon, setRefiningBeacon] = useState(false);
  const [refiningFocus, setRefiningFocus] = useState(false);
  const [showBeaconRefine, setShowBeaconRefine] = useState(false);
  const [showFocusRefine, setShowFocusRefine] = useState(false);
  const [beaconChangeNotes, setBeaconChangeNotes] = useState("");
  const [focusChangeNotes, setFocusChangeNotes] = useState("");
  const [beaconPrevious, setBeaconPrevious] = useState("");
  const [focusPrevious, setFocusPrevious] = useState("");
  const [staleStages, setStaleStages] = useState<string[]>([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async (reset: boolean = true) => {
    try {
      if (reset) {
        setLoading(true);
        setSessions([]);
        setPagination({});
      } else {
        setLoadingMore(true);
      }

      const sessionList = await bfpmClient.listSessions({
        limit: 20,
        lastEvaluatedKey: reset ? undefined : pagination.lastEvaluatedKey,
      });

      const sessionsArray: BfpmSession[] = JSON.parse(sessionList.payload);
      if (reset) {
        setSessions(sessionsArray);
        // ✅ AUTO-LOAD FIRST SESSION (NEWEST)
        if (sessionsArray.length > 0) {
          await loadSessionData(sessionsArray[0].session_id);
        }
      } else {
        setSessions((prev) => [...prev, ...sessionsArray]);
      }
      setPagination({
        lastEvaluatedKey: sessionList.lastEvaluatedKey,
        hasMore: sessionList.hasMore ?? false,
        limit: sessionList.limit,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load sessions";
      if (msg.includes('Failed to fetch')) {
        console.warn('[BFPM] Backend unavailable:', msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);

      setLoadingMore(false);
    }
  };

  const handleLoadMore = async () => {
    if (!pagination.hasMore || loadingMore) return;
    await loadSessions(false);
  };

  const loadSessionData = async (
    sessionId: string
  ): Promise<SessionData | null> => {
    try {
      setLoading(true);
      setStaleStages([]);
      setBeaconChangeNotes("");
      setBeaconPrevious("");
      setFocusChangeNotes("");
      setFocusPrevious("");
      const data = await bfpmClient.getSessionData(sessionId);
      setCurrentSession(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load session data";
      toast.error(msg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const createNewSession = async () => {
    if (!newSessionTitle.trim()) return;

    setLoading(true);
    try {
      const payload = { title: newSessionTitle, session_type: newSessionType };
      const session = await bfpmClient.createSession(payload);

      await loadSessions();

      setShowNewSession(false);
      setNewSessionTitle("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create session";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const createBeacon = async () => {
    if (!currentSession) return;
    const filled = beaconInputs.filter((input) => input.trim());
    if (filled.length < 1) return;

    try {
      setLoading(true);
      await bfpmClient.createBeacon({
        session_id: currentSession.session.session_id,
        participant_inputs: filled,
        session_type: currentSession.session.session_type,
      });

      await loadSessionData(currentSession.session.session_id);
      setBeaconInputs([""]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create beacon";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const createFocus = async () => {
    if (!currentSession) return;
    const filled = focusInputs.filter((input) => input.trim());
    if (filled.length < 1) return;

    try {
      setLoading(true);

      await bfpmClient.createFocus({
        session_id: currentSession.session.session_id,
        beacon_id: currentSession.beacon?.beacon_id,
        participant_statements: filled,
      });

      await loadSessionData(currentSession.session.session_id);
      setFocusInputs([""]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create focus";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const createPerspexSummary = async () => {
    if (!currentSession) return;

    try {
      setLoading(true);
      await bfpmClient.createPerspexSummary({
        session_id: currentSession.session.session_id,
        focus_id: currentSession.focus?.focus_id,
        beacon_id: currentSession.beacon?.beacon_id,
      });

      await loadSessionData(currentSession.session.session_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create perspex summary";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const createActionPlan = async () => {
    if (!currentSession) return;

    try {
      setLoading(true);
      await bfpmClient.createActionPlan({
        session_id: currentSession.session.session_id,
        summary_id: currentSession.perspexSummary?.summary_id,
        timeframe: actionTimeframe,
        support_level: actionSupport,
      });
      await loadSessionData(currentSession.session.session_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create action plan";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const refineBeacon = async () => {
    if (!currentSession || !beaconFeedback.trim()) return;
    try {
      setRefiningBeacon(true);
      const result = await bfpmClient.refineBeacon({
        session_id: currentSession.session.session_id,
        feedback: beaconFeedback.trim(),
      });
      setBeaconChangeNotes(result.changeNotes);
      setBeaconPrevious(result.previousStatement);
      if (result.staleDownstream.length > 0) {
        setStaleStages((prev) => [...new Set([...prev, ...result.staleDownstream])]);
      }
      await loadSessionData(currentSession.session.session_id);
      setBeaconFeedback("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to refine beacon";
      toast.error(msg);
    } finally {
      setRefiningBeacon(false);
    }
  };

  const refineFocus = async () => {
    if (!currentSession || !focusFeedback.trim()) return;
    try {
      setRefiningFocus(true);
      const result = await bfpmClient.refineFocus({
        session_id: currentSession.session.session_id,
        feedback: focusFeedback.trim(),
      });
      setFocusChangeNotes(result.changeNotes);
      setFocusPrevious(result.previousChallenge);
      if (result.staleDownstream.length > 0) {
        setStaleStages((prev) => [...new Set([...prev, ...result.staleDownstream])]);
      }
      await loadSessionData(currentSession.session.session_id);
      setFocusFeedback("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to refine focus";
      toast.error(msg);
    } finally {
      setRefiningFocus(false);
    }
  };

  const addInput = (
    inputs: string[],
    setInputs: (inputs: string[]) => void
  ) => {
    setInputs([...inputs, ""]);
  };

  const updateInput = (
    inputs: string[],
    setInputs: (inputs: string[]) => void,
    index: number,
    value: string
  ) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
  };

  const removeInput = (
    inputs: string[],
    setInputs: (inputs: string[]) => void,
    index: number
  ) => {
    if (inputs.length > 1) {
      const newInputs = inputs.filter((_, i) => i !== index);
      setInputs(newInputs);
    }
  };

  const getStageIcon = (stage: string) => {
    switch (stage) {
      case "beacon":
        return <Compass className="w-4 h-4" />;
      case "focus":
        return <Target className="w-4 h-4" />;
      case "perspex":
        return <Search className="w-4 h-4" />;
      case "move":
        return <Rocket className="w-4 h-4" />;
      case "completed":
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  const getStageTitle = (stage: string) => {
    switch (stage) {
      case "beacon":
        return "Beacon - Emergence Anchor";
      case "focus":
        return "Focus - Problem Alignment";
      case "perspex":
        return "Perspex - Perspective Synthesis";
      case "move":
        return "Move - Action Generation";
      case "completed":
        return "Completed";
      default:
        return "Unknown Stage";
    }
  };

  const steps = ["beacon", "focus", "perspex", "move"];
  const currentStepIndex = currentSession
    ? steps.indexOf(currentSession.session.status)
    : -1;

  return (
    <div className="flex h-screen bg-background text-foreground ">
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="p-6 pl-0 border-b bg-card">
          <h1 className="text-2xl font-bold tracking-tight mb-1 flex gap-2 items-center">
            Beacon <ArrowRight /> Focus <ArrowRight /> Perspex <ArrowRight />{" "}
            Move
          </h1>
          <p className="text-muted-foreground">
            Facilitated process for moving from emergence vision to coordinated
            action
          </p>
        </div>

        <ScrollArea className="flex-1 p-6 h-64">
          {!currentSession ? (
            <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
              <div className="p-4 rounded-full bg-muted">
                <Target className="w-12 h-12 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">
                  Select a session to begin
                </h3>
                <p className="text-muted-foreground max-w-md">
                  Choose an existing session from the sidebar or create a new
                  one to start the Perspex process.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-8 pb-12">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold">
                    {currentSession.session.title}
                  </h2>
                  <div className="flex items-center space-x-2 mt-2 text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {getStageIcon(currentSession.session.status)}{" "}
                      {getStageTitle(currentSession.session.status)}
                    </span>
                    <span>•</span>
                    <span className="capitalize">
                      {currentSession.session.session_type}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative flex justify-between cursor-default">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-muted -z-10 -translate-y-1/2" />
                {steps.map((step, idx) => {
                  const isCompleted =
                    idx < currentStepIndex ||
                    currentSession.session.status === "completed";
                  const isCurrent =
                    idx === currentStepIndex &&
                    currentSession.session.status !== "completed";

                  return (
                    <div
                      key={step}
                      className="flex flex-col items-center gap-2 bg-background px-2"
                    >
                      <div
                        className={`
                        w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all
                        ${isCompleted || isCurrent
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-background border-muted text-muted-foreground"
                          }
                      `}
                      >
                        {getStageIcon(step)}
                      </div>
                      <span
                        className={`text-xs font-medium uppercase ${isCurrent ? "text-primary" : "text-muted-foreground"
                          }`}
                      >
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>

              {currentSession.session.status === "beacon" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Compass className="w-5 h-5 text-primary" /> Beacon —
                      Collect Future Visions
                    </CardTitle>
                    <CardDescription>
                      Go around the room: "Imagine 6 months after this is
                      resolved — what headline, condition, or feeling would
                      signal success?" Add each participant's vision below.
                    </CardDescription>
                  </CardHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createBeacon();
                    }}
                    className="space-y-2"
                  >
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground pb-1">
                        <Badge variant="outline">
                          {beaconInputs.filter((i) => i.trim()).length} of{" "}
                          {beaconInputs.length} visions entered
                        </Badge>
                        <span>Collect 2–10 perspectives, then synthesize</span>
                      </div>
                      {beaconInputs.map((input, index) => (
                        <div key={index} className="flex gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium mt-1">
                            {index + 1}
                          </div>
                          <Textarea
                            value={input}
                            onChange={(e) =>
                              updateInput(
                                beaconInputs,
                                setBeaconInputs,
                                index,
                                e.target.value
                              )
                            }
                            placeholder={`Participant ${index + 1}'s future vision...`}
                            className="min-h-16"
                          />
                          {beaconInputs.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                removeInput(
                                  beaconInputs,
                                  setBeaconInputs,
                                  index
                                )
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {beaconInputs.length < 10 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            addInput(beaconInputs, setBeaconInputs)
                          }
                          className="w-full"
                        >
                          <Plus className="w-4 h-4 mr-2" /> Add Another
                          Participant's Vision
                        </Button>
                      )}
                    </CardContent>
                    <CardFooter className="justify-end gap-2">
                      <span className="text-xs text-muted-foreground mr-auto">
                        AI will synthesize all visions into a single beacon
                        statement
                      </span>
                      <Button
                        type="submit"
                        disabled={
                          beaconInputs.filter((i) => i.trim()).length < 1 ||
                          loading
                        }
                      >
                        {loading && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Synthesize Beacon (
                        {beaconInputs.filter((i) => i.trim()).length} visions)
                      </Button>
                    </CardFooter>
                  </form>
                </Card>
              )}

              {currentSession.beacon && (
                <Card className="bg-muted/50 border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex gap-2 items-center">
                      <CompassIcon className="text-primary" /> Beacon Result
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        Vision
                      </span>
                      <p className="text-lg">
                        {currentSession.beacon.statement}
                      </p>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="font-medium text-muted-foreground">
                          Timeframe:{" "}
                        </span>
                        {currentSession.beacon.timeframe}
                      </div>
                      <div>
                        <span className="font-medium text-muted-foreground">
                          Confidence:{" "}
                        </span>
                        {Math.round(currentSession.beacon.confidence * 100)}%
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {currentSession.beacon.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {!showBeaconRefine ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowBeaconRefine(true)}
                        className="mt-2"
                      >
                        Refine with AI
                      </Button>
                    ) : (
                      <div className="mt-3 space-y-3 border-t pt-3">
                        {beaconChangeNotes && (
                          <Alert className="bg-primary/5 border-primary/20">
                            <Compass className="w-4 h-4 text-primary" />
                            <AlertDescription className="text-sm">
                              <span className="font-medium">AI:</span> {beaconChangeNotes}
                            </AlertDescription>
                          </Alert>
                        )}
                        {beaconPrevious && (
                          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                            <span className="font-medium">Previous:</span>{" "}
                            <span className="line-through">{beaconPrevious}</span>
                          </div>
                        )}
                        <label className="text-sm font-medium">
                          {beaconChangeNotes ? "Want to adjust further?" : "Tell the AI what to adjust:"}
                        </label>
                        <Textarea
                          value={beaconFeedback}
                          onChange={(e) => setBeaconFeedback(e.target.value)}
                          placeholder='e.g., "Emphasize community impact more" or "Make it more specific to Q3 goals"'
                          className="min-h-16"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowBeaconRefine(false);
                              setBeaconFeedback("");
                              setBeaconChangeNotes("");
                              setBeaconPrevious("");
                            }}
                          >
                            {beaconChangeNotes ? "Looks good" : "Cancel"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={refineBeacon}
                            disabled={!beaconFeedback.trim() || refiningBeacon}
                          >
                            {refiningBeacon && (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            )}
                            {beaconChangeNotes ? "Refine Again" : "Refine Beacon"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {currentSession.session.status === "focus" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" /> Focus —
                      Align on the Challenge
                    </CardTitle>
                    <CardDescription>
                      Go around the room: "Given our beacon vision, what
                      specific challenge must we solve?" Capture each
                      participant's framing of the problem.
                    </CardDescription>
                  </CardHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createFocus();
                    }}
                    className="space-y-2"
                  >
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground pb-1">
                        <Badge variant="outline">
                          {focusInputs.filter((i) => i.trim()).length} of{" "}
                          {focusInputs.length} challenges entered
                        </Badge>
                        <span>
                          AI will merge into a single "How might we..." statement
                        </span>
                      </div>
                      {focusInputs.map((input, index) => (
                        <div key={index} className="flex gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium mt-1">
                            {index + 1}
                          </div>
                          <Textarea
                            value={input}
                            onChange={(e) =>
                              updateInput(
                                focusInputs,
                                setFocusInputs,
                                index,
                                e.target.value
                              )
                            }
                            placeholder={`Participant ${index + 1}'s challenge statement...`}
                            className="min-h-16"
                          />
                          {focusInputs.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                removeInput(focusInputs, setFocusInputs, index)
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {focusInputs.length < 10 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            addInput(focusInputs, setFocusInputs)
                          }
                          className="w-full"
                        >
                          <Plus className="w-4 h-4 mr-2" /> Add Another
                          Participant's Challenge
                        </Button>
                      )}
                    </CardContent>
                    <CardFooter className="justify-end gap-2">
                      <span className="text-xs text-muted-foreground mr-auto">
                        AI will disambiguate and merge into a shared challenge
                      </span>
                      <Button
                        type="submit"
                        disabled={
                          focusInputs.filter((i) => i.trim()).length < 1 ||
                          loading
                        }
                      >
                        {loading && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Synthesize Focus (
                        {focusInputs.filter((i) => i.trim()).length} statements)
                      </Button>
                    </CardFooter>
                  </form>
                </Card>
              )}

              {currentSession.focus && (
                <Card className="bg-muted/50 border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <LucideTarget className="text-primary" /> Focus Result
                    </CardTitle>
                    {staleStages.includes("focus") && (
                      <Alert className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 mt-2">
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                        <AlertDescription className="text-sm">
                          Beacon was refined since this focus was set. Consider refining the focus to align with the updated vision.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        Challenge
                      </span>
                      <p className="text-lg font-medium">
                        {currentSession.focus.challenge_text}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {currentSession.focus.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {!showFocusRefine ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFocusRefine(true)}
                        className="mt-2"
                      >
                        Refine with AI
                      </Button>
                    ) : (
                      <div className="mt-3 space-y-3 border-t pt-3">
                        {focusChangeNotes && (
                          <Alert className="bg-primary/5 border-primary/20">
                            <Target className="w-4 h-4 text-primary" />
                            <AlertDescription className="text-sm">
                              <span className="font-medium">AI:</span> {focusChangeNotes}
                            </AlertDescription>
                          </Alert>
                        )}
                        {focusPrevious && (
                          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                            <span className="font-medium">Previous:</span>{" "}
                            <span className="line-through">{focusPrevious}</span>
                          </div>
                        )}
                        <label className="text-sm font-medium">
                          {focusChangeNotes ? "Want to adjust further?" : "Tell the AI what to adjust:"}
                        </label>
                        <Textarea
                          value={focusFeedback}
                          onChange={(e) => setFocusFeedback(e.target.value)}
                          placeholder='e.g., "Too broad — narrow to hiring specifically" or "Include the budget constraint"'
                          className="min-h-16"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowFocusRefine(false);
                              setFocusFeedback("");
                              setFocusChangeNotes("");
                              setFocusPrevious("");
                            }}
                          >
                            {focusChangeNotes ? "Looks good" : "Cancel"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={refineFocus}
                            disabled={!focusFeedback.trim() || refiningFocus}
                          >
                            {refiningFocus && (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            )}
                            {focusChangeNotes ? "Refine Again" : "Refine Focus"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {currentSession.session.status === "perspex" && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Search className="w-5 h-5 text-primary" /> Perspex —
                        Collecting Blind Perspectives
                      </CardTitle>
                      <CardDescription>
                        Share the invite link with participants. Their inputs are
                        confidential — only the AI synthesis will be visible.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={`${window.location.origin}/perspex/join/${currentSession.session.session_id}`}
                          className="font-mono text-sm"
                        />
                        <Button
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/perspex/join/${currentSession.session.session_id}`
                            );
                            toast.success("Invite link copied");
                          }}
                        >
                          Copy Link
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border">
                        <div className="text-3xl font-bold text-primary">
                          {currentSession.perspexInputs.length}
                        </div>
                        <div>
                          <p className="font-medium">
                            perspective{currentSession.perspexInputs.length !== 1 ? "s" : ""} submitted
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Inputs are blind — only you (system admin) can see raw data
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={() => loadSessionData(currentSession.session.session_id)}
                        >
                          Refresh
                        </Button>
                      </div>
                    </CardContent>
                    {currentSession.perspexInputs.length > 0 && (
                      <CardFooter>
                        <Button
                          className="w-full"
                          onClick={createPerspexSummary}
                          disabled={loading}
                        >
                          {loading && (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          )}
                          Synthesize {currentSession.perspexInputs.length} Perspectives
                        </Button>
                      </CardFooter>
                    )}
                  </Card>
                </div>
              )}

              {currentSession.perspexSummary && (
                <Card className="bg-muted/50 border-primary/20">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      🔍 Perspex Summary
                    </CardTitle>
                    {staleStages.includes("perspex") && (
                      <Alert className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 mt-2">
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                        <AlertDescription className="text-sm">
                          Beacon or Focus was refined since this synthesis. Consider re-collecting perspectives and re-synthesizing.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardHeader>
                  <CardContent className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <h5 className="font-semibold flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />{" "}
                        Common Ground
                      </h5>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {currentSession.perspexSummary.common_ground.map(
                          (item) => (
                            <li key={item}>{item}</li>
                          )
                        )}
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <h5 className="font-semibold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-orange-500" />{" "}
                        Tensions
                      </h5>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {currentSession.perspexSummary.tensions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="col-span-2 space-y-2 border-t pt-4">
                      <h5 className="font-semibold">Merged Challenge</h5>
                      <p className="text-sm bg-background p-3 rounded-md border">
                        {currentSession.perspexSummary.merged_challenge}
                      </p>
                    </div>
                    <div className="col-span-2 space-y-2">
                      <h5 className="font-semibold text-destructive">
                        Key Risks
                      </h5>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {currentSession.perspexSummary.generalized_risks.map(
                          (item) => (
                            <li key={item}>{item}</li>
                          )
                        )}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}

              {currentSession.session.status === "move" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Rocket className=" text-primary" /> Move - Generate
                      Action Plan
                    </CardTitle>
                    <CardDescription>
                      Transform aligned understanding into executable next
                      steps.
                    </CardDescription>
                  </CardHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createActionPlan();
                    }}
                    className="space-y-2"
                  >
                    <CardContent className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Timeframe</label>
                        <Select
                          value={actionTimeframe}
                          onValueChange={setActionTimeframe}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select timeframe" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30 days">30 days</SelectItem>
                            <SelectItem value="60 days">60 days</SelectItem>
                            <SelectItem value="90 days">90 days</SelectItem>
                            <SelectItem value="6 months">6 months</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Support Level
                        </label>
                        <Select
                          value={actionSupport}
                          onValueChange={(val: any) => setActionSupport(val)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select support level" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">
                              Low - Minimal resources
                            </SelectItem>
                            <SelectItem value="medium">
                              Medium - Standard support
                            </SelectItem>
                            <SelectItem value="high">
                              High - Full organizational backing
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end">
                      <Button type="submit" disabled={loading}>
                        {loading && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Generate Action Plan
                      </Button>
                    </CardFooter>
                  </form>
                </Card>
              )}

              {currentSession.actionPlan && (
                <Card className="bg-primary/5 border-primary">
                  <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Rocket className="w-5 h-5" /> Action Plan
                    </CardTitle>
                    {staleStages.includes("move") && (
                      <Alert className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 mt-2">
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                        <AlertDescription className="text-sm">
                          Upstream stages were refined since this plan was generated. Consider regenerating the action plan.
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <h5 className="font-semibold text-lg">Objectives</h5>
                      <div className="space-y-2">
                        {currentSession.actionPlan.objectives.map((obj, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 bg-background p-3 rounded-md border shadow-sm"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                              {i + 1}
                            </span>
                            <p>{obj}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <h5 className="font-semibold">Owners</h5>
                        <ul className="list-disc pl-5 space-y-1">
                          {currentSession.actionPlan.owners.map((owner) => (
                            <li key={owner}>{owner}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-2 bg-background p-4 rounded-lg border">
                        <div className="flex justify-between items-center border-b pb-2">
                          <span className="text-sm font-medium text-muted-foreground">
                            Timeframe
                          </span>
                          <span className="font-bold">
                            {currentSession.actionPlan.timeframe}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2">
                          <span className="text-sm font-medium text-muted-foreground">
                            Support Level
                          </span>
                          <Badge
                            variant={
                              currentSession.actionPlan.support_level === "high"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {currentSession.actionPlan.support_level}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </ScrollArea>

      </div>
      <div className="w-80 border-l flex flex-col h-full bg-muted/10">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center space-x-2">
            <span className="text-xl font-bold">Perspex</span>
            <Badge variant="outline">v2.0</Badge>
          </div>
          <Button onClick={() => setShowNewSession(true)} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> New Session !!
          </Button>
        </div>


        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {loading && !currentSession && <Loader />}

            {sessions.map((session) => (
              <div
                key={session.session_id}
                onClick={() => loadSessionData(session.session_id)}
                className={`
                  p-3 rounded-lg cursor-pointer transition-colors border hover:bg-accent group
                  ${loading ? "opacity-50 cursor-not-allowed" : ""}
                  ${currentSession?.session.session_id === session.session_id
                    ? "bg-accent border-primary/50 shadow-sm"
                    : "bg-card border-transparent"
                  }
                `}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium truncate pr-2">
                    {session.title}
                  </span>
                  <div className="text-muted-foreground group-hover:text-primary transition-colors">
                    {getStageIcon(session.status)}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="capitalize">{session.session_type}</span>
                  <span>
                    {new Date(session.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}

            {pagination.hasMore && (
              <div className="pt-2">
                <Button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  variant="outline"
                  className="w-full"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4 mr-2" />
                      Load More Sessions
                    </>
                  )}
                </Button>
              </div>
            )}

            {!loading && sessions.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No sessions found</p>
                <p className="text-xs mt-1">Create a new session to get started</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <Dialog open={showNewSession} onOpenChange={setShowNewSession}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createNewSession();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create New Session</DialogTitle>
              <DialogDescription>
                Start a new Perspex cooperation session.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  Session Title
                </label>
                <Input
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  placeholder="e.g., Charleston Housing Strategy"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  Session Type
                </label>
                <Select
                  value={newSessionType}
                  onValueChange={(val: any) => setNewSessionType(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strategic">
                      Strategic (6 months)
                    </SelectItem>
                    <SelectItem value="tactical">
                      Tactical (3 months)
                    </SelectItem>
                    <SelectItem value="operational">
                      Operational (30 days)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowNewSession(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newSessionTitle.trim() || loading}
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
