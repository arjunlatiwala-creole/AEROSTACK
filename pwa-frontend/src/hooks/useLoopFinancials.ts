import {
    type UseQueryOptions,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
    loopFinancialsApi,
    type LoopFinancial,
    type CreateLoopFinancialRequest,
    type ListLoopFinancialsParams,
} from "@/api/loop-financials";
import { logError } from "@/lib/logger";

export const loopFinancialKeys = {
    all: ["loop-financials"] as const,
    lists: () => [...loopFinancialKeys.all, "list"] as const,
    list: (params?: ListLoopFinancialsParams) =>
        [...loopFinancialKeys.lists(), { params }] as const,
    details: () => [...loopFinancialKeys.all, "detail"] as const,
    detail: (id: string) => [...loopFinancialKeys.details(), id] as const,
    byLoopId: (loopId: string) =>
        [...loopFinancialKeys.all, "by-loop", loopId] as const,
};

interface UseLoopFinancialsOptions
    extends Omit<
        UseQueryOptions<{ items: LoopFinancial[]; lastKey?: string }>,
        "queryKey" | "queryFn"
    > {
    params?: ListLoopFinancialsParams;
}

interface MutationOptions<TData = unknown> {
    onSuccess?: (data: TData) => void;
    onError?: (error: Error) => void;
    showToast?: boolean;
    successMessage?: string;
    errorMessage?: string;
}

/**
 * Fetch list of loop financials with optional filters
 */
export const useLoopFinancials = (options?: UseLoopFinancialsOptions) => {
    const { params = {}, ...queryOptions } = options ?? {};

    return useQuery({
        queryKey: loopFinancialKeys.list(params),
        queryFn: async () => {
            const response = await loopFinancialsApi.list(params);
            return response;
        },
        staleTime: 30_000,
        ...queryOptions,
    });
};

/**
 * Fetch financial data for a specific loop
 */
export const useLoopFinancialByLoopId = (
    loopId: string,
    options?: Omit<UseQueryOptions<LoopFinancial | null>, "queryKey" | "queryFn">,
) => {
    return useQuery({
        queryKey: loopFinancialKeys.byLoopId(loopId),
        queryFn: () => loopFinancialsApi.getByLoopId(loopId),
        enabled: !!loopId,
        staleTime: 60_000,
        ...options,
    });
};

/**
 * Create a new loop financial record
 */
export const useCreateLoopFinancial = (
    options?: MutationOptions<LoopFinancial>,
) => {
    const queryClient = useQueryClient();
    const {
        onSuccess,
        onError,
        showToast = true,
        successMessage = "Financial record created successfully",
        errorMessage = "Failed to create financial record",
    } = options || {};

    return useMutation({
        mutationFn: (data: CreateLoopFinancialRequest) =>
            loopFinancialsApi.create(data),
        onSuccess: (data) => {
            // Invalidate all lists to refresh the data
            queryClient.invalidateQueries({ queryKey: loopFinancialKeys.lists() });

            // Also invalidate the specific loop's financial data
            queryClient.invalidateQueries({
                queryKey: loopFinancialKeys.byLoopId(data.loop_id),
            });

            if (showToast) toast.success(successMessage);
            onSuccess?.(data);
        },
        onError: (error: Error) => {
            logError("Error creating loop financial", error);
            if (showToast) toast.error(errorMessage);
            onError?.(error);
        },
    });
};

/**
 * Bulk invalidate loop financials queries
 */
export const useInvalidateLoopFinancials = () => {
    const queryClient = useQueryClient();

    return {
        invalidateAll: () =>
            queryClient.invalidateQueries({ queryKey: loopFinancialKeys.all }),
        invalidateLists: () =>
            queryClient.invalidateQueries({ queryKey: loopFinancialKeys.lists() }),
        invalidateByLoopId: (loopId: string) =>
            queryClient.invalidateQueries({
                queryKey: loopFinancialKeys.byLoopId(loopId),
            }),
    };
};

/**
 * Check if any loop financial mutation is in progress
 */
export const useIsLoopFinancialMutating = () => {
    const queryClient = useQueryClient();
    return queryClient.isMutating({ mutationKey: loopFinancialKeys.all }) > 0;
};