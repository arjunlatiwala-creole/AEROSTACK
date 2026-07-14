import "@/lib/ag-grid-config";
import { useQuery } from "@tanstack/react-query";
import type { ColDef, RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useState, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  LayoutGrid,
  Mail,
  MapPin,
  Table2,
  User,
  Briefcase,
  Calendar,
  Users,
  Building2,
  Search,
  X,
} from "lucide-react";
import { getDashboard, type PeopleDashboardFilters } from "@/api/people-ops";
import Loader from "@/components/Loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Person {
  person_id: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  title: string;
  job_title?: string;
  department: string | { name?: string } | null;
  level: number;
  employment_status: string;
  start_date?: string | null;
  addresses?: Array<{ country?: string }>;
  manager_id?: string;
  direct_reports?: string[];
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function getDepartmentName(dept: string | { name?: string } | null): string {
  if (!dept) return "No Dept";
  if (typeof dept === "string") return dept;
  return dept.name || "No Dept";
}

function getStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  const lower = status.toLowerCase();
  if (lower === "active" || lower === "completed") return "default";
  if (lower.includes("termination") || lower === "inactive") return "destructive";
  return "secondary";
}

function getCountry(addresses?: Array<{ country?: string }>): string {
  if (!addresses || addresses.length === 0) return "—";
  return addresses[0]?.country || "—";
}

/* ─── Person Detail View ─── */
function PersonDetail({
  person,
  people,
  onBack,
  onSelectPerson,
}: {
  person: Person;
  people: Person[];
  onBack: () => void;
  onSelectPerson: (p: Person) => void;
}) {
  const manager = person.manager_id
    ? people.find((p) => p.person_id === person.manager_id)
    : null;

  const directReports = (person.direct_reports || [])
    .map((id) => people.find((p) => p.person_id === id))
    .filter(Boolean) as Person[];

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{person.name}</h1>
          <p className="text-muted-foreground">{person.title}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Personal Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-5 gap-x-8">
              <DetailRow
                icon={<User className="h-4 w-4" />}
                label="Full Name"
                value={person.name}
              />
              <DetailRow
                icon={<Mail className="h-4 w-4" />}
                label="Email"
                value={person.email || "—"}
              />
              <DetailRow
                icon={<Briefcase className="h-4 w-4" />}
                label="Job Title"
                value={person.job_title || person.title}
              />
              <DetailRow
                icon={<Building2 className="h-4 w-4" />}
                label="Department"
                value={getDepartmentName(person.department)}
              />
              <DetailRow
                icon={<MapPin className="h-4 w-4" />}
                label="Country"
                value={getCountry(person.addresses)}
              />
              <DetailRow
                icon={<Calendar className="h-4 w-4" />}
                label="Start Date"
                value={
                  person.start_date
                    ? new Date(person.start_date).toLocaleDateString()
                    : "—"
                }
              />
              <DetailRow
                icon={<Users className="h-4 w-4" />}
                label="Level"
                value={`Level ${person.level}`}
              />
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-muted-foreground">
                  <Briefcase className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={getStatusVariant(person.employment_status)}>
                    {person.employment_status}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Reporting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Reports to</p>
              {manager ? (
                <button
                  onClick={() => onSelectPerson(manager)}
                  className="w-full text-left rounded-md border p-3 hover:bg-muted transition-colors"
                >
                  <p className="font-medium text-sm">{manager.name}</p>
                  <p className="text-xs text-muted-foreground">{manager.title}</p>
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">No manager</p>
              )}
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Direct Reports ({directReports.length})
              </p>
              {directReports.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {directReports.map((report) => (
                    <button
                      key={report.person_id}
                      onClick={() => onSelectPerson(report)}
                      className="w-full text-left rounded-md border p-3 hover:bg-muted transition-colors"
                    >
                      <p className="font-medium text-sm">{report.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {report.title}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No direct reports</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
export default function DashboardPeople() {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  // Staged filter state: `filters` = what's in the inputs, `appliedFilters` = sent to backend
  const [filters, setFilters] = useState<PeopleDashboardFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<PeopleDashboardFilters>({});

  const hasActiveFilters = Object.values(appliedFilters).some(
    (v) => v !== undefined && v !== "",
  );

  // Fetch unfiltered once to populate dropdown options — stale for 10 min
  const { data: optionsData } = useQuery({
    queryKey: ["people-ops-options"],
    queryFn: () => getDashboard({}),
    staleTime: 10 * 60 * 1000,
  });

  const departmentOptions: string[] = useMemo(
    () => optionsData?.data?.distinct_departments ?? [],
    [optionsData],
  );
  const statusOptions: string[] = useMemo(
    () => optionsData?.data?.distinct_statuses ?? [],
    [optionsData],
  );

  // Filtered data query — re-fetches whenever appliedFilters changes
  const { data, isLoading } = useQuery({
    queryKey: ["people-ops-dashboard", appliedFilters],
    queryFn: () => getDashboard(appliedFilters),
  });

  const people: Person[] = useMemo(() => data?.data?.org_chart ?? [], [data]);

  const totalPages = Math.max(1, Math.ceil(people.length / pageSize));
  const paginatedPeople = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return people.slice(start, start + pageSize);
  }, [people, currentPage, pageSize]);

  const handleFilterChange = useCallback(
    (key: keyof PeopleDashboardFilters, value: string) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters({ ...filters });
    setCurrentPage(1);
  }, [filters]);

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setAppliedFilters({});
    setCurrentPage(1);
  }, []);

  const columnDefs: ColDef[] = useMemo(
    () => [
      { headerName: "Name", field: "name", flex: 2, minWidth: 180 },
      { headerName: "Title", field: "title", flex: 2, minWidth: 180 },
      {
        headerName: "Department",
        valueGetter: (params) => getDepartmentName(params.data?.department),
        flex: 1.5,
        minWidth: 140,
      },
      {
        headerName: "Status",
        field: "employment_status",
        flex: 1,
        minWidth: 120,
      },
      { headerName: "Email", field: "email", flex: 2, minWidth: 200 },
      {
        headerName: "Country",
        valueGetter: (params) => getCountry(params.data?.addresses),
        flex: 1,
        minWidth: 100,
      },
      {
        headerName: "Start Date",
        field: "start_date",
        flex: 1,
        minWidth: 110,
        valueFormatter: ({ value }: { value: string }) =>
          value ? value.split("T")[0].split("-").reverse().join("/") : "—",
      },
    ],
    [],
  );

  const handleRowClick = (event: RowClickedEvent) => {
    setSelectedPerson(event.data as Person);
  };

  if (selectedPerson) {
    return (
      <PersonDetail
        person={selectedPerson}
        people={people}
        onBack={() => setSelectedPerson(null)}
        onSelectPerson={setSelectedPerson}
      />
    );
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      <h1 className="text-3xl font-bold">People</h1>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Team Directory</CardTitle>

          {/* View toggle */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <div className="flex rounded-md border overflow-hidden">
              <button
                onClick={() => setViewMode("table")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1",
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted",
                )}
              >
                <Table2 className="h-3.5 w-3.5" />
                Table
              </button>
              <button
                onClick={() => setViewMode("cards")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors border-l flex items-center gap-1",
                  viewMode === "cards"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card hover:bg-muted",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t">
            {/* Name — free-text */}
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground font-medium">
                Name
              </label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name…"
                  value={filters.name ?? ""}
                  onChange={(e) => handleFilterChange("name", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>

            {/* Email — free-text */}
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground font-medium">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search email…"
                  value={filters.email ?? ""}
                  onChange={(e) => handleFilterChange("email", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>

            {/* Department — dropdown */}
            <div className="flex flex-col gap-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground font-medium">
                Department
              </label>
              <Select
                value={filters.department ?? ""}
                onValueChange={(val) =>
                  handleFilterChange("department", val === "__all__" ? "" : val)
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All departments</SelectItem>
                  {departmentOptions.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status — dropdown */}
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground font-medium">
                Status
              </label>
              <Select
                value={filters.status ?? ""}
                onValueChange={(val) =>
                  handleFilterChange("status", val === "__all__" ? "" : val)
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex items-end gap-2 pb-0.5">
              <Button
                size="sm"
                onClick={handleApplyFilters}
                className="h-8 gap-1.5"
              >
                <Search className="h-3.5 w-3.5" />
                Search
              </Button>
              {hasActiveFilters && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearFilters}
                  className="h-8 gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader description="Loading people..." />
            </div>
          ) : people.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm">No people found</p>
            </div>
          ) : (
            <>
              {/* Table View */}
              {viewMode === "table" && (
                <div className="h-[500px] w-full">
                  <div className="ag-theme-alpine h-full w-full">
                    <AgGridReact
                      theme="legacy"
                      rowData={paginatedPeople}
                      columnDefs={columnDefs}
                      pagination={false}
                      defaultColDef={{
                        sortable: true,
                        filter: true,
                        resizable: true,
                      }}
                      rowHeight={50}
                      onRowClicked={handleRowClick}
                      rowClass="cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Cards View */}
              {viewMode === "cards" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {paginatedPeople.map((person) => (
                    <div
                      key={person.person_id}
                      onClick={() => setSelectedPerson(person)}
                      className="rounded-lg border p-4 hover:shadow-md transition-shadow cursor-pointer"
                    >
                      <h3 className="font-semibold text-sm">{person.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {person.title}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <Badge variant="outline" className="text-xs">
                          {getDepartmentName(person.department)}
                        </Badge>
                        <Badge
                          variant={getStatusVariant(person.employment_status)}
                          className="text-xs"
                        >
                          {person.employment_status}
                        </Badge>
                      </div>
                      {person.email && (
                        <p className="text-xs text-muted-foreground mt-2 truncate">
                          {person.email}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination Footer */}
              <div className="border-t bg-card px-4 py-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {(currentPage - 1) * pageSize + 1}–
                    {Math.min(currentPage * pageSize, people.length)} of{" "}
                    {people.length} people
                  </div>
                  <div className="flex items-center gap-4">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="rounded border px-2 py-1 text-sm cursor-pointer"
                    >
                      {PAGE_SIZE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s} / page
                        </option>
                      ))}
                    </select>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => p - 1)}
                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        ◀
                      </button>
                      <button
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => p + 1)}
                        className="rounded border p-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
