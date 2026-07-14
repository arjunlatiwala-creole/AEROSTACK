import { randomUUID } from "node:crypto";
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
  type CreateLoopInput,
  CreateLoopInputSchema,
  type StatusHistoryRecord,
} from "src/shared/validation/loop.schema";
import { sendEmail } from "src/functions/shared/email";
import { withPermissions } from "../shared/permission-middleware";
import { getCognitoUser, resolveActorEmail } from "../shared/auth-utils";

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("create-loop", context);

  try {
    let body: any;
    try {
      body = JSON.parse(event.body || "{}");
      Object.keys(body).forEach((key) => {
        if (body[key] === null) {
          delete body[key];
        }
      });
    } catch (e) {
      logger.error("Failed to parse JSON", { error: e });
      return err("Invalid JSON", 400);
    }

    let input: CreateLoopInput;
    try {
      input = CreateLoopInputSchema.parse(body);
    } catch (e: any) {
      logger.warn("Validation error", { errors: e.errors || e.message });
      return err("Validation Error", 400);
    }

    const now = new Date().toISOString();

    try {
      const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);
      const loopId = input.loop_id ?? randomUUID();
      const existing = await repo.getById(loopId);

      if (existing) {
        // Handle status history for updates
        let updatedStatusHistory = existing.progress_history || [];

        if (input.status && input.status !== existing.status) {
          const statusHistoryEntry: StatusHistoryRecord = {
            status: input.status,
            changed_at: now,
            comment: input.status_comment, // Required when status changes
          };
          updatedStatusHistory = [...updatedStatusHistory, statusHistoryEntry];
        }

        // Remove status_comment from input as it should only be in progress_history
        const { status_comment, loop_id, ...updateFields } = input;

        const updatedBy = resolveActorEmail(event, body.updated_by);

        const updated = await repo.update({
          loop_id: loopId, // Explicitly pass loop_id
          ...updateFields,
          progress_history: updatedStatusHistory,
          updated_by: updatedBy,
        });

        // Send email to contributors with specific messaging (moved from update-loop.ts)
        if (input.contributors) {
          const currentEmails = new Set(input.contributors.map((c) => c.email));
          const previousContributors = existing.contributors || [];
          const previousEmails = new Set(previousContributors.map((c) => c.email));

          const loopTitle = existing.title; // Use existing title (or input.title)

          // 1. Identify Removed Contributors
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

          // 2. Identify New Contributors
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
          // Only send update email if status changed
          const statusChanged = input.status && input.status !== existing.status;

          if (statusChanged) {
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
        }

        logger.info("Loop updated via create", { loop_id: loopId });
        return ok(updated);
      }

      // Create initial status history entry
      const initialStatus = input.status ?? "BACKLOG";
      const statusHistory: StatusHistoryRecord[] = [
        {
          status: initialStatus,
          changed_at: now,
          comment: input.status_comment, // Required field
        },
      ];

      // Remove status_comment from input as it should only be in progress_history
      const { status_comment, ...loopData } = input;

      const loop = {
        ...loopData,
        loop_id: loopId,
        created_at: now,
        updated_at: now,
        status: initialStatus,
        phase: "PROJECTION" as const,
        pillar: "CROSS" as const,
        priority: input.priority ?? 3,
        effort_score: undefined,
        outcome_score: undefined,
        loop_score: undefined,
        weighted_score: undefined,
        owner_name: undefined,
        contributors: input.contributors ?? undefined,
        lesson: undefined,
        adaptations: input.adaptations ?? undefined,
        progress_history: statusHistory,
        tags: input.tags ?? [],
        updated_by: resolveActorEmail(event, body.updated_by),
      };

      await repo.create(loop);

      // Send email to contributors
      if (loop.contributors && loop.contributors.length > 0) {
        const emailRecipients = loop.contributors.map(c => c.email);
        await sendEmail({
          to: emailRecipients,
          subject: `New Loop Assigned: ${loop.title}`,
          html: `<p>You have been added as a contributor to the loop <strong>${loop.title}</strong>.</p>
                 <p>Status: ${loop.status}</p>
                 <p>Description: ${loop.description || "N/A"}</p>
                 <p>Please check the dashboard for details.</p>`,
        });
      }

      logger.info("Loop created", { loop_id: loop.loop_id });
      return ok(loop, 201);
    } catch (e: any) {
      logger.error("Internal Server Error", {
        error: e.message,
        stack: e.stack,
      });
      return err("Internal Server Error");
    }
  } catch (e: any) {
    logger.error("Unexpected error in handler", {
      error: e.message,
      stack: e.stack,
    });
    return err("Internal Server Error", 500);
  }
};

export const handler = withPermissions(_handler);