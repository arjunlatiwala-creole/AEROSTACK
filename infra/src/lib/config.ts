export type Env = "dev" | "prod" | "local";

export interface TablesConfig {
  person: string;
  personInformation: string;
  integrationsRaw: string;
  bfpm: string;
  bfpmSession: string;
  loops: string;
  loopFinancials: string;
  deals: string;
  companies: string;
  contacts: string;
  integrations: string;
  integrationSyncDetails: string;
  integrationSyncHistory: string;
  deelPeople: string;
  linearDelivery: string;
  partnerOpportunities: string;
  partnerEngagements: string;
  partnerEngagementInvitations: string;
  unifiedOpportunities: string;
  hiringCandidates: string;
  hiringNotes: string;
  hiringJobRecs: string;
  hiringCompPlans: string;
  documents: string;
  documentVersions: string;
  documentAccess: string;
}

export interface FrontendConfig {
  appName: string;
  repository: string;
  branch: string;
  envVariables: Record<string, string>;
}

export interface EnvConfig {
  prefix: string;
  hubspotSecret: string;
  deelSecret: string;
  linearSecret: string;
  linearAdminSecret: string;
  /**
   * Optional Cognito + SSO configuration.
   * When these are undefined, the stack behaves as it does today
   * (email/password Cognito only, no Hosted UI or social IdPs).
   */
  cognitoDomainPrefix?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  oauthCallbackUrls?: string[];
  oauthLogoutUrls?: string[];
  /**
   * When set, the API stack imports this existing Cognito User Pool instead of
   * creating its own. Used so PROD shares the single DEV user pool.
   */
  existingUserPoolId?: string;
  /**
   * Google Directory API integration for automatic role mapping.
   * Secret name in Secrets Manager (NOT the ARN) containing the Google
   * service account JSON key with domain-wide delegation.
   */
  googleDirectorySecretName?: string;
  /** Workspace admin email used as impersonation subject for Directory API. */
  googleAdminEmail?: string;
  /**
   * Moodle LMS integration.
   * moodleUrl  — base URL of the Moodle instance, e.g. https://enterprise.moodlecloud.com
   * moodleToken — Web Services token generated in Moodle admin (Site admin ›
   *               Plugins › Web services › Manage tokens).
   */
  moodleUrl?: string;
  moodleToken?: string;

  /** Frontend app URL (used in emails, share links). e.g. https://aerostack.enterprise.io */
  frontendUrl: string;
  /** Backend API base URL (API Gateway execute URL). e.g. https://fx6oqla6wg.execute-api.us-east-1.amazonaws.com/dev */
  apiBaseUrl?: string;
  /**
   * DocuSign e-signature integration.
   * When undefined, DocuSign Lambdas/routes are skipped and the e-signature
   * feature is disabled.  See docusign-create-envelope.ts for env var details.
   */
  dropboxSign?: {
    clientId: string;
    /** Secrets Manager secret name (NOT ARN) holding the API key. */
    apiKeySecretName: string;
    /** The App Secret used to verify webhook event hashes. */
    appSecret: string;
    /** Base URL of the Dropbox Sign API (e.g. https://api.hellosign.com/v3). */
    baseUrl: string;
    /** Whether to use test mode (non-binding signing, no charges). */
    testMode: boolean;
  };
  tables: TablesConfig;
  frontend: FrontendConfig;
  schemaRegistryBucket: string;
  deelDataBucket: string;
  linearDataBucket: string;
  dynamodbEndpoint?: string; // Optional for local
  partnerRoleArn?: string;
}

const config: Record<Env, EnvConfig> = {
  dev: {
    prefix: "aerostack-dev",
    hubspotSecret: "hubspot_pat",
    deelSecret: "deel_api_token",
    linearSecret: "linear_api_token",
    linearAdminSecret: "linear_api_token_with_admin_access",
    tables: {
      person: "person",
      personInformation: "person-information",
      integrationsRaw: "integrations-raw",
      bfpm: "bfpm-data",
      bfpmSession: "bfpm-sessions",
      loops: "loops",
      loopFinancials: "loop-financials",
      deals: "deals",
      companies: "companies",
      contacts: "contacts",
      integrations: "integrations",
      integrationSyncDetails: "integration-sync-details",
      integrationSyncHistory: "integration-sync-history",
      deelPeople: "deel-people",
      linearDelivery: "linear-delivery",
      partnerOpportunities: "partner-opportunities",
      partnerEngagements: "partner-engagements",
      partnerEngagementInvitations: "partner-engagement-invitations",
      unifiedOpportunities: "unified-opportunities",
      hiringCandidates: "hiring-candidates",
      hiringNotes: "hiring-notes",
      hiringJobRecs: "hiring-job-recs",
      hiringCompPlans: "hiring-comp-plans",
      documents: "documents",
      documentVersions: "document-versions",
      documentAccess: "document-access",
    },
    schemaRegistryBucket: "aerostack-dev-schema-registry-759945100661",
    deelDataBucket: "aerostack-dev-deel-data-759945100661",
    linearDataBucket: "aerostack-dev-linear-data-759945100661",
    frontend: {
      appName: "enterprise-aerostack-dev",
      repository: "enterpriseio/enterprise-aerostack",
      branch: "dev",
      envVariables: {
        VITE_STAGE: "dev",
      },
    },
    // Partner Central is deferred (Option 2) — this placeholder role does not
    // need to exist; it is never assumed because partner_central ingestion is
    // excluded from the schedule and the partner API is not invoked. The value
    // must be a syntactically-valid ARN so the synthesized IAM policy does not
    // emit an empty `Resource` (which CloudFormation rejects at deploy time).
    // When Partner Central is enabled later, replace with the real cross-account
    // role ARN and update that role's trust policy to allow this account.
    partnerRoleArn: "arn:aws:iam::759945100661:role/aerostack-partner-central-deferred-placeholder",
    // SSO / Hosted UI — domain prefix must be globally unique per region
    cognitoDomainPrefix: "aerostack-dev-enterprise-759945100661",
    oauthCallbackUrls: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      // Amplify default domain (set in Phase 8)
      "https://dev.dya49i66ic3c7.amplifyapp.com",
      // Prod Amplify domain — shared dev app client must allow prod logins
      "https://main.d2nmzejx4gfawo.amplifyapp.com",
      // Custom domains (DNS cutover 2026-06-28) — both TLDs serve the dev app
      "https://aerostackdev.enterprise.io",
      "https://aerostackdev.enterprise.ai",
    ],
    oauthLogoutUrls: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      // Amplify default domain (set in Phase 8)
      "https://dev.dya49i66ic3c7.amplifyapp.com",
      // Prod Amplify domain — shared dev app client must allow prod logins
      "https://main.d2nmzejx4gfawo.amplifyapp.com",
      // Custom domains (DNS cutover 2026-06-28) — both TLDs serve the dev app
      "https://aerostackdev.enterprise.io",
      "https://aerostackdev.enterprise.ai",
    ],
    // Add when you have Google OAuth credentials (from GCP or Anvi):
    googleClientId:
      "PLACEHOLDER_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    googleClientSecret: "PLACEHOLDER_GOOGLE_CLIENT_SECRET",
    // Google Directory API — automatic role mapping from Workspace groups
    googleDirectorySecretName: "google-directory-service-account",
    googleAdminEmail: "admin@enterprise.io",
    // Moodle LMS integration
    moodleUrl: "https://enterprise.moodlecloud.com",
    // Set MOODLE_TOKEN via AWS Secrets Manager or SSM in production.
    // For dev, set process.env.MOODLE_TOKEN or leave undefined to disable.
    moodleToken: "c8c452b47ab32420d530a2fe90dfb4d2",

    frontendUrl: "https://dev.dya49i66ic3c7.amplifyapp.com", // Amplify default domain (set in Phase 8)
    apiBaseUrl: "https://f6jckhd0ed.execute-api.us-east-1.amazonaws.com/dev", // backfilled Phase 5 after Aerostack-ApiStack deploys

    // ─── DocuSign e-signature ──────────────────────────────────────────────
    // Uncomment + populate once the DocuSign integration app is provisioned.
    // The RSA private key MUST be stored in AWS Secrets Manager as the value
    // of the secret named below (just the PEM contents, not JSON-wrapped).
    //
    dropboxSign: {
      clientId: "049f0d6cd28ed40490c83fa4a0f72935",
      apiKeySecretName: "aerostack/document-host/dropbox-sign-api-key",
      appSecret: "",
      baseUrl: "https://api.hellosign.com/v3",
      testMode: true,
    },
  },
  prod: {
    prefix: "aerostack-prod",
    hubspotSecret: "hubspot_pat",
    deelSecret: "deel_api_token",
    linearSecret: "linear_api_token",
    linearAdminSecret: "linear_api_token_with_admin_access",
    tables: {
      person: "person",
      personInformation: "person-information",
      integrationsRaw: "integrations-raw",
      bfpm: "bfpm-data",
      bfpmSession: "bfpm-sessions",
      loops: "loops",
      loopFinancials: "loop-financials",
      deals: "deals",
      companies: "companies",
      contacts: "contacts",
      integrations: "integrations",
      integrationSyncDetails: "integration-sync-details",
      integrationSyncHistory: "integration-sync-history",
      deelPeople: "deel-people",
      linearDelivery: "linear-delivery",
      partnerOpportunities: "partner-opportunities",
      partnerEngagements: "partner-engagements",
      partnerEngagementInvitations: "partner-engagement-invitations",
      unifiedOpportunities: "unified-opportunities",
      hiringCandidates: "hiring-candidates",
      hiringNotes: "hiring-notes",
      hiringJobRecs: "hiring-job-recs",
      hiringCompPlans: "hiring-comp-plans",
      documents: "documents",
      documentVersions: "document-versions",
      documentAccess: "document-access",
    },
    schemaRegistryBucket: "aerostack-prod-schema-registry-759945100661",
    deelDataBucket: "aerostack-prod-deel-data",
    linearDataBucket: "aerostack-prod-linear-data",
    frontend: {
      appName: "enterprise-aerostack-main",
      repository: "enterpriseio/enterprise-aerostack",
      branch: "main",
      envVariables: {
        VITE_STAGE: "prod",
      },
    },
    partnerRoleArn: "arn:aws:iam::759945100661:role/aerostack-partner-central-deferred-placeholder",
    // SSO / Hosted UI — domain prefix must be globally unique per region
    cognitoDomainPrefix: "aerostack-prod-enterprise-759945100661",
    oauthCallbackUrls: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://main.d2nmzejx4gfawo.amplifyapp.com",
      // Custom domains (DNS cutover 2026-06-28) — both TLDs serve the prod app
      "https://aerostack.enterprise.io",
      "https://aerostack.enterprise.ai",
    ],
    oauthLogoutUrls: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://main.d2nmzejx4gfawo.amplifyapp.com",
      // Custom domains (DNS cutover 2026-06-28) — both TLDs serve the prod app
      "https://aerostack.enterprise.io",
      "https://aerostack.enterprise.ai",
    ],
    // Shared Google client across stages (same values as dev)
    googleClientId:
      "PLACEHOLDER_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    googleClientSecret: "PLACEHOLDER_GOOGLE_CLIENT_SECRET",
    // Google Directory API — automatic role mapping from Workspace groups
    googleDirectorySecretName: "google-directory-service-account",
    googleAdminEmail: "admin@enterprise.io",
    // Moodle LMS integration
    moodleUrl: "https://enterprise.moodlecloud.com",
    moodleToken: "c8c452b47ab32420d530a2fe90dfb4d2",
    frontendUrl: "https://main.d2nmzejx4gfawo.amplifyapp.com", // prod Amplify default domain
    apiBaseUrl: "https://bs9b79xr98.execute-api.us-east-1.amazonaws.com/dev", // prod Aerostack-ApiStack-prod

    // ─── DocuSign e-signature ──────────────────────────────────────────────
    // Production DocuSign integration goes here (production endpoints):
    //   baseUrl: "https://showcase.docusign.net"  (or your account's host)
    //   oauthBaseUrl: "https://account.docusign.com"
    //
    dropboxSign: {
      clientId: "049f0d6cd28ed40490c83fa4a0f72935",
      apiKeySecretName: "aerostack/document-host/dropbox-sign-api-key",
      appSecret: "",
      baseUrl: "https://api.hellosign.com/v3",
      testMode: false,
    },
  },
  local: {
    prefix: "aerostack-local",
    hubspotSecret: "hubspot_pat",
    deelSecret: "deel_api_token",
    linearSecret: "linear_api_token",
    linearAdminSecret: "linear_api_token_with_admin_access",
    tables: {
      person: "local-person",
      personInformation: "local-person-information",
      integrationsRaw: "local-integrations-raw",
      bfpm: "local-bfpm-data",
      bfpmSession: "local-bfpm-sessions",
      loops: "local-loops",
      loopFinancials: "local-loop-financials",
      deals: "local-deals",
      companies: "local-companies",
      contacts: "local-contacts",
      integrations: "local-integrations",
      integrationSyncDetails: "local-integration-sync-details",
      integrationSyncHistory: "local-integration-sync-history",
      deelPeople: "local-deel-people",
      linearDelivery: "local-linear-delivery",
      partnerOpportunities: "local-partner-opportunities",
      partnerEngagements: "local-partner-engagements",
      partnerEngagementInvitations: "local-partner-engagement-invitations",
      unifiedOpportunities: "local-unified-opportunities",
      hiringCandidates: "local-hiring-candidates",
      hiringNotes: "local-hiring-notes",
      hiringJobRecs: "local-hiring-job-recs",
      hiringCompPlans: "local-hiring-comp-plans",
      documents: "local-documents",
      documentVersions: "local-document-versions",
      documentAccess: "local-document-access",
    },
    dynamodbEndpoint: "http://dynamodb-local:8000",
    schemaRegistryBucket: "aerostack-prod-schema-registry",
    deelDataBucket: "aerostack-prod-deel-data",
    linearDataBucket: "aerostack-local-linear-data",
    frontend: {
      appName: "enterprise-aerostack-local",
      repository: "enterpriseio/enterprise-aerostack",
      branch: "dev",
      envVariables: {},
    },
    partnerRoleArn: "arn:aws:iam::809373129375:user/shivam-creole",
    frontendUrl: "http://localhost:5173",
    apiBaseUrl: "http://localhost:3001",
  },
} as const;

// Default resolves from NODE_ENV (validated against known stages) so stacks/
// constructs that call getConfig() with no argument pick up the active stage
// (dev | prod | local). app.ts / frontend-stack.ts pass an explicit stage.
export const getConfig = (
  env: Env = (["dev", "prod", "local"].includes(process.env.NODE_ENV ?? "")
    ? (process.env.NODE_ENV as Env)
    : "dev"),
) => config[env];

export const throttling = {
  rateLimit: 10,
  burstLimit: 20,
};
