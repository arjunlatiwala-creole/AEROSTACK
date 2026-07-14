import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    CheckCircle,
    Loader2,
    Send,
    Briefcase,
    AlertCircle,
    Upload,
    FileText,
    X,
    MapPin,
    Building2,
    Clock,
    ArrowLeft,
} from "lucide-react";
import {
    submitPublicApplication,
    fetchPublicJob,
    uploadResume,
    type JobRec,
} from "@/api/hiring";
import aerostackLogo from "@/assets/logo-source.png";

const MAX_RESUME_SIZE = 3 * 1024 * 1024; // 3 MB
const ALLOWED_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const JOB_TYPE_LABELS: Record<string, string> = {
    "full-time": "Full-time",
    "part-time": "Part-time",
    contract: "Contract",
    internship: "Internship",
};

export default function ApplyPage() {
    const { jobRecId } = useParams<{ jobRecId: string }>();
    const navigate = useNavigate();

    const [job, setJob] = useState<JobRec | null>(null);
    const [jobLoading, setJobLoading] = useState(!!jobRecId);
    const [jobError, setJobError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [source, setSource] = useState("website");
    const [referredBy, setReferredBy] = useState("");
    const [linkedinUrl, setLinkedinUrl] = useState("");
    const [message, setMessage] = useState("");
    const [resumeFile, setResumeFile] = useState<File | null>(null);
    const [resumeError, setResumeError] = useState<string | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load job details if jobRecId is provided
    useEffect(() => {
        if (!jobRecId) {
            setJobLoading(false);
            return;
        }
        const load = async () => {
            try {
                const data = await fetchPublicJob(jobRecId);
                setJob(data);
            } catch (err: unknown) {
                setJobError(
                    err instanceof Error ? err.message : "Job not found",
                );
            } finally {
                setJobLoading(false);
            }
        };
        load();
    }, [jobRecId]);

    const isValid =
        name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setResumeError(null);
        const file = e.target.files?.[0];
        if (!file) return;

        if (!ALLOWED_TYPES.includes(file.type)) {
            setResumeError("Only PDF and Word documents are accepted");
            return;
        }
        if (file.size > MAX_RESUME_SIZE) {
            setResumeError("Resume must be 3 MB or smaller");
            return;
        }
        setResumeFile(file);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid) return;

        setSubmitting(true);
        setError(null);

        try {
            // Upload resume first if provided
            let resumeS3Key: string | undefined;
            if (resumeFile) {
                try {
                    resumeS3Key = await uploadResume(
                        resumeFile,
                        email.trim().toLowerCase(),
                    );
                } catch (uploadErr) {
                    console.warn("Resume upload failed, submitting without resume:", uploadErr);
                    // Continue with application — resume upload is not blocking
                }
            }

            await submitPublicApplication({
                name: name.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim() || undefined,
                source,
                referredBy: referredBy.trim() || undefined,
                linkedinUrl: linkedinUrl.trim() || undefined,
                message: message.trim() || undefined,
                jobRecId: jobRecId ?? undefined,
                resumeS3Key,
            });
            setSubmitted(true);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Something went wrong";
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    // Loading job
    if (jobLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Job not found
    if (jobRecId && jobError) {
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

    // Success state
    if (submitted) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <Card className="max-w-md w-full shadow-none">
                    <CardContent className="pt-10 pb-10 text-center">
                        <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
                        <h2 className="text-2xl font-bold mb-2">Application Submitted</h2>
                        <p className="text-muted-foreground mb-6">
                            Thank you for your interest in joining enterprise
                            {job ? ` as ${job.title}` : ""}. We&apos;ve received your
                            application and someone from our team will be in touch.
                        </p>
                        <Button variant="outline" onClick={() => navigate("/jobs")}>
                            View Other Positions
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
                <div className="max-w-lg mx-auto px-4 py-6 flex items-center gap-3">
                    <img src={aerostackLogo} alt="Aerostack" className="w-10 h-10 rounded" />
                    <div>
                        <h1 className="text-2xl font-bold">Join enterprise</h1>
                        <p className="text-sm text-muted-foreground">
                            Apply to work with us
                        </p>
                    </div>
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 py-8">
                {/* Back to jobs */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="mb-4 -ml-2"
                    onClick={() => navigate("/jobs")}
                >
                    <ArrowLeft className="w-4 h-4 mr-1" /> All Positions
                </Button>

                {/* Job Details Card */}
                {job && (
                    <Card className="shadow-none mb-6 border-l-4 border-l-primary">
                        <CardContent className="p-5">
                            <h2 className="text-lg font-bold mb-2">{job.title}</h2>
                            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
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
                        </CardContent>
                    </Card>
                )}

                {/* Application Form */}
                <Card className="shadow-none">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Briefcase className="w-5 h-5" />
                            Application Form
                        </CardTitle>
                        <CardDescription>
                            Fill out the form below and we&apos;ll get back to you.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Name */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="Jane Doe"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                    minLength={2}
                                />
                            </div>

                            {/* Email */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Email <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="jane@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Phone
                                </label>
                                <input
                                    type="tel"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="+1 (555) 000-0000"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                />
                            </div>

                            {/* Resume Upload */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Resume <span className="text-muted-foreground font-normal">(PDF or Word, max 3 MB)</span>
                                </label>
                                {resumeFile ? (
                                    <div className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
                                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                                        <span className="truncate flex-1">{resumeFile.name}</span>
                                        <span className="text-xs text-muted-foreground shrink-0">
                                            {(resumeFile.size / 1024).toFixed(0)} KB
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setResumeFile(null)}
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-3 py-4 text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors">
                                        <Upload className="w-4 h-4" />
                                        Click to upload resume
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".pdf,.doc,.docx"
                                            onChange={handleResumeChange}
                                        />
                                    </label>
                                )}
                                {resumeError && (
                                    <p className="text-xs text-red-600 mt-1">{resumeError}</p>
                                )}
                            </div>

                            {/* LinkedIn */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    LinkedIn Profile
                                </label>
                                <input
                                    type="url"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    placeholder="https://linkedin.com/in/janedoe"
                                    value={linkedinUrl}
                                    onChange={(e) => setLinkedinUrl(e.target.value)}
                                />
                            </div>

                            {/* How did you hear about us */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    How did you hear about us?
                                </label>
                                <Select value={source} onValueChange={setSource}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="website">Website</SelectItem>
                                        <SelectItem value="linkedin">LinkedIn</SelectItem>
                                        <SelectItem value="referral">Referral</SelectItem>
                                        <SelectItem value="job-board">Job Board</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Referred by (conditional) */}
                            {source === "referral" && (
                                <div>
                                    <label className="text-sm font-medium mb-1.5 block">
                                        Referred by
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        placeholder="Name of the person who referred you"
                                        value={referredBy}
                                        onChange={(e) => setReferredBy(e.target.value)}
                                    />
                                </div>
                            )}

                            {/* Message */}
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Tell us about yourself
                                </label>
                                <textarea
                                    className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                                    placeholder="What interests you about enterprise? What skills and experience do you bring?"
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                />
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    {error}
                                </div>
                            )}

                            {/* Submit */}
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={!isValid || submitting}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-4 h-4 mr-2" />
                                        Submit Application
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground text-center mt-6">
                    By submitting this form you agree to be contacted by enterprise regarding
                    employment opportunities.
                </p>
            </div>
        </div>
    );
}
