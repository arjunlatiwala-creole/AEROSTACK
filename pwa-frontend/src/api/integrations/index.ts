import apiClient from "@/api/client";
import type { Integration } from "@/types/integrations";

export const listIntegrations = async () => {
	const response = await apiClient.get("/integrations");
	return response.data;
};

export const createIntegration = async (data: Partial<Integration>) => {
	const response = await apiClient.post("/integrations", data);
	return response.data;
};

export const updateIntegration = async (
	id: string,
	data: Partial<Integration>,
) => {
	const response = await apiClient.patch(`/integrations/${id}`, data);
	return response.data;
};

export const deleteIntegration = async (id: string) => {
	const response = await apiClient.delete(`/integrations/${id}`);
	return response.data;
};

export const getIntegration = async (id: string) => {
	const response = await apiClient.get(`/integrations/${id}`);
	return response.data;
};

/**
 * Get sync history for an integration
 * @param integrationId - Integration ID
 * @param options - Optional query parameters
 * @param options.limit - Maximum number of records to return (1-100, default: 50)
 * @param options.nextToken - Pagination token from previous response
 */
export const getSyncHistory = async (
	integrationId: string,
	options?: {
		limit?: number;
		nextToken?: string;
	},
) => {
	const params = new URLSearchParams();
	if (options?.limit) params.append("limit", options.limit.toString());
	if (options?.nextToken) params.append("nextToken", options.nextToken);

	const queryString = params.toString();
	const url = `/integrations/${integrationId}/sync-history${queryString ? `?${queryString}` : ""}`;

	const response = await apiClient.get(url);
	return response.data;
};

/**
 * Get detailed sync records for a specific sync operation
 * @param syncId - Sync operation ID
 * @param options - Optional query parameters
 * @param options.entity_type - Filter by entity type (e.g., 'contact', 'deal')
 * @param options.status - Filter by sync status ('success' or 'failure')
 * @param options.limit - Maximum number of records to return (1-200, default: 100)
 * @param options.nextToken - Pagination token from previous response
 */
export const getSyncDetails = async (
	syncId: string,
	options?: {
		entity_type?: string;
		status?: "success" | "failure";
		limit?: number;
		nextToken?: string;
	},
) => {
	const params = new URLSearchParams();
	if (options?.entity_type) params.append("entity_type", options.entity_type);
	if (options?.status) params.append("status", options.status);
	if (options?.limit) params.append("limit", options.limit.toString());
	if (options?.nextToken) params.append("nextToken", options.nextToken);

	const queryString = params.toString();
	const url = `/integrations/sync/${syncId}/details${queryString ? `?${queryString}` : ""}`;

	const response = await apiClient.get(url);
	return response.data;
};

export const triggerManualSync = async ({
	integrationType,
	integrationId,
}: {
	integrationType: string;
	integrationId: string;
}) => {
	const url = `/integrations/manual-sync/${integrationType}`;
	const response = await apiClient.post(url, { integration_id: integrationId });
	return response.data;
};

export const testIntegration = async (integrationType: string) => {
	const response = await apiClient.post(`/integrations/test/${integrationType}`);
	return response.data;
};
