import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  DollarSign,
  Users,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

const MAX_SPRINTS = 8;
const ENG_MAX_HRS = 60;
const ENG_OPTIMAL_HRS = 50;
const ENG_WARNING_HRS = 55;
const PM_MAX_HRS = 16;
const PM_WARNING_HRS = 12;

interface TeamMember {
  role: string;
  name: string;
  hrsPerSprint: number;
  rate: number;
  fte: number;
  activeSprints: boolean[];
}

interface Project {
  id: string;
  name: string;
  durationMonths: number;
  tcv: number;
  engBudgetPct: number;
  team: TeamMember[];
}

function emptyMember(): TeamMember {
  return {
    role: "",
    name: "",
    hrsPerSprint: 0,
    rate: 0,
    fte: 1.0,
    activeSprints: Array(MAX_SPRINTS).fill(true),
  };
}

function emptyProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: "",
    durationMonths: 0,
    tcv: 0,
    engBudgetPct: 50,
    team: [emptyMember()],
  };
}

function sprintPayout(m: TeamMember, sprintIdx: number): number {
  if (!m.activeSprints[sprintIdx]) return 0;
  return m.hrsPerSprint * m.rate * m.fte;
}

function memberProjectTotal(m: TeamMember): number {
  return m.activeSprints.reduce((sum, active, i) => sum + (active ? m.hrsPerSprint * m.rate * m.fte : 0), 0);
}

function isEnterpriseOverhead(role: string): boolean {
  return role.toLowerCase().includes("enterprise");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pctFmt(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ProjectTab({
  project,
  onChange,
  onRemove,
  onDuplicate,
}: {
  project: Project;
  onChange: (p: Project) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const engBudget = project.tcv * (project.engBudgetPct / 100);
  const sprintCount = project.durationMonths * 2;

  const sprintTotals = useMemo(() =>
    Array.from({ length: MAX_SPRINTS }, (_, i) =>
      project.team
        .filter((m) => !isEnterpriseOverhead(m.role))
        .reduce((sum, m) => sum + sprintPayout(m, i), 0)
    ), [project.team]);

  const enterpriseSprintTotals = useMemo(() =>
    Array.from({ length: MAX_SPRINTS }, (_, i) =>
      project.team
        .filter((m) => isEnterpriseOverhead(m.role))
        .reduce((sum, m) => sum + sprintPayout(m, i), 0)
    ), [project.team]);

  const projectedCost = project.team
    .filter((m) => !isEnterpriseOverhead(m.role))
    .reduce((sum, m) => sum + memberProjectTotal(m), 0);

  const enterpriseOverhead = project.team
    .filter((m) => isEnterpriseOverhead(m.role))
    .reduce((sum, m) => sum + memberProjectTotal(m), 0);

  const margin = engBudget > 0 ? (engBudget - projectedCost) / engBudget : 0;

  const cumulative = sprintTotals.reduce<number[]>((acc, v) => {
    acc.push((acc.at(-1) ?? 0) + v);
    return acc;
  }, []);

  function updateField<K extends keyof Project>(key: K, value: Project[K]) {
    onChange({ ...project, [key]: value });
  }

  function updateMember(idx: number, member: TeamMember) {
    const team = [...project.team];
    team[idx] = member;
    onChange({ ...project, team });
  }

  function removeMember(idx: number) {
    onChange({ ...project, team: project.team.filter((_, i) => i !== idx) });
  }

  function addMember() {
    onChange({ ...project, team: [...project.team, emptyMember()] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Project Setup</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy className="h-3 w-3 mr-1" /> Duplicate
          </Button>
          <Button variant="outline" size="sm" onClick={onRemove} className="text-red-500 hover:text-red-600">
            <Trash2 className="h-3 w-3 mr-1" /> Remove
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-muted-foreground">Project Name</label>
          <Input value={project.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Project name" className="bg-yellow-50 dark:bg-yellow-900/20" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Duration (months)</label>
          <Input type="number" min={0} value={project.durationMonths || ""} onChange={(e) => updateField("durationMonths", Number(e.target.value))} className="bg-yellow-50 dark:bg-yellow-900/20" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">TCV ($)</label>
          <Input type="number" min={0} value={project.tcv || ""} onChange={(e) => updateField("tcv", Number(e.target.value))} className="bg-yellow-50 dark:bg-yellow-900/20" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Eng Budget %</label>
          <Input type="number" min={0} max={100} value={project.engBudgetPct || ""} onChange={(e) => updateField("engBudgetPct", Number(e.target.value))} className="bg-yellow-50 dark:bg-yellow-900/20" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Sprints (2-wk)</p>
          <p className="text-2xl font-bold">{sprintCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Eng Budget</p>
          <p className="text-2xl font-bold">{fmt(engBudget)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Delivery Margin</p>
          <p className={`text-2xl font-bold ${margin < 0 ? "text-red-500" : ""}`}>{pctFmt(margin)}</p>
        </CardContent></Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Payout = Hrs/Sprint × Rate × FTE. Click sprint columns to toggle a member on/off per sprint.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-2 w-28">Role</th>
              <th className="p-2 w-28">Resource</th>
              <th className="p-2 w-20">Hrs/Sprint</th>
              <th className="p-2 w-20">Rate ($/hr)</th>
              <th className="p-2 w-16">FTE</th>
              {Array.from({ length: MAX_SPRINTS }, (_, i) => (
                <th key={i} className="p-2 w-20 text-center">
                  S{i + 1} Payout
                </th>
              ))}
              <th className="p-2 w-24 text-right">Cost/Sprint</th>
              <th className="p-2 w-24 text-right">Project Total</th>
              <th className="p-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {project.team.map((m, idx) => {
              const costPerSprint = m.hrsPerSprint * m.rate * m.fte;
              const total = memberProjectTotal(m);
              const isOverhead = isEnterpriseOverhead(m.role);
              return (
                <tr key={idx} className={`border-b ${isOverhead ? "text-muted-foreground italic" : ""}`}>
                  <td className="p-1">
                    <Input value={m.role} onChange={(e) => updateMember(idx, { ...m, role: e.target.value })} placeholder="Team Lead" className="h-8 text-xs" />
                  </td>
                  <td className="p-1">
                    <Input value={m.name} onChange={(e) => updateMember(idx, { ...m, name: e.target.value })} placeholder="Name" className="h-8 text-xs bg-yellow-50 dark:bg-yellow-900/20" />
                  </td>
                  <td className="p-1">
                    <Input type="number" min={0} value={m.hrsPerSprint || ""} onChange={(e) => updateMember(idx, { ...m, hrsPerSprint: Number(e.target.value) })} className="h-8 text-xs bg-yellow-50 dark:bg-yellow-900/20" />
                  </td>
                  <td className="p-1">
                    <Input type="number" min={0} value={m.rate || ""} onChange={(e) => updateMember(idx, { ...m, rate: Number(e.target.value) })} className="h-8 text-xs bg-yellow-50 dark:bg-yellow-900/20" />
                  </td>
                  <td className="p-1">
                    <Input type="number" min={0} max={1} step={0.25} value={m.fte || ""} onChange={(e) => updateMember(idx, { ...m, fte: Number(e.target.value) })} className="h-8 text-xs bg-yellow-50 dark:bg-yellow-900/20" />
                  </td>
                  {m.activeSprints.map((active, si) => (
                    <td
                      key={si}
                      className={`p-1 text-center text-xs font-mono cursor-pointer select-none ${
                        si >= sprintCount ? "text-muted-foreground/30" : ""
                      } ${!active ? "line-through text-muted-foreground/40" : ""}`}
                      onClick={() => {
                        const updated = [...m.activeSprints];
                        updated[si] = !updated[si];
                        updateMember(idx, { ...m, activeSprints: updated });
                      }}
                      title={active ? "Click to deactivate sprint" : "Click to activate sprint"}
                    >
                      {active ? fmt(costPerSprint) : "—"}
                    </td>
                  ))}
                  <td className="p-1 text-right text-xs font-mono">{fmt(costPerSprint)}</td>
                  <td className="p-1 text-right text-xs font-mono">{fmt(total)}</td>
                  <td className="p-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeMember(idx)}>
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold text-xs">
              <td colSpan={5} className="p-2">TEAM TOTAL (project budget)</td>
              {sprintTotals.map((v, i) => (
                <td key={i} className="p-2 text-center font-mono">{fmt(v)}</td>
              ))}
              <td className="p-2 text-right font-mono">
                {fmt(sprintTotals.reduce((a, b) => a + b, 0) / Math.max(sprintCount, 1))}
              </td>
              <td className="p-2 text-right font-mono">{fmt(projectedCost)}</td>
              <td></td>
            </tr>
            <tr className="text-xs text-muted-foreground italic">
              <td colSpan={5} className="p-2">enterprise overhead total</td>
              {enterpriseSprintTotals.map((v, i) => (
                <td key={i} className="p-2 text-center font-mono">{fmt(v)}</td>
              ))}
              <td></td>
              <td className="p-2 text-right font-mono">{fmt(enterpriseOverhead)}</td>
              <td></td>
            </tr>
            <tr className="text-xs">
              <td colSpan={5} className="p-2">CUMULATIVE PAYOUT</td>
              {cumulative.map((v, i) => (
                <td key={i} className={`p-2 text-center font-mono ${v > engBudget ? "text-red-500 font-semibold" : ""}`}>
                  {fmt(v)}
                </td>
              ))}
              <td colSpan={2}></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={addMember}>
        <Plus className="h-3 w-3 mr-1" /> Add Team Member
      </Button>

      <Card className="border-dashed">
        <CardContent className="p-4 space-y-2">
          <h4 className="text-sm font-semibold">Budget Check</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Engineering Budget</p>
              <p className="font-mono font-semibold">{fmt(engBudget)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Projected Team Cost</p>
              <p className="font-mono font-semibold">{fmt(projectedCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Shortfall / Pickup</p>
              <p className={`font-mono font-semibold ${engBudget - projectedCost < 0 ? "text-red-500" : "text-green-600"}`}>
                {fmt(engBudget - projectedCost)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceLoadTab({ projects }: { projects: Project[] }) {
  const activeProjects = projects.filter((p) => p.name.trim() !== "");

  const resourceLoad = useMemo(() => {
    const resourceMap = new Map<string, { type: "Engineer" | "PM/QA"; totalHrs: number; totalPay: number; sprintPays: number[] }>();

    activeProjects.forEach((p) => {
      p.team.forEach((m) => {
        const key = m.name.trim().toLowerCase();
        if (!key) return;
        const existing = resourceMap.get(key) ?? {
          type: m.role.toLowerCase().includes("pm") || m.role.toLowerCase().includes("qa") ? "PM/QA" as const : "Engineer" as const,
          totalHrs: 0,
          totalPay: 0,
          sprintPays: Array(MAX_SPRINTS).fill(0),
        };
        existing.totalHrs += m.hrsPerSprint * m.fte;
        existing.totalPay += memberProjectTotal(m);
        m.activeSprints.forEach((active, si) => {
          if (active) existing.sprintPays[si] += m.hrsPerSprint * m.rate * m.fte;
        });
        resourceMap.set(key, existing);
      });
    });

    return Array.from(resourceMap.entries()).map(([name, data]) => {
      const maxHrs = data.type === "Engineer" ? ENG_MAX_HRS : PM_MAX_HRS;
      const warnHrs = data.type === "Engineer" ? ENG_WARNING_HRS : PM_WARNING_HRS;
      const utilization = maxHrs > 0 ? data.totalHrs / maxHrs : 0;
      let status: "ok" | "warning" | "over" = "ok";
      if (data.totalHrs > maxHrs) status = "over";
      else if (data.totalHrs > warnHrs) status = "warning";
      return {
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        ...data,
        maxHrs,
        remaining: maxHrs - data.totalHrs,
        utilization,
        status,
      };
    });
  }, [activeProjects]);

  const portfolioTcv = activeProjects.reduce((s, p) => s + p.tcv, 0);
  const portfolioEngBudget = activeProjects.reduce((s, p) => s + p.tcv * (p.engBudgetPct / 100), 0);
  const portfolioCost = activeProjects.reduce((s, p) =>
    s + p.team.filter((m) => !isEnterpriseOverhead(m.role)).reduce((ts, m) => ts + memberProjectTotal(m), 0), 0);
  const portfolioMargin = portfolioEngBudget > 0 ? (portfolioEngBudget - portfolioCost) / portfolioEngBudget : 0;
  const engineers = resourceLoad.filter((r) => r.type === "Engineer");
  const engCount = engineers.length;
  const avgUtilEng = engCount > 0 ? engineers.reduce((s, r) => s + r.utilization, 0) / engCount : 0;

  const rollingPayrollTotals = useMemo(() =>
    Array.from({ length: MAX_SPRINTS }, (_, i) =>
      resourceLoad.reduce((sum, r) => sum + r.sprintPays[i], 0)
    ), [resourceLoad]);

  const cumulativePayroll = rollingPayrollTotals.reduce<number[]>((acc, v) => {
    acc.push((acc.at(-1) ?? 0) + v);
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Capacity Thresholds</p>
          <div className="text-xs mt-2 space-y-1 text-left">
            <p>Eng Max: {ENG_MAX_HRS}h/wk</p>
            <p>Eng Optimal: {ENG_OPTIMAL_HRS}h/wk</p>
            <p>PM/QA Max: {PM_MAX_HRS}h/wk</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Portfolio TCV</p>
          <p className="text-2xl font-bold">{fmt(portfolioTcv)}</p>
          <p className="text-xs text-muted-foreground">{activeProjects.length} active projects</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Portfolio Margin</p>
          <p className={`text-2xl font-bold ${portfolioMargin < 0 ? "text-red-500" : ""}`}>{pctFmt(portfolioMargin)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Avg Eng Utilization</p>
          <p className="text-2xl font-bold">{pctFmt(avgUtilEng)}</p>
          <p className="text-xs text-muted-foreground">{engCount} engineers</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Project Registry</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground text-left">
                <th className="p-2">Project</th>
                <th className="p-2 text-right">TCV</th>
                <th className="p-2 text-right">Eng Budget</th>
                <th className="p-2 text-right">Team Cost</th>
                <th className="p-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {activeProjects.map((p) => {
                const eb = p.tcv * (p.engBudgetPct / 100);
                const tc = p.team.filter((m) => !isEnterpriseOverhead(m.role)).reduce((s, m) => s + memberProjectTotal(m), 0);
                const mg = eb > 0 ? (eb - tc) / eb : 0;
                return (
                  <tr key={p.id} className="border-b">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 text-right font-mono">{fmt(p.tcv)}</td>
                    <td className="p-2 text-right font-mono">{fmt(eb)}</td>
                    <td className="p-2 text-right font-mono">{fmt(tc)}</td>
                    <td className="p-2 text-right font-mono">{pctFmt(mg)}</td>
                  </tr>
                );
              })}
              {activeProjects.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No projects yet</td></tr>
              )}
            </tbody>
            {activeProjects.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t">
                  <td className="p-2">PORTFOLIO TOTAL ({activeProjects.length})</td>
                  <td className="p-2 text-right font-mono">{fmt(portfolioTcv)}</td>
                  <td className="p-2 text-right font-mono">{fmt(portfolioEngBudget)}</td>
                  <td className="p-2 text-right font-mono">{fmt(portfolioCost)}</td>
                  <td className="p-2 text-right font-mono">{pctFmt(portfolioMargin)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Resource Load</CardTitle></CardHeader>
        <CardContent>
          {resourceLoad.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Resources auto-populate from project team members. Add a project and fill in names.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground text-left">
                  <th className="p-2">Resource</th>
                  <th className="p-2">Type</th>
                  <th className="p-2 text-right">Hrs/Wk (all projects)</th>
                  <th className="p-2 text-right">Max</th>
                  <th className="p-2 text-right">Remaining</th>
                  <th className="p-2 text-right">Utilization</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resourceLoad.map((r) => (
                  <tr key={r.name} className="border-b">
                    <td className="p-2">{r.displayName}</td>
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 text-right font-mono">{r.totalHrs.toFixed(1)}</td>
                    <td className="p-2 text-right font-mono">{r.maxHrs}</td>
                    <td className="p-2 text-right font-mono">{r.remaining.toFixed(1)}</td>
                    <td className="p-2 text-right font-mono">{pctFmt(r.utilization)}</td>
                    <td className="p-2">
                      {r.status === "ok" && <Badge className="bg-green-600 text-white text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>}
                      {r.status === "warning" && <Badge className="bg-yellow-500 text-black text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Warning</Badge>}
                      {r.status === "over" && <Badge className="bg-red-500 text-white text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Over</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {resourceLoad.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rolling Payroll — per sprint, all projects</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="p-2">Resource</th>
                    <th className="p-2">Type</th>
                    {Array.from({ length: MAX_SPRINTS }, (_, i) => (
                      <th key={i} className="p-2 text-center">S{i + 1}</th>
                    ))}
                    <th className="p-2 text-right">Sprint Avg</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {resourceLoad.map((r) => {
                    const activeSprints = r.sprintPays.filter((v) => v > 0).length;
                    const avg = activeSprints > 0 ? r.totalPay / activeSprints : 0;
                    return (
                      <tr key={r.name} className="border-b">
                        <td className="p-2">{r.displayName}</td>
                        <td className="p-2">{r.type}</td>
                        {r.sprintPays.map((v, i) => (
                          <td key={i} className="p-2 text-center font-mono text-xs">{fmt(v)}</td>
                        ))}
                        <td className="p-2 text-right font-mono text-xs">{fmt(avg)}</td>
                        <td className="p-2 text-right font-mono text-xs">{fmt(r.totalPay)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold text-xs">
                    <td colSpan={2} className="p-2">TOTAL PAYROLL</td>
                    {rollingPayrollTotals.map((v, i) => (
                      <td key={i} className="p-2 text-center font-mono">{fmt(v)}</td>
                    ))}
                    <td></td>
                    <td className="p-2 text-right font-mono">{fmt(resourceLoad.reduce((s, r) => s + r.totalPay, 0))}</td>
                  </tr>
                  <tr className="text-xs">
                    <td colSpan={2} className="p-2">CUMULATIVE PAYROLL</td>
                    {cumulativePayroll.map((v, i) => (
                      <td key={i} className="p-2 text-center font-mono">{fmt(v)}</td>
                    ))}
                    <td colSpan={2}></td>
                  </tr>
                  <tr className="text-xs">
                    <td colSpan={2} className="p-2">BUDGET REMAINING</td>
                    {cumulativePayroll.map((v, i) => (
                      <td key={i} className={`p-2 text-center font-mono ${portfolioEngBudget - v < 0 ? "text-red-500 font-semibold" : ""}`}>
                        {fmt(portfolioEngBudget - v)}
                      </td>
                    ))}
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold mb-2">Delivery Economics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Total Eng Budget</p>
              <p className="font-mono font-semibold">{fmt(portfolioEngBudget)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Projected Cost</p>
              <p className="font-mono font-semibold">{fmt(portfolioCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Revenue / Engineer</p>
              <p className="font-mono font-semibold">{engCount > 0 ? fmt(portfolioTcv / engCount) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Budget Remaining</p>
              <p className={`font-mono font-semibold ${portfolioEngBudget - portfolioCost < 0 ? "text-red-500" : "text-green-600"}`}>
                {fmt(portfolioEngBudget - portfolioCost)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DeliveryTools() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState("load");

  function addProject() {
    setProjects([...projects, emptyProject()]);
    setActiveTab(`project-${projects.length}`);
  }

  function updateProject(idx: number, p: Project) {
    const updated = [...projects];
    updated[idx] = p;
    setProjects(updated);
  }

  function removeProject(idx: number) {
    setProjects(projects.filter((_, i) => i !== idx));
    setActiveTab("load");
  }

  function duplicateProject(idx: number) {
    const source = projects[idx];
    const copy: Project = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
    };
    setProjects([...projects, copy]);
    setActiveTab(`project-${projects.length}`);
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Delivery Tools</h1>
          <p className="text-sm text-muted-foreground">
            Sprint budget planner and resource load aggregator
          </p>
        </div>
        <Button onClick={addProject} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Project
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="load" className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" /> Resource Load
          </TabsTrigger>
          {projects.map((p, i) => (
            <TabsTrigger key={p.id} value={`project-${i}`} className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> {p.name || `Project ${i + 1}`}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="load">
          <ResourceLoadTab projects={projects} />
        </TabsContent>

        {projects.map((p, i) => (
          <TabsContent key={p.id} value={`project-${i}`}>
            <ProjectTab
              project={p}
              onChange={(updated) => updateProject(i, updated)}
              onRemove={() => removeProject(i)}
              onDuplicate={() => duplicateProject(i)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
