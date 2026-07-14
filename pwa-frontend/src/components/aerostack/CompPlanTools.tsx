import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import toast from "react-hot-toast";

const TEMPLATES: Record<string, string> = {
  "w2-staff": "W-2 Staff (base + MBO + benefits)",
  "w2-sales": "W-2 Sales (base + MBO + commission)",
  "1099": "1099 Contractor (hourly/project)",
  "advisory": "Advisory (retainer + equity)",
};

const LEVELS = ["L3", "L4", "L5", "L6", "L7", "L8"] as const;
const SCENARIO_LABELS = ["Floor", "Target", "Stretch"] as const;

const QSEHRA_MONTHLY = { individual: 460, family: 1000 } as const;

interface CompPlan {
  id: string;
  personName: string;
  planName: string;
  role: string;
  level: string;
  templateId: string;
  base: { amount: number; enabled: boolean };
  mbo: { enabled: boolean; targetPct: number; floorPct: number; stretchPct: number };
  benefits: { enabled: boolean; coverageType: "individual" | "family"; annualCost: number };
  commission: { enabled: boolean; targetPct: number; floorPct: number; stretchPct: number; oteBase: number };
  pi: { enabled: boolean; poolPct: number };
  equity: { enabled: boolean; shares: number; vestingYears: number; cliffMonths: number };
  advisory: { enabled: boolean; monthlyRetainer: number; months: number };
}

interface ScenarioRow {
  label: string;
  base: number;
  mbo: number;
  benefits: number;
  commission: number;
  pi: number;
  advisory: number;
  total: number;
}

function newPlan(tplId = "w2-staff"): CompPlan {
  return {
    id: crypto.randomUUID(),
    personName: "",
    planName: "",
    role: "",
    level: "L4",
    templateId: tplId,
    base: { amount: 0, enabled: true },
    mbo: { enabled: true, targetPct: 15, floorPct: 5, stretchPct: 25 },
    benefits: { enabled: tplId.startsWith("w2"), coverageType: "individual", annualCost: QSEHRA_MONTHLY.individual * 12 },
    commission: { enabled: tplId === "w2-sales", targetPct: 10, floorPct: 3, stretchPct: 20, oteBase: 0 },
    pi: { enabled: false, poolPct: 0 },
    equity: { enabled: false, shares: 0, vestingYears: 4, cliffMonths: 12 },
    advisory: { enabled: tplId === "advisory", monthlyRetainer: 0, months: 6 },
  };
}

function calcScenarios(p: CompPlan): ScenarioRow[] {
  return SCENARIO_LABELS.map((label, si) => {
    const base = p.base.enabled ? p.base.amount : 0;
    const mboPcts = [p.mbo.floorPct, p.mbo.targetPct, p.mbo.stretchPct];
    const mbo = p.mbo.enabled ? base * ((mboPcts[si] ?? 0) / 100) : 0;
    const benefits = p.benefits.enabled ? p.benefits.annualCost : 0;
    const commPcts = [p.commission.floorPct, p.commission.targetPct, p.commission.stretchPct];
    const commission = p.commission.enabled ? (p.commission.oteBase || base) * ((commPcts[si] ?? 0) / 100) : 0;
    const pi = p.pi.enabled ? base * (p.pi.poolPct / 100) : 0;
    const advisory = p.advisory.enabled ? p.advisory.monthlyRetainer * p.advisory.months : 0;
    const total = base + mbo + benefits + commission + pi + advisory;
    return { label, base, mbo, benefits, commission, pi, advisory, total };
  });
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function BlockToggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}

function NumField({ label, value, onChange, prefix, suffix, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        <Input
          type="number" min={min ?? 0} max={max} step={step ?? 1}
          value={value || ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-xs bg-yellow-50 dark:bg-yellow-900/20"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export default function CompPlanTools() {
  const [activeTab, setActiveTab] = useState("builder");
  const [plans, setPlans] = useState<CompPlan[]>([newPlan()]);
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    base: true, mbo: true, benefits: true, commission: true, pi: true, equity: true, advisory: true,
  });

  const plan = plans[idx];
  if (!plan) return null;

  function up(patch: Partial<CompPlan>) {
    setPlans((ps) => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function upBlock<K extends keyof CompPlan>(k: K, patch: Partial<CompPlan[K] & object>) {
    setPlans((ps) => ps.map((p, i) => (i === idx ? { ...p, [k]: { ...(p[k] as object), ...patch } } : p)));
  }

  function addPlan(tplId = "w2-staff") {
    setPlans((ps) => [...ps, newPlan(tplId)]);
    setIdx(plans.length);
  }

  function removePlan(i: number) {
    if (plans.length <= 1) return;
    setPlans((ps) => ps.filter((_, j) => j !== i));
    setIdx((v) => Math.min(v, plans.length - 2));
  }

  function dupPlan(i: number) {
    const src = plans[i];
    if (!src) return;
    const c: CompPlan = { ...structuredClone(src), id: crypto.randomUUID(), planName: `${src.planName} (copy)` };
    setPlans((ps) => [...ps, c]);
    setIdx(plans.length);
    toast.success("Plan duplicated");
  }

  const scenarios = useMemo(() => calcScenarios(plan), [plan]);

  function toggle(key: string) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }));
  }

  function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
      <Collapsible open={expanded[id]} onOpenChange={() => toggle(id)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-semibold border-b">
          {title}
          {expanded[id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 pb-4 space-y-3">{children}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Compensation Plan Tools</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => dupPlan(idx)}><Copy className="h-3 w-3 mr-1" /> Duplicate</Button>
            <Button variant="outline" size="sm" onClick={() => addPlan()}><Plus className="h-3 w-3 mr-1" /> New Plan</Button>
          </div>
        </div>
        <CardDescription>Build, model, and compare enterprise comp plans. Every plan is a combination of universal blocks toggled by role and level.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="space-y-4 mt-4">
            {plans.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {plans.map((p, i) => (
                  <Button key={p.id} variant={i === idx ? "default" : "outline"} size="sm" onClick={() => setIdx(i)}>
                    {p.planName || p.personName || `Plan ${i + 1}`}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">Person Name</label>
                <Input value={plan.personName} onChange={(e) => up({ personName: e.target.value })} placeholder="Name" className="bg-yellow-50 dark:bg-yellow-900/20" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Plan Name</label>
                <Input value={plan.planName} onChange={(e) => up({ planName: e.target.value })} placeholder="e.g. Senior Eng Offer" className="bg-yellow-50 dark:bg-yellow-900/20" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Role</label>
                <Input value={plan.role} onChange={(e) => up({ role: e.target.value })} placeholder="e.g. Senior Engineer" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Level</label>
                <Select value={plan.level} onValueChange={(v) => up({ level: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Template</label>
              <Select value={plan.templateId} onValueChange={(v) => up({ templateId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TEMPLATES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Section id="base" title="Base Salary">
              <BlockToggle label="Enabled" enabled={plan.base.enabled} onToggle={(v) => upBlock("base", { enabled: v })} />
              {plan.base.enabled && <NumField label="Annual Base" value={plan.base.amount} onChange={(v) => upBlock("base", { amount: v })} prefix="$" />}
            </Section>

            <Section id="mbo" title="MBO (Management by Objectives)">
              <BlockToggle label="Enabled" enabled={plan.mbo.enabled} onToggle={(v) => upBlock("mbo", { enabled: v })} />
              {plan.mbo.enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <NumField label="Floor %" value={plan.mbo.floorPct} onChange={(v) => upBlock("mbo", { floorPct: v })} suffix="%" />
                  <NumField label="Target %" value={plan.mbo.targetPct} onChange={(v) => upBlock("mbo", { targetPct: v })} suffix="%" />
                  <NumField label="Stretch %" value={plan.mbo.stretchPct} onChange={(v) => upBlock("mbo", { stretchPct: v })} suffix="%" />
                </div>
              )}
            </Section>

            <Section id="benefits" title="Benefits (QSEHRA)">
              <BlockToggle label="Enabled" enabled={plan.benefits.enabled} onToggle={(v) => upBlock("benefits", { enabled: v })} />
              {plan.benefits.enabled && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Coverage Type</label>
                    <Select
                      value={plan.benefits.coverageType}
                      onValueChange={(v: "individual" | "family") => upBlock("benefits", {
                        coverageType: v,
                        annualCost: QSEHRA_MONTHLY[v] * 12,
                      })}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual (${QSEHRA_MONTHLY.individual}/mo)</SelectItem>
                        <SelectItem value="family">Family (${QSEHRA_MONTHLY.family}/mo)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumField label="Annual QSEHRA Cost" value={plan.benefits.annualCost} onChange={(v) => upBlock("benefits", { annualCost: v })} prefix="$" />
                  <p className="text-xs text-muted-foreground">
                    QSEHRA rate: {fmt(QSEHRA_MONTHLY[plan.benefits.coverageType])}/mo × 12 = {fmt(QSEHRA_MONTHLY[plan.benefits.coverageType] * 12)}/yr
                  </p>
                </div>
              )}
            </Section>

            <Section id="commission" title="Commission">
              <BlockToggle label="Enabled" enabled={plan.commission.enabled} onToggle={(v) => upBlock("commission", { enabled: v })} />
              {plan.commission.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="OTE Base (or uses base salary)" value={plan.commission.oteBase} onChange={(v) => upBlock("commission", { oteBase: v })} prefix="$" />
                  <div></div>
                  <NumField label="Floor %" value={plan.commission.floorPct} onChange={(v) => upBlock("commission", { floorPct: v })} suffix="%" />
                  <NumField label="Target %" value={plan.commission.targetPct} onChange={(v) => upBlock("commission", { targetPct: v })} suffix="%" />
                  <NumField label="Stretch %" value={plan.commission.stretchPct} onChange={(v) => upBlock("commission", { stretchPct: v })} suffix="%" />
                </div>
              )}
            </Section>

            <Section id="pi" title="Profit Interest / Pool">
              <BlockToggle label="Enabled" enabled={plan.pi.enabled} onToggle={(v) => upBlock("pi", { enabled: v })} />
              {plan.pi.enabled && <NumField label="Pool %" value={plan.pi.poolPct} onChange={(v) => upBlock("pi", { poolPct: v })} suffix="%" />}
            </Section>

            <Section id="equity" title="Equity">
              <BlockToggle label="Enabled" enabled={plan.equity.enabled} onToggle={(v) => upBlock("equity", { enabled: v })} />
              {plan.equity.enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <NumField label="Shares" value={plan.equity.shares} onChange={(v) => upBlock("equity", { shares: v })} />
                  <NumField label="Vesting (years)" value={plan.equity.vestingYears} onChange={(v) => upBlock("equity", { vestingYears: v })} />
                  <NumField label="Cliff (months)" value={plan.equity.cliffMonths} onChange={(v) => upBlock("equity", { cliffMonths: v })} />
                </div>
              )}
            </Section>

            <Section id="advisory" title="Advisory Retainer">
              <BlockToggle label="Enabled" enabled={plan.advisory.enabled} onToggle={(v) => upBlock("advisory", { enabled: v })} />
              {plan.advisory.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Monthly Retainer" value={plan.advisory.monthlyRetainer} onChange={(v) => upBlock("advisory", { monthlyRetainer: v })} prefix="$" />
                  <NumField label="Months" value={plan.advisory.months} onChange={(v) => upBlock("advisory", { months: v })} />
                </div>
              )}
            </Section>

            {plans.length > 1 && (
              <Button variant="outline" size="sm" className="text-red-500" onClick={() => removePlan(idx)}>
                <Trash2 className="h-3 w-3 mr-1" /> Remove This Plan
              </Button>
            )}
          </TabsContent>

          <TabsContent value="scenarios" className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="p-2">Scenario</th>
                    <th className="p-2 text-right">Base</th>
                    <th className="p-2 text-right">MBO</th>
                    <th className="p-2 text-right">Benefits</th>
                    <th className="p-2 text-right">Commission</th>
                    <th className="p-2 text-right">Profit Int.</th>
                    <th className="p-2 text-right">Advisory</th>
                    <th className="p-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.label} className="border-b">
                      <td className="p-2 font-medium">{s.label}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.base)}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.mbo)}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.benefits)}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.commission)}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.pi)}</td>
                      <td className="p-2 text-right font-mono">{fmt(s.advisory)}</td>
                      <td className="p-2 text-right font-mono font-semibold">{fmt(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {plan.personName || "Plan"} — {plan.role || "Role"} ({plan.level}) — {TEMPLATES[plan.templateId] ?? plan.templateId}
            </p>
          </TabsContent>

          <TabsContent value="compare" className="mt-4">
            {plans.length < 2 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Add at least 2 plans to compare side-by-side.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground text-left">
                      <th className="p-2">Scenario</th>
                      {plans.map((p, i) => (
                        <th key={p.id} className="p-2 text-right">{p.planName || p.personName || `Plan ${i + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SCENARIO_LABELS.map((label, si) => (
                      <tr key={label} className="border-b">
                        <td className="p-2 font-medium">{label}</td>
                        {plans.map((p) => {
                          const s = calcScenarios(p)[si];
                          return <td key={p.id} className="p-2 text-right font-mono">{s ? fmt(s.total) : "—"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
