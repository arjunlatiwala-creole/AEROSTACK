import {
  type UseQueryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getDealById } from "@/api/hubspot";

type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";
type Phase =
  | "LEAD"
  | "DEVELOPING"
  | "ACTIVELY_FUNDING"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "LAUNCHED";
export interface Company {
  id: string;
  name: string;
  domain?: string;
  ownerEmail?: string;
  city?: string;
  state?: string;
  industry?: string;
  ownerName?: string;
  createdAt?: string;
  lastModified?: string;
}

export interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  createdAt?: string;
  lastModified?: string;
}

export interface Deal {
  id: string;
  name: string;
  amount: number | null;
  ownerEmail?: string | null;
  ownerName?: string | null;
  stage?: string | null;
  stage_name?: string | null;
  phase?: Phase | null;
  pipeline?: string | null;
  pipeline_name?: string | null;
  phase_label?: string | null;
  health_status?: HealthStatus | null;
  createdate?: string | null;
  lastmodifieddate?: string | null;

  companies: Company[];
  contacts: Contact[];

  // optional legacy fields (if some APIs still return them)
  company?: string;
  companyName?: string;
  contactEmail?: string;
}

export const dealKeys = {
  all: ["deals"] as const,
  lists: () => [...dealKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...dealKeys.lists(), { filters }] as const,
  details: () => [...dealKeys.all, "detail"] as const,
  detail: (id: string) => [...dealKeys.details(), id] as const,
};

interface UseDealOptions extends Omit<
  UseQueryOptions<Deal>,
  "queryKey" | "queryFn"
> {
  dealId: string;
}

/**
 * Fetch single deal by ID with optimistic caching
 */
export const useDeal = (options: UseDealOptions) => {
  const { dealId, ...queryOptions } = options;

  return useQuery({
    queryKey: dealKeys.detail(dealId),
    queryFn: async () => {
      const res = await getDealById(dealId);
      return res?.data ?? res;
    },
    enabled: !!dealId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    ...queryOptions,
  });
};

/**
 * Get deal from cache without triggering a fetch
 */
export const useDealFromCache = (dealId: string) => {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<Deal>(dealKeys.detail(dealId));
};
