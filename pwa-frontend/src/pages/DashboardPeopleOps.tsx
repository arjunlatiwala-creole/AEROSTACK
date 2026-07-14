// components/DashboardPeopleOps.tsx
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users, BarChart3, GitBranch, RefreshCw, Loader2, UserPlus } from "lucide-react";
import Loader from "@/components/Loader";
import { getDashboard, syncFromDeel } from "@/api/people-ops";
import HiringPipelineBoard from "@/components/aerostack/hiring/HiringPipelineBoard";
import OrgChart from "@/components/aerostack/OrgChart";

interface OrgNode {
  person_id: string;
  name: string;
  email: string;
  title: string;
  department: string;
  level: number;
  direct_reports: OrgNode[];
  employment_status: string;
}

interface DashboardResponse {
  total_employees: number;
  by_status: Record<string, number>;
  by_department: Record<string, number>;
  by_type: Record<string, number>;
  by_location: Record<string, number>;
  recent_hires: any[];
  upcoming_reviews: any[];
  pending_goals: any[];
  org_chart: OrgNode[];
}

export default function DashboardPeopleOps() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"overview" | "orgchart" | "hiring">("overview");
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const data = await getDashboard();
      // console.log("your data people ops", data);
      // debugger;
      setDashboard(data.data);
    } catch (error: any) {
      console.error("Error loading dashboard:", error);
      setDashboard({
        total_employees: 0,
        by_status: {},
        by_department: {},
        by_type: {},
        by_location: {},
        recent_hires: [],
        upcoming_reviews: [],
        pending_goals: [],
        org_chart: [],
      });
    } finally {
      setLoading(false);
    }
  };

  console.log("your dashboard people ops", dashboard);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncFromDeel();
      alert(
        `Synced ${result.synced_count} employees from Deel!\n` +
        `New: ${result.new_count}, Updated: ${result.updated_count}\n` +
        `Errors: ${result.errors.length}`,
      );
      loadDashboard();
    } catch (error: any) {
      alert(`Deel sync error: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader description="Loading People Ops Dashboard..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold flex items-center gap-3">
          <Users className="w-10 h-10" />
          People Ops
        </h1>
        <div className="flex gap-2">
          <Button
            onClick={() => setViewMode("overview")}
            variant={viewMode === "overview" ? "default" : "outline"}
          >
            <BarChart3 className="w-4 h-4 mr-2" /> Overview
          </Button>
          <Button
            onClick={() => setViewMode("hiring")}
            variant={viewMode === "hiring" ? "default" : "outline"}
          >
            <UserPlus className="w-4 h-4 mr-2" /> Hiring
          </Button>
          <Button
            onClick={() => setViewMode("orgchart")}
            variant={viewMode === "orgchart" ? "default" : "outline"}
          >
            <GitBranch className="w-4 h-4 mr-2" /> Org Chart
          </Button>
          {/* <Button
            onClick={handleSync}
            disabled={syncing}
            variant="default"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" /> Sync from Deel
              </>
            )}
          </Button> */}
        </div>
      </div>

      {/* Overview Mode */}
      {viewMode === "overview" && (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card className="shadow-none">
              <CardHeader className="pb-3">
                <CardDescription>Total Employees</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">
                  {dashboard?.total_employees ?? 0}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="pb-3">
                <CardDescription>Active</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">
                  {dashboard?.by_status?.active ?? 0}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="pb-3">
                <CardDescription>Recent Hires</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">
                  {(dashboard?.recent_hires ?? []).length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Last 30 days
                </p>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader className="pb-3">
                <CardDescription>Departments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-bold">
                  {
                    Object.keys(dashboard?.by_department ?? {}).filter(
                      (d) => (dashboard?.by_department?.[d] ?? 0) > 0,
                    ).length
                  }
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Employees by Department */}
          <Card className="mb-8 shadow-none">
            <CardHeader>
              <CardTitle>Employees by Department</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Object.entries(dashboard?.by_department ?? {})
                  .filter(([_, count]) => count > 0)
                  .map(([dept, count]) => (
                    <Card key={dept} className="border-l-3 shadow-none">
                      <CardContent className="pt-6">
                        <div className="text-sm text-muted-foreground mb-2 capitalize">
                          {dept.toLowerCase().replace("_", " ")}
                        </div>
                        <div className="text-4xl font-bold">{count}</div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Hires & Upcoming Reviews */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Hires */}
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>Recent Hires</CardTitle>
              </CardHeader>
              <CardContent>
                {(dashboard?.recent_hires ?? []).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <div>No recent hires</div>
                  </div>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto pr-2 space-y-3">
                    {(dashboard?.recent_hires ?? []).map((person: any) => (
                      <Card
                        key={person.person_id}
                        onClick={() => setSelectedPerson(person)}
                        className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
                      >
                        <CardContent className="pt-4">
                          {/* Name */}
                          <div className="font-semibold mb-1">
                            {(() => {
                              const fullName =
                                `${person.given_name ?? ""} ${person.family_name ?? ""}`.trim();
                              return fullName.length > 0
                                ? fullName
                                : "Unnamed Person";
                            })()}
                          </div>

                          {/* Role + Department */}
                          <div className="text-sm text-muted-foreground">
                            {typeof person.job_title === "string" &&
                              person.job_title.length > 0
                              ? person.job_title
                              : (person.job_title?.name ?? "Unknown Role")}
                            {" • "}
                            {typeof person.department?.name === "string" &&
                              person.department.name.length > 0
                              ? person.department.name
                              : "No Dept"}
                          </div>

                          {/* Start Date */}
                          {person.start_date &&
                            !isNaN(Date.parse(person.start_date)) && (
                              <div className="text-xs text-muted-foreground mt-2">
                                Started{" "}
                                {new Date(
                                  person.start_date,
                                ).toLocaleDateString()}
                              </div>
                            )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upcoming Reviews */}
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle>Upcoming Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                {(dashboard?.upcoming_reviews ?? []).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <div>No upcoming reviews</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(dashboard?.upcoming_reviews ?? []).map((review: any) => (
                      <Card
                        key={review.review_id}
                        className="border-l-4 border-l-orange-500"
                      >
                        <CardContent className="pt-4">
                          <div className="font-semibold mb-1">
                            Review for {review.person_id.slice(-8)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Period: {review.review_period}
                          </div>
                          <div className="mt-2">
                            <Badge
                              variant={
                                review.status === "COMPLETED"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {review.status}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Hiring Pipeline Mode */}
      {viewMode === "hiring" && <HiringPipelineBoard />}

      {/* Org Chart Mode */}
      {viewMode === "orgchart" && (
        <OrgChart
          nodes={dashboard?.org_chart ?? []}
          onSelectPerson={(node) => setSelectedPerson(node)}
        />
      )}

      {/* Person Detail Modal */}
      <Dialog
        open={!!selectedPerson}
        onOpenChange={() => setSelectedPerson(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {selectedPerson
                ? `${selectedPerson.given_name ?? ""} ${selectedPerson.family_name ?? ""}`.trim() ||
                "Unnamed Person"
                : ""}
            </DialogTitle>
          </DialogHeader>

          {selectedPerson && (
            <div className="grid grid-cols-2 gap-6 mt-4">
              {/* Email */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">Email</div>
                <div className="font-semibold">
                  {selectedPerson.email ?? "N/A"}
                </div>
              </div>

              {/* Job Title */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">Title</div>
                <div className="font-semibold">
                  {typeof selectedPerson.job_title === "string"
                    ? selectedPerson.job_title
                    : (selectedPerson.job_title?.name ?? "Unknown")}
                </div>
              </div>

              {/* Department */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">
                  Department
                </div>
                <div className="font-semibold">
                  {selectedPerson.department?.name ?? "No Dept"}
                </div>
              </div>

              {/* Status */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">Status</div>
                <div className="font-semibold capitalize">
                  {selectedPerson.hiring_status ??
                    selectedPerson.employment_status ??
                    "Unknown"}
                </div>
              </div>

              {/* Country */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">
                  Country
                </div>
                <div className="font-semibold">
                  {selectedPerson.addresses?.[0]?.country ?? "N/A"}
                </div>
              </div>

              {/* Start Date */}
              <div>
                <div className="text-sm text-muted-foreground mb-1">
                  Start Date
                </div>
                <div className="font-semibold">
                  {selectedPerson.start_date
                    ? new Date(selectedPerson.start_date).toLocaleDateString()
                    : "N/A"}
                </div>
              </div>
            </div>
          )}

          <Button onClick={() => setSelectedPerson(null)} className="mt-6">
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
