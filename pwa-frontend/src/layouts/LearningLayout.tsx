import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import { usePermissions } from "@/context/PermissionsContext";
import {
  LayoutDashboard,
  ClipboardList,
  CheckSquare,
  BookOpen,
  GraduationCap,
} from "lucide-react";

interface Tab {
  label: string;
  path: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const TABS: Tab[] = [
  {
    label: "Dashboard",
    path: ROUTES.APP.LEARNING.path,
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    label: "Learning Ops",
    path: ROUTES.APP.LEARNING_OPS.path,
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    label: "Accreditations",
    path: ROUTES.APP.ACCREDITATIONS.path,
    icon: <GraduationCap className="h-4 w-4" />,
  },
  {
    label: "Moodle Catalog",
    path: ROUTES.APP.MOODLE_CATALOG.path,
    icon: <BookOpen className="h-4 w-4" />,
    adminOnly: true,
  },
];

export default function LearningLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { givenRole } = usePermissions();
  const isAdminOrAbove = givenRole === "Admin" || givenRole === "Super-Admin";

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdminOrAbove);

  const isActive = (tabPath: string) => {
    // Dashboard tab: only exact match
    if (tabPath === ROUTES.APP.LEARNING.path) {
      return location.pathname === ROUTES.APP.LEARNING.path;
    }
    return location.pathname.startsWith(tabPath);
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Tab bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="px-6 md:px-10 flex items-center gap-1 overflow-x-auto scrollbar-none">
          {visibleTabs.map((tab) => {
            const active = isActive(tab.path);
            return (
              <button
                key={tab.path}
                id={`learning-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => navigate(tab.path)}
                className={`
                  flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap
                  border-b-2 transition-all duration-150 -mb-px
                  ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                  }
                  ${tab.label === "Moodle Catalog" && active ? "text-blue-600 border-blue-600" : ""}
                `}
              >
                {tab.icon}
                {tab.label}
                {tab.label === "Moodle Catalog" && (
                  <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-semibold">
                    LMS
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
