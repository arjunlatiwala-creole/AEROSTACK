// import DataTools from "@/components/aerostack/DataTools";

// export default function DashboardCalcs() {
//   return <DataTools />;
// }
import React, { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Calculator,
  DollarSign,
  Users,
  PieChart,
  Lightbulb,
  BookOpen,
  Target,
  CheckCircle2,
  LineChart,
  TrendingUp,
} from "lucide-react";
import toast from "react-hot-toast";

interface MetricInput {
  key: string;
  label: string;
  placeholder: string;
  type: "number";
}

interface MetricDef {
  id: string;
  name: string;
  category: "financial" | "team" | "segment" | "insights";
  inputs: MetricInput[];
  formula: string;
  meaning: string;
  unit: string;
  prefix?: string;
  calculate: (inputs: Record<string, number>) => number;
}

const CATEGORIES = [
  { id: "financial", name: "Financial", icon: LineChart },
  { id: "team", name: "Team", icon: Users },
  { id: "segment", name: "Segment", icon: PieChart },
  { id: "insights", name: "Insights", icon: TrendingUp },
] as const;

const METRICS: MetricDef[] = [
  // --- FINANCIAL ---
  {
    id: "roi",
    name: "ROI (Return on Investment)",
    category: "financial",
    inputs: [
      {
        key: "revenue",
        label: "Revenue ($)",
        placeholder: "100000",
        type: "number",
      },
      { key: "cost", label: "Cost ($)", placeholder: "50000", type: "number" },
    ],
    formula: "ROI = (Revenue - Cost) / Cost × 100",
    meaning: "Shows how much return you generated from your investment.",
    unit: "%",
    calculate: (i) => ((i.revenue - i.cost) / i.cost) * 100,
  },
  {
    id: "burnRate",
    name: "Burn Rate",
    category: "financial",
    inputs: [
      {
        key: "expenses",
        label: "Monthly Expenses ($)",
        placeholder: "150000",
        type: "number",
      },
      {
        key: "revenue",
        label: "Monthly Revenue ($)",
        placeholder: "80000",
        type: "number",
      },
    ],
    formula: "Burn = Expenses - Revenue",
    meaning: "Net monthly cash outflow.",
    unit: "",
    prefix: "$",
    calculate: (i) => i.expenses - i.revenue,
  },
  {
    id: "runway",
    name: "Runway",
    category: "financial",
    inputs: [
      {
        key: "cash",
        label: "Cash Balance ($)",
        placeholder: "500000",
        type: "number",
      },
      {
        key: "burn",
        label: "Monthly Burn ($)",
        placeholder: "70000",
        type: "number",
      },
    ],
    formula: "Runway = Cash / Monthly Burn",
    meaning: "How many months company can survive.",
    unit: " months",
    calculate: (i) => i.cash / i.burn,
  },
  {
    id: "ltvCacRatio",
    name: "LTV / CAC Ratio",
    category: "financial",
    inputs: [
      {
        key: "arpu",
        label: "Avg Revenue per Customer ($)",
        placeholder: "1000",
        type: "number",
      },
      {
        key: "lifetime",
        label: "Customer Lifetime (months)",
        placeholder: "24",
        type: "number",
      },
      {
        key: "cac",
        label: "Customer Acquisition Cost ($)",
        placeholder: "5000",
        type: "number",
      },
    ],
    formula: "LTV = ARPU × Lifetime, Ratio = LTV / CAC",
    meaning: "Measures customer profitability.",
    unit: ":1",
    calculate: (i) => (i.arpu * i.lifetime) / i.cac,
  },
  {
    id: "arrGrowth",
    name: "ARR Growth",
    category: "financial",
    inputs: [
      {
        key: "currentArr",
        label: "Current ARR ($)",
        placeholder: "1200000",
        type: "number",
      },
      {
        key: "previousArr",
        label: "Previous ARR ($)",
        placeholder: "800000",
        type: "number",
      },
    ],
    formula: "ARR Growth % = (Current - Previous) / Previous × 100",
    meaning: "Annual recurring revenue growth rate.",
    unit: "%",
    calculate: (i) => ((i.currentArr - i.previousArr) / i.previousArr) * 100,
  },
  {
    id: "profit",
    name: "Profit",
    category: "financial",
    inputs: [
      {
        key: "revenue",
        label: "Revenue ($)",
        placeholder: "100000",
        type: "number",
      },
      { key: "cost", label: "Cost ($)", placeholder: "50000", type: "number" },
    ],
    formula: "Profit = Revenue - Cost",
    meaning: "Actual earning after removing cost.",
    unit: "",
    prefix: "$",
    calculate: (i) => i.revenue - i.cost,
  },
  {
    id: "profitMargin",
    name: "Profit Margin",
    category: "financial",
    inputs: [
      {
        key: "revenue",
        label: "Revenue ($)",
        placeholder: "100000",
        type: "number",
      },
      { key: "cost", label: "Cost ($)", placeholder: "50000", type: "number" },
    ],
    formula: "Profit Margin = (Revenue - Cost) / Revenue × 100",
    meaning: "Percentage of revenue that is profit.",
    unit: "%",
    calculate: (i) => ((i.revenue - i.cost) / i.revenue) * 100,
  },
  {
    id: "growthRate",
    name: "Revenue Growth Rate",
    category: "financial",
    inputs: [
      {
        key: "current",
        label: "Current Revenue ($)",
        placeholder: "120000",
        type: "number",
      },
      {
        key: "previous",
        label: "Previous Revenue ($)",
        placeholder: "100000",
        type: "number",
      },
    ],
    formula: "Growth % = (Current - Previous) / Previous × 100",
    meaning: "Shows business growth trend.",
    unit: "%",
    calculate: (i) => ((i.current - i.previous) / i.previous) * 100,
  },
  {
    id: "breakEven",
    name: "Break-Even Point",
    category: "financial",
    inputs: [
      {
        key: "fixedCost",
        label: "Fixed Cost ($)",
        placeholder: "20000",
        type: "number",
      },
      {
        key: "price",
        label: "Selling Price per Unit ($)",
        placeholder: "100",
        type: "number",
      },
      {
        key: "variableCost",
        label: "Variable Cost per Unit ($)",
        placeholder: "40",
        type: "number",
      },
    ],
    formula: "Units = Fixed Cost / (Price - Var Cost)",
    meaning: "Minimum units needed to avoid loss.",
    unit: " Units",
    calculate: (i) => i.fixedCost / (i.price - i.variableCost),
  },
  {
    id: "cac",
    name: "Customer Acquisition Cost (CAC)",
    category: "financial",
    inputs: [
      {
        key: "salesCost",
        label: "Sales Cost ($)",
        placeholder: "5000",
        type: "number",
      },
      {
        key: "marketingCost",
        label: "Marketing Cost ($)",
        placeholder: "5000",
        type: "number",
      },
      {
        key: "customers",
        label: "Customers Acquired",
        placeholder: "100",
        type: "number",
      },
    ],
    formula: "CAC = (Sales + Marketing Cost) / Customers",
    meaning: "Cost to acquire one customer.",
    unit: "",
    prefix: "$",
    calculate: (i) => (i.salesCost + i.marketingCost) / i.customers,
  },
  // --- TEAM ---
  {
    id: "velocity",
    name: "Team Velocity",
    category: "team",
    inputs: [
      {
        key: "points",
        label: "Story Points Completed",
        placeholder: "45",
        type: "number",
      },
    ],
    formula: "Velocity = Total Story Points",
    meaning: "How much work team can handle per sprint.",
    unit: " pts",
    calculate: (i) => i.points,
  },
  {
    id: "throughput",
    name: "Throughput",
    category: "team",
    inputs: [
      {
        key: "tasks",
        label: "Tasks Completed",
        placeholder: "25",
        type: "number",
      },
    ],
    formula: "Throughput = Total Tasks Completed",
    meaning: "Number of tasks completed per sprint.",
    unit: " tasks",
    calculate: (i) => i.tasks,
  },
  {
    id: "utilization",
    name: "Utilization Rate",
    category: "team",
    inputs: [
      {
        key: "billable",
        label: "Worked Hours",
        placeholder: "32",
        type: "number",
      },
      {
        key: "total",
        label: "Available Hours",
        placeholder: "40",
        type: "number",
      },
    ],
    formula: "Utilization = Billable / Total × 100",
    meaning: "How effectively time is used.",
    unit: "%",
    calculate: (i) => (i.billable / i.total) * 100,
  },
  {
    id: "sprintCapacity",
    name: "Sprint Capacity",
    category: "team",
    inputs: [
      {
        key: "members",
        label: "Team Members",
        placeholder: "5",
        type: "number",
      },
      { key: "days", label: "Working Days", placeholder: "10", type: "number" },
      {
        key: "hours",
        label: "Hours per Day",
        placeholder: "8",
        type: "number",
      },
      {
        key: "availability",
        label: "Availability (%)",
        placeholder: "80",
        type: "number",
      },
    ],
    formula: "Capacity = Members × Days × Hours × Availability%",
    meaning: "Total workable hours available for the sprint.",
    unit: " hrs",
    calculate: (i) => i.members * i.days * i.hours * (i.availability / 100),
  },
  {
    id: "deliveryRate",
    name: "Delivery Rate",
    category: "team",
    inputs: [
      {
        key: "completed",
        label: "Completed Tasks",
        placeholder: "18",
        type: "number",
      },
      {
        key: "assigned",
        label: "Assigned Tasks",
        placeholder: "20",
        type: "number",
      },
    ],
    formula: "Delivery Rate = Completed / Assigned × 100",
    meaning: "Task completion performance.",
    unit: "%",
    calculate: (i) => (i.completed / i.assigned) * 100,
  },
  {
    id: "productivity",
    name: "Productivity Rate",
    category: "team",
    inputs: [
      {
        key: "output",
        label: "Total Output (Tasks)",
        placeholder: "20",
        type: "number",
      },
      {
        key: "time",
        label: "Time Period (Days)",
        placeholder: "5",
        type: "number",
      },
    ],
    formula: "Productivity = Output / Time",
    meaning: "Avg tasks completed per unit of time.",
    unit: " per day",
    calculate: (i) => i.output / i.time,
  },

  {
    id: "efficiency",
    name: "Efficiency Ratio",
    category: "team",
    inputs: [
      {
        key: "estimated",
        label: "Estimated Time",
        placeholder: "10",
        type: "number",
      },
      { key: "actual", label: "Actual Time", placeholder: "8", type: "number" },
    ],
    formula: "Efficiency = Estimated / Actual × 100",
    meaning: "If >100% → faster; If <100% → delayed.",
    unit: "%",
    calculate: (i) => (i.estimated / i.actual) * 100,
  },
  // --- SEGMENT ---
  {
    id: "revenueSegment",
    name: "Revenue by Segment",
    category: "segment",
    inputs: [
      {
        key: "segmentRevenue",
        label: "Segment Revenue ($)",
        placeholder: "30000",
        type: "number",
      },
      {
        key: "totalRevenue",
        label: "Total Revenue ($)",
        placeholder: "100000",
        type: "number",
      },
    ],
    formula: "Segment % = Segment Revenue / Total Revenue × 100",
    meaning: "Contribution of specific segment to total.",
    unit: "%",
    calculate: (i) => (i.segmentRevenue / i.totalRevenue) * 100,
  },
  {
    id: "conversionSegment",
    name: "Conversion Rate by Segment",
    category: "segment",
    inputs: [
      { key: "won", label: "Won Deals", placeholder: "5", type: "number" },
      { key: "leads", label: "Total Leads", placeholder: "50", type: "number" },
    ],
    formula: "Conversion = Won / Leads × 100",
    meaning: "Sales conversion performance for segment.",
    unit: "%",
    calculate: (i) => (i.won / i.leads) * 100,
  },
  {
    id: "avgDealSize",
    name: "Average Deal Size",
    category: "segment",
    inputs: [
      {
        key: "totalRevenue",
        label: "Total Revenue ($)",
        placeholder: "50000",
        type: "number",
      },
      {
        key: "deals",
        label: "Number of Deals",
        placeholder: "10",
        type: "number",
      },
    ],
    formula: "Avg Deal Size = Total Revenue / Num of Deals",
    meaning: "Average value per closed deal.",
    unit: "",
    prefix: "$",
    calculate: (i) => i.totalRevenue / i.deals,
  },
  {
    id: "churnRate",
    name: "Churn Rate",
    category: "segment",
    inputs: [
      {
        key: "lost",
        label: "Customers Lost",
        placeholder: "2",
        type: "number",
      },
      {
        key: "total",
        label: "Total Customers",
        placeholder: "100",
        type: "number",
      },
    ],
    formula: "Churn = Lost / Total × 100",
    meaning: "Rate at which customers leave.",
    unit: "%",
    calculate: (i) => (i.lost / i.total) * 100,
  },
  // --- INSIGHTS ---
  {
    id: "forecast",
    name: "Forecasted Revenue",
    category: "insights",
    inputs: [
      {
        key: "value",
        label: "Deal Value ($)",
        placeholder: "100000",
        type: "number",
      },
      {
        key: "prob",
        label: "Win Probability (%)",
        placeholder: "60",
        type: "number",
      },
    ],
    formula: "Forecast = Deal Value × Probability",
    meaning: "Risk-adjusted potential revenue.",
    unit: "",
    prefix: "$",
    calculate: (i) => i.value * (i.prob / 100),
  },
  {
    id: "expectedRoi",
    name: "Expected ROI",
    category: "insights",
    inputs: [
      { key: "roi", label: "ROI (%)", placeholder: "150", type: "number" },
      {
        key: "prob",
        label: "Probability (%)",
        placeholder: "70",
        type: "number",
      },
    ],
    formula: "Expected ROI = ROI × Probability",
    meaning: "Probability-weighted return estimate.",
    unit: "%",
    calculate: (i) => i.roi * (i.prob / 100),
  },
  {
    id: "riskScore",
    name: "Risk Score",
    category: "insights",
    inputs: [
      {
        key: "prob",
        label: "Low Probability Factor (0–100)",
        placeholder: "60",
        type: "number",
      },
      {
        key: "cost",
        label: "High Cost Factor (0–100)",
        placeholder: "70",
        type: "number",
      },
      {
        key: "cycle",
        label: "Sales Cycle Length (0–100)",
        placeholder: "40",
        type: "number",
      },
    ],
    formula: "Risk = (Low Prob × 0.5) + (High Cost × 0.3) + (Long Cycle × 0.2)",
    meaning: "Weighted model to assess project/deal risk.",
    unit: " pts",
    calculate: (i) => i.prob * 0.5 + i.cost * 0.3 + i.cycle * 0.2,
  },
  {
    id: "perfCompare",
    name: "Performance Comparison",
    category: "insights",
    inputs: [
      {
        key: "current",
        label: "Current Period Data",
        placeholder: "500",
        type: "number",
      },
      {
        key: "previous",
        label: "Previous Period Data",
        placeholder: "400",
        type: "number",
      },
    ],
    formula: "Change % = (Current - Previous) / Previous × 100",
    meaning: "Shows performance trend across periods.",
    unit: "%",
    calculate: (i) => ((i.current - i.previous) / i.previous) * 100,
  },
];
export default function DashboardCalcs() {
  const [activeTab, setActiveTab] = useState("financial");
  const [selectedMetricId, setSelectedMetricId] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    value: number;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const categoryMetrics = useMemo(
    () => METRICS.filter((m) => m.category === activeTab),
    [activeTab],
  );

  const selectedMetric = useMemo(
    () => METRICS.find((m) => m.id === selectedMetricId),
    [selectedMetricId],
  );

  useEffect(() => {
    if (categoryMetrics.length > 0) {
      setSelectedMetricId(categoryMetrics[0].id);
    }
  }, [categoryMetrics]);

  useEffect(() => {
    if (selectedMetric) {
      const emptyInputs: Record<string, string> = {};
      selectedMetric.inputs.forEach((input) => {
        emptyInputs[input.key] = "";
      });
      setInputValues(emptyInputs);
      setResult(null);
    }
  }, [selectedMetric]);

  const handleCalculate = () => {
    if (!selectedMetric) return;

    const numericInputs: Record<string, number> = {};
    for (const input of selectedMetric.inputs) {
      const val = parseFloat(inputValues[input.key]);
      if (isNaN(val)) {
        toast.error(`Enter valid number for ${input.label}`);
        return;
      }
      numericInputs[input.key] = val;
    }

    setLoading(true);
    setTimeout(() => {
      try {
        const value = selectedMetric.calculate(numericInputs);

        if (!isFinite(value)) {
          throw new Error("Invalid calculation (division by zero?)");
        }

        setResult({ value, message: selectedMetric.meaning });
        toast.success("Calculation complete!");
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#f59e0b]" />
            <CardTitle>Data Tools &amp; Calculators</CardTitle>
          </div>
          <CardDescription>
            Financial calculators, team metrics, data segmentation, and quick
            insights
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="financial" className="gap-2">
                <DollarSign className="w-4 h-4" />
                Financial
              </TabsTrigger>
              <TabsTrigger value="team" className="gap-2">
                <Users className="w-4 h-4" />
                Team
              </TabsTrigger>
              <TabsTrigger value="segment" className="gap-2">
                <PieChart className="w-4 h-4" />
                Segment
              </TabsTrigger>
              <TabsTrigger value="insights" className="gap-2">
                <Lightbulb className="w-4 h-4" />
                Insights
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="space-y-6 mt-6">
              {/* Metric Selector */}
              <div className="space-y-2">
                <Label>Metric Type</Label>
                <Select
                  value={selectedMetricId}
                  onValueChange={setSelectedMetricId}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryMetrics.map((metric) => (
                      <SelectItem key={metric.id} value={metric.id}>
                        {metric.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic Inputs */}
              {selectedMetric && (
                <div
                  className={`grid gap-4 ${
                    selectedMetric.inputs.length === 1
                      ? "grid-cols-1"
                      : selectedMetric.inputs.length === 3
                        ? "grid-cols-3"
                        : "grid-cols-2"
                  }`}
                >
                  {selectedMetric.inputs.map((input) => (
                    <div key={input.key} className="space-y-2">
                      <Label>{input.label}</Label>
                      <Input
                        type="number"
                        value={inputValues[input.key] || ""}
                        onChange={(e) =>
                          setInputValues((prev) => ({
                            ...prev,
                            [input.key]: e.target.value,
                          }))
                        }
                        placeholder={input.placeholder}
                      />
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={handleCalculate}
                disabled={loading}
                className="w-full"
              >
                <Calculator className="w-4 h-4 mr-2" />
                {loading ? "Calculating..." : "Calculate"}
              </Button>

              {/* Formula + Meaning */}
              {selectedMetric && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                      <BookOpen className="w-4 h-4" />
                      Formula
                    </div>
                    <div className="font-mono text-sm">
                      {selectedMetric.formula}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                      <Target className="w-4 h-4" />
                      Business Meaning
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedMetric.meaning}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Result Card */}
      {result && selectedMetric && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center w-full">
              {" "}
              {/* Added w-full */}
              <div className="flex items-center gap-2">
                {" "}
                {/* Grouped icon and text */}
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span>Result</span>
              </div>
              <button
                onClick={() => {
                  setResult(null);
                  if (selectedMetric) {
                    setInputValues(
                      selectedMetric.inputs.reduce(
                        (acc, input) => ({ ...acc, [input.key]: "" }),
                        {},
                      ),
                    );
                  }
                }}
                // Added ml-auto to push it to the right
                className="ml-auto text-[10px] text-slate-400 hover:text-slate-600 font-semibold border border-slate-200 rounded px-2 py-1"
              >
                Reset
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <div className="text-4xl font-bold text-[#f59e0b]">
                {selectedMetric.prefix}
                {result.value.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
                {selectedMetric.unit}
              </div>

              <Badge variant="secondary">{result.message}</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
