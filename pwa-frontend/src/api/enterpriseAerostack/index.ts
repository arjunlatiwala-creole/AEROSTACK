import { aerostackApiClient } from "@/api/client";

export type DashboardPeriod = "week" | "month";

export type ActivityType = "AGENT" | "SALES" | "DELIVERY" | "RISK" | "USER";

export interface EnterpriseAerostackDashboardActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  occurredAt: string;
  updatedBy?: string | null;
}

export interface EnterpriseAerostackRevenuePoint {
  label: string;
  revenue_usd: number;
  pipeline_usd: number;
}

export interface EnterpriseAerostackOpsHealthItem {
  department: string;
  completion_pct: number;
  completed: number;
  total: number;
}

export interface EnterpriseAerostackAdminDeliveryRow {
  project: string;
  owner: string | null;
  status: "On Track" | "At Risk" | "Delayed" | "Unknown";
  status_color: "GREEN" | "YELLOW" | "RED" | "GRAY";
  due_date: string | null;
  source: "PROJECT" | "LOOP";
}

export interface EnterpriseAerostackPeopleOverviewRow {
  department: string;
  members: number;
}

export interface EnterpriseAerostackSuperAdminDashboard {
  kpis: {
    total_revenue_usd: number;
    total_revenue_change_pct: number | null;
    open_opportunities: number;
    open_opportunities_change: number | null;
    active_deliveries: number;
    active_deliveries_status_label: string;
    avg_csat: number | null;
    avg_csat_change: number | null;
    team_members: number;
    team_members_change: number | null;
  };
  analytics: {
    period: DashboardPeriod;
    revenue_pipeline: EnterpriseAerostackRevenuePoint[];
    ops_health: EnterpriseAerostackOpsHealthItem[];
  };
  activity_feed: EnterpriseAerostackDashboardActivityItem[];
  generated_at: string;
}

export interface EnterpriseAerostackAdminDashboard {
  kpis: {
    active_deliveries: number;
    active_deliveries_status_label: string;
    open_opportunities: number;
    open_opportunities_change: number | null;
    team_members: number;
    team_members_change: number | null;
    avg_csat: number | null;
    avg_csat_change: number | null;
  };
  delivery_monitoring: {
    active_deliveries: EnterpriseAerostackAdminDeliveryRow[];
  };
  department_health: EnterpriseAerostackOpsHealthItem[];
  people_overview: EnterpriseAerostackPeopleOverviewRow[];
  activity_feed: EnterpriseAerostackDashboardActivityItem[];
  generated_at: string;
}

export interface EnterpriseAerostackSellerDashboard {
  scope: "my" | "all";
  kpis: {
    my_open_deals: number;
    my_open_deals_change: number | null;
    my_open_deals_label?: string;
    pipeline_value_usd: number;
    pipeline_value_change_usd: number | null;
    pipeline_label?: string;
    sows_created: number | null;
    my_avg_csat: number | null;
    my_avg_csat_label?: string;
    revenue_label?: string;
  };
  revenue_series: Array<{ label: string; revenue_usd: number }>;
  active_deliveries: EnterpriseAerostackAdminDeliveryRow[];
  active_deliveries_label?: string;
  pipeline: Array<{
    company: string | null;
    deal: string;
    stage: string | null;
    value_usd: number;
    updated_at: string | null;
  }>;
  activity_feed: EnterpriseAerostackDashboardActivityItem[];
  activity_feed_label?: string;
  generated_at: string;
}

export interface EnterpriseAerostackUserDashboard {
  kpis: {
    my_open_tasks: number;
    my_open_tasks_change: number | null;
    my_deliveries: number;
    my_deliveries_status_label: string;
    learning_progress_pct: number | null;
    learning_progress_change: number | null;
  };
  tasks: Array<{
    id: string;
    title: string;
    due_date: string | null;
    done: boolean;
    type?: string;
  }>;
  deliveries: EnterpriseAerostackAdminDeliveryRow[];
  learning: Array<{ module: string; pct: number }>;
  activity_feed: EnterpriseAerostackDashboardActivityItem[];
  generated_at: string;
}

export type EnterpriseAerostackDashboard =
  | { view: "SUPER_ADMIN"; data: EnterpriseAerostackSuperAdminDashboard }
  | { view: "ADMIN"; data: EnterpriseAerostackAdminDashboard }
  | { view: "SELLER"; data: EnterpriseAerostackSellerDashboard }
  | { view: "USER"; data: EnterpriseAerostackUserDashboard };

// Your Lambda's ok() wraps responses in { success: true, data: ... }
type ApiOk<T> = { success: true; data: T };
type ApiErr = { success: false; error: string };

export async function getSellerDashboard(params?: {
  scope?: "my" | "all";
  period?: DashboardPeriod;
}): Promise<EnterpriseAerostackDashboard> {
  const response = await aerostackApiClient.get<ApiOk<EnterpriseAerostackDashboard> | ApiErr>(
    "/enterprise-aerostack/dashboard",
    {
      params: {
        period: params?.period ?? "week",
        ...(params?.scope ? { scope: params.scope } : {}),
      },
    },
  );

  const payload = response.data;

  // Handle wrapped { success, data } envelope
  if (payload && "success" in payload) {
    if (payload.success === false) {
      throw new Error(payload.error ?? "Failed to load dashboard");
    }
    return payload.data;
  }

  // Lambda returned the union directly (no wrapper)
  return payload as unknown as EnterpriseAerostackDashboard;
}

// Keep alias so any existing imports of getSuperAdminDashboard still work
export const getSuperAdminDashboard = getSellerDashboard;
