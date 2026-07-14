import { useInfiniteQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	CheckCircle2,
	ChevronDown,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getSyncDetails } from "@/api/integrations";
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
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export default function IntegrationSyncDetails() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const syncId = searchParams.get("syncId");

	const [entityTypeFilter, setEntityTypeFilter] = useState<string | undefined>(
		undefined,
	);
	const [statusFilter, setStatusFilter] = useState<
		"success" | "failure" | undefined
	>(undefined);
	const [openItems, setOpenItems] = useState<Set<string>>(new Set());

	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
		refetch,
	} = useInfiniteQuery({
		queryKey: ["sync-details", syncId, entityTypeFilter, statusFilter],
		queryFn: ({ pageParam }) =>
			getSyncDetails(syncId, {
				limit: 50,
				nextToken: pageParam,
				entity_type: entityTypeFilter,
				status: statusFilter,
			}),
		enabled: !!syncId,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.data.nextToken,
	});

	// Flatten all pages into a single array
	const allDetails = data?.pages.flatMap((page) => page.data.items) ?? [];

	// Calculate stats
	const totalRecords = allDetails.length;
	const successRecords = allDetails.filter(
		(d) => d.status === "success",
	).length;
	const failedRecords = allDetails.filter((d) => d.status === "failure").length;

	const entityTypes = Array.from(
		new Set(allDetails.map((d) => d.entity_type)),
	).filter(Boolean);

	const toggleItem = (itemId: string) => {
		setOpenItems((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(itemId)) {
				newSet.delete(itemId);
			} else {
				newSet.add(itemId);
			}
			return newSet;
		});
	};

	const getOperationColor = (operation: string) => {
		switch (operation) {
			case "create":
				return "bg-green-100 text-green-800 border-green-200";
			case "update":
				return "bg-blue-100 text-blue-800 border-blue-200";
			case "delete":
				return "bg-red-100 text-red-800 border-red-200";
			default:
				return "bg-gray-100 text-gray-800 border-gray-200";
		}
	};

	if (!syncId) {
		return (
			<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
				<div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
					<NoData />
					<p className="text-muted-foreground">Sync ID is required</p>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Loader description="Loading Sync Details..." />
			</div>
		);
	}

	return (
		<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
			{/* Header */}
			<div className="mb-8">
				<div className="flex items-center gap-4 mb-4">
					<Button variant="outline" size="icon" onClick={() => navigate(-1)}>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<div className="flex-1">
						<h1 className="text-3xl md:text-4xl font-bold mb-1 text-foreground">
							Sync Details
						</h1>
						<p className="text-base text-muted-foreground">Sync ID: {syncId}</p>
					</div>
					<Button variant="outline" size="icon" onClick={() => refetch()}>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Total Records</CardDescription>
						<CardTitle className="text-5xl font-extrabold">
							{totalRecords}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Successful</CardDescription>
						<CardTitle className="text-5xl font-extrabold text-green-600">
							{successRecords}
						</CardTitle>
					</CardHeader>
				</Card>

				<Card className="shadow-none">
					<CardHeader>
						<CardDescription>Failed</CardDescription>
						<CardTitle className="text-5xl font-extrabold text-red-600">
							{failedRecords}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			{/* Filters */}
			<Card className="shadow-none mb-6">
				<CardHeader>
					<CardTitle className="text-xl font-semibold">Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label className="text-sm font-medium mb-2 block">
								Entity Type
							</label>
							<Select
								value={entityTypeFilter || "all"}
								onValueChange={(value) =>
									setEntityTypeFilter(value === "all" ? undefined : value)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="All Entity Types" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Entity Types</SelectItem>
									{entityTypes.map((type) => (
										<SelectItem key={type} value={type}>
											{type}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div>
							<label className="text-sm font-medium mb-2 block">Status</label>
							<Select
								value={statusFilter || "all"}
								onValueChange={(value) =>
									setStatusFilter(
										value === "all"
											? undefined
											: (value as "success" | "failure"),
									)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="All Statuses" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Statuses</SelectItem>
									<SelectItem value="success">Success</SelectItem>
									<SelectItem value="failure">Failure</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Accordion/Collapsible List */}
			<Card className="shadow-none mb-8 border-none p-0">
				<CardHeader>
					<CardTitle className="text-2xl font-semibold">Sync Records</CardTitle>
				</CardHeader>
				<CardContent>
					{allDetails.length === 0 ? (
						<div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
							<NoData />
							<p className="text-muted-foreground">No sync details found</p>
						</div>
					) : (
						<div className="space-y-3">
							{allDetails.map((detail) => {
								const itemKey = `${detail.entity_type}-${detail.entity_id}`;
								const isOpen = openItems.has(itemKey);

								return (
									<Collapsible
										key={itemKey}
										open={isOpen}
										onOpenChange={() => toggleItem(itemKey)}
									>
										<Card
											className={`shadow-sm transition-all ${
												detail.status === "failure"
													? "border-red-200 bg-red-50/30"
													: "border-gray-200"
											}`}
										>
											<CollapsibleTrigger className="w-full">
												<CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
													<div className="flex items-center justify-between gap-4">
														<div className="flex items-center gap-3 flex-1 min-w-0">
															{/* Status Icon */}
															{detail.status === "success" ? (
																<CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
															) : (
																<XCircle className="h-5 w-5 text-red-600 shrink-0" />
															)}

															{/* Entity Info */}
															<div className="flex-1 min-w-0 text-left">
																<div className="flex items-center gap-2 mb-1">
																	<Badge variant="outline" className="shrink-0">
																		{detail.entity_type}
																	</Badge>
																	<Badge
																		className={`${getOperationColor(detail.operation)} shrink-0`}
																	>
																		{detail.operation}
																	</Badge>
																</div>
																<p className="text-sm font-medium truncate">
																	Entity ID: {detail.entity_id}
																</p>
																{detail.internal_id && (
																	<p className="text-xs text-muted-foreground truncate">
																		Internal ID: {detail.internal_id}
																	</p>
																)}
															</div>
														</div>

														{/* Status Badge & Chevron */}
														<div className="flex items-center gap-2 shrink-0">
															<Badge
																variant={
																	detail.status === "success"
																		? "default"
																		: "destructive"
																}
															>
																{detail.status}
															</Badge>
															<ChevronDown
																className={`h-5 w-5 transition-transform ${
																	isOpen ? "transform rotate-180" : ""
																}`}
															/>
														</div>
													</div>
												</CardHeader>
											</CollapsibleTrigger>

											<CollapsibleContent>
												<CardContent className="pt-0">
													<div className="space-y-4 border-t pt-4">
														{/* Processed At */}
														<div>
															<p className="text-xs font-semibold text-muted-foreground mb-1">
																Processed At
															</p>
															<p className="text-sm">
																{new Date(detail.processed_at).toLocaleString()}
															</p>
														</div>

														{/* Error (if any) */}
														{detail.error &&
															Object.keys(detail.error).length > 0 && (
																<div>
																	<p className="text-xs font-semibold text-red-600 mb-2">
																		Error Details
																	</p>
																	<div className="bg-red-50 border border-red-200 rounded-md p-3">
																		<pre className="text-xs text-red-800 whitespace-pre-wrap font-mono">
																			{JSON.stringify(detail.error, null, 2)}
																		</pre>
																	</div>
																</div>
															)}

														{/* Changes */}
														<div>
															<p className="text-xs font-semibold text-muted-foreground mb-2">
																Changes
															</p>
															<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
																{/* Old Values */}
																<div>
																	<p className="text-xs font-medium text-red-600 mb-2">
																		Old Values
																	</p>
																	<div className="bg-red-50/50 border border-red-100 rounded-md p-3 max-h-60 overflow-auto">
																		{Object.keys(detail.changes.old).length ===
																		0 ? (
																			<p className="text-xs text-muted-foreground italic">
																				No previous values
																			</p>
																		) : (
																			<pre className="text-xs whitespace-pre-wrap font-mono">
																				{JSON.stringify(
																					detail.changes.old,
																					null,
																					2,
																				)}
																			</pre>
																		)}
																	</div>
																</div>

																{/* New Values */}
																<div>
																	<p className="text-xs font-medium text-green-600 mb-2">
																		New Values
																	</p>
																	<div className="bg-green-50/50 border border-green-100 rounded-md p-3 max-h-60 overflow-auto">
																		{Object.keys(detail.changes.new).length ===
																		0 ? (
																			<p className="text-xs text-muted-foreground italic">
																				No new values
																			</p>
																		) : (
																			<pre className="text-xs whitespace-pre-wrap font-mono">
																				{JSON.stringify(
																					detail.changes.new,
																					null,
																					2,
																				)}
																			</pre>
																		)}
																	</div>
																</div>
															</div>
														</div>
													</div>
												</CardContent>
											</CollapsibleContent>
										</Card>
									</Collapsible>
								);
							})}
						</div>
					)}

					{/* Load More Button */}
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
