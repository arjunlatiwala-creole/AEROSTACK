import { useState, useEffect, useCallback } from "react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Plus,
    Briefcase,
    Loader2,
    ExternalLink,
    Pencil,
    Copy,
} from "lucide-react";
import {
    listJobRecs,
    createJobRec,
    updateJobRec,
    type JobRec,
} from "@/api/hiring";

const STATUS_COLORS: Record<string, string> = {
    open: "bg-green-500",
    closed: "bg-gray-400",
    filled: "bg-blue-500",
    draft: "bg-yellow-500",
};

export default function JobRecsManager() {
    const [jobRecs, setJobRecs] = useState<JobRec[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingJob, setEditingJob] = useState<JobRec | null>(null);

    const loadJobRecs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listJobRecs();
            setJobRecs(res.data?.jobRecs ?? []);
        } catch (error) {
            console.error("Error loading job recs:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadJobRecs();
    }, [loadJobRecs]);

    const handleToggleStatus = async (job: JobRec) => {
        const newStatus = job.status === "open" ? "closed" : "open";
        try {
            await updateJobRec(job.jobRecId, { status: newStatus });
            await loadJobRecs();
        } catch (error) {
            console.error("Error updating job status:", error);
        }
    };

    const copyApplyLink = (jobRecId: string) => {
        const url = `${window.location.origin}/jobs/${jobRecId}`;
        navigator.clipboard.writeText(url);
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold">Job Postings</h3>
                <Button size="sm" onClick={() => { setEditingJob(null); setShowForm(true); }}>
                    <Plus className="w-4 h-4 mr-1" /> Create Job
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : jobRecs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No job postings yet</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {jobRecs.map((job) => (
                        <Card key={job.jobRecId} className="shadow-none">
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium text-sm">{job.title}</span>
                                            <Badge variant="secondary" className="text-[10px]">
                                                <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[job.status] ?? "bg-gray-400"} mr-1`} />
                                                {job.status}
                                            </Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {job.department} · {job.location} · {job.jobType}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            title="Copy apply link"
                                            onClick={() => copyApplyLink(job.jobRecId)}
                                        >
                                            <Copy className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            title="Open public page"
                                            onClick={() => window.open(`/jobs/${job.jobRecId}`, "_blank")}
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleToggleStatus(job)}
                                        >
                                            {job.status === "open" ? "Close" : "Reopen"}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <CreateJobDialog
                open={showForm}
                onClose={() => setShowForm(false)}
                onCreated={loadJobRecs}
            />
        </div>
    );
}

/* ─── Create Job Dialog ─── */

function CreateJobDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
}) {
    const [title, setTitle] = useState("");
    const [department, setDepartment] = useState("");
    const [location, setLocation] = useState("Remote");
    const [jobType, setJobType] = useState("full-time");
    const [description, setDescription] = useState("");
    const [requirements, setRequirements] = useState("");
    const [responsibilities, setResponsibilities] = useState("");
    const [salaryRange, setSalaryRange] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const isValid = title.trim().length > 0 && department.trim().length > 0;

    const handleSubmit = async () => {
        if (!isValid) return;
        setSubmitting(true);
        try {
            await createJobRec({
                title: title.trim(),
                department: department.trim(),
                location: location.trim() || "Remote",
                jobType,
                description: description.trim(),
                requirements: requirements
                    .split("\n")
                    .map((r) => r.trim())
                    .filter(Boolean),
                responsibilities: responsibilities
                    .split("\n")
                    .map((r) => r.trim())
                    .filter(Boolean),
                salaryRange: salaryRange.trim() || undefined,
            });
            // Reset
            setTitle("");
            setDepartment("");
            setLocation("Remote");
            setJobType("full-time");
            setDescription("");
            setRequirements("");
            setResponsibilities("");
            setSalaryRange("");
            onClose();
            onCreated();
        } catch (error) {
            console.error("Error creating job:", error);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Job Posting</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Job Title <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="e.g. Senior Cloud Architect"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Department <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="e.g. Engineering"
                            value={department}
                            onChange={(e) => setDepartment(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">Location</label>
                            <input
                                type="text"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                placeholder="Remote"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Job Type</label>
                            <Select value={jobType} onValueChange={setJobType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="full-time">Full-time</SelectItem>
                                    <SelectItem value="part-time">Part-time</SelectItem>
                                    <SelectItem value="contract">Contract</SelectItem>
                                    <SelectItem value="internship">Internship</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Salary Range
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            placeholder="e.g. $120K - $160K"
                            value={salaryRange}
                            onChange={(e) => setSalaryRange(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Description
                        </label>
                        <textarea
                            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                            placeholder="Describe the role..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Requirements{" "}
                            <span className="text-muted-foreground font-normal">
                                (one per line)
                            </span>
                        </label>
                        <textarea
                            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                            placeholder={"5+ years cloud architecture experience\nAWS certifications preferred\nStrong communication skills"}
                            value={requirements}
                            onChange={(e) => setRequirements(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium mb-1 block">
                            Responsibilities{" "}
                            <span className="text-muted-foreground font-normal">
                                (one per line)
                            </span>
                        </label>
                        <textarea
                            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                            placeholder={"Design cloud-native architectures\nMentor junior engineers\nLead technical discovery sessions"}
                            value={responsibilities}
                            onChange={(e) => setResponsibilities(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isValid || submitting}>
                        {submitting ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <Plus className="w-4 h-4 mr-1" />
                        )}
                        Create Job
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
