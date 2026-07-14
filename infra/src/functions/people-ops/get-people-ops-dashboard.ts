// import { APIGatewayProxyHandlerV2 } from "aws-lambda";
// import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
// import { ddbClient } from "src/shared/dynamodb-client";

// const ddb = ddbClient;

// const PEOPLE_TABLE = process.env.DEEL_PEOPLE_TABLE_NAME;
// // const REVIEWS_TABLE = process.env.REVIEWS_TABLE!;
// // const GOALS_TABLE = process.env.GOALS_TABLE!;

// if (!PEOPLE_TABLE) {
//   throw new Error("DEEL_PEOPLE_TABLE_NAME environment variable is missing");
// }

// /* ----------------- Helpers ----------------- */

// const getValueByPath = (obj: any, path: string) =>
//   path.split(".").reduce((o, k) => o?.[k], obj);

// const aggregateByField = <T extends Record<string, any>>(
//   items: T[],
//   fieldPath: string,
// ) => {
//   return items.reduce((acc: Record<string, number>, item) => {
//     const value = getValueByPath(item, fieldPath);
//     if (value === undefined || value === null || value === "") return acc; // skip
//     const key = String(value);
//     acc[key] = (acc[key] || 0) + 1;
//     return acc;
//   }, {});
// };

// const scanAll = async (tableName: string) => {
//   let items: any[] = [];
//   let lastKey: any;

//   do {
//     const res = await ddb.send(
//       new ScanCommand({
//         TableName: tableName,
//         ExclusiveStartKey: lastKey,
//       }),
//     );

//     if (res.Items) items.push(...res.Items);
//     lastKey = res.LastEvaluatedKey;
//   } while (lastKey);

//   return items;
// };
// const getCountryFromAddresses = (p: any): string | null => {
//   if (!Array.isArray(p.addresses) || p.addresses.length === 0) return null;
//   return p.addresses[0]?.country ?? null;
// };

// /* ----------------- Lambda ----------------- */

// export const handler: APIGatewayProxyHandlerV2 = async () => {
//   try {
//     /* -------- Fetch data -------- */
//     const [people] = await Promise.all([
//       scanAll(PEOPLE_TABLE),
//       //   scanAll(REVIEWS_TABLE),
//       //   scanAll(GOALS_TABLE),
//     ]);

//     /* -------- Aggregations -------- */
//     const byStatus = aggregateByField(people, "hiring_status");
//     const byDepartment = aggregateByField(people, "department.name");
//     const byType = aggregateByField(people, "user_type");
//     const byLocation = aggregateByField(
//       people
//         .map((p) => ({
//           country: getCountryFromAddresses(p),
//         }))
//         .filter((p) => p.country != null && p.country !== ""),
//       "country",
//     );

//     /* -------- Recent hires (last 30 days) -------- */
//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     const recentHires = people
//       .filter((p) => p.start_date && new Date(p.start_date) >= thirtyDaysAgo)
//       .sort(
//         (a, b) =>
//           new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
//       )
//       .slice(0, 10);

//     /* -------- Upcoming performance reviews -------- */
//     // const upcomingReviews = reviews
//     //   .filter((r) => r.status !== "COMPLETED")
//     //   .sort(
//     //     (a, b) =>
//     //       new Date(a.review_date).getTime() - new Date(b.review_date).getTime(),
//     //   )
//     //   .slice(0, 10);

//     // /* -------- Pending goals -------- */
//     // const pendingGoals = goals
//     //   .filter((g) => g.status === "IN_PROGRESS")
//     //   .sort(
//     //     (a, b) =>
//     //       new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
//     //   )
//     //   .slice(0, 10);

//     /* -------- Org chart (stub / future) -------- */
//     const orgChart: any[] = [];

//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         total_employees: people.length,
//         by_status: byStatus,
//         by_department: byDepartment,
//         by_type: byType,
//         by_location: byLocation,
//         recent_hires: recentHires,
//         // upcoming_reviews: upcomingReviews,
//         // pending_goals: pendingGoals,
//         org_chart: orgChart,
//       }),
//     };
//   } catch (error: any) {
//     console.error("Error getting people ops dashboard:", error);

//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         error: {
//           code: "GET_DASHBOARD_FAILED",
//           message: "Failed to get people ops dashboard",
//           details: error?.message ?? error,
//         },
//       }),
//     };
//   }
// };

import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";

import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";

const ddb = ddbClient;
const PEOPLE_TABLE = process.env.DEEL_PEOPLE_TABLE_NAME;

if (!PEOPLE_TABLE) {
  throw new Error("DEEL_PEOPLE_TABLE_NAME environment variable is missing");
}

/* ----------------- Helpers ----------------- */

const getValueByPath = (obj: any, path: string) =>
  path.split(".").reduce((o, k) => o?.[k], obj);

const aggregateByField = <T extends Record<string, any>>(
  items: T[],
  fieldPath: string,
) => {
  return items.reduce((acc: Record<string, number>, item) => {
    const value = getValueByPath(item, fieldPath);
    if (value === undefined || value === null || value === "") return acc; // skip
    const key = String(value);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
};

const scanAll = async (tableName: string) => {
  let items: any[] = [];
  let lastKey: any;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) items.push(...res.Items);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return items;
};

const getCountryFromAddresses = (p: any): string | null => {
  if (!Array.isArray(p.addresses) || p.addresses.length === 0) return null;
  return p.addresses[0]?.country ?? null;
};

/* -------- Org Chart Helpers -------- */

interface OrgChartNode {
  person_id: string;
  name: string;
  email?: string;
  title: string;
  department: string;
  manager_id?: string;
  direct_reports: string[];
  level: number;
  employment_status: string;
}

// Simple level calculation: top-level = 0, increment for each manager layer
const calculateLevel = (
  person: any,
  people: any[],
  cache = new Map<string, number>(),
): number => {
  if (!person.manager_id) return 0;
  if (cache.has(person.person_id)) return cache.get(person.person_id)!;
  const manager = people.find((p) => p.person_id === person.manager_id);
  const level = manager ? calculateLevel(manager, people, cache) + 1 : 0;
  cache.set(person.person_id, level);
  return level;
};

// Get subtree for a specific root person
const getSubtree = (
  rootId: string,
  orgChart: OrgChartNode[],
  maxDepth: number,
  currentLevel = 0,
): OrgChartNode[] => {
  if (currentLevel >= maxDepth) return [];
  const rootNode = orgChart.find((n) => n.person_id === rootId);
  if (!rootNode) return [];

  const children = rootNode.direct_reports.flatMap((drId) =>
    getSubtree(drId, orgChart, maxDepth, currentLevel + 1),
  );

  return [rootNode, ...children];
};

/* ----------------- Lambda ----------------- */

const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const request = event?.queryStringParameters || {};
    const rootPersonId = request.root_person_id;
    const departmentFilter = request.department_filter;
    const maxDepth = request.max_depth ? Number(request.max_depth) : 999;

    // People directory filters (case-insensitive partial match for name/email,
    // case-insensitive exact match for department/status)
    const nameFilter = request.name?.trim().toLowerCase() ?? "";
    const emailFilter = request.email?.trim().toLowerCase() ?? "";
    const departmentSearchFilter = request.department?.trim().toLowerCase() ?? "";
    const statusFilter = request.status?.trim().toLowerCase() ?? "";

    /* -------- Fetch data -------- */
    const people = await scanAll(PEOPLE_TABLE);

    /* -------- Aggregations -------- */
    const byStatus = aggregateByField(people, "hiring_status");
    const byDepartment = aggregateByField(people, "department.name");
    const byType = aggregateByField(people, "user_type");
    const byLocation = aggregateByField(
      people
        .map((p) => ({ country: getCountryFromAddresses(p) }))
        .filter((p) => p.country != null && p.country !== ""),
      "country",
    );

    /* -------- Recent hires (last 30 days) -------- */
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentHires = people
      .filter((p) => p.start_date && new Date(p.start_date) >= thirtyDaysAgo)
      .sort(
        (a, b) =>
          new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
      )
      .slice(0, 10);

    /* -------- Org chart -------- */
    let filteredPeople = people;
    if (departmentFilter) {
      filteredPeople = people.filter((p) => p.department === departmentFilter);
    }

    const orgChart: OrgChartNode[] = filteredPeople.map((person) => {
      const directReports =
        person.direct_reports && Array.isArray(person.direct_reports)
          ? person.direct_reports
          : filteredPeople
            .filter((p) => p.direct_manager === person.id)
            .map((p) => p.id);

      const level = calculateLevel(
        { person_id: person.id, manager_id: person.direct_manager },
        filteredPeople.map((p) => ({
          person_id: p.id,
          manager_id: p.direct_manager,
        })),
      );
      return {
        person_id: person.id,
        name: `${person.given_name ?? ""} ${person.family_name ?? ""}`.trim(),
        given_name: person.given_name,
        family_name: person.family_name,
        email: person.email ?? person.alternate_email ?? undefined,
        job_title: person.title ?? person.job_title,
        department: person.department, // pass the object
        title: person.title ?? person.job_title ?? "Unknown",
        manager_id: person.direct_manager ?? undefined,
        direct_reports: directReports,
        level,
        employment_status:
          person.hiring_status ?? person.new_hiring_status ?? "ACTIVE",
        addresses: person.addresses ?? [],
        start_date: person.start_date ?? null,
      };
    });

    let finalOrgChart = rootPersonId
      ? getSubtree(rootPersonId, orgChart, maxDepth)
      : orgChart.sort((a, b) => a.level - b.level);

    // Apply people-directory filters
    if (nameFilter) {
      finalOrgChart = finalOrgChart.filter((p) =>
        p.name.toLowerCase().includes(nameFilter),
      );
    }
    if (emailFilter) {
      finalOrgChart = finalOrgChart.filter((p) =>
        (p.email ?? "").toLowerCase().includes(emailFilter),
      );
    }
    if (departmentSearchFilter) {
      finalOrgChart = finalOrgChart.filter((p) => {
        const deptName =
          typeof p.department === "object" && p.department !== null
            ? ((p.department as { name?: string }).name ?? "")
            : String(p.department ?? "");
        return deptName.toLowerCase().includes(departmentSearchFilter);
      });
    }
    if (statusFilter) {
      finalOrgChart = finalOrgChart.filter(
        (p) => p.employment_status.toLowerCase() === statusFilter.toLowerCase(),
      );
    }

    // Distinct sorted lists for dropdown population
    const distinctDepartments = Object.keys(byDepartment).sort();
    const distinctStatuses = Object.keys(byStatus).sort();

    return ok({
      total_employees: people.length,
      by_status: byStatus,
      by_department: byDepartment,
      by_type: byType,
      by_location: byLocation,
      recent_hires: recentHires,
      org_chart: finalOrgChart,
      distinct_departments: distinctDepartments,
      distinct_statuses: distinctStatuses,
    });
  } catch (error: any) {
    console.error("Error getting people ops dashboard:", error);

    return err(
      error.message || "Failed to get people ops dashboard",
      500
    );
  }
};

export const handler = withPermissions(_handler);
