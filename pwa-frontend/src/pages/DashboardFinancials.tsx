import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DollarSign,
  Plus,
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Loader from "@/components/Loader";
import {
  loopFinancialsApi,
  type CreateLoopFinancialRequest,
  type LoopFinancial,
} from "@/api/loop-financials";
import { toast } from "react-hot-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLoops } from "@/hooks/useLoops";
import {
  useLoopFinancials,
  useCreateLoopFinancial,
} from "@/hooks/useLoopFinancials";
import { useWriteAccess } from "@/hooks/useWriteAccess";

interface ProjectSummary {
  loop_id: string;
  title: string;
  loop_type: string;
  category: string;
  total_budget_usd: number;
  total_actual_usd: number;
  total_revenue_usd: number;
  variance_usd: number;
  roi_percent?: number;
  status: string;
}

interface DashboardData {
  total_budget: number;
  total_actual: number;
  total_revenue: number;
  projects_by_health: Record<string, number>;
  top_projects: ProjectSummary[];
}

export default function DashboardFinancials() {
  const [financials, setFinancials] = useState<LoopFinancial[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [showAddFinancials, setShowAddFinancials] = useState(false);
  const { canWrite } = useWriteAccess();
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState<CreateLoopFinancialRequest>({
    loop_id: "",
    budget_usd: 0,
    actual_spend_usd: 0,
    revenue_generated_usd: 0,
    cost_center: "",
    fiscal_period: "",
    notes: "",
  });

  const [page, setPage] = useState(1);
  const LOOPS_PER_PAGE = 10; // Load 20 more items each time
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Use hooks for data fetching
  const {
    data: financialsResponse,
    isLoading: financialsLoading,
    refetch: refetchFinancials,
  } = useLoopFinancials();
  const { mutate: createFinancial, isPending: isCreating } =
    useCreateLoopFinancial({
      onSuccess: () => {
        setShowAddFinancials(false);
        // Reset form
        setFormData({
          loop_id: "",
          budget_usd: 0,
          actual_spend_usd: 0,
          revenue_generated_usd: 0,
          cost_center: "",
          fiscal_period: "",
          notes: "",
        });
      },
    });

  // Fetch loops with cumulative limit (backend doesn't support offset)
  const { data: loopsResponse, isLoading: loopsLoading } = useLoops({
    filters: {},
    limit: page * LOOPS_PER_PAGE, // Cumulative: 20, 40, 60, 80...
  });

  console.log("=== LOOPS DEBUG ===");
  console.log("loopsResponse:", loopsResponse);
  console.log("page:", page);
  console.log("limit:", page * LOOPS_PER_PAGE);

  // Handle both possible response structures from the hook
  // API returns: { data: { items, total, count } } or { items, meta: { total } }
  const loops =
    loopsResponse?.data?.items ??
    loopsResponse?.items ??
    loopsResponse?.data ??
    [];

  // Try multiple paths to get the total count
  const totalCount =
    loopsResponse?.data?.total ?? // API structure: { data: { total: 22 } }
    loopsResponse?.total ?? // Alternative: { total: 22 }
    loopsResponse?.meta?.total ?? // Alternative: { meta: { total: 22 } }
    0;

  const hasMore = loops.length < totalCount;

  console.log("loops.length:", loops.length);
  console.log("totalCount:", totalCount);
  console.log("hasMore:", hasMore);
  console.log("===================");

  // Compute dashboard when financials change
  useEffect(() => {
    if (financials.length > 0) {
      computeDashboard(financials);
    } else if (!financialsLoading) {
      // Empty state
      setDashboard({
        total_budget: 0,
        total_actual: 0,
        total_revenue: 0,
        projects_by_health: {
          on_track: 0,
          at_risk: 0,
          over_budget: 0,
          complete: 0,
        },
        top_projects: [],
      });
    }
  }, [financials, financialsLoading]);

  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore) {
      setIsLoadingMore(true);
      setPage((prev) => prev + 1);
      // Reset loading state after hook refetches
      setTimeout(() => setIsLoadingMore(false), 500);
    }
  };

  const handleOpenAddFinancials = () => {
    setPage(1); // Reset to first page when opening dialog
    setShowAddFinancials(true);
  };

  useEffect(() => {
    loadFinancials();
  }, []);

  const loadFinancials = async () => {
    setLoading(true);
    try {
      const response = await loopFinancialsApi.list();
      if (response.data && response.data.items) {
        setFinancials(response.data.items);
        computeDashboard(response.data.items);
      }
    } catch (error: any) {
      console.error("Error loading financials:", error);
      toast.error("Failed to load financial data");
      // Fallback to empty state
      setFinancials([]);
      setDashboard({
        total_budget: 0,
        total_actual: 0,
        total_revenue: 0,
        projects_by_health: {
          on_track: 0,
          at_risk: 0,
          over_budget: 0,
          complete: 0,
        },
        top_projects: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const computeDashboard = (items: LoopFinancial[]) => {
    const totalBudget = items.reduce((sum, f) => sum + (f.budget_usd || 0), 0);
    const totalActual = items.reduce(
      (sum, f) => sum + (f.actual_spend_usd || 0),
      0,
    );
    const totalRevenue = items.reduce(
      (sum, f) => sum + (f.revenue_generated_usd || 0),
      0,
    );

    // For now, create simple project summaries
    // In a real implementation, you'd join with loops data
    const projects: ProjectSummary[] = items.map((f) => {
      const budget = f.budget_usd || 0;
      const actual = f.actual_spend_usd || 0;
      const revenue = f.revenue_generated_usd || 0;
      const variance = budget - actual;
      const roi = actual > 0 ? ((revenue - actual) / actual) * 100 : undefined;

      return {
        loop_id: f.loop_id,
        title: `Loop ${f.loop_id.substring(0, 8)}...`,
        loop_type: "Project",
        category: f.cost_center || "General",
        total_budget_usd: budget,
        total_actual_usd: actual,
        total_revenue_usd: revenue,
        variance_usd: variance,
        roi_percent: roi,
        status: "ACTIVE",
      };
    });

    const projectsByHealth = {
      on_track: 0,
      at_risk: 0,
      over_budget: 0,
      complete: 0,
    };

    projects.forEach((p) => {
      if (p.status === "COMPLETED") {
        projectsByHealth.complete++;
      } else if (p.total_actual_usd > p.total_budget_usd * 1.1) {
        projectsByHealth.over_budget++;
      } else if (p.total_actual_usd > p.total_budget_usd * 0.85) {
        projectsByHealth.at_risk++;
      } else {
        projectsByHealth.on_track++;
      }
    });

    setDashboard({
      total_budget: totalBudget,
      total_actual: totalActual,
      total_revenue: totalRevenue,
      projects_by_health: projectsByHealth,
      top_projects: projects
        .sort((a, b) => b.total_budget_usd - a.total_budget_usd)
        .slice(0, 10),
    });
  };

  const handleCreateFinancial = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.loop_id) {
      toast.error("Loop ID is required");
      return;
    }

    setSubmitting(true);
    try {
      await loopFinancialsApi.create(formData);
      toast.success("Financial record created successfully!");
      setShowAddFinancials(false);

      // Reset form
      setFormData({
        loop_id: "",
        budget_usd: 0,
        actual_spend_usd: 0,
        revenue_generated_usd: 0,
        cost_center: "",
        fiscal_period: "",
        notes: "",
      });

      // Reload data
      await loadFinancials();
    } catch (error: any) {
      console.error("Error creating financial:", error);
      toast.error(
        error.response?.data?.message || "Failed to create financial record",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getHealthBadge = (project: ProjectSummary) => {
    if (project.status === "COMPLETED") {
      return <Badge className="bg-blue-500 hover:bg-blue-600">Complete</Badge>;
    }
    if (project.total_actual_usd > project.total_budget_usd * 1.1) {
      return <Badge variant="destructive">Over Budget</Badge>;
    }
    if (project.total_actual_usd > project.total_budget_usd * 0.85) {
      return (
        <Badge className="bg-orange-500 hover:bg-orange-600">At Risk</Badge>
      );
    }
    return <Badge className="bg-green-500 hover:bg-green-600">On Track</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader description="Loading Financial Dashboard..." />
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  const chartData = [
    {
      name: "On Track",
      value: dashboard.projects_by_health.on_track || 0,
      fill: "hsl(142, 71%, 45%)",
    },
    {
      name: "At Risk",
      value: dashboard.projects_by_health.at_risk || 0,
      fill: "hsl(25, 95%, 53%)",
    },
    {
      name: "Over Budget",
      value: dashboard.projects_by_health.over_budget || 0,
      fill: "hsl(0, 84%, 60%)",
    },
    {
      name: "Complete",
      value: dashboard.projects_by_health.complete || 0,
      fill: "hsl(221, 83%, 53%)",
    },
  ];

  const chartConfig = {
    value: {
      label: "Projects",
    },
  };

  const budgetUtilization =
    dashboard.total_budget > 0
      ? (dashboard.total_actual / dashboard.total_budget) * 100
      : 0;

  const totalROI =
    dashboard.total_actual > 0
      ? ((dashboard.total_revenue - dashboard.total_actual) /
          dashboard.total_actual) *
        100
      : 0;

  return (
    <div className="p-8 min-h-screen bg-background">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <DollarSign className="h-10 w-10 text-primary" />
          <h1 className="text-4xl font-bold">Financial Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadFinancials} variant="outline" size="lg">
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          {canWrite && (
            <Button onClick={handleOpenAddFinancials} size="lg">
              <Plus className="mr-2 h-4 w-4" /> Add Financials
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(dashboard.total_budget)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Allocated across all projects
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(dashboard.total_actual)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant={budgetUtilization > 90 ? "destructive" : "secondary"}
              >
                {budgetUtilization.toFixed(1)}%
              </Badge>
              <p className="text-xs text-muted-foreground">of budget</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">
              {formatCurrency(dashboard.total_revenue)}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge className="bg-green-500 hover:bg-green-600">
                ROI: {totalROI.toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Remaining Budget
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCurrency(dashboard.total_budget - dashboard.total_actual)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboard.total_budget > 0
                ? `${(((dashboard.total_budget - dashboard.total_actual) / dashboard.total_budget) * 100).toFixed(1)}% remaining`
                : "No budget set"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Health Status Overview */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Project Health Overview</CardTitle>
          <CardDescription>
            Distribution of projects by health status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Status Legend */}
            <div className="flex flex-col justify-center space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                <span className="text-2xl font-bold">
                  {dashboard.projects_by_health.on_track || 0}
                </span>
                <span className="text-muted-foreground">On Track</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-orange-500 rounded-full"></div>
                <span className="text-2xl font-bold">
                  {dashboard.projects_by_health.at_risk || 0}
                </span>
                <span className="text-muted-foreground">At Risk</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                <span className="text-2xl font-bold">
                  {dashboard.projects_by_health.over_budget || 0}
                </span>
                <span className="text-muted-foreground">Over Budget</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                <span className="text-2xl font-bold">
                  {dashboard.projects_by_health.complete || 0}
                </span>
                <span className="text-muted-foreground">Completed</span>
              </div>
            </div>

            {/* Chart */}
            <ChartContainer config={chartConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.split(" ")[0]}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top Projects Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Projects by Budget</CardTitle>
          <CardDescription>
            Overview of major projects and their financial performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dashboard.top_projects.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-semibold mb-2">
                No Financial Data Yet
              </h3>
              <p className="text-sm">
                Add financial tracking to your loops to see budget and spend
                analysis
              </p>
              {canWrite && (
                <Button
                  onClick={() => setShowAddFinancials(true)}
                  className="mt-4"
                >
                  <Plus className="mr-2 h-4 w-4" /> Add First Financial Record
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.top_projects.map((project) => (
                  <TableRow
                    key={project.loop_id}
                    onClick={() => setSelectedProject(project)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <div className="font-semibold">{project.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {project.loop_type}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{project.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(project.total_budget_usd)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(project.total_actual_usd)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatCurrency(project.total_revenue_usd)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <span
                        className={
                          project.variance_usd >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {project.variance_usd >= 0 ? "+" : ""}
                        {formatCurrency(project.variance_usd)}
                      </span>
                    </TableCell>
                    <TableCell>{getHealthBadge(project)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Financials Dialog */}
      <Dialog open={showAddFinancials} onOpenChange={setShowAddFinancials}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Financial Record</DialogTitle>
            <DialogDescription>
              Create a new financial record for a loop/project
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateFinancial} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Loop Selection Dropdown */}
              <div className="col-span-2">
                <Label htmlFor="loop_id">Select Loop/Project *</Label>
                <Select
                  value={formData.loop_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, loop_id: value })
                  }
                  required
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="-- Select a Loop --" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <div className="max-h-[280px] overflow-y-auto">
                      {loopsLoading && loops.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
                          Loading loops...
                        </div>
                      ) : loops.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          No loops available
                        </div>
                      ) : (
                        <>
                          {loops.map((loop: any) => (
                            <SelectItem key={loop.loop_id} value={loop.loop_id}>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {loop.title}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {loop.category}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Load More Button - Outside scrollable area, sticky at bottom */}
                    {hasMore && loops.length > 0 && (
                      <div className="px-2 py-2 border-t bg-background">
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-sm font-medium text-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleLoadMore();
                          }}
                          disabled={loopsLoading || isLoadingMore}
                        >
                          {loopsLoading || isLoadingMore ? (
                            <span className="flex items-center justify-center gap-2">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Loading...
                            </span>
                          ) : (
                            `Load More (${loops.length} of ${totalCount})`
                          )}
                        </button>
                      </div>
                    )}

                    {/* Show count when all loaded */}
                    {/* {!hasMore && loops.length > 0 && (
                      <div className="px-2 py-2 text-center border-t text-xs text-muted-foreground bg-background">
                        All {loops.length} loops loaded
                      </div>
                    )} */}
                  </SelectContent>
                </Select>

                <p className="text-xs text-muted-foreground mt-1">
                  Select the loop/project to add financial tracking
                </p>
              </div>
              {/* Budget Field */}
              <div>
                <Label htmlFor="budget_usd">Budget (USD)</Label>
                <Input
                  id="budget_usd"
                  type="number"
                  step="0.01"
                  value={formData.budget_usd}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      budget_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  placeholder="0.00"
                />
              </div>

              {/* Actual Spend Field */}
              <div>
                <Label htmlFor="actual_spend_usd">Actual Spend (USD)</Label>
                <Input
                  id="actual_spend_usd"
                  type="number"
                  step="0.01"
                  value={formData.actual_spend_usd}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      actual_spend_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  placeholder="0.00"
                />
              </div>

              {/* Revenue Field */}
              <div>
                <Label htmlFor="revenue_generated_usd">
                  Revenue Generated (USD)
                </Label>
                <Input
                  id="revenue_generated_usd"
                  type="number"
                  step="0.01"
                  value={formData.revenue_generated_usd}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      revenue_generated_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  placeholder="0.00"
                />
              </div>

              {/* Fiscal Period Field */}
              <div>
                <Label htmlFor="fiscal_period">Fiscal Period</Label>
                <Input
                  id="fiscal_period"
                  value={formData.fiscal_period}
                  onChange={(e) =>
                    setFormData({ ...formData, fiscal_period: e.target.value })
                  }
                  placeholder="e.g., 2025-Q1"
                />
              </div>

              {/* Cost Center Field */}
              <div className="col-span-2">
                <Label htmlFor="cost_center">Cost Center</Label>
                <Input
                  id="cost_center"
                  value={formData.cost_center}
                  onChange={(e) =>
                    setFormData({ ...formData, cost_center: e.target.value })
                  }
                  placeholder="e.g., Engineering, Marketing"
                />
              </div>

              {/* Notes Field */}
              <div className="col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Add any additional notes..."
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddFinancials(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create Financial Record"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project Detail Modal */}
      <Dialog
        open={!!selectedProject}
        onOpenChange={() => setSelectedProject(null)}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {selectedProject?.title}
            </DialogTitle>
          </DialogHeader>

          {selectedProject && (
            <div className="space-y-6 mt-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{selectedProject.loop_type}</Badge>
                <Badge>{selectedProject.category}</Badge>
                {getHealthBadge(selectedProject)}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardDescription>Budget</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(selectedProject.total_budget_usd)}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardDescription>Actual Spend</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {formatCurrency(selectedProject.total_actual_usd)}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardDescription>Revenue</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(selectedProject.total_revenue_usd)}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardDescription>ROI</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold ${(selectedProject.roi_percent || 0) > 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {selectedProject.roi_percent
                        ? `${selectedProject.roi_percent.toFixed(1)}%`
                        : "N/A"}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Button
                onClick={() => setSelectedProject(null)}
                className="w-full"
                variant="secondary"
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
