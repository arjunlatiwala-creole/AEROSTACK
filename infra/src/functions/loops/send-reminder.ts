import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { z } from "zod";
import { createLogger } from "src/functions/shared/logger";
import { err, ok } from "src/functions/shared/response";
import { sendEmail } from "src/functions/shared/email";
import { withPermissions } from "../shared/permission-middleware";
import { resolveActorEmail } from "../shared/auth-utils";
import { LoopRepository } from "src/repos/loop.repository";
import { ddbClient } from "src/shared/dynamodb-client";

const ReminderInputSchema = z.object({
  to: z.string().email(),
  title: z.string().min(1),
  sender_email: z.string().email().optional(),
  loop_id: z.string().optional(),
});

const _handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  const logger = createLogger("send-reminder", context);

  try {
    const body = JSON.parse(event.body || "{}");
    const parsed = ReminderInputSchema.safeParse(body);
    if (!parsed.success) {
      return err("Invalid input: to (email) and title are required", 400);
    }

    const { to, title, sender_email, loop_id } = parsed.data;
    const sender = resolveActorEmail(event, sender_email);

    logger.info("Sending learning reminder", { to, title, sender, loop_id });

    await sendEmail({
      to: [to],
      subject: `Reminder: ${title}`,
      html: `
        <div style="background:#f3f4f6;padding:32px 16px;font-family:sans-serif;">
          <div style="background:#ffffff;border-radius:12px;max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #e5e7eb;">
            <!-- Header -->
            <div style="background:#185FA5;padding:28px 32px 24px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.08em;color:#B5D4F4;text-transform:uppercase;">Aerostack Learning</p>
              <h1 style="margin:0;font-size:22px;font-weight:600;color:#E6F1FB;line-height:1.3;">Learning Reminder</h1>
            </div>
            <!-- Body -->
            <div style="padding:28px 32px;">
              <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
                This is a friendly reminder about your pending learning requirement:
              </p>
              <!-- Assignment card -->
              <div style="border:1px solid #e5e7eb;border-left:3px solid #185FA5;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;background:#f9fafb;">
                <p style="margin:0;font-size:17px;font-weight:600;color:#111827;">${title}</p>
              </div>
              <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.6;">
                Please log in to Aerostack to complete this requirement.
              </p>
            </div>
            <!-- Footer -->
            <div style="border-top:1px solid #e5e7eb;padding:16px 32px;background:#f9fafb;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;line-height:1.6;">
                Log in to Aerostack to view and track your learning progress.
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Sent by ${sender}
              </p>
            </div>
          </div>
        </div>
      `,
      text: `Reminder: You have a pending learning requirement "${title}". Please log in to Aerostack to complete it.`,
    });

    if (loop_id) {
      try {
        const repo = new LoopRepository(ddbClient, process.env.LOOPS_TABLE_NAME!);
        await repo.update({
          loop_id,
          last_reminder_sent: new Date().toISOString(),
          updated_by: sender,
        });
        logger.info("Updated last reminder timestamp on loop", { loop_id });
      } catch (dbErr) {
        logger.warn("Failed to update loop with last reminder timestamp", {
          loop_id,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
    }

    return ok({ sent: true, to, title });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    logger.error("Failed to send reminder", { error: message });
    return err("Failed to send reminder", 500);
  }
};

export const handler = withPermissions(_handler);
