import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { IApiAuth } from "../../constructs/auth/cognito-auth";
import { loopsModels } from "../../models/loops";
import { getConfig } from "../../config";

export class LoopsApiConstruct extends Construct {
	public readonly openApiSpec: any;

	constructor(
		scope: Construct,
		id: string,
		props: {
			api: apigw.RestApi;
			loopsTable: dynamodb.ITable;
			deelPeopleTable: dynamodb.ITable;
			personTable: dynamodb.ITable;
			auth: IApiAuth;
		},
	) {
		super(scope, id);

		const createLoopFn = new lambda.NodejsFunction(this, "CreateLoopLambda", {
			entry: "src/functions/loops/create-loop.ts",
			handler: "handler",
			timeout: cdk.Duration.seconds(30),
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const getLoopFn = new lambda.NodejsFunction(this, "GetLoopLambda", {
			entry: "src/functions/loops/get-loop.ts",
			handler: "handler",
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const listLoopFn = new lambda.NodejsFunction(this, "ListLoopLambda", {
			entry: "src/functions/loops/list-loops.ts",
			handler: "handler",
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const updateLoopFn = new lambda.NodejsFunction(this, "UpdateLoopLambda", {
			entry: "src/functions/loops/update-loop.ts",
			handler: "handler",
			timeout: cdk.Duration.seconds(30),
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const scoreLoopFn = new lambda.NodejsFunction(this, "ScoreLoopLambda", {
			entry: "src/functions/loops/score-loop.ts",
			handler: "handler",
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const adaptLoopFn = new lambda.NodejsFunction(this, "adaptLoopLambda", {
			entry: "src/functions/loops/adapt-loop.ts",
			handler: "handler",
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const getLearningLoopsWithPeopleFn = new lambda.NodejsFunction(
			this,
			"GetLearningLoopsWithPeopleLambda",
			{
				entry: "src/functions/loops/get-learning-loops-with-people.ts",
				handler: "handler",
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				},
			},
		);

		const cfg = getConfig();
		const googleEnv: Record<string, string> = {
			...(cfg.googleDirectorySecretName
				? { GOOGLE_SA_SECRET_NAME: cfg.googleDirectorySecretName }
				: {}),
			...(cfg.googleAdminEmail
				? { GOOGLE_ADMIN_EMAIL: cfg.googleAdminEmail }
				: {}),
		};

		const searchDeelPeopleFn = new lambda.NodejsFunction(
			this,
			"SearchDeelPeopleLambda",
			{
				entry: "src/functions/loops/suggest.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(30),
				environment: {
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
					PERSON_TABLE_NAME: props.personTable.tableName,
					...googleEnv,
				},
			},
		);

		const getDeelPeopleCountFn = new lambda.NodejsFunction(
			this,
			"GetDeelPeopleCountLambda",
			{
				entry: "src/functions/loops/get-deel-people-count.ts",
				handler: "handler",
				environment: {
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				},
			},
		);

		const getDeliveryLoopsFn = new lambda.NodejsFunction(
			this,
			"GetDeliveryLoopsLambda",
			{
				entry: "src/functions/loops/get-delivery-loop.ts",
				handler: "handler",
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				},
			},
		);

		const getOpportunityLoopsFn = new lambda.NodejsFunction(
			this,
			"GetOpportunityLoopsLambda",
			{
				entry: "src/functions/loops/get-opportunity.ts",
				handler: "handler",
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				},
			},
		);

		const deleteLoopFn = new lambda.NodejsFunction(this, "DeleteLoopLambda", {
			entry: "src/functions/loops/delete-loop.ts",
			handler: "handler",
			environment: {
				LOOPS_TABLE_NAME: props.loopsTable.tableName,
			},
		});

		const bulkAssignFn = new lambda.NodejsFunction(
			this,
			"BulkAssignLoopLambda",
			{
				entry: "src/functions/loops/bulk-assign.ts",
				handler: "handler",
				timeout: cdk.Duration.minutes(5),
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
					PERSON_TABLE_NAME: props.personTable.tableName,
					...googleEnv,
				},
			},
		);

		const listGoogleGroupsFn = new lambda.NodejsFunction(
			this,
			"ListGoogleGroupsLambda",
			{
				entry: "src/functions/loops/list-google-groups.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(30),
				environment: {
					...googleEnv,
				},
			},
		);

		const listWorkspaceUsersFn = new lambda.NodejsFunction(
			this,
			"ListWorkspaceUsersLambda",
			{
				entry: "src/functions/loops/list-workspace-users.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(60),
				environment: {
					...googleEnv,
				},
			},
		);

		// Grant Secrets Manager read access for the Google service account
		// so bulk-assign (group resolution) and list-google-groups can call
		// the Directory API. Looked up by NAME — CDK resolves the ARN.
		if (cfg.googleDirectorySecretName) {
			const googleSaSecret = sm.Secret.fromSecretNameV2(
				this,
				"LoopsGoogleSaSecret",
				cfg.googleDirectorySecretName,
			);
			googleSaSecret.grantRead(bulkAssignFn);
			googleSaSecret.grantRead(listGoogleGroupsFn);
			googleSaSecret.grantRead(listWorkspaceUsersFn);
			googleSaSecret.grantRead(searchDeelPeopleFn);
		}

		const getLearningCompletionFn = new lambda.NodejsFunction(
			this,
			"GetLearningCompletionLambda",
			{
				entry: "src/functions/loops/get-learning-completion.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(30),
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
					DEEL_PEOPLE_TABLE_NAME: props.deelPeopleTable.tableName,
				},
			},
		);

		// Grant SES permissions
		const sesPolicy = new iam.PolicyStatement({
			actions: ["ses:SendEmail", "ses:SendRawEmail"],
			resources: ["*"],
		});

		const sendReminderFn = new lambda.NodejsFunction(
			this,
			"SendReminderLambda",
			{
				entry: "src/functions/loops/send-reminder.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(15),
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
				},
			},
		);

		const addCommentFn = new lambda.NodejsFunction(
			this,
			"AddCommentLambda",
			{
				entry: "src/functions/loops/add-comment.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(15),
				environment: {
					LOOPS_TABLE_NAME: props.loopsTable.tableName,
				},
			},
		);

		// Moodle integration: fetches course list from the configured Moodle instance
		const moodleEnv: Record<string, string> = {
			...(cfg.moodleUrl ? { MOODLE_URL: cfg.moodleUrl } : {}),
			...(cfg.moodleToken ? { MOODLE_TOKEN: cfg.moodleToken } : {}),
		};

		const getMoodleCoursesFn = new lambda.NodejsFunction(
			this,
			"GetMoodleCoursesLambda",
			{
				entry: "src/functions/loops/get-moodle-courses.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(30),
				environment: {
					...moodleEnv
				},
			},
		);

		const updateMoodleCourseFn = new lambda.NodejsFunction(
			this,
			"UpdateMoodleCourseLambda",
			{
				entry: "src/functions/loops/update-moodle-course.ts",
				handler: "handler",
				timeout: cdk.Duration.seconds(30),
				environment: {
					...moodleEnv
				},
			},
		);

		// Grant bulk-assign Lambda the Moodle env vars too (when configured)
		if (cfg.moodleUrl && cfg.moodleToken) {
			bulkAssignFn.addEnvironment("MOODLE_URL", cfg.moodleUrl);
			bulkAssignFn.addEnvironment("MOODLE_TOKEN", cfg.moodleToken);
		}

		createLoopFn.addToRolePolicy(sesPolicy);
		updateLoopFn.addToRolePolicy(sesPolicy);
		bulkAssignFn.addToRolePolicy(sesPolicy);
		sendReminderFn.addToRolePolicy(sesPolicy);
		addCommentFn.addToRolePolicy(sesPolicy);

		/**
		 * Grant table permissions to all lambdas
		 */
		const allLambdas = [
			createLoopFn,
			getLoopFn,
			listLoopFn,
			updateLoopFn,
			scoreLoopFn,
			adaptLoopFn,
			getLearningLoopsWithPeopleFn,
			searchDeelPeopleFn,
			getDeelPeopleCountFn,
			getDeliveryLoopsFn,
			getOpportunityLoopsFn,
			deleteLoopFn,
			bulkAssignFn,
			getLearningCompletionFn,
			listGoogleGroupsFn,
			listWorkspaceUsersFn,
			sendReminderFn,
			addCommentFn,
			getMoodleCoursesFn,
			updateMoodleCourseFn,
		];

		const allTables = [
			props.loopsTable,
			props.deelPeopleTable,
			props.personTable,
		];

		// Grant read/write access to all tables for all lambdas
		this.grantTableAccess(allLambdas, allTables, true);

		const loopsResource = props.api.root.addResource("loops");

		// Models
		const createLoopModel = props.api.addModel("CreateLoopRequest", {
			contentType: "application/json",
			modelName: "CreateLoopRequest",
			schema: loopsModels.createLoop.schema,
		});

		const updateLoopModel = props.api.addModel("UpdateLoopRequest", {
			contentType: "application/json",
			modelName: "UpdateLoopRequest",
			schema: loopsModels.updateLoop.schema,
		});

		const scoreModel = props.api.addModel("ScoreRequest", {
			contentType: "application/json",
			modelName: "ScoreRequest",
			schema: loopsModels.score.schema,
		});

		const adaptLoopModel = props.api.addModel("AdaptLoopRequest", {
			contentType: "application/json",
			modelName: "AdaptLoopRequest",
			schema: loopsModels.adaptLoop.schema,
		});

		loopsResource.addMethod("POST", new apigw.LambdaIntegration(createLoopFn), {
			...props.auth.getMethodOptions(),
			requestModels: { "application/json": createLoopModel },
			requestValidator: new apigw.RequestValidator(
				this,
				"CreateLoopValidator",
				{
					restApi: props.api,
					validateRequestBody: true,
				},
			),
		});
		loopsResource.addMethod("GET", new apigw.LambdaIntegration(listLoopFn), {
			...props.auth.getMethodOptions(),
			requestParameters: {
				"method.request.querystring.category": false,
				"method.request.querystring.status": false,
				"method.request.querystring.phase": false,
				"method.request.querystring.sort": false,
				"method.request.querystring.limit": false,
				"method.request.querystring.last_key": false,
				"method.request.querystring.priority": false,
				"method.request.querystring.owner_email": false,
			},
		});

		const singleLoop = loopsResource.addResource("{loopId}");
		singleLoop.addMethod("GET", new apigw.LambdaIntegration(getLoopFn), {
			...props.auth.getMethodOptions(),
			requestParameters: { "method.request.path.loopId": true },
		});
		singleLoop.addMethod("PATCH", new apigw.LambdaIntegration(updateLoopFn), {
			...props.auth.getMethodOptions(),
			requestModels: { "application/json": updateLoopModel },
			requestParameters: { "method.request.path.loopId": true },
			requestValidator: new apigw.RequestValidator(
				this,
				"UpdateLoopValidator",
				{
					restApi: props.api,
					validateRequestBody: true,
					validateRequestParameters: true,
				},
			),
		});

		const scoreResource = singleLoop.addResource("score");
		scoreResource.addMethod("POST", new apigw.LambdaIntegration(scoreLoopFn), {
			...props.auth.getMethodOptions(),
			requestModels: { "application/json": scoreModel },
			requestParameters: { "method.request.path.loopId": true },
			requestValidator: new apigw.RequestValidator(this, "ScoreLoopValidator", {
				restApi: props.api,
				validateRequestBody: true,
				validateRequestParameters: true,
			}),
		});

		const adaptResource = singleLoop.addResource("adapt");
		adaptResource.addMethod("POST", new apigw.LambdaIntegration(adaptLoopFn), {
			...props.auth.getMethodOptions(),
			requestModels: { "application/json": adaptLoopModel },
			requestParameters: { "method.request.path.loopId": true },
			requestValidator: new apigw.RequestValidator(
				this,
				"TransitionLoopValidator",
				{
					restApi: props.api,
					validateRequestBody: true,
					validateRequestParameters: true,
				},
			),
		});

		const commentsResource = singleLoop.addResource("comments");
		commentsResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(addCommentFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: { "method.request.path.loopId": true },
			},
		);

		const learningWithPeopleResource = loopsResource.addResource(
			"learning-with-people",
		);
		learningWithPeopleResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getLearningLoopsWithPeopleFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.cursor": false,
				},
			},
		);

		const bulkAssignResource = loopsResource.addResource("bulk-assign");
		bulkAssignResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(bulkAssignFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		const googleGroupsResource = loopsResource.addResource("google-groups");
		googleGroupsResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listGoogleGroupsFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		const sendReminderResource = loopsResource.addResource("send-reminder");
		sendReminderResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(sendReminderFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		const workspaceUsersResource = loopsResource.addResource("workspace-users");
		workspaceUsersResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(listWorkspaceUsersFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		const learningCompletionResource =
			loopsResource.addResource("learning-completion");
		learningCompletionResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getLearningCompletionFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		// Moodle catalog — returns all visible courses from the configured Moodle instance
		const moodleCoursesResource = loopsResource.addResource("moodle-courses");
		moodleCoursesResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getMoodleCoursesFn),
			{
				...props.auth.getMethodOptions(),
			},
		);
		moodleCoursesResource.addMethod(
			"POST",
			new apigw.LambdaIntegration(updateMoodleCourseFn),
			{
				...props.auth.getMethodOptions(),
			},
		);
		const deelResource = loopsResource.addResource("deel-people");
		const searchResource = deelResource.addResource("search");

		searchResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(searchDeelPeopleFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.q": true,
				},
			},
		);

		const deelCountResource = deelResource.addResource("count");
		deelCountResource.addMethod(
			"GET",
			new apigw.LambdaIntegration(getDeelPeopleCountFn),
			{
				...props.auth.getMethodOptions(),
			},
		);

		const deliveryLoop = loopsResource.addResource("delivery");
		deliveryLoop.addMethod(
			"GET",
			new apigw.LambdaIntegration(getDeliveryLoopsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.cursor": false,
				},
			},
		);

		const opportunityLoop = loopsResource.addResource("opportunity");
		opportunityLoop.addMethod(
			"GET",
			new apigw.LambdaIntegration(getOpportunityLoopsFn),
			{
				...props.auth.getMethodOptions(),
				requestParameters: {
					"method.request.querystring.limit": false,
					"method.request.querystring.cursor": false,
				},
			},
		);

		// const deleteLoop = loopsResource.addResource("{loopId}");
		singleLoop.addMethod("DELETE", new apigw.LambdaIntegration(deleteLoopFn), {
			...props.auth.getMethodOptions(),
			// Remove requestModels - DELETE doesn't need body validation
			requestParameters: { "method.request.path.loopId": true },
			requestValidator: new apigw.RequestValidator(
				this,
				"DeleteLoopValidator",
				{
					restApi: props.api,
					validateRequestBody: false, // ✅ Set to false for DELETE
					validateRequestParameters: true, // ✅ Keep this to validate path params
				},
			),
		});

		this.openApiSpec = {
			openapi: "3.0.3",
			info: {
				title: "Loops API",
				version: "1.0.0",
				description:
					"API for managing loops - objectives and key results tracking system",
			},
			tags: [{ name: "Loops", description: "Loop management endpoints" }],
			paths: {
				"/loops": {
					post: {
						summary: "Create a new loop",
						description:
							"Creates a new loop (objective or key result) in the system",
						tags: ["Loops"],
						requestBody: {
							content: {
								"application/json": {
									schema: loopsModels.createLoop.schema,
									example: loopsModels.createLoop.example,
								},
							},
							required: true,
						},
						responses: {
							"201": {
								description: "Loop created successfully",
								content: {
									"application/json": {
										example: {
											loop_id: "loop_12345",
											title: "Implement user authentication system",
											category: "ENG",
											status: "PLANNED",
											phase: "PROJECTION",
											created_at: "2026-01-12T10:30:00Z",
										},
									},
								},
							},
							"400": { description: "Validation error" },
							"500": { description: "Internal server error" },
						},
					},
					get: {
						summary: "List loops",
						description:
							"Retrieve a list of loops with optional filtering and pagination",
						tags: ["Loops"],
						parameters: [
							{
								name: "category",
								in: "query",
								schema: {
									type: "string",
									enum: [
										"ENG",
										"MSP",
										"GTM",
										"BD",
										"OPS:Finance",
										"OPS:HR",
										"OPS:SalesOps",
										"OAL",
										"LEARNING",
										"PRO-DEV",
										"LND",
										"ONBOARDING",
										"SKILLS_CERT",
										"COMMS_FLUENCY",
										"ADVISORY",
									],
								},
								example: "ENG",
							},
							{
								name: "status",
								in: "query",
								schema: {
									type: "string",
									enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "ARCHIVED"],
								},
								example: "IN_PROGRESS",
							},
							{
								name: "phase",
								in: "query",
								schema: {
									type: "string",
									enum: [
										"PROJECTION",
										"ASSERTION",
										"FOCUS",
										"FEEDBACK",
										"ADAPTATION",
									],
								},
								example: "FOCUS",
							},
							{
								name: "sort",
								in: "query",
								schema: { type: "string" },
								example: "priority",
							},
							{
								name: "limit",
								in: "query",
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 100,
									default: 50,
								},
								example: 20,
							},
							{
								name: "last_key",
								in: "query",
								schema: { type: "string" },
								description: "Pagination cursor from previous response",
							},
						],
						responses: {
							"200": {
								description: "List of loops retrieved successfully",
								content: {
									"application/json": {
										example: {
											items: [
												{
													loop_id: "loop_12345",
													title: "Implement user authentication system",
													category: "ENG",
													status: "IN_PROGRESS",
													phase: "FOCUS",
													priority: 3,
													owner_email: "john.doe@company.com",
												},
											],
											last_key: "loop_12345",
											count: 1,
										},
									},
								},
							},
							"400": { description: "Bad Request" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/deel-people/search": {
					get: {
						summary: "Search Deel people by email prefix",
						description:
							"Returns a list of Deel people whose email starts with the given query string",
						tags: ["Deel"],
						parameters: [
							{
								name: "q",
								in: "query",
								required: true,
								schema: { type: "string", minLength: 1 },
								example: "di",
							},
						],
						responses: {
							"200": {
								description: "Matching Deel people",
								content: {
									"application/json": {
										example: [
											{
												id: "p_123",
												email: "dina@company.com",
												full_name: "Dina Shah",
												active: 1,
											},
										],
									},
								},
							},
							"400": { description: "Missing query" },
							"500": { description: "Server error" },
						},
					},
				},
				"/loops/{loopId}": {
					get: {
						summary: "Get a loop by ID",
						description: "Retrieve detailed information about a specific loop",
						tags: ["Loops"],
						parameters: [
							{
								name: "loopId",
								in: "path",
								required: true,
								schema: { type: "string" },
								example: "loop_12345",
							},
						],
						responses: {
							"200": {
								description: "Loop retrieved successfully",
								content: {
									"application/json": {
										example: {
											loop_id: "loop_12345",
											title: "Implement user authentication system",
											description:
												"Build secure authentication with OAuth 2.0 and JWT tokens",
											category: "ENG",
											pillar: "TECHOPS",
											loop_type: "KEY_RESULT",
											status: "IN_PROGRESS",
											phase: "FOCUS",
											priority: 3,
											start_date: "2026-01-01",
											target_completion_date: "2026-03-15",
											created_at: "2026-01-01T00:00:00Z",
											updated_at: "2026-01-12T10:30:00Z",
											owner_email: "john.doe@company.com",
											tags: ["security", "authentication", "backend"],
										},
									},
								},
							},
							"404": { description: "Loop not found" },
							"500": { description: "Internal server error" },
						},
					},
					patch: {
						summary: "Update a loop",
						description: "Update specific fields of an existing loop",
						tags: ["Loops"],
						parameters: [
							{
								name: "loopId",
								in: "path",
								required: true,
								schema: { type: "string" },
								example: "loop_12345",
							},
						],
						requestBody: {
							content: {
								"application/json": {
									schema: loopsModels.updateLoop.schema,
									example: loopsModels.updateLoop.example,
								},
							},
							required: true,
						},
						responses: {
							"200": {
								description: "Loop updated successfully",
								content: {
									"application/json": {
										example: {
											loop_id: "loop_12345",
											title: "Implement user authentication system - Updated",
											status: "IN_PROGRESS",
											phase: "FOCUS",
											updated_at: "2026-01-12T11:00:00Z",
										},
									},
								},
							},
							"400": { description: "Validation error" },
							"404": { description: "Loop not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/{loopId}/score": {
					post: {
						summary: "Score a loop (Effort or Outcome)",
						description:
							"Add effort or outcome scores to a loop, including optional contributors and lessons learned",
						tags: ["Loops"],
						parameters: [
							{
								name: "loopId",
								in: "path",
								required: true,
								schema: { type: "string" },
								example: "loop_12345",
							},
						],
						requestBody: {
							content: {
								"application/json": {
									schema: {
										oneOf: [
											loopsModels.scoreEffort.schema,
											loopsModels.scoreOutcome.schema,
										],
									},
									examples: {
										effort: {
											summary: "Score effort",
											value: loopsModels.scoreEffort.example,
										},
										outcome: {
											summary: "Score outcome with contributors and lesson",
											value: loopsModels.scoreOutcome.example,
										},
									},
								},
							},
							required: true,
						},
						responses: {
							"200": {
								description: "Loop scored successfully",
								content: {
									"application/json": {
										example: {
											loop_id: "loop_12345",
											effort_score: 4,
											outcome_score: 5,
											loop_score: 4.5,
											updated_at: "2026-01-12T12:00:00Z",
										},
									},
								},
							},
							"400": { description: "Validation error" },
							"404": { description: "Loop not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/{loopId}/adapt": {
					post: {
						summary: "Adapt a loop",
						description:
							"Adapt a loop by changing its target date and optionally creating a follow-on loop",
						tags: ["Loops"],
						parameters: [
							{
								name: "loopId",
								in: "path",
								required: true,
								schema: { type: "string" },
								example: "loop_12345",
							},
						],
						requestBody: {
							content: {
								"application/json": {
									schema: loopsModels.adaptLoop.schema,
									example: loopsModels.adaptLoop.example,
								},
							},
							required: true,
						},
						responses: {
							"200": {
								description: "Loop adapted successfully",
								content: {
									"application/json": {
										example: {
											loop_id: "loop_12345",
											target_completion_date: "2026-04-30",
											adaptations: [
												{
													why: "Additional security requirements discovered during security audit",
													what: "Scope expanded to include Google and Microsoft OAuth providers plus SMS-based MFA",
													previous_target_date: "2026-03-15",
													new_target_date: "2026-04-30",
													adapted_at: "2026-01-12T13:00:00Z",
													follow_on_loop_id: "loop_67890",
												},
											],
											follow_on_loop_id: "loop_67890",
										},
									},
								},
							},
							"400": { description: "Validation error" },
							"404": { description: "Loop not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/delivery": {
					get: {
						summary: "Get delivery loops with Deel person data",
						description:
							"Retrieve loops with category 'DELIVERY' along with their corresponding Deel person information. Supports pagination.",
						tags: ["Loops"],
						parameters: [
							{
								name: "limit",
								in: "query",
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 100,
									default: 50,
								},
								description: "Number of items per page",
								example: 20,
							},
							{
								name: "cursor",
								in: "query",
								schema: { type: "string" },
								description:
									"Pagination cursor from previous response (nextCursor)",
								example:
									"eyJsb29wX2lkIjoiNGIzNzA4MzEtN2E4Ni00OTYyLTg2NTMtYWEyZmQ1ODJkZTBlIn0=",
							},
						],
						responses: {
							"200": {
								description:
									"Learning loops with Deel person data retrieved successfully",
								content: {
									"application/json": {
										example: {
											items: [
												{
													loop_data: {
														loop_id: "4b370831-7a86-4962-8653-aa2fd582de0e",
														title: "Complete AI/ML Training Course",
														category: "MSP",
														status: "PLANNED",
														phase: "PROJECTION",
														priority: 3,
														owner_email: "john.doe@company.com",
														description:
															"Complete advanced machine learning certification",
														target_completion_date: "2026-03-15",
														loop_type: "KEY_RESULT",
														pillar: "CROSS",
														tags: [
															"learning",
															"ai",
															"professional-development",
														],
														created_at: "2026-01-29T09:40:14.536Z",
														updated_at: "2026-01-29T09:40:14.536Z",
													},
													deel_person: {
														id: "deel_user_123",
														email: "john.doe@company.com",
														alternate_email: "j.doe@personal.com",
														given_name: "John",
														family_name: "Doe",
														job_title: "Senior Software Engineer",
														active: 1,
														department: {
															id: "dept_456",
															name: "Engineering",
														},
														start_date: "2024-01-15",
														seniority: "Senior",
														hiring_status: "active",
													},
												},
											],
											pageSize: 20,
											total: 45,
											totalPages: 3,
											hasMore: true,
											nextCursor:
												"eyJsb29wX2lkIjoiNGIzNzA4MzEtN2E4Ni00OTYyLTg2NTMtYWEyZmQ1ODJkZTBlIn0=",
											count: 20,
										},
									},
								},
							},
							"400": { description: "Invalid query parameters" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/opportunity": {
					get: {
						summary: "Get opportunity prioritization loops",
						description:
							"Retrieve prioritized loops from categories BD, GTM, ADVISORY with status PLANNED or IN_PROGRESS. Sorted by priority, weighted score, and target completion date. Supports pagination.",
						tags: ["Loops"],
						parameters: [
							{
								name: "limit",
								in: "query",
								schema: {
									type: "integer",
									minimum: 1,
									maximum: 100,
									default: 50,
								},
								description: "Number of items per page",
								example: 20,
							},
							{
								name: "nextCursor",
								in: "query",
								schema: { type: "string" },
								description:
									"Pagination cursor from previous response (nextCursor)",
								example:
									"eyJ0aW1lc3RhbXAiOiIyMDI2LTAyLTAxVDA5OjAwOjAwLjAwMFoiLCJsYXN0SWQiOiI0YjM3MDgzMS03YTg2LTQ5NjItODY1My1hYTJmZDU4MmRlMGUifQ==",
							},
						],
						responses: {
							"200": {
								description:
									"Opportunity prioritization loops retrieved successfully",
								content: {
									"application/json": {
										example: {
											items: [
												{
													loop_id: "b12f0831-7a86-4962-8653-aa2fd582de99",
													title: "Strategic GTM Expansion",
													category: "GTM",
													priority: 1,
													target_completion_date: "2026-03-31",
													loop_score: 4,
													weighted_score: 20,
													owner_name: null,
												},
												{
													loop_id: "c22e0831-7a86-4962-8653-aa2fd582de88",
													title: "Advisory Board Setup",
													category: "ADVISORY",
													priority: 2,
													target_completion_date: "2026-04-15",
													loop_score: 3,
													weighted_score: 12,
													owner_name: null,
												},
											],
											pageSize: 20,
											hasMore: true,
											nextCursor:
												"eyJ0aW1lc3RhbXAiOiIyMDI2LTAyLTAxVDA5OjAwOjAwLjAwMFoiLCJsYXN0SWQiOiI0YjM3MDgzMS03YTg2LTQ5NjItODY1My1hYTJmZDU4MmRlMGUifQ==",
											count: 2,
										},
									},
								},
							},
							"400": { description: "Invalid query parameters" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/{loop_id}": {
					delete: {
						summary: "Delete a loop",
						tags: ["Loops"],
						parameters: [
							{
								name: "loop_id",
								in: "path",
								required: true,
								schema: { type: "string", format: "uuid" },
							},
						],
						responses: {
							"200": { description: "Loop deleted successfully" },
							"404": { description: "Loop not found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/bulk-assign": {
					post: {
						summary: "Bulk assign a learning requirement",
						description:
							"Creates a learning loop for every person in the organization or a specific list of people",
						tags: ["Loops"],
						requestBody: {
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["title", "assign_to"],
										properties: {
											title: { type: "string", minLength: 1 },
											description: { type: "string" },
											category: {
												type: "string",
												enum: ["OAL", "LEARNING", "PRO-DEV", "LND", "ONBOARDING", "SKILLS_CERT", "COMMS_FLUENCY"],
												default: "OAL",
											},
											loop_type: {
												type: "string",
												enum: ["OBJECTIVE", "KEY_RESULT"],
												default: "KEY_RESULT",
											},
											priority: {
												type: "integer",
												minimum: 1,
												maximum: 5,
												default: 3,
											},
											target_completion_date: { type: "string", format: "date" },
											tags: { type: "array", items: { type: "string" } },
											assign_to: {
												type: "string",
												enum: ["everyone", "specific", "group"],
											},
											recipient_emails: {
												type: "array",
												items: { type: "string", format: "email" },
												description:
													"Required when assign_to is 'specific'",
											},
											group_emails: {
												type: "array",
												items: { type: "string", format: "email" },
												description:
													"Required when assign_to is 'group'. List of Google Workspace group emails whose members will be resolved server-side.",
											},
										},
									},
									example: {
										title: "Complete AWS Security Fundamentals",
										description:
											"All team members must complete the AWS Security Fundamentals course by end of quarter",
										category: "OAL",
										priority: 2,
										target_completion_date: "2026-06-30",
										tags: ["security", "aws", "mandatory"],
										assign_to: "everyone",
									},
								},
							},
							required: true,
						},
						responses: {
							"201": {
								description: "Bulk assignment completed",
								content: {
									"application/json": {
										example: {
											created_count: 15,
											failed_count: 0,
											loop_ids: ["uuid-1", "uuid-2"],
										},
									},
								},
							},
							"400": { description: "Validation error or no recipients found" },
							"500": { description: "Internal server error" },
						},
					},
				},
				"/loops/google-groups": {
					get: {
						summary: "List Google Workspace groups (OUs)",
						description:
							"Returns the customer's Google Workspace groups so admins can pick one for bulk assignment. Returns an empty list when Google Directory is not configured.",
						tags: ["Loops"],
						responses: {
							"200": {
								description: "List of groups",
								content: {
									"application/json": {
										example: [
											{ email: "techops@enterprise.io", name: "TechOps" },
											{ email: "revops@enterprise.io", name: "RevOps" },
										],
									},
								},
							},
							"502": {
								description: "Google Directory API error",
							},
						},
					},
				},
			},
			components: {
				schemas: Object.fromEntries(
					Object.entries(loopsModels).map(([_, v]) => [v.name, v.schema]),
				),
			},
		};
	}

	private grantTableAccess(
		lambdas: lambda.NodejsFunction[],
		tables: dynamodb.ITable[],
		readWrite = false,
	) {
		lambdas.forEach((fn) => {
			tables.forEach((table) => {
				if (readWrite) {
					table.grantReadWriteData(fn);
				} else {
					table.grantReadData(fn);
				}
			});
		});
	}
}
