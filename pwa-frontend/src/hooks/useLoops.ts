import type { AerostackLoops } from "@enterprise/common";

import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  adaptLoop,
  addComment,
  createLoop,
  deleteLoop,
  getLoopById,
  getLoops,
  scoreLoopEffort,
  scoreLoopOutcome,
  updateLoop,
} from "@/api/loops";
import { logError } from "@/lib/logger";

type Loop = AerostackLoops.Loop;
type CreateLoopInput = AerostackLoops.CreateLoopInput;
type UpdateLoopInput = AerostackLoops.UpdateLoopInput;
type AdaptLoopInput = AerostackLoops.AdaptLoopInput;
type LoopListParams = AerostackLoops.LoopListParams;
type ScoreOutcomeInput = AerostackLoops.ScoreOutcomeInput;

export const loopKeys = {
  all: ["loops"] as const,
  lists: () => [...loopKeys.all, "list"] as const,
  list: (filters?: LoopListParams) =>
    [...loopKeys.lists(), { filters }] as const,
  details: () => [...loopKeys.all, "detail"] as const,
  detail: (id: string) => [...loopKeys.details(), id] as const,
};

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  totalPages: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
  count: number;
}

export type LoopListResponse = PaginatedResult<Loop>;
interface UseLoopsOptions extends Omit<
  UseQueryOptions<LoopListResponse>,
  "queryKey" | "queryFn"
> {
  filters?: LoopListParams;
  limit?: number;
  last_key?: string | null;
}

interface UseLoopOptions extends Omit<
  UseQueryOptions<Loop>,
  "queryKey" | "queryFn"
> {
  loopId: string;
}

/**
 * Fetch paginated/filtered list of loops
 * Auto-refetches when filters change
 */
export const useLoops = (options?: UseLoopsOptions) => {
  const { filters = {}, limit, last_key, ...queryOptions } = options ?? {};

  const transformedFilters: Record<string, string> = Object.entries(
    filters,
  ).reduce(
    (acc, [key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        acc[key] = String(value);
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  // default sort
  transformedFilters.sort_by ??= "priority";

  if (last_key) {
    transformedFilters.nextCursor = last_key;
  }

  const params = {
    ...transformedFilters,
    limit,
    nextCursor: last_key ?? null, // always include nextCursor
  };

  return useQuery({
    queryKey: loopKeys.list(params),
    queryFn: async () => {
      const response = await getLoops(params);
      return (
        response.data ?? {
          items: [],
          total: 0,
          totalPages: 0,
          pageSize: limit ?? 20,
          hasMore: false,
          nextCursor: null,
          count: 0,
        }
      );
    },
    staleTime: 30_000,
    ...queryOptions,
  });
};
/**
 * Fetch single loop by ID with optimistic caching
 */
export const useLoop = (options: UseLoopOptions) => {
  const { loopId, ...queryOptions } = options;

  return useQuery({
    queryKey: loopKeys.detail(loopId),
    queryFn: async () => {
      const res = await getLoopById(loopId);
      return res?.data ?? res;
    },
    enabled: !!loopId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    ...queryOptions,
  });
};

/**
 * Prefetch a loop for instant navigation
 */
export const usePrefetchLoop = () => {
  const queryClient = useQueryClient();

  return (loopId: string) => {
    queryClient.prefetchQuery({
      queryKey: loopKeys.detail(loopId),
      queryFn: () => getLoopById(loopId),
      staleTime: 60_000,
    });
  };
};

interface MutationOptions<TData = unknown> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
  showToast?: boolean;
  successMessage?: string;
  errorMessage?: string;
}

/**
 * Create a new loop
 */
export const useCreateLoop = (options?: MutationOptions<Loop>) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Loop created successfully",
    errorMessage = "Failed to create loop",
  } = options || {};

  return useMutation({
    mutationFn: (loopData: CreateLoopInput) => createLoop(loopData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });
      queryClient.setQueryData(loopKeys.detail(data.loop_id), data);

      if (showToast) toast.success(successMessage);
      onSuccess?.(data);
    },
    onError: (error: Error) => {
      logError("Error creating loop", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

/**
 * Update an existing loop with optimistic updates
 */
export const useUpdateLoop = (options?: MutationOptions<Loop>) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Loop updated successfully",
    errorMessage = "Failed to update loop",
  } = options || {};

  return useMutation({
    mutationFn: ({
      loopId,
      updateData,
    }: {
      loopId: string;
      updateData: Partial<UpdateLoopInput>;
    }) => updateLoop(loopId, updateData),

    onMutate: async ({ loopId, updateData }) => {
      await queryClient.cancelQueries({ queryKey: loopKeys.detail(loopId) });

      const previousLoop = queryClient.getQueryData<Loop>(
        loopKeys.detail(loopId),
      );

      if (previousLoop) {
        queryClient.setQueryData<Loop>(loopKeys.detail(loopId), {
          ...previousLoop,
          ...updateData,
          updated_at: new Date().toISOString(),
        });
      }

      return { previousLoop };
    },

    onSuccess: (data, variables) => {
      queryClient.setQueryData(loopKeys.detail(variables.loopId), data);
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });

      if (showToast) toast.success(successMessage);
      onSuccess?.(data);
    },

    onError: (error: Error, variables, context) => {
      // Rollback on error
      if (context?.previousLoop) {
        queryClient.setQueryData(
          loopKeys.detail(variables.loopId),
          context.previousLoop,
        );
      }

      logError("Error updating loop", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

/**
 * Score effort for a loop
 */
export const useScoreEffort = (options?: MutationOptions) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Effort scored successfully",
    errorMessage = "Failed to score effort",
  } = options || {};

  return useMutation({
    mutationFn: ({
      loopId,
      effortScore,
      updated_by,
    }: {
      loopId: string;
      effortScore: number;
      updated_by?: string;
    }) => scoreLoopEffort(loopId, effortScore, updated_by),

    onMutate: async ({ loopId, effortScore }) => {
      await queryClient.cancelQueries({ queryKey: loopKeys.detail(loopId) });

      const previousLoop = queryClient.getQueryData<Loop>(
        loopKeys.detail(loopId),
      );

      if (previousLoop) {
        queryClient.setQueryData<Loop>(loopKeys.detail(loopId), {
          ...previousLoop,
          effort_score: effortScore,
          updated_at: new Date().toISOString(),
        });
      }

      return { previousLoop };
    },

    onSuccess: (data, variables) => {
      queryClient.setQueryData(loopKeys.detail(variables.loopId), data);
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });

      if (showToast) toast.success(successMessage);
      onSuccess?.(data);
    },

    onError: (error: Error, variables, context) => {
      if (context?.previousLoop) {
        queryClient.setQueryData(
          loopKeys.detail(variables.loopId),
          context.previousLoop,
        );
      }

      logError("Error scoring effort", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

/**
 * Score outcome for a loop with contributors
 */
export const useScoreOutcome = (options?: MutationOptions) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Outcome scored successfully",
    errorMessage = "Failed to score outcome",
  } = options || {};

  return useMutation({
    mutationFn: (data: ScoreOutcomeInput) =>
      scoreLoopOutcome(data.loop_id, {
        outcome_score: data.outcome_score,
        contributors: data.contributors,
        lesson: data.lesson,
        updated_by: data.updated_by,
      }),

    onMutate: async (data) => {
      await queryClient.cancelQueries({
        queryKey: loopKeys.detail(data.loop_id),
      });

      const previousLoop = queryClient.getQueryData<Loop>(
        loopKeys.detail(data.loop_id),
      );

      if (previousLoop) {
        queryClient.setQueryData<Loop>(loopKeys.detail(data.loop_id), {
          ...previousLoop,
          outcome_score: data.outcome_score,
          updated_at: new Date().toISOString(),
        });
      }

      return { previousLoop };
    },

    onSuccess: (data, variables) => {
      queryClient.setQueryData(loopKeys.detail(variables.loop_id), data);
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });

      if (showToast) toast.success(successMessage);
      onSuccess?.(data);
    },

    onError: (error: Error, variables, context) => {
      if (context?.previousLoop) {
        queryClient.setQueryData(
          loopKeys.detail(variables.loop_id),
          context.previousLoop,
        );
      }

      logError("Error scoring outcome", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

/**
 * Adapt loop
 */
export const useAdaptLoop = (options?: MutationOptions) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Loop transitioned successfully",
    errorMessage = "Failed to transition loop",
  } = options || {};

  return useMutation({
    mutationFn: (transitionData: AdaptLoopInput) =>
      adaptLoop(transitionData.loop_id, {
        why: transitionData.why,
        what: transitionData.what,
        new_target_completion_date: transitionData.new_target_completion_date,
        create_follow_on: transitionData.create_follow_on,
        follow_on_title: transitionData.follow_on_title,
        follow_on_priority: transitionData.follow_on_priority,
        adaptations: transitionData.adaptations,
        updated_by: transitionData.updated_by,
      }),

    onSuccess: (data, variables) => {
      queryClient.setQueryData(loopKeys.detail(variables.loop_id), data);
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });

      if (showToast) toast.success(successMessage);
      onSuccess?.(data);
    },

    onError: (error: Error) => {
      logError("Error transitioning loop", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

// ============ UTILITY HOOKS ============

/**
 * Get loop from cache without triggering a fetch
 */
export const useLoopFromCache = (loopId: string) => {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<Loop>(loopKeys.detail(loopId));
};

/**
 * Bulk invalidate loops queries
 */
export const useInvalidateLoops = () => {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: loopKeys.all }),
    invalidateLists: () =>
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() }),
    invalidateDetail: (loopId: string) =>
      queryClient.invalidateQueries({ queryKey: loopKeys.detail(loopId) }),
  };
};

/**
 * Check if any loop mutation is in progress
 */
export const useIsLoopMutating = () => {
  const queryClient = useQueryClient();
  return queryClient.isMutating({ mutationKey: loopKeys.all }) > 0;
};

/**
 * Delete loop
 */
export const useDeleteLoop = (
  options?: MutationOptions<{ message: string; loop_id: string }>,
) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Loop deleted successfully",
    errorMessage = "Failed to delete loop",
  } = options || {};

  return useMutation({
    mutationFn: (loopId: string) => deleteLoop(loopId),

    onMutate: async (loopId) => {
      await queryClient.cancelQueries({ queryKey: loopKeys.detail(loopId) });

      const previousLoop = queryClient.getQueryData<Loop>(
        loopKeys.detail(loopId),
      );

      // Optimistically remove from lists
      queryClient.setQueriesData<LoopListResponse>(
        { queryKey: loopKeys.lists() },
        (old) =>
          old
            ? {
                ...old,
                items: old.items.filter((l) => l.loop_id !== loopId),
                count: old.count - 1,
                total: old.total - 1,
              }
            : old,
      );

      return { previousLoop };
    },

    onSuccess: (_data, loopId) => {
      queryClient.removeQueries({ queryKey: loopKeys.detail(loopId) });
      queryClient.invalidateQueries({ queryKey: loopKeys.lists() });

      if (showToast) toast.success(successMessage);
      onSuccess?.(_data);
    },

    onError: (error: Error, loopId, context) => {
      if (context?.previousLoop) {
        queryClient.setQueryData(loopKeys.detail(loopId), context.previousLoop);
      }

      logError("Error deleting loop", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};

/**
 * Add a comment to a loop
 */
export const useAddComment = (options?: MutationOptions) => {
  const queryClient = useQueryClient();
  const {
    onSuccess,
    onError,
    showToast = true,
    successMessage = "Comment added",
    errorMessage = "Failed to add comment",
  } = options || {};

  return useMutation({
    mutationFn: ({
      loopId,
      data,
    }: {
      loopId: string;
      data: {
        content: string;
        author_email?: string;
        author_name?: string;
        mentions?: string[];
        attachments?: Array<{
          file_name: string;
          file_url: string;
          file_type: string;
          file_size: number;
        }>;
      };
    }) => addComment(loopId, data),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: loopKeys.detail(variables.loopId),
      });

      if (showToast) toast.success(successMessage);
      onSuccess?.(_data);
    },

    onError: (error: Error) => {
      logError("Error adding comment", error);
      if (showToast) toast.error(errorMessage);
      onError?.(error);
    },
  });
};
