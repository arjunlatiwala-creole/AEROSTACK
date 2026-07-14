import { Cloud, Handshake, Mail, TrendingUp } from "lucide-react";
import { useState } from "react";
import { EngagementsTable } from "@/components/apn/EngagementsTable";
import { InvitationsTable } from "@/components/apn/InvitationsTable";
import { OpportunitiesTable } from "@/components/apn/OpportunitiesTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	useEngagementInvitations,
	useEngagements,
	useOpportunities,
} from "@/hooks/useAPN";

export default function DashboardAPN() {
	const [activeTab, setActiveTab] = useState("opportunities");

	// Opportunities pagination state
	const [oppPageSize, setOppPageSize] = useState(20);
	const [oppCursors, setOppCursors] = useState<(string | null)[]>([null]);
	const [oppCurrentPage, setOppCurrentPage] = useState(1);

	// Engagements pagination state
	const [engPageSize, setEngPageSize] = useState(20);
	const [engCursors, setEngCursors] = useState<(string | null)[]>([null]);
	const [engCurrentPage, setEngCurrentPage] = useState(1);

	// Invitations pagination state
	const [invPageSize, setInvPageSize] = useState(20);
	const [invCursors, setInvCursors] = useState<(string | null)[]>([null]);
	const [invCurrentPage, setInvCurrentPage] = useState(1);

	// Queries
	const { data: opportunitiesData, isLoading: oppLoading } = useOpportunities({
		limit: oppPageSize,
		last_key: oppCursors[oppCurrentPage - 1],
	});

	const { data: engagementsData, isLoading: engLoading } = useEngagements({
		limit: engPageSize,
		last_key: engCursors[engCurrentPage - 1],
	});

	const { data: invitationsData, isLoading: invLoading } =
		useEngagementInvitations({
			limit: invPageSize,
			last_key: invCursors[invCurrentPage - 1],
		});

	console.log("opportunites_data", opportunitiesData);

	// Opportunities handlers
	const handleOppNext = () => {
		if (!opportunitiesData?.nextCursor) return;
		setOppCursors((prev) => [...prev, opportunitiesData.nextCursor]);
		setOppCurrentPage((prev) => prev + 1);
	};

	const handleOppPrev = () => {
		if (oppCurrentPage === 1) return;
		setOppCurrentPage((prev) => prev - 1);
	};

	const handleOppPageSizeChange = (size: number) => {
		setOppPageSize(size);
		setOppCurrentPage(1);
		setOppCursors([null]);
	};

	// Engagements handlers
	const handleEngNext = () => {
		if (!engagementsData?.nextCursor) return;
		setEngCursors((prev) => [...prev, engagementsData.nextCursor]);
		setEngCurrentPage((prev) => prev + 1);
	};

	const handleEngPrev = () => {
		if (engCurrentPage === 1) return;
		setEngCurrentPage((prev) => prev - 1);
	};

	const handleEngPageSizeChange = (size: number) => {
		setEngPageSize(size);
		setEngCurrentPage(1);
		setEngCursors([null]);
	};

	// Invitations handlers
	const handleInvNext = () => {
		if (!invitationsData?.nextCursor) return;
		setInvCursors((prev) => [...prev, invitationsData.nextCursor]);
		setInvCurrentPage((prev) => prev + 1);
	};

	const handleInvPrev = () => {
		if (invCurrentPage === 1) return;
		setInvCurrentPage((prev) => prev - 1);
	};

	const handleInvPageSizeChange = (size: number) => {
		setInvPageSize(size);
		setInvCurrentPage(1);
		setInvCursors([null]);
	};

	// Calculate totals for summary cards
	const totalOpportunities = opportunitiesData?.total ?? 0;
	const totalEngagements = engagementsData?.total ?? 0;
	const totalInvitations = invitationsData?.total ?? 0;

	// Calculate pipeline value (sum of expected monthly spend)
	const pipelineValue =
		opportunitiesData?.items?.reduce(
			(sum, opp) => sum + (opp.expectedMonthlySpend || 0),
			0,
		) ?? 0;

	return (
		<div className="container mx-auto p-6 space-y-6">
			{/* Header */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
						<Cloud className="h-8 w-8 text-orange-500" />
						APN Dashboard
					</h1>
					<p className="text-muted-foreground mt-1">
						AWS Partner Network opportunities, engagements, and invitations
					</p>
				</div>
			</div>

			{/* Summary Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card className="shadow-none">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Total Opportunities
						</CardTitle>
						<TrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{totalOpportunities}</div>
						<p className="text-xs text-muted-foreground">
							Active pipeline items
						</p>
					</CardContent>
				</Card>

				<Card className="shadow-none">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Pipeline Value
						</CardTitle>
						<TrendingUp className="h-4 w-4 text-green-500" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							${pipelineValue.toLocaleString()}
						</div>
						<p className="text-xs text-muted-foreground">Monthly recurring</p>
					</CardContent>
				</Card>

				<Card className="shadow-none">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Engagements</CardTitle>
						<Handshake className="h-4 w-4 text-blue-500" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{totalEngagements}</div>
						<p className="text-xs text-muted-foreground">Active engagements</p>
					</CardContent>
				</Card>

				<Card className="shadow-none">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Invitations</CardTitle>
						<Mail className="h-4 w-4 text-purple-500" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{totalInvitations}</div>
						<p className="text-xs text-muted-foreground">Pending & accepted</p>
					</CardContent>
				</Card>
			</div>

			{/* Tabs */}
			<Card className="shadow-none border-none">
				<CardContent className="pt-6">
					<Tabs value={activeTab} onValueChange={setActiveTab}>
						<TabsList className="grid w-full grid-cols-3 mb-4 border">
							<TabsTrigger
								value="opportunities"
								className="flex items-center gap-2"
							>
								<TrendingUp className="h-4 w-4" />
								Opportunities
							</TabsTrigger>
							<TabsTrigger
								value="engagements"
								className="flex items-center gap-2"
							>
								<Handshake className="h-4 w-4" />
								Engagements
							</TabsTrigger>
							<TabsTrigger
								value="invitations"
								className="flex items-center gap-2"
							>
								<Mail className="h-4 w-4" />
								Invitations
							</TabsTrigger>
						</TabsList>

						<TabsContent value="opportunities">
							<OpportunitiesTable
								data={opportunitiesData}
								currentPage={oppCurrentPage}
								pageSize={oppPageSize}
								onPageChange={(cursor) => {
									if (cursor) handleOppNext();
									else handleOppPrev();
								}}
								onPageSizeChange={handleOppPageSizeChange}
								isLoading={oppLoading}
								hasPrev={oppCurrentPage > 1}
							/>
						</TabsContent>

						<TabsContent value="engagements">
							<EngagementsTable
								data={engagementsData}
								currentPage={engCurrentPage}
								pageSize={engPageSize}
								onPageChange={(cursor) => {
									if (cursor) handleEngNext();
									else handleEngPrev();
								}}
								onPageSizeChange={handleEngPageSizeChange}
								isLoading={engLoading}
								hasPrev={engCurrentPage > 1}
							/>
						</TabsContent>

						<TabsContent value="invitations">
							<InvitationsTable
								data={invitationsData}
								currentPage={invCurrentPage}
								pageSize={invPageSize}
								onPageChange={(cursor) => {
									if (cursor) handleInvNext();
									else handleInvPrev();
								}}
								onPageSizeChange={handleInvPageSizeChange}
								isLoading={invLoading}
								hasPrev={invCurrentPage > 1}
							/>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	);
}
