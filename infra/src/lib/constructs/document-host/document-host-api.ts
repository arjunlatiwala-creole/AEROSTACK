import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import type { IApiAuth } from "../auth/cognito-auth";

export interface DocumentHostApiProps {
  api: apigw.RestApi;
  auth: IApiAuth;
  documentsTable: dynamodb.ITable;
  documentVersionsTable: dynamodb.ITable;
  documentAccessTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
  /** Base URL for the API (used for Drive webhook registration). e.g. https://api.example.com */
  apiBaseUrl: string;
  /** Frontend app URL (used in emails, share links). e.g. https://aerostack.enterprise.io */
  frontendUrl: string;
  /** Dropbox Sign integration settings (optional — feature disabled if not provided) */
  dropboxSign?: {
    clientId: string;
    apiKeySecretName: string;
    appSecret: string;
    baseUrl: string;
    testMode: boolean;
  };
}

export class DocumentHostApi extends Construct {
  public readonly documentBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly docuSignEnvelopesTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DocumentHostApiProps) {
    super(scope, id);

    /* ──────── S3 Bucket for Documents ──────── */

    this.documentBucket = new s3.Bucket(this, "DocumentBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      // Object Lock enabled so signed/ prefix documents are immutable (COMPLIANCE mode set per-object)
      objectLockEnabled: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: "ArchiveOldVersions",
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /* ──────── DocuSign Envelopes Table ──────── */

    this.docuSignEnvelopesTable = new dynamodb.Table(this, "DocuSignEnvelopes", {
      partitionKey: { name: "envelope_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    this.docuSignEnvelopesTable.addGlobalSecondaryIndex({
      indexName: "GSI_DocumentId",
      partitionKey: { name: "document_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
    });

    /* ──────── CloudFront Distribution ──────── */

    const oai = new cloudfront.OriginAccessIdentity(this, "OAI");
    this.documentBucket.grantRead(oai);

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(this.documentBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      comment: "AOS Document Host CDN",
    });

    /* ──────── Environment Maps ──────── */

    const documentsEnv = {
      DOCUMENTS_TABLE_NAME: props.documentsTable.tableName,
      DOCUMENT_VERSIONS_TABLE_NAME: props.documentVersionsTable.tableName,
      DOCUMENT_ACCESS_TABLE_NAME: props.documentAccessTable.tableName,
      DOCUSIGN_ENVELOPES_TABLE: this.docuSignEnvelopesTable.tableName,
      DOCUMENT_BUCKET_NAME: this.documentBucket.bucketName,
      CLOUDFRONT_DOMAIN: this.distribution.distributionDomainName,
      CLOUDFRONT_DISTRIBUTION_ID: this.distribution.distributionId,
      GOOGLE_DRIVE_SA_SECRET_NAME: "aerostack/document-host/google-drive-sa",
      WEBHOOK_HMAC_SECRET: "0479ac3375e2947a24d44d3701c619700a4826f3e2c9f2af0475ae5351b277d9",
      API_BASE_URL: props.apiBaseUrl,
      WEBHOOK_BASE_URL: props.apiBaseUrl,
      FRONTEND_URL: props.frontendUrl,
    };

    const dropboxSignEnv = props.dropboxSign ? {
      ...documentsEnv,
      DOCUMENT_VERSIONS_TABLE_NAME: props.documentVersionsTable.tableName,
      DOCUSIGN_ENVELOPES_TABLE: this.docuSignEnvelopesTable.tableName,
      DROPBOX_SIGN_CLIENT_ID: props.dropboxSign.clientId,
      DROPBOX_SIGN_API_KEY_SECRET: props.dropboxSign.apiKeySecretName,
      DROPBOX_SIGN_APP_SECRET: props.dropboxSign.appSecret,
      DROPBOX_SIGN_BASE_URL: props.dropboxSign.baseUrl,
      DROPBOX_SIGN_TEST_MODE: props.dropboxSign.testMode ? "true" : "false",
      ENABLE_DROPBOX_SIGN_CERTIFICATION: "true",
    } : null;

    /* ──────── Lambda Functions ──────── */

    const listDocuments = new nodejs.NodejsFunction(this, "ListDocuments", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/list-documents.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const createDocument = new nodejs.NodejsFunction(this, "CreateDocument", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/create-document.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const getDocument = new nodejs.NodejsFunction(this, "GetDocument", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/get-document.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const updateDocument = new nodejs.NodejsFunction(this, "UpdateDocument", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/update-document.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const deleteDocument = new nodejs.NodejsFunction(this, "DeleteDocument", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/delete-document.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const getVersions = new nodejs.NodejsFunction(this, "GetVersions", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/get-versions.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const getUploadUrl = new nodejs.NodejsFunction(this, "GetUploadUrl", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/get-upload-url.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const confirmUpload = new nodejs.NodejsFunction(this, "ConfirmUpload", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/confirm-upload.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const shareDocument = new nodejs.NodejsFunction(this, "ShareDocument", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/share-document.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const revokeAccess = new nodejs.NodejsFunction(this, "RevokeAccess", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/revoke-access.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const listAccess = new nodejs.NodejsFunction(this, "ListAccess", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/list-access.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const checkBatchAccess = new nodejs.NodejsFunction(this, "CheckBatchAccess", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/check-access.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const requestAccess = new nodejs.NodejsFunction(this, "RequestAccess", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/request-access.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const webhookHandler = new nodejs.NodejsFunction(this, "WebhookHandler", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/webhook-handler.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const servePublic = new nodejs.NodejsFunction(this, "ServePublic", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/serve-public.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const canvaPoller = new nodejs.NodejsFunction(this, "CanvaPoller", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/canva-poller.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.minutes(5),
    });

    const drivePoller = new nodejs.NodejsFunction(this, "DrivePoller", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/drive-poller.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.minutes(5),
    });

    const triggerSync = new nodejs.NodejsFunction(this, "TriggerSync", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/trigger-sync.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(60),
    });

    // Run Canva poller every 15 minutes
    const canvaPollRule = new events.Rule(this, "CanvaPollSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: "Poll Canva designs for changes every 15 minutes",
    });
    canvaPollRule.addTarget(new targets.LambdaFunction(canvaPoller));

    // Run Drive poller every 15 minutes
    const drivePollRule = new events.Rule(this, "DrivePollSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: "Poll Google Drive files for changes every 15 minutes",
    });
    drivePollRule.addTarget(new targets.LambdaFunction(drivePoller));

    // Renew Drive watches every 6 hours (watches expire after 24h max — Google hard limit)
    const driveWatchRenewer = new nodejs.NodejsFunction(this, "DriveWatchRenewer", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/drive-watch-renewer.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.minutes(5),
    });

    const watchRenewalRule = new events.Rule(this, "DriveWatchRenewalSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      description: "Renew Google Drive push notification watches every 6 hours (24h expiry is Google hard limit)",
    });
    watchRenewalRule.addTarget(new targets.LambdaFunction(driveWatchRenewer));

    // Drive webhook receiver — Google pushes file change notifications here
    const driveWebhook = new nodejs.NodejsFunction(this, "DriveWebhook", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/drive-watch.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(60),
    });

    const getDownloadUrl = new nodejs.NodejsFunction(this, "GetDownloadUrl", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/get-download-url.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const getShareLink = new nodejs.NodejsFunction(this, "GetShareLink", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/get-share-link.ts",
      handler: "handler",
      environment: documentsEnv,
    });

    const driveListFiles = new nodejs.NodejsFunction(this, "DriveListFiles", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/drive-list-files.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(30),
    });

    const driveCreateFile = new nodejs.NodejsFunction(this, "DriveCreateFile", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/drive-create-file.ts",
      handler: "handler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Canva short-link resolver — server-side replacement for the Vite dev proxy
    const canvaResolve = new nodejs.NodejsFunction(this, "CanvaResolve", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/canva-proxy.ts",
      handler: "resolveHandler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(30),
    });

    // Canva design page proxy (Googlebot UA) — server-side replacement for the Vite dev proxy
    const canvaProxy = new nodejs.NodejsFunction(this, "CanvaProxy", {
      ...props.lambdaDefaults,
      entry: "src/functions/document-host/canva-proxy.ts",
      handler: "proxyHandler",
      environment: documentsEnv,
      timeout: cdk.Duration.seconds(30),
    });

    /* ──────── DocuSign Lambda Functions (conditionally added) ──────── */

    let dropboxCreateSignatureRequest: nodejs.NodejsFunction | undefined;
    let dropboxListRequests: nodejs.NodejsFunction | undefined;
    let dropboxGetSigningUrl: nodejs.NodejsFunction | undefined;
    let dropboxWebhook: nodejs.NodejsFunction | undefined;

    if (dropboxSignEnv) {
      dropboxCreateSignatureRequest = new nodejs.NodejsFunction(this, "DropboxCreateSignatureRequest", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/dropbox-create-signature-request.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(60),
      });

      dropboxListRequests = new nodejs.NodejsFunction(this, "DropboxListRequests", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/dropbox-list-requests.ts",
        handler: "handler",
        environment: dropboxSignEnv,
      });

      dropboxGetSigningUrl = new nodejs.NodejsFunction(this, "DropboxGetSigningUrl", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/dropbox-get-signing-url.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(30),
      });

      dropboxWebhook = new nodejs.NodejsFunction(this, "DropboxWebhook", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/dropbox-webhook.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(60),
      });
    }

    // Returns presigned URLs for the Aerostack-signed PDF + cert (Signatures tab UI)
    let getSignedDownloadUrl: nodejs.NodejsFunction | undefined;
    if (dropboxSignEnv) {
      getSignedDownloadUrl = new nodejs.NodejsFunction(this, "GetSignedDownloadUrl", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/get-signed-download-url.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        // 30s + 512MB so the self-heal can pull the audit trail zip from
        // Dropbox Sign, extract it, and PUT back to S3 within the request.
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
      });
    }

    // Public sign-link Lambdas — only created when DocuSign is configured.
    // These are the Aerostack-hosted signing landing-page endpoints.
    let signLinkResolve: nodejs.NodejsFunction | undefined;
    let signLinkStart: nodejs.NodejsFunction | undefined;
    let signLinkComplete: nodejs.NodejsFunction | undefined;
    if (dropboxSignEnv) {
      signLinkResolve = new nodejs.NodejsFunction(this, "SignLinkResolve", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/sign-link-resolve.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(15),
      });
      signLinkStart = new nodejs.NodejsFunction(this, "SignLinkStart", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/sign-link-start.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(30),
      });
      // The "complete" Lambda bakes the signature into the PDF — needs more
      // memory + a longer timeout because pdf-lib loads the whole document.
      signLinkComplete = new nodejs.NodejsFunction(this, "SignLinkComplete", {
        ...props.lambdaDefaults,
        entry: "src/functions/document-host/sign-link-complete.ts",
        handler: "handler",
        environment: dropboxSignEnv,
        timeout: cdk.Duration.seconds(120),
        memorySize: 1024,
      });
    }

    /* ──────── IAM Permissions ──────── */

    const allLambdas = [
      listDocuments,
      createDocument,
      getDocument,
      updateDocument,
      deleteDocument,
      getVersions,
      getUploadUrl,
      confirmUpload,
      shareDocument,
      revokeAccess,
      listAccess,
      checkBatchAccess,
      requestAccess,
      webhookHandler,
      servePublic,
      canvaPoller,
      drivePoller,
      driveWebhook,
      driveWatchRenewer,
      triggerSync,
      getDownloadUrl,
      getShareLink,
      driveListFiles,
      driveCreateFile,
      canvaResolve,
      canvaProxy,
    ];

    for (const fn of allLambdas) {
      props.documentsTable.grantReadWriteData(fn);
      props.documentVersionsTable.grantReadWriteData(fn);
      props.documentAccessTable.grantReadWriteData(fn);
      this.docuSignEnvelopesTable.grantReadWriteData(fn);
      this.documentBucket.grantReadWrite(fn);
    }

    // Dropbox Sign Lambdas — additional permissions
    const dropboxSignLambdas = [
      dropboxCreateSignatureRequest,
      dropboxListRequests,
      dropboxGetSigningUrl,
      dropboxWebhook,
      signLinkResolve,
      signLinkStart,
      signLinkComplete,
      getSignedDownloadUrl,
    ].filter(Boolean) as nodejs.NodejsFunction[];

    for (const fn of dropboxSignLambdas) {
      props.documentsTable.grantReadWriteData(fn);
      props.documentVersionsTable.grantReadData(fn);
      props.documentAccessTable.grantReadWriteData(fn);
      this.documentBucket.grantReadWrite(fn);
      this.docuSignEnvelopesTable.grantReadWriteData(fn);
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [
            `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:aerostack/document-host/dropbox*`,
          ],
        }),
      );
      // Allow setting Object Lock on signed documents
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:PutObjectLegalHold", "s3:PutObjectRetention", "s3:GetBucketObjectLockConfiguration"],
          resources: [
            this.documentBucket.bucketArn,
            `${this.documentBucket.bucketArn}/*`,
          ],
        }),
      );
    }

    // Create-envelope, webhook, and complete-signing send Aerostack-branded emails
    // (invitations + completion notifications) via SES. Public landing-page
    // resolve/start Lambdas don't.
    for (const fn of [dropboxCreateSignatureRequest, dropboxWebhook, signLinkComplete].filter(Boolean) as nodejs.NodejsFunction[]) {
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: ["*"],
        }),
      );
    }

    // Grant Secrets Manager read access to webhook handler for provider credentials
    const secretsArn = `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:aerostack/document-host/*`;
    webhookHandler.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [secretsArn],
      }),
    );

    // Drive poller, webhook, renewer, trigger-sync, list-access, share/revoke access, update-doc, and checkBatchAccess need Secrets Manager for the Google Drive SA key
    for (const fn of [
      drivePoller,
      driveWebhook,
      driveWatchRenewer,
      triggerSync,
      driveListFiles,
      driveCreateFile,
      listAccess,
      checkBatchAccess,
      shareDocument,
      revokeAccess,
      updateDocument,
    ]) {
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [secretsArn],
        }),
      );
    }

    // requestAccess sends notification emails via SES
    requestAccess.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    /* ──────── API Gateway Routes ──────── */

    const docsResource = props.api.root.addResource("documents");

    // GET /documents
    docsResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(listDocuments),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents
    docsResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(createDocument),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/check-access
    const checkAccessResource = docsResource.addResource("check-access");
    checkAccessResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(checkBatchAccess),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    const docById = docsResource.addResource("{documentId}");

    // GET /documents/{documentId}
    docById.addMethod(
      "GET",
      new apigw.LambdaIntegration(getDocument),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // PUT /documents/{documentId}
    docById.addMethod(
      "PUT",
      new apigw.LambdaIntegration(updateDocument),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // DELETE /documents/{documentId}
    docById.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(deleteDocument),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // GET /documents/{documentId}/versions
    const versionsResource = docById.addResource("versions");
    versionsResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getVersions),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/{documentId}/upload
    const uploadResource = docById.addResource("upload");
    uploadResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(getUploadUrl),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/{documentId}/confirm-upload
    const confirmResource = docById.addResource("confirm-upload");
    confirmResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(confirmUpload),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // GET /documents/{documentId}/download
    const downloadResource = docById.addResource("download");
    downloadResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getDownloadUrl),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/{documentId}/share
    const shareResource = docById.addResource("share");
    shareResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(shareDocument),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // GET /documents/{documentId}/access
    const accessResource = docById.addResource("access");
    accessResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(listAccess),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/{documentId}/request-access
    const requestAccessResource = docById.addResource("request-access");
    requestAccessResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(requestAccess),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/{documentId}/sync
    const syncResource = docById.addResource("sync");
    syncResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(triggerSync),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // GET /documents/{documentId}/share-link
    const shareLinkResource = docById.addResource("share-link");
    shareLinkResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getShareLink),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // DELETE /documents/{documentId}/share/{accessId}
    const accessById = shareResource.addResource("{accessId}");
    accessById.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(revokeAccess),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/webhook/{provider} — no auth (HMAC verified in handler)
    const webhookResource = docsResource.addResource("webhook");
    const webhookByProvider = webhookResource.addResource("{provider}");
    webhookByProvider.addMethod(
      "POST",
      new apigw.LambdaIntegration(webhookHandler),
      { authorizationType: apigw.AuthorizationType.NONE },
    );

    // ─── Drive Playground (service-account, impersonates logged-in user) ───
    const driveResource = docsResource.addResource("drive");

    // GET /documents/drive/files?tab=shared|mine&query=…
    const driveFilesResource = driveResource.addResource("files");
    driveFilesResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(driveListFiles),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/drive/create
    const driveCreateResource = driveResource.addResource("create");
    driveCreateResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(driveCreateFile),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // ─── Canva proxy (server-side replacement for the Vite dev proxy) ───
    const canvaResource = docsResource.addResource("canva");

    // GET /documents/canva/resolve?code=<shortCode>
    const canvaResolveResource = canvaResource.addResource("resolve");
    canvaResolveResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(canvaResolve),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // GET /documents/canva/proxy?path=/design/...
    const canvaProxyResource = canvaResource.addResource("proxy");
    canvaProxyResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(canvaProxy),
      { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
    );

    // POST /documents/drive-webhook — Google Drive push notifications (no auth, verified by channel ID)
    const driveWebhookResource = docsResource.addResource("drive-webhook");
    driveWebhookResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(driveWebhook),
      { authorizationType: apigw.AuthorizationType.NONE },
    );

    // ─── DocuSign routes (only added when docuSign config is provided) ───
    if (dropboxCreateSignatureRequest && dropboxListRequests && dropboxGetSigningUrl && dropboxWebhook) {
      // Sign sub-resource under document by ID
      const signResource = docById.addResource("sign");

      // GET/POST /documents/{documentId}/sign/envelopes
      const envelopesResource = signResource.addResource("envelopes");
      envelopesResource.addMethod(
        "GET",
        new apigw.LambdaIntegration(dropboxListRequests),
        { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
      );
      envelopesResource.addMethod(
        "POST",
        new apigw.LambdaIntegration(dropboxCreateSignatureRequest),
        { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
      );

      // POST /documents/{documentId}/sign/envelopes/{envelopeId}/signing-url
      const envelopeById = envelopesResource.addResource("{envelopeId}");
      const signingUrlResource = envelopeById.addResource("signing-url");
      signingUrlResource.addMethod(
        "POST",
        new apigw.LambdaIntegration(dropboxGetSigningUrl),
        { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
      );

      // GET /documents/{documentId}/sign/envelopes/{envelopeId}/signed-download
      // Returns a presigned S3 URL for the Aerostack-signed PDF + certificate.
      if (getSignedDownloadUrl) {
        const signedDownloadResource = envelopeById.addResource("signed-download");
        signedDownloadResource.addMethod(
          "GET",
          new apigw.LambdaIntegration(getSignedDownloadUrl),
          { authorizer: props.auth.authorizer, authorizationType: apigw.AuthorizationType.COGNITO },
        );
      }

      // POST /documents/sign/webhook — Dropbox Sign Callback (no auth, HMAC-verified)
      const signTopLevel = docsResource.addResource("sign");
      const signWebhookResource = signTopLevel.addResource("webhook");
      signWebhookResource.addMethod(
        "POST",
        new apigw.LambdaIntegration(dropboxWebhook),
        { authorizationType: apigw.AuthorizationType.NONE },
      );

      // ─── Public sign-link routes (no auth — token in URL is the credential) ───
      // GET  /documents/sign/link/{envelopeId}?token=<t>      → resolve envelope + form
      // POST /documents/sign/link/{envelopeId}/start          → submit form, get signing URL
      // POST /documents/sign/link/{envelopeId}/complete       → bake signature, lock PDF
      if (signLinkResolve && signLinkStart && signLinkComplete) {
        const signLinkResource = signTopLevel.addResource("link");
        const signLinkByEnvelope = signLinkResource.addResource("{envelopeId}");
        signLinkByEnvelope.addMethod(
          "GET",
          new apigw.LambdaIntegration(signLinkResolve),
          { authorizationType: apigw.AuthorizationType.NONE },
        );
        const signLinkStartResource = signLinkByEnvelope.addResource("start");
        signLinkStartResource.addMethod(
          "POST",
          new apigw.LambdaIntegration(signLinkStart),
          { authorizationType: apigw.AuthorizationType.NONE },
        );
        const signLinkCompleteResource = signLinkByEnvelope.addResource("complete");
        signLinkCompleteResource.addMethod(
          "POST",
          new apigw.LambdaIntegration(signLinkComplete),
          { authorizationType: apigw.AuthorizationType.NONE },
        );
      }
    }

    // GET /public/docs/{slug+} — no auth (greedy path to support owner/slug pattern)
    const publicResource = props.api.root
      .addResource("public")
      .addResource("docs")
      .addResource("{slug+}");
    publicResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(servePublic),
      { authorizationType: apigw.AuthorizationType.NONE },
    );

    /* ──────── Outputs ──────── */

    new cdk.CfnOutput(this, "DocumentBucketName", {
      value: this.documentBucket.bucketName,
    });
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: this.distribution.distributionDomainName,
    });
  }
}
