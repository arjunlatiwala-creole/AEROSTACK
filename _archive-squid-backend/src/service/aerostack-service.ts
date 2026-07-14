import { SquidService, executable } from '@squidcloud/backend';
import type {
  Loop,
  Person,
  LoopOwnership,
  Lesson,
  ResumeItem,
  CreateLoopRequest,
  CreateLoopResponse,
  ScoreOutcomeRequest,
  ApiError,
  UpdateLoopRequest,
  ScoreEffortRequest,
  AddTagsRequest,
  LoopListParams,
  LoopTabular,
  OpportunityPrioritization,
  DeliveryStatus,
  LearningLoop,
  PersonDashboard,
  HubspotDeal,
  LoopDealLink,
  PersonCost,
  PersonRoi,
  TagCloudItem,
  LoopChange,
  AdaptLoopRequest,
} from '@enterprise/common';

// Local runtime constant to avoid bundling workspace dependency
const CATEGORY_PILLAR_MAP: Record<
  'ENG' | 'MSP' | 'GTM' | 'BD' | 'OPS:Finance' | 'OPS:HR' | 'OPS:SalesOps' | 'LND' | 'ADVISORY',
  'REVOPS' | 'TECHOPS' | 'ADMINOPS' | 'CROSS'
> = {
  ENG: 'TECHOPS',
  MSP: 'TECHOPS',
  GTM: 'REVOPS',
  BD: 'REVOPS',
  'OPS:Finance': 'ADMINOPS',
  'OPS:HR': 'ADMINOPS',
  'OPS:SalesOps': 'REVOPS',
  LND: 'CROSS',
  ADVISORY: 'CROSS',
};

export class AerostackService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  // Executable functions that can be called from frontend
  @executable()
  async createLoop(request: CreateLoopRequest): Promise<CreateLoopResponse> {
    try {
      // Find owner by email
      const ownerQuery = this.squid.collection<Person>('people').query();
      const owners = await ownerQuery.eq('email', request.owner_email).snapshot();
      
      if (owners.length === 0) {
        throw {
          error: {
            code: 'OWNER_NOT_FOUND',
            message: `Person with email ${request.owner_email} not found`,
          },
        } as ApiError;
      }

      const owner = this.toData<Person>(owners[0]);
      const pillar = CATEGORY_PILLAR_MAP[request.category];
      const loopId = this.generateId();
      const jiraKey = request.jira_key || `Aerostack-${loopId.slice(-6).toUpperCase()}`;

      // Create the loop document
      const loop: Omit<Loop, '__id'> = {
        loop_id: loopId,
        title: request.title,
        description: request.description || '',
        category: request.category,
        pillar,
        loop_type: request.loop_type,
        status: 'PLANNED',
        phase: 'PROJECTION',
        priority: request.priority || 3,
        start_date: undefined,
        target_completion_date: request.target_completion_date,
        actual_completion_date: undefined,
        effort_score: undefined,
        outcome_score: undefined,
        loop_score: undefined,
        jira_key: jiraKey,
        tags: request.tags || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      // Insert loop into collection
      await this.squid.collection<Loop>('loops').doc(loopId).insert(loop);

      // Create ownership record
      const ownershipId = this.generateId();
      const ownership: Omit<LoopOwnership, '__id'> = {
        ownership_id: ownershipId,
        loop_id: loopId,
        person_id: owner.person_id,
        role: 'OUTCOME_OWNER',
        credit_share: 1.0,
      } as any;

      await this.squid.collection<LoopOwnership>('loop_ownership').doc(ownershipId).insert(ownership);

      // TODO: Integrate with Jira to create Epic

      return {
        loop_id: loopId,
        pillar,
        jira_key: jiraKey,
      };
    } catch (error: any) {
      console.error('Error creating loop:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_LOOP_FAILED',
          message: 'Failed to create loop',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async scoreEffort(request: ScoreEffortRequest): Promise<{ success: boolean }> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(request.loop_id);
      const loop = await loopRef.snapshot();
      if (!loop) {
        throw { error: { code: 'LOOP_NOT_FOUND', message: `Loop with ID ${request.loop_id} not found` } } as ApiError;
      }
      const loopData = this.toData<Loop>(loop);
      const loopScore = loopData.outcome_score ? request.effort_score * loopData.outcome_score : undefined;
      await loopRef.update({
        effort_score: request.effort_score,
        loop_score: loopScore,
        status: loopData.status === 'PLANNED' ? 'IN_PROGRESS' : loopData.status,
        phase: loopData.phase === 'PROJECTION' ? 'FOCUS' : loopData.phase,
        updated_at: new Date().toISOString(),
      });
      return { success: true };
    } catch (error: any) {
      console.error('Error scoring effort:', error);
      throw error.error ? error : { error: { code: 'SCORE_EFFORT_FAILED', message: 'Failed to score effort', details: error } } as ApiError;
    }
  }

  @executable()
  async updateLoop(request: UpdateLoopRequest): Promise<{ success: boolean }> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(request.loop_id);
      const loop = await loopRef.snapshot();
      if (!loop) {
        throw { error: { code: 'LOOP_NOT_FOUND', message: `Loop with ID ${request.loop_id} not found` } } as ApiError;
      }

      const payload: Partial<Loop> = { updated_at: new Date().toISOString() } as any;
      if (request.title !== undefined) payload.title = request.title;
      if (request.description !== undefined) payload.description = request.description;
      if (request.phase !== undefined) payload.phase = request.phase as any;
      if (request.status !== undefined) payload.status = request.status as any;
      if (request.priority !== undefined) payload.priority = request.priority;
      if (request.tags !== undefined) payload.tags = request.tags;

      await loopRef.update(payload as any);

      if (request.owner_email) {
        const ownerQuery = this.squid.collection<Person>('people').query();
        const owners = await ownerQuery.eq('email', request.owner_email).snapshot();
        if (owners.length === 0) {
          throw { error: { code: 'OWNER_NOT_FOUND', message: `Person with email ${request.owner_email} not found` } } as ApiError;
        }
        const owner = this.toData<Person>(owners[0]);
        // Remove existing owner and set new one
        const loQ = this.squid.collection<LoopOwnership>('loop_ownership').query();
        const ownerships = await loQ.eq('loop_id', request.loop_id).snapshot();
        const ownerRecords = this.toArrayData<LoopOwnership>(ownerships).filter(o => o.role === 'OUTCOME_OWNER');
        for (const rec of ownerRecords) {
          await this.squid.collection<LoopOwnership>('loop_ownership').doc(rec.ownership_id).delete();
        }
        const newOwnerId = this.generateId();
        const ownership: Omit<LoopOwnership, '__id'> = {
          ownership_id: newOwnerId,
          loop_id: request.loop_id,
          person_id: owner.person_id,
          role: 'OUTCOME_OWNER',
          credit_share: 1.0,
        } as any;
        await this.squid.collection<LoopOwnership>('loop_ownership').doc(newOwnerId).insert(ownership);
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error updating loop:', error);
      throw error.error ? error : { error: { code: 'UPDATE_LOOP_FAILED', message: 'Failed to update loop', details: error } } as ApiError;
    }
  }

  @executable()
  async addTags(request: AddTagsRequest): Promise<{ success: boolean; tags: string[] }> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(request.loop_id);
      const loop = await loopRef.snapshot();
      if (!loop) {
        throw { error: { code: 'LOOP_NOT_FOUND', message: `Loop with ID ${request.loop_id} not found` } } as ApiError;
      }
      const loopData = this.toData<Loop>(loop);
      const newTags = Array.from(new Set([...(loopData.tags || []), ...(request.tags || [])]));
      await loopRef.update({ tags: newTags, updated_at: new Date().toISOString() } as any);
      return { success: true, tags: newTags };
    } catch (error: any) {
      console.error('Error adding tags:', error);
      throw { error: { code: 'ADD_TAGS_FAILED', message: 'Failed to add tags', details: error } } as ApiError;
    }
  }

  @executable()
  async scoreOutcome(request: ScoreOutcomeRequest): Promise<{ success: boolean }> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(request.loop_id);
      const loop = await loopRef.snapshot();
      
      if (!loop) {
        throw {
          error: {
            code: 'LOOP_NOT_FOUND',
            message: `Loop with ID ${request.loop_id} not found`,
          },
        } as ApiError;
      }

      // Rubric validations
      if (request.outcome_score >= 4 && !request.lesson) {
        throw { error: { code: 'EVIDENCE_REQUIRED', message: 'Outcome >= 4 requires lesson/evidence' } } as ApiError;
      }
      if (request.outcome_score >= 3 && !request.lesson) {
        throw { error: { code: 'LESSON_REQUIRED', message: 'Outcome >= 3 requires a lesson' } } as ApiError;
      }

      // Calculate loop score if effort is already set
      const loopData = this.toData<Loop>(loop);
      const loopScore = loopData.effort_score ? 
        loopData.effort_score * request.outcome_score : 
        undefined;

      // Update loop with outcome score and completion
      await loopRef.update({
        outcome_score: request.outcome_score,
        loop_score: loopScore,
        status: 'COMPLETED',
        actual_completion_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      });

      // Add contributors if provided
      if (request.contributors && request.contributors.length > 0) {
        if (request.contributors.length > 3) {
          throw { error: { code: 'TOO_MANY_CONTRIBUTORS', message: 'Max 3 contributors' } } as ApiError;
        }
        const invalidShare = request.contributors.some(c => c.share < 0 || c.share > 0.5);
        if (invalidShare) {
          throw { error: { code: 'INVALID_SHARE', message: 'Each contributor share must be between 0.0 and 0.5' } } as ApiError;
        }
        const totalShare = request.contributors.reduce((s, c) => s + (c.share || 0), 0);
        if (totalShare > 0.5 + 1e-8) {
          throw { error: { code: 'EXCESS_SHARE', message: 'Total contributor share must be ≤ 0.5' } } as ApiError;
        }
        for (const contributor of request.contributors) {
          const personQuery = this.squid.collection<Person>('people').query();
          const persons = await personQuery.eq('email', contributor.email).snapshot();
          
          if (persons.length > 0) {
            const person = this.toData<Person>(persons[0]);
            const ownershipId = this.generateId();
            
            const ownership: Omit<LoopOwnership, '__id'> = {
              ownership_id: ownershipId,
              loop_id: request.loop_id,
              person_id: person.person_id,
              role: 'CONTRIBUTOR',
              credit_share: contributor.share,
            } as any;

            await this.squid.collection<LoopOwnership>('loop_ownership').doc(ownershipId).insert(ownership);
          }
        }
      }

      // Add lesson if provided
      if (request.lesson) {
        const lessonId = this.generateId();
        const lesson: Omit<Lesson, '__id'> = {
          lesson_id: lessonId,
          loop_id: request.loop_id,
          abstract: request.lesson.abstract,
          tags: request.lesson.tags || [],
          reuse_notes: request.lesson.reuse_notes || '',
          created_at: new Date().toISOString(),
        } as any;

        await this.squid.collection<Lesson>('lessons').doc(lessonId).insert(lesson);
      }

      // Create resume items for all participants
      await this.createResumeItems(request.loop_id);

      return { success: true };
    } catch (error: any) {
      console.error('Error scoring outcome:', error);
      throw error.error ? error : {
        error: {
          code: 'SCORE_OUTCOME_FAILED',
          message: 'Failed to score outcome',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async adaptLoop(req: AdaptLoopRequest): Promise<{ success: boolean; follow_on_loop_id?: string }> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(req.loop_id);
      const loopDoc = await loopRef.snapshot();
      if (!loopDoc) {
        throw { error: { code: 'LOOP_NOT_FOUND', message: `Loop ${req.loop_id} not found` } } as ApiError;
      }
      const loop = this.toData<Loop>(loopDoc);

      // Create LoopChange record linking adaptation and new target
      const changeId = this.generateId();
      const change: Omit<LoopChange, '__id'> = {
        change_id: changeId,
        loop_id: req.loop_id,
        change_type: 'ADAPTATION',
        why: req.why,
        what: req.what,
        old_target_date: loop.target_completion_date,
        new_target_date: req.new_target_completion_date,
        created_at: new Date().toISOString(),
      } as any;

      // Optionally create a follow-on loop (linked continuation)
      let followOnId: string | undefined;
      if (req.create_follow_on && req.follow_on_title) {
        followOnId = this.generateId();
        const followLoop: Omit<Loop, '__id'> = {
          loop_id: followOnId,
          title: req.follow_on_title,
          description: '',
          category: loop.category,
          pillar: loop.pillar,
          loop_type: loop.loop_type,
          status: 'PLANNED',
          phase: 'PROJECTION',
          priority: req.follow_on_priority ?? loop.priority,
          target_completion_date: req.new_target_completion_date,
          tags: loop.tags || [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any;
        await this.squid.collection<Loop>('loops').doc(followOnId).insert(followLoop);
        (change as any).follow_on_loop_id = followOnId;
      }

      await this.squid.collection<LoopChange>('loop_changes').doc(changeId).insert(change as any);

      // Update original loop: shift target date and phase to ASSERTION (or keep current), status remains IN_PROGRESS
      await loopRef.update({
        target_completion_date: req.new_target_completion_date,
        phase: loop.phase === 'PROJECTION' ? 'ASSERTION' : loop.phase,
        status: loop.status === 'PLANNED' ? 'IN_PROGRESS' : loop.status,
        updated_at: new Date().toISOString(),
      } as any);

      return { success: true, follow_on_loop_id: followOnId };
    } catch (error: any) {
      console.error('Error adapting loop:', error);
      throw error.error ? error : { error: { code: 'ADAPT_LOOP_FAILED', message: 'Failed to adapt loop', details: error } } as ApiError;
    }
  }

  @executable()
  async calculateVelocity(personId: string, windowDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - windowDays);
      
      // Get completed loops for person within window
      const ownershipQuery = this.squid.collection<LoopOwnership>('loop_ownership').query();
      const ownerships = await ownershipQuery.eq('person_id', personId).snapshot();
      const ownershipData = this.toArrayData<LoopOwnership>(ownerships);
      
      let totalWeightedScore = 0;
      let totalCreditShare = 0;

      for (const ownership of ownershipData) {
        const loopRef = this.squid.collection<Loop>('loops').doc(ownership.loop_id);
        const loop = await loopRef.snapshot();
        
        const loopData = loop ? this.toData<Loop>(loop) : undefined;
        if (loopData && 
            loopData.status === 'COMPLETED' && 
            loopData.actual_completion_date &&
            new Date(loopData.actual_completion_date) >= cutoffDate &&
            loopData.loop_score) {
          
          totalWeightedScore += loopData.loop_score * ownership.credit_share;
          totalCreditShare += ownership.credit_share;
        }
      }

      return totalCreditShare > 0 ? totalWeightedScore / totalCreditShare : 0;
    } catch (error: any) {
      console.error('Error calculating velocity:', error);
      return 0;
    }
  }

  @executable()
  async getLoop(loopId: string): Promise<Loop> {
    try {
      const loopRef = this.squid.collection<Loop>('loops').doc(loopId);
      const loop = await loopRef.snapshot();
      
      if (!loop) {
        throw {
          error: {
            code: 'LOOP_NOT_FOUND',
            message: `Loop with ID ${loopId} not found`,
          },
        } as ApiError;
      }

      return loop;
    } catch (error: any) {
      console.error('Error getting loop:', error);
      throw error.error ? error : {
        error: {
          code: 'GET_LOOP_FAILED',
          message: 'Failed to get loop',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async listLoops(params: LoopListParams = {} as any): Promise<{ data: any[]; total_count: number; page: number; page_size: number; }> {
    try {
      // NOTE: Squid query has limited joins; fallback to fetch + filter for owner_email/tag/ranges
      const loops = await this.squid.collection<Loop>('loops').query().snapshot();
      let data = this.toArrayData<Loop>(loops);

      if (params.status) data = data.filter(l => l.status === params.status);
      if (params.category) data = data.filter(l => l.category === params.category);
      if (params.pillar) data = data.filter(l => l.pillar === params.pillar);
      if (params.phase) data = data.filter(l => l.phase === params.phase);
      if (params.priority_min !== undefined) data = data.filter(l => (l.priority ?? 0) >= (params.priority_min!));
      if (params.priority_max !== undefined) data = data.filter(l => (l.priority ?? 0) <= (params.priority_max!));
      if ((params as any).priority_eq !== undefined) data = data.filter(l => (l.priority ?? 0) === (params as any).priority_eq);
      if (params.due_before) data = data.filter(l => l.target_completion_date && l.target_completion_date <= params.due_before!);
      if (params.due_after) data = data.filter(l => l.target_completion_date && l.target_completion_date >= params.due_after!);
      if (params.tag) data = data.filter(l => (l.tags || []).includes(params.tag!));

      let personIdFilter: string | null = null;
      if (params.owner_email) {
        const personQuery = this.squid.collection<Person>('people').query();
        const persons = await personQuery.eq('email', params.owner_email).snapshot();
        if (persons.length > 0) {
          const person = this.toData<Person>(persons[0]);
          personIdFilter = person.person_id;
        } else {
          data = [];
        }
      }

      // Enrich with owner name/email
      const enriched: any[] = [];
      for (const l of data) {
        let ownerName: string | undefined;
        let ownerEmail: string | undefined;
        try {
          const loQ = this.squid.collection<LoopOwnership>('loop_ownership').query();
          const ownerships = await loQ.eq('loop_id', l.loop_id).snapshot();
          const ownerRec = this.toArrayData<LoopOwnership>(ownerships).find(o => o.role === 'OUTCOME_OWNER');
          if (ownerRec) {
            const pDoc = await this.squid.collection<Person>('people').doc(ownerRec.person_id).snapshot();
            if (pDoc) {
              const p = this.toData<Person>(pDoc);
              ownerName = p.name;
              ownerEmail = p.email;
            }
          }
        } catch {}
        if (personIdFilter) {
          // If filtering by owner_email, skip loops without that owner
          const match = ownerEmail && params.owner_email && ownerEmail === params.owner_email;
          if (!match) continue;
        }
        enriched.push({ ...l, owner_name: ownerName, owner_email: ownerEmail });
      }

      // basic pagination: return full set for now
      return { data: enriched, total_count: enriched.length, page: params.page || 1, page_size: params.page_size || enriched.length };
    } catch (error: any) {
      console.error('Error listing loops:', error);
      throw { error: { code: 'LIST_LOOPS_FAILED', message: 'Failed to list loops', details: error } } as ApiError;
    }
  }

  @executable()
  async listOpportunityPrioritization(): Promise<OpportunityPrioritization[]> {
    const loops = await this.listLoops({} as any);
    const filtered = loops.data.filter(l => ['BD','GTM','ADVISORY'].includes(l.category) && (l.status === 'PLANNED' || l.status === 'IN_PROGRESS'));
    const rows: OpportunityPrioritization[] = filtered.map(l => ({
      loop_id: l.loop_id,
      title: l.title,
      category: l.category,
      priority: l.priority,
      target_completion_date: l.target_completion_date,
      loop_score: l.loop_score,
      weighted_score: l.loop_score != null ? l.loop_score * (6 - l.priority) : undefined,
      owner_name: undefined,
    }));
    return rows.sort((a, b) => (a.priority - b.priority) || ((b.weighted_score || -Infinity) - (a.weighted_score || -Infinity)) || ((a.target_completion_date || '').localeCompare(b.target_completion_date || '')));
  }

  @executable()
  async listDeliveryStatus(): Promise<DeliveryStatus[]> {
    const loops = await this.listLoops({} as any);
    const filtered = loops.data.filter(l => ['ENG','MSP'].includes(l.category) && l.status === 'IN_PROGRESS');
    const rows: DeliveryStatus[] = filtered.map(l => ({
      loop_id: l.loop_id,
      title: l.title,
      category: l.category,
      status: l.status,
      phase: l.phase,
      target_completion_date: l.target_completion_date,
      tags: l.tags || [],
      owner_name: undefined,
    }));
    return rows.sort((a, b) => (a.target_completion_date || '').localeCompare(b.target_completion_date || ''));
  }

  @executable()
  async listLearningLoops(): Promise<LearningLoop[]> {
    const loops = await this.listLoops({ status: 'COMPLETED' } as any);
    // Fetch lessons and map
    const allLessons = await this.squid.collection<Lesson>('lessons').query().snapshot();
    const lessonsByLoop = this.toArrayData<Lesson>(allLessons).reduce<Record<string, Lesson>>((acc, l) => { acc[l.loop_id] = l; return acc; }, {});
    const rows: LearningLoop[] = loops.data
      .filter(l => lessonsByLoop[l.loop_id])
      .map(l => ({
        loop_id: l.loop_id,
        title: l.title,
        category: l.category,
        status: l.status,
        outcome_score: l.outcome_score,
        abstract: lessonsByLoop[l.loop_id]?.abstract,
        lesson_tags: lessonsByLoop[l.loop_id]?.tags || [],
        owner_name: undefined,
      }));
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  }

  @executable()
  async getPersonDashboardByEmail(email: string): Promise<PersonDashboard> {
    const personQuery = this.squid.collection<Person>('people').query();
    const persons = await personQuery.eq('email', email).snapshot();
    if (persons.length === 0) {
      throw { error: { code: 'PERSON_NOT_FOUND', message: `No person with email ${email}` } } as ApiError;
    }
    const person = this.toData<Person>(persons[0]);

    const loQ = this.squid.collection<LoopOwnership>('loop_ownership').query();
    const ownerships = this.toArrayData<LoopOwnership>(await loQ.eq('person_id', person.person_id).snapshot());

    const ownedIds = new Set(ownerships.filter(o => o.role === 'OUTCOME_OWNER').map(o => o.loop_id));
    const loops = this.toArrayData<Loop>(await this.squid.collection<Loop>('loops').query().snapshot());
    const ownedLoops = loops.filter(l => ownedIds.has(l.loop_id));

    const active_loops = ownedLoops.filter(l => l.status === 'PLANNED' || l.status === 'IN_PROGRESS').length;
    const completedOwned = ownedLoops.filter(l => l.status === 'COMPLETED' && l.loop_score != null);
    const avg_score = completedOwned.length > 0 ? (completedOwned.reduce((s, l) => s + (l.loop_score || 0), 0) / completedOwned.length) : undefined;

    const velocity_score = await this.calculateVelocity(person.person_id, 90);

    return {
      person_id: person.person_id,
      name: person.name,
      email: person.email,
      area: person.area,
      active_loops,
      avg_score,
      completed_loops: completedOwned.length,
      velocity_score,
    };
  }

  @executable()
  async createPerson(person: Partial<Person>): Promise<Person> {
    try {
      const personId = this.generateId();
      const newPerson: Omit<Person, '__id'> = {
        person_id: personId,
        name: person.name!,
        email: person.email!,
        role_title: person.role_title || '',
        area: person.area,
        level_numeric: person.level_numeric,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<Person>('people').doc(personId).insert(newPerson);
      return newPerson as Person;
    } catch (error: any) {
      console.error('Error creating person:', error);
      throw {
        error: {
          code: 'CREATE_PERSON_FAILED',
          message: 'Failed to create person',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getPersonRoi(email: string, windowStart: string, windowEnd: string): Promise<PersonRoi> {
    const personQuery = this.squid.collection<Person>('people').query();
    const persons = await personQuery.eq('email', email).snapshot();
    if (persons.length === 0) {
      throw { error: { code: 'PERSON_NOT_FOUND', message: `No person with email ${email}` } } as ApiError;
    }
    const person = this.toData<Person>(persons[0]);

    // Find loops owned by person
    const ownerships = this.toArrayData<LoopOwnership>(await this.squid.collection<LoopOwnership>('loop_ownership').query().eq('person_id', person.person_id).snapshot());
    const ownedLoopIds = new Set(ownerships.filter(o => o.role === 'OUTCOME_OWNER').map(o => o.loop_id));

    // Gather linked HubSpot deals for these loops
    const links = this.toArrayData<LoopDealLink>(await this.squid.collection<LoopDealLink>('loop_deal_links').query().snapshot());
    const linkedDealIds = new Set(links.filter(l => ownedLoopIds.has(l.loop_id)).map(l => l.deal_id));

    // Sum influenced revenue in window
    const deals = this.toArrayData<HubspotDeal>(await this.squid.collection<HubspotDeal>('hubspot_deals').query().snapshot());
    const influencedRevenue = deals
      .filter(d => linkedDealIds.has(d.deal_id))
      .filter(d => !d.close_date || (d.close_date >= windowStart && d.close_date <= windowEnd))
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    // Sum person costs for months in window
    const costs = this.toArrayData<PersonCost>(await this.squid.collection<PersonCost>('person_costs').query().snapshot());
    const costUsd = costs
      .filter(c => c.person_id === person.person_id)
      .filter(c => c.month >= windowStart.slice(0,7) && c.month <= windowEnd.slice(0,7))
      .reduce((sum, c) => sum + (c.total_cost_usd || 0), 0);

    const roi = costUsd > 0 ? influencedRevenue / costUsd : 0;
    return {
      person_id: person.person_id,
      email: person.email,
      window_start: windowStart,
      window_end: windowEnd,
      influenced_revenue_usd: influencedRevenue,
      cost_usd: costUsd,
      roi,
    };
  }

  @executable()
  async getTagCloud(): Promise<TagCloudItem[]> {
    const loops = this.toArrayData<Loop>(await this.squid.collection<Loop>('loops').query().snapshot());
    const lessons = this.toArrayData<Lesson>(await this.squid.collection<Lesson>('lessons').query().snapshot());
    const freq: Record<string, number> = {};
    for (const l of loops) {
      for (const t of (l.tags || [])) freq[t] = (freq[t] || 0) + 1;
    }
    for (const le of lessons) {
      for (const t of (le.tags || [])) freq[t] = (freq[t] || 0) + 1;
    }
    return Object.entries(freq)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
  }

  // Private helper methods
  private async createResumeItems(loopId: string): Promise<void> {
    try {
      // Get loop details
      const loopRef = this.squid.collection<Loop>('loops').doc(loopId);
      const loop = await loopRef.snapshot();
      
      const loopData2 = loop ? this.toData<Loop>(loop) : undefined;
      if (!loopData2 || !loopData2.loop_score) return;

      // Get all participants
      const ownershipQuery = this.squid.collection<LoopOwnership>('loop_ownership').query();
      const ownerships = await ownershipQuery.eq('loop_id', loopId).snapshot();
      const ownershipData2 = this.toArrayData<LoopOwnership>(ownerships);

      for (const ownership of ownershipData2) {
        const resumeItemId = this.generateId();
        const score = loopData2.loop_score! * ownership.credit_share;
        
        const resumeItem: Omit<ResumeItem, '__id'> = {
          resume_item_id: resumeItemId,
          person_id: ownership.person_id,
          loop_id: loopId,
          title: loopData2.title,
          category: loopData2.category,
          score,
          date_completed: loopData2.actual_completion_date,
          visibility: 'INTERNAL',
          accreditation: false,
          public_blurb: undefined,
        } as any;

        await this.squid.collection<ResumeItem>('resume_items').doc(resumeItemId).insert(resumeItem);
      }
    } catch (error: any) {
      console.error('Error creating resume items:', error);
      // Don't throw - this is a background operation
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Security rules for collections - these would be defined in Squid console or config
export const securityRules = {
  loops: {
    read: 'auth.userId != null', // Authenticated users can read
    write: 'auth.userId != null', // Authenticated users can write
  },
  people: {
    read: 'auth.userId != null',
    write: 'auth.userId != null',
  },
  loop_ownership: {
    read: 'auth.userId != null',
    write: 'auth.userId != null',
  },
  lessons: {
    read: 'auth.userId != null',
    write: 'auth.userId != null',
  },
  resume_items: {
    read: 'resource.person_id == auth.userId || auth.claims.role == "admin"',
    write: 'auth.claims.role == "admin"', // Only admins can create resume items
  },
  velocity_snapshots: {
    read: 'resource.person_id == auth.userId || auth.claims.role == "admin"',
    write: 'auth.claims.role == "admin"',
  },
};