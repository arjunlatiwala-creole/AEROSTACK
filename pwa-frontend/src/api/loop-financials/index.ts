import apiClient from '../client';

export interface LoopFinancial {
    financial_id: string;
    loop_id: string;
    budget_usd?: number;
    actual_spend_usd?: number;
    revenue_generated_usd?: number;
    cost_center?: string;
    fiscal_period?: string;
    notes?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateLoopFinancialRequest {
    loop_id: string;
    budget_usd?: number;
    actual_spend_usd?: number;
    revenue_generated_usd?: number;
    cost_center?: string;
    fiscal_period?: string;
    notes?: string;
}

export interface ListLoopFinancialsParams {
    loop_id?: string;
    fiscal_period?: string;
    limit?: number;
    last_key?: string;
}

export interface ListLoopFinancialsResponse {
    items: LoopFinancial[];
    lastKey?: string;
}

export class LoopFinancialsApi {
    private basePath = '/loop-financials';

    async create(data: CreateLoopFinancialRequest): Promise<LoopFinancial> {
        const response = await apiClient.post<LoopFinancial>(this.basePath, data);
        return response.data;
    }

    async list(params?: ListLoopFinancialsParams): Promise<ListLoopFinancialsResponse> {
        const response = await apiClient.get<ListLoopFinancialsResponse>(this.basePath, {
            params,
        });
        return response.data;
    }

    async getByLoopId(loopId: string): Promise<LoopFinancial | null> {
        const response = await this.list({ loop_id: loopId, limit: 1 });
        return response.items.length > 0 ? response.items[0] : null;
    }
}

export const loopFinancialsApi = new LoopFinancialsApi();