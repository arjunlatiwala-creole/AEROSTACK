export interface AppConfig {
  apiBaseUrl?: string;
  aerostackApiUrl?: string;
}

export const config: AppConfig = {
  apiBaseUrl: import.meta.env.VITE_BASE_URL,
  aerostackApiUrl: import.meta.env.VITE_Aerostack_BASE_URL,
};
