import apiClient from "@/api/client";

export type GivenRole = "User" | "Seller" | "Admin" | "Super-Admin";

export interface RoleUser {
  personId: string;
  email: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  userRole: Record<string, any> | null;
  givenRole: GivenRole;
  updatedAt?: string | null;
  updated_by?: string | null;
}

export interface MyRole {
  personId: string;
  userRole: Record<string, any> | null;
  givenRole: GivenRole;
}

export const listRoleUsers = async (): Promise<RoleUser[]> => {
  const response = await apiClient.get("/roles/users");
  return response.data?.data?.users ?? [];
};

export const getMyRole = async (): Promise<MyRole> => {
  const response = await apiClient.get("/roles/me");
  return response.data?.data ?? { personId: "", userRole: null, givenRole: null };
};

export const saveUserRole = async (
  personId: string,
  createdAt: string,
  userRole: Record<string, any>,
  updated_by?: string,
): Promise<void> => {
  await apiClient.put(`/roles/users/${personId}`, { userRole, createdAt, updated_by });
};

export const deleteUser = async (personId: string): Promise<void> => {
  await apiClient.delete(`/roles/users/${personId}`);
};

export const saveGivenRole = async (
  personId: string,
  createdAt: string,
  givenRole: GivenRole,
  updated_by?: string,
): Promise<void> => {
  await apiClient.put(`/roles/users/${personId}/given-role`, { givenRole, createdAt, updated_by });
};
