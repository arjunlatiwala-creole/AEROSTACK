import { z } from "zod";

export const CreateLoopFinancialInputSchema = z.object({
    loop_id: z.string().uuid(),
    budget_usd: z.number().optional(),
    actual_spend_usd: z.number().optional(),
    revenue_generated_usd: z.number().optional(),
    cost_center: z.string().optional(),
    fiscal_period: z.string().optional(), // e.g., "2025-Q1"
    notes: z.string().optional(),
});

export const UpdateLoopFinancialInputSchema = z.object({
    budget_usd: z.number().optional(),
    actual_spend_usd: z.number().optional(),
    revenue_generated_usd: z.number().optional(),
    cost_center: z.string().optional(),
    fiscal_period: z.string().optional(),
    notes: z.string().optional(),
});

export const LoopFinancialSchema = z.object({
    financial_id: z.string(),
    loop_id: z.string(),
    budget_usd: z.number().optional(),
    actual_spend_usd: z.number().optional(),
    revenue_generated_usd: z.number().optional(),
    cost_center: z.string().optional(),
    fiscal_period: z.string().optional(),
    notes: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),
});

export type CreateLoopFinancialInput = z.infer<typeof CreateLoopFinancialInputSchema>;
export type UpdateLoopFinancialInput = z.infer<typeof UpdateLoopFinancialInputSchema>;
export type LoopFinancial = z.infer<typeof LoopFinancialSchema>;