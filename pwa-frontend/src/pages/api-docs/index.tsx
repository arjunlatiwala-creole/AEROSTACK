import { useQuery } from "@tanstack/react-query";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { AlertCircle, Loader2 } from "lucide-react";
import { getDocs } from "@/api/api-docs";
import { Alert, AlertDescription } from "@/components/ui/alert";

const SwaggerUIWrapper = () => {
	const {
		data: docs,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["openapi-spec"],
		queryFn: getDocs,
		staleTime: 1000 * 60 * 5,
	});

	const data = docs?.data || {};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-linear-to-br from-blue-50 to-indigo-50">
				<div className="text-center">
					<Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
					<p className="text-gray-700 font-medium">
						Loading API Documentation...
					</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-linear-to-br from-red-50 to-orange-50 p-4">
				<Alert className="max-w-md border-red-200 bg-white">
					<AlertCircle className="h-5 w-5 text-red-600" />
					<AlertDescription className="ml-2">
						<p className="font-semibold text-red-900 mb-1">
							Failed to load API documentation
						</p>
						<p className="text-sm text-red-700">
							{error instanceof Error ? error.message : "Unknown error"}
						</p>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-white">
			<div className="bg-linear-to-r from-blue-600 to-indigo-700 text-white py-6 px-8 shadow-lg">
				<h1 className="text-3xl font-bold mb-2">Aerostack API Documentation</h1>
				<p className="text-blue-100">
					Interactive API reference and endpoint explorer
				</p>
			</div>
			<div className="p-4">
				<SwaggerUI
					spec={data}
					deepLinking={true}
					defaultModelsExpandDepth={1}
					defaultModelExpandDepth={1}
					docExpansion="list"
					filter={true}
					showExtensions={true}
					persistAuthorization={true}
					tryItOutEnabled={true}
					displayOperationId={true}
				/>
			</div>
		</div>
	);
};

export default SwaggerUIWrapper;
