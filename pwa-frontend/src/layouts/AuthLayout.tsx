import { useAuth } from "@/context/auth/AuthContext";
import { ROUTES } from "@/lib/routes-config";
import { Navigate, Outlet } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";


export default function AuthLayout() {
  const auth = useAuth();

  if (auth?.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4">
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </div>
    );
  }

  if (auth?.user) {
    return <Navigate to={ROUTES.APP.HOME.path} replace />;
  }

  return <Outlet />;
}
