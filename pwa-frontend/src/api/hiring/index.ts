import { hiringApiClient } from "@/api/client";

export type ReferralType = "personal" | "network" | "stranger";

export interface Candidate {
    candidateId: string;
    name: string;
    email: string;
    phone: string | null;
    source: string;
    referredBy: string | null;
    referralType: ReferralType | null;
    jobRecId: string;
    stage: string;
    stageHistory: StageHistoryEntry[];
    exitReason: string | null;
    recycleDate: string | null;
    ndaSigned: boolean;
    ndaSignedAt: string | null;
    teamFitScore: number | null;
    teamFitInterviewer: string | null;
    skillsFitScore: number | null;
    skillsFitInterviewer: string | null;
    proposalSentAt: string | null;
    offerSentAt: string | null;
    deelEmployeeId: string | null;
    googleWorkspaceEmail: string | null;
    onboardingAssigned: boolean;
    ownerId: string | null;
    resumeUrl: string | null;
    resumeS3Key: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface StageHistoryEntry {
    stage: string;
    enteredAt: string;
    actor: string;
}

export interface CandidateNote {
    candidateId: string;
    noteId: string;
    authorId: string;
    authorName: string;
    noteType: string;
    content: string;
    createdAt: string;
}

export interface PipelineMetrics {
    totalCandidates: number;
    totalActive: number;
    totalExited: number;
    totalHired: number;
    byStage: Record<string, number>;
}

export const listCandidates = async (params?: {
    stage?: string;
    jobRecId?: string;
    limit?: number;
    cursor?: string;
}) => {
    const response = await hiringApiClient.get("/people-ops/hiring/candidates", {
        params,
    });
    return response.data;
};

export const createCandidate = async (payload: {
    name: string;
    email: string;
    phone?: string;
    source?: string;
    referredBy?: string;
    referralType?: ReferralType;
    jobRecId?: string;
    ownerId?: string;
    submittedBy?: string;
    notes?: string;
}) => {
    const response = await hiringApiClient.post(
        "/people-ops/hiring/candidates",
        payload,
    );
    return response.data;
};

export const getCandidate = async (candidateId: string) => {
    const response = await hiringApiClient.get(
        `/people-ops/hiring/candidates/${candidateId}`,
    );
    return response.data;
};

export const updateCandidate = async (
    candidateId: string,
    payload: Partial<Candidate>,
) => {
    const response = await hiringApiClient.put(
        `/people-ops/hiring/candidates/${candidateId}`,
        payload,
    );
    return response.data;
};

export const advanceStage = async (
    candidateId: string,
    payload: { stage: string; actor?: string; recycleDate?: string },
) => {
    const response = await hiringApiClient.post(
        `/people-ops/hiring/candidates/${candidateId}/advance-stage`,
        payload,
    );
    return response.data;
};

export const createNote = async (
    candidateId: string,
    payload: {
        content: string;
        noteType?: string;
        authorId?: string;
        authorName?: string;
    },
) => {
    const response = await hiringApiClient.post(
        `/people-ops/hiring/candidates/${candidateId}/notes`,
        payload,
    );
    return response.data;
};

export const getPipelineMetrics = async () => {
    const response = await hiringApiClient.get(
        "/people-ops/hiring/pipeline-metrics",
    );
    return response.data;
};

/**
 * Public application submission — no auth required.
 * Uses a raw axios instance (no Cognito token interceptor).
 */
export const submitPublicApplication = async (payload: {
    name: string;
    email: string;
    phone?: string;
    source?: string;
    referredBy?: string;
    linkedinUrl?: string;
    message?: string;
    jobRecId?: string;
    resumeS3Key?: string;
}) => {
    const baseUrl =
        import.meta.env.VITE_HIRING_BASE_URL || import.meta.env.VITE_BASE_URL;
    const response = await fetch(`${baseUrl}/people-ops/hiring/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error ?? "Failed to submit application");
    }
    return data;
};

/* ──────── Job Recs ──────── */

export interface JobRec {
    jobRecId: string;
    title: string;
    department: string;
    location: string;
    jobType: string;
    description: string;
    requirements: string[];
    responsibilities: string[];
    salaryRange: string | null;
    status: string;
    ownerId: string | null;
    createdAt: string;
    updatedAt: string;
}

/** Authenticated — admin list all job recs */
export const listJobRecs = async () => {
    const response = await hiringApiClient.get("/people-ops/hiring/job-recs");
    return response.data;
};

/** Authenticated — admin create job rec */
export const createJobRec = async (payload: {
    title: string;
    department: string;
    location?: string;
    jobType?: string;
    description?: string;
    requirements?: string[];
    responsibilities?: string[];
    salaryRange?: string;
}) => {
    const response = await hiringApiClient.post("/people-ops/hiring/job-recs", payload);
    return response.data;
};

/** Authenticated — admin update job rec */
export const updateJobRec = async (jobRecId: string, payload: Partial<JobRec>) => {
    const response = await hiringApiClient.put(`/people-ops/hiring/job-recs/${jobRecId}`, payload);
    return response.data;
};

/* ──────── Public Job Listings (no auth) ──────── */

const hiringBaseUrl = () =>
    import.meta.env.VITE_HIRING_BASE_URL || import.meta.env.VITE_BASE_URL;

/** Public — list open jobs */
export const fetchPublicJobs = async (): Promise<{ jobs: JobRec[]; count: number }> => {
    const response = await fetch(`${hiringBaseUrl()}/people-ops/hiring/jobs`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Failed to load jobs");
    return data.data;
};

/** Public — get single job */
export const fetchPublicJob = async (jobRecId: string): Promise<JobRec> => {
    const response = await fetch(`${hiringBaseUrl()}/people-ops/hiring/jobs/${jobRecId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Job not found");
    return data.data;
};

/* ──────── Resume Upload ──────── */

const MAX_RESUME_SIZE = 3 * 1024 * 1024; // 3 MB

/** Get a presigned S3 URL for resume upload, then upload the file directly */
export const uploadResume = async (
    file: File,
    email: string,
): Promise<string> => {
    if (file.size > MAX_RESUME_SIZE) {
        throw new Error("Resume must be 3 MB or smaller");
    }

    // 1. Get presigned URL
    const urlRes = await fetch(`${hiringBaseUrl()}/people-ops/hiring/resume-upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            email,
        }),
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlData.error ?? "Failed to get upload URL");

    const { uploadUrl, s3Key } = urlData.data;

    // 2. Upload directly to S3
    const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
    });

    if (!uploadRes.ok) {
        throw new Error("Failed to upload resume");
    }

    return s3Key;
};

/** Authenticated — get a presigned download URL for a candidate's resume */
export const getResumeDownloadUrl = async (s3Key: string): Promise<string> => {
    const response = await hiringApiClient.get("/people-ops/hiring/resume-download-url", {
        params: { s3Key },
    });
    return response.data.data.downloadUrl;
};
