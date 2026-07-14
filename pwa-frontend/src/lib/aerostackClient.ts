import type {
  CreateLoopRequest,
  CreateLoopResponse,
  UpdateLoopRequest,
  ScoreEffortRequest,
  ScoreOutcomeRequest,
  AddTagsRequest,
  Loop,
  LoopListParams,
  Person,
} from '@enterprise/common'
import { executable } from './squidClient'

export class AerostackClient {
  async listLoops(params: LoopListParams = {}): Promise<Loop[]> {
    const fn = executable('AerostackService', 'listLoops')
    const res = await fn(params)
    return res?.data || []
  }

  async getLoop(loop_id: string): Promise<Loop> {
    const fn = executable('AerostackService', 'getLoop')
    return await fn(loop_id)
  }

  async createLoop(req: CreateLoopRequest): Promise<CreateLoopResponse> {
    const fn = executable('AerostackService', 'createLoop')
    return await fn(req)
  }

  async updateLoop(req: UpdateLoopRequest): Promise<{ success: boolean }> {
    const fn = executable('AerostackService', 'updateLoop')
    return await fn(req)
  }

  async scoreEffort(req: ScoreEffortRequest): Promise<{ success: boolean }> {
    const fn = executable('AerostackService', 'scoreEffort')
    return await fn(req)
  }

  async scoreOutcome(req: ScoreOutcomeRequest): Promise<{ success: boolean }> {
    const fn = executable('AerostackService', 'scoreOutcome')
    return await fn(req)
  }

  async addTags(req: AddTagsRequest): Promise<{ success: boolean }> {
    const fn = executable('AerostackService', 'addTags')
    return await fn(req)
  }

  async createPerson(person: Partial<Person>): Promise<Person> {
    const fn = executable('AerostackService', 'createPerson')
    return await fn(person)
  }

  async lookupPersonByEmail(email: string): Promise<Person | null> {
    const fn = executable('AerostackService', 'lookupPersonByEmail')
    return await fn(email)
  }
}

export const aerostackClient = new AerostackClient()
