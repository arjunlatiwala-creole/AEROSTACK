import * as cdk from 'aws-cdk-lib';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import { Construct } from 'constructs';
import { type Env, getConfig } from '../config';

export class FrontendStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        const cfg = getConfig((process.env.NODE_ENV as Env) || 'dev');

        const amplifyApp = new amplify.App(this, 'AmplifyApp', {
            appName: cfg.frontend.appName,
            sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
                owner: 'enterpriseio',
                // Amplify expects just the repo name (not owner/repo); cfg value may be "enterpriseio/enterprise-aerostack"
                repository: cfg.frontend.repository.includes('/')
                    ? cfg.frontend.repository.split('/')[1]
                    : cfg.frontend.repository,
                oauthToken: cdk.SecretValue.unsafePlainText('TEMPORARY_HOLDER'),
            }),
            environmentVariables: {
                VITE_AWS_USER_POOL_ID: process.env.VITE_AWS_USER_POOL_ID || '',
                VITE_AWS_USER_POOL_APP_CLIENT_ID: process.env.VITE_AWS_USER_POOL_APP_CLIENT_ID || '',
                VITE_AWS_REGION: process.env.VITE_AWS_REGION || 'us-east-1',
                VITE_AWS_COGNITO_REGION: process.env.VITE_AWS_COGNITO_REGION || 'us-east-1',
                VITE_AWS_COGNITO_DOMAIN: process.env.VITE_AWS_COGNITO_DOMAIN || '',
                VITE_OAUTH_REDIRECT_SIGNIN: process.env.VITE_OAUTH_REDIRECT_SIGNIN || '',
                VITE_OAUTH_REDIRECT_SIGNOUT: process.env.VITE_OAUTH_REDIRECT_SIGNOUT || '',
                VITE_BASE_URL: process.env.VITE_BASE_URL || '',
                VITE_MODULES_API_URL: process.env.VITE_MODULES_API_URL || 'https://7b8z1p3gm1.execute-api.us-east-1.amazonaws.com/dev/',
                VITE_Aerostack_BASE_URL: process.env.VITE_Aerostack_BASE_URL || '',
                VITE_HIRING_BASE_URL: process.env.VITE_HIRING_BASE_URL || '',
                VITE_TOOLS_API_URL: process.env.VITE_TOOLS_API_URL || '',
            },
            buildSpec: cdk.aws_codebuild.BuildSpec.fromObject({
                version: '1.0',
                applications: [{
                    frontend: {
                        phases: {
                            preBuild: {
                                commands: [
                                    'npm install -g pnpm',
                                    'cd pwa-frontend',
                                    'pnpm install',
                                    'env | grep -e VITE_ > .env'
                                ],
                            },
                            build: {
                                commands: ['pnpm run build'],
                            },
                        },
                        artifacts: {
                            baseDirectory: 'pwa-frontend/dist',
                            files: ['**/*'],
                        },
                        cache: {
                            paths: ['pwa-frontend/node_modules/**/*'],
                        },
                    },
                }]
            }),
        });

        // --- FIX: AutoBuild Enabled ---
        const branch = amplifyApp.addBranch(cfg.frontend.branch, { autoBuild: true });

        // // --- Domain Setup for only dev ---
        // const domain = amplifyApp.addDomain('aerostack.enterprise.io', {
        //     enableAutoSubdomain: false,
        // });
        
        // // Root is NOT mapped (kept for manual/old app if needed, but safer to leave unmapped)
        // // domain.mapRoot(mainBranch); 

        // // Only map the dev subdomain
        // domain.mapSubDomain(branch, 'dev'); 

        amplifyApp.addCustomRule(amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);

        // --- ESCAPE HATCH for Secret ---
        const cfnApp = amplifyApp.node.defaultChild as cdk.aws_amplify.CfnApp;
        cfnApp.oauthToken = cdk.SecretValue.secretsManager('github-token-dj').unsafeUnwrap();
    }
}
