import type { AerostackLoops } from "@enterprise/common";

type CreateLoopInput = AerostackLoops.CreateLoopInput;
type UpdateLoopInput = AerostackLoops.UpdateLoopInput;
type ScoreOutcomeInput = AerostackLoops.ScoreOutcomeInput;
type AdaptLoopInput = AerostackLoops.AdaptLoopInput;
type BulkAssignInput = AerostackLoops.BulkAssignInput;
type BulkAssignResponse = AerostackLoops.BulkAssignResponse;
type GoogleWorkspaceGroup = AerostackLoops.GoogleWorkspaceGroup;

import { aerostackApiClient } from "@/api/client";

export const searchDeelPeople = async (q: string) => {
  const res = await aerostackApiClient.get(`/loops/deel-people/search?q=${q}`);
  return res.data.data;
};

export const createLoop = async (loopData: CreateLoopInput) => {
  const response = await aerostackApiClient.post("/loops", loopData);
  return response.data;
};

export const getLoops = async (params = {}) => {
  const response = await aerostackApiClient.get("/loops", { params });
  return response.data;
};

export const getLoopById = async (loopId: string) => {
  const response = await aerostackApiClient.get(`/loops/${loopId}`);
  return response.data.data;
};

export const updateLoop = async (
  loopId: string,
  updateData: Partial<UpdateLoopInput>,
) => {
  const response = await aerostackApiClient.patch(`/loops/${loopId}`, updateData);
  return response.data;
};

export const scoreLoopEffort = async (
  loopId: string,
  effortScore: number,
  updated_by?: string,
) => {
  const response = await aerostackApiClient.post(`/loops/${loopId}/score`, {
    effort_score: effortScore,
    updated_by,
  });
  return response.data;
};

export const scoreLoopOutcome = async (
  loopId: string,
  outcomeData: Omit<ScoreOutcomeInput, "loop_id">,
) => {
  const response = await aerostackApiClient.post(`/loops/${loopId}/score`, outcomeData);
  return response.data;
};

export const adaptLoop = async (
  loopId: string,
  transitionData: Omit<AdaptLoopInput, "loop_id">,
) => {
  const response = await aerostackApiClient.post(
    `/loops/${loopId}/adapt`,
    transitionData,
  );
  return response.data;
};

export const deleteLoop = async (loopId: string) => {
  const response = await aerostackApiClient.delete(`/loops/${loopId}`);
  return response.data;
};

export const addComment = async (
  loopId: string,
  data: {
    content: string;
    author_email?: string;
    author_name?: string;
    mentions?: string[];
    attachments?: Array<{
      file_name: string;
      file_url: string;
      file_type: string;
      file_size: number;
    }>;
  },
) => {
  const response = await aerostackApiClient.post(
    `/loops/${loopId}/comments`,
    data,
  );
  return response.data;
};

export const bulkAssignLearning = async (
  data: BulkAssignInput,
): Promise<BulkAssignResponse> => {
  const response = await aerostackApiClient.post("/loops/bulk-assign", data);
  return response.data.data;
};

export const getDeelPeopleCount = async (): Promise<number> => {
  const response = await aerostackApiClient.get("/loops/deel-people/count");
  return response.data.data.count;
};

export const listGoogleGroups = async (): Promise<GoogleWorkspaceGroup[]> => {
  const response = await aerostackApiClient.get("/loops/google-groups");
  return response.data.data ?? [];
};

let workspaceUsersCache: string[] | null = null;
let workspaceUsersPromise: Promise<string[]> | null = null;

export const listWorkspaceUsers = async (): Promise<string[]> => {
  if (workspaceUsersCache) return workspaceUsersCache;
  if (workspaceUsersPromise) return workspaceUsersPromise;

  const promise = aerostackApiClient.get("/loops/workspace-users")
    .then((response) => {
      const data = response.data.data ?? [];
      workspaceUsersCache = data;
      return data;
    })
    .catch((err) => {
      workspaceUsersPromise = null;
      throw err;
    });

  workspaceUsersPromise = promise;
  return promise;
};

let moodleCoursesCache: import("@enterprise/common").AerostackLoops.MoodleCourse[] | null = null;
let moodleCoursesCacheTime = 0;
let moodleCoursesPromise: Promise<import("@enterprise/common").AerostackLoops.MoodleCourse[]> | null = null;

export const clearMoodleCoursesCache = () => {
  moodleCoursesCache = null;
  moodleCoursesCacheTime = 0;
  moodleCoursesPromise = null;
};

export const getMoodleCoursesCache = () => moodleCoursesCache;

export const getMoodleCourses = async (forceRefresh = false): Promise<import("@enterprise/common").AerostackLoops.MoodleCourse[]> => {
  const isExpired = !moodleCoursesCacheTime || (Date.now() - moodleCoursesCacheTime > 5 * 60 * 1000);

  if (forceRefresh || isExpired) {
    moodleCoursesCache = null;
    moodleCoursesCacheTime = 0;
    moodleCoursesPromise = null;
  }
  if (moodleCoursesCache) return moodleCoursesCache;
  if (moodleCoursesPromise) return moodleCoursesPromise;

  const promise = aerostackApiClient.get("/loops/moodle-courses")
    .then((response) => {
      const data = response.data.data?.courses ?? [];
      moodleCoursesCache = data;
      moodleCoursesCacheTime = Date.now();
      return data;
    })
    .catch((err) => {
      moodleCoursesPromise = null;
      moodleCoursesCacheTime = 0;
      throw err;
    });

  moodleCoursesPromise = promise;
  return promise;
};

export const updateMoodleCourse = async (
  courseId: number,
  fullname?: string,
  summary?: string,
  hours?: string | number,
  categoryid?: number,
  startdate?: number,
  enddate?: number
): Promise<{ success: boolean }> => {
  const response = await aerostackApiClient.post("/loops/moodle-courses", {
    courseId,
    fullname,
    summary,
    hours,
    categoryid,
    startdate,
    enddate,
  });
  return response.data;
};
