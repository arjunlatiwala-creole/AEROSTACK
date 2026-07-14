import { fetchAuthSession } from "aws-amplify/auth";

const TOOLS_API_URL = import.meta.env.VITE_TOOLS_API_URL || "";

interface KbDefinition {
  kbId: string;
  name: string;
  description: string;
  access: string;
  category: string;
  icon: string;
  owner: string;
  entryCount: number;
  createdAt: string;
}

interface KbEntry {
  entryId: string;
  kbId: string;
  title: string;
  content: string;
  tags: string[];
  entryType: string;
  source: string;
  userId: string;
  createdAt: string;
  updatedAt?: string;
}

interface SearchResult {
  entryId: string;
  kbId: string;
  title: string;
  content: string;
  tags: string[];
  entryType: string;
  source: string;
  score: number;
  createdAt: string;
}

class KnowledgeClient {
  private baseUrl: string;

  constructor(baseUrl: string = TOOLS_API_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString() ?? "";
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    } catch {
      return { "Content-Type": "application/json" };
    }
  }

  private async post(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}/knowledge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `KB API error ${res.status}`);
    return data;
  }

  private async get(params: Record<string, string>): Promise<Record<string, unknown>> {
    const headers = await this.getAuthHeaders();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}/knowledge?${qs}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `KB API error ${res.status}`);
    return data;
  }

  private async del(params: Record<string, string>): Promise<Record<string, unknown>> {
    const headers = await this.getAuthHeaders();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}/knowledge?${qs}`, { method: "DELETE", headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `KB API error ${res.status}`);
    return data;
  }

  async listKbs(userId?: string): Promise<KbDefinition[]> {
    const params: Record<string, string> = { action: "list_kbs" };
    if (userId) params.userId = userId;
    const data = await this.get(params);
    return (data.kbs ?? []) as KbDefinition[];
  }

  async createKb(request: { name: string; description: string; access?: string; category?: string; icon?: string; userId?: string }): Promise<{ kbId: string; name: string }> {
    const data = await this.post("create_kb", request);
    return data as { kbId: string; name: string };
  }

  async deleteKb(kbId: string): Promise<void> {
    await this.del({ action: "delete_kb", kbId });
  }

  async listEntries(kbId: string): Promise<KbEntry[]> {
    const data = await this.get({ action: "list_entries", kbId });
    return (data.entries ?? []) as KbEntry[];
  }

  async getEntry(kbId: string, entryId: string): Promise<KbEntry> {
    const data = await this.get({ action: "get_entry", kbId, entryId });
    return data.entry as KbEntry;
  }

  async addEntry(request: {
    kbId?: string; title: string; content: string;
    entryType?: string; tags?: string[]; source?: string;
    userId?: string; autoClassify?: boolean;
  }): Promise<{ entryId: string; kbId: string; tags: string[] }> {
    const data = await this.post("add_entry", request);
    return data as { entryId: string; kbId: string; tags: string[] };
  }

  async deleteEntry(kbId: string, entryId: string): Promise<void> {
    await this.del({ action: "delete_entry", kbId, entryId });
  }

  async search(request: {
    query: string; kbIds?: string[]; kbId?: string;
    userId?: string; limit?: number; minScore?: number;
  }): Promise<{ results: SearchResult[]; count: number; searchedKbs: string[] }> {
    const data = await this.post("search", request);
    return data as { results: SearchResult[]; count: number; searchedKbs: string[] };
  }

  async classify(title: string, content: string): Promise<{ kbId: string; tags: string[]; summary: string; confidence: number }> {
    const data = await this.post("classify", { title, content });
    return data.classification as { kbId: string; tags: string[]; summary: string; confidence: number };
  }
}

export const knowledgeClient = new KnowledgeClient();
export type { KbDefinition, KbEntry, SearchResult };
