import { useState, useEffect, useCallback } from "react";
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
    Send,
    Loader2,
    CheckCircle,
    AlertCircle,
    ExternalLink,
} from "lucide-react";
import { getCompPlan, type CompPlan } from "@/api/hiring/comp-plan";
import { pushToDeel } from "@/api/hiring/comp-plan";

interface DeelPushPanelProps {
    candidateId: string;
    candidateName: string;
    deelEmployeeId: string | null;
    onPushed: () => void;
}

function formatCurrency(amount: number, currency: string = "USD"): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export default function DeelPushPanel({
    candidateId,
    candidateName,
    deelEmployeeId,
    onPushed,
}: DeelPushPanelProps) {
    const [compPlan, setCompPlan] = useState<CompPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [pushing, setPushing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [contractType, setContractType] = useState("contractor");
    const [payScale, setPayScale] = useState("semimonthly");

    const loadCompPlan = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getCompPlan(candidateId);
            setCompPlan(res.data ?? null);
        } catch {
            setCompPlan(null);
        } finally {
            setLoading(false);
        }
    }, [candidateId]);

    useEffect(() => { loadCompPlan(); }, [loadCompPlan]);

    const handlePush = async () => {
        setPushing(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await pushToDeel(candidateId, { contractType, payScale });
            const data = res.data ?? res;
            setSuccess(
                `Contract created: ${data.deelContractId ?? "success"}`,
            );
            onPushed();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to push to Deel";
            setError(msg);
        } finally {
            setPushing(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Already pushed
    if (deelEmployeeId) {
        return (
            <Card className="shadow-none border-green-200 dark:border-green-800">
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                        <div className="flex-1">
                            <div className="text-sm font-medium">Pushed to Deel</div>
                            <div className="text-xs text-muted-foreground">
                                Contract ID: {deelEmployeeId}
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                window.open(
                                    `https://app.deel.com/contracts/${deelEmployeeId}`,
                                    "_blank",
                                )
                            }
                        >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> View in Deel
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // No comp plan
    if (!compPlan) {
        return (
            <Card className="shadow-none border-amber-200 dark:border-amber-800">
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                        <div className="text-sm">
                            No comp plan found. Create a compensation plan first before
                            pushing to Deel.
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-none">
            <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                    <Send className="w-4 h-4" /> Push to Deel
                </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
                {/* Comp Plan Summary */}
                <div className="bg-muted/50 rounded-lg p-3 mb-4 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-muted-foreground">Name:</span>{" "}
                            <span className="font-medium">{candidateName}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Title:</span>{" "}
                            <span className="font-medium">{compPlan.jobTitle || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Base:</span>{" "}
                            <span className="font-medium">
                                {formatCurrency(compPlan.baseSalary, compPlan.baseCurrency)}{" "}
                                {compPlan.baseFrequency}
                            </span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Annual Total:</span>{" "}
                            <span className="font-medium">
                                {formatCurrency(compPlan.totalAnnualComp, compPlan.baseCurrency)}
                            </span>
                        </div>
                        {compPlan.startDate && (
                            <div>
                                <span className="text-muted-foreground">Start:</span>{" "}
                                <span className="font-medium">{compPlan.startDate}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Contract Options */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Contract Type
                        </label>
                        <Select value={contractType} onValueChange={setContractType}>
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="contractor">
                                    Contractor (PAYG)
                                </SelectItem>
                                <SelectItem value="direct_employee">
                                    Direct Employee Payroll
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                            Pay Scale
                        </label>
                        <Select value={payScale} onValueChange={setPayScale}>
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="semimonthly">Semimonthly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="biweekly">Biweekly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Error / Success */}
                {error && (
                    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 p-2 text-xs text-red-700 dark:text-red-300 mb-3">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 p-2 text-xs text-green-700 dark:text-green-300 mb-3">
                        <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {success}
                    </div>
                )}

                {/* Push Button */}
                <Button
                    onClick={handlePush}
                    disabled={pushing}
                    size="sm"
                    className="w-full"
                >
                    {pushing ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                        <Send className="w-4 h-4 mr-1" />
                    )}
                    Create Contract in Deel
                </Button>
            </CardContent>
        </Card>
    );
}
