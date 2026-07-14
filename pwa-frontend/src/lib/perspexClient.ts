import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

import type {
  BfpmSession,
  BeaconSession,
  FocusSession,
  PerspexInput,
  PerspexSummary,
  ActionPlan,
} from "@enterprise/common";

const TOOLS_API_URL = import.meta.env.VITE_TOOLS_API_URL || "";

interface SessionData {
  session: BfpmSession;
  beacon?: BeaconSession;
  focus?: FocusSession;
  perspexInputs: PerspexInput[];
  perspexSummary?: PerspexSummary;
  actionPlan?: ActionPlan;
}

export class PerspexClient {
  private baseUrl: string;

  constructor(baseUrl: string = TOOLS_API_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const user = await getCurrentUser();
      if (user) {
        const session = await fetchAuthSession({ forceRefresh: false });
        const idToken = session.tokens?.idToken?.toString();
        if (idToken) {
          headers["Authorization"] = idToken;
        }
      }
    } catch {
      console.warn("[PerspexClient] Could not retrieve auth token");
    }
    return headers;
  }

  private async post(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}/perspex`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Perspex API error ${res.status}: ${text}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || "Unknown error");
    }
    return json.data;
  }

  private async get(params: Record<string, string>): Promise<Record<string, unknown>> {
    const headers = await this.getAuthHeaders();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}/perspex?${qs}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Perspex API error ${res.status}: ${text}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || "Unknown error");
    }
    return json.data;
  }

  async createSession(payload: {
    title: string;
    session_type: "strategic" | "tactical" | "operational";
  }): Promise<BfpmSession> {
    const data = await this.post("create_session", {
      title: payload.title,
      sessionType: payload.session_type,
    });
    return {
      session_id: data.sessionId as string,
      title: data.title as string,
      session_type: payload.session_type,
      status: "beacon",
      participants: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async listSessions(options?: {
    limit?: number;
    lastEvaluatedKey?: string;
  }): Promise<{
    success: boolean;
    payload: string;
    lastEvaluatedKey?: string;
    hasMore?: boolean;
    limit?: number;
  }> {
    const params: Record<string, string> = { action: "list_sessions" };
    if (options?.limit) params.limit = options.limit.toString();
    if (options?.lastEvaluatedKey) params.lastEvaluatedKey = options.lastEvaluatedKey;

    const data = await this.get(params);
    const sessions = (data.sessions as Array<Record<string, unknown>>) || [];

    const payload = sessions.map((s) => ({
      session_id: s.sessionId,
      title: s.title,
      session_type: s.sessionType,
      status: s.status,
      participants: s.participants || [],
      created_at: s.createdAt,
      updated_at: s.updatedAt || s.createdAt,
    }));

    return {
      success: true,
      payload: JSON.stringify(payload),
      lastEvaluatedKey: data.lastEvaluatedKey as string | undefined,
      hasMore: data.hasMore as boolean | undefined,
      limit: data.limit as number | undefined,
    };
  }

  async getSessionData(sessionId: string): Promise<SessionData> {
    const data = await this.get({ action: "get_session", sessionId });

    const raw = data.session as Record<string, unknown> | undefined;
    if (!raw) throw new Error("Session not found");

    const beacon = data.beacon as Record<string, unknown> | undefined;
    const focus = data.focus as Record<string, unknown> | undefined;
    const inputs = (data.perspexInputs as Array<Record<string, unknown>>) || [];
    const summary = data.perspexSummary as Record<string, unknown> | undefined;
    const plan = data.actionPlan as Record<string, unknown> | undefined;

    return {
      session: {
        session_id: raw.sessionId as string,
        title: raw.title as string,
        status: raw.status as BfpmSession["status"],
        session_type: raw.sessionType as BfpmSession["session_type"],
        created_at: raw.createdAt as string,
        updated_at: (raw.updatedAt || raw.createdAt) as string,
        participants: (raw.participants as string[]) ?? [],
      },
      beacon: beacon ? {
        beacon_id: beacon.beaconId as string,
        session_id: beacon.sessionId as string,
        statement: beacon.statement as string,
        timeframe: beacon.timeframe as string,
        confidence: Number(beacon.confidence),
        tags: (beacon.tags as string[]) ?? [],
        created_at: beacon.createdAt as string,
      } : undefined,
      focus: focus ? {
        focus_id: focus.focusId as string,
        session_id: focus.sessionId as string,
        challenge_text: focus.challengeText as string,
        tags: (focus.tags as string[]) ?? [],
        created_at: focus.createdAt as string,
      } : undefined,
      perspexInputs: inputs.map((p) => ({
        input_id: p.inputId as string,
        session_id: p.sessionId as string,
        participant_id: p.participantId as string,
        level: (p.level as "individual" | "systemic" | "strategic") ?? "individual",
        top3: (p.top3 as string[]) ?? [],
        risk: p.risk as string,
        created_at: p.createdAt as string,
      })),
      perspexSummary: summary ? {
        summary_id: summary.summaryId as string,
        session_id: summary.sessionId as string,
        beacon_id: summary.beaconId as string,
        focus_id: summary.focusId as string,
        merged_challenge: summary.mergedChallenge as string,
        common_ground: (summary.commonGround as string[]) ?? [],
        tensions: (summary.tensions as string[]) ?? [],
        generalized_risks: (summary.generalizedRisks as string[]) ?? [],
        created_at: summary.createdAt as string,
      } : undefined,
      actionPlan: plan ? {
        plan_id: plan.planId as string,
        session_id: plan.sessionId as string,
        objectives: (plan.objectives as string[]) ?? [],
        owners: (plan.owners as string[]) ?? [],
        timeframe: plan.timeframe as string,
        support_level: (plan.supportLevel as "low" | "medium" | "high") ?? "medium",
        created_at: plan.createdAt as string,
      } : undefined,
    };
  }

  async createBeacon(request: {
    session_id: string;
    participant_inputs: string[];
    session_type?: string;
  }): Promise<{ beacon_id: string; statement: string; timeframe: string; confidence: number; tags: string[]; version: number }> {
    const data = await this.post("create_beacon", {
      sessionId: request.session_id,
      participantInputs: request.participant_inputs,
      sessionType: request.session_type || "strategic",
    });
    return {
      beacon_id: data.beaconId as string,
      statement: data.statement as string,
      timeframe: data.timeframe as string,
      confidence: Number(data.confidence),
      tags: (data.tags as string[]) ?? [],
      version: Number(data.version ?? 1),
    };
  }

  async refineBeacon(request: {
    session_id: string;
    feedback: string;
  }): Promise<{
    statement: string;
    timeframe: string;
    confidence: number;
    tags: string[];
    version: number;
    changeNotes: string;
    previousStatement: string;
    staleDownstream: string[];
  }> {
    const data = await this.post("refine_beacon", {
      sessionId: request.session_id,
      feedback: request.feedback,
    });
    return {
      statement: data.statement as string,
      timeframe: data.timeframe as string,
      confidence: Number(data.confidence),
      tags: (data.tags as string[]) ?? [],
      version: Number(data.version ?? 1),
      changeNotes: (data.changeNotes as string) ?? "",
      previousStatement: (data.previousStatement as string) ?? "",
      staleDownstream: (data.staleDownstream as string[]) ?? [],
    };
  }

  async createFocus(request: {
    session_id: string;
    beacon_id?: string;
    participant_statements: string[];
  }): Promise<{ focus_id: string; challenge_text: string; tags: string[]; version: number }> {
    const data = await this.post("create_focus", {
      sessionId: request.session_id,
      beaconId: request.beacon_id,
      participantStatements: request.participant_statements,
    });
    return {
      focus_id: data.focusId as string,
      challenge_text: data.challengeText as string,
      tags: (data.tags as string[]) ?? [],
      version: Number(data.version ?? 1),
    };
  }

  async refineFocus(request: {
    session_id: string;
    feedback: string;
  }): Promise<{
    challenge_text: string;
    tags: string[];
    version: number;
    changeNotes: string;
    previousChallenge: string;
    staleDownstream: string[];
  }> {
    const data = await this.post("refine_focus", {
      sessionId: request.session_id,
      feedback: request.feedback,
    });
    return {
      challenge_text: data.challengeText as string,
      tags: (data.tags as string[]) ?? [],
      version: Number(data.version ?? 1),
      changeNotes: (data.changeNotes as string) ?? "",
      previousChallenge: (data.previousChallenge as string) ?? "",
      staleDownstream: (data.staleDownstream as string[]) ?? [],
    };
  }

  async addPerspexInput(request: {
    session_id: string;
    participant_id?: string;
    top3: string[];
    risk: string;
  }): Promise<{ success: boolean }> {
    await this.post("add_perspex_input", {
      sessionId: request.session_id,
      participantId: request.participant_id,
      top3: request.top3,
      risk: request.risk,
    });
    return { success: true };
  }

  async createPerspexSummary(request: {
    session_id: string;
    focus_id?: string;
    beacon_id?: string;
  }): Promise<{
    summary_id: string;
    common_ground: string[];
    tensions: string[];
    merged_challenge: string;
    generalized_risks: string[];
  }> {
    const data = await this.post("create_perspex_summary", {
      sessionId: request.session_id,
    });
    return {
      summary_id: data.summaryId as string,
      common_ground: (data.commonGround as string[]) ?? [],
      tensions: (data.tensions as string[]) ?? [],
      merged_challenge: data.mergedChallenge as string,
      generalized_risks: (data.generalizedRisks as string[]) ?? [],
    };
  }

  async createActionPlan(request: {
    session_id: string;
    summary_id?: string;
    timeframe?: string;
    support_level?: string;
  }): Promise<{
    plan_id: string;
    objectives: string[];
    owners: string[];
    timeframe: string;
    support_level: string;
  }> {
    const data = await this.post("create_action_plan", {
      sessionId: request.session_id,
      timeframe: request.timeframe || "30 days",
      supportLevel: request.support_level || "medium",
    });
    return {
      plan_id: data.planId as string,
      objectives: (data.objectives as string[]) ?? [],
      owners: (data.owners as string[]) ?? [],
      timeframe: data.timeframe as string,
      support_level: data.supportLevel as string,
    };
  }
}

export const perspexClient = new PerspexClient();
