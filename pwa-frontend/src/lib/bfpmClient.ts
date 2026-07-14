import type {
  BfpmSession,
  BeaconSession,
  FocusSession,
  PerspexInput,
  PerspexSummary,
  ActionPlan,
  CreateBeaconRequest,
  CreateBeaconResponse,
  CreateFocusRequest,
  CreateFocusResponse,
  CreatePerspexInputRequest,
  CreatePerspexSummaryRequest,
  CreatePerspexSummaryResponse,
  CreateActionPlanRequest,
  CreateActionPlanResponse,
} from "@enterprise/common";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { config } from "../env/config";

export class BfpmClient {
  private baseUrl: string;
  private devMode: boolean;

  constructor(baseUrl: string = config.apiBaseUrl || "http://127.0.0.1:3000") {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.devMode = import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX';
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.devMode) return headers;
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
      console.warn("[BfpmClient] Could not retrieve auth token");
    }
    return headers;
  }

  private checkDevMode(operation: string): void {
    if (this.devMode) {
      console.warn(`[BfpmClient] Dev mode: skipping ${operation} (no backend at ${this.baseUrl})`);
      throw new Error(`Dev mode: ${operation} unavailable — no BFPM backend running`);
    }
  }
  // Session Management
  async createSession(payload: {
    title: string;
    session_type: "strategic" | "tactical" | "operational";
  }): Promise<BfpmSession> {
    const body = {
      title: payload.title,
      sessionType: payload.session_type,
      status: "beacon" as BfpmSession["status"],
      participants: [],
    };

    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${this.baseUrl}/bfpm/session`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create session: ${text}`);
      }

      const data = await res.json();

      return {
        session_id: data.sessionId,
        title: data.title,
        session_type: data.sessionType || data.session_type,
        status: data.status,
        participants: data.participants || [],
        created_at: data.createdAt || data.created_at,
        updated_at: data.updatedAt || data.updated_at,
      };
    } catch (err: any) {
      throw new Error(`Network or server error: ${err.message}`);
    }
  }

  async getSession(sessionId: string): Promise<BfpmSession> {
    if (!sessionId) throw new Error("sessionId is required");

    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}/bfpm/session/${sessionId}`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      // Try to parse backend error
      const errorText = await res.text();
      throw new Error(
        `Failed to get session: ${res.status} ${res.statusText} - ${errorText}`
      );
    }

    const json = await res.json();

    // Backend returns { data: { sessions: [...], data: {...} } }
    const sessions = json.data?.sessions;
    const data = json.data?.data || {};

    if (!sessions || sessions.length === 0) {
      throw new Error("Session not found");
    }

    return {
      ...sessions[0],
      data,
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
    const params = new URLSearchParams();
 


    if (options?.limit) {
      params.append("limit", options.limit.toString());
    }
    if (options?.lastEvaluatedKey) {
      params.append("lastEvaluatedKey", options.lastEvaluatedKey);
    }

    const url = `${this.baseUrl}/bfpm/session${params.toString() ? `?${params.toString()}` : ""}`;
    const headers = await this.getAuthHeaders();
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("Failed to fetch sessions");

    const data = await res.json();

    // Transform backend data into frontend-ready format
    const payload = data.data.mergedItems.map((s: any) => ({
      session_id: s.sessionId,
      title: s.title,
      session_type: s.sessionType,
      status: s.status,
      participants: s.participants || [],
      created_at: s.createdAt,
      updated_at: s.updatedAt || s.createdAt,
      __id: s.sessionId,
      __docId__: JSON.stringify({ __id: s.sessionId }),
    }));

    return {
      success: true,
      payload: JSON.stringify(payload),
      lastEvaluatedKey: data.data.lastEvaluatedKey,
      hasMore: data.data.hasMore,
      limit: data.data.limit,
    };
  }
  async getSessionData(sessionId: string): Promise<{
    session: BfpmSession;
    beacon?: BeaconSession;
    focus?: FocusSession;
    perspexInputs: PerspexInput[];
    perspexSummary?: PerspexSummary;
    actionPlan?: ActionPlan;
  }> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}/bfpm/session/${sessionId}`, {
      headers,
    });

    if (!res.ok) {
      throw new Error("Failed to fetch session data");
    }

    const json = await res.json();

    /**
     * Backend shape:
     * json.data.data.sessions[0]
     * json.data.data.data
     */
    const backend = json.data.data;

    const rawSession = backend.sessions?.[0];
    const rawData = backend.data || {};

    if (!rawSession) {
      throw new Error("Session missing in response");
    }

    return {
      session: {
        session_id: rawSession.sessionId,
        title: rawSession.title,
        status: rawSession.status,
        session_type: rawSession.sessionType,
        created_at: rawSession.createdAt,
        updated_at: rawSession.updatedAt,
        participants: rawSession.participants ?? [],
      },

      beacon: rawData.beacon
        ? {
          beacon_id: rawData.beacon.beaconId,
          session_id: rawData.beacon.sessionId,
          statement: rawData.beacon.statement,
          timeframe: rawData.beacon.timeframe,
          confidence: rawData.beacon.confidence,
          tags: rawData.beacon.tags ?? [],
          created_at: rawData.beacon.createdAt,
        }
        : undefined,

      focus: rawData.focus
        ? {
          focus_id: rawData.focus.focusId,
          session_id: rawData.focus.sessionId,
          challenge_text: rawData.focus.challengeText,
          tags: rawData.focus.tags ?? [],
          created_at: rawData.focus.createdAt,
        }
        : undefined,

      perspexInputs:
        rawData.perspexInputs?.map((p: any) => ({
          input_id: p.inputId,
          session_id: p.sessionId,
          participant_id: p.participantId,
          level: p.level,
          top3: p.top3,
          risk: p.risk,
          created_at: p.createdAt,
        })) ?? [],

      perspexSummary: rawData.perspexSummary
        ? {
          summary_id: rawData.perspexSummary.summaryId,
          session_id: rawData.perspexSummary.sessionId,
          beacon_id: rawData.perspexSummary.beaconId,
          focus_id: rawData.perspexSummary.focusId,
          merged_challenge: rawData.perspexSummary.mergedChallenge,
          common_ground: rawData.perspexSummary.commonGround,
          tensions: rawData.perspexSummary.tensions,
          generalized_risks: rawData.perspexSummary.generalizedRisks,
          created_at: rawData.perspexSummary.createdAt,
        }
        : undefined,

      actionPlan: rawData.actionPlan
        ? {
          plan_id: rawData.actionPlan.actionPlanId,
          session_id: rawData.actionPlan.sessionId,
          objectives: rawData.actionPlan.objectives,
          owners: rawData.actionPlan.owners,
          timeframe: rawData.actionPlan.timeframe,
          support_level: rawData.actionPlan.supportLevel,
          created_at: rawData.actionPlan.createdAt,
        }
        : undefined,
    };
  }

  // Beacon Stage
  // async createBeacon(
  //   request: CreateBeaconRequest
  // ): Promise<CreateBeaconResponse> {
  //   const fn = executable("BfpmService", "createBeacon");
  //   return await fn(request);
  // }

  // Perspex Stage
  //   async addPerspexInput(
  //     request: CreatePerspexInputRequest
  //   ): Promise<{ success: boolean }> {
  //     const fn = executable("BfpmService", "addPerspexInput");
  //     return await fn(request);
  //   }

  //   async createPerspexSummary(
  //     request: CreatePerspexSummaryRequest
  //   ): Promise<CreatePerspexSummaryResponse> {
  //     const fn = executable("BfpmService", "createPerspexSummary");
  //     return await fn(request);
  //   }

  //   // Move Stage
  //   async createActionPlan(
  //     request: CreateActionPlanRequest
  //   ): Promise<CreateActionPlanResponse> {
  //     const fn = executable("BfpmService", "createActionPlan");
  //     return await fn(request);
  //   }
  // }
  async createBeacon(
    request: CreateBeaconRequest
  ): Promise<CreateBeaconResponse> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}/bfpm/beacon?sessionId=${request.session_id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          statement: request.participant_inputs.join(", "), // convert inputs to a single string
          tags: [], // or map your tags here
          timeframe: request.timeframe ?? "default timeframe",
          confidence: 0.8, // set a default or pass in via request
          contextVector: undefined, // optional
        }),
      }
    );

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    return {
      beacon_id: data.beaconId,
      statement: data.statement,
      tags: data.tags,
      timeframe: data.timeframe,
      confidence: data.confidence,
    };
  }

  /* -------------------- FOCUS -------------------- */

  async createFocus(payload: CreateFocusRequest): Promise<CreateFocusResponse> {
    const { session_id, beacon_id, participant_statements } = payload;

    if (!participant_statements?.length) {
      throw new Error("participant_statements is required");
    }

    // ✅ FRONTEND → BACKEND TRANSFORMATION
    const challengeText = participant_statements[0];
    const tags = participant_statements;

    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}/bfpm/focus?sessionId=${session_id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          beaconId: beacon_id, // backend expects camelCase
          challengeText, // REQUIRED
          tags, // REQUIRED
        }),
      }
    );

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    return {
      focus_id: data.focusId,
      challenge_text: data.challengeText,
      tags: data.tags,
    };
  }

  /* -------------------- PERSPEX INPUT -------------------- */

  async addPerspexInput(
    request: CreatePerspexInputRequest
  ): Promise<{ success: boolean }> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}/bfpm/perspex-input?sessionId=${request.session_id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          participantId: request.participant_id,
          top3: request.top3,
          risk: request.risk,
        }),
      }
    );

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return { success: true };
  }

  /* -------------------- PERSPEX SUMMARY -------------------- */

  async createPerspexSummary(
    request: CreatePerspexSummaryRequest
  ): Promise<CreatePerspexSummaryResponse> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}/bfpm/perspex-summary?sessionId=${request.session_id}`,
      {
        method: "POST",
        headers,

        // 🔥 BACKEND EXPECTS THESE FIELDS
        body: JSON.stringify({
          commonGround: [], // ✅ REQUIRED
          tensions: [], // ✅ REQUIRED
          mergedChallenge: "", // ✅ REQUIRED
          generalizedRisks: [], // ✅ REQUIRED
        }),
      }
    );

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    return {
      summary_id: data.summaryId,
      common_ground: data.commonGround ?? [],
      tensions: data.tensions ?? [],
      merged_challenge: data.mergedChallenge ?? "",
      generalized_risks: data.generalizedRisks ?? [],
    };
  }

  /* -------------------- ACTION PLAN -------------------- */

  async createActionPlan(
    request: CreateActionPlanRequest
  ): Promise<CreateActionPlanResponse> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}/bfpm/action-plan?sessionId=${request.session_id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          // 🔥 MUST HAVE AT LEAST ONE ITEM
          objectives: ["Initial objective"],

          // If owners also has min(1), do the same
          owners: ["Unassigned"],

          timeframe: request.timeframe,
          supportLevel: request.support_level,
        }),
      }
    );

    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    return {
      plan_id: data.planId,
      objectives: data.objectives ?? [],
      owners: data.owners ?? [],
      timeframe: data.timeframe,
      support_level: data.supportLevel,
    };
  }
}
export const bfpmClient = new BfpmClient();
