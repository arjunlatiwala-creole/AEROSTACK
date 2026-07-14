import { SquidService, executable } from '@squidcloud/backend';
import type {
  EngineeringWorkItem,
  EngineeringBoardView,
  EngWorkAggregation,
  EngWorkType,
  CreateEngWorkRequest,
  UpdateEngWorkRequest,
  GetEngBoardRequest,
  ApiError,
} from '@enterprise/common';

export class EngineeringService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  @executable()
  async createWorkItem(request: CreateEngWorkRequest): Promise<EngineeringWorkItem> {
    try {
      const workId = this.generateId();
      const workItem: Omit<EngineeringWorkItem, '__id'> = {
        work_id: workId,
        title: request.title,
        work_type: request.work_type,
        description: request.description,
        customer_name: request.customer_name,
        loop_id: request.loop_id,
        priority: request.priority,
        status: 'backlog',
        assigned_to: request.assigned_to,
        effort_estimate: request.effort_estimate,
        tags: request.tags || [],
        external_id: request.external_id,
        external_system: request.external_system,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<EngineeringWorkItem>('engineering_work').doc(workId).insert(workItem);

      return workItem as EngineeringWorkItem;
    } catch (error: any) {
      console.error('Error creating work item:', error);
      throw {
        error: {
          code: 'CREATE_WORK_FAILED',
          message: 'Failed to create work item',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async updateWorkItem(request: UpdateEngWorkRequest): Promise<{ success: boolean }> {
    try {
      const workRef = this.squid.collection<EngineeringWorkItem>('engineering_work').doc(request.work_id);
      const work = await workRef.snapshot();
      
      if (!work) {
        throw {
          error: {
            code: 'WORK_NOT_FOUND',
            message: `Work item with ID ${request.work_id} not found`,
          },
        } as ApiError;
      }

      const updates: Partial<EngineeringWorkItem> = {
        updated_at: new Date().toISOString(),
      } as any;

      if (request.status !== undefined) {
        updates.status = request.status;
        if (request.status === 'done') {
          updates.completed_at = new Date().toISOString();
        }
      }
      if (request.assigned_to !== undefined) updates.assigned_to = request.assigned_to;
      if (request.priority !== undefined) updates.priority = request.priority;
      if (request.tags !== undefined) updates.tags = request.tags;

      await workRef.update(updates as any);

      return { success: true };
    } catch (error: any) {
      console.error('Error updating work item:', error);
      throw error.error ? error : {
        error: {
          code: 'UPDATE_WORK_FAILED',
          message: 'Failed to update work item',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getEngineeringBoard(request: GetEngBoardRequest = {}): Promise<EngineeringBoardView> {
    try {
      // Fetch all work items
      const query = this.squid.collection<EngineeringWorkItem>('engineering_work').query();
      const snapshot = await query.snapshot();
      let workItems = this.toArrayData<EngineeringWorkItem>(snapshot);

      // Apply filters
      if (request.work_type_filter && request.work_type_filter.length > 0) {
        workItems = workItems.filter(w => request.work_type_filter!.includes(w.work_type));
      }

      if (request.customer_filter) {
        workItems = workItems.filter(w => w.customer_name === request.customer_filter);
      }

      if (request.status_filter && request.status_filter.length > 0) {
        workItems = workItems.filter(w => request.status_filter!.includes(w.status));
      }

      if (request.assigned_to) {
        workItems = workItems.filter(w => w.assigned_to === request.assigned_to);
      }

      // Build columns (Kanban-style)
      const statuses: EngineeringWorkItem['status'][] = [
        'backlog', 'todo', 'in_progress', 'review', 'done', 'blocked'
      ];

      const columns = statuses.map(status => {
        const items = workItems.filter(w => w.status === status);
        return {
          status,
          items,
          wip_limit: status === 'in_progress' ? 5 : undefined, // Example WIP limit
        };
      });

      // Build summary
      const byStatus = workItems.reduce((acc, w) => {
        acc[w.status] = (acc[w.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const byWorkType = workItems.reduce((acc, w) => {
        acc[w.work_type] = (acc[w.work_type] || 0) + 1;
        return acc;
      }, {} as Record<EngWorkType, number>);

      const byCustomer = workItems.reduce((acc, w) => {
        if (w.customer_name) {
          acc[w.customer_name] = (acc[w.customer_name] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      return {
        board_name: 'Engineering Board',
        work_type_filter: request.work_type_filter,
        columns,
        summary: {
          total_items: workItems.length,
          by_status: byStatus,
          by_work_type: byWorkType,
          by_customer: byCustomer,
        },
      };
    } catch (error: any) {
      console.error('Error getting engineering board:', error);
      throw {
        error: {
          code: 'GET_BOARD_FAILED',
          message: 'Failed to get engineering board',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getWorkAggregations(): Promise<EngWorkAggregation[]> {
    try {
      const query = this.squid.collection<EngineeringWorkItem>('engineering_work').query();
      const snapshot = await query.snapshot();
      const workItems = this.toArrayData<EngineeringWorkItem>(snapshot);

      // Group by work type
      const aggregationMap = new Map<EngWorkType, EngWorkAggregation>();

      const workTypes: EngWorkType[] = [
        'ASSESSMENT', 'AI_FEATURE', 'CN_TASK', 'MSP_TASK', 'INFRASTRUCTURE', 'SECURITY'
      ];

      for (const workType of workTypes) {
        const items = workItems.filter(w => w.work_type === workType);
        
        const totalCount = items.length;
        const inProgressCount = items.filter(w => w.status === 'in_progress').length;
        const completedCount = items.filter(w => w.status === 'done').length;
        const totalEffort = items.reduce((sum, w) => sum + (w.effort_estimate || 0), 0);
        
        const customersSet = new Set<string>();
        const okrsSet = new Set<string>();
        
        items.forEach(item => {
          if (item.customer_name) customersSet.add(item.customer_name);
          if (item.loop_id) okrsSet.add(item.loop_id);
        });

        aggregationMap.set(workType, {
          work_type: workType,
          total_count: totalCount,
          in_progress_count: inProgressCount,
          completed_count: completedCount,
          total_effort: totalEffort,
          customers_affected: Array.from(customersSet),
          linked_okrs: Array.from(okrsSet),
        });
      }

      return Array.from(aggregationMap.values());
    } catch (error: any) {
      console.error('Error getting work aggregations:', error);
      return [];
    }
  }

  @executable()
  async getCrossCustomerSummary(): Promise<{
    total_work_items: number;
    by_work_type: Record<EngWorkType, number>;
    by_customer: Record<string, number>;
    in_progress_items: EngineeringWorkItem[];
    blocked_items: EngineeringWorkItem[];
  }> {
    try {
      const query = this.squid.collection<EngineeringWorkItem>('engineering_work').query();
      const snapshot = await query.snapshot();
      const workItems = this.toArrayData<EngineeringWorkItem>(snapshot);

      const byWorkType = workItems.reduce((acc, w) => {
        acc[w.work_type] = (acc[w.work_type] || 0) + 1;
        return acc;
      }, {} as Record<EngWorkType, number>);

      const byCustomer = workItems.reduce((acc, w) => {
        if (w.customer_name) {
          acc[w.customer_name] = (acc[w.customer_name] || 0) + 1;
        } else {
          acc['Internal'] = (acc['Internal'] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      const inProgressItems = workItems.filter(w => w.status === 'in_progress');
      const blockedItems = workItems.filter(w => w.status === 'blocked');

      return {
        total_work_items: workItems.length,
        by_work_type: byWorkType,
        by_customer: byCustomer,
        in_progress_items: inProgressItems,
        blocked_items: blockedItems,
      };
    } catch (error: any) {
      console.error('Error getting cross-customer summary:', error);
      return {
        total_work_items: 0,
        by_work_type: {} as Record<EngWorkType, number>,
        by_customer: {},
        in_progress_items: [],
        blocked_items: [],
      };
    }
  }

  @executable()
  async getWorkItem(workId: string): Promise<EngineeringWorkItem> {
    try {
      const workRef = this.squid.collection<EngineeringWorkItem>('engineering_work').doc(workId);
      const work = await workRef.snapshot();
      
      if (!work) {
        throw {
          error: {
            code: 'WORK_NOT_FOUND',
            message: `Work item with ID ${workId} not found`,
          },
        } as ApiError;
      }

      return this.toData<EngineeringWorkItem>(work);
    } catch (error: any) {
      console.error('Error getting work item:', error);
      throw error.error ? error : {
        error: {
          code: 'GET_WORK_FAILED',
          message: 'Failed to get work item',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async deleteWorkItem(workId: string): Promise<{ success: boolean }> {
    try {
      const workRef = this.squid.collection<EngineeringWorkItem>('engineering_work').doc(workId);
      await workRef.delete();
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting work item:', error);
      throw {
        error: {
          code: 'DELETE_WORK_FAILED',
          message: 'Failed to delete work item',
          details: error,
        },
      } as ApiError;
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

