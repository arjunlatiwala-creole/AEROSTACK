import { SquidService, executable } from "@squidcloud/backend";
import { mongodb } from "../lib/mongodb";
import type {
  PersonEnhanced,
  DeelEmployee,
  DeelOrgChart,
  PeopleOpsDashboard,
  PersonDashboardEnhanced,
  PerformanceReview,
  PersonGoal,
  OrgChartNode,
  SyncDeelEmployeesRequest,
  SyncDeelEmployeesResponse,
  CreatePerformanceReviewRequest,
  CreatePersonGoalRequest,
  UpdatePersonGoalRequest,
  GetOrgChartRequest,
  GetPersonDashboardEnhancedRequest,
  Loop,
  EngineeringWorkItem,
  LoopOwnership,
  EmploymentStatus,
  DepartmentType,
  ApiError,
} from "@enterprise/common";

export class PeopleOpsService extends SquidService {
  private toData<T>(doc: any): T {
    return doc && typeof doc === "object" && "data" in doc
      ? (doc.data as T)
      : (doc as T);
  }

  private toArrayData<T>(docs: any[]): T[] {
    return docs.map((d) => this.toData<T>(d));
  }

  // =============================================
  // User Management
  // =============================================

  @executable()
  async createUserInPeople(userData: {
    cognitoUserId: string;
    email: string;
    name: string;
    isVerified?: boolean;
  }): Promise<{ success: boolean; person_id?: string; error?: string }> {
    try {
      const peopleCollection = await mongodb.getCollection("people");

      // Check if user already exists
      const existingUser = await peopleCollection.findOne({
        email: userData.email,
      });

      if (existingUser) {
        console.log(
          `[PeopleOps] User with email ${userData.email} already exists`
        );
        return {
          success: true,
          person_id: existingUser._id.toString(),
        };
      }

      // Create new person in MongoDB
      const now = new Date();

      const newPerson = {
        email: userData.email,
        name: userData.name,
        user_id: userData.cognitoUserId,
        is_verified: userData.isVerified ?? false,
        role: "User",
        velocityScore: {
          current: 0.0,
          trend: "stable",
          lastUpdated: now,
        },
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      const result = await peopleCollection.insertOne(newPerson);

      console.log(
        `[PeopleOps] Created new user in MongoDB people collection: ${result.insertedId}`
      );

      return {
        success: true,
        person_id: result.insertedId.toString(),
      };
    } catch (error: any) {
      console.error(
        "[PeopleOps] Error creating user in MongoDB people collection:",
        error
      );
      return {
        success: false,
        error: error.message || "Failed to create user",
      };
    }
  }

  @executable()
  async updateUserVerification(userData: {
    email: string;
    isVerified: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const peopleCollection = await mongodb.getCollection("people");

      // Update user verification status
      const result = await peopleCollection.updateOne(
        { email: userData.email },
        {
          $set: {
            is_verified: userData.isVerified,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        console.log(`[PeopleOps] User with email ${userData.email} not found`);
        return {
          success: false,
          error: "User not found",
        };
      }

      console.log(
        `[PeopleOps] Updated verification status for user: ${userData.email}`
      );

      return { success: true };
    } catch (error: any) {
      console.error("[PeopleOps] Error updating user verification:", error);
      return {
        success: false,
        error: error.message || "Failed to update user verification",
      };
    }
  }

  // =============================================
  // Deel Integration
  // =============================================

  @executable()
  async syncFromDeel(
    request: SyncDeelEmployeesRequest = {}
  ): Promise<SyncDeelEmployeesResponse> {
    try {
      const startTime = new Date().toISOString();
      let syncedCount = 0;
      let updatedCount = 0;
      let newCount = 0;
      const errors: Array<{ employee_id: string; error: string }> = [];

      // TODO: Replace with actual Deel API call
      // For now, this is a mock implementation showing the structure

      const deelApiKey = process.env.DEEL_API_KEY;
      if (!deelApiKey && !request.force_refresh) {
        console.log("[Deel] No API key configured, skipping sync");
        return {
          synced_count: 0,
          updated_count: 0,
          new_count: 0,
          errors: [
            { employee_id: "N/A", error: "Deel API key not configured" },
          ],
          last_sync_at: startTime,
        };
      }

      // Mock Deel employees (in production, this would call Deel API)
      const mockDeelEmployees: DeelEmployee[] = [
        {
          id: "deel_001",
          first_name: "John",
          last_name: "Doe",
          email: "john@company.com",
          job_title: "Senior Engineer",
          department: "ENGINEERING",
          employment_type: "FULL_TIME",
          status: "ACTIVE",
          start_date: "2023-01-15",
          location: {
            country: "US",
            city: "San Francisco",
            timezone: "America/Los_Angeles",
          },
          compensation: {
            amount: 150000,
            currency: "USD",
            frequency: "annually",
          },
        },
      ];

      // Sync each employee
      for (const deelEmp of mockDeelEmployees) {
        try {
          // Check if person exists in Aerostack
          const peopleQuery = this.squid
            .collection<PersonEnhanced>("people")
            .query();
          const existingPeople = await peopleQuery
            .eq("email", deelEmp.email)
            .snapshot();

          const personData: Partial<PersonEnhanced> = {
            name: `${deelEmp.first_name} ${deelEmp.last_name}`,
            email: deelEmp.email,
            role_title: deelEmp.job_title,
            deel_employee_id: deelEmp.id,
            employment_status: deelEmp.status as EmploymentStatus,
            employment_type: deelEmp.employment_type as any,
            department: deelEmp.department as DepartmentType,
            start_date: deelEmp.start_date,
            location: deelEmp.location.city,
            country: deelEmp.location.country,
            timezone: deelEmp.location.timezone,
            salary_currency: deelEmp.compensation?.currency,
            salary_amount: deelEmp.compensation?.amount,
            last_deel_sync: startTime,
            deel_sync_status: "synced",
            skills: [],
            updated_at: startTime,
          } as any;

          if (existingPeople.length > 0) {
            // Update existing person
            const person = this.toData<PersonEnhanced>(existingPeople[0]);
            await this.squid
              .collection<PersonEnhanced>("people")
              .doc(person.person_id)
              .update(personData as any);
            updatedCount++;
          } else {
            // Create new person
            const personId = this.generateId();
            const newPerson = {
              person_id: personId,
              ...personData,
              created_at: startTime,
            };
            await this.squid
              .collection<PersonEnhanced>("people")
              .doc(personId)
              .insert(newPerson as any);
            newCount++;
          }

          syncedCount++;
        } catch (error: any) {
          console.error(`Error syncing employee ${deelEmp.id}:`, error);
          errors.push({ employee_id: deelEmp.id, error: error.message });
        }
      }

      console.log(
        `[Deel] Synced ${syncedCount} employees (${newCount} new, ${updatedCount} updated)`
      );

      return {
        synced_count: syncedCount,
        updated_count: updatedCount,
        new_count: newCount,
        errors,
        last_sync_at: startTime,
      };
    } catch (error: any) {
      console.error("Error syncing from Deel:", error);
      throw {
        error: {
          code: "DEEL_SYNC_FAILED",
          message: "Failed to sync from Deel",
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getDeelOrgChart(): Promise<DeelOrgChart> {
    try {
      // In production, this would call Deel's org chart API
      // For now, we'll build it from our synced data

      const peopleQuery = this.squid
        .collection<PersonEnhanced>("people")
        .query();
      const peopleSnapshot = await peopleQuery.snapshot();
      const people = this.toArrayData<PersonEnhanced>(peopleSnapshot);

      const employees: DeelEmployee[] = people.map((p) => ({
        id: p.deel_employee_id || p.person_id,
        first_name: p.name.split(" ")[0],
        last_name: p.name.split(" ").slice(1).join(" "),
        email: p.email,
        job_title: p.role_title || "Unknown",
        department: p.department || "OPERATIONS",
        employment_type: p.employment_type || "FULL_TIME",
        status: p.employment_status || "ACTIVE",
        start_date: p.start_date || "",
        manager_id: p.manager_id,
        location: {
          country: p.country || "Unknown",
          city: p.location,
          timezone: p.timezone,
        },
      }));

      // Build hierarchy
      const hierarchy = this.buildHierarchy(people);

      // Group by department
      const departments = this.groupByDepartment(people);

      return {
        employees,
        hierarchy,
        departments,
      };
    } catch (error: any) {
      console.error("Error getting Deel org chart:", error);
      throw {
        error: {
          code: "GET_ORG_CHART_FAILED",
          message: "Failed to get org chart from Deel",
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Org Chart & Hierarchy
  // =============================================

  @executable()
  async getOrgChart(request: GetOrgChartRequest = {}): Promise<OrgChartNode[]> {
    try {
      const peopleQuery = this.squid
        .collection<PersonEnhanced>("people")
        .query();
      let peopleSnapshot = await peopleQuery.snapshot();
      let people = this.toArrayData<PersonEnhanced>(peopleSnapshot);

      // Filter by department if specified
      if (request.department_filter) {
        people = people.filter(
          (p) => p.department === request.department_filter
        );
      }

      // Build org chart nodes
      const orgChart: OrgChartNode[] = people.map((person) => {
        const directReports = people.filter(
          (p) => p.manager_id === person.person_id
        );
        const level = this.calculateLevel(person, people);

        return {
          person_id: person.person_id,
          name: person.name,
          email: person.email,
          title: person.role_title || "Unknown",
          department: person.department || "OPERATIONS",
          manager_id: person.manager_id,
          direct_reports: directReports.map((dr) => dr.person_id),
          level,
          employment_status: person.employment_status || "ACTIVE",
        };
      });

      // Filter by root person if specified
      if (request.root_person_id) {
        return this.getSubtree(
          request.root_person_id,
          orgChart,
          request.max_depth || 999
        );
      }

      return orgChart.sort((a, b) => a.level - b.level);
    } catch (error: any) {
      console.error("Error getting org chart:", error);
      throw {
        error: {
          code: "GET_ORG_CHART_FAILED",
          message: "Failed to get org chart",
          details: error,
        },
      } as ApiError;
    }
  }

  // =============================================
  // Performance Reviews
  // =============================================

  @executable()
  async createPerformanceReview(
    request: CreatePerformanceReviewRequest
  ): Promise<PerformanceReview> {
    try {
      const reviewId = this.generateId();
      const review: Omit<PerformanceReview, "__id"> = {
        review_id: reviewId,
        person_id: request.person_id,
        reviewer_id: request.reviewer_id,
        review_period: request.review_period,
        status: "DRAFT",
        overall_rating: request.overall_rating,
        technical_rating: request.technical_rating,
        collaboration_rating: request.collaboration_rating,
        leadership_rating: request.leadership_rating,
        strengths: request.strengths,
        areas_for_improvement: request.areas_for_improvement,
        goals_next_period: request.goals_next_period,
        manager_notes: request.manager_notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid
        .collection<PerformanceReview>("performance_reviews")
        .doc(reviewId)
        .insert(review);

      return review as PerformanceReview;
    } catch (error: any) {
      console.error("Error creating performance review:", error);
      throw {
        error: {
          code: "CREATE_REVIEW_FAILED",
          message: "Failed to create performance review",
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getPerformanceReviews(personId: string): Promise<PerformanceReview[]> {
    try {
      const query = this.squid
        .collection<PerformanceReview>("performance_reviews")
        .query();
      const snapshot = await query.eq("person_id", personId).snapshot();
      return this.toArrayData<PerformanceReview>(snapshot);
    } catch (error: any) {
      console.error("Error getting performance reviews:", error);
      return [];
    }
  }

  // =============================================
  // Person Goals
  // =============================================

  @executable()
  async createPersonGoal(
    request: CreatePersonGoalRequest
  ): Promise<PersonGoal> {
    try {
      const goalId = this.generateId();
      const goal: Omit<PersonGoal, "__id"> = {
        goal_id: goalId,
        person_id: request.person_id,
        title: request.title,
        description: request.description,
        goal_type: request.goal_type,
        target_date: request.target_date,
        progress_percent: 0,
        status: "NOT_STARTED",
        linked_loops: request.linked_loops,
        milestones: request.milestones,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;

      await this.squid
        .collection<PersonGoal>("person_goals")
        .doc(goalId)
        .insert(goal);

      return goal as PersonGoal;
    } catch (error: any) {
      console.error("Error creating person goal:", error);
      throw {
        error: {
          code: "CREATE_GOAL_FAILED",
          message: "Failed to create person goal",
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async updatePersonGoal(
    request: UpdatePersonGoalRequest
  ): Promise<{ success: boolean }> {
    try {
      const goalRef = this.squid
        .collection<PersonGoal>("person_goals")
        .doc(request.goal_id);
      const updates: Partial<PersonGoal> = {
        updated_at: new Date().toISOString(),
      } as any;

      if (request.progress_percent !== undefined)
        updates.progress_percent = request.progress_percent;
      if (request.status !== undefined) updates.status = request.status;
      if (request.milestones !== undefined)
        updates.milestones = request.milestones;

      await goalRef.update(updates as any);

      return { success: true };
    } catch (error: any) {
      console.error("Error updating person goal:", error);
      throw {
        error: {
          code: "UPDATE_GOAL_FAILED",
          message: "Failed to update person goal",
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getPersonGoals(personId: string): Promise<PersonGoal[]> {
    try {
      const query = this.squid.collection<PersonGoal>("person_goals").query();
      const snapshot = await query.eq("person_id", personId).snapshot();
      return this.toArrayData<PersonGoal>(snapshot);
    } catch (error: any) {
      console.error("Error getting person goals:", error);
      return [];
    }
  }

  // =============================================
  // Dashboards
  // =============================================

  @executable()
  async getPeopleOpsDashboard(): Promise<PeopleOpsDashboard> {
    try {
      const peopleQuery = this.squid
        .collection<PersonEnhanced>("people")
        .query();
      const peopleSnapshot = await peopleQuery.snapshot();
      const people = this.toArrayData<PersonEnhanced>(peopleSnapshot);

      // Aggregate by status
      const byStatus = this.aggregateByField(people, "employment_status");
      const byDepartment = this.aggregateByField(people, "department");
      const byType = this.aggregateByField(people, "employment_type");
      const byLocation = this.aggregateByField(people, "country");

      // Recent hires (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentHires = people
        .filter((p) => p.start_date && new Date(p.start_date) >= thirtyDaysAgo)
        .slice(0, 10);

      // Get upcoming reviews
      const reviewsQuery = this.squid
        .collection<PerformanceReview>("performance_reviews")
        .query();
      const reviewsSnapshot = await reviewsQuery.snapshot();
      const reviews = this.toArrayData<PerformanceReview>(reviewsSnapshot);
      const upcomingReviews = reviews
        .filter((r) => r.status !== "COMPLETED")
        .slice(0, 10);

      // Get pending goals
      const goalsQuery = this.squid
        .collection<PersonGoal>("person_goals")
        .query();
      const goalsSnapshot = await goalsQuery.snapshot();
      const goals = this.toArrayData<PersonGoal>(goalsSnapshot);
      const pendingGoals = goals
        .filter((g) => g.status === "IN_PROGRESS")
        .slice(0, 10);

      // Get org chart
      const orgChart = await this.getOrgChart();

      return {
        total_employees: people.length,
        by_status: byStatus as any,
        by_department: byDepartment as any,
        by_type: byType as any,
        by_location: byLocation as any,
        recent_hires: recentHires,
        upcoming_reviews: upcomingReviews,
        pending_goals: pendingGoals,
        org_chart: orgChart,
      };
    } catch (error: any) {
      console.error("Error getting people ops dashboard:", error);
      throw {
        error: {
          code: "GET_DASHBOARD_FAILED",
          message: "Failed to get people ops dashboard",
          details: error,
        },
      } as ApiError;
    }
  }

  @executable()
  async getPersonDashboardEnhanced(
    request: GetPersonDashboardEnhancedRequest
  ): Promise<PersonDashboardEnhanced> {
    try {
      // Find person
      let person: PersonEnhanced | undefined;

      if (request.person_id) {
        const personRef = this.squid
          .collection<PersonEnhanced>("people")
          .doc(request.person_id);
        const personDoc = await personRef.snapshot();
        person = personDoc ? this.toData<PersonEnhanced>(personDoc) : undefined;
      } else if (request.email) {
        const peopleQuery = this.squid
          .collection<PersonEnhanced>("people")
          .query();
        const peopleSnapshot = await peopleQuery
          .eq("email", request.email)
          .snapshot();
        if (peopleSnapshot.length > 0) {
          person = this.toData<PersonEnhanced>(peopleSnapshot[0]);
        }
      }

      if (!person) {
        throw {
          error: {
            code: "PERSON_NOT_FOUND",
            message: "Person not found",
          },
        } as ApiError;
      }

      // Get goals
      const goals = await this.getPersonGoals(person.person_id);
      const currentGoals = goals.filter(
        (g) => g.status === "IN_PROGRESS" || g.status === "NOT_STARTED"
      );
      const completedGoalsCount = goals.filter(
        (g) => g.status === "COMPLETED"
      ).length;

      // Get reviews
      const upcomingReviews = await this.getPerformanceReviews(
        person.person_id
      );

      // Get loops owned
      const ownershipQuery = this.squid
        .collection<LoopOwnership>("loop_ownership")
        .query();
      const ownerships = this.toArrayData<LoopOwnership>(
        await ownershipQuery.eq("person_id", person.person_id).snapshot()
      );

      const ownedLoopIds = ownerships
        .filter((o) => o.role === "OUTCOME_OWNER")
        .map((o) => o.loop_id);
      const contributingLoopIds = ownerships
        .filter((o) => o.role === "CONTRIBUTOR")
        .map((o) => o.loop_id);

      const loopsQuery = this.squid.collection<Loop>("loops").query();
      const allLoops = this.toArrayData<Loop>(await loopsQuery.snapshot());

      const loopsOwned = allLoops.filter((l) =>
        ownedLoopIds.includes(l.loop_id)
      );
      const loopsContributing = allLoops.filter((l) =>
        contributingLoopIds.includes(l.loop_id)
      );

      // Get engineering work
      let engineeringWork: EngineeringWorkItem[] = [];
      if (request.include_work_items) {
        const workQuery = this.squid
          .collection<EngineeringWorkItem>("engineering_work")
          .query();
        engineeringWork = this.toArrayData<EngineeringWorkItem>(
          await workQuery.eq("assigned_to", person.email).snapshot()
        );
      }

      // Get direct reports
      let directReports: PersonEnhanced[] = [];
      if (request.include_direct_reports) {
        const reportsQuery = this.squid
          .collection<PersonEnhanced>("people")
          .query();
        directReports = this.toArrayData<PersonEnhanced>(
          await reportsQuery.eq("manager_id", person.person_id).snapshot()
        );
      }

      // Get manager name
      let managerName: string | undefined;
      if (person.manager_id) {
        const managerRef = this.squid
          .collection<PersonEnhanced>("people")
          .doc(person.manager_id);
        const managerDoc = await managerRef.snapshot();
        if (managerDoc) {
          const manager = this.toData<PersonEnhanced>(managerDoc);
          managerName = manager.name;
        }
      }

      return {
        person_id: person.person_id,
        name: person.name,
        email: person.email,
        area: person.area,
        active_loops: loopsOwned.filter((l) => l.status === "IN_PROGRESS")
          .length,
        avg_score:
          loopsOwned.length > 0
            ? loopsOwned.reduce((sum, l) => sum + (l.loop_score || 0), 0) /
              loopsOwned.length
            : undefined,
        completed_loops: loopsOwned.filter((l) => l.status === "COMPLETED")
          .length,
        velocity_score: undefined, // Could calculate
        title: person.role_title || "Unknown",
        department: person.department || "OPERATIONS",
        employment_status: person.employment_status || "ACTIVE",
        employment_type: person.employment_type || "FULL_TIME",
        manager_name: managerName,
        direct_reports: directReports,
        current_goals: currentGoals,
        completed_goals_count: completedGoalsCount,
        upcoming_reviews: upcomingReviews,
        loops_owned: loopsOwned,
        loops_contributing: loopsContributing,
        engineering_work: engineeringWork,
        access_level: person.access_level || "BASIC",
        permissions: person.permissions || [],
      };
    } catch (error: any) {
      console.error("Error getting person dashboard enhanced:", error);
      throw error.error
        ? error
        : ({
            error: {
              code: "GET_PERSON_DASHBOARD_FAILED",
              message: "Failed to get person dashboard",
              details: error,
            },
          } as ApiError);
    }
  }

  // =============================================
  // Helper Methods
  // =============================================

  private buildHierarchy(people: PersonEnhanced[]): DeelOrgChart["hierarchy"] {
    return people.map((person) => {
      const directReports = people.filter(
        (p) => p.manager_id === person.person_id
      );
      const level = this.calculateLevel(person, people);

      return {
        employee_id: person.person_id,
        manager_id: person.manager_id,
        direct_reports: directReports.map((dr) => dr.person_id),
        level,
      };
    });
  }

  private calculateLevel(
    person: PersonEnhanced,
    allPeople: PersonEnhanced[]
  ): number {
    let level = 0;
    let currentPerson = person;

    while (currentPerson.manager_id && level < 10) {
      const manager = allPeople.find(
        (p) => p.person_id === currentPerson.manager_id
      );
      if (!manager) break;
      currentPerson = manager;
      level++;
    }

    return level;
  }

  private groupByDepartment(
    people: PersonEnhanced[]
  ): Record<DepartmentType, any> {
    const departments: any = {};
    const deptTypes: DepartmentType[] = [
      "ENGINEERING",
      "PRODUCT",
      "DESIGN",
      "SALES",
      "MARKETING",
      "OPERATIONS",
      "FINANCE",
      "HR",
      "EXECUTIVE",
    ];

    deptTypes.forEach((dept) => {
      const members = people.filter((p) => p.department === dept);
      departments[dept] = {
        head_id: members.find(
          (m) =>
            m.role_title?.toLowerCase().includes("head") ||
            m.role_title?.toLowerCase().includes("director")
        )?.person_id,
        member_count: members.length,
        members: members.map((m) => m.person_id),
      };
    });

    return departments;
  }

  private getSubtree(
    rootId: string,
    orgChart: OrgChartNode[],
    maxDepth: number
  ): OrgChartNode[] {
    const result: OrgChartNode[] = [];
    const root = orgChart.find((n) => n.person_id === rootId);

    if (!root) return [];

    const traverse = (node: OrgChartNode, depth: number) => {
      if (depth > maxDepth) return;
      result.push(node);
      node.direct_reports.forEach((reportId) => {
        const report = orgChart.find((n) => n.person_id === reportId);
        if (report) traverse(report, depth + 1);
      });
    };

    traverse(root, 0);
    return result;
  }

  private aggregateByField(
    items: any[],
    field: string
  ): Record<string, number> {
    return items.reduce((acc, item) => {
      const value = item[field] || "Unknown";
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
