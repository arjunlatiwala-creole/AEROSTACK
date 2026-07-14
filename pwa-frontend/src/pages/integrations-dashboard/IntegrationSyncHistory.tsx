import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Clock,
	Loader2,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getSyncHistory } from "@/api/integrations";
import { deleteHubspotData } from "@/api/hubspot";
import Loader from "@/components/Loader";
import NoData from "@/components/NoData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ROUTES } from "@/lib/routes-config";

export default function IntegrationSyncHistory() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const integrationId = searchParams.get("id");
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
		refetch,
	} = useInfiniteQuery({
		queryKey: ["sync-history", integrationId],
		queryFn: ({ pageParam }) =>
			getSyncHistory(integrationId, {
				limit: 20,
				nextToken: pageParam,
			}),
		enabled: !!integrationId,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.data.nextToken,
	});

	const { mutate: deleteData, isPending: isDeleting } = useMutation({
		mutationFn: deleteHubspotData,
		onSuccess: () => {
			setShowDeleteConfirm(false);
			refetch();
		},
		onError: (error) => {
			console.error("Failed to delete HubSpot data:", error);
			setShowDeleteConfirm(false);
		},
	});

	const allSyncs = data?.pages.flatMap((page) => page.data.items) ?? [];

	const totalSyncs = allSyncs.length;
	const successfulSyncs = allSyncs.filter(
		(s) => s.status === "succeeded",
	).length;
	const failedSyncs = allSyncs.filter(
		(s) => s.status === "failed" || s.status === "partial_success",
	).length;

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "succeeded":
				return <CheckCircle2 className="h-5 w-5 text-green-600" />;
			case "failed":
				return <XCircle className="h-5 w-5 text-red-600" />;
			case "partial_success":
				return <AlertCircle className="h-5 w-5 text-yellow-600" />;
			default:
				return <Clock className="h-5 w-5 text-gray-600" />;
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "succeeded":
				return "border-l-green-500 bg-green-50/50";
			case "failed":
				return "border-l-red-500 bg-red-50/50";
			case "partial_success":
				return "border-l-yellow-500 bg-yellow-50/50";
			default:
				return "border-l-gray-500 bg-gray-50/50";
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Loader description="Loading Sync History..." />
			</div>
		);
	}

	return (
		<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
			{/* Header */}
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button
						variant="outline"
						size="icon"
						onClick={() => navigate(ROUTES.APP.INTEGRATIONS.path)}
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<div className="flex-1">
						<h1 className="text-3xl md:text-4xl font-bold mb-1 text-foreground">
							Sync History
						</h1>
						<p className="text-base text-muted-foreground">
							Integration ID: {integrationId}
						</p>
					</div>
					<Button variant="outline" size="icon" onClick={() => refetch()}>
						<RefreshCw className="h-4 w-4" />
					</Button>
					{showDeleteConfirm ? (
						<div className="flex items-center gap-2">
							<span className="text-sm text-destructive font-medium">
								Are you sure?
							</span>
							<Button
								variant="destructive"
								size="sm"
								onClick={() => deleteData()}
								disabled={isDeleting}
							>
								{isDeleting ? (
									<Loader2 className="h-4 w-4 animate-spin mr-1" />
								) : null}
								Yes, Delete
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowDeleteConfirm(false)}
								disabled={isDeleting}
							>
								Cancel
							</Button>
						</div>
					) : (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setShowDeleteConfirm(true)}
						>
							<Trash2 className="h-4 w-4 mr-1" />
							Delete Hub. Deals
						</Button>
					)}
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Total Syncs</CardDescription>
						<CardTitle className="text-5xl font-extrabold">
							{totalSyncs}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Successful</CardDescription>
						<CardTitle className="text-5xl font-extrabold text-green-600">
							{successfulSyncs}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Failed</CardDescription>
						<CardTitle className="text-5xl font-extrabold text-red-600">
							{failedSyncs}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{/* Timeline/Activity Feed */}
			<Card className="shadow-none mb-8 border-none p-0">
				<CardHeader>
					<CardTitle className="text-2xl font-semibold">
						Sync Operations Timeline
					</CardTitle>
				</CardHeader>
				<CardContent>
					{allSyncs.length === 0 ? (
						<div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
							<NoData />
							<p className="text-muted-foreground">No sync history found</p>
						</div>
					) : (
						<div className="space-y-4">
							{allSyncs.map((sync, index) => (
								<div
									key={sync.sync_id}
									className={`relative border-l-4 rounded-lg p-6 transition-all hover:shadow-md cursor-pointer ${getStatusColor(sync.status)}`}
									onClick={() =>
										navigate(
											`${ROUTES.APP.INTEGRATIONS_SYNC_DETAILS.path}?syncId=${sync.sync_id}`,
										)
									}
								>
									{/* Timeline connector */}
									{index < allSyncs.length - 1 && (
										<div className="absolute left-0 top-full h-4 w-0.5 bg-gray-300 -ml-0.5" />
									)}

									<div className="flex items-start gap-4">
										{/* Status Icon */}
										<div className="mt-1">{getStatusIcon(sync.status)}</div>

										{/* Content */}
										<div className="flex-1 min-w-0">
											<div className="flex items-start justify-between gap-4 mb-2">
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-1">
														<h3 className="font-semibold text-lg">
															{sync.sync_type.charAt(0).toUpperCase() +
																sync.sync_type.slice(1)}{" "}
															Sync
														</h3>
														<Badge variant="outline">{sync.direction}</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														Sync ID: {sync.sync_id.substring(0, 8)}...
													</p>
												</div>
												<Badge
													variant={
														sync.status === "succeeded"
															? "default"
															: sync.status === "failed"
																? "destructive"
																: "secondary"
													}
												>
													{sync.status}
												</Badge>
											</div>

											{/* Metrics */}
											<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
												<div>
													<p className="text-xs text-muted-foreground">
														Records Processed
													</p>
													<p className="text-lg font-semibold">
														{sync.records_processed.toLocaleString()}
													</p>
												</div>
												<div>
													<p className="text-xs text-muted-foreground">
														Records Failed
													</p>
													<p className="text-lg font-semibold text-red-600">
														{sync.records_failed.toLocaleString()}
													</p>
												</div>
												<div>
													<p className="text-xs text-muted-foreground">
														Duration
													</p>
													<p className="text-lg font-semibold">
														{(sync.duration_ms / 1000).toFixed(2)}s
													</p>
												</div>
												<div>
													<p className="text-xs text-muted-foreground">
														Started
													</p>
													<p className="text-sm font-medium">
														{new Date(sync.started_at).toLocaleString()}
													</p>
												</div>
											</div>

											{/* Error Summary */}
											{sync.error_summary && (
												<div className="mt-4 p-3 bg-red-100 border border-red-200 rounded-md">
													<p className="text-sm text-red-800">
														<span className="font-semibold">Error:</span>{" "}
														{sync.error_summary}
													</p>
												</div>
											)}
										</div>
									</div>
								</div>
							))}
						</div>
					)}

					{hasNextPage && (
						<div className="flex justify-center mt-8">
							<Button
								onClick={() => fetchNextPage()}
								disabled={isFetchingNextPage}
								variant="outline"
								size="lg"
							>
								{isFetchingNextPage ? (
									<>
										<RefreshCw className="mr-2 h-4 w-4 animate-spin" />
										Loading...
									</>
								) : (
									"Load More"
								)}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
