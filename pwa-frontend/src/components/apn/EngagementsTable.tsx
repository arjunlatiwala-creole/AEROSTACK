import "@/lib/ag-grid-config";
import type { APN } from "@enterprise/common";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

type APNEngagement = APN.APNEngagement;
type APNPaginatedResult<T> = APN.APNPaginatedResult<T>;

interface Props {
	data: APNPaginatedResult<APNEngagement> | undefined;
	currentPage: number;
	pageSize: number;
	onPageChange: (cursor?: string | null) => void;
	onPageSizeChange: (size: number) => void;
	isLoading: boolean;
	hasPrev: boolean;
}

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

export const EngagementsTable: React.FC<Props> = ({
	data,
	currentPage,
	pageSize,
	onPageChange,
	onPageSizeChange,
	isLoading,
	hasPrev,
}) => {
	const colDefs: ColDef<APNEngagement>[] = useMemo(
		() => [
			{
				field: "engagementId",
				headerName: "ID",
				width: 180,
				cellRenderer: (params: any) => (
					<span className="font-mono text-xs">{params.value}</span>
				),
			},
			{
				field: "title",
				headerName: "Title",
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
				cellRenderer: (params: any) => params.value || "-",
			},
			{
				field: "customerCountry",
				headerName: "Country",
				width: 100,
				cellRenderer: (params: any) =>
					params.value ? <Badge variant="outline">{params.value}</Badge> : "-",
			},
			{
				field: "memberCount",
				headerName: "Members",
				width: 100,
				cellRenderer: (params: any) => (
					<Badge variant="secondary">{params.value || 0}</Badge>
				),
			},
			{
				field: "targetCompletionDate",
				headerName: "Target Date",
				width: 120,
				cellRenderer: (params: any) => formatDate(params.value),
			},
			{
				field: "createdAt",
				headerName: "Created",
				width: 120,
				cellRenderer: (params: any) => formatDate(params.value),
			},
			{
				field: "description",
				headerName: "Description",
				flex: 1,
				minWidth: 200,
				cellRenderer: (params: any) => (
					<span
						className="text-xs text-muted-foreground truncate"
						title={params.value}
					>
						{params.value
							? params.value.length > 80
								? `${params.value.substring(0, 80)}...`
								: params.value
							: "-"}
					</span>
				),
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
				<AgGridReact<APNEngagement>
					theme="legacy"
					rowData={items}
					columnDefs={colDefs}
					getRowId={(params) => params.data.engagementId}
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
							Loading engagements...
						</div>
					`}
					overlayNoRowsTemplate={`
						<div style="padding:16px; font-size:14px; color:#666;">
							No engagements found.
						</div>
					`}
				/>
			</div>

			{/* Pagination Footer */}
			<div className="border-t bg-card px-4 py-3">
				<div className="flex items-center justify-between">
					<div className="text-sm text-muted-foreground">
						Showing {showingCount} of {totalCount} engagements
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
