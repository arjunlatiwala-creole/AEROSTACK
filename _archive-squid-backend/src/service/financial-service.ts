import { SquidService, executable } from '@squidcloud/backend';
import type {
  LoopFinancials,
  ProjectFinancialSummary,
  OkrFinancialRollup,
  CreateFinancialsRequest,
  UpdateFinancialsRequest,
  GetOkrFinancialsRequest,
  Loop,
  ApiError,
} from '@enterprise/common';

export class FinancialService extends SquidService {
  private toData<T>(doc: any): T {
    return (doc && typeof doc === 'object' && 'data' in doc) ? (doc.data as T) : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map(d => this.toData<T>(d));
  }

  @executable()
  async createFinancials(request: CreateFinancialsRequest): Promise<LoopFinancials> {
    try {
      // Verify loop exists
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

      const financialId = this.generateId();
      const financial: Omit<LoopFinancials, '__id'> = {
        financial_id: financialId,
        loop_id: request.loop_id,
        budget_usd: request.budget_usd,
        actual_spend_usd: request.actual_spend_usd || 0,
        revenue_generated_usd: request.revenue_generated_usd || 0,
        cost_center: request.cost_center,
        fiscal_period: request.fiscal_period,
        notes: request.notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid.collection<LoopFinancials>('loop_financials').doc(financialId).insert(financial);

      return financial as LoopFinancials;
    } catch (error: any) {
      console.error('Error creating financials:', error);
      throw error.error ? error : {
        error: {
          code: 'CREATE_FINANCIALS_FAILED',
          message: 'Failed to create financials',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async updateFinancials(request: UpdateFinancialsRequest): Promise<{ success: boolean }> {
    try {
      const financialRef = this.squid.collection<LoopFinancials>('loop_financials').doc(request.financial_id);
      const financial = await financialRef.snapshot();
      
      if (!financial) {
        throw {
          error: {
            code: 'FINANCIAL_NOT_FOUND',
            message: `Financial record with ID ${request.financial_id} not found`,
          },
        } as ApiError;
      }

      const updates: Partial<LoopFinancials> = {
        updated_at: new Date().toISOString(),
      } as any;

      if (request.budget_usd !== undefined) updates.budget_usd = request.budget_usd;
      if (request.actual_spend_usd !== undefined) updates.actual_spend_usd = request.actual_spend_usd;
      if (request.revenue_generated_usd !== undefined) updates.revenue_generated_usd = request.revenue_generated_usd;
      if (request.notes !== undefined) updates.notes = request.notes;

      await financialRef.update(updates as any);

      return { success: true };
    } catch (error: any) {
      console.error('Error updating financials:', error);
      throw error.error ? error : {
        error: {
          code: 'UPDATE_FINANCIALS_FAILED',
          message: 'Failed to update financials',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getLoopFinancials(loopId: string): Promise<LoopFinancials | null> {
    try {
      const query = this.squid.collection<LoopFinancials>('loop_financials').query();
      const results = await query.eq('loop_id', loopId).snapshot();
      
      if (results.length === 0) return null;
      
      return this.toData<LoopFinancials>(results[0]);
    } catch (error: any) {
      console.error('Error getting loop financials:', error);
      return null;
    }
  }

  @executable()
  async getAllProjectFinancials(): Promise<ProjectFinancialSummary[]> {
    try {
      // Get all loops
      const loopsQuery = this.squid.collection<Loop>('loops').query();
      const loopsSnapshot = await loopsQuery.snapshot();
      const loops = this.toArrayData<Loop>(loopsSnapshot);

      // Get all financials
      const financialsQuery = this.squid.collection<LoopFinancials>('loop_financials').query();
      const financialsSnapshot = await financialsQuery.snapshot();
      const financials = this.toArrayData<LoopFinancials>(financialsSnapshot);

      // Create a map for quick lookup
      const financialsMap = new Map<string, LoopFinancials>();
      financials.forEach(f => financialsMap.set(f.loop_id, f));

      // Build summaries
      const summaries: ProjectFinancialSummary[] = loops
        .filter(loop => financialsMap.has(loop.loop_id))
        .map(loop => {
          const fin = financialsMap.get(loop.loop_id)!;
          const budget = fin.budget_usd || 0;
          const actual = fin.actual_spend_usd || 0;
          const revenue = fin.revenue_generated_usd || 0;
          const variance = budget - actual;
          const roi = actual > 0 ? ((revenue - actual) / actual) * 100 : undefined;

          return {
            loop_id: loop.loop_id,
            title: loop.title,
            loop_type: loop.loop_type,
            category: loop.category,
            total_budget_usd: budget,
            total_actual_usd: actual,
            total_revenue_usd: revenue,
            variance_usd: variance,
            roi_percent: roi,
            status: loop.status,
            owner_email: undefined, // Could enhance with ownership lookup
          };
        });

      return summaries;
    } catch (error: any) {
      console.error('Error getting all project financials:', error);
      return [];
    }
  }

  @executable()
  async getOkrFinancialRollup(request: GetOkrFinancialsRequest): Promise<OkrFinancialRollup> {
    try {
      // Get the objective loop
      const objRef = this.squid.collection<Loop>('loops').doc(request.objective_loop_id);
      const objSnapshot = await objRef.snapshot();
      
      if (!objSnapshot) {
        throw {
          error: {
            code: 'OBJECTIVE_NOT_FOUND',
            message: `Objective loop with ID ${request.objective_loop_id} not found`,
          },
        } as ApiError;
      }

      const objective = this.toData<Loop>(objSnapshot);

      if (objective.loop_type !== 'OBJECTIVE') {
        throw {
          error: {
            code: 'NOT_AN_OBJECTIVE',
            message: `Loop ${request.objective_loop_id} is not an OBJECTIVE`,
          },
        } as ApiError;
      }

      // Get objective financials
      const objFinancials = await this.getLoopFinancials(request.objective_loop_id);

      let totalBudget = objFinancials?.budget_usd || 0;
      let totalActual = objFinancials?.actual_spend_usd || 0;
      let totalRevenue = objFinancials?.revenue_generated_usd || 0;

      const keyResults: OkrFinancialRollup['key_results'] = [];

      if (request.include_key_results) {
        // Find all KEY_RESULT loops with tags or description linking to this objective
        // This is a simplified approach - you could add explicit parent_loop_id field
        const loopsQuery = this.squid.collection<Loop>('loops').query();
        const allLoops = this.toArrayData<Loop>(await loopsQuery.snapshot());
        
        const krLoops = allLoops.filter(l => 
          l.loop_type === 'KEY_RESULT' && 
          (l.tags.includes(request.objective_loop_id) || 
           l.description?.includes(request.objective_loop_id))
        );

        for (const kr of krLoops) {
          const krFin = await this.getLoopFinancials(kr.loop_id);
          const krBudget = krFin?.budget_usd || 0;
          const krActual = krFin?.actual_spend_usd || 0;
          const krRevenue = krFin?.revenue_generated_usd || 0;

          keyResults.push({
            kr_loop_id: kr.loop_id,
            kr_title: kr.title,
            budget_usd: krBudget,
            actual_usd: krActual,
            revenue_usd: krRevenue,
          });

          totalBudget += krBudget;
          totalActual += krActual;
          totalRevenue += krRevenue;
        }
      }

      // Determine health status
      let healthStatus: OkrFinancialRollup['health_status'];
      if (objective.status === 'COMPLETED') {
        healthStatus = 'complete';
      } else if (totalBudget > 0 && totalActual > totalBudget * 1.1) {
        healthStatus = 'over_budget';
      } else if (totalBudget > 0 && totalActual > totalBudget * 0.85) {
        healthStatus = 'at_risk';
      } else {
        healthStatus = 'on_track';
      }

      return {
        objective_loop_id: request.objective_loop_id,
        objective_title: objective.title,
        total_budget_usd: totalBudget,
        total_actual_usd: totalActual,
        total_revenue_usd: totalRevenue,
        key_results: keyResults,
        health_status: healthStatus,
      };
    } catch (error: any) {
      console.error('Error getting OKR financial rollup:', error);
      throw error.error ? error : {
        error: {
          code: 'GET_OKR_FINANCIALS_FAILED',
          message: 'Failed to get OKR financial rollup',
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getFinancialDashboard(): Promise<{
    total_budget: number;
    total_actual: number;
    total_revenue: number;
    projects_by_health: Record<string, number>;
    top_projects: ProjectFinancialSummary[];
  }> {
    try {
      const allProjects = await this.getAllProjectFinancials();

      const totalBudget = allProjects.reduce((sum, p) => sum + p.total_budget_usd, 0);
      const totalActual = allProjects.reduce((sum, p) => sum + p.total_actual_usd, 0);
      const totalRevenue = allProjects.reduce((sum, p) => sum + p.total_revenue_usd, 0);

      const projectsByHealth: Record<string, number> = {
        on_track: 0,
        at_risk: 0,
        over_budget: 0,
        complete: 0,
      };

      allProjects.forEach(p => {
        if (p.status === 'COMPLETED') {
          projectsByHealth.complete++;
        } else if (p.total_actual_usd > p.total_budget_usd * 1.1) {
          projectsByHealth.over_budget++;
        } else if (p.total_actual_usd > p.total_budget_usd * 0.85) {
          projectsByHealth.at_risk++;
        } else {
          projectsByHealth.on_track++;
        }
      });

      // Top 10 projects by budget
      const topProjects = allProjects
        .sort((a, b) => b.total_budget_usd - a.total_budget_usd)
        .slice(0, 10);

      return {
        total_budget: totalBudget,
        total_actual: totalActual,
        total_revenue: totalRevenue,
        projects_by_health: projectsByHealth,
        top_projects: topProjects,
      };
    } catch (error: any) {
      console.error('Error getting financial dashboard:', error);
      return {
        total_budget: 0,
        total_actual: 0,
        total_revenue: 0,
        projects_by_health: {},
        top_projects: [],
      };
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

