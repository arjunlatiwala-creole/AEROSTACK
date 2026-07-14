import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * @deprecated Squid backend has been archived. Auth now goes through Amplify/Cognito directly.
 */
export const squidAuthProvider = {
  integrationId: 'cognito_auth',
  getToken: async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || '';
    } catch (error) {
      console.log('Not authenticated');
      console.error(error);
      return '';
    }
  }
};
