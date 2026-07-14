import React, { useState, useEffect } from "react";
import { useParams } from "react-router";
import {
  Compass,
  Target,
  Search,
  Send,
  CheckCircle,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  Rocket,
  AlertCircle,
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const TOOLS_API_URL = import.meta.env.VITE_TOOLS_API_URL || "";

interface ParticipantSession {
  session: {
    sessionId: string;
    title: string;
    sessionType: string;
    status: string;
    createdAt: string;
  };
  beacon: { statement: string; timeframe: string; confidence: number; tags: string[] } | null;
  focus: { challengeText: string; tags: string[] } | null;
  perspexStatus: { totalSubmitted: number; hasSubmitted: boolean };
  perspexSummary: {
    commonGround: string[];
    tensions: string[];
    mergedChallenge: string;
    generalizedRisks: string[];
  } | null;
  actionPlan: {
    objectives: string[];
    owners: string[];
    timeframe: string;
    supportLevel: string;
    summary: string;
  } | null;
}

export default function PerspexJoin() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [participantName, setParticipantName] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [joined, setJoined] = useState(false);
  const [sessionData, setSessionData] = useState<ParticipantSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [top3, setTop3] = useState(["", "", ""]);
  const [risk, setRisk] = useState("");

  const fetchSession = async (pid: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        action: "get_session_participant",
        sessionId,
        participantId: pid,
      });
      const res = await fetch(`${TOOLS_API_URL}/perspex?${qs}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSessionData(json.data);
      if (json.data.perspexStatus?.hasSubmitted) setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load session";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantName.trim()) return;
    const pid = participantName.trim().toLowerCase().replace(/\s+/g, "-");
    setParticipantId(pid);
    setJoined(true);
    fetchSession(pid);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || top3.some((t) => !t.trim()) || !risk.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${TOOLS_API_URL}/perspex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_perspex_input",
          sessionId,
          participantId,
          top3: top3.filter((t) => t.trim()),
          risk,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSubmitted(true);
      fetchSession(participantId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p>Invalid session link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 rounded-full bg-primary/10 w-fit">
              <Search className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Perspex</CardTitle>
            <CardDescription>
              You've been invited to share your perspective. Your input is
              confidential — only the AI synthesis will be shared.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleJoin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Your Name</label>
                <Input
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="Enter your name"
                  required
                  autoFocus
                />
              </div>
              <Alert className="bg-muted/50 border-primary/20">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <AlertDescription className="text-sm">
                  <span className="font-medium">Blind input guarantee:</span> No
                  one — not even the facilitator — will see your raw responses.
                  Only the AI-synthesized summary is shared.
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={!participantName.trim()}>
                Join Session
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    );
  }

  if (loading && !sessionData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !sessionData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="w-12 h-12 mx-auto text-destructive" />
            <p>{error}</p>
            <Button variant="outline" onClick={() => fetchSession(participantId)}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionData) return null;

  const { session, beacon, focus, perspexStatus, perspexSummary, actionPlan } = sessionData;
  const waitingForPerspex = session.status === "perspex" || session.status === "focus";
  const showResults = perspexSummary !== null;
  const showActionPlan = actionPlan !== null;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{session.title}</h1>
          <p className="text-muted-foreground capitalize">{session.sessionType} session</p>
        </div>

        {beacon && (
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Compass className="w-4 h-4 text-primary" /> Vision
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>{beacon.statement}</p>
              <div className="flex flex-wrap gap-1 mt-3">
                {beacon.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {focus && (
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Challenge
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{focus.challengeText}</p>
            </CardContent>
          </Card>
        )}

        {!submitted && (session.status === "perspex" || session.status === "focus") && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" /> Share Your Perspective
              </CardTitle>
              <CardDescription>
                Your responses are confidential. No one will see your raw input —
                only the AI-synthesized summary is shared with the group.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-6">
                <Alert className="bg-primary/5 border-primary/20">
                  <EyeOff className="w-4 h-4 text-primary" />
                  <AlertDescription className="text-sm">
                    <span className="font-semibold">Blind input:</span> Your
                    individual responses will never be shown to other
                    participants or the facilitator.
                  </AlertDescription>
                </Alert>
                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    What are the 3 most important things about this challenge?
                  </label>
                  {top3.map((item, i) => (
                    <Input
                      key={i}
                      value={item}
                      onChange={(e) => {
                        const next = [...top3];
                        next[i] = e.target.value;
                        setTop3(next);
                      }}
                      placeholder={`Insight ${i + 1}`}
                      required
                    />
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    What is the biggest risk or constraint?
                  </label>
                  <Textarea
                    value={risk}
                    onChange={(e) => setRisk(e.target.value)}
                    placeholder="What could prevent progress or go wrong?"
                    required
                  />
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || top3.some((t) => !t.trim()) || !risk.trim()}
                >
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Submit My Perspective</>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {submitted && !showResults && (
          <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle className="w-12 h-12 mx-auto text-green-600" />
              <h3 className="text-lg font-semibold">Perspective Submitted</h3>
              <p className="text-muted-foreground">
                Your input has been recorded confidentially.
                The facilitator will synthesize all perspectives when ready.
              </p>
              <p className="text-sm text-muted-foreground">
                {perspexStatus.totalSubmitted} perspective{perspexStatus.totalSubmitted !== 1 ? "s" : ""} submitted so far.
                Check back for the synthesized results.
              </p>
              <Button variant="outline" onClick={() => fetchSession(participantId)}>
                Refresh Status
              </Button>
            </CardContent>
          </Card>
        )}

        {showResults && perspexSummary && (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" /> Synthesized Results
              </CardTitle>
              <CardDescription>
                AI synthesis of all {perspexStatus.totalSubmitted} perspectives — no individual inputs are shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" /> Common Ground
                </h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {perspexSummary.commonGround.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-500" /> Tensions
                </h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {perspexSummary.tensions.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
              <div className="space-y-2 border-t pt-4">
                <h4 className="font-semibold">Merged Challenge</h4>
                <p className="text-sm bg-muted p-3 rounded-md">{perspexSummary.mergedChallenge}</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-destructive">Key Risks</h4>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {perspexSummary.generalizedRisks.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {showActionPlan && actionPlan && (
          <Card className="bg-primary/5 border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="w-5 h-5" /> Action Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {actionPlan.objectives.map((obj, i) => (
                  <div key={i} className="flex items-start gap-3 bg-background p-3 rounded-md border">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <p className="text-sm">{obj}</p>
                  </div>
                ))}
              </div>
              {actionPlan.summary && (
                <p className="text-sm text-muted-foreground italic">{actionPlan.summary}</p>
              )}
            </CardContent>
          </Card>
        )}

        {session.status === "beacon" && (
          <Card className="bg-muted/30">
            <CardContent className="pt-6 text-center space-y-2">
              <Compass className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground">
                The facilitator is setting up the session. Check back soon.
              </p>
              <Button variant="outline" size="sm" onClick={() => fetchSession(participantId)}>
                Refresh
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-xs text-muted-foreground pt-4 pb-8">
          Powered by Perspex — Cooperation Acceleration Engine
        </div>
      </div>
    </div>
  );
}
