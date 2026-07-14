import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import Loader from "@/components/Loader";
import NoData from "@/components/NoData";
import { getSellerDashboard, getSuperAdminDashboard } from "@/api/enterpriseAerostack";
import { Button } from "@/components/ui/button";
import type { EnterpriseAerostackDashboard } from "@/api/enterpriseAerostack";
import {
  AlertTriangle,
  Cpu,
  DollarSign,
  FileText,
  Star,
  Target,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { fetchAuthSession } from "aws-amplify/auth";
import { useEffect, useState } from "react";

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "hsl(var(--chart-1))",
  },
};

function formatCompactCurrencyUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCurrencyUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DashboardEnterpriseAerostack() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sellerScope, setSellerScope] = useState<"my" | "all">("my");
  const queryClient = useQueryClient();

  useEffect(() => {
    const loadUserId = async () => {
      try {
        if (
          import.meta.env.DEV &&
          import.meta.env.VITE_AWS_USER_POOL_ID === "us-east-1_XXXXXXXXX"
        ) {
          setUserId("dev@local");
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const email =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setUserId(String(email || "guest"));
      } catch {
        setUserId("guest");
      }
    };
    loadUserId();
  }, []);

  useEffect(() => {
    if (userId) {
      queryClient.invalidateQueries({ queryKey: ["enterprise-aerostack", "dashboard"] });
    }
  }, [userId, queryClient]);

  const { data, isLoading, isError, refetch } = useQuery<EnterpriseAerostackDashboard>({
    // scope in the key means toggling My/All Deals triggers a fresh fetch
    // backend ignores scope param for non-SELLER roles so it's safe for all views
    queryKey: [
      "enterprise-aerostack",
      "dashboard",
      userId ?? "loading",
      "month",
      sellerScope,
    ],
    queryFn: () => getSellerDashboard({ scope: sellerScope, period: "month" }),
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
  });

  // Show loader while either the session is resolving OR data is fetching
  if (!userId || isLoading) {
    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>
        <Loader />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Unable to load dashboard. Please try again.
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>
        <NoData />
      </div>
    );
  }

  if (data.view === "ADMIN") {
    const d = data.data;
    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Deliveries
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.active_deliveries}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.active_deliveries_status_label}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Open Opportunities
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.open_opportunities}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.open_opportunities_change === null
                  ? "—"
                  : `${d.kpis.open_opportunities_change >= 0 ? "↑" : "↓"} ${Math.abs(
                    d.kpis.open_opportunities_change,
                  )} this week`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Team Members
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{d.kpis.team_members}</div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.team_members_change === null
                  ? "—"
                  : `↑ ${d.kpis.team_members_change} new members`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg CSAT</CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.avg_csat === null ? "—" : `${d.kpis.avg_csat} / 5`}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.avg_csat_change === null
                  ? "CSAT not configured"
                  : `${d.kpis.avg_csat_change >= 0 ? "↑" : "↓"} ${Math.abs(
                    d.kpis.avg_csat_change,
                  )} vs last period`}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Active Deliveries</CardTitle>
              <CardDescription>
                Projects & loops currently running
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-3">
              {d.delivery_monitoring.active_deliveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active deliveries.
                </p>
              ) : (
                d.delivery_monitoring.active_deliveries.map((row) => (
                  <div
                    key={`${row.source}:${row.project}:${row.due_date ?? ""}`}
                    className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {row.project}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.owner ?? "—"} • Due{" "}
                        {row.due_date ? String(row.due_date) : "—"}
                      </div>
                    </div>
                    <div
                      className={[
                        "text-xs font-medium",
                        row.status_color === "GREEN"
                          ? "text-emerald-600"
                          : row.status_color === "YELLOW"
                            ? "text-amber-600"
                            : row.status_color === "RED"
                              ? "text-red-600"
                              : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {row.status}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>Department Health</CardTitle>
              <CardDescription>Completed tasks / total</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-6 mt-4">
              {d.department_health.map((h) => {
                const value = h.completion_pct;
                let barClass = "h-2";
                if (h.department === "RevOps") barClass = "h-2 [&>div]:bg-[#d97706]";
                else if (h.department === "Financials") barClass = "h-2 [&>div]:bg-[#059669]";
                else if (h.department === "Engineering") barClass = "h-2 [&>div]:bg-[#1d4ed8]";
                else if (h.department === "People Ops") barClass = "h-2 [&>div]:bg-[#6d28d9]";
                else if (h.department === "Delivery") barClass = "h-2 [&>div]:bg-[#92400e]";
                return (
                  <div className="space-y-2" key={h.department}>
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{h.department}</span>
                      <span>{value}%</span>
                    </div>
                    <Progress value={value} className={barClass} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          {/* <Card className="col-span-3">
            <CardHeader>
              <CardTitle>People Overview</CardTitle>
              <CardDescription>Team distribution</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-auto pr-2 space-y-5">
              {d.people_overview.length === 0 ? (
                <p className="text-sm text-muted-foreground">No people data.</p>
              ) : (
                d.people_overview.map((p) => (
                  <div key={p.department} className="space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>{p.department}</span>
                      <span>{p.members}</span>
                    </div>
                    <Progress
                      value={
                        d.kpis.team_members === 0
                          ? 0
                          : Math.round((p.members / d.kpis.team_members) * 100)
                      }
                      className="h-2"
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card> */}

          <Card className="col-span-full">
            <CardHeader>
              <CardTitle>Team Activity</CardTitle>
              <CardDescription>Recent platform actions</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2">
              <div className="space-y-8">
                {(d.activity_feed ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recent events.
                  </p>
                ) : (
                  (d.activity_feed ?? []).map((a) => {
                    const occurred = new Date(a.occurredAt);
                    const timeLabel = Number.isNaN(occurred.getTime())
                      ? a.occurredAt
                      : occurred.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                    const meta = (() => {
                      switch (a.type) {
                        case "SALES":
                          return {
                            icon: (
                              <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            ),
                            className:
                              "rounded-full bg-emerald-100 p-2 dark:bg-emerald-900",
                          };
                        case "RISK":
                          return {
                            icon: (
                              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                            ),
                            className:
                              "rounded-full bg-red-100 p-2 dark:bg-red-900",
                          };
                        case "USER":
                          return {
                            icon: (
                              <UserPlus className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                            ),
                            className:
                              "rounded-full bg-purple-100 p-2 dark:bg-purple-900",
                          };
                        default:
                          return {
                            icon: (
                              <Truck className="h-4 w-4 text-muted-foreground" />
                            ),
                            className:
                              "rounded-full bg-muted p-2 dark:bg-muted/50",
                          };
                      }
                    })();

                    return (
                      <div className="flex items-start gap-4" key={a.id}>
                        <div className={meta.className}>{meta.icon}</div>
                        <div>
                          <p className="text-sm font-medium">{a.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {a.updatedBy ? `${a.updatedBy} • ` : ""}{timeLabel}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (data.view === "SELLER") {
    const d = data.data;

    const scope = d.scope === "all" ? "all" : "my";

    const revenueSeries = (d.revenue_series ?? []).map((p) => ({
      label: p.label,
      revenue: p.revenue_usd,
    }));

    // Replace the toggleScope function inside the SELLER view block
    const toggleScope = (next: "my" | "all") => {
      setSellerScope(next); // triggers re-query via queryKey change
    };

    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-sm text-muted-foreground">
              Pipeline, deals, and recent sales activity.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={sellerScope === "my" ? "default" : "outline"}
              onClick={() => toggleScope("my")}
            >
              My Deals
            </Button>
            <Button
              variant={sellerScope === "all" ? "default" : "outline"}
              onClick={() => toggleScope("all")}
            >
              All Deals
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {d.kpis.my_open_deals_label ?? "My Open Deals"}
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{d.kpis.my_open_deals}</div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.my_open_deals_change === null
                  ? "—"
                  : `${d.kpis.my_open_deals_change >= 0 ? "↑" : "↓"} ${Math.abs(
                    d.kpis.my_open_deals_change,
                  )} this week`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {d.kpis.pipeline_label ?? "Pipeline Value"}
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCompactCurrencyUSD(d.kpis.pipeline_value_usd)}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.pipeline_value_change_usd === null
                  ? "—"
                  : `${d.kpis.pipeline_value_change_usd >= 0 ? "↑" : "↓"} ${formatCompactCurrencyUSD(
                    Math.abs(d.kpis.pipeline_value_change_usd),
                  )} vs last period`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                SOWs Created
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.sows_created === null ? "—" : d.kpis.sows_created}
              </div>
              <p className="text-xs text-muted-foreground">This month</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {d.kpis.my_avg_csat_label ?? "My Avg CSAT"}
              </CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.my_avg_csat === null
                  ? "—"
                  : `${d.kpis.my_avg_csat} / 5`}
              </div>
              <p className="text-xs text-muted-foreground">Delivery outcome</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>{d.kpis.revenue_label ?? "My Revenue Trend"}</CardTitle>
              <CardDescription>Closed-won deal value (monthly)</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px] w-full mt-4">
                <ChartContainer config={chartConfig} className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={revenueSeries}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        className="stroke-muted/50"
                      />
                      <XAxis
                        dataKey="label"
                        className="text-[10px]"
                        stroke="#888888"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        className="text-[10px]"
                        stroke="#888888"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `$${value}`}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="var(--color-revenue)"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "var(--color-revenue)", strokeWidth: 2, fillOpacity: 1 }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                        fillOpacity={1}
                        fill="url(#colorRevenue)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>{d.active_deliveries_label ?? "My Active Deliveries"}</CardTitle>
              <CardDescription>Projects you’re involved in</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-3">
              {d.active_deliveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No deliveries found for your account.
                </p>
              ) : (
                d.active_deliveries.map((row) => (
                  <div
                    key={`${row.source}:${row.project}:${row.due_date ?? ""}`}
                    className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {row.project}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.owner ?? "—"} • Due{" "}
                        {row.due_date ? String(row.due_date) : "—"}
                      </div>
                    </div>
                    <div
                      className={[
                        "text-xs font-medium",
                        row.status_color === "GREEN"
                          ? "text-emerald-600"
                          : row.status_color === "YELLOW"
                            ? "text-amber-600"
                            : row.status_color === "RED"
                              ? "text-red-600"
                              : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {row.status}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>{d.kpis.pipeline_label ?? "My Pipeline"}</CardTitle>
              <CardDescription>Active deals and stages</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-3">
              {d.pipeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open deals.</p>
              ) : (
                d.pipeline.map((p) => (
                  <div
                    key={`${p.deal}:${p.updated_at ?? ""}`}
                    className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {p.company ? `${p.company} — ` : ""}
                        {p.deal}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.stage ?? "—"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">
                      {formatCompactCurrencyUSD(p.value_usd)}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>{d.activity_feed_label ?? "My Recent Activity"}</CardTitle>
              <CardDescription>Sales events</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2">
              <div className="space-y-8">
                {(d.activity_feed ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recent activity.
                  </p>
                ) : (
                  (d.activity_feed ?? []).map((a) => {
                    const occurred = new Date(a.occurredAt);
                    const timeLabel = Number.isNaN(occurred.getTime())
                      ? a.occurredAt
                      : occurred.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                    return (
                      <div className="flex items-start gap-4" key={a.id}>
                        <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900">
                          <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{a.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {a.updatedBy ? `${a.updatedBy} • ` : ""}{timeLabel}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (data.view === "USER") {
    const d = data.data;

    return (
      <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
        <div className="flex items-center justify-between space-y-2">
          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-sm text-muted-foreground">
              Your tasks, deliveries, and learning progress.
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                My Open Tasks
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{d.kpis.my_open_tasks}</div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.my_open_tasks_change === null
                  ? "—"
                  : `${d.kpis.my_open_tasks_change >= 0 ? "↑" : "↓"} ${Math.abs(
                    d.kpis.my_open_tasks_change,
                  )} this week`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                My Deliveries
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{d.kpis.my_deliveries}</div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.my_deliveries_status_label}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Learning Progress
              </CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {d.kpis.learning_progress_pct === null
                  ? "—"
                  : `${d.kpis.learning_progress_pct}%`}
              </div>
              <p className="text-xs text-muted-foreground">
                {d.kpis.learning_progress_change === null
                  ? "Not configured"
                  : `${d.kpis.learning_progress_change >= 0 ? "↑" : "↓"} ${Math.abs(
                    d.kpis.learning_progress_change,
                  )}% vs last period`}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          {/* My Tasks */}
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>My Tasks</CardTitle>
              <CardDescription>Open and pending work items</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-3">
              {d.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              ) : (
                d.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <div
                      className={[
                        "h-2 w-2 rounded-full flex-shrink-0",
                        task.done ? "bg-emerald-500" : "bg-amber-500",
                      ].join(" ")}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={[
                          "text-sm font-medium truncate",
                          task.done ? "line-through text-muted-foreground" : "",
                        ].join(" ")}
                      >
                        {task.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-[10px] text-muted-foreground">
                          Due {task.due_date ? String(task.due_date) : "—"}
                        </div>
                        {task.type && (
                          <div className={[
                            "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                            task.type === "Delivery" ? "bg-blue-100 text-blue-700" :
                              task.type === "Learning" ? "bg-purple-100 text-purple-700" :
                                "bg-gray-100 text-gray-700"
                          ].join(" ")}>
                            {task.type}
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      className={[
                        "text-xs font-medium",
                        task.done ? "text-emerald-600" : "text-amber-600",
                      ].join(" ")}
                    >
                      {task.done ? "Done" : "Open"}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Learning Modules */}
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>My Learning</CardTitle>
              <CardDescription>Module completion progress</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-6 mt-4">
              {d.learning.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No learning modules assigned.
                </p>
              ) : (
                d.learning.map((item) => {
                  const barClass =
                    item.pct >= 85
                      ? "h-2"
                      : item.pct >= 50
                        ? "h-2 [&>div]:bg-amber-500"
                        : "h-2 [&>div]:bg-red-500";
                  return (
                    <div className="space-y-2" key={item.module}>
                      <div className="flex items-center justify-between text-sm font-medium">
                        <span className="truncate max-w-[180px]">
                          {item.module}
                        </span>
                        <span>{item.pct}%</span>
                      </div>
                      <Progress value={item.pct} className={barClass} />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* My Active Deliveries */}
        <Card>
          <CardHeader>
            <CardTitle>My Active Deliveries</CardTitle>
            <CardDescription>
              Projects and loops you are part of
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[400px] overflow-y-scroll pr-2 space-y-3">
            {d.deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active deliveries assigned to you.
              </p>
            ) : (
              d.deliveries.map((row) => (
                <div
                  key={`${row.source}:${row.project}:${row.due_date ?? ""}`}
                  className="flex items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {row.project}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.owner ?? "—"} • Due{" "}
                      {row.due_date ? String(row.due_date) : "—"}
                    </div>
                  </div>
                  <div
                    className={[
                      "text-xs font-medium",
                      row.status_color === "GREEN"
                        ? "text-emerald-600"
                        : row.status_color === "YELLOW"
                          ? "text-amber-600"
                          : row.status_color === "RED"
                            ? "text-red-600"
                            : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {row.status}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader>
            <CardTitle>My Activity Feed</CardTitle>
            <CardDescription>Recent events and updates</CardDescription>
          </CardHeader>
          <CardContent className="h-[400px] overflow-y-scroll pr-2">
            <div className="space-y-8">
              {(d.activity_feed ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recent activity found.
                </p>
              ) : (
                (d.activity_feed ?? []).map((a) => {
                  const occurred = new Date(a.occurredAt);
                  const timeLabel = Number.isNaN(occurred.getTime())
                    ? a.occurredAt
                    : occurred.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });

                  const meta = (() => {
                    switch (a.type) {
                      case "AGENT":
                        return {
                          icon: <Cpu className="h-4 w-4 text-blue-600" />,
                          className: "rounded-full bg-blue-100 p-2",
                        };
                      case "SALES":
                        return {
                          icon: (
                            <FileText className="h-4 w-4 text-emerald-600" />
                          ),
                          className: "rounded-full bg-emerald-100 p-2",
                        };
                      case "RISK":
                        return {
                          icon: (
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                          ),
                          className: "rounded-full bg-red-100 p-2",
                        };
                      default:
                        return {
                          icon: (
                            <Truck className="h-4 w-4 text-muted-foreground" />
                          ),
                          className: "rounded-full bg-muted p-2",
                        };
                    }
                  })();

                  return (
                    <div className="flex items-start gap-4" key={a.id}>
                      <div className={meta.className}>{meta.icon}</div>
                      <div>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {a.updatedBy ? `${a.updatedBy} • ` : ""}{timeLabel}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const revenueSeries = data.data.analytics.revenue_pipeline.map((p) => ({
    label: p.label,
    revenue: p.revenue_usd,
    pipeline: p.pipeline_usd,
  }));

  return (
    <div className="flex-1 space-y-8 p-8 pt-6 h-[calc(100vh-4rem)] overflow-y-scroll">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCompactCurrencyUSD(data.data.kpis.total_revenue_usd)}
            </div>
            <p
              className={[
                "text-xs",
                (data.data.kpis.total_revenue_change_pct ?? 0) >= 0
                  ? "text-emerald-500"
                  : "text-red-500",
              ].join(" ")}
            >
              {data.data.kpis.total_revenue_change_pct === null
                ? "—"
                : `${data.data.kpis.total_revenue_change_pct >= 0 ? "↑" : "↓"} ${Math.abs(
                  data.data.kpis.total_revenue_change_pct,
                )}% vs last period`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Open Opportunities
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.data.kpis.open_opportunities}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.data.kpis.open_opportunities_change === null
                ? "—"
                : `${data.data.kpis.open_opportunities_change >= 0 ? "↑" : "↓"} ${Math.abs(
                  data.data.kpis.open_opportunities_change,
                )} this week`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Deliveries
            </CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.data.kpis.active_deliveries}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.data.kpis.active_deliveries_status_label}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg CSAT</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.data.kpis.avg_csat === null
                ? "—"
                : `${data.data.kpis.avg_csat} / 5`}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.data.kpis.avg_csat_change === null
                ? "CSAT not configured"
                : `${data.data.kpis.avg_csat_change >= 0 ? "↑" : "↓"} ${Math.abs(
                  data.data.kpis.avg_csat_change,
                )} vs last period`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.data.kpis.team_members}
            </div>
            <p className="text-xs text-muted-foreground">
              {data.data.kpis.team_members_change === null
                ? "—"
                : `${data.data.kpis.team_members_change} new members`}
            </p>
          </CardContent>
        </Card>

      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Revenue Pipeline</CardTitle>
            <CardDescription>
              Revenue ({formatCurrencyUSD(data.data.kpis.total_revenue_usd)})
              and pipeline trend
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full mt-4">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={revenueSeries}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorRevenueAdmin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      className="stroke-muted/50"
                    />
                    <XAxis dataKey="label" className="text-[10px]" stroke="#888888" tickLine={false} axisLine={false} />
                    <YAxis
                      className="text-[10px]"
                      stroke="#888888"
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-revenue)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--color-revenue)", strokeWidth: 2, fillOpacity: 1 }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      fillOpacity={1}
                      fill="url(#colorRevenueAdmin)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Ops Health by Department</CardTitle>
            <CardDescription>Task completion rate</CardDescription>
          </CardHeader>
          <CardContent className="h-[400px] overflow-y-auto pr-2 space-y-6 mt-4">
            {data.data.analytics.ops_health.map((d) => {
              const value = d.completion_pct;
              let barClass = "h-2";
              if (d.department === "RevOps") barClass = "h-2 [&>div]:bg-[#d97706]";
              else if (d.department === "Financials") barClass = "h-2 [&>div]:bg-[#059669]";
              else if (d.department === "Engineering") barClass = "h-2 [&>div]:bg-[#1d4ed8]";
              else if (d.department === "People Ops") barClass = "h-2 [&>div]:bg-[#6d28d9]";
              else if (d.department === "Delivery") barClass = "h-2 [&>div]:bg-[#92400e]";
              return (
                <div className="space-y-2" key={d.department}>
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{d.department}</span>
                    <span>{value}%</span>
                  </div>
                  <Progress value={value} className={barClass} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform Activity Feed</CardTitle>
          <CardDescription>
            Recent system events happening across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[400px] overflow-y-auto pr-2">
          <div className="space-y-8">
            {(data.data.activity_feed ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent events.</p>
            ) : (
              (data.data.activity_feed ?? []).map((a) => {
                const occurred = new Date(a.occurredAt);
                const timeLabel = Number.isNaN(occurred.getTime())
                  ? a.occurredAt
                  : occurred.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                const meta = (() => {
                  switch (a.type) {
                    case "AGENT":
                      return {
                        icon: (
                          <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        ),
                        className:
                          "rounded-full bg-blue-100 p-2 dark:bg-blue-900",
                      };
                    case "SALES":
                      return {
                        icon: (
                          <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ),
                        className:
                          "rounded-full bg-emerald-100 p-2 dark:bg-emerald-900",
                      };
                    case "RISK":
                      return {
                        icon: (
                          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                        ),
                        className:
                          "rounded-full bg-red-100 p-2 dark:bg-red-900",
                      };
                    case "USER":
                      return {
                        icon: (
                          <UserPlus className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        ),
                        className:
                          "rounded-full bg-purple-100 p-2 dark:bg-purple-900",
                      };
                    default:
                      return {
                        icon: (
                          <Truck className="h-4 w-4 text-muted-foreground" />
                        ),
                        className: "rounded-full bg-muted p-2 dark:bg-muted/50",
                      };
                  }
                })();

                return (
                  <div className="flex items-start gap-4" key={a.id}>
                    <div className={meta.className}>{meta.icon}</div>
                    <div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.updatedBy ? `${a.updatedBy} • ` : ""}{timeLabel}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
