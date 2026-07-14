import { Amplify } from 'aws-amplify';
import { logError, logInfo } from './logger';

export interface AmplifyConfig {
  aws_cognito_region: string;
  aws_user_pools_id: string;
  aws_user_pools_web_client_id: string;
  aws_cognito_identity_pool_id?: string;
  aws_cognito_domain?: string;
  oauth_redirect_sign_in?: string;
  oauth_redirect_sign_out?: string;
}

const getRequiredEnvVar = (key: string, fallback?: string): string => {
  const value = import.meta.env[key] || fallback;
  if (!value) {
    // For local development, return a placeholder if in dev mode
    if (import.meta.env.DEV) {
      console.warn(`Missing environment variable: ${key} - using placeholder for local dev`);
      return 'local-dev-placeholder';
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

/**
 * Build the list of allowed OAuth redirect URLs for Amplify.
 *
 * Amplify raises `InvalidOriginException` at sign-in time when the page's
 * `window.location.origin` does not match the origin of ANY configured
 * `redirectSignIn` URL. This app is reachable from several origins that all
 * resolve to the same deployment — the custom domains (`aerostack.enterprise.io`,
 * `aerostack.enterprise.ai`, `aerostackdev.enterprise.io`, `aerostackdev.enterprise.ai`), the Amplify default
 * (`*.amplifyapp.com`), and `localhost` in dev — so a single baked-in origin
 * is brittle: changing the domain users visit (e.g. a DNS cutover) silently
 * breaks SSO.
 *
 * To make sign-in resilient we:
 *   1. accept a comma-separated list in the env var (each entry trimmed and
 *      stripped of a trailing slash), and
 *   2. always include the current `window.location.origin`,
 * so whichever origin actually serves the app is always a valid candidate.
 *
 * This does NOT weaken security: Cognito's app-client callback/logout
 * allow-list is still the authority on which redirect_uri it will accept, so
 * an origin that Cognito does not allow is rejected server-side regardless.
 */
const buildRedirectUrls = (configured?: string): string[] => {
  const fromEnv = (configured ?? '')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';

  return Array.from(
    new Set([...fromEnv, ...(currentOrigin ? [currentOrigin] : [])]),
  );
};

export const amplifyConfig: AmplifyConfig = {
  aws_cognito_region: getRequiredEnvVar('VITE_AWS_COGNITO_REGION', 'us-east-1'),
  aws_user_pools_id: getRequiredEnvVar('VITE_AWS_USER_POOL_ID'),
  aws_user_pools_web_client_id: getRequiredEnvVar('VITE_AWS_USER_POOL_APP_CLIENT_ID'),
  aws_cognito_identity_pool_id: import.meta.env.VITE_AWS_COGNITO_IDENTITY_POOL_ID,
  aws_cognito_domain: import.meta.env.VITE_AWS_COGNITO_DOMAIN,
  oauth_redirect_sign_in: import.meta.env.VITE_OAUTH_REDIRECT_SIGNIN,
  oauth_redirect_sign_out: import.meta.env.VITE_OAUTH_REDIRECT_SIGNOUT,
};

export const configureAmplify = () => {
  try {
    // Skip Amplify configuration in local dev if credentials are placeholders
    if (import.meta.env.DEV && amplifyConfig.aws_user_pools_id === 'local-dev-placeholder') {
      logInfo('Skipping Amplify configuration in local dev mode (no credentials provided)');
      return false;
    }

    const cognitoConfig: Record<string, unknown> = {
      userPoolId: amplifyConfig.aws_user_pools_id,
      userPoolClientId: amplifyConfig.aws_user_pools_web_client_id,
      loginWith: {
        email: true,
        oauth:
          amplifyConfig.aws_cognito_domain &&
          amplifyConfig.oauth_redirect_sign_in &&
          amplifyConfig.oauth_redirect_sign_out
            ? {
                // Amplify expects domain without protocol
                domain: amplifyConfig.aws_cognito_domain.replace(/^https?:\/\//, ""),
                redirectSignIn: buildRedirectUrls(
                  amplifyConfig.oauth_redirect_sign_in,
                ),
                redirectSignOut: buildRedirectUrls(
                  amplifyConfig.oauth_redirect_sign_out,
                ),
                responseType: "code" as const,
                scopes: ["openid", "email", "profile"],
              }
            : undefined,
      },
      signUpVerificationMethod: "code",
      userAttributes: {
        email: { required: true },
      },
      allowGuestAccess: true,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      },
    };
    if (amplifyConfig.aws_cognito_identity_pool_id) {
      cognitoConfig.identityPoolId = amplifyConfig.aws_cognito_identity_pool_id;
    }
    Amplify.configure({
      Auth: {
        Cognito: cognitoConfig,
      },
    });
    logInfo('Amplify configured successfully');
    return true;
  } catch (error) {
    logError('Error configuring Amplify:', error);
    return false;
  }
};
