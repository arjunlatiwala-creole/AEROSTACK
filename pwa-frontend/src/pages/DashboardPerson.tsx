import "@/lib/ag-grid-config";
import React, { useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgGridReact } from "ag-grid-react";
import { getPersonByEmail, upsertPersonInformation } from "@/api/people-ops";
import toast from "react-hot-toast";
import NoData from "@/components/NoData";
import Loader from "@/components/Loader";
import { fetchAuthSession } from "aws-amplify/auth";
import { useNavigate } from "react-router";
import { ROUTES } from "@/lib/routes-config";
import { cn } from "@/lib/utils";
import AccreditedLearningCard from "@/components/aerostack/AccreditedLearningCard";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Address {
  country: string;
  lineTwo: string | null;
  streetAddress: string;
  postalCode: string;
  locality: string;
  region: string;
  type: string;
}

interface PersonLoop {
  loop_id: string;
  title: string;
  category: string;
  priority: number;
  status: string;
  target_completion_date: string;
  outcome_score?: number;
  effort_score?: number;
  description?: string;
}

interface Opportunity {
  opportunityId: string;
  title: string;
  companyName: string;
  stage: string;
  amount: number;
  closeDate: string;
  pipeline: string;
  ownerName: string;
  ownerEmail: string;
  contacts: any[];
  createdAt: string;
  updatedAt: string;
}

interface PersonProject {
  id: string;
  name: string;
  status_name: string;
  priority: string | null;
  progress: number;
  leadName: string | null;
  leadEmail: string | null;
  teams: { name: string }[];
  targetDate: string | null;
  startDate: string | null;
  totalIssues: number;
  completedIssues: number;
  url: string | null;
}

interface PersonDashboard {
  person_id: string;
  name: string;
  given_name: string;
  family_name: string;
  email: string;
  alternate_email?: string;
  job_title: string;
  department: Record<string, any>;
  title: string;
  direct_reports: string[];
  level: number;
  employment_status: string;
  addresses: Address[];
  start_date: string;
  active_loops?: number;
  avg_score?: number;
  velocity_score?: number;
  completed_loops?: number;
  loops?: PersonLoop[];
  details_source?: string;
  needs_details?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeStatus = (status: string) => {
  if (status === "BACKLOG" || status === "IN_PROGRESS") return "active";
  if (status === "COMPLETED") return "completed";
  return status.toLowerCase();
};

// Simple cache to prevent full-page reload on back navigation
const personDashboardCache = {
  email: "" as string | null,
  row: null as PersonDashboard | null,
  loops: [] as PersonLoop[],
  needsDetails: false as boolean,
  opportunities: [] as Opportunity[],
  opportunitiesFetched: false as boolean,
  projects: [] as PersonProject[],
  projectsFetched: false as boolean,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPerson() {
  const navigate = useNavigate();

  // ── Core state ─────────────────────────────────────────────────────────────
  const [email, setEmail] = React.useState("");
  const [row, setRow] = React.useState<PersonDashboard | null>(() => {
    return personDashboardCache.row;
  });
  const [loops, setLoops] = React.useState<PersonLoop[]>(() => {
    return personDashboardCache.loops;
  });
  const [loading, setLoading] = React.useState(() => {
    return !personDashboardCache.row;
  });
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [needsDetails, setNeedsDetails] = React.useState(() => {
    return personDashboardCache.needsDetails;
  });
  const [showAddDetails, setShowAddDetails] = React.useState(false);
  const [savingDetails, setSavingDetails] = React.useState(false);
  const [formErrors, setFormErrors] = React.useState<Record<string, boolean>>(
    {},
  );

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = React.useState<
    "loops" | "opportunities" | "projects"
  >("opportunities");

  // ── Opportunities state ─────────────────────────────────────────────────────
  const [opportunities, setOpportunities] = React.useState<Opportunity[]>(() => {
    return personDashboardCache.opportunities;
  });
  const [opportunitiesLoading, setOpportunitiesLoading] = React.useState(false);
  const [opportunitiesFetched, setOpportunitiesFetched] = React.useState<boolean>(() => {
    return personDashboardCache.opportunitiesFetched;
  });

  // ── Projects state ──────────────────────────────────────────────────────────
  const [projects, setProjects] = React.useState<PersonProject[]>(() => {
    return personDashboardCache.projects;
  });
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [projectsFetched, setProjectsFetched] = React.useState<boolean>(() => {
    return personDashboardCache.projectsFetched;
  });

  // Track which tabs have already been fetched (to avoid re-fetching)
  const opportunitiesFetchedForEmail = React.useRef<string | null>(
    personDashboardCache.opportunitiesFetched ? personDashboardCache.email : null
  );
  const projectsFetchedForEmail = React.useRef<string | null>(
    personDashboardCache.projectsFetched ? personDashboardCache.email : null
  );

  // ── Form state ──────────────────────────────────────────────────────────────
  const [formData, setFormData] = React.useState({
    given_name: "",
    family_name: "",
    alternate_email: "",
    employment_status: "active",
    job_title: "",
    title: "",
    level: "",
    start_date: "",
    direct_reports: "",
    address_type: "home",
    streetAddress: "",
    lineTwo: "",
    locality: "",
    region: "",
    postalCode: "",
    country: "",
  });

  // ── Pagination ──────────────────────────────────────────────────────────────
  const PAGE_SIZES = [20, 50, 100];
  const [pageSize, setPageSize] = React.useState(20);
  const [currentPage, setCurrentPage] = React.useState(1);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [showCompleted, loops]);

  // ── Pagination — Opportunities ──────────────────────────────────────────────────────
  const [oppPageSize, setOppPageSize] = React.useState(20);
  const [oppCurrentPage, setOppCurrentPage] = React.useState(1);

  React.useEffect(() => {
    setOppCurrentPage(1);
  }, [opportunities]);

  // ── Pagination — Projects ────────────────────────────────────────────────
  const [projPageSize, setProjPageSize] = React.useState(20);
  const [projCurrentPage, setProjCurrentPage] = React.useState(1);

  React.useEffect(() => {
    setProjCurrentPage(1);
  }, [projects]);

  const hasAutoLoadedRef = React.useRef(false);

  // ── Load session email ──────────────────────────────────────────────────────
  React.useEffect(() => {
    const loadEmail = async () => {
      try {
        // Dev mode bypass — skip Cognito calls with placeholder credentials
        if (import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX') {
          setEmail('dev@local');
          return;
        }
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        setEmail(String(sessionEmail || ""));
      } catch (err) {
        console.warn("Failed to load session email", err);
      }
    };
    loadEmail();
  }, []);

  // ── Load loops + person metadata ────────────────────────────────────────────
  const load = useCallback(async (showSpinner = true) => {
    if (!email) {
      toast.error("No authenticated email found in session");
      return;
    }

    if (showSpinner) {
      setLoading(true);
    }

    // Reset cache if email changed
    if (personDashboardCache.email !== email) {
      personDashboardCache.email = email;
      personDashboardCache.row = null;
      personDashboardCache.loops = [];
      personDashboardCache.needsDetails = false;
      personDashboardCache.opportunities = [];
      personDashboardCache.opportunitiesFetched = false;
      personDashboardCache.projects = [];
      personDashboardCache.projectsFetched = false;

      opportunitiesFetchedForEmail.current = null;
      projectsFetchedForEmail.current = null;
      setOpportunitiesFetched(false);
      setProjectsFetched(false);
      setOpportunities([]);
      setProjects([]);
    }

    try {
      const res = await getPersonByEmail(email, "loops");
      if (res?.success && res?.data) {
        const personData: PersonDashboard = res.data;
        setRow(personData);
        setLoops(personData.loops || []);
        setNeedsDetails(personData.needs_details === true);

        // Update cache
        personDashboardCache.email = email;
        personDashboardCache.row = personData;
        personDashboardCache.loops = personData.loops || [];
        personDashboardCache.needsDetails = personData.needs_details === true;
      } else {
        setRow(null);
        setLoops([]);
        setNeedsDetails(false);
      }
    } catch (err: any) {
      console.error("Error loading personal data:", err);
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ── Lazy-fetch opportunities when tab is first opened ────────────────────────
  const fetchOpportunities = useCallback(async () => {
    if (opportunitiesFetchedForEmail.current === email) return; // already fetched
    opportunitiesFetchedForEmail.current = email;
    setOpportunitiesLoading(true);
    try {
      const res = await getPersonByEmail(email, "opportunities");
      const deals = res?.data?.deals ?? [];
      setOpportunities(deals);

      // Update cache
      personDashboardCache.opportunities = deals;
      personDashboardCache.opportunitiesFetched = true;
    } catch (err) {
      console.error("Error loading opportunities:", err);
      setOpportunities([]);
    } finally {
      setOpportunitiesLoading(false);
      setOpportunitiesFetched(true);
    }
  }, [email]);

  // ── Lazy-fetch projects when tab is first opened ─────────────────────────────
  const fetchProjects = useCallback(async () => {
    if (projectsFetchedForEmail.current === email) return; // already fetched
    projectsFetchedForEmail.current = email;
    setProjectsLoading(true);
    try {
      const res = await getPersonByEmail(email, "projects");
      const projs = res?.data?.projects ?? [];
      setProjects(projs);

      // Update cache
      personDashboardCache.projects = projs;
      personDashboardCache.projectsFetched = true;
    } catch (err) {
      console.error("Error loading projects:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
      setProjectsFetched(true);
    }
  }, [email]);

  // Auto-load when email is ready
  React.useEffect(() => {
    if (email) {
      const isCacheValid = personDashboardCache.email === email && personDashboardCache.row;
      if (!isCacheValid) {
        load(true);
      } else {
        load(false); // background refresh
      }
    }
  }, [email, load]);

  // Lazy-fetch tab data when activeTab changes or row is loaded
  React.useEffect(() => {
    if (row && email) {
      if (activeTab === "opportunities") {
        fetchOpportunities();
      } else if (activeTab === "projects") {
        fetchProjects();
      }
    }
  }, [row, email, activeTab, fetchOpportunities, fetchProjects]);

  // ── Handle tab switch — lazy-fetch on first visit ───────────────────────────
  const handleTabChange = useCallback(
    (tab: "loops" | "opportunities" | "projects") => {
      setActiveTab(tab);
      if (tab === "opportunities") fetchOpportunities();
      if (tab === "projects") fetchProjects();
    },
    [fetchOpportunities, fetchProjects],
  );

  // ── Form validation ─────────────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const errors: Record<string, boolean> = {};
    if (!formData.given_name.trim()) errors.given_name = true;
    if (!formData.family_name.trim()) errors.family_name = true;
    if (!formData.job_title.trim()) errors.job_title = true;
    if (!formData.title.trim()) errors.title = true;
    if (!formData.level.trim()) errors.level = true;
    if (!formData.start_date.trim()) errors.start_date = true;
    if (!formData.streetAddress.trim()) errors.streetAddress = true;
    if (!formData.locality.trim()) errors.locality = true;
    if (!formData.region.trim()) errors.region = true;
    if (!formData.postalCode.trim()) errors.postalCode = true;
    if (!formData.country.trim()) errors.country = true;
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Save details ────────────────────────────────────────────────────────────
  const handleSaveDetails = async () => {
    if (!validateForm()) {
      toast.error("Please fill in all required fields");
      setSavingDetails(false);
      return;
    }

    setSavingDetails(true);
    try {
      let resolvedEmail = email || "";

      // Dev mode bypass — skip Cognito calls with placeholder credentials
      if (!(import.meta.env.DEV && import.meta.env.VITE_AWS_USER_POOL_ID === 'us-east-1_XXXXXXXXX')) {
        const session = await fetchAuthSession({ forceRefresh: false });
        const sessionEmail =
          session.tokens?.idToken?.payload?.email ||
          session.tokens?.accessToken?.payload?.username ||
          "";
        resolvedEmail = String(sessionEmail || email || "");
      }

      if (!resolvedEmail) {
        toast.error("No authenticated email found in session");
        setSavingDetails(false);
        return;
      }

      const directReports = formData.direct_reports
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const hasAddress = [
        formData.streetAddress,
        formData.lineTwo,
        formData.locality,
        formData.region,
        formData.postalCode,
        formData.country,
      ].some((val) => val && val.trim() !== "");

      const payload = {
        email: resolvedEmail,
        given_name: formData.given_name,
        family_name: formData.family_name,
        alternate_email: formData.alternate_email,
        employment_status: formData.employment_status,
        job_title: formData.job_title,
        title: formData.title,
        level: Number(formData.level || 0),
        start_date: formData.start_date || null,
        direct_reports: directReports,
        addresses: hasAddress
          ? [
            {
              type: formData.address_type || "home",
              streetAddress: formData.streetAddress,
              lineTwo: formData.lineTwo || null,
              locality: formData.locality,
              region: formData.region,
              postalCode: formData.postalCode,
              country: formData.country,
            },
          ]
          : [],
      };

      const response = await upsertPersonInformation(payload);
      if (response.success) {
        toast.success("Details saved");
        setShowAddDetails(false);
        setFormErrors({});
        await load();
      } else {
        toast.error(response.error || "Failed to save details");
      }
    } catch (err: any) {
      console.error("Error saving details:", err);
      toast.error(
        err.response?.data?.error ||
        "Failed to save details. Please try again.",
      );
    } finally {
      setSavingDetails(false);
    }
  };

  // ── Formatters & color helpers ──────────────────────────────────────────────
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "inactive":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getCategoryColor = (category: string) => {
    if (category === "LEARNING" || category === "OAL")
      return "bg-purple-100 text-purple-800 border-purple-200";
    if (category === "ENG" || category === "MSP")
      return "bg-blue-100 text-blue-800 border-blue-200";
    if (category === "BD" || category === "GTM")
      return "bg-green-100 text-green-800 border-green-200";
    if (
      category.startsWith("OPS:") ||
      category === "LND" ||
      category === "PRO-DEV" ||
      category === "PRO_DEV" ||
      category === "ADVISORY"
    )
      return "bg-orange-100 text-orange-800 border-orange-200";
    return "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getCategoryGroup = (category: string): string => {
    if (category === "LEARNING" || category === "OAL") return "Learning";
    if (category === "ENG" || category === "MSP") return "Technical Delivery";
    if (category === "BD" || category === "GTM") return "Customer Projects";
    if (
      category.startsWith("OPS:") ||
      category === "LND" ||
      category === "PRO-DEV" ||
      category === "PRO_DEV" ||
      category === "ADVISORY"
    )
      return "Internal Operations";
    return "Other";
  };

  const getPriorityLabel = (priority: number) => `P${priority}`;

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 0:
      case 1:
        return "bg-red-100 text-red-800 border-red-200";
      case 2:
        return "bg-orange-100 text-orange-800 border-orange-200";
      case 3:
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case 4:
      case 5:
        return "bg-green-100 text-green-800 border-green-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getLoopStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "completed":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "paused":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "cancelled":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "Closed Won":
        return "bg-green-100 text-green-800 border-green-200";
      case "Negotiation":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "Proposal":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "Discovery":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "Closed Lost":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };
  type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";
  type Phase =
    | "LEAD"
    | "DEVELOPING"
    | "ACTIVELY_FUNDING"
    | "CLOSED_WON"
    | "CLOSED_LOST"
    | "LAUNCHED"
    | "PROPOSED";
  const HEALTH_COLORS: Record<HealthStatus, string> = {
    GREEN: "text-emerald-500",
    YELLOW: "text-yellow-400",
    ORANGE: "text-orange-500",
    RED: "text-red-500",
  };

  const PHASE_NODE_COLORS: Record<Phase, string> = {
    LEAD: "#E8F5E9",
    DEVELOPING: "#FFF9C4",
    ACTIVELY_FUNDING: "#FFE082",
    CLOSED_WON: "#C8E6C9",
    CLOSED_LOST: "#FFCDD2",
    LAUNCHED: "#7abbf0",
    PROPOSED: "#E1BEE7",
  };
  // ── Loops pagination ────────────────────────────────────────────────────────
  const displayedLoops = useMemo(() => {
    const internalProjectLoops = loops.filter(
      (l) => !["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category),
    );
    return showCompleted
      ? internalProjectLoops.filter((l) => normalizeStatus(l.status) === "completed")
      : internalProjectLoops.filter((l) => normalizeStatus(l.status) === "active");
  }, [loops, showCompleted]);

  const activeInternalProjectsCount = useMemo(() => {
    return loops.filter(
      (l) =>
        !["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category) &&
        normalizeStatus(l.status) === "active",
    ).length;
  }, [loops]);

  const completedInternalProjectsCount = useMemo(() => {
    return loops.filter(
      (l) =>
        !["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category) &&
        normalizeStatus(l.status) === "completed",
    ).length;
  }, [loops]);

  const totalCount = displayedLoops.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const pagedLoops = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return displayedLoops.slice(start, start + pageSize);
  }, [displayedLoops, currentPage, pageSize]);

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // ── Opportunities pagination derived values ─────────────────────────────────
  const oppTotalCount = opportunities.length;
  const oppTotalPages = Math.max(1, Math.ceil(oppTotalCount / oppPageSize));
  const pagedOpportunities = opportunities.slice(
    (oppCurrentPage - 1) * oppPageSize,
    oppCurrentPage * oppPageSize,
  );
  const oppHasPrev = oppCurrentPage > 1;
  const oppHasNext = oppCurrentPage < oppTotalPages;

  // ── Projects pagination derived values ─────────────────────────────────────
  const projTotalCount = projects.length;
  const projTotalPages = Math.max(1, Math.ceil(projTotalCount / projPageSize));
  const pagedProjects = projects.slice(
    (projCurrentPage - 1) * projPageSize,
    projCurrentPage * projPageSize,
  );
  const projHasPrev = projCurrentPage > 1;
  const projHasNext = projCurrentPage < projTotalPages;

  // ── AG Grid column defs — Loops ─────────────────────────────────────────────
  const columnDefs: any = useMemo(
    () => [
      {
        field: "title",
        headerName: "Title",
        flex: 3,
        cellRenderer: (params: any) => (
          <div className="flex flex-col py-2">
            <Button
              variant="link"
              className="text-yellow-600 font-bold hover:font-semibold p-0 h-auto text-left justify-start"
              onClick={() => {
                navigate(
                  ROUTES.APP.LOOP.path.replace(":loopId", params.data.loop_id),
                  {
                    state: {
                      loopId: params.data.loop_id,
                      from: ROUTES.APP.PERSON.id,
                    },
                  },
                );
              }}
            >
              {params.value}
            </Button>
            {params.data.description && (
              <div className="text-xs text-gray-500 mt-1">
                {params.data.description}
              </div>
            )}
          </div>
        ),
        autoHeight: true,
      },
      {
        field: "category",
        headerName: "Category",
        flex: 1.5,
        cellRenderer: (params: any) => {
          const category = params.value;
          const displayNames: Record<string, string> = {
            OAL: "OAL",
            "PRO-DEV": "PRO-DEV",
            ONBOARDING: "ONBOARDING",
            COMMS_FLUENCY: "FLUENCY",
          };
          const label = displayNames[category] || category;
          return (
            <div className="flex flex-col gap-1">
              <Badge className={getCategoryColor(category)}>{label}</Badge>
              <span className="text-xs text-gray-500">
                {getCategoryGroup(category)}
              </span>
            </div>
          );
        },
      },
      {
        field: "priority",
        headerName: "Priority",
        flex: 0.8,
        cellRenderer: (params: any) => (
          <Badge className={getPriorityColor(params.value)}>
            {getPriorityLabel(params.value)}
          </Badge>
        ),
      },
      {
        field: "target_completion_date",
        headerName: "Target Date",
        flex: 1.2,
        valueFormatter: (params: any) =>
          params.value ? formatDate(params.value) : "-",
      },
      {
        field: "effort_score",
        headerName: "Effort",
        flex: 0.7,
        cellRenderer: (params: any) =>
          params.value !== undefined ? (
            <span className="text-gray-700">{params.value}/5</span>
          ) : (
            <span className="text-gray-400">-</span>
          ),
      },
      {
        field: "outcome_score",
        headerName: "Outcome",
        flex: 0.7,
        cellRenderer: (params: any) =>
          params.value !== undefined ? (
            <span
              className={
                normalizeStatus(params.data.status) === "completed"
                  ? "text-green-600 font-semibold"
                  : "text-gray-700"
              }
            >
              {params.value}/5
            </span>
          ) : (
            <span className="text-gray-400">-</span>
          ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 0.9,
        cellRenderer: (params: any) => {
          const s = normalizeStatus(params.value);
          return (
            <Badge className={getLoopStatusColor(s)}>{s.toUpperCase()}</Badge>
          );
        },
      },
    ],
    [navigate],
  );

  // ── AG Grid column defs — Opportunities ────────────────────────────────────
  const opportunityColumnDefs: any = useMemo(
    () => [
      {
        field: "name",
        headerName: "OppDev Name",
        flex: 2,
        filter: true,
        cellRenderer: (params: any) => (
          <button
            className="text-left font-medium hover:underline hover:text-blue-600"
            onClick={() =>
              navigate(
                `/revops/dealdetail/${params.data.deal_id || params.data.id}`,
                { state: { from: ROUTES.APP.PERSON.id } },
              )
            }
          >
            {params.value || "-"}
          </button>
        ),
      },
      {
        field: "stage_name",
        headerName: "Aerostack LifeCycle",
        flex: 1.2,
        filter: true,
      },
      {
        field: "ownerEmail",
        headerName: "Enterprise Owner",
        flex: 1.5,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "companyOwnerEmail",
        headerName: "Customer Owner",
        flex: 1.5,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "companyName",
        headerName: "Company",
        flex: 1,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },

      {
        field: "phase",
        headerName: "Phase",
        flex: 1,
        cellStyle: (params: { value: Phase }) => ({
          backgroundColor: PHASE_NODE_COLORS[params.value] || "#fff",
        }),
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "amount",
        headerName: "Amount",
        flex: 1,
        valueFormatter: (p: any) =>
          p.value ? `$${Number(p.value).toLocaleString()}` : "-",
      },
      {
        field: "health_status",
        headerName: "Health",
        flex: 1,
        cellRenderer: (params: { value: HealthStatus }) => (
          <span className={cn("font-bold", HEALTH_COLORS[params.value] || "")}>
            ● {params.value || "-"}
          </span>
        ),
      },
      {
        field: "closedate",
        headerName: "Target Close Date",
        flex: 1.5,
        filter: true,
        valueFormatter: ({ value }: { value: string }) =>
          value ? value.split("T")[0].split("-").reverse().join("/") : "",
      },
      {
        field: "contacts",
        headerName: "Contacts",
        flex: 2,
        valueFormatter: (params: { value: { fullName: string }[] }) =>
          params.value
            ?.map((c) => c.fullName)
            .filter(Boolean)
            .join(", ") || "-",
      },
    ],
    [navigate],
  );

  // ── AG Grid column defs — Projects ──────────────────────────────────────────
  const projectColumnDefs: any = useMemo(
    () => [
      {
        field: "name",
        headerName: "Customer Engagement Name",
        flex: 2.5,
        filter: true,
        cellRenderer: (params: any) => (
          <button
            className="text-left font-semibold text-yellow-600 hover:underline"
            onClick={() =>
              navigate(
                ROUTES.APP.PROJECT_DETAILS.path.replace(
                  ":projectId",
                  params.data.id.replace(/^proj_/, ""),
                ),
                { state: { from: ROUTES.APP.PERSON.id } },
              )
            }
          >
            {params.value || "-"}
          </button>
        ),
      },
      {
        field: "status_name",
        headerName: "Status",
        flex: 1.2,
        filter: true,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "priority",
        headerName: "Priority",
        flex: 0.9,
        filter: true,
        cellRenderer: (params: any) => {
          const v = params.value;
          if (!v) return <span className="text-gray-400 text-xs">—</span>;
          const cfg: Record<string, { dot: string; text: string }> = {
            Critical: { dot: "bg-red-500", text: "text-red-600" },
            High: { dot: "bg-orange-500", text: "text-orange-600" },
            Medium: { dot: "bg-yellow-400", text: "text-yellow-600" },
            Low: { dot: "bg-green-500", text: "text-green-600" },
            Minimal: { dot: "bg-gray-400", text: "text-gray-500" },
          };
          const c = cfg[v] ?? { dot: "bg-gray-300", text: "text-gray-500" };
          return (
            <div className="flex items-center gap-1.5 h-full">
              <span
                className={cn("h-2 w-2 rounded-full flex-shrink-0", c.dot)}
              />
              <span className={cn("text-xs font-medium", c.text)}>{v}</span>
            </div>
          );
        },
      },
      {
        field: "progress",
        headerName: "Progress",
        flex: 1.2,
        cellRenderer: (params: any) => {
          const pct: number = params.value ?? 0;
          const color =
            pct >= 75
              ? "bg-green-500"
              : pct >= 40
                ? "bg-yellow-400"
                : "bg-red-400";
          return (
            <div className="flex items-center gap-2 h-full">
              <div className="flex-1 rounded-full bg-gray-200 h-2">
                <div
                  className={`h-2 rounded-full ${color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs w-8 text-right">{pct}%</span>
            </div>
          );
        },
      },
      {
        field: "leadName",
        headerName: "Lead",
        flex: 1.2,
        valueFormatter: (p: any) => p.value || "-",
      },
      {
        field: "teams",
        headerName: "Teams",
        flex: 1.5,
        sortable: false,
        filter: false,
        autoHeight: true,
        cellRenderer: (params: any) => {
          const teams: { name: string }[] = params.value ?? [];
          if (!teams.length)
            return <span className="text-gray-400 text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-1 py-1">
              {teams.map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 border border-blue-200 whitespace-nowrap"
                >
                  {t.name}
                </span>
              ))}
            </div>
          );
        },
      },
      {
        headerName: "Key Results",
        flex: 1.5,
        sortable: false,
        filter: false,
        autoHeight: true,
        valueFormatter: (p: any) => {
          return `${p.data?.completedIssues ?? 0}/${p.data?.totalIssues ?? 0}`;
        },
      },
      {
        field: "targetDate",
        headerName: "Due Date",
        flex: 1.1,
        valueFormatter: (p: any) => (p.value ? p.value.split("T")[0] : "-"),
      },
    ],
    [navigate],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="container mx-auto p-4 space-y-6" role="main">
      <h1
        className="text-3xl font-bold mb-6"
        tabIndex={0}
        aria-label="Person Dashboard"
      >
        Person Dashboard
      </h1>

      {/* Search Section */}
      {/* <Card
        className="shadow-sm"
        role="region"
        aria-labelledby="search-section"
      >
        <CardContent className="pt-6" id="search-section">
          <div className="flex gap-2 items-start">
            <label htmlFor="email-input" className="sr-only">
              Signed in email
            </label>
            <Input
              id="email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@enterprise.io"
              className="shadow-none"
              aria-required="true"
            />
            <Button
              onClick={load}
              disabled={loading || !email}
              aria-busy={loading}
              aria-live="polite"
            >
              {loading ? "Loading..." : "Load"}
            </Button>
          </div>
        </CardContent>
      </Card> */}

      {loading ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Loader description="Loading personal details..." />
        </div>
      ) : row ? (
        <div className="space-y-6">
          {/* Performance Metrics */}
          {(row.active_loops !== undefined ||
            row.avg_score !== undefined ||
            row.velocity_score !== undefined ||
            row.completed_loops !== undefined) && (
              <Card
                className="shadow-sm"
                role="region"
                aria-labelledby="performance-metrics"
              >
                <CardHeader>
                  <CardTitle id="performance-metrics">
                    Performance Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {row.active_loops !== undefined && (
                      <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-sm font-medium text-blue-600">
                          Active Internal Projects
                        </p>
                        <p className="text-3xl font-bold text-blue-900">
                          {activeInternalProjectsCount}
                        </p>
                      </div>
                    )}
                    {row.completed_loops !== undefined && (
                      <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
                        <p className="text-sm font-medium text-green-600">
                          Completed
                        </p>
                        <p className="text-3xl font-bold text-green-900">
                          {completedInternalProjectsCount}
                        </p>
                      </div>
                    )}
                    {row.avg_score !== undefined && (
                      <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
                        <p className="text-sm font-medium text-purple-600">
                          Avg Score
                        </p>
                        <p className="text-3xl font-bold text-purple-900">
                          {row.avg_score.toFixed(1)}
                        </p>
                      </div>
                    )}
                    {row.velocity_score !== undefined && (
                      <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-200">
                        <p className="text-sm font-medium text-orange-600">
                          Velocity (90d)
                        </p>
                        <p className="text-3xl font-bold text-orange-900">
                          {row.velocity_score.toFixed(1)}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* ── Accredited Learning ────────────────────────────────────────────── */}
          <AccreditedLearningCard email={email} loops={loops} />

          {/* ── Activity & Goals — Tabbed Card ────────────────────────────────── */}
          <Card
            className="shadow-sm border-2 border-blue-200"
            role="region"
            aria-labelledby="activity-goals"
          >
            <CardHeader>
              <div className="flex justify-between items-start flex-wrap gap-3">
                <div>
                  <CardTitle id="activity-goals" className="text-2xl">
                    My Activity & Goals
                  </CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Your assigned objectives, OppDev, Customer Engagements, and
                    learning initiatives
                  </p>
                </div>

                {/* Right-side controls — contextual per tab */}
                <div className="flex gap-3 items-center flex-wrap">
                  {activeTab === "loops" && (
                    <>
                      <Badge variant="outline" className="text-xs">
                        {
                          loops.filter(
                            (l) =>
                              !["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category) &&
                              normalizeStatus(l.status) === "active",
                          ).length
                        }{" "}
                        Active
                        {" | "}
                        {
                          loops.filter(
                            (l) =>
                              !["OAL", "COMMS_FLUENCY", "PRO-DEV", "ONBOARDING"].includes(l.category) &&
                              normalizeStatus(l.status) === "completed",
                          ).length
                        }{" "}
                        Completed
                      </Badge>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={!showCompleted ? "default" : "outline"}
                          onClick={() => setShowCompleted(false)}
                        >
                          Active
                        </Button>
                        <Button
                          size="sm"
                          variant={showCompleted ? "default" : "outline"}
                          onClick={() => setShowCompleted(true)}
                        >
                          Completed
                        </Button>
                      </div>
                    </>
                  )}
                  {activeTab === "opportunities" && !opportunitiesLoading && (
                    <Badge variant="outline" className="text-xs">
                      {opportunities.length} OppDev
                    </Badge>
                  )}
                  {activeTab === "projects" && !projectsLoading && (
                    <Badge variant="outline" className="text-xs">
                      {projects.length} Customer Engagements
                    </Badge>
                  )}
                </div>
              </div>

              {/* ── Tab Switcher ── */}
              <div className="flex gap-0 mt-3 border-b border-gray-200">
                <button
                  onClick={() => handleTabChange("opportunities")}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "opportunities"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  OppDev
                </button>
                <button
                  onClick={() => handleTabChange("projects")}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "projects"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Customer Engagements
                </button>
                <button
                  onClick={() => handleTabChange("loops")}
                  className={`px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${activeTab === "loops"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Internal Projects
                </button>
              </div>
            </CardHeader>

            <CardContent>
              {/* ══ LOOPS TAB ══════════════════════════════════════════════════ */}
              {activeTab === "loops" && (
                <>
                  {displayedLoops.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <p className="text-sm mt-4">
                        No {showCompleted ? "completed" : "active"} internal projects found
                      </p>
                    </div>
                  ) : (
                    <div className="mx-4 mb-4 border rounded-lg overflow-hidden flex flex-col">
                      <div className="h-[360px]">
                        <div className="ag-theme-alpine h-full w-full">
                          <AgGridReact
                            theme="legacy"
                            rowData={pagedLoops}
                            columnDefs={columnDefs}
                            pagination={false}
                            defaultColDef={{
                              sortable: true,
                              filter: true,
                              resizable: true,
                            }}
                            rowHeight={80}
                          />
                        </div>
                      </div>

                      {/* Loops footer */}
                      <div className="flex items-center justify-between border-t bg-white px-4 py-2">
                        <span className="text-sm text-muted-foreground">
                          Showing {pagedLoops.length} of {totalCount} Internal Projects
                        </span>
                        <div className="flex items-center gap-3">
                          <select
                            value={pageSize}
                            onChange={(e) => {
                              setPageSize(Number(e.target.value));
                              setCurrentPage(1);
                            }}
                            className="h-8 rounded border px-2 text-sm bg-background"
                          >
                            {PAGE_SIZES.map((s) => (
                              <option key={s} value={s}>
                                {s} / page
                              </option>
                            ))}
                          </select>
                          <span className="text-sm text-muted-foreground">
                            Page {currentPage} of {totalPages}
                          </span>
                          <div className="flex gap-1">
                            <button
                              disabled={!hasPrev}
                              onClick={() => setCurrentPage((p) => p - 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ◀
                            </button>
                            <button
                              disabled={!hasNext}
                              onClick={() => setCurrentPage((p) => p + 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ▶
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ══ OPPORTUNITIES TAB ══════════════════════════════════════════ */}
              {activeTab === "opportunities" && (
                <>
                  {/* Spinner while API call is in flight */}
                  {opportunitiesLoading && (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
                      <p className="text-sm">Loading OppDev...</p>
                    </div>
                  )}

                  {/* Empty state — shown after a successful fetch with no results */}
                  {!opportunitiesLoading &&
                    opportunitiesFetched &&
                    opportunities.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-sm mt-4">No OppDev found</p>
                      </div>
                    )}

                  {/* Data grid */}
                  {!opportunitiesLoading && opportunities.length > 0 && (
                    <div className="mx-4 mb-4 border rounded-lg overflow-hidden flex flex-col">
                      <div className="h-[360px]">
                        <div className="ag-theme-alpine h-full w-full">
                          <AgGridReact
                            theme="legacy"
                            rowData={pagedOpportunities}
                            columnDefs={opportunityColumnDefs}
                            pagination={false}
                            defaultColDef={{
                              sortable: true,
                              filter: true,
                              resizable: true,
                            }}
                            rowHeight={70}
                          />
                        </div>
                      </div>

                      {/* Opportunities footer */}
                      <div className="flex items-center justify-between border-t bg-white px-4 py-2">
                        <span className="text-sm text-muted-foreground">
                          Showing {pagedOpportunities.length} of {oppTotalCount} OppDev
                        </span>
                        <div className="flex items-center gap-3">
                          <select
                            value={oppPageSize}
                            onChange={(e) => {
                              setOppPageSize(Number(e.target.value));
                              setOppCurrentPage(1);
                            }}
                            className="h-8 rounded border px-2 text-sm bg-background"
                          >
                            {PAGE_SIZES.map((s) => (
                              <option key={s} value={s}>
                                {s} / page
                              </option>
                            ))}
                          </select>
                          <span className="text-sm text-muted-foreground">
                            Page {oppCurrentPage} of {oppTotalPages}
                          </span>
                          <div className="flex gap-1">
                            <button
                              disabled={!oppHasPrev}
                              onClick={() => setOppCurrentPage((p) => p - 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ◀
                            </button>
                            <button
                              disabled={!oppHasNext}
                              onClick={() => setOppCurrentPage((p) => p + 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ▶
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ══ PROJECTS TAB ════════════════════════════════════════════════ */}
              {activeTab === "projects" && (
                <>
                  {/* Spinner while fetching */}
                  {projectsLoading && (
                    <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
                      <p className="text-sm">Loading Customer Engagements...</p>
                    </div>
                  )}

                  {/* Empty state */}
                  {!projectsLoading &&
                    projectsFetched &&
                    projects.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <p className="text-sm mt-4">No Customer Engagements found</p>
                      </div>
                    )}

                  {/* Data grid */}
                  {!projectsLoading && projects.length > 0 && (
                    <div className="mx-4 mb-4 border rounded-lg overflow-hidden flex flex-col">
                      <div className="h-[360px]">
                        <div className="ag-theme-alpine h-full w-full">
                          <AgGridReact
                            theme="legacy"
                            rowData={pagedProjects}
                            columnDefs={projectColumnDefs}
                            pagination={false}
                            defaultColDef={{
                              sortable: true,
                              filter: true,
                              resizable: true,
                            }}
                            rowHeight={56}
                          />
                        </div>
                      </div>

                      {/* Projects footer */}
                      <div className="flex items-center justify-between border-t bg-white px-4 py-2">
                        <span className="text-sm text-muted-foreground">
                          Showing {pagedProjects.length} of {projTotalCount} Customer Engagements
                        </span>
                        <div className="flex items-center gap-3">
                          <select
                            value={projPageSize}
                            onChange={(e) => {
                              setProjPageSize(Number(e.target.value));
                              setProjCurrentPage(1);
                            }}
                            className="h-8 rounded border px-2 text-sm bg-background"
                          >
                            {PAGE_SIZES.map((s) => (
                              <option key={s} value={s}>
                                {s} / page
                              </option>
                            ))}
                          </select>
                          <span className="text-sm text-muted-foreground">
                            Page {projCurrentPage} of {projTotalPages}
                          </span>
                          <div className="flex gap-1">
                            <button
                              disabled={!projHasPrev}
                              onClick={() => setProjCurrentPage((p) => p - 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ◀
                            </button>
                            <button
                              disabled={!projHasNext}
                              onClick={() => setProjCurrentPage((p) => p + 1)}
                              className="h-8 w-8 rounded border flex items-center justify-center disabled:opacity-40"
                            >
                              ▶
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Add Details prompt */}
          {needsDetails && (
            <Card
              className="shadow-sm border-dashed border-2"
              role="region"
              aria-labelledby="add-details"
            >
              <CardHeader>
                <CardTitle id="add-details">Add Your Details</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  We could not find your personal, employment, or address
                  details. Add them to complete your profile.
                </p>
                <Button
                  onClick={() => {
                    const firstAddress = row?.addresses?.[0];
                    setFormData({
                      given_name: row?.given_name || "",
                      family_name: row?.family_name || "",
                      alternate_email: row?.alternate_email || "",
                      employment_status: row?.employment_status || "active",
                      job_title: row?.job_title || "",
                      title: row?.title || "",
                      level: row?.level?.toString() || "",
                      start_date: row?.start_date || "",
                      direct_reports: row?.direct_reports?.join(", ") || "",
                      address_type: firstAddress?.type || "home",
                      streetAddress: firstAddress?.streetAddress || "",
                      lineTwo: firstAddress?.lineTwo || "",
                      locality: firstAddress?.locality || "",
                      region: firstAddress?.region || "",
                      postalCode: firstAddress?.postalCode || "",
                      country: firstAddress?.country || "",
                    });
                    setFormErrors({});
                    setShowAddDetails(true);
                  }}
                >
                  Add Detail
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Personal Information */}
          {!needsDetails && (
            <Card
              className="shadow-sm"
              role="region"
              aria-labelledby="personal-info"
            >
              <CardHeader>
                <CardTitle
                  id="personal-info"
                  className="flex items-center justify-between"
                >
                  <span>Personal Information</span>
                  <Badge className={getStatusColor(row.employment_status)}>
                    {row.employment_status.toUpperCase()}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Name</p>
                    <p className="text-lg font-semibold">
                      {`${row.given_name || ""} ${row.family_name || ""}`.trim() ||
                        "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Email</p>
                    <p className="text-lg">{row.email}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      Given Name
                    </p>
                    <p className="text-lg">{row.given_name || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      Family Name
                    </p>
                    <p className="text-lg">{row.family_name || "N/A"}</p>
                  </div>
                  {row.alternate_email && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">
                        Alternate Email
                      </p>
                      <p className="text-lg">{row.alternate_email}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Employment Information */}
          {!needsDetails && (
            <Card
              className="shadow-sm"
              role="region"
              aria-labelledby="employment-info"
            >
              <CardHeader>
                <CardTitle id="employment-info">
                  Employment Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      Job Title
                    </p>
                    <p className="text-lg font-semibold">{row.job_title}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Title</p>
                    <p className="text-lg">{row.title}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Level</p>
                    <Badge variant="outline" className="text-base">
                      Level {row.level}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      Start Date
                    </p>
                    <p className="text-lg">{formatDate(row.start_date)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">
                      Direct Reports
                    </p>
                    <p className="text-lg">
                      {row.direct_reports.length > 0
                        ? row.direct_reports.length
                        : "None"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Address Information */}
          {!needsDetails && row.addresses && row.addresses.length > 0 && (
            <Card
              className="shadow-sm"
              role="region"
              aria-labelledby="address-info"
            >
              <CardHeader>
                <CardTitle id="address-info">Address Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {row.addresses.map((address, index) => (
                    <div
                      key={index}
                      className="p-4 bg-gray-50 rounded-lg border"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-sm font-medium text-gray-500">
                          Address {index + 1}
                        </p>
                        <Badge variant="outline">{address.type}</Badge>
                      </div>
                      <p className="text-lg">{address.streetAddress}</p>
                      {address.lineTwo && (
                        <p className="text-lg">{address.lineTwo}</p>
                      )}
                      <p className="text-lg">
                        {address.locality}, {address.region}{" "}
                        {address.postalCode}
                      </p>
                      <p className="text-lg font-medium">{address.country}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Add Details Dialog */}
          <Dialog open={showAddDetails} onOpenChange={setShowAddDetails}>
            <DialogContent className="max-w-[95vw] sm:max-w-[95vw] md:max-w-[90vw] lg:max-w-[50vw] max-h-[85vh] overflow-hidden flex flex-col">
              <DialogHeader className="pl-2">
                <DialogTitle>Add Personal Details</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 overflow-y-auto pr-2 flex-1 min-h-0 pl-2">
                {/* Personal Information */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Personal Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pi-email">Email</Label>
                      <Input id="pi-email" value={email} readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-given">Given Name *</Label>
                      <Input
                        id="pi-given"
                        value={formData.given_name}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            given_name: e.target.value,
                          }));
                          if (formErrors.given_name && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              given_name: false,
                            }));
                        }}
                        className={
                          formErrors.given_name ? "border-red-500" : ""
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-family">Family Name *</Label>
                      <Input
                        id="pi-family"
                        value={formData.family_name}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            family_name: e.target.value,
                          }));
                          if (formErrors.family_name && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              family_name: false,
                            }));
                        }}
                        className={
                          formErrors.family_name ? "border-red-500" : ""
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-alt-email">Alternate Email</Label>
                      <Input
                        id="pi-alt-email"
                        value={formData.alternate_email}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            alternate_email: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pi-status">Employment Status</Label>
                      <Select
                        value={formData.employment_status}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            employment_status: value,
                          }))
                        }
                      >
                        <SelectTrigger id="pi-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="deactive">Deactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Employment Information */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Employment Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ei-job">Job Title *</Label>
                      <Input
                        id="ei-job"
                        value={formData.job_title}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            job_title: e.target.value,
                          }));
                          if (formErrors.job_title && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              job_title: false,
                            }));
                        }}
                        className={formErrors.job_title ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ei-title">Title *</Label>
                      <Input
                        id="ei-title"
                        value={formData.title}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }));
                          if (formErrors.title && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              title: false,
                            }));
                        }}
                        className={formErrors.title ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ei-level">Level *</Label>
                      <Input
                        id="ei-level"
                        type="number"
                        value={formData.level}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            level: e.target.value,
                          }));
                          if (formErrors.level && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              level: false,
                            }));
                        }}
                        className={formErrors.level ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ei-start">Start Date *</Label>
                      <Input
                        id="ei-start"
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            start_date: e.target.value,
                          }));
                          if (formErrors.start_date && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              start_date: false,
                            }));
                        }}
                        className={
                          formErrors.start_date ? "border-red-500" : ""
                        }
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="ei-reports">
                        Direct Reports (comma-separated)
                      </Label>
                      <Input
                        id="ei-reports"
                        value={formData.direct_reports}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            direct_reports: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Address Information */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Address Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ai-type">Address Type</Label>
                      <Select
                        value={formData.address_type}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            address_type: value,
                          }))
                        }
                      >
                        <SelectTrigger id="ai-type">
                          <SelectValue placeholder="Select address type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">Home</SelectItem>
                          <SelectItem value="office">Office</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-street">Street Address *</Label>
                      <Input
                        id="ai-street"
                        value={formData.streetAddress}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            streetAddress: e.target.value,
                          }));
                          if (formErrors.streetAddress && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              streetAddress: false,
                            }));
                        }}
                        className={
                          formErrors.streetAddress ? "border-red-500" : ""
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-line-two">Line Two</Label>
                      <Input
                        id="ai-line-two"
                        value={formData.lineTwo}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            lineTwo: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-locality">City *</Label>
                      <Input
                        id="ai-locality"
                        value={formData.locality}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            locality: e.target.value,
                          }));
                          if (formErrors.locality && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              locality: false,
                            }));
                        }}
                        className={formErrors.locality ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-region">State/Region *</Label>
                      <Input
                        id="ai-region"
                        value={formData.region}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            region: e.target.value,
                          }));
                          if (formErrors.region && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              region: false,
                            }));
                        }}
                        className={formErrors.region ? "border-red-500" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-postal">Postal Code *</Label>
                      <Input
                        id="ai-postal"
                        value={formData.postalCode}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            postalCode: e.target.value,
                          }));
                          if (formErrors.postalCode && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              postalCode: false,
                            }));
                        }}
                        className={
                          formErrors.postalCode ? "border-red-500" : ""
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-country">Country *</Label>
                      <Input
                        id="ai-country"
                        value={formData.country}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            country: e.target.value,
                          }));
                          if (formErrors.country && e.target.value.trim())
                            setFormErrors((prev) => ({
                              ...prev,
                              country: false,
                            }));
                        }}
                        className={formErrors.country ? "border-red-500" : ""}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddDetails(false);
                    setFormErrors({});
                  }}
                  disabled={savingDetails}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveDetails} disabled={savingDetails}>
                  {savingDetails ? "Saving..." : "Save Details"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <NoData />
      )}
    </div>
  );
}
