import { useParams, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Building2, User, Building, Handshake } from "lucide-react";
import { cn } from "@/lib/utils";
import Loader from "@/components/Loader";
import { useDeal } from "@/hooks/useDeals";

type HealthStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED";

const HEALTH_COLORS: Record<HealthStatus, string> = {
  GREEN: "text-emerald-500",
  YELLOW: "text-yellow-400",
  ORANGE: "text-orange-500",
  RED: "text-red-500",
};

export default function DealDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();

  // Use the React Query hook to fetch deal data
  const {
    data: deal,
    isLoading,
    isError,
    error,
  } = useDeal({
    dealId: dealId!,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader description="Loading deal details..." />
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div className="flex h-screen flex-col items-center justify-center">
        <h2 className="mb-4 text-2xl font-bold">
          {isError ? "Error Loading Deal" : "Deal Not Found"}
        </h2>
        {isError && error && (
          <p className="mb-4 text-sm text-muted-foreground">
            {error.message || "An error occurred while loading the deal"}
          </p>
        )}
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-4">
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                className="h-9 w-9"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Building className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{deal.name}</h1>
                  <p className="text-sm text-muted-foreground">{deal.id}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted px-3 py-1.5">
                <p className="text-sm font-medium">{deal.stage_name}</p>
              </div>
              {deal.health_status && (
                <div
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-bold",
                    HEALTH_COLORS[deal.health_status],
                  )}
                >
                  ● {deal.health_status}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="space-y-6">
          {/* Customer Company Info */}
          <Card className="border-2">
            <CardContent className="p-6">
              <div className="mb-6 flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-semibold">
                    Customer Company Info
                  </h2>
                </div>
              </div>

              {deal.companies?.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Company Name
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.name || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Company Domain Name
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.domain || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Company Owner Email
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.ownerEmail || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Company Owner Name
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.ownerName || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      Industry
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.industry || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      City
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.city || "--"}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      State
                    </label>
                    <p className="text-base font-medium">
                      {deal.companies[0]?.state || "--"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No company details found
                </p>
              )}
            </CardContent>
          </Card>
          {/* Deal Detail */}
          <Card className="border-2">
            <CardContent className="p-6">
              <div className="mb-6 flex items-center gap-2 border-b pb-4">
                <Handshake className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Deal Detail</h2>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Deal Name
                  </label>
                  <p className="text-base font-medium">{deal.name}</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Owner Email
                  </label>
                  <p className="text-base font-medium">
                    {deal.ownerEmail || "--"}
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Owner Name
                  </label>
                  <p className="text-base font-medium">
                    {deal.ownerName || "--"}
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Amount
                  </label>
                  {(deal.amount || "--").toLocaleString()}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Aerostack LifeCycle
                  </label>
                  <p className="text-base font-medium">
                    {deal.stage_name || "--"}
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Deal Phase
                  </label>
                  <p className="text-base font-medium">{deal.phase || "--"}</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Pipeline
                  </label>
                  <p className="text-base font-medium">
                    {deal.pipeline_name || "--"}
                  </p>
                </div>
                {/* <div className="md:col-span-2 lg:col-span-4">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Deal Description
                  </label>
                  <p className="text-base font-medium">
                    {deal.description || "--"}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Next step
                  </label>
                  <p className="text-base font-medium">
                    {deal.next_step || "--"}
                  </p>
                </div> */}

                {deal.health_status && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">
                      Health Status
                    </label>
                    <p
                      className={cn(
                        "text-base font-bold",
                        HEALTH_COLORS[deal.health_status],
                      )}
                    >
                      ● {deal.health_status}
                    </p>
                  </div>
                )}
                {/* {deal.priority !== undefined && deal.priority !== null && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted-foreground">
                      Priority
                    </label>
                    <p className="text-base font-medium">{deal.priority}</p>
                  </div>
                )}
                {deal.confidence_score !== undefined &&
                  deal.confidence_score !== null && (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-muted-foreground">
                        Confidence Score
                      </label>
                      <p className="text-base font-medium">
                        {deal.confidence_score}%
                      </p>
                    </div>
                  )} */}
              </div>
            </CardContent>
          </Card>

          {/* Customer Contact Info */}
          {/* Customer Contact Info */}
          <Card className="border-2">
            <CardContent className="p-6">
              <div className="mb-6 flex items-center gap-2 border-b pb-4">
                <User className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Customer Contact Info</h2>
              </div>

              {deal.contacts?.length > 0 ? (
                <div>
                  {/* Header Row */}
                  <div className="grid grid-cols-4 gap-6 mb-3">
                    {/* <p className="text-sm font-medium text-muted-foreground">
                      First Name
                    </p>
                    <p className="text-sm font-medium text-muted-foreground">
                      Last Name
                    </p> */}
                    <p className="text-sm font-medium text-muted-foreground">
                      Full Name
                    </p>
                    <p className="text-sm font-medium text-muted-foreground">
                      Email
                    </p>
                  </div>

                  {/* Data Rows */}
                  <div className="space-y-0 divide-y">
                    {deal.contacts.map((contact: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-4 gap-6 py-4">
                        {/* <p className="text-base font-medium">
                          {contact.firstName || "--"}
                        </p>
                        <p className="text-base font-medium">
                          {contact.lastName || "--"}
                        </p> */}
                        <p className="text-base font-medium">
                          {contact.fullName || "--"}
                        </p>
                        <p className="text-base font-medium">
                          {contact.email || "--"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No contact details found
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
