import {
  Book,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Building,
  Calculator,
  ChevronRight,
  ClipboardList,
  Database,
  DollarSign,
  FileText,
  FolderGit2,
  FolderKanban,
  Globe,
  GraduationCap,
  Handshake,
  Hash,
  Home,
  LayoutDashboard,
  LineChart,
  LogOut,
  Mail,
  Megaphone,
  Settings,
  Shield,
  Smile,
  SmilePlus,
  Sparkle,
  Target,
  Truck,
  User,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { useMemo, useRef } from "react";
import toast from "react-hot-toast";
import { NavLink, useNavigate, useLocation } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/context/auth/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { ROUTES } from "@/lib/routes-config";
import { NAV_ID_TO_PERMISSION } from "@/lib/permission-map";
import aerostackLogo from "@/assets/logo-source.png";

// Key to persist which nav item was last clicked
const ACTIVE_NAV_KEY = "aerostack_active_nav_id";

interface NavigationItem {
  id: string;
  to: string;
  label: string;
  icon: any;
  isSignOut?: boolean;
  group?: string;
}

// Top-level standalone nav items (rendered above collapsible groups)
interface TopLevelItem {
  id: string;
  to: string;
  label: string;
  icon: any;
}

const topLevelItems: TopLevelItem[] = [
  {
    id: ROUTES.APP.Enterprise_Aerostack.id,
    to: ROUTES.APP.Enterprise_Aerostack.path,
    label: "Enterprise Aerostack",
    icon: Globe,
  },
  {
    id: ROUTES.APP.PERSON.id,
    to: ROUTES.APP.PERSON.path,
    label: "My Aerostack",
    icon: User,
  },
];

const navigationItems: NavigationItem[] = [
  // Operations
  {
    id: ROUTES.APP.REVOPS.id,
    to: ROUTES.APP.REVOPS.path,
    label: "RevOps",
    icon: LineChart,
    group: "Operations",
  },
  {
    id: ROUTES.APP.REVOPS_PRODUCTIVITY.id,
    to: ROUTES.APP.REVOPS_PRODUCTIVITY.path,
    label: "RevOps Productivity",
    icon: LineChart,
    group: "Operations",
  },
  {
    id: ROUTES.APP.CUSTOMER_SUCCESS.id,
    to: ROUTES.APP.CUSTOMER_SUCCESS.path,
    label: "Customer Success",
    icon: LineChart,
    group: "Operations",
  },
  {
    id: ROUTES.APP.FINANCIALS.id,
    to: ROUTES.APP.FINANCIALS.path,
    label: "Financials",
    icon: Building,
    group: "Operations",
  },
  {
    id: ROUTES.APP.ENGINEERING.id,
    to: ROUTES.APP.ENGINEERING.path,
    label: "Engineering",
    icon: FolderGit2,
    group: "Operations",
  },
  {
    id: ROUTES.APP.PEOPLE_OPS.id,
    to: ROUTES.APP.PEOPLE_OPS.path,
    label: "People Ops",
    icon: Users,
    group: "Operations",
  },

  // Tools
  {
    id: ROUTES.APP.BFPM.id,
    to: ROUTES.APP.BFPM.path,
    label: "Perspex",
    icon: Handshake,
    group: "Tools",
  },
  {
    id: ROUTES.APP.ENGAGEMENT.id,
    to: ROUTES.APP.ENGAGEMENT.path,
    label: "Engagement",
    icon: Megaphone,
    group: "Tools",
  },
  {
    id: ROUTES.APP.CONTENT_ARCHITECTURE.id,
    to: ROUTES.APP.CONTENT_ARCHITECTURE.path,
    label: "Content Arch",
    icon: Brain,
    group: "Tools",
  },
  {
    id: ROUTES.APP.CALCS.id,
    to: ROUTES.APP.CALCS.path,
    label: "Calcs",
    icon: Calculator,
    group: "Tools",
  },
  {
    id: ROUTES.APP.OPPS_TOOLS.id,
    to: ROUTES.APP.OPPS_TOOLS.path,
    label: "Opps Tools",
    icon: Target,
    group: "Tools",
  },
  {
    id: ROUTES.APP.SOW_TOOLS.id,
    to: ROUTES.APP.SOW_TOOLS.path,
    label: "SOW Tools",
    icon: FileText,
    group: "Tools",
  },
  {
    id: ROUTES.APP.DELIVERY_TOOLS.id,
    to: ROUTES.APP.DELIVERY_TOOLS.path,
    label: "Delivery Tools",
    icon: Truck,
    group: "Tools",
  },
  {
    id: ROUTES.APP.CSAT_TOOLS.id,
    to: ROUTES.APP.CSAT_TOOLS.path,
    label: "CSAT Tools",
    icon: SmilePlus,
    group: "Tools",
  },
  {
    id: ROUTES.APP.DATA_TOOLS.id,
    to: ROUTES.APP.DATA_TOOLS.path,
    label: "Data Tools",
    icon: Database,
    group: "Tools",
  },
  {
    id: ROUTES.APP.EMAIL_EXTRACTOR.id,
    to: ROUTES.APP.EMAIL_EXTRACTOR.path,
    label: "Email Extractor",
    icon: ClipboardList,
    group: "Tools",
  },
  {
    id: ROUTES.APP.KNOWLEDGE.id,
    to: ROUTES.APP.KNOWLEDGE.path,
    label: "Knowledge",
    icon: Brain,
    group: "Tools",
  },
  {
    id: ROUTES.APP.SLACK_ADMIN.id,
    to: ROUTES.APP.SLACK_ADMIN.path,
    label: "Slack Admin",
    icon: Hash,
    group: "Tools",
  },
  {
    id: ROUTES.APP.ZOOM_RECORDINGS.id,
    to: ROUTES.APP.ZOOM_RECORDINGS.path,
    label: "Zoom Recordings",
    icon: Video,
    group: "Tools",
  },
  {
    id: ROUTES.APP.WORKSPACE_ADMIN.id,
    to: ROUTES.APP.WORKSPACE_ADMIN.path,
    label: "Workspace Admin",
    icon: Mail,
    group: "Tools",
  },
  {
    id: ROUTES.APP.COMP_PLAN.id,
    to: ROUTES.APP.COMP_PLAN.path,
    label: "Comp Plan",
    icon: DollarSign,
    group: "Tools",
  },
  {
    id: ROUTES.APP.PROJECT_HANDOFF.id,
    to: ROUTES.APP.PROJECT_HANDOFF.path,
    label: "Project Handoff",
    icon: Briefcase,
    group: "Tools",
  },
  {
    id: ROUTES.APP.HIRING_TOOLS.id,
    to: ROUTES.APP.HIRING_TOOLS.path,
    label: "Hiring",
    icon: Users,
    group: "Tools",
  },
  // Resources
  {
    id: ROUTES.APP.ORG.id,
    to: ROUTES.APP.ORG.path,
    label: "Enterprise Work",
    icon: Zap,
    group: "Resources",
  },
  {
    id: ROUTES.APP.PEOPLE.id,
    to: ROUTES.APP.PEOPLE.path,
    label: "People",
    icon: Users,
    group: "Resources",
  },
  {
    id: ROUTES.APP.OPPORTUNITIES.id,
    to: ROUTES.APP.OPPORTUNITIES.path,
    label: "Opportunities",
    icon: LineChart,
    group: "Resources",
  },
  {
    id: ROUTES.APP.DELIVERY.id,
    to: ROUTES.APP.DELIVERY.path,
    label: "Delivery",
    icon: FolderGit2,
    group: "Resources",
  },
  {
    id: ROUTES.APP.LEARNING.id,
    to: ROUTES.APP.LEARNING.path,
    label: "Organization Learning",
    icon: BookOpen,
    group: "Resources",
  },
  {
    id: ROUTES.APP.LEARNING_OPS.id,
    to: ROUTES.APP.LEARNING_OPS.path,
    label: "Learning Ops",
    icon: ClipboardList,
    group: "Resources",
  },
  {
    id: ROUTES.APP.ACCREDITATIONS.id,
    to: ROUTES.APP.ACCREDITATIONS.path,
    label: "Accreditations",
    icon: GraduationCap,
    group: "Resources",
  },
  {
    id: ROUTES.APP.DOCUMENTS.id,
    to: ROUTES.APP.DOCUMENTS.path,
    label: "Documents",
    icon: FileText,
    group: "Resources",
  },
  // Agents
  {
    id: ROUTES.APP.AGENTS.id,
    to: ROUTES.APP.AGENTS.path,
    label: "Agents",
    icon: Bot,
    group: "Agents",
  },
  {
    id: ROUTES.APP.WORKFLOW_LEDGER.id,
    to: ROUTES.APP.WORKFLOW_LEDGER.path,
    label: "Workflow Ledger",
    icon: ClipboardList,
    group: "Agents",
  },
  // System
  {
    id: ROUTES.APP.INTEGRATIONS.id,
    to: ROUTES.APP.INTEGRATIONS.path,
    label: "Integrations",
    icon: FolderKanban,
    group: "System",
  },
  {
    id: ROUTES.APP.MCP.id,
    to: ROUTES.APP.MCP.path,
    label: "MCP",
    icon: LayoutDashboard,
    group: "System",
  },
  {
    id: ROUTES.APP.ROLES.id,
    to: ROUTES.APP.ROLES.path,
    label: "Roles",
    icon: Shield,
    group: "System",
  },
  {
    id: ROUTES.APP.SETUP.id,
    to: ROUTES.APP.SETUP.path,
    label: "Setup",
    icon: Settings,
    group: "System",
  },
  {
    id: "signout",
    to: ROUTES.AUTH.LOGIN.path,
    label: "Sign Out",
    icon: LogOut,
    isSignOut: true,
    group: "System",
  },
];

const groups = ["Operations", "Tools", "Resources", "Agents", "System"];

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { canAccess, givenRole, loading } = usePermissions();

  // Items that require at minimum Admin givenRole — regardless of fine-grained userRole
  // NOTE: Zoom Recordings is intentionally NOT here. It is a deny-by-default
  // fine-grained permission (tools/zoom-recordings) that defaults to Admin /
  // Super-Admin only, but can be explicitly granted to other users via Roles.
  const ADMIN_ONLY_IDS = useMemo(
    () =>
      new Set<string>([
        ROUTES.APP.ROLES.id,
        ROUTES.APP.LEARNING.id,
      ]),
    [],
  );

  // Items that require Super-Admin givenRole — regardless of fine-grained userRole
  const SUPER_ADMIN_ONLY_IDS = useMemo(
    () => new Set<string>([ROUTES.APP.HIRING_TOOLS.id]),
    [],
  );

  const isAdminOrAbove = useMemo(
    () => givenRole === "Admin" || givenRole === "Super-Admin",
    [givenRole],
  );

  const isSuperAdmin = useMemo(
    () => givenRole === "Super-Admin",
    [givenRole],
  );

  const filteredTopLevel = useMemo(
    () =>
      topLevelItems.filter((item) => {
        const key = NAV_ID_TO_PERMISSION[item.id];
        return !key || canAccess(key);
      }),
    [canAccess],
  );

  const filteredNavItems = useMemo(
    () =>
      navigationItems.filter((item) => {
        if (item.isSignOut) return true;
        const key = NAV_ID_TO_PERMISSION[item.id];
        const hasPerms = !key || canAccess(key);

        // Super-Admin only items — still respect fine-grained permission so the
        // user can hide the item from their own sidebar by unchecking it.
        if (SUPER_ADMIN_ONLY_IDS.has(item.id)) return isSuperAdmin && hasPerms;

        // Roles tab: only Admin / Super-Admin IN ADDITION to fine-grained permissions
        if (ADMIN_ONLY_IDS.has(item.id)) return isAdminOrAbove && hasPerms;

        return hasPerms;
      }),
    [canAccess, isAdminOrAbove, isSuperAdmin, ADMIN_ONLY_IDS, SUPER_ADMIN_ONLY_IDS],
  );

  const visibleGroups = useMemo(
    () =>
      groups.filter((group) =>
        filteredNavItems.some((item) => item.group === group),
      ),
    [filteredNavItems],
  );

  // Track last explicitly clicked nav item id
  const lastClickedId = useRef<string | null>(
    sessionStorage.getItem(ACTIVE_NAV_KEY),
  );

  const activeId = useMemo(() => {
    const currentPath = location.pathname;
    const allItems = [...filteredTopLevel, ...filteredNavItems];

    // 1. Exact match
    const exact = allItems.find((item) => item.to === currentPath);
    if (exact) return exact.id;

    // 2. Check state.from
    const fromId = (location.state as any)?.from;
    if (fromId && allItems.find((item) => item.id === fromId)) {
      return fromId;
    }

    // 3. Prefix match fallback
    const prefixMatches = allItems.filter(
      (item) =>
        !("isSignOut" in item && item.isSignOut) &&
        item.to !== "/" &&
        currentPath.startsWith(item.to),
    );
    if (prefixMatches.length === 0) return null;
    return prefixMatches.reduce((best, item) =>
      item.to.length > best.to.length ? item : best,
    ).id;
  }, [location.pathname, filteredTopLevel, filteredNavItems, location.state]);

  const handleNavClick = (id: string) => {
    lastClickedId.current = id;
    sessionStorage.setItem(ACTIVE_NAV_KEY, id);
  };

  const handleSignOut = async () => {
    sessionStorage.removeItem(ACTIVE_NAV_KEY);
    await auth?.signOut();
  };

  if (loading) return null; // Prevent showing items while loading, but after hooks are declared

  return (
    <div className="flex min-h-screen no-scrollbar relative">
      <Sidebar>
        <SidebarContent className="no-scrollbar">
          <div className="flex items-center gap-2 border-b-2 border-b-gray-200 px-2 py-3 sticky top-0 z-10 backdrop-blur-xl">
            <img src={aerostackLogo} alt="Aerostack" className="w-8 h-8 rounded" />
            <h1 className="text-xl font-bold">Aerostack</h1>
          </div>

          {/* Top-level standalone nav items */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredTopLevel.map(({ id, to, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeId === id}
                      className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground hover:data-[active=true]:bg-primary/90"
                    >
                      <NavLink
                        to={to}
                        onClick={() => handleNavClick(id)}
                        className="flex gap-2 items-center"
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {visibleGroups.map((group) => (
            <Collapsible key={group} defaultOpen className="group/collapsible">
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="cursor-pointer">
                    <span className="flex items-center justify-between w-full">
                      {group}
                      <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </span>
                  </SidebarGroupLabel>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {filteredNavItems
                        .filter((item) => item.group === group)
                        .map(({ id, to, label, icon: Icon, isSignOut }) => (
                          <SidebarMenuItem key={id}>
                            <SidebarMenuButton
                              asChild
                              isActive={activeId === id}
                              className="data-[active=true]:bg-primary data-[active=true]:text-primary-foreground hover:data-[active=true]:bg-primary/90"
                            >
                              <NavLink
                                to={to}
                                onClick={(e) => {
                                  if (isSignOut) {
                                    e.preventDefault();
                                    handleSignOut();
                                  } else {
                                    handleNavClick(id);
                                  }
                                }}
                                className="flex gap-2 items-center"
                              >
                                <Icon className="h-4 w-4" />
                                <span>{label}</span>
                              </NavLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ))}
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
