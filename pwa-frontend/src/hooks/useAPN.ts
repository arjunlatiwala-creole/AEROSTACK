import type { APN } from "@enterprise/common";
import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import {
	getEngagementInvitations,
	getEngagements,
	getOpportunities,
} from "@/api/apn";

type APNOpportunity = APN.APNOpportunity;
type APNEngagement = APN.APNEngagement;
type APNEngagementInvitation = APN.APNEngagementInvitation;
type APNListParams = APN.APNListParams;
type APNPaginatedResult<T> = APN.APNPaginatedResult<T>;

// Query keys
export const apnKeys = {
	all: ["apn"] as const,
	opportunities: () => [...apnKeys.all, "opportunities"] as const,
	opportunitiesList: (params?: APNListParams) =>
		[...apnKeys.opportunities(), { params }] as const,
	engagements: () => [...apnKeys.all, "engagements"] as const,
	engagementsList: (params?: APNListParams) =>
		[...apnKeys.engagements(), { params }] as const,
	invitations: () => [...apnKeys.all, "invitations"] as const,
	invitationsList: (params?: APNListParams) =>
		[...apnKeys.invitations(), { params }] as const,
};

// Options types
interface UseOpportunitiesOptions
	extends Omit<
		UseQueryOptions<APNPaginatedResult<APNOpportunity>>,
		"queryKey" | "queryFn"
	> {
	limit?: number;
	last_key?: string | null;
	stage?: string;
	status?: string;
}

interface UseEngagementsOptions
	extends Omit<
		UseQueryOptions<APNPaginatedResult<APNEngagement>>,
		"queryKey" | "queryFn"
	> {
	limit?: number;
	last_key?: string | null;
}

interface UseInvitationsOptions
	extends Omit<
		UseQueryOptions<APNPaginatedResult<APNEngagementInvitation>>,
		"queryKey" | "queryFn"
	> {
	limit?: number;
	last_key?: string | null;
	status?: string;
}

// Hooks
export const useOpportunities = (options?: UseOpportunitiesOptions) => {
	const { limit, last_key, stage, status, ...queryOptions } = options ?? {};

	const params: APNListParams = {
		limit,
		last_key,
		stage,
		status,
	};

	return useQuery({
		queryKey: apnKeys.opportunitiesList(params),
		queryFn: () => getOpportunities(params),
		staleTime: 30_000,
		...queryOptions,
	});
};

export const useEngagements = (options?: UseEngagementsOptions) => {
	const { limit, last_key, ...queryOptions } = options ?? {};

	const params: APNListParams = {
		limit,
		last_key,
	};

	return useQuery({
		queryKey: apnKeys.engagementsList(params),
		queryFn: () => getEngagements(params),
		staleTime: 30_000,
		...queryOptions,
	});
};

export const useEngagementInvitations = (options?: UseInvitationsOptions) => {
	const { limit, last_key, status, ...queryOptions } = options ?? {};

	const params: APNListParams = {
		limit,
		last_key,
		status,
	};

	return useQuery({
		queryKey: apnKeys.invitationsList(params),
		queryFn: () => getEngagementInvitations(params),
		staleTime: 30_000,
		...queryOptions,
	});
};
