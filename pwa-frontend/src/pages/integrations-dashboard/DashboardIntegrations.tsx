import "@/lib/ag-grid-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
	deleteIntegration,
	listIntegrations,
	triggerManualSync,
	getSyncHistory,
	testIntegration,
} from "@/api/integrations";
import Loader from "@/components/Loader";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { Edit, Loader2, Trash, WifiSync, CheckCircle2, XCircle, ArrowRight, Globe, Key, Check, X, FolderOpen, Users, Play, AlertCircle } from "lucide-react";
import { useCallback, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes-config";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import toast from "react-hot-toast";

type SyncStage = "started" | "in_progress" | "completed" | "failed";

interface SyncState {
	stage: SyncStage;
	startedAt: number;
}

export default function DashboardIntegrations() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { canWrite } = useWriteAccess();
	const [syncingMap, setSyncingMap] = useState<Record<string, SyncState>>({});
	const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

	const [testingMap, setTestingMap] = useState<Record<string, boolean>>({});
	const [testResults, setTestResults] = useState<Record<string, {
		success: boolean;
		checks: Record<string, boolean>;
		samples?: Record<string, unknown>;
		errors?: Record<string, string>;
		error: string | null;
	}>>({});
	const [resultDialogType, setResultDialogType] = useState<string | null>(null);

	const handleTestIntegration = async (type: string, openDialog = false) => {
		setTestingMap(prev => ({ ...prev, [type]: true }));
		try {
			const res = await testIntegration(type);
			const data = res?.data || res;
			setTestResults(prev => ({ ...prev, [type]: data }));
			if (data.success) {
				toast.success(`${type.toUpperCase()} connection test passed!`);
			} else {
				toast.error(`${type.toUpperCase()} test failed: ${data.error || "Unknown error"}`);
			}
			if (openDialog) setResultDialogType(type);
		} catch (err: any) {
			const errMsg = err.response?.data?.error || err.message || "An unexpected error occurred";
			setTestResults(prev => ({
				...prev,
				[type]: {
					success: false,
					checks: {},
					error: errMsg,
				}
			}));
			toast.error(`${type.toUpperCase()} test failed: ${errMsg}`);
			if (openDialog) setResultDialogType(type);
		} finally {
			setTestingMap(prev => ({ ...prev, [type]: false }));
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
		}
	};

	const { data, isLoading } = useQuery({
		queryKey: ["integrations"],
		queryFn: listIntegrations,
	});

	const { mutate: delIntegration } = useMutation({
		mutationFn: deleteIntegration,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
		},
	});

	const { mutate: triggerSync } = useMutation({
		mutationFn: triggerManualSync,
	});

	// Helpers to update a single integration's sync state
	const setSyncState = useCallback(
		(id: string, update: Partial<SyncState> | null) => {
			setSyncingMap((prev) => {
				if (update === null) {
					const { [id]: _, ...rest } = prev;
					return rest;
				}
				return { ...prev, [id]: { ...prev[id], ...update } as SyncState };
			});
		},
		[],
	);

	const stopPolling = useCallback((id: string) => {
		if (pollTimers.current[id]) {
			clearInterval(pollTimers.current[id]);
			delete pollTimers.current[id];
		}
	}, []);

	// Poll sync history to detect completion
	const startPolling = useCallback(
		(integration: Integration) => {
			const id = integration.integration_id;
			const maxPollTime = 5 * 60 * 1000; // 5 min timeout
			const startTime = Date.now();

			pollTimers.current[id] = setInterval(async () => {
				try {
					// Timeout guard
					if (Date.now() - startTime > maxPollTime) {
						stopPolling(id);
						setSyncState(id, { stage: "failed" });
						setTimeout(() => setSyncState(id, null), 5000);
						queryClient.invalidateQueries({ queryKey: ["integrations"] });
						return;
					}

					const historyRes = await getSyncHistory(id, { limit: 1 });
					const latestSync = historyRes?.data?.items?.[0];

					if (!latestSync) return;

					const syncStatus = latestSync.status?.toLowerCase();

					if (syncStatus === "completed" || syncStatus === "success" || syncStatus === "succeeded") {
						stopPolling(id);
						setSyncState(id, { stage: "completed" });
						queryClient.invalidateQueries({ queryKey: ["integrations"] });
						setTimeout(() => setSyncState(id, null), 5000);
					} else if (syncStatus === "failed" || syncStatus === "error") {
						stopPolling(id);
						setSyncState(id, { stage: "failed" });
						queryClient.invalidateQueries({ queryKey: ["integrations"] });
						setTimeout(() => setSyncState(id, null), 5000);
					} else {
						// Still in progress
						setSyncState(id, { stage: "in_progress" });
					}
				} catch {
					// Silently retry on network blips
				}
			}, 5000);
		},
		[stopPolling, setSyncState, queryClient],
	);

	const triggerSyncAndRefresh = useCallback(
		(integration: Integration) => {
			const id = integration.integration_id;

			// Prevent double-sync
			if (syncingMap[id]) return;

			// Phase 1: Started
			setSyncState(id, {
				stage: "started",
				startedAt: Date.now(),
			});

			triggerSync(
				{
					integrationType: integration.integration_type,
					integrationId: id,
				},
				{
					onSuccess: () => {
						// Phase 2: In Progress
						setSyncState(id, { stage: "in_progress" });
						startPolling(integration);
					},
					onError: () => {
						setSyncState(id, { stage: "failed" });
						setTimeout(() => setSyncState(id, null), 5000);
					},
				},
			);
		},
		[syncingMap, setSyncState, triggerSync, startPolling],
	);

	const [selectedIntegration, setSelectedIntegration] = useState<
		Partial<Integration>
	>({});
	const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);

	const items = data?.data?.items ?? [];
	const googleIntegration = items.find((i: any) => i.integration_type === "google");

	const renderGoogleCheck = (checkKey: "auth" | "drive" | "directory") => {
		const result = testResults["google"];

		if (!result) {
			if (!googleIntegration) {
				return (
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 font-medium italic">
						<span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block shrink-0" />
						Not tested yet
					</div>
				);
			}
			return googleIntegration.status === "active" ? (
				<div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-semibold">
					<CheckCircle2 className="w-3.5 h-3.5" /> Configured
				</div>
			) : (
				<div className="flex items-center gap-1.5 text-xs text-red-500 font-semibold">
					<XCircle className="w-3.5 h-3.5" /> Last test failed
				</div>
			);
		}

		if (result.checks[checkKey]) {
			const sample = (result.samples?.[checkKey] || {}) as Record<string, unknown>;
			const entries = Object.entries(sample).filter(([, v]) => v !== undefined && v !== null && v !== "");
			return (
				<div className="flex flex-col gap-2 w-full">
					<div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-semibold">
						<CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Passed
					</div>
					{entries.length > 0 && (
						<div className="bg-green-500/5 border border-green-500/15 rounded-lg px-2.5 py-2 space-y-1">
							{entries.map(([k, v]) => (
								<div key={k} className="flex gap-1.5 text-[10.5px] leading-snug">
									<span className="text-muted-foreground/70 font-medium shrink-0 capitalize">{k}:</span>
									<span className="text-foreground/80 truncate" title={String(v)}>{String(v)}</span>
								</div>
							))}
						</div>
					)}
				</div>
			);
		}

		const errMsg = result.errors?.[checkKey];
		const sample = (result.samples?.[checkKey] || {}) as Record<string, unknown>;
		const entries = Object.entries(sample).filter(([, v]) => v !== undefined && v !== null && v !== "");
		return (
			<div className="flex flex-col gap-2 w-full">
				<div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 font-semibold">
					<XCircle className="w-3.5 h-3.5 shrink-0" /> Failed
				</div>
				{entries.length > 0 && (
					<div className="bg-red-500/5 border border-red-500/15 rounded-lg px-2.5 py-2 space-y-1">
						{entries.map(([k, v]) => (
							<div key={k} className="flex gap-1.5 text-[10.5px] leading-snug">
								<span className="text-muted-foreground/70 font-medium shrink-0 capitalize">{k}:</span>
								<span className="text-foreground/80 truncate" title={String(v)}>{String(v)}</span>
							</div>
						))}
					</div>
				)}
				{errMsg && (
					<div className="bg-red-500/8 border border-red-500/20 rounded-lg px-2.5 py-2">
						<p className="text-[10.5px] text-red-600 dark:text-red-400 leading-relaxed">{errMsg}</p>
					</div>
				)}
			</div>
		);
	};

	// Render sync stage badge
	const renderSyncStage = (integrationId: string, serverStatus: string) => {
		const sync = syncingMap[integrationId];
		if (!sync) {
			return <Badge variant="secondary">{serverStatus}</Badge>;
		}
		switch (sync.stage) {
			case "started":
				return (
					<Badge className="bg-blue-500 text-white animate-pulse gap-1">
						<ArrowRight className="w-3 h-3" /> Started
					</Badge>
				);
			case "in_progress":
				return (
					<Badge className="bg-yellow-500 text-white animate-pulse gap-1">
						<Loader2 className="w-3 h-3 animate-spin" /> In Progress
					</Badge>
				);
			case "completed":
				return (
					<Badge className="bg-green-600 text-white gap-1">
						<CheckCircle2 className="w-3 h-3" /> Completed
					</Badge>
				);
			case "failed":
				return (
					<Badge className="bg-red-600 text-white gap-1">
						<XCircle className="w-3 h-3" /> Failed
					</Badge>
				);
			default:
				return <Badge variant="secondary">{serverStatus}</Badge>;
		}
	};

	const columnDefs: ColDef[] = [
		{
			headerName: "Name",
			field: "display_name",
			flex: 1,
			cellRenderer: ({
				value,
				data,
			}: {
				value: string;
				data: Partial<Integration>;
			}) => (
				<Button
					variant="link"
					className="text-yellow-600 font-bold"
					onClick={() =>
						navigate(
							`${ROUTES.APP.INTEGRATIONS_SYNC_HISTORY.path}?id=${data.integration_id}`,
						)
					}
				>
					{value || "-"}
				</Button>
			),
		},
		{ headerName: "Type", field: "integration_type", width: 140 },
		{
			headerName: "Status",
			field: "status",
			width: 160,
			cellRenderer: ({ value, data }: { value: string; data: Partial<Integration> }) =>
				renderSyncStage(data.integration_id || "", value),
		},
		{
			headerName: "Enabled",
			field: "enabled",
			width: 120,
			cellRenderer: ({ value }: { value: boolean }) =>
				value ? (
					<Badge className="bg-green-700 text-white">Yes</Badge>
				) : (
					<Badge variant="outline">No</Badge>
				),
		},
		{
			headerName: "Auth",
			field: "auth_status",
			width: 120,
			cellRenderer: ({ value }: { value: string }) =>
				value ? (
					<Badge className="bg-green-500 text-white">Authorized</Badge>
				) : (
					<Badge className="bg-primary ">Pending</Badge>
				),
		},
		{
			headerName: "Last Sync",
			field: "last_sync_at",
			flex: 1,
			valueFormatter: ({ value }) =>
				value ? new Date(value).toLocaleString() : "—",
		},
		{
			headerName: "Actions",
			field: "id",
			width: 180,
			cellRenderer: ({ data }: { data: Partial<Integration> }) => {
				const isSyncing = !!syncingMap[data.integration_id || ""];
				const isTesting = !!testingMap[data.integration_type || ""];
				const canTest = ["google", "deel", "linear", "hubspot"].includes(data.integration_type || "");

				return (
					<div className="flex items-center justify-center gap-1">
						<Button
							variant="link"
							title={isSyncing ? "Sync in progress…" : "Trigger Sync"}
							disabled={!data.enabled || isSyncing}
							className="text-green-600 font-bold hover:scale-125 disabled:text-gray-600 p-1"
							onClick={() => {
								triggerSyncAndRefresh(data as Integration);
							}}
						>
							{isSyncing ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<WifiSync className="w-4 h-4" />
							)}
						</Button>

						{canTest && (
							<Button
								variant="link"
								title={isTesting ? "Testing connection…" : "Test Connection"}
								disabled={!data.enabled || isTesting}
								className="text-yellow-600 font-bold hover:scale-125 disabled:text-gray-600 p-1"
								onClick={() => {
									const type = data.integration_type || "";
									handleTestIntegration(type, type !== "google");
								}}
							>
								{isTesting ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : (
									<Play className="w-4 h-4" />
								)}
							</Button>
						)}

						<Button
							variant="link"
							title="Edit Integration"
							className="text-yellow-600 font-bold hover:scale-125 p-1"
							onClick={() => {
								navigate(
									`${ROUTES.APP.EDIT_INTEGRATION.path}?id=${data.integration_id}`,
								);
							}}
						>
							<Edit className="w-4 h-4" />
						</Button>

						<Button
							variant="link"
							title="Delete Integration"
							className="text-red-600 font-bold hover:scale-125 p-1"
							onClick={() => {
								setShowConfirmationDialog(true);
								setSelectedIntegration(data);
							}}
						>
							<Trash className="w-4 h-4" />
						</Button>
					</div>
				);
			},
		},
	];
	
	const finalColumnDefs = useMemo(() => {
		if (canWrite) return columnDefs;
		return columnDefs.filter(col => col.headerName !== "Actions");
	}, [canWrite, columnDefs]);

	const onDeleteIntegration = (integrationId: string = "") => {
		delIntegration(integrationId);
		setShowConfirmationDialog(false);
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Loader description="Loading Integrations..." />
			</div>
		);
	}

	return (
		<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
			{/* Header */}
			<div className="mb-8">
				<h1 className="text-3xl md:text-4xl font-bold mb-1 text-foreground">
					Integrations
				</h1>
				<p className="text-base text-muted-foreground">
					Manage all external integrations in one place
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Total Integrations</CardDescription>
						<CardTitle className="text-5xl font-extrabold">
							{items.length}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Enabled</CardDescription>
						<CardTitle className="text-5xl font-extrabold">
							{items.filter((i: Partial<Integration>) => i.enabled).length}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Disabled</CardDescription>
						<CardTitle className="text-5xl font-extrabold">
							{items.filter((i: Partial<Integration>) => !i.enabled).length}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{/* Google Workspace Integration Card */}
			<Card className="shadow-sm border border-border bg-card mb-8 overflow-hidden">
				<CardHeader className="bg-muted/30 border-b border-border pb-4">
					<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
						<div>
							<CardTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
								<span className="p-1.5 bg-yellow-500/10 rounded-lg text-yellow-600 dark:text-yellow-400">
									<Globe className="w-5 h-5" />
								</span>
								Google Workspace Integration
							</CardTitle>
							<CardDescription className="text-sm text-muted-foreground mt-1">
								Service Account authentication with Domain-Wide Delegation to manage user directory and drive checks.
							</CardDescription>
						</div>
						<div className="flex items-center gap-3">
							{(googleIntegration || testResults["google"]) && (
								<Badge className={(googleIntegration?.status === "active" || testResults["google"]?.success) ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}>
									{(googleIntegration?.status === "active" || testResults["google"]?.success) ? "Connected" : "Failed"}
								</Badge>
							)}
							<Button
								onClick={() => handleTestIntegration("google")}
								disabled={testingMap["google"]}
								variant="default"
								className="bg-yellow-600 hover:bg-yellow-700 text-white flex items-center gap-2 shadow-sm"
							>
								{testingMap["google"] ? (
									<>
										<Loader2 className="w-4 h-4 animate-spin" />
										Testing Connection...
									</>
								) : (
									<>
										<Play className="w-4 h-4" />
										Test Connection
									</>
								)}
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent className="pt-6 pb-5">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{/* Check 1 — Auth */}
						{(() => { const r = testResults["google"]; const passed = r?.checks["auth"]; const pending = !r; const accent = pending ? "border-border/50" : passed ? "border-green-500/30 bg-green-500/[0.03]" : "border-red-500/30 bg-red-500/[0.03]"; return (
						<div className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-colors ${accent}`}>
							<div className={`p-2 rounded-lg shrink-0 ${!r ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : passed ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"}`}>
								<Key className="w-5 h-5" />
							</div>
							<div className="flex-1 min-w-0">
								<h3 className="font-semibold text-sm text-foreground">Auth & Token Exchange</h3>
								<p className="text-xs text-muted-foreground mt-0.5 mb-3">JWT signed by Directory Service Account with DWD</p>
								{renderGoogleCheck("auth")}
							</div>
						</div> ); })()}

						{/* Check 2 — Drive */}
						{(() => { const r = testResults["google"]; const passed = r?.checks["drive"]; const accent = !r ? "border-border/50" : passed ? "border-green-500/30 bg-green-500/[0.03]" : "border-red-500/30 bg-red-500/[0.03]"; return (
						<div className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-colors ${accent}`}>
							<div className={`p-2 rounded-lg shrink-0 ${!r ? "bg-indigo-500/10 text-indigo-600" : passed ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"}`}>
								<FolderOpen className="w-5 h-5" />
							</div>
							<div className="flex-1 min-w-0">
								<h3 className="font-semibold text-sm text-foreground">Google Drive Access</h3>
								<p className="text-xs text-muted-foreground mt-0.5 mb-3">Read access via Drive Service Account key</p>
								{renderGoogleCheck("drive")}
							</div>
						</div> ); })()}

						{/* Check 3 — Directory */}
						{(() => { const r = testResults["google"]; const passed = r?.checks["directory"]; const accent = !r ? "border-border/50" : passed ? "border-green-500/30 bg-green-500/[0.03]" : "border-red-500/30 bg-red-500/[0.03]"; return (
						<div className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-colors ${accent}`}>
							<div className={`p-2 rounded-lg shrink-0 ${!r ? "bg-purple-500/10 text-purple-600" : passed ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"}`}>
								<Users className="w-5 h-5" />
							</div>
							<div className="flex-1 min-w-0">
								<h3 className="font-semibold text-sm text-foreground">Google Directory (GAM)</h3>
								<p className="text-xs text-muted-foreground mt-0.5 mb-3">Domain identities, groups and user listing</p>
								{renderGoogleCheck("directory")}
							</div>
						</div> ); })()}
					</div>

					{/* Summary banner */}
					{testResults["google"] && (
						<div className={`mt-5 p-4 rounded-xl flex items-start gap-3 border ${
							testResults["google"].success
								? "bg-green-500/8 border-green-500/25"
								: "bg-red-500/8 border-red-500/25"
						}`}>
							{testResults["google"].success
								? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
								: <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
							<div className="min-w-0 flex-1">
								<h4 className={`font-semibold text-sm ${
									testResults["google"].success ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300"
								}`}>
									{testResults["google"].success
										? "All checks passed — Google Workspace is connected."
										: "One or more checks failed — see details below."}
								</h4>
								{!testResults["google"].success && testResults["google"].errors && (
									<ul className="mt-2 space-y-1.5">
										{Object.entries(testResults["google"].errors).map(([k, v]) => (
											<li key={k} className="text-xs text-red-600 dark:text-red-400 flex gap-1.5 leading-snug">
												<span className="font-semibold capitalize shrink-0">{k}:</span>
												<span>{v}</span>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Replaces "Available Integrations" cards */}
			<Card className="shadow-none mb-8 border-none p-0">
				<CardHeader>
					<CardTitle className="text-2xl font-semibold">
						Available Integrations
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="ag-theme-alpine h-[500px] w-full">
						<AgGridReact
							theme="legacy"
							rowData={items}
							columnDefs={finalColumnDefs}
							pagination
							paginationPageSize={20}
							defaultColDef={{
								sortable: true,
								filter: false,
								resizable: true,
							}}
						/>
					</div>
				</CardContent>
			</Card>

			<ConfirmationDialog
				open={showConfirmationDialog}
				title="Delete Integration"
				message={`Are you sure you want to delete ${selectedIntegration?.integration_type} integration?`}
				onConfirm={() => {
					onDeleteIntegration(selectedIntegration?.integration_id);
				}}
				onCancel={() => setShowConfirmationDialog(false)}
			/>

			<TestResultDialog
				type={resultDialogType}
				result={resultDialogType ? testResults[resultDialogType] : undefined}
				onClose={() => setResultDialogType(null)}
			/>
		</div>
	);
}

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Integration } from "@/types/integrations";

type ConfirmationDialogProps = {
	open: boolean;
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => void;
	onCancel: () => void;
};

export function ConfirmationDialog({
	open,
	title,
	message,
	confirmText = "Delete",
	cancelText = "Cancel",
	onConfirm,
	onCancel,
}: ConfirmationDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onCancel}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{message}</AlertDialogDescription>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>{cancelText}</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className="bg-red-600 hover:bg-red-700 text-white"
					>
						{confirmText}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type TestResult = {
	success: boolean;
	checks: Record<string, boolean>;
	samples?: Record<string, unknown>;
	errors?: Record<string, string>;
	error: string | null;
};

function TestResultDialog({
	type,
	result,
	onClose,
}: {
	type: string | null;
	result: TestResult | undefined;
	onClose: () => void;
}) {
	if (!type) return null;
	const open = !!type;
	const displayName = type.charAt(0).toUpperCase() + type.slice(1);
	const checkEntries = Object.entries(result?.checks ?? {});
	const samples = (result?.samples ?? {}) as Record<string, unknown>;

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{result?.success ? (
							<CheckCircle2 className="w-5 h-5 text-green-600" />
						) : (
							<XCircle className="w-5 h-5 text-red-600" />
						)}
						{displayName} Connection Test
					</DialogTitle>
					<DialogDescription>
						{result?.success
							? "All checks passed. Live data sample shown below."
							: "One or more checks failed. See details below."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					{checkEntries.map(([key, passed]) => {
						const sample = (samples[key] || {}) as Record<string, unknown>;
						const sampleEntries = Object.entries(sample).filter(
							([, v]) => v !== undefined && v !== null && v !== "",
						);
						return (
							<div
								key={key}
								className="rounded-lg border border-border p-3 bg-muted/20"
							>
								<div className="flex items-center justify-between">
									<span className="text-sm font-semibold capitalize">{key}</span>
									{passed ? (
										<Badge className="bg-green-600 text-white gap-1">
											<Check className="w-3 h-3" /> Passed
										</Badge>
									) : (
										<Badge className="bg-red-600 text-white gap-1">
											<X className="w-3 h-3" /> Failed
										</Badge>
									)}
								</div>
								{sampleEntries.length > 0 && (
									<div className="mt-2 text-xs text-muted-foreground space-y-0.5">
										{sampleEntries.map(([k, v]) => (
											<div key={k} className="truncate" title={String(v)}>
												<span className="font-medium">{k}:</span> {String(v)}
											</div>
										))}
									</div>
								)}
								{!passed && result?.errors?.[key] && (
									<div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 p-2 rounded leading-normal">
										{result.errors[key]}
									</div>
								)}
							</div>
						);
					})}

					{result?.error && (
						<div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
							<AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
							<p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
								{result.error}
							</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
