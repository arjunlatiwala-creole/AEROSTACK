import React, { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

// ─── Shared colour tokens ─────────────────────────────────────────────────────
export const CHART_COLORS = {
  completed: "#22c55e",   // green-500
  inProgress: "#3b82f6",  // blue-500
  notStarted: "#94a3b8",  // slate-400
  overdue: "#ef4444",     // red-500
  compliant: "#a855f7",   // purple-500
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StatusMetrics {
  totalAssignments: number;
  totalCompleted: number;
  totalInProgress: number;
  totalNotStarted: number;
  totalOverdue: number;
  completionRate: number;
}

export interface RequirementBar {
  name: string;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
}

// ─── Animated stat strip ──────────────────────────────────────────────────────
interface StatStripProps {
  metrics: StatusMetrics;
  /** Label shown in the ring centre */
  label?: string;
}

function AnimatedNumber({ value }: { value: number }) {
  return (
    <span className="tabular-nums">{value.toLocaleString()}</span>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
interface DonutProps {
  metrics: StatusMetrics;
  title: string;
}

export function StatusDonut({ metrics, title }: DonutProps) {
  const data = useMemo(() => [
    { name: "Completed",   value: metrics.totalCompleted,  color: CHART_COLORS.completed },
    { name: "In Progress", value: metrics.totalInProgress, color: CHART_COLORS.inProgress },
    { name: "Not Started", value: metrics.totalNotStarted, color: CHART_COLORS.notStarted },
    { name: "Overdue",     value: metrics.totalOverdue,    color: CHART_COLORS.overdue },
  ].filter(d => d.value > 0), [metrics]);

  const total = metrics.totalAssignments;

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative flex flex-col items-center">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={88}
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {data.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--background))",
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    `${value} (${total > 0 ? Math.round((value / total) * 100) : 0}%)`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Centre label */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
            <p className="text-2xl font-bold leading-none">{metrics.completionRate}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Complete</p>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
            {data.map(d => (
              <div key={d.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                {d.name} <span className="font-medium text-foreground ml-0.5">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Stacked bar chart ────────────────────────────────────────────────────────
interface StackedBarProps {
  data: RequirementBar[];
  title: string;
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-background p-2.5 shadow text-xs space-y-1 max-w-[220px]">
      <p className="font-semibold truncate">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 justify-between">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: entry.fill }} />
            {entry.name}
          </span>
          <span className="font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function RequirementStackedBar({ data, title }: StackedBarProps) {
  // Truncate long names for axis
  const chartData = data.map(d => ({
    ...d,
    shortName: d.name.length > 22 ? d.name.slice(0, 20) + "…" : d.name,
  }));

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="shortName"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="completed"  name="Completed"   stackId="a" fill={CHART_COLORS.completed}  radius={[0,0,0,0]} />
              <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={CHART_COLORS.inProgress} radius={[0,0,0,0]} />
              <Bar dataKey="notStarted" name="Not Started" stackId="a" fill={CHART_COLORS.notStarted} radius={[0,0,0,0]} />
              <Bar dataKey="overdue"    name="Overdue"     stackId="a" fill={CHART_COLORS.overdue}    radius={[0,4,4,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Compact legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {[
            { label: "Completed",   color: CHART_COLORS.completed },
            { label: "In Progress", color: CHART_COLORS.inProgress },
            { label: "Not Started", color: CHART_COLORS.notStarted },
            { label: "Overdue",     color: CHART_COLORS.overdue },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Metric Stat Cards (animated) ─────────────────────────────────────────────
interface MetricStripProps {
  metrics: StatusMetrics;
  label?: string;
}

export function MetricStatStrip({ metrics, label }: MetricStripProps) {
  const stats = [
    {
      icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
      value: metrics.totalCompleted,
      label: "Completed",
      accent: "text-green-600",
      bg: "bg-green-50 dark:bg-green-950/20 border-green-100 dark:border-green-900",
    },
    {
      icon: <Clock className="h-4 w-4 text-blue-500" />,
      value: metrics.totalInProgress,
      label: "In Progress",
      accent: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900",
    },
    {
      icon: <TrendingUp className="h-4 w-4 text-slate-400" />,
      value: metrics.totalNotStarted,
      label: "Not Started",
      accent: "text-slate-500",
      bg: "bg-slate-50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800",
    },
    {
      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
      value: metrics.totalOverdue,
      label: "Overdue",
      accent: "text-red-600",
      bg: "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900",
    },
  ];

  return (
    <div>
      {label && (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {label}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div
            key={s.label}
            className={`rounded-lg border p-3 flex items-center gap-3 ${s.bg}`}
          >
            <div className="shrink-0">{s.icon}</div>
            <div>
              <p className={`text-xl font-bold leading-none ${s.accent}`}>
                <AnimatedNumber value={s.value} />
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Combined dual-metric panel (loops + accreditations side-by-side) ─────────
export interface AccreditationSummary {
  totalAssigned: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  complianceRate: number;
  requirementCount: number;
  compliantCount: number;
}

interface CombinedInsightProps {
  loopMetrics: StatusMetrics;
  accredMetrics: AccreditationSummary | null;
  isAdmin: boolean;
}

export function CombinedLearningInsight({ loopMetrics, accredMetrics, isAdmin }: CombinedInsightProps) {
  const accredStatusMetrics: StatusMetrics | null = accredMetrics
    ? {
        totalAssignments: accredMetrics.totalAssigned,
        totalCompleted: accredMetrics.completed,
        totalInProgress: accredMetrics.inProgress,
        totalNotStarted: accredMetrics.notStarted,
        totalOverdue: accredMetrics.overdue,
        completionRate: accredMetrics.complianceRate,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Donut row */}
      <div className={`grid gap-4 ${accredStatusMetrics ? "md:grid-cols-2" : "grid-cols-1"}`}>
        <StatusDonut metrics={loopMetrics} title="Learning Loop Status" />
        {accredStatusMetrics && (
          <StatusDonut metrics={accredStatusMetrics} title="Accreditation Status" />
        )}
      </div>
    </div>
  );
}
