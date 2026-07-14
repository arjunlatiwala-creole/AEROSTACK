import apiClient from "@/api/client";
// export const getDeals = async (limit?: number, cursor?: string) => {
//   try {
//     const params = new URLSearchParams();
//     if (limit) params.append("limit", limit.toString());
//     if (cursor) params.append("cursor", cursor);

//     const response = await apiClient.get(
//       `/hubspot/deals-list${params.toString() ? "?" + params.toString() : ""}`,
//     );
//     // const response = await apiClient.get(
//     // 	`/unified/opportunities${params.toString() ? "?" + params.toString() : ""}`,
//     // );
//     return response.data;
//   } catch (error) {
//     console.error("Error fetching deals:", error);
//     throw error;
//   }
// };
export const getDeals = (
  limit = 20,
  cursor?: string,
  opp: "enterprise" | "all" | "my" = "enterprise",
  phase?: string,
  stage?: string,
  closeDate?: string,
  email?: string,
  pipeline?: string,
) => {
  const params: Record<string, string | number> = { limit, opp };

  if (cursor) params.cursor = cursor;
  if (phase) params.phase = phase;
  if (stage) params.stage = stage;
  if (closeDate) params.closeDate = closeDate;
  if (email) params.email = email; // only used when opp="my"
  if (pipeline) params.pipeline = pipeline;

  return apiClient.get("/hubspot/deals-list", { params });
};
export const getDealById = async (dealId: string) => {
  const response = await apiClient.get(`/hubspot/deals-list/${dealId}`);
  return response.data;
};

/**
 * Delete all HubSpot data (deals, companies, contacts) from DynamoDB.
 * Requires ADMIN role.
 */
export const deleteHubspotData = async () => {
  const response = await apiClient.delete("/hubspot/delete-data");
  return response.data;
};
