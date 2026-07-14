import { SquidService, executable } from '@squidcloud/backend';
import type {
  BeaconSession,
  FocusSession,
  PerspexInput,
  PerspexSummary,
  ActionPlan,
  BfpmSession,
  CreateBeaconRequest,
  CreateBeaconResponse,
  CreateFocusRequest,
  CreateFocusResponse,
  CreatePerspexInputRequest,
  CreatePerspexSummaryRequest,
  CreatePerspexSummaryResponse,
  CreateActionPlanRequest,
  CreateActionPlanResponse,
  ApiError,
} from '@enterprise/common';

/**
 * BFPM Service - Beacon → Focus → Perspex → Move
 * 
 * Implements the four-stage facilitated process for moving from 
 * desired emergence → problem clarity → shared understanding → coordinated action
 */
export class BfpmService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // =============================================
  // Session Management
  // =============================================

  @executable()
  async createSession(title: string, session_type: 'strategic' | 'tactical' | 'operational' = 'strategic'): Promise<BfpmSession> {
    try {
      const sessionId = this.generateId();
      const session: Omit<BfpmSession, '__id'> = {
        session_id: sessionId,
        title,
        session_type,
        status: 'beacon',
        participants: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<BfpmSession>('bfpm_sessions').doc(sessionId).insert(session);
      return session as BfpmSession;
    } catch (error: any) {
      console.error('Error creating BFPM session:', error);
      throw {
        error: {
          code: 'CREATE_SESSION_FAILED',
          message: 'Failed to create BFPM session',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getSession(sessionId: string): Promise<BfpmSession> {
    try {
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(sessionId);
      const session = await sessionRef.snapshot();
      
      if (!session) {
        throw {
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Session with ID ${sessionId} not found`,
          },
        } as ApiError;
      }

      return this.toData<BfpmSession>(session);
    } catch (error: any) {
      console.error('Error getting BFPM session:', error);
      throw error.error ? error : {
        error: {
          code: 'GET_SESSION_FAILED',
          message: 'Failed to get BFPM session',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async listSessions(): Promise<BfpmSession[]> {
    try {
      const sessions = await this.squid.collection<BfpmSession>('bfpm_sessions').query().snapshot();
      return this.toArrayData<BfpmSession>(sessions)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch (error: any) {
      console.error('Error listing BFPM sessions:', error);
      throw {
        error: {
          code: 'LIST_SESSIONS_FAILED',
          message: 'Failed to list BFPM sessions',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // 1️⃣ BEACON Stage
  // =============================================

  @executable()
  async createBeacon(request: CreateBeaconRequest): Promise<CreateBeaconResponse> {
    try {
      // Validate session exists
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(request.session_id);
      const session = await sessionRef.snapshot();
      if (!session) {
        throw { error: { code: 'SESSION_NOT_FOUND', message: `Session ${request.session_id} not found` } } as ApiError;
      }

      // Process participant inputs - simulate AI synthesis
      const statement = this.synthesizeBeaconStatement(request.participant_inputs);
      const tags = this.extractTags(statement);
      const timeframe = request.timeframe || this.inferTimeframe(request.session_type || 'strategic');
      const confidence = this.calculateConfidence(request.participant_inputs);

      const beaconId = this.generateId();
      const beacon: Omit<BeaconSession, '__id'> = {
        beacon_id: beaconId,
        session_id: request.session_id,
        statement,
        tags,
        timeframe,
        confidence,
        context_vector: `beacon_${beaconId}_embedding`, // Placeholder for actual embedding
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<BeaconSession>('beacon_sessions').doc(beaconId).insert(beacon);

      // Update session status
      await sessionRef.update({
        status: 'focus',
        updated_at: new Date().toISOString(),
      } as any);

      return {
        beacon_id: beaconId,
        statement,
        tags,
        timeframe,
        confidence,
      };
    } catch (error: any) {
      console.error('Error creating beacon:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_BEACON_FAILED',
          message: 'Failed to create beacon',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // 2️⃣ FOCUS Stage
  // =============================================

  @executable()
  async createFocus(request: CreateFocusRequest): Promise<CreateFocusResponse> {
    try {
      // Get beacon context if available
      let beaconContext = '';
      if (request.beacon_id) {
        const beaconRef = this.squid.collection<BeaconSession>('beacon_sessions').doc(request.beacon_id);
        const beacon = await beaconRef.snapshot();
        if (beacon) {
          const beaconData = this.toData<BeaconSession>(beacon);
          beaconContext = beaconData.statement;
        }
      }

      // Synthesize challenge statement
      const challengeText = this.synthesizeChallengeStatement(request.participant_statements, beaconContext);
      const tags = this.extractTags(challengeText);

      const focusId = this.generateId();
      const focus: Omit<FocusSession, '__id'> = {
        focus_id: focusId,
        session_id: request.session_id,
        beacon_id: request.beacon_id,
        challenge_text: challengeText,
        tags,
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<FocusSession>('focus_sessions').doc(focusId).insert(focus);

      // Update session status
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(request.session_id);
      await sessionRef.update({
        status: 'perspex',
        updated_at: new Date().toISOString(),
      } as any);

      return {
        focus_id: focusId,
        challenge_text: challengeText,
        tags,
      };
    } catch (error: any) {
      console.error('Error creating focus:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_FOCUS_FAILED',
          message: 'Failed to create focus',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // 3️⃣ PERSPEX Stage
  // =============================================

  @executable()
  async addPerspexInput(request: CreatePerspexInputRequest): Promise<{ success: boolean }> {
    try {
      const inputId = this.generateId();
      const level = this.classifyPerspectiveLevel(request.top3, request.risk);
      
      const input: Omit<PerspexInput, '__id'> = {
        input_id: inputId,
        session_id: request.session_id,
        participant_id: request.participant_id,
        top3: request.top3,
        risk: request.risk,
        level,
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<PerspexInput>('perspex_inputs').doc(inputId).insert(input);
      return { success: true };
    } catch (error: any) {
      console.error('Error adding perspex input:', error);
      throw error.error ? error : {
        error: {
          code: 'ADD_PERSPEX_INPUT_FAILED',
          message: 'Failed to add perspex input',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async createPerspexSummary(request: CreatePerspexSummaryRequest): Promise<CreatePerspexSummaryResponse> {
    try {
      // Get all perspex inputs for this session
      const inputsQuery = this.squid.collection<PerspexInput>('perspex_inputs').query();
      const inputs = await inputsQuery.eq('session_id', request.session_id).snapshot();
      const inputsData = this.toArrayData<PerspexInput>(inputs);

      if (inputsData.length === 0) {
        throw { error: { code: 'NO_INPUTS_FOUND', message: 'No perspex inputs found for session' } } as ApiError;
      }

      // Synthesize perspectives
      const commonGround = this.findCommonGround(inputsData);
      const tensions = this.identifyTensions(inputsData);
      const mergedChallenge = this.mergeChallenges(inputsData);
      const generalizedRisks = this.generalizeRisks(inputsData);

      const summaryId = this.generateId();
      const summary: Omit<PerspexSummary, '__id'> = {
        summary_id: summaryId,
        session_id: request.session_id,
        focus_id: request.focus_id,
        beacon_id: request.beacon_id,
        common_ground: commonGround,
        tensions,
        merged_challenge: mergedChallenge,
        generalized_risks: generalizedRisks,
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<PerspexSummary>('perspex_summaries').doc(summaryId).insert(summary);

      // Update session status
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(request.session_id);
      await sessionRef.update({
        status: 'move',
        updated_at: new Date().toISOString(),
      } as any);

      return {
        summary_id: summaryId,
        common_ground: commonGround,
        tensions,
        merged_challenge: mergedChallenge,
        generalized_risks: generalizedRisks,
      };
    } catch (error: any) {
      console.error('Error creating perspex summary:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_PERSPEX_SUMMARY_FAILED',
          message: 'Failed to create perspex summary',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // 4️⃣ MOVE Stage
  // =============================================

  @executable()
  async createActionPlan(request: CreateActionPlanRequest): Promise<CreateActionPlanResponse> {
    try {
      // Get perspex summary for context
      let summaryData: PerspexSummary | null = null;
      if (request.summary_id) {
        const summaryRef = this.squid.collection<PerspexSummary>('perspex_summaries').doc(request.summary_id);
        const summary = await summaryRef.snapshot();
        if (summary) {
          summaryData = this.toData<PerspexSummary>(summary);
        }
      }

      // Generate action plan
      const objectives = this.generateObjectives(summaryData, request.timeframe, request.support_level);
      const owners = this.assignOwners(objectives, request.support_level);

      const planId = this.generateId();
      const plan: Omit<ActionPlan, '__id'> = {
        plan_id: planId,
        session_id: request.session_id,
        summary_id: request.summary_id,
        objectives,
        owners,
        timeframe: request.timeframe,
        support_level: request.support_level,
        linked_beacon: summaryData?.beacon_id,
        created_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<ActionPlan>('action_plans').doc(planId).insert(plan);

      // Update session status to completed
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(request.session_id);
      await sessionRef.update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      } as any);

      return {
        plan_id: planId,
        objectives,
        owners,
        timeframe: request.timeframe,
        support_level: request.support_level,
      };
    } catch (error: any) {
      console.error('Error creating action plan:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_ACTION_PLAN_FAILED',
          message: 'Failed to create action plan',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Retrieval Methods
  // =============================================

  @executable()
  async getSessionData(sessionId: string): Promise<{
    session: BfpmSession;
    beacon?: BeaconSession;
    focus?: FocusSession;
    perspexInputs: PerspexInput[];
    perspexSummary?: PerspexSummary;
    actionPlan?: ActionPlan;
  }> {
    try {
      // Get session
      const sessionRef = this.squid.collection<BfpmSession>('bfpm_sessions').doc(sessionId);
      const session = await sessionRef.snapshot();
      if (!session) {
        throw { error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` } } as ApiError;
      }
      const sessionData = this.toData<BfpmSession>(session);

      // Get beacon
      const beaconQuery = this.squid.collection<BeaconSession>('beacon_sessions').query();
      const beacons = await beaconQuery.eq('session_id', sessionId).snapshot();
      const beacon = beacons.length > 0 ? this.toData<BeaconSession>(beacons[0]) : undefined;

      // Get focus
      const focusQuery = this.squid.collection<FocusSession>('focus_sessions').query();
      const focuses = await focusQuery.eq('session_id', sessionId).snapshot();
      const focus = focuses.length > 0 ? this.toData<FocusSession>(focuses[0]) : undefined;

      // Get perspex inputs
      const inputsQuery = this.squid.collection<PerspexInput>('perspex_inputs').query();
      const inputs = await inputsQuery.eq('session_id', sessionId).snapshot();
      const perspexInputs = this.toArrayData<PerspexInput>(inputs);

      // Get perspex summary
      const summaryQuery = this.squid.collection<PerspexSummary>('perspex_summaries').query();
      const summaries = await summaryQuery.eq('session_id', sessionId).snapshot();
      const perspexSummary = summaries.length > 0 ? this.toData<PerspexSummary>(summaries[0]) : undefined;

      // Get action plan
      const planQuery = this.squid.collection<ActionPlan>('action_plans').query();
      const plans = await planQuery.eq('session_id', sessionId).snapshot();
      const actionPlan = plans.length > 0 ? this.toData<ActionPlan>(plans[0]) : undefined;

      return {
        session: sessionData,
        beacon,
        focus,
        perspexInputs,
        perspexSummary,
        actionPlan,
      };
    } catch (error: any) {
      console.error('Error getting session data:', error);
      throw error.error ? error : {
        error: {
          code: 'GET_SESSION_DATA_FAILED',
          message: 'Failed to get session data',
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Private AI Synthesis Methods (Simplified)
  // =============================================

  private synthesizeBeaconStatement(inputs: string[]): string {
    // Simple synthesis - in production, this would use AI/LLM
    const commonThemes = inputs.join(' ').toLowerCase();
    
    if (commonThemes.includes('housing') || commonThemes.includes('homeless')) {
      return 'Charleston showcasenstrates community-integrated housing success with dignified pathways to stability.';
    }
    if (commonThemes.includes('team') || commonThemes.includes('office') || commonThemes.includes('work')) {
      return 'Our organization operates as a thriving, balanced, and innovative workplace.';
    }
    if (commonThemes.includes('product') || commonThemes.includes('customer') || commonThemes.includes('user')) {
      return 'Our product delivers exceptional value and user satisfaction at scale.';
    }
    
    // Default synthesis
    return `A successful outcome emerges where ${inputs[0]?.toLowerCase() || 'our goals'} are achieved sustainably.`;
  }

  private synthesizeChallengeStatement(statements: string[], beaconContext: string): string {
    // Simple synthesis
    const merged = statements.join(' ').toLowerCase();
    
    if (beaconContext.includes('housing')) {
      return 'How might we create self-sufficiency pathways through housing-first and skill monetization?';
    }
    if (beaconContext.includes('organization') || beaconContext.includes('workplace')) {
      return 'How might we build a resilient, adaptive organizational culture that sustains high performance?';
    }
    
    return `How might we ${statements[0]?.toLowerCase() || 'achieve our desired outcome'} effectively?`;
  }

  private extractTags(text: string): string[] {
    const words = text.toLowerCase().split(/\W+/);
    const importantWords = words.filter(w => 
      w.length > 3 && 
      !['that', 'with', 'this', 'they', 'have', 'will', 'from', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(w)
    );
    return importantWords.slice(0, 5);
  }

  private inferTimeframe(sessionType: string): string {
    switch (sessionType) {
      case 'strategic': return '6 months';
      case 'tactical': return '3 months';
      case 'operational': return '30 days';
      default: return '3 months';
    }
  }

  private calculateConfidence(inputs: string[]): number {
    // Simple confidence calculation based on input consistency
    const avgLength = inputs.reduce((sum, input) => sum + input.length, 0) / inputs.length;
    const lengthVariance = inputs.reduce((sum, input) => sum + Math.pow(input.length - avgLength, 2), 0) / inputs.length;
    
    // Lower variance = higher confidence
    const normalizedVariance = Math.min(lengthVariance / 1000, 1);
    return Math.max(0.5, 1 - normalizedVariance);
  }

  private classifyPerspectiveLevel(top3: string[], risk: string): 'individual' | 'systemic' | 'strategic' {
    const combined = [...top3, risk].join(' ').toLowerCase();
    
    if (combined.includes('system') || combined.includes('process') || combined.includes('organization')) {
      return 'systemic';
    }
    if (combined.includes('strategy') || combined.includes('vision') || combined.includes('long-term')) {
      return 'strategic';
    }
    return 'individual';
  }

  private findCommonGround(inputs: PerspexInput[]): string[] {
    // Simple common ground detection
    const allWords = inputs.flatMap(input => [...input.top3, input.risk].join(' ').toLowerCase().split(/\W+/));
    const wordCounts: Record<string, number> = {};
    
    allWords.forEach(word => {
      if (word.length > 3) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });

    return Object.entries(wordCounts)
      .filter(([_, count]) => count >= Math.ceil(inputs.length / 2))
      .map(([word, _]) => word)
      .slice(0, 3);
  }

  private identifyTensions(inputs: PerspexInput[]): string[] {
    // Simple tension identification
    const risks = inputs.map(input => input.risk.toLowerCase());
    const uniqueRisks = [...new Set(risks)];
    
    if (uniqueRisks.length > 1) {
      return ['speed vs quality', 'autonomy vs oversight'];
    }
    return ['resource allocation', 'timeline pressure'];
  }

  private mergeChallenges(inputs: PerspexInput[]): string {
    const levels = inputs.map(input => input.level);
    const hasSystemic = levels.includes('systemic');
    const hasStrategic = levels.includes('strategic');
    
    if (hasStrategic) {
      return 'Build a comprehensive, scalable framework for sustainable success.';
    }
    if (hasSystemic) {
      return 'Create systematic processes that enable consistent outcomes.';
    }
    return 'Develop practical solutions that address immediate needs effectively.';
  }

  private generalizeRisks(inputs: PerspexInput[]): string[] {
    const risks = inputs.map(input => input.risk.toLowerCase());
    const generalRisks = ['resource fragmentation', 'coordination challenges', 'sustainability concerns'];
    
    if (risks.some(r => r.includes('time') || r.includes('deadline'))) {
      generalRisks.push('timeline pressure');
    }
    if (risks.some(r => r.includes('skill') || r.includes('experience'))) {
      generalRisks.push('capability gaps');
    }
    
    return generalRisks.slice(0, 3);
  }

  private generateObjectives(summary: PerspexSummary | null, timeframe: string, supportLevel: string): string[] {
    const baseObjectives = [
      'Establish clear success metrics and tracking',
      'Build stakeholder alignment and communication',
      'Create sustainable execution framework'
    ];

    if (summary?.merged_challenge.includes('housing')) {
      return [
        'Form landlord risk fund partnership',
        'Launch skills-to-income sprint program',
        'Establish daily housing coordination huddle'
      ];
    }

    if (summary?.merged_challenge.includes('organization')) {
      return [
        'Implement team feedback loops',
        'Establish cross-functional collaboration protocols',
        'Create performance recognition system'
      ];
    }

    return baseObjectives;
  }

  private assignOwners(objectives: string[], supportLevel: string): string[] {
    // Simple owner assignment logic
    const defaultOwners = ['Project Lead', 'Team Lead'];
    
    if (supportLevel === 'high') {
      return [...defaultOwners, 'Executive Sponsor'];
    }
    
    return defaultOwners;
  }
}