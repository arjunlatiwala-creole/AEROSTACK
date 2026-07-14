import { Amplify } from 'aws-amplify';

//amplify config file

const userPoolId = import.meta.env.VITE_AWS_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_AWS_USER_POOL_APP_CLIENT_ID;

if (!userPoolId || !userPoolClientId) {
  throw new Error(
    'Missing required AWS Cognito environment variables. ' +
      'Please ensure VITE_AWS_USER_POOL_ID and VITE_AWS_USER_POOL_APP_CLIENT_ID are set.'
  );
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
    },
  },
});
