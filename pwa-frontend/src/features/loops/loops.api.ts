import type {
	AddTagsRequest,
	CreateLoopRequest,
	DeliveryStatus,
	LearningLoop,
	Loop,
	LoopListParams,
	OpportunityPrioritization,
	PaginatedResponse,
	PersonDashboard,
	ScoreEffortRequest,
	ScoreOutcomeRequest,
	TagCloudItem,
	UpdateLoopRequest,
} from "@enterprise/common";
import { logAction } from "../../lib/logger";
import { executable } from "../../lib/squidClient";
import { aerostackApiClient } from "../../api/client";

export async function listLoops(params?: LoopListParams): Promise<Loop[]> {
	const fn = executable("AerostackService", "listLoops");
	const res = await fn(params || {});
	return (res?.data || []) as any;
}

export async function createLoop(req: CreateLoopRequest) {
	const fn = executable("AerostackService", "createLoop");
	const t0 = performance.now();
	const res = await fn(req);
	logAction("createLoop", "success", { latency_ms: performance.now() - t0 });
	return res;
}

export async function scoreOutcome(req: ScoreOutcomeRequest) {
	const fn = executable("AerostackService", "scoreOutcome");
	return fn(req);
}

export async function scoreEffort(req: ScoreEffortRequest) {
	const fn = executable("AerostackService", "scoreEffort");
	return fn(req);
}

export async function updateLoop(req: UpdateLoopRequest) {
	const fn = executable("AerostackService", "updateLoop");
	return fn(req);
}

export async function addTags(req: AddTagsRequest) {
	const fn = executable("AerostackService", "addTags");
	return fn(req);
}

export async function listOpportunityPrioritization(): Promise<
	OpportunityPrioritization[]
> {
	const fn = executable("AerostackService", "listOpportunityPrioritization");
	return fn();
}

export async function listDeliveryStatus(): Promise<DeliveryStatus[]> {
	const fn = executable("AerostackService", "listDeliveryStatus");
	return fn();
}

export async function listLearningLoops(): Promise<LearningLoop[]> {
	try {
		const response = await aerostackApiClient.get('/loops/learning-with-people');
		// Map the response to match the expected LearningLoop format
		const items = response.data?.data?.items || [];
		return items.map((item: any) => ({
			loop_id: item.loop_data.loop_id,
			title: item.loop_data.title,
			owner_email: item.loop_data.owner_email,
			owner_name: item.deel_person ? `${item.deel_person.given_name || ''} ${item.deel_person.family_name || ''}`.trim() : undefined,
			outcome_score: item.loop_data.outcome_score,
			lesson_tags: item.loop_data.lesson?.tags || [],
			description: item.loop_data.description,
			status: item.loop_data.status,
			phase: item.loop_data.phase,
		}));
	} catch (error) {
		console.error('Error fetching learning loops:', error);
		return [];
	}
}

export async function getPersonDashboardByEmail(
	email: string,
): Promise<PersonDashboard> {
	const fn = executable("AerostackService", "getPersonDashboardByEmail");
	return fn(email);
}

export async function getTagCloud(): Promise<TagCloudItem[]> {
	const fn = executable("AerostackService", "getTagCloud");
	return fn();
}

export async function adaptLoop(req: import("@enterprise/common").AdaptLoopRequest) {
	const fn = executable("AerostackService", "adaptLoop");
	return fn(req);
}
