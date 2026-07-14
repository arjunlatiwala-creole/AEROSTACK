import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";
import { sendEmail } from "src/functions/shared/email";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";
import { z } from "zod";

const AddCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  author_email: z.string().email().optional(),
  author_name: z.string().optional(),
  mentions: z.array(z.string().email()).optional(),
  attachments: z
    .array(
      z.object({
        file_name: z.string(),
        file_url: z.string().url(),
        file_type: z.string(),
        file_size: z.number().positive(),
      }),
    )
    .optional(),
});

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("add-comment", context);
  const { loopId } = event.pathParameters ?? {};

  if (!loopId) {
    logger.warn("Missing loopId");
    return err("Missing loopId", 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return err("Invalid JSON", 400);
  }

  const parsed = AddCommentSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Validation error", { error: parsed.error.flatten() });
    return err("Validation Error: " + parsed.error.issues[0]?.message, 400);
  }

  const input = parsed.data;
  const actorEmail = resolveActorEmail(event, input.author_email);

  try {
    const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);
    const existing = await repo.getById(loopId);

    if (!existing) {
      return err("Loop not found", 404);
    }

    const now = new Date().toISOString();
    const comment = {
      comment_id: randomUUID(),
      author_email: actorEmail,
      content: input.content,
      created_at: now,
      // Only include optional fields when they are defined — the DynamoDB
      // marshaller throws if undefined values are present in nested objects.
      ...(input.author_name !== undefined && {
        author_name: input.author_name,
      }),
      ...(input.mentions !== undefined && { mentions: input.mentions }),
      ...(input.attachments !== undefined && {
        attachments: input.attachments,
      }),
    };

    const updatedComments = [...(existing.comments || []), comment];

    await repo.update({
      loop_id: loopId,
      comments: updatedComments,
      updated_by: actorEmail,
    });

    logger.info("Comment added", {
      loop_id: loopId,
      comment_id: comment.comment_id,
      author: actorEmail,
    });

    // Send notification emails to mentioned people
    if (input.mentions && input.mentions.length > 0) {
      const mentionedEmails = input.mentions.filter(
        (email) => email !== actorEmail,
      );

      if (mentionedEmails.length > 0) {
        await sendEmail({
          to: mentionedEmails,
          subject: `You were mentioned in a comment on "${existing.title}"`,
          html: `
<div style="font-family: Arial, sans-serif; background-color: #f9fafb; padding: 30px; color: #1f2937;"> <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb;"> <!-- Header --> <div style="background: #facc15; padding: 20px 30px;"> <h2 style="margin: 0; color: #78350f; font-size: 22px;"> New Mention in Loop </h2> </div> <!-- Body --> <div style="padding: 30px;"> <p style="margin-top: 0; font-size: 15px; line-height: 1.6;"> <strong>${input.author_name || actorEmail}</strong> mentioned you in a comment on: </p> <div style="background: #f3f4f6; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px;"> <strong style="color: #111827; font-size: 16px;"> "${existing.title}" </strong> </div> <!-- Comment --> <div style="border-left: 4px solid #facc15; background: #fffbeb; padding: 16px 18px; border-radius: 6px; color: #374151; line-height: 1.6;"> ${input.content} </div> </div> <!-- Footer --> <div style="padding: 18px 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;"> <p style="margin: 0; color: #9ca3af; font-size: 12px;"> — Aerostack Loop System </p> </div> </div> </div>
					`,
          text: `${input.author_name || actorEmail} mentioned you in "${existing.title}": ${input.content}`,
        });

        logger.info("Mention notifications sent", {
          loop_id: loopId,
          mentioned: mentionedEmails,
        });
      }
    }

    return ok(comment, 201);
  } catch (e: any) {
    logger.error("Failed to add comment", {
      error: e.message,
      stack: e.stack,
    });
    return err("Internal Server Error");
  }
};

export const handler = withPermissions(_handler);
