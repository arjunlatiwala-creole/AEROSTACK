import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { ok, err } from "../shared/response";
import { withPermissions } from "../shared/permission-middleware";
import { sendEmail } from "../shared/email";

const TABLE = process.env.DOCUMENTS_TABLE_NAME;

if (!TABLE) throw new Error("DOCUMENTS_TABLE_NAME is required");

/**
 * Sends an access request email to the document owner.
 * Route: POST /documents/{documentId}/request-access
 */
const _handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const documentId = event.pathParameters?.documentId;
    if (!documentId) return err("documentId path parameter is required", 400);

    const body = JSON.parse(event.body ?? "{}");
    const requesterEmail: string | undefined = body.requester_email;
    const message: string | undefined = body.message;

    if (!requesterEmail) return err("requester_email is required", 400);

    // Get document to find owner
    const docResult = await ddbClient.send(
      new GetCommand({ TableName: TABLE, Key: { document_id: documentId } }),
    );

    if (!docResult.Item || docResult.Item.is_deleted) {
      return err("Document not found", 404);
    }

    const doc = docResult.Item;
    const ownerEmail = doc.owner_email as string;
    const docTitle = doc.title as string;

    if (!ownerEmail) return err("Document has no owner email", 400);

    const isDrive = doc.source_provider === "google_drive";
    const isCanva = doc.source_provider === "canva";
    
    let ctaUrl = `${process.env.FRONTEND_URL ?? "https://aerostack.enterprise.io"}/documents`;
    let ctaLabel = "Open Aerostack Dashboard";
    let instructions = `Open the document in Aerostack and click <strong>Share</strong> to grant access to <strong>${requesterEmail}</strong>.`;

    if ((isDrive || isCanva) && doc.source_url) {
      ctaUrl = doc.source_url;
      ctaLabel = isDrive ? "Open in Google Drive" : "Open in Canva";
      instructions = `Please open the document directly in ${isDrive ? "Google Drive" : "Canva"} to grant access to <strong>${requesterEmail}</strong>.`;
    } else if (doc.source_provider === "manual") {
      ctaUrl = `${process.env.FRONTEND_URL ?? "https://aerostack.enterprise.io"}/documents`;
      ctaLabel = "Open Aerostack Dashboard";
      instructions = `Please log in to Aerostack, locate this document on your dashboard, and use the <strong>Share</strong> button to grant access to <strong>${requesterEmail}</strong>.`;
    }

    // Send email to owner
    const emailResult = await sendEmail({
      to: [ownerEmail],
      subject: `📄 ${requesterEmail} requested access to "${docTitle}"`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e;padding:24px 32px;">
              <span style="color:#f59e0b;font-size:14px;font-weight:600;letter-spacing:0.5px;">Aerostack DOCUMENT HOST</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <!-- Avatar + Name -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="width:40px;height:40px;background:#f59e0b;border-radius:50%;text-align:center;vertical-align:middle;color:#fff;font-weight:600;font-size:16px;">
                    ${requesterEmail.charAt(0).toUpperCase()}
                  </td>
                  <td style="padding-left:12px;">
                    <div style="font-size:15px;font-weight:600;color:#1a1a2e;">${requesterEmail}</div>
                    <div style="font-size:12px;color:#888;">wants access to your document</div>
                  </td>
                </tr>
              </table>

              <!-- Document Card -->
              <div style="background:#f8f9fa;border:1px solid #e8e8e8;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Document</div>
                <div style="font-size:16px;font-weight:600;color:#1a1a2e;">📄 ${docTitle}</div>
              </div>

              ${message ? `
              <!-- Message -->
              <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;">
                <div style="font-size:11px;color:#888;margin-bottom:4px;">Message from requester</div>
                <div style="font-size:14px;color:#333;line-height:1.5;">"${message}"</div>
              </div>
              ` : ""}

              <!-- CTA -->
              <p style="font-size:14px;color:#555;line-height:1.6;margin-bottom:20px;">
                ${instructions}
              </p>

              <a href="${ctaUrl}" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;">
                ${ctaLabel} →
              </a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
              <p style="font-size:11px;color:#aaa;margin:0;">
                This is an automated notification from Aerostack Document Host. You received this because you own the document above.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      text: `${requesterEmail} is requesting access to "${docTitle}". Open Aerostack and use the Share button to grant access.`,
    });

    if (!emailResult.success) {
      console.warn(`[REQUEST-ACCESS] Email FAILED to ${ownerEmail} from ${requesterEmail} for doc=${documentId}: ${emailResult.error}`);
      return err("Could not notify the document owner", 502);
    }

    console.log(`[REQUEST-ACCESS] Email sent to ${ownerEmail} from ${requesterEmail} for doc=${documentId}`);

    return ok({ message: "Access request sent", owner_email: ownerEmail });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending access request:", error);
    return err(message, 500);
  }
};

export const handler = withPermissions(_handler);
