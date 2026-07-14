import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import {
	type UpdateLoopInput,
	UpdateLoopInputSchema,
	type StatusHistoryRecord,
} from "src/shared/validation/loop.schema";
import { sendEmail } from "src/functions/shared/email";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";

const _handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	const logger = createLogger("update-loop", context);
	const { loopId } = event.pathParameters ?? {};

	if (!loopId) {
		logger.warn("Missing loopId");
		return err("Missing loopId", 400);
	}

	let body: any;
	try {
		body = JSON.parse(event.body || "{}");
	} catch (e) {
		logger.error("Failed to parse JSON", { error: e });
		return err("Invalid JSON", 400);
	}

	let input: UpdateLoopInput;
	try {
		input = UpdateLoopInputSchema.parse({ ...body, loop_id: loopId });
	} catch (e) {
		logger.warn("Validation error", { error: e });
		return err("Validation Error", 400);
	}

	try {
		const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);

		// Get existing loop to check for status changes
		const existing = await repo.getById(loopId);
		if (!existing) {
			logger.warn("Loop not found", { loop_id: loopId });
			return err("Loop not found", 404);
		}

		const now = new Date().toISOString();

		// Remove status_comment and loop_id from destructuring
		const { status_comment, loop_id: _, ...updateFields } = input;

		const updatedBy = resolveActorEmail(event, body.updated_by);

		// Prepare base update data with explicit loop_id
		let updateData: any = {
			loop_id: loopId, // Explicitly required
			...updateFields,
			updated_by: updatedBy,
		};

		// Handle status history if status is changing
		if (input.status && input.status !== existing.status) {
			// Create new status history entry
			const statusHistoryEntry: StatusHistoryRecord = {
				status: input.status,
				changed_at: now,
				comment: input.status_comment!, // Required when status changes (enforced by schema)
			};

			// Append to existing history
			const updatedStatusHistory = [
				...(existing.progress_history || []),
				statusHistoryEntry,
			];

			// Add progress_history to update data
			updateData.progress_history = updatedStatusHistory;

			logger.info("Status changed", {
				loop_id: loopId,
				from: existing.status,
				to: input.status,
				comment: statusHistoryEntry.comment,
			});
		}

		// Perform the update
		const updated = await repo.update(updateData);

		// Send email to removed contributors
		// Send email to contributors with specific messaging
		if (input.contributors) {
			const currentEmails = new Set(input.contributors.map((c) => c.email));
			const previousContributors = existing.contributors || [];
			const previousEmails = new Set(previousContributors.map((c) => c.email));

			const loopTitle = existing.title;

			// 1. Identify Removed Contributors (In previous but NOT in current)
			const removedContributors = previousContributors.filter(
				(c) => !currentEmails.has(c.email)
			);

			if (removedContributors.length > 0) {
				const removedEmails = removedContributors.map((c) => c.email);
				await sendEmail({
					to: removedEmails,
					subject: `Removed from Loop: ${loopTitle}`,
					html: `<p>You have been removed as a contributor from the loop <strong>${loopTitle}</strong>.</p>
                 <p>You will no longer receive updates for this loop.</p>`,
				});
				logger.info("Sent removal emails", { removed: removedEmails });
			}

			// 2. Identify New Contributors (In current but NOT in previous)
			const newContributors = input.contributors.filter(
				(c) => !previousEmails.has(c.email)
			);

			if (newContributors.length > 0) {
				const newEmails = newContributors.map((c) => c.email);
				await sendEmail({
					to: newEmails,
					subject: `New Loop Assigned: ${loopTitle}`,
					html: `<p>You have been added as a contributor to the loop <strong>${loopTitle}</strong>.</p>
                 <p>Status: ${input.status || existing.status}</p>
                 <p>Description: ${input.description || existing.description || "N/A"}</p>
                 <p>Please check the dashboard for details.</p>`,
				});
				logger.info("Sent welcome emails", { new: newEmails });
			}

			// 3. Identify Existing (Remaining) Contributors (In BOTH)
			const existingContributors = input.contributors.filter(
				(c) => previousEmails.has(c.email)
			);

			if (existingContributors.length > 0) {
				const existingEmails = existingContributors.map((c) => c.email);
				await sendEmail({
					to: existingEmails,
					subject: `Loop Updated: ${loopTitle}`,
					html: `<p>The loop <strong>${loopTitle}</strong> has been updated.</p>
               <p>Status: ${input.status || existing.status}</p>
               <p>Please check the dashboard for details.</p>`,
				});
				logger.info("Sent update emails", { existing: existingEmails });
			}
		}

		logger.info("Loop updated successfully", { loop_id: loopId });
		return ok(updated);
	} catch (e: any) {
		logger.error("Internal Server Error", { error: e.message, stack: e.stack });
		return err("Internal Server Error");
	}
};

export const handler = withPermissions(_handler);