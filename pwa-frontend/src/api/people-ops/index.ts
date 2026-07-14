// services/peopleOpsApi.ts
import apiClient from "@/api/client";

export interface PeopleDashboardFilters {
  name?: string;
  email?: string;
  department?: string;
  status?: string;
}

export const getDashboard = async (filters?: PeopleDashboardFilters) => {
  const params: Record<string, string> = {};
  if (filters?.name) params.name = filters.name;
  if (filters?.email) params.email = filters.email;
  if (filters?.department) params.department = filters.department;
  if (filters?.status) params.status = filters.status;

  const response = await apiClient.get("/people-ops/dashboard", {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return response.data;
};

export const getPersonByEmail = async (email?: string, tab?: string) => {
  const response = await apiClient.get("/people-ops/person", {
    params: {
      ...(email ? { email } : {}),
      ...(tab ? { tab } : {}),
    },
  });
  return response.data;
};

export const upsertPersonInformation = async (payload: Record<string, any>) => {
  const response = await apiClient.put(
    "/people-ops/person-information",
    payload,
  );
  return response.data;
};

export const syncFromDeel = async () => {
  const response = await apiClient.post("/people-ops-sync", {
    force_refresh: true,
  });
  return response.data;
};
