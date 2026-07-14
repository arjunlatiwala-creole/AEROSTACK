import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import axios from "axios";
import { resolvePermissionKey } from "@/lib/permission-map";

const createClient = (baseURL: string) => {
	const client = axios.create({
		baseURL,
		headers: { "Content-Type": "application/json" },
	});

	client.interceptors.request.use(async (config) => {
		try {
			if (import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX") {
				return config;
			}

			const user = await getCurrentUser();
			if (user) {
				const session = await fetchAuthSession({ forceRefresh: false });
				const idToken = session.tokens?.idToken?.toString();
				if (idToken) {
					config.headers.Authorization = `${idToken}`;
				}
			}
		} catch (error) {
			console.warn("Id token unavailable:", error);
		}

		const isPermissionBootstrap = config.url?.includes("/roles/me");
		if (!isPermissionBootstrap && !config.headers["X-Resource-Key"]) {
			const resourceKey = resolvePermissionKey(window.location.pathname);
			if (resourceKey) {
				config.headers["X-Resource-Key"] = resourceKey;
			}
		}

		return config;
	});

	return client;
};

// Main API (ApiStack — port 3000)
const apiClient = createClient(import.meta.env.VITE_BASE_URL);

// Aerostack Dashboard API (ApiAerostackStack — port 3001)
export const aerostackApiClient = createClient(import.meta.env.VITE_Aerostack_BASE_URL);

// Hiring Pipeline API (HiringApiStack — port 3002)
export const hiringApiClient = createClient(import.meta.env.VITE_HIRING_BASE_URL || import.meta.env.VITE_BASE_URL);

export default apiClient;