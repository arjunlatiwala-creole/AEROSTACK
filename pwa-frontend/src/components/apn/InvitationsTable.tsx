import "@/lib/ag-grid-config";
import type { APN } from "@enterprise/common";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

type APNEngagementInvitation = APN.APNEngagementInvitation;
type APNPaginatedResult<T> = APN.APNPaginatedResult<T>;

interface Props {
	data: APNPaginatedResult<APNEngagementInvitation> | undefined;
	currentPage: number;
	pageSize: number;
	onPageChange: (cursor?: string | null) => void;
	onPageSizeChange: (size: number) => void;
	isLoading: boolean;
	hasPrev: boolean;
}

const formatCurrency = (amount?: number, currency = "USD") => {
	if (!amount) return "-";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(amount);
};

const formatDate = (dateString?: string) => {
	if (!dateString) return "-";
	try {
		return new Date(dateString).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	} catch {
		return dateString;
	}
};

const StatusBadge = ({ status }: { status: string }) => {
	const statusColors: Record<string, string> = {
		ACCEPTED: "bg-green-100 text-green-800",
		PENDING: "bg-yellow-100 text-yellow-800",
		REJECTED: "bg-red-100 text-red-800",
		EXPIRED: "bg-gray-100 text-gray-800",
	};

	return (
		<Badge className={statusColors[status] || "bg-gray-100 text-gray-800"}>
			{status}
		</Badge>
	);
};

export const InvitationsTable: React.FC<Props> = ({
	data,
	currentPage,
	pageSize,
	onPageChange,
	onPageSizeChange,
	isLoading,
	hasPrev,
}) => {
	const colDefs: ColDef<APNEngagementInvitation>[] = useMemo(
		() => [
			{
				field: "invitationId",
				headerName: "ID",
				width: 180,
				cellRenderer: (params: any) => (
					<span className="font-mono text-xs">{params.value}</span>
				),
			},
			{
				field: "engagementTitle",
				headerName: "Engagement",
				flex: 1.5,
				minWidth: 200,
				cellRenderer: (params: any) => (
					<span className="font-medium truncate" title={params.value}>
						{params.value || "-"}
					</span>
				),
			},
			{
				field: "customerCompanyName",
				headerName: "Company",
				flex: 1,
				minWidth: 150,
			},
			{
				field: "customerIndustry",
				headerName: "Industry",
				width: 140,
				cellRenderer: (params: any) =>
					params.value ? (
						<Badge variant="outline" className="text-xs">
							{params.value}
						</Badge>
					) : (
						"-"
					),
			},
			{
				field: "status",
				headerName: "Status",
				width: 110,
				cellRenderer: (params: any) =>
					params.value ? <StatusBadge status={params.value} /> : "-",
			},
			{
				field: "expectedMonthlySpend",
				headerName: "Monthly Spend",
				width: 130,
				cellRenderer: (params: any) =>
					formatCurrency(params.value, params.data?.currencyCode),
			},
			{
				field: "senderCompanyName",
				headerName: "Sender",
				width: 100,
				cellRenderer: (params: any) => (
					<Badge variant="secondary">{params.value || "-"}</Badge>
				),
			},
			{
				field: "targetCompletionDate",
				headerName: "Target Date",
				width: 120,
				cellRenderer: (params: any) => formatDate(params.value),
			},
			{
				field: "invitationDate",
				headerName: "Invited",
				width: 120,
				cellRenderer: (params: any) => formatDate(params.value),
			},
		],
		[],
	);

	const items = data?.items ?? [];
	const totalCount = data?.total ?? 0;
	const nextCursor = data?.nextCursor ?? null;
	const totalPages = data?.totalPages ?? 1;
	const hasNext = data?.hasMore && !!data?.nextCursor;

	const PAGE_SIZES = [20, 50, 100];
	const showingCount = Math.min(currentPage * pageSize, totalCount);

	return (
		<div className="ag-theme-alpine w-full">
			<div className="ag-theme-alpine" style={{ width: "100%", height: 500 }}>
				<AgGridReact<APNEngagementInvitation>
					theme="legacy"
					rowData={items}
					columnDefs={colDefs}
					getRowId={(params) => params.data.invitationId}
					onGridReady={(params) => params.api.sizeColumnsToFit()}
					headerHeight={36}
					rowHeight={44}
					domLayout="normal"
					defaultColDef={{
						resizable: true,
						sortable: true,
						filter: false,
					}}
					loading={isLoading}
					overlayLoadingTemplate={`
						<div style="padding:16px; font-size:14px; color:#666;">
							Loading invitations...
						</div>
					`}
					overlayNoRowsTemplate={`
						<div style="padding:16px; font-size:14px; color:#666;">
							No invitations found.
						</div>
					`}
				/>
			</div>

			{/* Pagination Footer */}
			<div className="border-t bg-card px-4 py-3">
				<div className="flex items-center justify-between">
					<div className="text-sm text-muted-foreground">
						Showing {showingCount} of {totalCount} invitations
					</div>

					<div className="flex items-center gap-4">
						<select
							value={pageSize}
							onChange={(e) => onPageSizeChange(Number(e.target.value))}
							className="rounded border px-2 py-1 text-sm cursor-pointer"
						>
							{PAGE_SIZES.map((s) => (
								<option key={s} value={s}>
									{s} / page
								</option>
							))}
						</select>

						<div className="text-sm text-muted-foreground">
							Page {currentPage} of {totalPages}
						</div>

						<div className="flex gap-2">
							<button
								disabled={!hasPrev}
								onClick={() => onPageChange(undefined)}
								className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
								title="Previous"
							>
								◀
							</button>

							<button
								disabled={!hasNext || !nextCursor}
								onClick={() => {
									if (nextCursor) onPageChange(nextCursor);
								}}
								className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
								title="Next"
							>
								▶
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
