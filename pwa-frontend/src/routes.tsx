import { createBrowserRouter, Navigate } from "react-router";
import ErrorComponent from "@/components/ErrorComponent";
import NotFoundPage from "@/components/NotFound";
import AuthLayout from "@/layouts/AuthLayout";
import ProtectedLayout from "@/layouts/ProtectedRouteLayout";
import { ROUTES } from "@/lib/routes-config";
import SwaggerUIWrapper from "@/pages/api-docs";
import SigninPage from "@/pages/auth/SignIn";
import DashboardAPN from "@/pages/DashboardAPN";
import DashboardEmailExtractor from "@/pages/DashboardEmailExtractor";
import DashboardKnowledge from "@/pages/DashboardKnowledge";
import DashboardAgents from "@/pages/DashboardAgents";
import DashboardBfpm from "@/pages/DashboardBfpm";
import DashboardCalcs from "@/pages/DashboardCalcs";
import DashboardCsat from "@/pages/DashboardCsat";
import DashboardDataTools from "@/pages/DashboardDataTools";
import DashboardDelivery from "@/pages/DashboardDelivery";
import DashboardDeliveryTools from "@/pages/DashboardDeliveryTools";
import DashboardEngagement from "@/pages/DashboardEngagement";
import DashboardEnterpriseAerostack from "@/pages/DashboardEnterpriseAerostack";
import DashboardEngineering from "@/pages/DashboardEngineering";
import DashboardFinancials from "@/pages/DashboardFinancials";
import DashboardLearning from "@/pages/DashboardLearning";
import LearningOps from "@/pages/LearningOps";
import LearningCompletionTracking from "@/pages/LearningCompletionTracking";
import DashboardMcp from "@/pages/DashboardMcp";
import DashboardMyAerostack from "@/pages/DashboardMyAerostack";
import DashboardOpportunities from "@/pages/DashboardOpportunities";
import DashboardOppsTools from "@/pages/DashboardOppsTools";
import DashboardOrg from "@/pages/DashboardOrg";
import DashboardPeopleOps from "@/pages/DashboardPeopleOps";
import DashboardPeople from "@/pages/DashboardPeople";
import DashboardPerson from "@/pages/DashboardPerson";
import DashboardRevOpsEnhanced from "@/pages/DashboardRevOpsEnhanced";
import RevOpsDashboard from "@/pages/RevOpsDashboard";
import CustomerSuccess from "@/pages/CustomerSuccess";
import DashboardRevOpsSetup from "@/pages/DashboardRevOpsSetup";
import DashboardSow from "@/pages/DashboardSow";
import DashboardWorkflowLedger from "@/pages/DashboardWorkflowLedger";
import DashboardEditIntegration from "@/pages/integrations-dashboard/DashboardEditIntegration";
import DashboardIntegrations from "@/pages/integrations-dashboard/DashboardIntegrations";
import IntegrationSyncDetails from "@/pages/integrations-dashboard/IntegrationSyncDetails";
import IntegrationSyncHistory from "@/pages/integrations-dashboard/IntegrationSyncHistory";
import LoopDetailPage from "@/pages/loops/Loop";
import TestServicePage from "@/pages/TestService";
import DealDetailPage from "./components/aerostack/DealDetails";
import ProjectDetailsPage from "./components/aerostack/ProjectDetails";
import PerspexJoin from "@/pages/PerspexJoin";
import SignDocument from "@/pages/SignDocument";
import ApplyPage from "@/pages/ApplyPage";
import JobsPage from "@/pages/JobsPage";
import JobDetailPage from "@/pages/JobDetailPage";
import ContentArchitecturePage from "@/pages/ContentArchitecture";
import DashboardRoles from "@/pages/DashboardRoles";
import RoleDetail from "@/pages/RoleDetail";
import DashboardSlackAdmin from "@/pages/DashboardSlackAdmin";
import DashboardCompPlan from "@/pages/DashboardCompPlan";
import DashboardProjectHandoff from "@/pages/DashboardProjectHandoff";
import DashboardZoomRecordings from "@/pages/DashboardZoomRecordings";
import DashboardWorkspaceAdmin from "@/pages/DashboardWorkspaceAdmin";
import DashboardHiringTools from "@/pages/DashboardHiringTools";
import LinkedInOAuthCallbackPage from "@/pages/LinkedInOAuthCallback";
import DashboardAccreditations from "@/pages/DashboardAccreditations";
import DashboardDocuments from "@/pages/DashboardDocuments";
import MoodleCatalogPage from "@/pages/MoodleCatalog";

export const router = createBrowserRouter([
  {
    path: "/oauth/linkedin/callback",
    element: <LinkedInOAuthCallbackPage />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/perspex/join/:sessionId",
    element: <PerspexJoin />,
    errorElement: <ErrorComponent />,
  },
  // Public Aerostack-hosted signing landing page (no auth — token in URL)
  {
    path: "/sign/:envelopeId",
    element: <SignDocument />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/sign/:envelopeId/done",
    element: <SignDocument />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/jobs",
    element: <JobsPage />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/jobs/:jobRecId",
    element: <JobDetailPage />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/apply/:jobRecId",
    element: <ApplyPage />,
    errorElement: <ErrorComponent />,
  },
  {
    path: "/apply",
    element: <ApplyPage />,
    errorElement: <ErrorComponent />,
  },
  {
    element: <AuthLayout />,
    errorElement: <ErrorComponent />,
    children: [
      {
        path: ROUTES.AUTH.LOGIN.path,
        element: <SigninPage />,
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },

  {
    path: "/",
    element: <ProtectedLayout />,
    errorElement: <ErrorComponent />,
    children: [
      {
        index: true,
        element: <Navigate to={ROUTES.APP.PERSON.path} replace />,
      },

      {
        path: ROUTES.APP.TEST.path,
        element: <TestServicePage />,
      },
      {
        path: ROUTES.APP.MY_Aerostack.path,
        element: <DashboardMyAerostack />,
      },
      {
        path: ROUTES.APP.SETUP.path,
        element: <DashboardRevOpsSetup />,
      },
      {
        path: ROUTES.APP.REVOPS.path,
        element: <DashboardRevOpsEnhanced />,
      },
      {
        path: ROUTES.APP.REVOPS_PRODUCTIVITY.path,
        element: <RevOpsDashboard />,
      },
      {
        path: ROUTES.APP.CUSTOMER_SUCCESS.path,
        element: <CustomerSuccess />,
      },
      {
        path: ROUTES.APP.DEAL_DETAIL.path,
        element: <DealDetailPage />,
      },
      {
        path: ROUTES.APP.FINANCIALS.path,
        element: <DashboardFinancials />,
      },
      {
        path: ROUTES.APP.ENGINEERING.path,
        element: <DashboardEngineering />,
      },
      {
        path: ROUTES.APP.PEOPLE_OPS.path,
        element: <DashboardPeopleOps />,
      },
      {
        path: ROUTES.APP.INTEGRATIONS.path,
        element: <DashboardIntegrations />,
      },
      {
        path: ROUTES.APP.EDIT_INTEGRATION.path,
        element: <DashboardEditIntegration />,
      },
      {
        path: ROUTES.APP.ORG.path,
        element: <DashboardOrg />,
      },
      {
        path: ROUTES.APP.OPPORTUNITIES.path,
        element: <DashboardOpportunities />,
      },
      {
        path: ROUTES.APP.DELIVERY.path,
        element: <DashboardDelivery />,
      },
      {
        path: ROUTES.APP.PROJECT_DETAILS.path,
        element: <ProjectDetailsPage />,
      },
      {
        path: ROUTES.APP.PROJECT_UPDATES.path,
        element: <ProjectDetailsPage />,
      },
      {
        path: ROUTES.APP.LEARNING.path,
        element: <DashboardLearning />,
      },
      {
        path: ROUTES.APP.LEARNING_OPS.path,
        element: <LearningOps />,
      },
      {
        path: ROUTES.APP.LEARNING_COMPLETION.path,
        element: <LearningCompletionTracking />,
      },
      {
        path: ROUTES.APP.MOODLE_CATALOG.path,
        element: <MoodleCatalogPage />,
      },
      {
        path: ROUTES.APP.PERSON.path,
        element: <DashboardPerson />,
      },
      {
        path: ROUTES.APP.BFPM.path,
        element: <DashboardBfpm />,
      },
      {
        path: ROUTES.APP.MCP.path,
        element: <DashboardMcp />,
      },
      {
        path: ROUTES.APP.LOOP.path,
        element: <LoopDetailPage />,
      },
      {
        path: ROUTES.APP.ENGAGEMENT.path,
        element: <DashboardEngagement />,
      },
      {
        path: ROUTES.APP.CALCS.path,
        element: <DashboardCalcs />,
      },
      {
        path: ROUTES.APP.INTEGRATIONS_SYNC_HISTORY.path,
        element: <IntegrationSyncHistory />,
      },
      {
        path: ROUTES.APP.INTEGRATIONS_SYNC_DETAILS.path,
        element: <IntegrationSyncDetails />,
      },
      {
        path: ROUTES.APP.API_DOCS.path,
        element: <SwaggerUIWrapper />,
      },
      {
        path: ROUTES.APP.APN.path,
        element: <DashboardAPN />,
      },
      {
        path: ROUTES.APP.Enterprise_Aerostack.path,
        element: <DashboardEnterpriseAerostack />,
      },
      {
        path: ROUTES.APP.OPPS_TOOLS.path,
        element: <DashboardOppsTools />,
      },
      {
        path: ROUTES.APP.SOW_TOOLS.path,
        element: <DashboardSow />,
      },
      {
        path: ROUTES.APP.DELIVERY_TOOLS.path,
        element: <DashboardDeliveryTools />,
      },
      {
        path: ROUTES.APP.CSAT_TOOLS.path,
        element: <DashboardCsat />,
      },
      {
        path: ROUTES.APP.DATA_TOOLS.path,
        element: <DashboardDataTools />,
      },
      {
        path: ROUTES.APP.AGENTS.path,
        element: <DashboardAgents />,
      },
      {
        path: ROUTES.APP.WORKFLOW_LEDGER.path,
        element: <DashboardWorkflowLedger />,
      },
      {
        path: ROUTES.APP.PEOPLE.path,
        element: <DashboardPeople />,
      },
      {
        path: ROUTES.APP.EMAIL_EXTRACTOR.path,
        element: <DashboardEmailExtractor />,
      },
      {
        path: ROUTES.APP.KNOWLEDGE.path,
        element: <DashboardKnowledge />,
      },
      {
        path: ROUTES.APP.CONTENT_ARCHITECTURE.path,
        element: <ContentArchitecturePage />,
      },
      {
        path: ROUTES.APP.SLACK_ADMIN.path,
        element: <DashboardSlackAdmin />,
      },
      {
        path: ROUTES.APP.COMP_PLAN.path,
        element: <DashboardCompPlan />,
      },
      {
        path: ROUTES.APP.PROJECT_HANDOFF.path,
        element: <DashboardProjectHandoff />,
      },
      {
        path: ROUTES.APP.ROLES.path,
        element: <DashboardRoles />,
      },
      {
        path: ROUTES.APP.ROLE_DETAIL.path,
        element: <RoleDetail />,
      },
      {
        path: ROUTES.APP.ZOOM_RECORDINGS.path,
        element: <DashboardZoomRecordings />,
      },
      {
        path: ROUTES.APP.WORKSPACE_ADMIN.path,
        element: <DashboardWorkspaceAdmin />,
      },
      {
        path: ROUTES.APP.HIRING_TOOLS.path,
        element: <DashboardHiringTools />,
      },
      {
        path: ROUTES.APP.ACCREDITATIONS.path,
        element: <DashboardAccreditations />,
      },
      {
        path: ROUTES.APP.DOCUMENTS.path,
        element: <DashboardDocuments />,
      },
    ],
  },
]);
