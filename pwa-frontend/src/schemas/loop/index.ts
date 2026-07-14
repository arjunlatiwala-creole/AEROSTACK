import { LOOP_CATEGORIES, LOOP_STATUSES, LOOP_TYPES } from "@enterprise/common";
import { z } from "zod";

export const loopFormSchema = z.object({
	title: z.string().min(1, "Title is required"),
	description: z.string().optional(),
	loop_type: z.enum(LOOP_TYPES),
	category: z.enum(LOOP_CATEGORIES),
	owner_email: z.email("Invalid email"),
	target_completion_date: z.string("Select a date").min(1, "Date is required"),
	priority: z.coerce.number(),
	status: z.enum(LOOP_STATUSES).optional(),
	status_comment: z.string().optional(),
	contributors_input: z.array(z.string()).optional(), // array of emails
	tags: z.array(z.string()).optional(),
	// jira_key: z.string().optional(),
});

export type LoopFormData = z.infer<typeof loopFormSchema>;
