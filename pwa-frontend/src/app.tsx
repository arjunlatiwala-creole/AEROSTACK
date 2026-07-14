import NavBar from '@/components/NavBar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useLocation, useNavigate } from 'react-router';
import { ROUTES, type RouteItem } from './lib/routes-config';
import { useCallback, useEffect } from 'react';
import { usePermissions } from './context/PermissionsContext';
import { resolvePermissionKey } from './lib/permission-map';

export default function App({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { canAccess, loading, givenRole } = usePermissions();

  const getCurrentRoute = useCallback(() => {
    return Object.values(ROUTES.APP).find(
      (route) => route.path === currentPath
    );
  }, [currentPath]);

  // Synchronous check to prevent flash of unauthorized UI
  const isFallback = currentPath === ROUTES.APP.PERSON.path;
  const permKey = resolvePermissionKey(currentPath);
  let isAuthorized = true;

  if (!isFallback) {
    if (permKey && !canAccess(permKey)) {
      isAuthorized = false;
    }
    if (
      currentPath.startsWith(ROUTES.APP.ROLES.path) ||
      currentPath === ROUTES.APP.LEARNING.path
    ) {
      const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";
      if (!isAdminOrAbove) {
        isAuthorized = false;
      }
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!isAuthorized) {
      navigate(ROUTES.APP.PERSON.path, { replace: true });
    }
  }, [loading, isAuthorized, navigate]);

  return (
    <div className="flex flex-col min-h-screen relative">
      <SidebarProvider>
        <NavBar />

        <div className="flex flex-1 flex-col">
          <div className="sticky top-0 z-10 border-b-2 border-b-gray-200 px-2 py-3 flex items-center gap-2 backdrop-blur-xl">
            <SidebarTrigger />
            <h2 className="text-xl font-bold" title={getCurrentRoute()?.description}>{getCurrentRoute()?.title}</h2>
          </div>
          <main className="flex-1 p-4 py-0 *:overflow-auto">
            {(!loading && isAuthorized) ? children : null}
          </main>
        </div>

      </SidebarProvider>
    </div>
  );
}