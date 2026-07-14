import App from "@/app";
import { useAuth } from "@/context/auth/AuthContext";
import { PermissionsProvider } from "@/context/PermissionsContext";
import { ROUTES } from "@/lib/routes-config";
import { Navigate, Outlet } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProtectedLayout() {
  const auth = useAuth();

  // Allow bypassing auth in local dev mode without Cognito credentials
  const isLocalDevMode = import.meta.env.DEV && 
    import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX';

  if (auth?.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4">
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </div>
    );
  }

  // In local dev mode without real Cognito, allow access without authentication
  if (!auth?.user && !isLocalDevMode) {
    return <Navigate to={ROUTES.AUTH.LOGIN.path} replace />;
  }

  return (
    <PermissionsProvider>
      <App>
        <Outlet />
      </App>
    </PermissionsProvider>
  );
}
