import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DollarSign,
    Save,
    Loader2,
    Printer,
    TrendingUp,
    Target,
    PieChart,
    Heart,
    Briefcase,
} from "lucide-react";
import {
    getCompPlan,
    createCompPlan,
    updateCompPlan,
    type CompPlan,
} from "@/api/hiring/comp-plan";

interface CompPlanEditorProps {
    candidateId: string;
    candidateName: string;
}

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "CAD", "AUD"];

function formatCurrency(amount: number, currency: string = "USD"): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

function calcTotals(data: Partial<CompPlan>) {
    const baseSalary = data.baseSalary ?? 0;
    const baseFreq = data.baseFrequency ?? "annually";
    const baseAnnual = baseFreq === "annually" ? baseSalary : baseSalary * 12;

    const varType = data.variableType ?? "percentage";
    const varAmt = data.variableAmount ?? 0;
    const varFreq = data.variableFrequency ?? "annually";
    const variableAnnual =
        varType === "percentage"
            ? baseAnnual * (varAmt / 100)
            : varFreq === "annually"
                ? varAmt
                : varFreq === "quarterly"
                    ? varAmt * 4
                    : varAmt * 12;

    const mboAmt = data.mboTargetAmount ?? 0;
    const mboFreq = data.mboFrequency ?? "annually";
    const mboAnnual =
        mboFreq === "annually" ? mboAmt : mboFreq === "quarterly" ? mboAmt * 4 : mboAmt * 12;

    const totalAnnualComp = baseAnnual + variableAnnual + mboAnnual;
    const totalMonthlyComp = totalAnnualComp / 12;
    const equityValue = (data.equityShares ?? 0) * (data.equityStrikePrice ?? 0);
    const totalPackageValue = totalAnnualComp + equityValue;

    return { totalAnnualComp, totalMonthlyComp, totalPackageValue, baseAnnual, variableAnnual, mboAnnual };
}

export default function CompPlanEditor({ candidateId, candidateName }: CompPlanEditorProps) {
    const [plan, setPlan] = useState<Partial<CompPlan>>({
        candidateName,
        baseSalary: 0,
        baseCurrency: "USD",
        baseFrequency: "annually",
        variableType: "percentage",
        variableAmount: 0,
        variableFrequency: "annually",
        variableDescription: "",
        mboTargetAmount: 0,
        mboFrequency: "annually",
        mboDescription: "",
        equityShares: 0,
        equityType: "stock_options",
        equityVestingMonths: 48,
        equityCliffMonths: 12,
        equityStrikePrice: 0,
        profitsInterestPercent: 0,
        profitsInterestVestingMonths: 48,
        profitsInterestCliffMonths: 12,
        healthBenefits: false,
        healthEmployerContribution: 0,
        ptoDays: 15,
        otherBenefits: "",
        jobTitle: "",
        department: "",
        startDate: null,
        countryCode: "US",
        notes: "",
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isNew, setIsNew] = useState(true);
    const printRef = useRef<HTMLDivElement>(null);

    const loadPlan = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getCompPlan(candidateId);
            if (res.data) {
                setPlan(res.data);
                setIsNew(false);
            }
        } catch {
            // No plan yet — that's fine
        } finally {
            setLoading(false);
        }
    }, [candidateId]);

    useEffect(() => { loadPlan(); }, [loadPlan]);

    const handleSave = async () => {
        setSaving(true);
        try {
            if (isNew) {
                const res = await createCompPlan(candidateId, plan);
                if (res.data) {
                    setPlan(res.data);
                    setIsNew(false);
                }
            } else {
                const res = await updateCompPlan(candidateId, plan);
                if (res.data) setPlan(res.data);
            }
        } catch (error) {
            console.error("Error saving comp plan:", error);
            alert("Failed to save comp plan");
        } finally {
            setSaving(false);
        }
    };

    const handlePrint = () => {
        const printContent = printRef.current;
        if (!printContent) return;
        const win = window.open("", "_blank");
        if (!win) return;
        const totals = calcTotals(plan);
        win.document.write(`<!DOCTYPE html><html><head><title>Comp Plan - ${plan.candidateName || candidateName}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#1a1a1a}
h1{font-size:24px;margin-bottom:4px}h2{font-size:18px;color:#555;margin-top:32px;border-bottom:2px solid #e5e5e5;padding-bottom:8px}
.subtitle{color:#666;font-size:14px;margin-bottom:32px}
.summary{background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.summary-item{text-align:center}.summary-label{font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px}
.summary-value{font-size:24px;font-weight:700;color:#1a1a1a;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:8px 12px;border-bottom:1px solid #eee}
td:first-child{color:#666;width:40%}td:last-child{font-weight:600;text-align:right}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #ddd;font-size:12px;color:#999;text-align:center}
@media print{body{padding:20px}.summary{break-inside:avoid}}
</style></head><body>
<h1>Compensation Plan</h1>
<p class="subtitle">${plan.candidateName || candidateName} · ${plan.jobTitle || "Position TBD"} · ${plan.department || ""}</p>
<div class="summary">
<div class="summary-item"><div class="summary-label">Annual Compensation</div><div class="summary-value">${formatCurrency(totals.totalAnnualComp, plan.baseCurrency)}</div></div>
<div class="summary-item"><div class="summary-label">Monthly</div><div class="summary-value">${formatCurrency(totals.totalMonthlyComp, plan.baseCurrency)}</div></div>
<div class="summary-item"><div class="summary-label">Total Package</div><div class="summary-value">${formatCurrency(totals.totalPackageValue, plan.baseCurrency)}</div></div>
</div>
<h2>Base Salary</h2><table><tr><td>Annual Base</td><td>${formatCurrency(totals.baseAnnual, plan.baseCurrency)}</td></tr><tr><td>Pay Frequency</td><td>${plan.baseFrequency}</td></tr></table>
${(plan.variableAmount ?? 0) > 0 ? `<h2>Variable / Commissions</h2><table><tr><td>Type</td><td>${plan.variableType === "percentage" ? `${plan.variableAmount}% of base` : formatCurrency(plan.variableAmount ?? 0, plan.baseCurrency)}</td></tr><tr><td>Annual Value</td><td>${formatCurrency(totals.variableAnnual, plan.baseCurrency)}</td></tr><tr><td>Frequency</td><td>${plan.variableFrequency}</td></tr>${plan.variableDescription ? `<tr><td>Details</td><td>${plan.variableDescription}</td></tr>` : ""}</table>` : ""}
${(plan.mboTargetAmount ?? 0) > 0 ? `<h2>MBOs / Goals</h2><table><tr><td>Target</td><td>${formatCurrency(plan.mboTargetAmount ?? 0, plan.baseCurrency)} ${plan.mboFrequency}</td></tr><tr><td>Annual Value</td><td>${formatCurrency(totals.mboAnnual, plan.baseCurrency)}</td></tr>${plan.mboDescription ? `<tr><td>Goals</td><td>${plan.mboDescription}</td></tr>` : ""}</table>` : ""}
${(plan.equityShares ?? 0) > 0 ? `<h2>Equity</h2><table><tr><td>Shares</td><td>${plan.equityShares} ${plan.equityType === "stock_options" ? "stock options" : "RSUs"}</td></tr><tr><td>Strike Price</td><td>${formatCurrency(plan.equityStrikePrice ?? 0, plan.baseCurrency)}</td></tr><tr><td>Vesting</td><td>${plan.equityVestingMonths} months with ${plan.equityCliffMonths}-month cliff</td></tr></table>` : ""}
${(plan.profitsInterestPercent ?? 0) > 0 ? `<h2>Profits Interest</h2><table><tr><td>Percentage</td><td>${plan.profitsInterestPercent}%</td></tr><tr><td>Vesting</td><td>${plan.profitsInterestVestingMonths} months with ${plan.profitsInterestCliffMonths}-month cliff</td></tr></table>` : ""}
<h2>Benefits</h2><table><tr><td>Health Benefits</td><td>${plan.healthBenefits ? "Yes" : "No"}</td></tr>${plan.healthBenefits ? `<tr><td>Employer Contribution</td><td>${formatCurrency(plan.healthEmployerContribution ?? 0, plan.baseCurrency)}/mo</td></tr>` : ""}<tr><td>PTO</td><td>${plan.ptoDays} days/year</td></tr>${plan.otherBenefits ? `<tr><td>Other</td><td>${plan.otherBenefits}</td></tr>` : ""}</table>
${plan.notes ? `<h2>Notes</h2><p>${plan.notes}</p>` : ""}
<div class="footer">enterprise · Compensation Plan · Generated ${new Date().toLocaleDateString()}</div>
</body></html>`);
        win.document.close();
        win.print();
    };

    const update = (field: string, value: unknown) => {
        setPlan((prev) => ({ ...prev, [field]: value }));
    };

    const numField = (label: string, field: string, prefix?: string, suffix?: string) => (
        <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
            <div className="flex items-center gap-1">
                {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
                <input
                    type="number"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={(plan as Record<string, unknown>)[field] as number ?? 0}
                    onChange={(e) => update(field, parseFloat(e.target.value) || 0)}
                />
                {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
            </div>
        </div>
    );

    const textField = (label: string, field: string, placeholder?: string) => (
        <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
            <input
                type="text"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                placeholder={placeholder}
                value={((plan as Record<string, unknown>)[field] as string) ?? ""}
                onChange={(e) => update(field, e.target.value)}
            />
        </div>
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const totals = calcTotals(plan);

    return (
        <div ref={printRef}>
            {/* Summary Bar */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Annual</div>
                    <div className="text-lg font-bold text-green-700 dark:text-green-400">
                        {formatCurrency(totals.totalAnnualComp, plan.baseCurrency)}
                    </div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Monthly</div>
                    <div className="text-lg font-bold text-blue-700 dark:text-blue-400">
                        {formatCurrency(totals.totalMonthlyComp, plan.baseCurrency)}
                    </div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Package</div>
                    <div className="text-lg font-bold text-purple-700 dark:text-purple-400">
                        {formatCurrency(totals.totalPackageValue, plan.baseCurrency)}
                    </div>
                </div>
            </div>

            {/* Context Fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {textField("Job Title", "jobTitle", "e.g. Senior Cloud Architect")}
                {textField("Department", "department", "e.g. Engineering")}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Start Date</label>
                    <input
                        type="date"
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        value={(plan.startDate as string) ?? ""}
                        onChange={(e) => update("startDate", e.target.value)}
                    />
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Country</label>
                    <Select value={(plan as Record<string, unknown>).countryCode as string ?? "US"} onValueChange={(v) => update("countryCode", v)}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="US">United States</SelectItem>
                            <SelectItem value="IN">India</SelectItem>
                            <SelectItem value="GB">United Kingdom</SelectItem>
                            <SelectItem value="CA">Canada</SelectItem>
                            <SelectItem value="AU">Australia</SelectItem>
                            <SelectItem value="DE">Germany</SelectItem>
                            <SelectItem value="FR">France</SelectItem>
                            <SelectItem value="BR">Brazil</SelectItem>
                            <SelectItem value="MX">Mexico</SelectItem>
                            <SelectItem value="PH">Philippines</SelectItem>
                            <SelectItem value="PK">Pakistan</SelectItem>
                            <SelectItem value="NG">Nigeria</SelectItem>
                            <SelectItem value="CO">Colombia</SelectItem>
                            <SelectItem value="AR">Argentina</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Block 1: Base Salary */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <DollarSign className="w-4 h-4" /> Base Salary
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-3 gap-3">
                        {numField("Amount", "baseSalary", "$")}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Currency</label>
                            <Select value={plan.baseCurrency ?? "USD"} onValueChange={(v) => update("baseCurrency", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Frequency</label>
                            <Select value={plan.baseFrequency ?? "annually"} onValueChange={(v) => update("baseFrequency", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="annually">Annually</SelectItem>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Block 2: Variable */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> Variable / Commissions
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-3 gap-3 mb-2">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                            <Select value={plan.variableType ?? "percentage"} onValueChange={(v) => update("variableType", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="percentage">% of Base</SelectItem>
                                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {numField("Amount", "variableAmount", plan.variableType === "percentage" ? "%" : "$")}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Frequency</label>
                            <Select value={plan.variableFrequency ?? "annually"} onValueChange={(v) => update("variableFrequency", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                    <SelectItem value="quarterly">Quarterly</SelectItem>
                                    <SelectItem value="annually">Annually</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {textField("Description", "variableDescription", "Commission structure details...")}
                </CardContent>
            </Card>

            {/* Block 3: MBOs */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="w-4 h-4" /> MBOs / Goals
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        {numField("Target Amount", "mboTargetAmount", "$")}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Frequency</label>
                            <Select value={plan.mboFrequency ?? "annually"} onValueChange={(v) => update("mboFrequency", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="monthly">Monthly</SelectItem>
                                    <SelectItem value="quarterly">Quarterly</SelectItem>
                                    <SelectItem value="annually">Annually</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {textField("Goals Description", "mboDescription", "Key objectives and targets...")}
                </CardContent>
            </Card>

            {/* Block 4: Equity */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <PieChart className="w-4 h-4" /> Equity
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        {numField("Shares / Units", "equityShares")}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                            <Select value={plan.equityType ?? "stock_options"} onValueChange={(v) => update("equityType", v)}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stock_options">Stock Options</SelectItem>
                                    <SelectItem value="rsu">RSUs</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        {numField("Strike Price", "equityStrikePrice", "$")}
                        {numField("Vesting (months)", "equityVestingMonths")}
                        {numField("Cliff (months)", "equityCliffMonths")}
                    </div>
                </CardContent>
            </Card>

            {/* Block 5: Profits Interest */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Briefcase className="w-4 h-4" /> Profits Interest
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-3 gap-3">
                        {numField("Percentage", "profitsInterestPercent", "%")}
                        {numField("Vesting (months)", "profitsInterestVestingMonths")}
                        {numField("Cliff (months)", "profitsInterestCliffMonths")}
                    </div>
                </CardContent>
            </Card>

            {/* Block 6: Benefits */}
            <Card className="shadow-none mb-3">
                <CardHeader className="py-2 px-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Heart className="w-4 h-4" /> Benefits
                    </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                    <div className="grid grid-cols-3 gap-3 mb-2">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1 block">Health Benefits</label>
                            <Select
                                value={plan.healthBenefits ? "yes" : "no"}
                                onValueChange={(v) => update("healthBenefits", v === "yes")}
                            >
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {numField("Employer Contribution /mo", "healthEmployerContribution", "$")}
                        {numField("PTO Days / Year", "ptoDays")}
                    </div>
                    {textField("Other Benefits", "otherBenefits", "Equipment stipend, learning budget, etc.")}
                </CardContent>
            </Card>

            {/* Notes */}
            <div className="mb-4">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
                <textarea
                    className="w-full min-h-[60px] rounded-md border border-input bg-background px-2 py-1.5 text-sm resize-y"
                    placeholder="Additional notes about this comp plan..."
                    value={plan.notes ?? ""}
                    onChange={(e) => update("notes", e.target.value)}
                />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving} size="sm">
                    {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    {isNew ? "Create Plan" : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={handlePrint} size="sm" disabled={isNew}>
                    <Printer className="w-4 h-4 mr-1" /> Print / PDF
                </Button>
                {!isNew && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                        {plan.status ?? "draft"}
                    </Badge>
                )}
            </div>
        </div>
    );
}
