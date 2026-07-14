import apiClient from "@/api/client";

export const getDocs = async () => {
	try {
		const response = await apiClient.get("/openapi");
		return response.data;
	} catch (error) {
		console.error("Error fetching docs:", error);
		throw error;
	}
};
