import { useState, useMemo } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  DollarSign,
  FileText,
  Loader2,
  Plus,
  Target,
  Trash2,
  Users,
  Calendar,
  AlertTriangle,
  Briefcase,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import toast from 'react-hot-toast';

/*
 * Aerostack Project Handoff Tool
 *
 * Automates the pre-sales → delivery handoff process:
 *   Step 1: Deal Selection — pick a deal moving to commitment
 *   Step 2: Commitment & Validation — confirm SAL data, engagement type, customer
 *   Step 3: Resource Allocation — pod composition, sprint plan
 *   Step 4: Project Setup — OKRs, Linear project, Deel time card
 *   Step 5: Kickoff Scheduling — gate: docs signed → schedule kickoff
 *
 * Data-driven, not agent-driven. Agent orchestration layered later.
 */

// ── Types ──────────────────────────────────────────────────────

type HandoffStep = 'deal' | 'commitment' | 'resources' | 'project' | 'kickoff';

const STEPS: { key: HandoffStep; label: string; icon: typeof Briefcase }[] = [
  { key: 'deal', label: 'Deal Selection', icon: Target },
  { key: 'commitment', label: 'Commitment', icon: FileText },
  { key: 'resources', label: 'Resources', icon: Users },
  { key: 'project', label: 'Project Setup', icon: Briefcase },
  { key: 'kickoff', label: 'Kickoff', icon: Calendar },
];

interface DealInfo {
  dealName: string;
  customer: string;
  tcv: number;
  stage: string;
  enterpriseOwner: string;
  awsFunding: number;
  customerFunding: number;
  engagementType: string;
  salDocUrl: string;
}

interface PodMember {
  id: string;
  role: string;
  name: string;
  hrsPerSprint: number;
  rate: number;
  activeSprints: number;
}

interface OKR {
  id: string;
  objective: string;
  keyResults: string[];
}

interface HandoffGate {
  label: string;
  completed: boolean;
}

// ── Defaults ───────────────────────────────────────────────────

const ENGAGEMENT_TYPES = [
  'Cloud Modernization',
  'AI/ML Implementation',
  'Data Engineering',
  'Managed Services',
  'Well-Architected Review',
  'MAP Assess',
  'MAP Mobilize',
  'Proof of Concept',
  'Staff Augmentation',
  'Custom',
] as const;

const STAGES = [
  'Discovery',
  'Qualification',
  'Business Validation',
  'Commitment',
  'Closed Won',
] as const;

const POD_ROLES = [
  'Solutions Architect',
  'Tech Lead',
  'Software Engineer',
  'Data Engineer',
  'DevOps Engineer',
  'Project Manager',
  'Designer',
  'QA Engineer',
] as const;


const DEFAULT_GATES: HandoffGate[] = [
  { label: 'SAL / SOW signed by customer', completed: false },
  { label: 'AWS funding confirmed (if applicable)', completed: false },
  { label: 'Internal resourcing approved', completed: false },
  { label: 'Deel time card created', completed: false },
  { label: 'Linear project created with OKRs', completed: false },
  { label: 'Kickoff meeting scheduled', completed: false },
];

function emptyDeal(): DealInfo {
  return { dealName: '', customer: '', tcv: 0, stage: 'Business Validation', enterpriseOwner: '', awsFunding: 0, customerFunding: 0, engagementType: 'Cloud Modernization', salDocUrl: '' };
}
function emptyMember(): PodMember {
  return { id: crypto.randomUUID(), role: '', name: '', hrsPerSprint: 40, rate: 0, activeSprints: 4 };
}
function emptyOKR(): OKR {
  return { id: crypto.randomUUID(), objective: '', keyResults: [''] };
}

function fmt(n: number): string { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }

// ── Component ──────────────────────────────────────────────────

export default function ProjectHandoffTools() {
  const [step, setStep] = useState<HandoffStep>('deal');
  const [deal, setDeal] = useState<DealInfo>(emptyDeal());
  const [pod, setPod] = useState<PodMember[]>([emptyMember()]);
  const [okrs, setOkrs] = useState<OKR[]>([emptyOKR()]);
  const [gates, setGates] = useState<HandoffGate[]>(DEFAULT_GATES.map((g) => ({ ...g })));
  const [projectName, setProjectName] = useState('');
  const [coordinatorNotes, setCoordinatorNotes] = useState('');
  const [kickoffDate, setKickoffDate] = useState('');

  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const allGatesComplete = gates.every((g) => g.completed);

  // Pod math
  const totalPodCost = useMemo(() => pod.reduce((s, m) => s + m.hrsPerSprint * m.rate * m.activeSprints, 0), [pod]);
  const margin = deal.tcv > 0 ? ((deal.tcv - totalPodCost) / deal.tcv * 100) : 0;

  // Pod helpers
  function addMember() { setPod((p) => [...p, emptyMember()]); }
  function removeMember(id: string) { setPod((p) => p.filter((m) => m.id !== id)); }
  function updateMember(id: string, patch: Partial<PodMember>) { setPod((p) => p.map((m) => m.id === id ? { ...m, ...patch } : m)); }

  // OKR helpers
  function addOKR() { setOkrs((o) => [...o, emptyOKR()]); }
  function removeOKR(id: string) { setOkrs((o) => o.filter((ok) => ok.id !== id)); }
  function updateOKR(id: string, patch: Partial<OKR>) { setOkrs((o) => o.map((ok) => ok.id === id ? { ...ok, ...patch } : ok)); }
  function addKR(okrId: string) { setOkrs((o) => o.map((ok) => ok.id === okrId ? { ...ok, keyResults: [...ok.keyResults, ''] } : ok)); }
  function updateKR(okrId: string, krIdx: number, val: string) {
    setOkrs((o) => o.map((ok) => ok.id === okrId ? { ...ok, keyResults: ok.keyResults.map((kr, i) => i === krIdx ? val : kr) } : ok));
  }
  function removeKR(okrId: string, krIdx: number) {
    setOkrs((o) => o.map((ok) => ok.id === okrId ? { ...ok, keyResults: ok.keyResults.filter((_, i) => i !== krIdx) } : ok));
  }

  // Gate toggle
  function toggleGate(idx: number) { setGates((g) => g.map((gate, i) => i === idx ? { ...gate, completed: !gate.completed } : gate)); }

  // Navigation
  function next() { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1]!.key); }
  function prev() { if (stepIdx > 0) setStep(STEPS[stepIdx - 1]!.key); }


  return (
    <div className="space-y-6">
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-blue-600" />
            <CardTitle>Project Handoff</CardTitle>
          </div>
          <CardDescription>Pre-sales → delivery handoff. Walk a deal through commitment, resourcing, project setup, and kickoff scheduling.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isCurrent = s.key === step;
              const isDone = i < stepIdx;
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <button
                    onClick={() => setStep(s.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      isCurrent ? 'bg-blue-600 text-white' : isDone ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                    {s.label}
                  </button>
                  {i < STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                </div>
              );
            })}
          </div>

          {/* ── STEP 1: DEAL SELECTION ──────────────────── */}
          {step === 'deal' && (
            <Card className="shadow-none border">
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground">Select a deal moving to commitment or business validation.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div><Label className="text-xs">Deal Name</Label><Input value={deal.dealName} onChange={(e) => setDeal((d) => ({ ...d, dealName: e.target.value }))} placeholder="e.g. Acme Cloud Modernization" /></div>
                  <div><Label className="text-xs">Customer</Label><Input value={deal.customer} onChange={(e) => setDeal((d) => ({ ...d, customer: e.target.value }))} placeholder="Customer name" /></div>
                  <div><Label className="text-xs">enterprise Owner</Label><Input value={deal.enterpriseOwner} onChange={(e) => setDeal((d) => ({ ...d, enterpriseOwner: e.target.value }))} placeholder="Deal owner" /></div>
                  <div><Label className="text-xs">Stage</Label>
                    <Select value={deal.stage} onValueChange={(v) => setDeal((d) => ({ ...d, stage: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Engagement Type</Label>
                    <Select value={deal.engagementType} onValueChange={(v) => setDeal((d) => ({ ...d, engagementType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ENGAGEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">TCV ($)</Label><Input type="number" value={deal.tcv || ''} onChange={(e) => setDeal((d) => ({ ...d, tcv: Number(e.target.value) }))} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">AWS Funding ($)</Label><Input type="number" value={deal.awsFunding || ''} onChange={(e) => setDeal((d) => ({ ...d, awsFunding: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">Customer Funding ($)</Label><Input type="number" value={deal.customerFunding || ''} onChange={(e) => setDeal((d) => ({ ...d, customerFunding: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">SAL / SOW Link</Label><Input value={deal.salDocUrl} onChange={(e) => setDeal((d) => ({ ...d, salDocUrl: e.target.value }))} placeholder="URL to document" /></div>
                </div>
                <div className="flex justify-end"><Button onClick={next} disabled={!deal.dealName || !deal.customer}>Next: Commitment <ArrowRight className="w-4 h-4 ml-1" /></Button></div>
              </CardContent>
            </Card>
          )}

          {/* ── STEP 2: COMMITMENT & VALIDATION ────────── */}
          {step === 'commitment' && (
            <Card className="shadow-none border">
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground">Validate deal data and confirm commitment to proceed.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Deal Summary</div>
                    <div className="text-xs space-y-1 bg-muted/30 rounded p-3">
                      <div>Deal: {deal.dealName}</div>
                      <div>Customer: {deal.customer}</div>
                      <div>Type: {deal.engagementType}</div>
                      <div>TCV: {fmt(deal.tcv)}</div>
                      <div>AWS: {fmt(deal.awsFunding)} | Customer: {fmt(deal.customerFunding)}</div>
                      <div>Owner: {deal.enterpriseOwner}</div>
                      {deal.customerFunding > 0 && deal.tcv > 0 && (
                        <div>Customer Co-Contribution: {(deal.customerFunding / deal.tcv * 100).toFixed(0)}%</div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Coordinator Notes</div>
                    <Textarea value={coordinatorNotes} onChange={(e) => setCoordinatorNotes(e.target.value)} placeholder="Notes for the project coordinator — context, risks, special requirements..." rows={6} />
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={prev}>Back</Button>
                  <Button onClick={next}>Next: Resources <ArrowRight className="w-4 h-4 ml-1" /></Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── STEP 3: RESOURCE ALLOCATION ─────────────── */}
          {step === 'resources' && (
            <Card className="shadow-none border">
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Build the delivery pod — roles, rates, sprint allocation.</p>
                  <Button size="sm" variant="outline" onClick={addMember}><Plus className="w-4 h-4 mr-1" /> Add Member</Button>
                </div>
                <div className="space-y-2">
                  {pod.map((m) => (
                    <div key={m.id} className="grid grid-cols-6 gap-2 items-end">
                      <div><Label className="text-xs">Role</Label>
                        <Select value={m.role} onValueChange={(v) => updateMember(m.id, { role: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
                          <SelectContent>{POD_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">Name</Label><Input className="h-8 text-xs" value={m.name} onChange={(e) => updateMember(m.id, { name: e.target.value })} placeholder="Name" /></div>
                      <div><Label className="text-xs">Hrs/Sprint</Label><Input className="h-8 text-xs" type="number" value={m.hrsPerSprint || ''} onChange={(e) => updateMember(m.id, { hrsPerSprint: Number(e.target.value) })} /></div>
                      <div><Label className="text-xs">Rate ($/hr)</Label><Input className="h-8 text-xs" type="number" value={m.rate || ''} onChange={(e) => updateMember(m.id, { rate: Number(e.target.value) })} /></div>
                      <div><Label className="text-xs">Sprints</Label><Input className="h-8 text-xs" type="number" value={m.activeSprints || ''} onChange={(e) => updateMember(m.id, { activeSprints: Number(e.target.value) })} /></div>
                      <div>{pod.length > 1 && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeMember(m.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between bg-muted/30 rounded p-3 text-sm">
                  <div>Pod Cost: <span className="font-mono font-semibold">{fmt(totalPodCost)}</span></div>
                  <div>TCV: <span className="font-mono">{fmt(deal.tcv)}</span></div>
                  <div>Margin: <span className={`font-mono font-semibold ${margin >= 30 ? 'text-green-600' : margin >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>{margin.toFixed(1)}%</span></div>
                </div>
                <div className="flex justify-between">
                  <Button variant="outline" onClick={prev}>Back</Button>
                  <Button onClick={next}>Next: Project Setup <ArrowRight className="w-4 h-4 ml-1" /></Button>
                </div>
              </CardContent>
            </Card>
          )}


          {/* ── STEP 4: PROJECT SETUP ──────────────────── */}
          {step === 'project' && (
            <Card className="shadow-none border">
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground">Define OKRs and create the project record. These become Linear deliverables and the Deel time card.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Project Name</Label><Input value={projectName || deal.dealName} onChange={(e) => setProjectName(e.target.value)} /></div>
                  <div><Label className="text-xs">Engagement Type</Label><div className="text-sm pt-2"><Badge>{deal.engagementType}</Badge></div></div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">OKRs (Objectives & Key Results)</Label>
                    <Button size="sm" variant="outline" onClick={addOKR}><Plus className="w-3 h-3 mr-1" /> Add OKR</Button>
                  </div>
                  {okrs.map((okr, oi) => (
                    <Card key={okr.id} className="shadow-none border">
                      <CardContent className="pt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-blue-600" />
                          <Input value={okr.objective} onChange={(e) => updateOKR(okr.id, { objective: e.target.value })} placeholder={`Objective ${oi + 1}`} className="h-8 text-sm font-medium" />
                          {okrs.length > 1 && <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeOKR(okr.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                        </div>
                        <div className="ml-6 space-y-1">
                          {okr.keyResults.map((kr, ki) => (
                            <div key={ki} className="flex items-center gap-2">
                              <Circle className="w-3 h-3 text-muted-foreground" />
                              <Input value={kr} onChange={(e) => updateKR(okr.id, ki, e.target.value)} placeholder={`Key Result ${ki + 1}`} className="h-7 text-xs" />
                              {okr.keyResults.length > 1 && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeKR(okr.id, ki)}><Trash2 className="w-2.5 h-2.5 text-destructive" /></Button>}
                            </div>
                          ))}
                          <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => addKR(okr.id)}><Plus className="w-3 h-3 mr-1" /> Key Result</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={prev}>Back</Button>
                  <Button onClick={next}>Next: Kickoff <ArrowRight className="w-4 h-4 ml-1" /></Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── STEP 5: KICKOFF SCHEDULING ─────────────── */}
          {step === 'kickoff' && (
            <Card className="shadow-none border">
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground">Complete all gates before scheduling the kickoff. All docs must be signed.</p>

                {/* Gates checklist */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Handoff Gates</Label>
                  {gates.map((gate, gi) => (
                    <div key={gi} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-muted/30 cursor-pointer" onClick={() => toggleGate(gi)}>
                      {gate.completed ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                      <span className={`text-sm ${gate.completed ? 'line-through text-muted-foreground' : ''}`}>{gate.label}</span>
                    </div>
                  ))}
                  <div className="text-xs text-muted-foreground mt-1">
                    {gates.filter((g) => g.completed).length} / {gates.length} complete
                  </div>
                </div>

                {/* Kickoff date */}
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Kickoff Date</Label><Input type="date" value={kickoffDate} onChange={(e) => setKickoffDate(e.target.value)} /></div>
                  <div className="flex items-end">
                    {!allGatesComplete && (
                      <div className="flex items-center gap-2 text-yellow-600 text-xs">
                        <AlertTriangle className="w-4 h-4" /> Complete all gates before scheduling
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <Card className="shadow-none border bg-muted/20">
                  <CardContent className="pt-4">
                    <div className="text-sm font-semibold mb-2">Handoff Summary</div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div>Deal: <span className="font-medium">{deal.dealName}</span></div>
                      <div>Customer: <span className="font-medium">{deal.customer}</span></div>
                      <div>Type: <span className="font-medium">{deal.engagementType}</span></div>
                      <div>TCV: <span className="font-mono font-medium">{fmt(deal.tcv)}</span></div>
                      <div>Pod Size: <span className="font-medium">{pod.length} members</span></div>
                      <div>Pod Cost: <span className="font-mono font-medium">{fmt(totalPodCost)}</span></div>
                      <div>Margin: <span className="font-mono font-medium">{margin.toFixed(1)}%</span></div>
                      <div>OKRs: <span className="font-medium">{okrs.length} objectives</span></div>
                      <div>Owner: <span className="font-medium">{deal.enterpriseOwner}</span></div>
                      <div>Kickoff: <span className="font-medium">{kickoffDate || 'Not set'}</span></div>
                    </div>
                    {coordinatorNotes && (
                      <div className="mt-2 text-xs text-muted-foreground border-t pt-2">
                        Notes: {coordinatorNotes}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={prev}>Back</Button>
                  <Button
                    disabled={!allGatesComplete || !kickoffDate}
                    onClick={() => {
                      toast.success(`Handoff complete for ${deal.dealName}. Kickoff scheduled for ${kickoffDate}.`);
                    }}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Complete Handoff
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
