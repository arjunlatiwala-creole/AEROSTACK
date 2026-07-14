import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import type { CognitoAuth } from "../../constructs/auth/cognito-auth";

export interface DeliveryDashboardApiProps {
  api: apigw.RestApi;
  auth: CognitoAuth;
  loopsTable: dynamodb.ITable;
  linearDeliveryTable: dynamodb.ITable;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
  linearSecret: secretsmanager.ISecret;
  linearAdminSecret: secretsmanager.ISecret;
}

export class DeliveryDashboardApi extends Construct {
  public readonly openApiSpec: any;

  constructor(scope: Construct, id: string, props: DeliveryDashboardApiProps) {
    super(scope, id);

    // ── Factory helpers ───────────────────────────────────────────────────

    const createReadFn = (
      id: string,
      entry: string,
      handler: string,
      tables: dynamodb.ITable[] = [props.loopsTable, props.linearDeliveryTable],
    ): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, id, {
        ...props.lambdaDefaults,
        entry,
        handler,
        environment: {
          LOOPS_TABLE_NAME: props.loopsTable.tableName,
          LINEAR_DELIVERY_TABLE_NAME: props.linearDeliveryTable.tableName,
        },
      });
      tables.forEach((t) => t.grantReadData(fn));
      return fn;
    };

    const createWriteFn = (
      id: string,
      entry: string,
      handler: string,
    ): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, id, {
        ...props.lambdaDefaults,
        entry,
        handler,
        environment: {
          LOOPS_TABLE_NAME: props.loopsTable.tableName,
          LINEAR_DELIVERY_TABLE_NAME: props.linearDeliveryTable.tableName,
          LINEAR_SECRET_NAME: props.linearSecret.secretName,
          LINEAR_ADMIN_SECRET_NAME: props.linearAdminSecret.secretName,
        },
      });
      props.loopsTable.grantReadData(fn);
      props.linearDeliveryTable.grantReadWriteData(fn);
      props.linearSecret.grantRead(fn);
      props.linearAdminSecret.grantRead(fn);
      return fn;
    };

    // ── Lambda functions ──────────────────────────────────────────────────

    const listDelivery = createReadFn(
      "ListDelivery",
      "src/functions/delivery/list-delivery.ts",
      "listDelivery",
    );

    const getProjectById = createReadFn(
      "GetProjectById",
      "src/functions/delivery/list-delivery.ts",
      "getProjectById",
      [props.linearDeliveryTable],
    );

    const updateProject = createWriteFn(
      "UpdateProject",
      "src/functions/delivery/update-project.ts",
      "updateProject",
    );

    const setVirtualStatus = createWriteFn(
      "SetVirtualStatus",
      "src/functions/delivery/update-project.ts",
      "setVirtualStatus",
    );

    const addProjectUpdate = createWriteFn(
      "AddProjectUpdate",
      "src/functions/delivery/update-project.ts",
      "addProjectUpdate",
    );

    const getProjectStatuses = createWriteFn(
      "GetProjectStatuses",
      "src/functions/delivery/update-project.ts",
      "getProjectStatuses",
    );

    const addUpdateComment = createWriteFn(
      "AddUpdateComment",
      "src/functions/delivery/update-project.ts",
      "addUpdateComment",
    );

    const deleteProjectUpdate = createWriteFn(
      "DeleteProjectUpdate",
      "src/functions/delivery/update-project.ts",
      "deleteProjectUpdate",
    );

    const deleteUpdateComment = createWriteFn(
      "DeleteUpdateComment",
      "src/functions/delivery/update-project.ts",
      "deleteUpdateComment",
    );

    // ── API resource tree ─────────────────────────────────────────────────
    //
    //  GET    /delivery
    //  GET    /delivery/projects/statuses
    //  GET    /delivery/projects/{id}
    //  PUT    /delivery/projects/{id}
    //  POST   /delivery/projects/{id}/updates
    //  DELETE /delivery/projects/{id}/updates/{updateId}
    //  POST   /delivery/projects/{id}/updates/{updateId}/comments
    //  DELETE /delivery/projects/{id}/updates/{updateId}/comments/{commentId}

    const delivery =
      props.api.root.getResource("delivery") ??
      props.api.root.addResource("delivery");

    delivery.addMethod(
      "GET",
      new apigw.LambdaIntegration(listDelivery),
      props.auth.getMethodOptions(),
    );

    const projects =
      delivery.getResource("projects") ?? delivery.addResource("projects");

    // GET /delivery/projects/statuses
    // Must be registered BEFORE {id} so API GW doesn't swallow "statuses" as a path param
    const statusesResource =
      projects.getResource("statuses") ?? projects.addResource("statuses");

    statusesResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getProjectStatuses),
      props.auth.getMethodOptions(),
    );

    // /delivery/projects/{id}
    const projectById =
      projects.getResource("{id}") ?? projects.addResource("{id}");

    projectById.addMethod(
      "GET",
      new apigw.LambdaIntegration(getProjectById),
      props.auth.getMethodOptions(),
    );

    projectById.addMethod(
      "PUT",
      new apigw.LambdaIntegration(updateProject),
      props.auth.getMethodOptions(),
    );

    const statesResource =
      projectById.getResource("virtual-status") ?? projectById.addResource("virtual-status");

    statesResource.addMethod(
      "PATCH",
      new apigw.LambdaIntegration(setVirtualStatus),
      props.auth.getMethodOptions(),
    );

    // /delivery/projects/{id}/updates
    const updatesResource =
      projectById.getResource("updates") ?? projectById.addResource("updates");

    updatesResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(addProjectUpdate),
      props.auth.getMethodOptions(),
    );

    // /delivery/projects/{id}/updates/{updateId}
    const singleUpdateResource =
      updatesResource.getResource("{updateId}") ??
      updatesResource.addResource("{updateId}");

    // DELETE /delivery/projects/{id}/updates/{updateId}
    singleUpdateResource.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(deleteProjectUpdate),
      props.auth.getMethodOptions(),
    );

    // /delivery/projects/{id}/updates/{updateId}/comments
    const commentsResource =
      singleUpdateResource.getResource("comments") ??
      singleUpdateResource.addResource("comments");

    // POST /delivery/projects/{id}/updates/{updateId}/comments
    commentsResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(addUpdateComment),
      props.auth.getMethodOptions(),
    );

    // /delivery/projects/{id}/updates/{updateId}/comments/{commentId}
    const singleCommentResource =
      commentsResource.getResource("{commentId}") ??
      commentsResource.addResource("{commentId}");

    // DELETE /delivery/projects/{id}/updates/{updateId}/comments/{commentId}
    singleCommentResource.addMethod(
      "DELETE",
      new apigw.LambdaIntegration(deleteUpdateComment),
      props.auth.getMethodOptions(),
    );

    // ── OpenAPI spec ──────────────────────────────────────────────────────

    this.openApiSpec = {
      tags: [
        {
          name: "Delivery Dashboard",
          description:
            "Unified delivery dashboard — loops from the loop table and projects from the linear-delivery table",
        },
      ],
      paths: {
        "/delivery": {
          get: {
            summary: "List unified delivery items (projects + loops)",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "tab",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["my", "all"], default: "my" },
              },
              {
                name: "type",
                in: "query",
                required: false,
                schema: {
                  type: "string",
                  enum: ["loops", "projects", "all"],
                  default: "all",
                },
              },
              {
                name: "limit",
                in: "query",
                required: false,
                schema: { type: "integer", default: 20 },
              },
              {
                name: "cursor",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "callerEmail",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "status",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "priority",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "owner",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "progress",
                in: "query",
                required: false,
                schema: {
                  type: "string",
                  enum: ["0%", "1-50%", "51-99%", "100%"],
                },
              },
              {
                name: "targetDate",
                in: "query",
                required: false,
                schema: { type: "string", format: "date" },
              },
              {
                name: "projectTeam",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "issueCompletion",
                in: "query",
                required: false,
                schema: {
                  type: "string",
                  enum: ["0%", "1-50%", "51-99%", "100%"],
                },
              },
              {
                name: "loopPhase",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "loopCategory",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
              {
                name: "loopTag",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description:
                  "Unified list of projects and loops with pagination and summary",
              },
              "400": { description: "Invalid query parameters" },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },

        "/delivery/projects/statuses": {
          get: {
            summary: "List all Linear workspace project statuses",
            tags: ["Delivery Dashboard"],
            responses: {
              "200": {
                description: "Array of Linear project statuses",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        statuses: {
                          type: "array",
                          items: { $ref: "#/components/schemas/ProjectStatus" },
                        },
                      },
                    },
                  },
                },
              },
              "401": { description: "Unauthorized" },
              "500": { description: "Internal server error" },
            },
          },
        },

        "/delivery/projects/{id}": {
          get: {
            summary: "Get a single project by ID (full detail)",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": { description: "Full project detail" },
              "401": { description: "Unauthorized" },
              "404": { description: "Project not found" },
              "500": { description: "Internal server error" },
            },
          },
          put: {
            summary: "Update a project in Linear and DynamoDB",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/UpdateProjectInput" },
                },
              },
            },
            responses: {
              "200": { description: "Update successful" },
              "400": { description: "Validation error" },
              "401": { description: "Unauthorized" },
              "404": { description: "Project not found" },
              "502": { description: "Linear API error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/delivery/projects/{id}/virtual-status": {
          patch: {
            summary: "Set a virtual status for a project",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SetVirtualStatusInput",
                  },
                },
              },
            },
            responses: {
              "200": { description: "Virtual status set successfully" },
              "400": { description: "Validation error" },
              "401": { description: "Unauthorized" },
              "404": { description: "Project not found" },
              "502": { description: "Linear API error" },
              "500": { description: "Internal server error" },
            },
          },
        },
        "/delivery/projects/{id}/updates": {
          post: {
            summary: "Post a project status update",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AddProjectUpdateInput",
                  },
                },
              },
            },
            responses: {
              "200": { description: "Project update created" },
              "400": { description: "Validation error" },
              "401": { description: "Unauthorized" },
              "404": { description: "Project not found" },
              "502": { description: "Linear API error" },
              "500": { description: "Internal server error" },
            },
          },
        },

        "/delivery/projects/{id}/updates/{updateId}": {
          delete: {
            summary: "Delete a project status update",
            description:
              "Removes the update entry from the project_updates array in DynamoDB.",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "updateId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Update deleted successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean", example: true },
                      },
                    },
                  },
                },
              },
              "401": { description: "Unauthorized" },
              "404": { description: "Project or update not found" },
              "500": { description: "Internal server error" },
            },
          },
        },

        "/delivery/projects/{id}/updates/{updateId}/comments": {
          post: {
            summary: "Add a comment to a project status update",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "updateId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AddUpdateCommentInput",
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Comment created",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean" },
                        comment: { $ref: "#/components/schemas/UpdateComment" },
                      },
                    },
                  },
                },
              },
              "400": { description: "Validation error" },
              "401": { description: "Unauthorized" },
              "404": { description: "Project or update not found" },
              "500": { description: "Internal server error" },
            },
          },
        },

        "/delivery/projects/{id}/updates/{updateId}/comments/{commentId}": {
          delete: {
            summary: "Delete a comment from a project status update",
            description:
              "Removes the comment from the comments array of the specified project update in DynamoDB.",
            tags: ["Delivery Dashboard"],
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "updateId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "commentId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Comment deleted successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean", example: true },
                      },
                    },
                  },
                },
              },
              "401": { description: "Unauthorized" },
              "404": { description: "Project, update, or comment not found" },
              "500": { description: "Internal server error" },
            },
          },
        },
      },

      components: {
        schemas: {
          ProjectStatus: {
            type: "object",
            properties: {
              id: {
                type: "string",
                example: "3b5e0e9f-0a1f-4c3d-9b2a-1a2b3c4d5e6f",
              },
              name: { type: "string", example: "In Progress" },
              type: { type: "string", example: "started" },
              color: { type: "string", nullable: true, example: "#4ea7fc" },
            },
          },

          UpdateProjectInput: {
            type: "object",
            description:
              "Partial update — supply only the fields to change. At least one required.",
            properties: {
              name: { type: "string" },
              description: {
                type: "string",
                description:
                  "Short summary shown under the project title in Linear",
              },
              content: {
                type: "string",
                description:
                  "Markdown body shown in the Description section in Linear",
              },
              statusId: {
                type: "string",
                description:
                  "Linear status UUID from GET /delivery/projects/statuses",
              },
              status_name: {
                type: "string",
                description: "Human-readable label stored in DDB",
              },
              priority: {
                type: "string",
                enum: ["Urgent", "High", "Medium", "Low", "No Priority"],
              },
              targetDate: {
                type: "string",
                format: "date",
                example: "2025-12-31",
              },
            },
          },

          UpdatedProjectResponse: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string", nullable: true },
              content: { type: "string", nullable: true },
              status_name: { type: "string" },
              priority: { type: "string", nullable: true },
              targetDate: { type: "string", nullable: true },
              updatedAt: { type: "string" },
            },
          },

          AddProjectUpdateInput: {
            type: "object",
            required: ["body", "health"],
            properties: {
              body: { type: "string" },
              health: {
                type: "string",
                enum: ["onTrack", "atRisk", "offTrack"],
              },
              user_email: { type: "string" },
            },
          },

          AddUpdateCommentInput: {
            type: "object",
            required: ["body"],
            properties: {
              body: { type: "string" },
              user_email: { type: "string" },
            },
          },

          UpdateComment: {
            type: "object",
            properties: {
              id: { type: "string" },
              body: { type: "string" },
              created_at: { type: "string", format: "date-time" },
              user_name: { type: "string", nullable: true },
              user_email: { type: "string", nullable: true },
            },
          },

          ProjectUpdateEntry: {
            type: "object",
            properties: {
              id: { type: "string" },
              health: {
                type: "string",
                enum: ["onTrack", "atRisk", "offTrack"],
              },
              body: { type: "string" },
              created_at: { type: "string" },
              user_name: { type: "string", nullable: true },
              user_email: { type: "string", nullable: true },
              comments: {
                type: "array",
                items: { $ref: "#/components/schemas/UpdateComment" },
              },
            },
          },

          ProjectDetail: {
            type: "object",
            properties: {
              id: { type: "string" },
              prefixedId: { type: "string" },
              name: { type: "string" },
              description: { type: "string", nullable: true },
              content: { type: "string", nullable: true },
              url: { type: "string", nullable: true },
              status_name: { type: "string" },
              priority: { type: "string", nullable: true },
              progress: { type: "integer" },
              scope: { type: "integer" },
              lead: {
                type: "object",
                properties: {
                  id: { type: "string", nullable: true },
                  name: { type: "string", nullable: true },
                  email: { type: "string", nullable: true },
                },
              },
              creator: {
                type: "object",
                properties: {
                  id: { type: "string", nullable: true },
                  name: { type: "string", nullable: true },
                  email: { type: "string", nullable: true },
                },
              },
              members: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string" },
                    displayName: { type: "string" },
                  },
                },
              },
              teams: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    key: { type: "string" },
                  },
                },
              },
              totalIssues: { type: "integer" },
              completedIssues: { type: "integer" },
              canceledIssues: { type: "integer" },
              issues: {
                type: "array",
                items: { $ref: "#/components/schemas/ProjectIssue" },
              },
              project_updates: {
                type: "array",
                items: { $ref: "#/components/schemas/ProjectUpdateEntry" },
              },
              startDate: { type: "string", nullable: true },
              targetDate: { type: "string", nullable: true },
              createdAt: { type: "string", nullable: true },
              updatedAt: { type: "string", nullable: true },
              syncedAt: { type: "string", nullable: true },
              labels: { type: "array", items: { type: "string" } },
            },
          },

          ProjectIssue: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              state_name: { type: "string" },
              state_type: { type: "string" },
              priority: { type: "string", nullable: true },
              assignee_name: { type: "string", nullable: true },
              assignee_email: { type: "string", nullable: true },
              labels: { type: "array", items: { type: "string" } },
              due_date: { type: "string", nullable: true },
              completed_at: { type: "string", nullable: true },
              canceled_at: { type: "string", nullable: true },
              created_at: { type: "string" },
              updated_at: { type: "string" },
              estimate: { type: "number", nullable: true },
            },
          },

          UnifiedDeliveryItem: {
            type: "object",
            properties: {
              id: { type: "string" },
              entity: { type: "string", enum: ["PROJECT", "LOOP"] },
              name: { type: "string" },
              status_name: { type: "string" },
              priority: { type: "string", nullable: true },
              progress: { type: "integer" },
              leadName: { type: "string", nullable: true },
              leadEmail: { type: "string", nullable: true },
              members: { type: "array", items: { type: "object" } },
              teams: { type: "array", items: { type: "object" } },
              totalIssues: { type: "integer" },
              completedIssues: { type: "integer" },
              startDate: { type: "string", nullable: true },
              targetDate: { type: "string", nullable: true },
              updatedAt: { type: "string", nullable: true },
              url: { type: "string", nullable: true },
            },
          },

          DeliverySummary: {
            type: "object",
            properties: {
              total: { type: "integer" },
              projectCount: { type: "integer" },
              loopCount: { type: "integer" },
              teamCount: { type: "integer" },
              totalIssues: { type: "integer" },
              totalCompleted: { type: "integer" },
              overallProgress: { type: "integer" },
            },
          },
        },
      },
    };
  }
}
