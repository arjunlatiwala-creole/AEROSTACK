import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Target,
  TrendingUp,
  DollarSign,
  Calendar,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Calculator,
  Users,
  Clock,
  Copy,
  PlusCircle,
  Loader2,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/api/client';

// --- Deal Scoring ---
interface DealScore {
  deal_name: string;
  amount: string;
  stage: string;
  days_in_stage: string;
  has_champion: boolean;
  has_budget: boolean;
  has_timeline: boolean;
  has_decision_maker: boolean;
  competitor_count: string;
  engagement_level: string;
}

// --- Win Rate Calculator ---
interface WinRateData {
  total_opps: string;
  closed_won: string;
  closed_lost: string;
  avg_deal_size: string;
  avg_sales_cycle_days: string;
}

// --- Pipeline Coverage ---
interface PipelineCoverage {
  quota: string;
  pipeline_value: string;
  weighted_pipeline: string;
  avg_win_rate: string;
  days_remaining_in_quarter: string;
}

// --- HubSpot Pipeline types ---
interface PipelineStage {
  id: string;
  label: string;
  display_order: number;
}

interface HubSpotPipeline {
  id: string;
  label: string;
  stages: PipelineStage[];
}

// --- Opp Entry (Aerostack Control Sheet → HubSpot via ACE fields) ---
type OppLifecycle = 'Lead' | 'Developing' | 'Ready for Signature' | 'Funding-Ready' | 'Closed';
type OppClass = 'RevGen' | 'Strategic' | 'Internal';

interface OppEntry {
  lifecycle: OppLifecycle;
  opp_class: OppClass;
  enterprise_owner: string;
  customer_owner: string;
  customer: string;
  opportunity_name: string;
  est_revenue: string;
  target_close: string;
  verbal_contours_confirmed: 'Y' | 'N' | '';
  funding_needed: 'Y' | 'N' | '';
  funding_status: '' | 'None' | 'Approved' | 'Pending' | 'Denied';
  next_step: string;
  next_step_owner: string;
  next_step_date: string;
  notes: string;
  pipeline_id: string;
  dealstage_id: string;
}

const Enterprise_OWNERS = ['Will', 'Brian', 'Max', 'Prathik', 'Paige', 'Anvi', 'Luis'] as const;

const initialOppEntry: OppEntry = {
  lifecycle: 'Lead',
  opp_class: 'RevGen',
  enterprise_owner: '',
  customer_owner: '',
  customer: '',
  opportunity_name: '',
  est_revenue: '',
  target_close: '',
  verbal_contours_confirmed: '',
  funding_needed: '',
  funding_status: '',
  next_step: '',
  next_step_owner: '',
  next_step_date: '',
  notes: '',
  pipeline_id: '',
  dealstage_id: '',
};

const initialDealScore: DealScore = {
  deal_name: '', amount: '', stage: 'discovery', days_in_stage: '',
  has_champion: false, has_budget: false, has_timeline: false, has_decision_maker: false,
  competitor_count: '', engagement_level: 'medium',
};

export default function OppsTools() {
  const [activeTab, setActiveTab] = useState('opp-entry');

  // Opp Entry
  const [oppEntry, setOppEntry] = useState<OppEntry>({ ...initialOppEntry });
  const [oppSubmitting, setOppSubmitting] = useState(false);
  const [oppResult, setOppResult] = useState<{ dealId?: string; hubspotUrl?: string } | null>(null);

  // HubSpot Pipelines
  const [pipelines, setPipelines] = useState<HubSpotPipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(false);
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);

  const fetchPipelines = async () => {
    if (pipelinesLoaded) return;
    setPipelinesLoading(true);
    try {
      const toolsApiUrl = import.meta.env.VITE_TOOLS_API_URL;
      const res = await apiClient.post(`${toolsApiUrl}/opps`, { action: 'list_pipelines' });
      const data = res.data;
      if (data.pipelines) {
        setPipelines(data.pipelines);
        setPipelinesLoaded(true);
      } else {
        toast.error(data.error || 'Failed to load pipelines');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      toast.error(`Failed to load pipelines: ${msg}`);
    } finally {
      setPipelinesLoading(false);
    }
  };

  // Fetch pipelines when the opp-entry tab is active
  useEffect(() => {
    fetchPipelines();
  }, []);

  const selectedPipelineStages = pipelines.find(p => p.id === oppEntry.pipeline_id)?.stages ?? [];

  // Deal Scoring
  const [dealScore, setDealScore] = useState<DealScore>(initialDealScore);
  const [scoreResult, setScoreResult] = useState<any>(null);

  // Win Rate
  const [winRate, setWinRate] = useState<WinRateData>({
    total_opps: '', closed_won: '', closed_lost: '', avg_deal_size: '', avg_sales_cycle_days: '',
  });
  const [winResult, setWinResult] = useState<any>(null);

  // Pipeline Coverage
  const [pipeline, setPipeline] = useState<PipelineCoverage>({
    quota: '', pipeline_value: '', weighted_pipeline: '', avg_win_rate: '', days_remaining_in_quarter: '',
  });
  const [pipelineResult, setPipelineResult] = useState<any>(null);

  const validateOppEntry = (): string[] => {
    const errors: string[] = [];
    if (!oppEntry.enterprise_owner) errors.push('enterprise Owner is required');
    if (!oppEntry.customer) errors.push('Customer is required');
    if (!oppEntry.opportunity_name) errors.push('Opportunity Name is required');
    if (!oppEntry.next_step_date) errors.push('Next Step Date is required');
    if (!oppEntry.pipeline_id) errors.push('HubSpot Pipeline is required');
    if (oppEntry.opp_class === 'RevGen' && !oppEntry.est_revenue) errors.push('Est. Revenue required for RevGen opps');
    return errors;
  };

  const submitOppEntry = async () => {
    const errors = validateOppEntry();
    if (errors.length > 0) {
      errors.forEach(e => toast.error(e));
      return;
    }

    setOppSubmitting(true);
    setOppResult(null);

    try {
      const toolsApiUrl = import.meta.env.VITE_TOOLS_API_URL;
      const payload = {
        action: 'create_opp',
        opp: {
          ...oppEntry,
          est_revenue: oppEntry.est_revenue ? parseFloat(oppEntry.est_revenue) : 0,
          pipeline_id: oppEntry.pipeline_id || undefined,
          dealstage_id: oppEntry.dealstage_id || undefined,
        },
      };

      const res = await apiClient.post(`${toolsApiUrl}/opps`, payload);
      const data = res.data;

      if (data.deal_id) {
        setOppResult({ dealId: data.deal_id, hubspotUrl: data.hubspot_url });
        toast.success('Opp created in HubSpot');
        setOppEntry({ ...initialOppEntry });
      } else {
        toast.error(data.error || 'Failed to create opp');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      toast.error(msg);
    } finally {
      setOppSubmitting(false);
    }
  };

  const calculateDealScore = () => {
    const amount = parseFloat(dealScore.amount) || 0;
    const daysInStage = parseInt(dealScore.days_in_stage) || 0;
    const competitors = parseInt(dealScore.competitor_count) || 0;

    // BANT scoring
    let bantScore = 0;
    if (dealScore.has_budget) bantScore += 25;
    if (dealScore.has_decision_maker) bantScore += 25;
    if (dealScore.has_timeline) bantScore += 25;
    if (dealScore.has_champion) bantScore += 25;

    // Stage weight
    const stageWeights: Record<string, number> = {
      lead: 10, discovery: 20, proposal: 40, negotiation: 60, verbal_commit: 80, closed_won: 100,
    };
    const stageScore = stageWeights[dealScore.stage] || 10;

    // Engagement modifier
    const engagementMod: Record<string, number> = { low: -10, medium: 0, high: 10 };
    const engMod = engagementMod[dealScore.engagement_level] || 0;

    // Staleness penalty
    const stalePenalty = daysInStage > 30 ? Math.min((daysInStage - 30) * 0.5, 20) : 0;

    // Competition penalty
    const compPenalty = Math.min(competitors * 5, 15);

    const rawScore = (bantScore * 0.4) + (stageScore * 0.4) + engMod - stalePenalty - compPenalty;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const health = finalScore >= 70 ? 'Strong' : finalScore >= 40 ? 'At Risk' : 'Weak';
    const probability = Math.round(finalScore * 0.85);
    const weightedValue = Math.round(amount * (probability / 100));

    setScoreResult({
      score: finalScore, health, probability, weightedValue, bantScore,
      stageScore, stalePenalty: Math.round(stalePenalty), compPenalty,
      recommendations: [
        !dealScore.has_champion && 'Identify and develop a champion within the account',
        !dealScore.has_budget && 'Confirm budget allocation and approval process',
        !dealScore.has_timeline && 'Establish a clear decision timeline',
        !dealScore.has_decision_maker && 'Map the decision-making unit and get access',
        daysInStage > 30 && `Deal has been in ${dealScore.stage} for ${daysInStage} days — push for next step`,
        competitors > 2 && 'High competition — differentiate on value, not price',
      ].filter(Boolean),
    });
    toast.success('Deal scored');
  };

  const calculateWinRate = () => {
    const total = parseInt(winRate.total_opps) || 0;
    const won = parseInt(winRate.closed_won) || 0;
    const lost = parseInt(winRate.closed_lost) || 0;
    const avgSize = parseFloat(winRate.avg_deal_size) || 0;
    const avgCycle = parseInt(winRate.avg_sales_cycle_days) || 0;

    const rate = total > 0 ? Math.round((won / total) * 100) : 0;
    const lossRate = total > 0 ? Math.round((lost / total) * 100) : 0;
    const openRate = total > 0 ? Math.round(((total - won - lost) / total) * 100) : 0;
    const avgRevPerOpp = total > 0 ? Math.round((won * avgSize) / total) : 0;
    const velocity = avgCycle > 0 ? Math.round((won * avgSize * rate) / (avgCycle * 100)) : 0;

    setWinResult({
      win_rate: rate, loss_rate: lossRate, open_rate: openRate,
      avg_revenue_per_opp: avgRevPerOpp, sales_velocity: velocity,
      total_won_value: won * avgSize,
      health: rate >= 30 ? 'Healthy' : rate >= 20 ? 'Below Average' : 'Needs Attention',
    });
    toast.success('Win rate calculated');
  };

  const calculatePipeline = () => {
    const quota = parseFloat(pipeline.quota) || 0;
    const pipeVal = parseFloat(pipeline.pipeline_value) || 0;
    const weighted = parseFloat(pipeline.weighted_pipeline) || 0;
    const winRatePct = parseFloat(pipeline.avg_win_rate) || 0;
    const daysLeft = parseInt(pipeline.days_remaining_in_quarter) || 0;

    const coverage = quota > 0 ? (pipeVal / quota) : 0;
    const weightedCoverage = quota > 0 ? (weighted / quota) : 0;
    const gap = Math.max(0, quota - weighted);
    const neededOpps = winRatePct > 0 ? Math.ceil(gap / ((pipeVal / Math.max(1, parseFloat(pipeline.pipeline_value))) * (winRatePct / 100))) : 0;
    const dailyTarget = daysLeft > 0 ? Math.round(gap / daysLeft) : 0;

    const health = coverage >= 3 ? 'Strong' : coverage >= 2 ? 'Adequate' : 'At Risk';

    setPipelineResult({
      coverage_ratio: coverage.toFixed(1),
      weighted_coverage: weightedCoverage.toFixed(1),
      gap, daily_target: dailyTarget, health,
      recommendation: coverage < 2
        ? 'Pipeline coverage is below 2x — aggressively source new opportunities'
        : coverage < 3
          ? 'Coverage is adequate but thin — keep prospecting to build buffer'
          : 'Strong coverage — focus on advancing existing deals through stages',
    });
    toast.success('Pipeline coverage calculated');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-600" />
            <CardTitle>Opps Tools</CardTitle>
          </div>
          <CardDescription>
            Opp entry, deal scoring, win rate analysis, and pipeline coverage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="opp-entry" className="gap-2">
                <PlusCircle className="w-4 h-4" /> Opp Entry
              </TabsTrigger>
              <TabsTrigger value="scoring" className="gap-2">
                <BarChart3 className="w-4 h-4" /> Deal Scoring
              </TabsTrigger>
              <TabsTrigger value="winrate" className="gap-2">
                <TrendingUp className="w-4 h-4" /> Win Rate
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="gap-2">
                <DollarSign className="w-4 h-4" /> Pipeline
              </TabsTrigger>
            </TabsList>

            {/* Opp Entry Tab — Aerostack Control Sheet → HubSpot */}
            <TabsContent value="opp-entry" className="space-y-4 mt-4">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-800">
                Aerostack Opportunity Control Sheet — creates the opp in HubSpot immediately. HubSpot/Suger/ACE automation smooths the rest.
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Lifecycle <span className="text-red-500">*</span></Label>
                  <Select value={oppEntry.lifecycle} onValueChange={v => setOppEntry(p => ({ ...p, lifecycle: v as OppLifecycle }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Lead">Lead</SelectItem>
                      <SelectItem value="Developing">Developing</SelectItem>
                      <SelectItem value="Ready for Signature">Ready for Signature</SelectItem>
                      <SelectItem value="Funding-Ready">Funding-Ready</SelectItem>
                      <SelectItem value="Closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Opp Class <span className="text-red-500">*</span></Label>
                  <Select value={oppEntry.opp_class} onValueChange={v => setOppEntry(p => ({ ...p, opp_class: v as OppClass }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RevGen">RevGen</SelectItem>
                      <SelectItem value="Strategic">Strategic</SelectItem>
                      <SelectItem value="Internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>enterprise Owner <span className="text-red-500">*</span></Label>
                  <Select value={oppEntry.enterprise_owner} onValueChange={v => setOppEntry(p => ({ ...p, enterprise_owner: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      {Enterprise_OWNERS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>HubSpot Pipeline <span className="text-red-500">*</span></Label>
                  <Select
                    value={oppEntry.pipeline_id}
                    onValueChange={v => setOppEntry(p => ({ ...p, pipeline_id: v, dealstage_id: '' }))}
                    disabled={pipelinesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={pipelinesLoading ? 'Loading pipelines...' : 'Select pipeline'} />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelines.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Deal Stage</Label>
                  <Select
                    value={oppEntry.dealstage_id}
                    onValueChange={v => setOppEntry(p => ({ ...p, dealstage_id: v }))}
                    disabled={!oppEntry.pipeline_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={!oppEntry.pipeline_id ? 'Select pipeline first' : 'Select stage'} />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPipelineStages.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Customer <span className="text-red-500">*</span></Label>
                  <Input value={oppEntry.customer} onChange={e => setOppEntry(p => ({ ...p, customer: e.target.value }))} placeholder="Acme Corp" />
                </div>
                <div className="space-y-2">
                  <Label>Customer Owner</Label>
                  <Input value={oppEntry.customer_owner} onChange={e => setOppEntry(p => ({ ...p, customer_owner: e.target.value }))} placeholder="Jane Smith (CTO)" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Opportunity Name <span className="text-red-500">*</span></Label>
                  <Input value={oppEntry.opportunity_name} onChange={e => setOppEntry(p => ({ ...p, opportunity_name: e.target.value }))} placeholder="AWS S3 analysis PoV" />
                </div>
                <div className="space-y-2">
                  <Label>Est. Revenue {oppEntry.opp_class === 'RevGen' && <span className="text-red-500">*</span>}</Label>
                  <Input type="number" value={oppEntry.est_revenue} onChange={e => setOppEntry(p => ({ ...p, est_revenue: e.target.value }))} placeholder="18000" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Target Close</Label>
                  <Input type="date" value={oppEntry.target_close} onChange={e => setOppEntry(p => ({ ...p, target_close: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Verbal Contours Confirmed?</Label>
                  <Select value={oppEntry.verbal_contours_confirmed} onValueChange={v => setOppEntry(p => ({ ...p, verbal_contours_confirmed: v as 'Y' | 'N' }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Y">Yes</SelectItem>
                      <SelectItem value="N">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Funding Needed?</Label>
                  <Select value={oppEntry.funding_needed} onValueChange={v => setOppEntry(p => ({ ...p, funding_needed: v as 'Y' | 'N' }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Y">Yes</SelectItem>
                      <SelectItem value="N">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {oppEntry.funding_needed === 'Y' && (
                <div className="space-y-2">
                  <Label>Funding Status</Label>
                  <Select value={oppEntry.funding_status} onValueChange={v => setOppEntry(p => ({ ...p, funding_status: v as OppEntry['funding_status'] }))}>
                    <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="None">None</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Approved">Approved</SelectItem>
                      <SelectItem value="Denied">Denied</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Next Step</Label>
                  <Input value={oppEntry.next_step} onChange={e => setOppEntry(p => ({ ...p, next_step: e.target.value }))} placeholder="Follow up with updated MSA" />
                </div>
                <div className="space-y-2">
                  <Label>Next Step Owner</Label>
                  <Input value={oppEntry.next_step_owner} onChange={e => setOppEntry(p => ({ ...p, next_step_owner: e.target.value }))} placeholder="Brian/Will" />
                </div>
                <div className="space-y-2">
                  <Label>Next Step Date <span className="text-red-500">*</span></Label>
                  <Input type="date" value={oppEntry.next_step_date} onChange={e => setOppEntry(p => ({ ...p, next_step_date: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={oppEntry.notes} onChange={e => setOppEntry(p => ({ ...p, notes: e.target.value }))} placeholder="Context, history, blockers..." rows={3} />
              </div>

              <Button onClick={submitOppEntry} disabled={oppSubmitting} className="w-full bg-orange-600 hover:bg-orange-700">
                {oppSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {oppSubmitting ? 'Creating in HubSpot...' : 'Create Opp → HubSpot'}
              </Button>

              {oppResult && (
                <div className="p-4 bg-green-50 rounded-lg border border-green-200 space-y-2">
                  <div className="flex items-center gap-2 text-green-700 font-medium">
                    <CheckCircle2 className="w-5 h-5" /> Opp Created
                  </div>
                  <div className="text-sm text-green-600">
                    Deal ID: <code className="bg-green-100 px-1 rounded">{oppResult.dealId}</code>
                  </div>
                  {oppResult.hubspotUrl && (
                    <a href={oppResult.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
                      Open in HubSpot →
                    </a>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Deal Scoring Tab */}
            <TabsContent value="scoring" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Deal Name</Label>
                  <Input value={dealScore.deal_name} onChange={e => setDealScore(p => ({ ...p, deal_name: e.target.value }))} placeholder="Acme Corp - Cloud Migration" />
                </div>
                <div className="space-y-2">
                  <Label>Amount ($)</Label>
                  <Input type="number" value={dealScore.amount} onChange={e => setDealScore(p => ({ ...p, amount: e.target.value }))} placeholder="150000" />
                </div>
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select value={dealScore.stage} onValueChange={v => setDealScore(p => ({ ...p, stage: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="discovery">Discovery</SelectItem>
                      <SelectItem value="proposal">Proposal</SelectItem>
                      <SelectItem value="negotiation">Negotiation</SelectItem>
                      <SelectItem value="verbal_commit">Verbal Commit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Days in Stage</Label>
                  <Input type="number" value={dealScore.days_in_stage} onChange={e => setDealScore(p => ({ ...p, days_in_stage: e.target.value }))} placeholder="14" />
                </div>
                <div className="space-y-2">
                  <Label>Competitors</Label>
                  <Input type="number" value={dealScore.competitor_count} onChange={e => setDealScore(p => ({ ...p, competitor_count: e.target.value }))} placeholder="2" />
                </div>
                <div className="space-y-2">
                  <Label>Engagement Level</Label>
                  <Select value={dealScore.engagement_level} onValueChange={v => setDealScore(p => ({ ...p, engagement_level: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>BANT Qualification</Label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['has_budget', 'Budget Confirmed'],
                    ['has_decision_maker', 'Decision Maker Access'],
                    ['has_timeline', 'Timeline Defined'],
                    ['has_champion', 'Champion Identified'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={dealScore[key]}
                        onChange={e => setDealScore(p => ({ ...p, [key]: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Button onClick={calculateDealScore} className="w-full bg-orange-600 hover:bg-orange-700">
                <BarChart3 className="w-4 h-4 mr-2" /> Score Deal
              </Button>

              {scoreResult && (
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Score</div>
                      <div className="text-3xl font-bold text-blue-600">{scoreResult.score}</div>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Health</div>
                      <Badge className={`mt-1 ${scoreResult.health === 'Strong' ? 'bg-green-500' : scoreResult.health === 'At Risk' ? 'bg-yellow-500' : 'bg-red-500'} text-white`}>
                        {scoreResult.health}
                      </Badge>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Win Prob</div>
                      <div className="text-3xl font-bold text-purple-600">{scoreResult.probability}%</div>
                    </div>
                    <div className="p-4 bg-orange-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Weighted</div>
                      <div className="text-2xl font-bold text-orange-600">${scoreResult.weightedValue.toLocaleString()}</div>
                    </div>
                  </div>
                  {scoreResult.recommendations.length > 0 && (
                    <div className="p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400">
                      <div className="font-semibold mb-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Recommendations</div>
                      <ul className="space-y-1 text-sm">
                        {scoreResult.recommendations.map((r: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-yellow-600 mt-0.5">•</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Win Rate Tab */}
            <TabsContent value="winrate" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Total Opportunities</Label>
                  <Input type="number" value={winRate.total_opps} onChange={e => setWinRate(p => ({ ...p, total_opps: e.target.value }))} placeholder="100" />
                </div>
                <div className="space-y-2">
                  <Label>Closed Won</Label>
                  <Input type="number" value={winRate.closed_won} onChange={e => setWinRate(p => ({ ...p, closed_won: e.target.value }))} placeholder="28" />
                </div>
                <div className="space-y-2">
                  <Label>Closed Lost</Label>
                  <Input type="number" value={winRate.closed_lost} onChange={e => setWinRate(p => ({ ...p, closed_lost: e.target.value }))} placeholder="45" />
                </div>
                <div className="space-y-2">
                  <Label>Avg Deal Size ($)</Label>
                  <Input type="number" value={winRate.avg_deal_size} onChange={e => setWinRate(p => ({ ...p, avg_deal_size: e.target.value }))} placeholder="75000" />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Avg Sales Cycle (days)</Label>
                  <Input type="number" value={winRate.avg_sales_cycle_days} onChange={e => setWinRate(p => ({ ...p, avg_sales_cycle_days: e.target.value }))} placeholder="45" />
                </div>
              </div>

              <Button onClick={calculateWinRate} className="w-full bg-green-600 hover:bg-green-700">
                <TrendingUp className="w-4 h-4 mr-2" /> Calculate Win Rate
              </Button>

              {winResult && (
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 bg-green-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Win Rate</div>
                      <div className="text-3xl font-bold text-green-600">{winResult.win_rate}%</div>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Loss Rate</div>
                      <div className="text-3xl font-bold text-red-600">{winResult.loss_rate}%</div>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Open</div>
                      <div className="text-3xl font-bold text-blue-600">{winResult.open_rate}%</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Sales Velocity</div>
                      <div className="text-2xl font-bold text-purple-600">${winResult.sales_velocity.toLocaleString()}/day</div>
                    </div>
                    <div className="p-4 bg-orange-50 rounded-lg">
                      <div className="text-sm text-muted-foreground">Total Won Value</div>
                      <div className="text-2xl font-bold text-orange-600">${winResult.total_won_value.toLocaleString()}</div>
                    </div>
                  </div>
                  <Badge className={`${winResult.health === 'Healthy' ? 'bg-green-500' : winResult.health === 'Below Average' ? 'bg-yellow-500' : 'bg-red-500'} text-white`}>
                    {winResult.health}
                  </Badge>
                </div>
              )}
            </TabsContent>

            {/* Pipeline Coverage Tab */}
            <TabsContent value="pipeline" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quota ($)</Label>
                  <Input type="number" value={pipeline.quota} onChange={e => setPipeline(p => ({ ...p, quota: e.target.value }))} placeholder="500000" />
                </div>
                <div className="space-y-2">
                  <Label>Total Pipeline Value ($)</Label>
                  <Input type="number" value={pipeline.pipeline_value} onChange={e => setPipeline(p => ({ ...p, pipeline_value: e.target.value }))} placeholder="1500000" />
                </div>
                <div className="space-y-2">
                  <Label>Weighted Pipeline ($)</Label>
                  <Input type="number" value={pipeline.weighted_pipeline} onChange={e => setPipeline(p => ({ ...p, weighted_pipeline: e.target.value }))} placeholder="600000" />
                </div>
                <div className="space-y-2">
                  <Label>Avg Win Rate (%)</Label>
                  <Input type="number" value={pipeline.avg_win_rate} onChange={e => setPipeline(p => ({ ...p, avg_win_rate: e.target.value }))} placeholder="28" />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Days Remaining in Quarter</Label>
                  <Input type="number" value={pipeline.days_remaining_in_quarter} onChange={e => setPipeline(p => ({ ...p, days_remaining_in_quarter: e.target.value }))} placeholder="45" />
                </div>
              </div>

              <Button onClick={calculatePipeline} className="w-full bg-purple-600 hover:bg-purple-700">
                <DollarSign className="w-4 h-4 mr-2" /> Calculate Coverage
              </Button>

              {pipelineResult && (
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 bg-blue-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Coverage Ratio</div>
                      <div className="text-3xl font-bold text-blue-600">{pipelineResult.coverage_ratio}x</div>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Weighted</div>
                      <div className="text-3xl font-bold text-purple-600">{pipelineResult.weighted_coverage}x</div>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg text-center">
                      <div className="text-sm text-muted-foreground">Gap to Quota</div>
                      <div className="text-2xl font-bold text-red-600">${pipelineResult.gap.toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <Badge className={`${pipelineResult.health === 'Strong' ? 'bg-green-500' : pipelineResult.health === 'Adequate' ? 'bg-yellow-500' : 'bg-red-500'} text-white mb-2`}>
                      {pipelineResult.health}
                    </Badge>
                    <p className="text-sm text-muted-foreground">{pipelineResult.recommendation}</p>
                    {pipelineResult.daily_target > 0 && (
                      <p className="text-sm mt-2 font-medium">Daily target to close gap: ${pipelineResult.daily_target.toLocaleString()}/day</p>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
