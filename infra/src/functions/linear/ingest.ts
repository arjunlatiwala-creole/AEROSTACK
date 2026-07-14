import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { EventBridgeEvent } from "aws-lambda";

const secretsClient = new SecretsManagerClient({});
const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

const LINEAR_API_URL = "https://api.linear.app/graphql";
const LINEAR_SECRET_NAME = process.env.LINEAR_SECRET_NAME!;
const LINEAR_BUCKET_NAME = process.env.LINEAR_DATA_BUCKET!;

/**
 * GraphQL query to fetch projects with pagination.
 * Based on the Linear GraphQL API spec from the PDF reference.
 */
const GET_PROJECTS_QUERY = `
query GetProjects($after: String) {
  projects(first: 25, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      name
      description
      content
      state
      priority
      progress
      scope
      url
      startDate
      targetDate
      status {
        name
        type
      }
      lead {
        id
        name
        email
      }
      creator {
        id
        name
        email
      }
      members {
        nodes {
          id
          name
          email
          displayName
        }
      }
      labels {
        nodes {
          id
          name
        }
      }
      teams {
        nodes {
          id
          name
          key
          description
        }
      }
    }
  }
}
`;

const GET_PROJECT_UPDATES_QUERY = `
query GetProjectUpdates($projectId: String!, $after: String) {
  project(id: $projectId) {
    projectUpdates(first: 25, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        health
        body
        createdAt
        user {
          id
          name
          email
        }
        comments {
          nodes {
            id
            body
            createdAt
            user {
              id
              name
              email
            }
          }
        }
      }
    }
  }
}
`;

/**
 * GraphQL query to fetch issues for a specific project with pagination.
 */
const GET_PROJECT_ISSUES_QUERY = `
query GetProjectIssues($projectId: String!, $after: String) {
  project(id: $projectId) {
    issues(first: 50, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        description
        priority
        estimate
        dueDate
        createdAt
        updatedAt
        completedAt
        canceledAt
        state {
          id
          name
          type
          color
        }
        assignee {
          id
          name
          email
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
      }
    }
  }
}
`;

interface LinearProject {
  id: string;
  name: string;
  description: string;
  content: string;
  state: string;
  priority: number;
  progress: number;
  scope: number;
  url: string;
  startDate: string | null;
  targetDate: string | null;
  status: {
    name: string;
    type: string;
  };
  lead: { id: string; name: string; email: string } | null;
  creator: { id: string; name: string; email: string } | null;
  members: {
    nodes: Array<{
      id: string;
      name: string;
      email: string;
      displayName: string;
    }>;
  };
  labels: { nodes: Array<{ id: string; name: string }> };
  teams: {
    nodes: Array<{
      id: string;
      name: string;
      key: string;
      description: string | null;
    }>;
  };
  projectUpdates?: LinearProjectUpdate[];
  issues?: LinearIssue[];
}

interface LinearIssue {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  state: {
    id: string;
    name: string;
    type: string;
    color: string;
  };
  assignee: { id: string; name: string; email: string } | null;
  labels: { nodes: Array<{ id: string; name: string; color: string }> };
}

interface LinearProjectUpdate {
  id: string;
  health: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user: { id: string; name: string; email: string };
    }>;
  };
}

// Get Linear API token from Secrets Manager
async function getLinearToken(): Promise<string> {
  const response = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: LINEAR_SECRET_NAME,
    }),
  );

  if (!response.SecretString) {
    throw new Error("Linear secret not found");
  }

  const secret = JSON.parse(response.SecretString);
  return secret.LINEAR_API_TOKEN || secret.token || secret.devToken;
}

// Execute a GraphQL query against the Linear API
async function linearGraphQL(
  token: string,
  query: string,
  variables: Record<string, any> = {},
): Promise<any> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Linear API error (${response.status}): ${errorText}`);
  }

  const json = (await response.json()) as { errors?: any[]; data: any };

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

// Fetch all projects with pagination
async function fetchAllProjects(token: string): Promise<LinearProject[]> {
  const allProjects: LinearProject[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;

  while (hasNextPage) {
    console.log(
      `Fetching projects page${afterCursor ? ` (after: ${afterCursor})` : ""}...`,
    );

    const data = await linearGraphQL(token, GET_PROJECTS_QUERY, {
      after: afterCursor,
    });

    const projects = data.projects;
    if (!projects?.nodes)
      throw new Error("Invalid Linear projects response format");

    allProjects.push(...projects.nodes);
    hasNextPage = projects.pageInfo.hasNextPage;
    afterCursor = projects.pageInfo.endCursor;

    console.log(
      `Fetched ${projects.nodes.length} projects (total: ${allProjects.length})`,
    );
  }

  return allProjects;
}

/**
 * Fetches all paginated project updates for a given project.
 */
async function fetchProjectUpdates(
  token: string,
  projectId: string,
): Promise<LinearProjectUpdate[]> {
  const allUpdates: LinearProjectUpdate[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;

  while (hasNextPage) {
    console.log(
      `Fetching updates for project ${projectId}${afterCursor ? ` (after: ${afterCursor})` : ""}...`,
    );

    const data = await linearGraphQL(token, GET_PROJECT_UPDATES_QUERY, {
      projectId,
      after: afterCursor,
    });

    // FIX: Response path is data.project.projectUpdates (matches the query field name)
    const project = data.project;
    if (!project?.projectUpdates) {
      console.warn(`No projectUpdates found for project ${projectId}`);
      break;
    }

    allUpdates.push(...project.projectUpdates.nodes);
    hasNextPage = project.projectUpdates.pageInfo.hasNextPage;
    afterCursor = project.projectUpdates.pageInfo.endCursor;

    console.log(
      `Fetched ${project.projectUpdates.nodes.length} updates (total: ${allUpdates.length})`,
    );
  }

  return allUpdates;
}

async function fetchProjectIssues(
  token: string,
  projectId: string,
): Promise<LinearIssue[]> {
  const allIssues: LinearIssue[] = [];
  let hasNextPage = true;
  let afterCursor: string | null = null;

  while (hasNextPage) {
    console.log(
      `Fetching issues for project ${projectId}${afterCursor ? ` (after: ${afterCursor})` : ""}...`,
    );

    const data = await linearGraphQL(token, GET_PROJECT_ISSUES_QUERY, {
      projectId,
      after: afterCursor,
    });

    const project = data.project;
    if (!project?.issues) {
      console.warn(`No issues found for project ${projectId}`);
      break;
    }

    allIssues.push(...project.issues.nodes);
    hasNextPage = project.issues.pageInfo.hasNextPage;
    afterCursor = project.issues.pageInfo.endCursor;

    console.log(
      `Fetched ${project.issues.nodes.length} issues (total: ${allIssues.length})`,
    );
  }

  return allIssues;
}

// Main handler
export async function handler(
  event: EventBridgeEvent<"Ingest Requested", any>,
) {
  const { integration_id, integration_type } = event.detail;

  if (integration_type !== "linear") {
    throw new Error(`Invalid integration_type: ${integration_type}`);
  }

  try {
    console.log("Starting Linear data sync...");

    // Get Linear API token
    const token = await getLinearToken();

    // Step 1: Fetch all projects with pagination
    const allProjects = await fetchAllProjects(token);
    console.log(`Total projects fetched: ${allProjects.length}`);

    // Step 2: For each project, fetch all issues with pagination
    for (const project of allProjects) {
      console.log(`Processing project: ${project.name} (${project.id})`);

      const [updates, issues] = await Promise.allSettled([
        fetchProjectUpdates(token, project.id),
        fetchProjectIssues(token, project.id),
      ]);

      if (updates.status === "fulfilled") {
        project.projectUpdates = updates.value;
        console.log(
          `  └─ ${updates.value.length} updates for "${project.name}"`,
        );
      } else {
        console.error(
          `  └─ Error fetching updates for ${project.id}:`,
          updates.reason,
        );
        project.projectUpdates = [];
      }

      if (issues.status === "fulfilled") {
        project.issues = issues.value;
        console.log(`  └─ ${issues.value.length} issues for "${project.name}"`);
      } else {
        console.error(
          `  └─ Error fetching issues for ${project.id}:`,
          issues.reason,
        );
        project.issues = [];
      }
    }

    // Step 3: Store in S3
    const timestamp = new Date().toISOString();
    const s3Key = `linear-projects/${timestamp}/projects.json`;

    const totalIssues = allProjects.reduce(
      (sum, p) => sum + (p.issues?.length ?? 0),
      0,
    );
    const totalUpdates = allProjects.reduce(
      (sum, p) => sum + (p.projectUpdates?.length ?? 0),
      0,
    );

    console.log(
      `Storing to S3: ${totalUpdates} updates, ${totalIssues} issues across ${allProjects.length} projects`,
    );

    await s3Client.send(
      new PutObjectCommand({
        Bucket: LINEAR_BUCKET_NAME,
        Key: s3Key,
        Body: JSON.stringify(
          {
            syncedAt: timestamp,
            totalProjects: allProjects.length,
            totalIssues,
            totalUpdates,
            projects: allProjects,
          },
          null,
          2,
        ),
        ContentType: "application/json",
      }),
    );

    console.log(`Data stored in S3: ${s3Key}`);

    // Step 4: Emit EventBridge event
    try {
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "integration.ingest",
              DetailType: "Ingestion Complete",
              Detail: JSON.stringify({
                integration_id,
                integration_type,
                projectsProcessed: allProjects.length,
                issuesProcessed: totalIssues,
                updatesProcessed: totalUpdates,
                s3Key,
                bucket: LINEAR_BUCKET_NAME,
                completed_at: timestamp,
              }),
            },
          ],
        }),
      );
      console.log("EventBridge event emitted successfully");
    } catch (eventError) {
      console.error("Failed to emit EventBridge event:", eventError);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        message: "Linear data sync completed successfully",
        projectsProcessed: allProjects.length,
        issuesProcessed: totalIssues,
        updatesProcessed: totalUpdates,
        s3Key,
        bucket: LINEAR_BUCKET_NAME,
      }),
    };
  } catch (error: any) {
    console.error("Error syncing Linear data:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to sync Linear data",
        message: error.message,
      }),
    };
  }
}
