import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Calculator, 
  TrendingUp, 
  PieChart, 
  Lightbulb,
  DollarSign,
  Users,
  BarChart3,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function DataTools() {
  const [activeTab, setActiveTab] = useState('financial');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Financial Calculator State
  const [financialMetric, setFinancialMetric] = useState('roi');
  const [financialData, setFinancialData] = useState<Record<string, string>>({
    revenue: '',
    cost: '',
    expenses: '',
    cash_balance: '',
    monthly_burn: '',
    avg_revenue_per_customer: '',
    avg_customer_lifetime_months: '',
    cac: '',
    current_arr: '',
    previous_arr: ''
  });

  // Team Metrics State
  const [teamMetric, setTeamMetric] = useState('velocity');
  const [teamData, setTeamData] = useState({
    team_size: '',
    sprint_days: '',
    available_hours: '',
    worked_hours: ''
  });

  const callDataTool = async (toolName: string, input: any) => {
    setLoading(true);
    try {
      // TODO: wire to backend when available
      toast.error('Backend not connected — run calculations locally');
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const calculateFinancial = async () => {
    const data: Record<string, number> = {};
    Object.entries(financialData).forEach(([key, value]) => {
      if (value) data[key] = parseFloat(value);
    });

    await callDataTool('calculate_financials', {
      metric_type: financialMetric,
      data
    });
  };

  const calculateTeam = async () => {
    const data: Record<string, number> = {};
    Object.entries(teamData).forEach(([key, value]) => {
      if (value) data[key] = parseFloat(value);
    });

    await callDataTool('calculate_team_metrics', {
      metric_type: teamMetric,
      ...data
    });
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      healthy: 'bg-green-500',
      optimal: 'bg-green-500',
      caution: 'bg-yellow-500',
      critical: 'bg-red-500',
      overutilized: 'bg-red-500',
      underutilized: 'bg-yellow-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-blue-600" />
            <CardTitle>Data Tools & Calculators</CardTitle>
          </div>
          <CardDescription>
            Financial calculators, team metrics, data segmentation, and quick insights
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

            {/* Financial Calculator */}
            <TabsContent value="financial" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Metric Type</Label>
                <Select value={financialMetric} onValueChange={setFinancialMetric}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="roi">ROI (Return on Investment)</SelectItem>
                    <SelectItem value="burn_rate">Burn Rate & Runway</SelectItem>
                    <SelectItem value="runway">Runway Calculator</SelectItem>
                    <SelectItem value="ltv_cac">LTV/CAC Ratio</SelectItem>
                    <SelectItem value="arr_growth">ARR Growth</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {financialMetric === 'roi' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Revenue ($)</Label>
                    <Input
                      type="number"
                      value={financialData.revenue}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, revenue: e.target.value }))}
                      placeholder="100000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost ($)</Label>
                    <Input
                      type="number"
                      value={financialData.cost}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, cost: e.target.value }))}
                      placeholder="50000"
                    />
                  </div>
                </div>
              )}

              {financialMetric === 'burn_rate' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Monthly Expenses ($)</Label>
                    <Input
                      type="number"
                      value={financialData.expenses}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, expenses: e.target.value }))}
                      placeholder="150000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Revenue ($)</Label>
                    <Input
                      type="number"
                      value={financialData.revenue}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, revenue: e.target.value }))}
                      placeholder="80000"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Cash Balance ($)</Label>
                    <Input
                      type="number"
                      value={financialData.cash_balance}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, cash_balance: e.target.value }))}
                      placeholder="500000"
                    />
                  </div>
                </div>
              )}

              {financialMetric === 'runway' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cash Balance ($)</Label>
                    <Input
                      type="number"
                      value={financialData.cash_balance}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, cash_balance: e.target.value }))}
                      placeholder="500000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Monthly Burn ($)</Label>
                    <Input
                      type="number"
                      value={financialData.monthly_burn}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, monthly_burn: e.target.value }))}
                      placeholder="70000"
                    />
                  </div>
                </div>
              )}

              {financialMetric === 'ltv_cac' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Avg Revenue per Customer ($)</Label>
                    <Input
                      type="number"
                      value={financialData.avg_revenue_per_customer}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, avg_revenue_per_customer: e.target.value }))}
                      placeholder="1000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Avg Customer Lifetime (months)</Label>
                    <Input
                      type="number"
                      value={financialData.avg_customer_lifetime_months}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, avg_customer_lifetime_months: e.target.value }))}
                      placeholder="24"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Customer Acquisition Cost ($)</Label>
                    <Input
                      type="number"
                      value={financialData.cac}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, cac: e.target.value }))}
                      placeholder="5000"
                    />
                  </div>
                </div>
              )}

              {financialMetric === 'arr_growth' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Current ARR ($)</Label>
                    <Input
                      type="number"
                      value={financialData.current_arr}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, current_arr: e.target.value }))}
                      placeholder="1200000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Previous ARR ($)</Label>
                    <Input
                      type="number"
                      value={financialData.previous_arr}
                      onChange={(e) => setFinancialData(prev => ({ ...prev, previous_arr: e.target.value }))}
                      placeholder="800000"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={calculateFinancial}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <Calculator className="w-4 h-4 mr-2" />
                {loading ? 'Calculating...' : 'Calculate'}
              </Button>
            </TabsContent>

            {/* Team Metrics */}
            <TabsContent value="team" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Metric Type</Label>
                <Select value={teamMetric} onValueChange={setTeamMetric}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="velocity">Team Velocity</SelectItem>
                    <SelectItem value="capacity">Sprint Capacity</SelectItem>
                    <SelectItem value="utilization">Team Utilization</SelectItem>
                    <SelectItem value="throughput">Throughput</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {teamMetric === 'capacity' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Team Size</Label>
                    <Input
                      type="number"
                      value={teamData.team_size}
                      onChange={(e) => setTeamData(prev => ({ ...prev, team_size: e.target.value }))}
                      placeholder="5"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Sprint Days</Label>
                    <Input
                      type="number"
                      value={teamData.sprint_days}
                      onChange={(e) => setTeamData(prev => ({ ...prev, sprint_days: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                </div>
              )}

              {teamMetric === 'utilization' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Available Hours</Label>
                    <Input
                      type="number"
                      value={teamData.available_hours}
                      onChange={(e) => setTeamData(prev => ({ ...prev, available_hours: e.target.value }))}
                      placeholder="400"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Worked Hours</Label>
                    <Input
                      type="number"
                      value={teamData.worked_hours}
                      onChange={(e) => setTeamData(prev => ({ ...prev, worked_hours: e.target.value }))}
                      placeholder="320"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={calculateTeam}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                {loading ? 'Calculating...' : 'Calculate'}
              </Button>
            </TabsContent>

            {/* Data Segmentation */}
            <TabsContent value="segment" className="space-y-4 mt-4">
              <div className="text-center py-8 text-muted-foreground">
                <PieChart className="w-16 h-16 mx-auto mb-3 opacity-50" />
                <p>Data segmentation coming soon</p>
                <p className="text-sm mt-2">Segment loops by category, status, owner, etc.</p>
              </div>
            </TabsContent>

            {/* Insights */}
            <TabsContent value="insights" className="space-y-4 mt-4">
              <div className="text-center py-8 text-muted-foreground">
                <Lightbulb className="w-16 h-16 mx-auto mb-3 opacity-50" />
                <p>Quick insights coming soon</p>
                <p className="text-sm mt-2">Trends, anomalies, and data summaries</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Results Display */}
      {result && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Financial Results */}
              {result.roi_percentage && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">ROI</div>
                    <div className="text-3xl font-bold text-blue-600">{result.roi_percentage}%</div>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Gain</div>
                    <div className="text-3xl font-bold text-green-600">${result.gain}</div>
                  </div>
                  <div className="col-span-2 p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm font-semibold mb-2">{result.interpretation}</div>
                    <div className="text-sm text-muted-foreground">{result.recommendation}</div>
                  </div>
                </div>
              )}

              {result.runway_months && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Runway</div>
                      <div className="text-3xl font-bold text-blue-600">{result.runway_months} mo</div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Weeks</div>
                      <div className="text-3xl font-bold text-purple-600">{result.runway_weeks}</div>
                    </div>
                    <div className="p-4 bg-orange-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Status</div>
                      <Badge className={`${getStatusColor(result.status)} text-white mt-2`}>
                        {result.status}
                      </Badge>
                    </div>
                  </div>
                  {result.zero_date && (
                    <div className="p-4 bg-red-50 rounded-lg border-l-4 border-red-500">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-600" />
                        <div>
                          <div className="font-semibold">Zero Cash Date</div>
                          <div className="text-sm text-muted-foreground">{result.zero_date}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {result.monthly_burn && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-red-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Monthly Burn</div>
                    <div className="text-3xl font-bold text-red-600">${result.monthly_burn}</div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Runway</div>
                    <div className="text-3xl font-bold text-blue-600">{result.runway_months} mo</div>
                  </div>
                  <div className="col-span-2 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-500">
                    <div className="font-semibold mb-1">{result.alert}</div>
                    <div className="text-sm text-muted-foreground">{result.recommendation}</div>
                  </div>
                </div>
              )}

              {result.ltv_cac_ratio && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">LTV</div>
                    <div className="text-2xl font-bold text-green-600">${result.ltv}</div>
                  </div>
                  <div className="p-4 bg-red-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">CAC</div>
                    <div className="text-2xl font-bold text-red-600">${result.cac}</div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Ratio</div>
                    <div className="text-2xl font-bold text-blue-600">{result.ltv_cac_ratio}:1</div>
                  </div>
                  <div className="col-span-3 p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm font-semibold mb-2">{result.interpretation}</div>
                    <div className="text-sm text-muted-foreground">{result.recommendation}</div>
                  </div>
                </div>
              )}

              {result.arr_growth_percentage && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">ARR Growth</div>
                    <div className="text-3xl font-bold text-green-600">{result.arr_growth_percentage}%</div>
                  </div>
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Monthly Rate</div>
                    <div className="text-3xl font-bold text-blue-600">{result.monthly_growth_rate}%</div>
                  </div>
                  <div className="col-span-2">
                    <Badge className="bg-purple-500 text-white">{result.status}</Badge>
                  </div>
                </div>
              )}

              {/* Team Metrics Results */}
              {result.total_capacity_hours && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Total Capacity</div>
                    <div className="text-3xl font-bold text-blue-600">{result.total_capacity_hours}h</div>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">Story Points</div>
                    <div className="text-3xl font-bold text-green-600">{result.estimated_story_points}</div>
                  </div>
                  <div className="col-span-2 p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm text-muted-foreground">{result.recommendation}</div>
                  </div>
                </div>
              )}

              {result.utilization_percentage && (
                <div className="space-y-4">
                  <div className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg">
                    <div className="text-sm text-muted-foreground mb-2">Team Utilization</div>
                    <div className="text-5xl font-bold text-blue-600">{result.utilization_percentage}%</div>
                    <Badge className={`${getStatusColor(result.status)} text-white mt-3`}>
                      {result.status}
                    </Badge>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm font-semibold mb-2">Recommendation</div>
                    <div className="text-sm text-muted-foreground">{result.recommendation}</div>
                  </div>
                </div>
              )}

              {/* Raw JSON for debugging */}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">View Raw Data</summary>
                <pre className="mt-2 p-4 bg-slate-50 rounded-lg text-xs overflow-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
