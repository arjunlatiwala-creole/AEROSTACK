import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { IApiAuth } from "../auth/cognito-auth";

export interface HiringPipelineApiProps {
    api: apigw.RestApi;
    auth: IApiAuth;
    hiringCandidatesTable: dynamodb.ITable;
    hiringNotesTable: dynamodb.ITable;
    hiringJobRecsTable: dynamodb.ITable;
    hiringCompPlansTable: dynamodb.ITable;
    lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
    bucketPrefix: string;
    deelSecretName: string;
}

export class HiringPipelineApi extends Construct {
    public readonly resumeBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: HiringPipelineApiProps) {
        super(scope, id);

        /* ──────── S3 Bucket for Resumes ──────── */

        this.resumeBucket = new s3.Bucket(this, "ResumeBucket", {
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                    exposedHeaders: ["ETag"],
                    maxAge: 3600,
                },
            ],
            lifecycleRules: [
                {
                    id: "DeleteOldVersions",
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                },
            ],
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        /* ──────── Environment Maps ──────── */

        const candidatesEnv = {
            HIRING_CANDIDATES_TABLE_NAME: props.hiringCandidatesTable.tableName,
        };
        const notesEnv = {
            HIRING_NOTES_TABLE_NAME: props.hiringNotesTable.tableName,
        };
        const jobRecsEnv = {
            HIRING_JOB_RECS_TABLE_NAME: props.hiringJobRecsTable.tableName,
        };
        const resumeEnv = {
            HIRING_RESUME_BUCKET_NAME: this.resumeBucket.bucketName,
        };
        const compPlansEnv = {
            HIRING_COMP_PLANS_TABLE_NAME: props.hiringCompPlansTable.tableName,
        };

        /* ──────── Deel Secret ──────── */

        const deelSecret = sm.Secret.fromSecretNameV2(
            this,
            "DeelSecret",
            props.deelSecretName,
        );
        const deelEnv = {
            DEEL_SECRET_NAME: props.deelSecretName,
            HIRING_CANDIDATES_TABLE_NAME: props.hiringCandidatesTable.tableName,
            HIRING_COMP_PLANS_TABLE_NAME: props.hiringCompPlansTable.tableName,
        };

        /* ──────── Candidate Lambdas (authenticated) ──────── */

        const listCandidates = new nodejs.NodejsFunction(this, "ListCandidates", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/list-candidates.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        const createCandidate = new nodejs.NodejsFunction(this, "CreateCandidate", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/create-candidate.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        const getCandidate = new nodejs.NodejsFunction(this, "GetCandidate", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/get-candidate.ts",
            handler: "handler",
            environment: { ...candidatesEnv, ...notesEnv },
        });

        const updateCandidate = new nodejs.NodejsFunction(this, "UpdateCandidate", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/update-candidate.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        const advanceStage = new nodejs.NodejsFunction(this, "AdvanceStage", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/advance-stage.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        const createNote = new nodejs.NodejsFunction(this, "CreateNote", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/create-note.ts",
            handler: "handler",
            environment: notesEnv,
        });

        const getPipelineMetrics = new nodejs.NodejsFunction(this, "GetPipelineMetrics", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/get-pipeline-metrics.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        /* ──────── Job Rec Lambdas (authenticated) ──────── */

        const createJobRec = new nodejs.NodejsFunction(this, "CreateJobRec", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/create-job-rec.ts",
            handler: "handler",
            environment: jobRecsEnv,
        });

        const listJobRecs = new nodejs.NodejsFunction(this, "ListJobRecs", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/list-job-recs.ts",
            handler: "handler",
            environment: jobRecsEnv,
        });

        const updateJobRec = new nodejs.NodejsFunction(this, "UpdateJobRec", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/update-job-rec.ts",
            handler: "handler",
            environment: jobRecsEnv,
        });

        /* ──────── Public Lambdas (no auth) ──────── */

        const publicSubmitApplication = new nodejs.NodejsFunction(this, "PublicSubmitApp", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/public-submit-application.ts",
            handler: "handler",
            environment: candidatesEnv,
        });

        const publicListJobs = new nodejs.NodejsFunction(this, "PublicListJobs", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/public-list-jobs.ts",
            handler: "handler",
            environment: jobRecsEnv,
        });

        const publicGetJob = new nodejs.NodejsFunction(this, "PublicGetJob", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/public-get-job.ts",
            handler: "handler",
            environment: jobRecsEnv,
        });

        const getResumeUploadUrl = new nodejs.NodejsFunction(this, "GetResumeUploadUrl", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/get-resume-upload-url.ts",
            handler: "handler",
            environment: resumeEnv,
            bundling: {
                minify: true,
                externalModules: ["@aws-sdk/client-s3"],
            },
        });

        const getResumeDownloadUrl = new nodejs.NodejsFunction(this, "GetResumeDownloadUrl", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/get-resume-download-url.ts",
            handler: "handler",
            environment: resumeEnv,
            bundling: {
                minify: true,
                externalModules: ["@aws-sdk/client-s3"],
            },
        });

        /* ──────── Comp Plan Lambdas (authenticated) ──────── */

        const createCompPlan = new nodejs.NodejsFunction(this, "CreateCompPlan", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/create-comp-plan.ts",
            handler: "handler",
            environment: compPlansEnv,
        });

        const getCompPlan = new nodejs.NodejsFunction(this, "GetCompPlan", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/get-comp-plan.ts",
            handler: "handler",
            environment: compPlansEnv,
        });

        const updateCompPlan = new nodejs.NodejsFunction(this, "UpdateCompPlan", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/update-comp-plan.ts",
            handler: "handler",
            environment: compPlansEnv,
        });

        /* ──────── Deel Integration Lambda (authenticated) ──────── */

        const createDeelContract = new nodejs.NodejsFunction(this, "CreateDeelContract", {
            ...props.lambdaDefaults,
            entry: "src/functions/hiring/create-deel-contract.ts",
            handler: "handler",
            timeout: cdk.Duration.seconds(60),
            environment: deelEnv,
        });

        /* ──────── IAM Grants ──────── */

        props.hiringCandidatesTable.grantReadData(listCandidates);
        props.hiringCandidatesTable.grantReadWriteData(createCandidate);
        props.hiringCandidatesTable.grantReadData(getCandidate);
        props.hiringNotesTable.grantReadData(getCandidate);
        props.hiringCandidatesTable.grantReadWriteData(updateCandidate);
        props.hiringCandidatesTable.grantReadWriteData(advanceStage);
        props.hiringNotesTable.grantReadWriteData(createNote);
        props.hiringCandidatesTable.grantReadData(getPipelineMetrics);

        props.hiringJobRecsTable.grantReadWriteData(createJobRec);
        props.hiringJobRecsTable.grantReadData(listJobRecs);
        props.hiringJobRecsTable.grantReadWriteData(updateJobRec);

        props.hiringCandidatesTable.grantReadWriteData(publicSubmitApplication);
        props.hiringJobRecsTable.grantReadData(publicListJobs);
        props.hiringJobRecsTable.grantReadData(publicGetJob);
        this.resumeBucket.grantPut(getResumeUploadUrl);
        this.resumeBucket.grantRead(getResumeDownloadUrl);

        props.hiringCompPlansTable.grantReadWriteData(createCompPlan);
        props.hiringCompPlansTable.grantReadData(getCompPlan);
        props.hiringCompPlansTable.grantReadWriteData(updateCompPlan);

        props.hiringCandidatesTable.grantReadWriteData(createDeelContract);
        props.hiringCompPlansTable.grantReadData(createDeelContract);
        deelSecret.grantRead(createDeelContract);

        /* ──────── API Gateway Resources ──────── */

        const peopleOps = props.api.root.addResource("people-ops");
        const hiring = peopleOps.addResource("hiring");
        const authOpts = props.auth.getMethodOptions();
        const noAuth = { authorizationType: apigw.AuthorizationType.NONE };

        // ── Candidates (authenticated) ──
        const candidates = hiring.addResource("candidates");
        const candidateById = candidates.addResource("{candidateId}");
        const advanceStageRes = candidateById.addResource("advance-stage");
        const notesRes = candidateById.addResource("notes");

        candidates.addMethod("GET", new apigw.LambdaIntegration(listCandidates), authOpts);
        candidates.addMethod("POST", new apigw.LambdaIntegration(createCandidate), authOpts);
        candidateById.addMethod("GET", new apigw.LambdaIntegration(getCandidate), authOpts);
        candidateById.addMethod("PUT", new apigw.LambdaIntegration(updateCandidate), authOpts);
        advanceStageRes.addMethod("POST", new apigw.LambdaIntegration(advanceStage), authOpts);
        notesRes.addMethod("POST", new apigw.LambdaIntegration(createNote), authOpts);

        // ── Pipeline Metrics (authenticated) ──
        const pipelineMetrics = hiring.addResource("pipeline-metrics");
        pipelineMetrics.addMethod("GET", new apigw.LambdaIntegration(getPipelineMetrics), authOpts);

        // ── Job Recs (authenticated CRUD) ──
        const jobRecs = hiring.addResource("job-recs");
        const jobRecById = jobRecs.addResource("{jobRecId}");

        jobRecs.addMethod("GET", new apigw.LambdaIntegration(listJobRecs), authOpts);
        jobRecs.addMethod("POST", new apigw.LambdaIntegration(createJobRec), authOpts);
        jobRecById.addMethod("PUT", new apigw.LambdaIntegration(updateJobRec), authOpts);

        // ── Public endpoints (no auth) ──
        const apply = hiring.addResource("apply");
        apply.addMethod("POST", new apigw.LambdaIntegration(publicSubmitApplication), noAuth);

        const jobs = hiring.addResource("jobs");
        const jobById = jobs.addResource("{jobRecId}");
        jobs.addMethod("GET", new apigw.LambdaIntegration(publicListJobs), noAuth);
        jobById.addMethod("GET", new apigw.LambdaIntegration(publicGetJob), noAuth);

        const resumeUpload = hiring.addResource("resume-upload-url");
        resumeUpload.addMethod("POST", new apigw.LambdaIntegration(getResumeUploadUrl), noAuth);

        const resumeDownload = hiring.addResource("resume-download-url");
        resumeDownload.addMethod("GET", new apigw.LambdaIntegration(getResumeDownloadUrl), authOpts);

        // ── Comp Plans (authenticated) ──
        const compPlanRes = candidateById.addResource("comp-plan");
        compPlanRes.addMethod("POST", new apigw.LambdaIntegration(createCompPlan), authOpts);
        compPlanRes.addMethod("GET", new apigw.LambdaIntegration(getCompPlan), authOpts);
        compPlanRes.addMethod("PUT", new apigw.LambdaIntegration(updateCompPlan), authOpts);

        // ── Deel Integration (authenticated) ──
        const pushToDeel = candidateById.addResource("push-to-deel");
        pushToDeel.addMethod("POST", new apigw.LambdaIntegration(createDeelContract), authOpts);

        /* ──────── Outputs ──────── */

        new cdk.CfnOutput(this, "ResumeBucketName", {
            value: this.resumeBucket.bucketName,
            description: "S3 bucket for candidate resumes",
        });
    }
}
