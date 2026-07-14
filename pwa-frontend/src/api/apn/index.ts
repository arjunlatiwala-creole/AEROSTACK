import type { APN } from "@enterprise/common";
import apiClient from "@/api/client";

type APNOpportunity = APN.APNOpportunity;
type APNEngagement = APN.APNEngagement;
type APNEngagementInvitation = APN.APNEngagementInvitation;
type APNListParams = APN.APNListParams;
type APNPaginatedResult<T> = APN.APNPaginatedResult<T>;

export const getOpportunities = async (
	params: APNListParams = {},
): Promise<APNPaginatedResult<APNOpportunity>> => {
	const response = await apiClient.get("/apn/opportunities", { params });
	return response.data.data;
};

export const getEngagements = async (
	params: APNListParams = {},
): Promise<APNPaginatedResult<APNEngagement>> => {
	const response = await apiClient.get("/apn/engagements", { params });
	return response.data.data;
};

export const getEngagementInvitations = async (
	params: APNListParams = {},
): Promise<APNPaginatedResult<APNEngagementInvitation>> => {
	const response = await apiClient.get("/apn/engagement-invitations", {
		params,
	});
	return response.data.data;
};
