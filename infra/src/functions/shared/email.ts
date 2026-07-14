import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { createLogger } from "./logger";

const ses = new SESClient({ region: "us-east-1" });
// Use a fallback logger if context is not available, or just console
const logger = createLogger("email-service");

export interface SendEmailResult {
    success: boolean;
    error?: string;
    code?: string;
}

export const sendEmail = async ({
    to,
    subject,
    html,
    text,
    source = "aerostack-noreply@enterprise.io",
}: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
    source?: string;
}): Promise<SendEmailResult> => {
    if (!to.length) return { success: false, error: "No recipients" };

    // LOCAL DEV FALLBACK: If no AWS Credentials, just log the email
    if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
        console.log("==================================================================");
        console.log(" [LOCAL DEV] AWS Credentials not found. Mocking Email Send:");
        console.log(` To: ${to.join(", ")}`);
        console.log(` From: ${source}`);
        console.log(` Subject: ${subject}`);
        console.log(" --- Body ---");
        console.log(text || html);
        console.log("==================================================================");
        return { success: true };
    }

    try {
        const command = new SendEmailCommand({
            Destination: {
                ToAddresses: to,
            },
            Message: {
                Body: {
                    Html: { Data: html },
                    Text: { Data: text || html }, // Fallback to html if text not provided (SES requires string)
                },
                Subject: { Data: subject },
            },
            Source: source,
        });

        await ses.send(command);
        logger.info("Email sent successfully", { to, subject });
        return { success: true };
    } catch (error: any) {
        // Log detailed error for debugging
        console.error("SES SEND FAILURE DETAIL:", JSON.stringify(error, null, 2));
        logger.error("Failed to send email", {
            message: error.message,
            code: error.code,
            requestId: error.$metadata?.requestId,
            to,
            subject
        });
        // Don't throw — keep app flow intact. Caller can inspect the result.
        return {
            success: false,
            error: error?.message ?? "Unknown SES error",
            code: error?.name ?? error?.code,
        };
    }
};
