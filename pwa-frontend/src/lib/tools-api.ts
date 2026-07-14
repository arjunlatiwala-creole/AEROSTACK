/**
 * Aerostack Tools API client — typed fetch wrappers for the agent registry.
 * Talks to the tools-api/ CDK-deployed API Gateway.
 */

const API_BASE = import.meta.env.VITE_TOOLS_API_URL ?? '';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  if (!API_BASE) {
    return { success: false, error: 'VITE_TOOLS_API_URL not configured' };
  }
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message ?? `${res.status}: ${res.statusText}`;
      return { success: false, error: msg };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: message };
  }
}

export interface RegistryAgent {
  agent_id: string;
  name: string;
  description: string;
  status: string;
  agent_type: string;
  endpoint: string;
  version: string;
  capabilities: string[];
  config: Record<string, unknown>;
  owner: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface ListAgentsResponse {
  agents: RegistryAgent[];
  count: number;
}

export const agentsApi = {
  list: (params?: { type?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return request<ListAgentsResponse>(`/agents${query ? `?${query}` : ''}`);
  },

  get: (agentId: string) => request<RegistryAgent>(`/agents/${agentId}`),

  create: (body: Omit<RegistryAgent, 'agent_id' | 'created_at' | 'updated_at'>) =>
    request<RegistryAgent>('/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (agentId: string, body: Partial<RegistryAgent>) =>
    request<RegistryAgent>(`/agents/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  delete: (agentId: string) =>
    request<{ deleted: string }>(`/agents/${agentId}`, { method: 'DELETE' }),
};
