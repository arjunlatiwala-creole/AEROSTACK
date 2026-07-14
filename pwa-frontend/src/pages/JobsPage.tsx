import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
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
    Briefcase,
    MapPin,
    Clock,
    Building2,
    ArrowRight,
    Loader2,
} from "lucide-react";
import { fetchPublicJobs, type JobRec } from "@/api/hiring";
import aerostackLogo from "@/assets/logo-source.png";

const JOB_TYPE_LABELS: Record<string, string> = {
    "full-time": "Full-time",
    "part-time": "Part-time",
    contract: "Contract",
    internship: "Internship",
};

export default function JobsPage() {
    const [jobs, setJobs] = useState<JobRec[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchPublicJobs();
                setJobs(data.jobs);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Failed to load jobs");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b">
                <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
                    <img src={aerostackLogo} alt="Aerostack" className="w-10 h-10 rounded" />
                    <div>
                        <h1 className="text-2xl font-bold">Careers at enterprise</h1>
                        <p className="text-sm text-muted-foreground">
                            Join our team and help build the future
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {error && (
                    <div className="text-center py-20 text-muted-foreground">
                        <p>{error}</p>
                    </div>
                )}

                {!loading && !error && jobs.length === 0 && (
                    <div className="text-center py-20">
                        <Briefcase className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <h2 className="text-xl font-semibold mb-2">No open positions right now</h2>
                        <p className="text-muted-foreground">
                            Check back soon — we&apos;re growing fast.
                        </p>
                    </div>
                )}

                {!loading && jobs.length > 0 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground mb-6">
                            {jobs.length} open position{jobs.length !== 1 ? "s" : ""}
                        </p>

                        {jobs.map((job) => (
                            <Card
                                key={job.jobRecId}
                                className="shadow-none hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => navigate(`/jobs/${job.jobRecId}`)}
                            >
                                <CardContent className="p-6">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold mb-2">
                                                {job.title}
                                            </h3>
                                            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-3">
                                                <span className="flex items-center gap-1">
                                                    <Building2 className="w-3.5 h-3.5" />
                                                    {job.department}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {job.location}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
                                                </span>
                                            </div>
                                            {job.description && (
                                                <p className="text-sm text-muted-foreground line-clamp-2">
                                                    {job.description}
                                                </p>
                                            )}
                                            {job.salaryRange && (
                                                <Badge variant="outline" className="mt-3 text-xs">
                                                    {job.salaryRange}
                                                </Badge>
                                            )}
                                        </div>
                                        <Button variant="ghost" size="sm" className="shrink-0 mt-1">
                                            Apply <ArrowRight className="w-4 h-4 ml-1" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
