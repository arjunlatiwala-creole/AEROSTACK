import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Save } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useNavigate, useSearchParams } from "react-router";
import { getIntegration, updateIntegration } from "@/api/integrations";
import Loader from "@/components/Loader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/lib/routes-config";
import type { Integration } from "@/types/integrations";

interface EditIntegrationFormValues {
	display_name: string;
	description: string;
	enabled: boolean;
	sync_enabled: boolean;
	sync_frequency_minutes: number;
}

export default function DashboardEditIntegration() {
	const [searchParams] = useSearchParams();
	const id = searchParams.get("id");
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data, isLoading, isError } = useQuery({
		queryKey: ["integration", id],
		queryFn: () => getIntegration(id!),
		enabled: !!id,
	});

	const { mutate: update, isPending } = useMutation({
		mutationFn: (values: Partial<Integration>) =>
			updateIntegration(id!, values),
		onSuccess: () => {
			toast.success("Integration updated successfully");
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
			queryClient.invalidateQueries({ queryKey: ["integration", id] });
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const integration = data?.data ?? {};

	const {
		register,
		handleSubmit,
		setValue,
		reset,
		watch,
		formState: { errors, isDirty },
	} = useForm<EditIntegrationFormValues>({
		defaultValues: {
			display_name: integration.display_name,
			description: integration.description || "",
			enabled: integration.enabled,
			sync_enabled: integration.sync_enabled,
			sync_frequency_minutes: integration.sync_frequency_minutes,
		},
	});

	const enabled = watch("enabled");
	const syncEnabled = watch("sync_enabled");

	const onSubmit = (data: EditIntegrationFormValues) => {
		update(data);
	};

	const handleCancel = () => {
		if (isDirty) {
			const confirm = window.confirm(
				"You have unsaved changes. Are you sure you want to leave?",
			);
			if (!confirm) return;
		}
		navigate(ROUTES.APP.INTEGRATIONS.path);
	};

	useEffect(() => {
		if (integration) {
			reset({
				display_name: integration.display_name,
				description: integration.description || "",
				enabled: integration.enabled,
				sync_enabled: integration.sync_enabled,
				sync_frequency_minutes: integration.sync_frequency_minutes,
			});
		}
	}, [integration?.integration_id]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Loader description="Loading Integration Details..." />
			</div>
		);
	}

	if (isError || !integration) {
		return (
			<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="pt-6">
						<Alert variant="destructive">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								Integration not found or could not be loaded. Please try again.
							</AlertDescription>
						</Alert>
						<Button
							variant="outline"
							className="mt-4"
							onClick={() => navigate(ROUTES.APP.INTEGRATIONS.path)}
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Integrations
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="p-6 md:p-10 bg-muted/40 min-h-screen">
			<div className="max-w-3xl mx-auto">
				{/* Header */}
				<div className="mb-8">
					<div className="flex items-center gap-4 mb-4">
						<Button
							variant="outline"
							size="icon"
							onClick={handleCancel}
							className="shrink-0"
						>
							<ArrowLeft className="h-4 w-4" />
						</Button>
						<div className="flex-1">
							<h1 className="text-3xl md:text-4xl font-bold mb-1 text-foreground capitalize">
								{integration.integration_type} Configuration
							</h1>
							<p className="text-base text-muted-foreground"></p>
						</div>
					</div>
				</div>

				{/* Auth Status Alert */}
				{integration.auth_status === false && (
					<Alert variant="destructive" className="mb-6">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							This integration is not authenticated. Please re-authenticate to
							enable syncing.
						</AlertDescription>
					</Alert>
				)}

				{/* Form */}
				<Card className="shadow-none">
					<CardHeader>
						<CardTitle>Integration Settings</CardTitle>
						<CardDescription>
							Update the configuration for this integration. Authentication
							settings are managed separately.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
							{/* Display Name */}
							<div className="space-y-2">
								<Label htmlFor="display_name">
									Display Name <span className="text-red-500">*</span>
								</Label>
								<Input
									id="display_name"
									placeholder="e.g. My CRM Integration"
									{...register("display_name", {
										required: "Display name is required",
										minLength: {
											value: 3,
											message: "Display name must be at least 3 characters",
										},
									})}
									className={errors.display_name ? "border-red-500" : ""}
								/>
								{errors.display_name && (
									<p className="text-sm text-red-500 flex items-center gap-1">
										<AlertCircle className="h-3 w-3" />
										{errors.display_name.message}
									</p>
								)}
							</div>

							{/* Description */}
							<div className="space-y-2">
								<Label htmlFor="description">Description</Label>
								<Textarea
									id="description"
									placeholder="Describe this integration and its purpose..."
									className="min-h-[100px] resize-none"
									{...register("description")}
								/>
								<p className="text-xs text-muted-foreground">
									Optional. Help your team understand what this integration
									does.
								</p>
							</div>

							{/* Divider */}
							<div className="border-t pt-6">
								<h3 className="text-sm font-medium mb-4">Status & Sync</h3>
								<div className="space-y-4">
									{/* Enabled Switch */}
									<div className="flex items-start justify-between rounded-lg border p-4 bg-card hover:bg-accent/50 transition-colors">
										<div className="space-y-0.5 pr-4">
											<Label
												htmlFor="enabled"
												className="text-base cursor-pointer"
											>
												Enable Integration
											</Label>
											<p className="text-sm text-muted-foreground">
												When disabled, this integration will not process any
												data or perform syncs.
											</p>
										</div>
										<Switch
											id="enabled"
											checked={enabled}
											onCheckedChange={(checked) =>
												setValue("enabled", checked, { shouldDirty: true })
											}
										/>
									</div>

									{/* Sync Enabled Switch */}
									<div className="flex items-start justify-between rounded-lg border p-4 bg-card hover:bg-accent/50 transition-colors">
										<div className="space-y-0.5 pr-4">
											<Label
												htmlFor="sync_enabled"
												className="text-base cursor-pointer"
											>
												Enable Automatic Sync
											</Label>
											<p className="text-sm text-muted-foreground">
												Allow this integration to automatically sync data at
												scheduled intervals.
											</p>
										</div>
										<Switch
											id="sync_enabled"
											checked={syncEnabled}
											onCheckedChange={(checked) =>
												setValue("sync_enabled", checked, { shouldDirty: true })
											}
											disabled={!enabled}
										/>
									</div>

									{/* Sync Frequency */}
									<div className="space-y-2">
										<Label htmlFor="sync_frequency">
											Sync Frequency <span className="text-red-500">*</span>
										</Label>
										<Select
											value={String(watch("sync_frequency_minutes"))}
											onValueChange={(value) => {
												setValue(
													"sync_frequency_minutes",
													parseInt(value, 10),
													{
														shouldDirty: true,
													},
												);
											}}
											disabled={!syncEnabled}
										>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Select frequency" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="360">Every 6 hours</SelectItem>
												<SelectItem value="720">Every 12 hours</SelectItem>
												<SelectItem value="1440">Daily</SelectItem>
												<SelectItem value="10080">Weekly</SelectItem>
											</SelectContent>
										</Select>

										{errors.sync_frequency_minutes && (
											<p className="text-sm text-red-500 flex items-center gap-1">
												<AlertCircle className="h-3 w-3" />
												{errors.sync_frequency_minutes.message}
											</p>
										)}
									</div>
								</div>
							</div>

							{/* Actions */}
							<div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t">
								<Button
									type="button"
									variant="outline"
									onClick={handleCancel}
									disabled={isPending}
									className="sm:order-1"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={isPending || !isDirty}
									className="sm:order-2"
								>
									{isPending ? (
										<>
											<Loader />
											<span className="ml-2">Saving...</span>
										</>
									) : (
										<>
											<Save className="mr-2 h-4 w-4" />
											Save Changes
										</>
									)}
								</Button>
							</div>

							{/* Dirty State Indicator */}
							{isDirty && !isPending && (
								<p className="text-xs text-muted-foreground text-center">
									You have unsaved changes
								</p>
							)}
						</form>
					</CardContent>
				</Card>

				{/* Integration Metadata */}
				<Card className="mt-6 shadow-none">
					<CardHeader>
						<CardTitle className="text-base">Metadata</CardTitle>
					</CardHeader>
					<CardContent className="text-sm space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<p className="text-muted-foreground">Created</p>
								<p className="font-medium">
									{new Date(integration.created_at).toLocaleDateString()}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Last Updated</p>
								<p className="font-medium">
									{new Date(integration.updated_at).toLocaleDateString()}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Created By</p>
								<p className="font-medium">{integration.created_by}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Updated By</p>
								<p className="font-medium">{integration.updated_by}</p>
							</div>
						</div>

						{/* Sync Status */}
						<div className="border-t pt-4">
							<h4 className="text-sm font-medium mb-3">Sync Status</h4>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<p className="text-muted-foreground">Status</p>
									<p className="font-medium capitalize">{integration.status}</p>
								</div>
								<div>
									<p className="text-muted-foreground">Total Syncs</p>
									<p className="font-medium">{integration.total_syncs}</p>
								</div>
								<div>
									<p className="text-muted-foreground">Successful Syncs</p>
									<p className="font-medium text-green-600">
										{integration.successful_syncs}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Failed Syncs</p>
									<p className="font-medium text-red-600">
										{integration.failed_syncs}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Last Sync</p>
									<p className="font-medium">
										{integration.last_sync_at
											? new Date(integration.last_sync_at).toLocaleString()
											: "Never"}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Next Sync</p>
									<p className="font-medium">
										{integration.next_sync_at
											? new Date(integration.next_sync_at).toLocaleString()
											: integration.sync_enabled && integration.enabled
												? "Pending"
												: "Disabled"}
									</p>
								</div>
								<div>
									<p className="text-muted-foreground">Consecutive Failures</p>
									<p className="font-medium">
										{integration.consecutive_failures}
									</p>
								</div>
								{integration.auth_expires_at && (
									<div>
										<p className="text-muted-foreground">Auth Expires</p>
										<p className="font-medium">
											{new Date(integration.auth_expires_at).toLocaleString()}
										</p>
									</div>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
