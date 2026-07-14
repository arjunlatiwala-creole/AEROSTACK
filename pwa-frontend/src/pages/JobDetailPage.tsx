import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Briefcase,
    MapPin,
    Clock,
    Building2,
    ArrowLeft,
    Loader2,
    AlertCircle,
    Send,
    CheckCircle,
} from "lucide-react";
import { fetchPublicJob, type JobRec } from "@/api/hiring";
import aerostackLogo from "@/assets/logo-source.png";

const JOB_TYPE_LABELS: Record<string, string> = {
    "full-time": "Full-time",
    "part-time": "Part-time",
    contract: "Contract",
    internship: "Internship",
};

export default function JobDetailPage() {
    const { jobRecId } = useParams<{ jobRecId: string }>();
    const navigate = useNavigate();

    const [job, setJob] = useState<JobRec | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!jobRecId) {
            setError("No job specified");
            setLoading(false);
            return;
        }
        const load = async () => {
            try {
                const data = await fetchPublicJob(jobRecId);
                setJob(data);
                // Update page title for bookmarks / tab
                document.title = `${data.title} — enterprise Careers`;
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : "Job not found");
            } finally {
                setLoading(false);
            }
        };
        load();

        return () => {
            document.title = "Aerostack";
        };
    }, [jobRecId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error || !job) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <Card className="max-w-md w-full shadow-none">
                    <CardContent className="pt-10 pb-10 text-center">
                        <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                        <h2 className="text-xl font-bold mb-2">Position Not Found</h2>
                        <p className="text-muted-foreground mb-6">
                            This position may no longer be accepting applications.
                        </p>
                        <Button variant="outline" onClick={() => navigate("/jobs")}>
                            <ArrowLeft className="w-4 h-4 mr-2" /> View All Positions
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b">
                <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
                    <img src={aerostackLogo} alt="Aerostack" className="w-10 h-10 rounded" />
                    <div>
                        <h1 className="text-2xl font-bold">Careers at enterprise</h1>
                        <p className="text-sm text-muted-foreground">
                            Join our team and help build the future
                        </p>
                    </div>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-4 py-8">
                {/* Back to jobs */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="mb-6 -ml-2"
                    onClick={() => navigate("/jobs")}
                >
                    <ArrowLeft className="w-4 h-4 mr-1" /> All Positions
                </Button>

                {/* Job Header */}
                <div className="mb-8">
                    <h2 className="text-3xl font-bold mb-3">{job.title}</h2>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
                        <span className="flex items-center gap-1.5">
                            <Building2 className="w-4 h-4" />
                            {job.department}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" />
                            {job.location}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
                        </span>
                    </div>
                    {job.salaryRange && (
                        <Badge variant="outline" className="text-sm">
                            {job.salaryRange}
                        </Badge>
                    )}
                </div>

                {/* Apply CTA — top */}
                <div className="mb-8">
                    <Button
                        size="lg"
                        onClick={() => navigate(`/apply/${jobRecId}`)}
                    >
                        <Send className="w-4 h-4 mr-2" />
                        Apply for this Position
                    </Button>
                </div>

                {/* Description */}
                {job.description && (
                    <section className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">About the Role</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                            {job.description}
                        </p>
                    </section>
                )}

                {/* Responsibilities */}
                {job.responsibilities && job.responsibilities.length > 0 && (
                    <section className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">Responsibilities</h3>
                        <ul className="space-y-2">
                            {job.responsibilities.map((item, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                    <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Requirements */}
                {job.requirements && job.requirements.length > 0 && (
                    <section className="mb-8">
                        <h3 className="text-lg font-semibold mb-3">Requirements</h3>
                        <ul className="space-y-2">
                            {job.requirements.map((item, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                    <Briefcase className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* Apply CTA — bottom */}
                <div className="border-t pt-8 mt-8">
                    <h3 className="text-lg font-semibold mb-2">Interested?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        We&apos;d love to hear from you. Submit your application and
                        someone from our team will be in touch.
                    </p>
                    <Button
                        size="lg"
                        onClick={() => navigate(`/apply/${jobRecId}`)}
                    >
                        <Send className="w-4 h-4 mr-2" />
                        Apply Now
                    </Button>
                </div>

                {/* Footer */}
                <p className="text-xs text-muted-foreground text-center mt-12 pb-8">
                    © {new Date().getFullYear()} enterprise — All rights reserved
                </p>
            </div>
        </div>
    );
}
