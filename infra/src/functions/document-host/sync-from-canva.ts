import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "src/shared/dynamodb-client";
import { createHash } from "node:crypto";

const DOCS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const VERSIONS_TABLE = process.env.DOCUMENT_VERSIONS_TABLE_NAME!;
const BUCKET = process.env.DOCUMENT_BUCKET_NAME!;

const s3 = new S3Client({});

interface SyncResult {
  success: boolean;
  version_number?: number;
  error?: string;
  skipped?: boolean;
}

/**
 * Resolves canva.link short URLs to full canva.com URLs via HEAD redirect.
 */
async function resolveShortUrl(url: string): Promise<string> {
  // canva.link uses a 301 redirect — just follow it with HEAD
  const res = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
  });
  const location = res.headers.get("location");
  return location ?? url;
}

/**
 * Normalizes any Canva URL to the /view format with share token.
 *
 * Inputs:
 *   - https://canva.link/SHORTCODE → resolves redirect → full URL
 *   - https://www.canva.com/design/{id}/{token}/edit?... → /view
 *   - https://www.canva.com/design/{id}/{token}/view → as-is
 */
async function normalizeToViewUrl(input: string): Promise<{ viewUrl: string; designId: string } | undefined> {
  let url = input.trim();

  // Resolve canva.link short URLs
  if (url.includes("canva.link")) {
    url = await resolveShortUrl(url);
  }

  // Extract design ID and share token
  // Pattern: /design/{designId}/{shareToken}/{action}
  const match = url.match(/\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(edit|view)/);
  if (match) {
    return {
      viewUrl: `https://www.canva.com/design/${match[1]}/${match[2]}/view?mode=preview`,
      designId: match[1]!,
    };
  }

  // Pattern: /design/{designId}/{shareToken} (no action)
  const noAction = url.match(/\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?(\?|$)/);
  if (noAction) {
    return {
      viewUrl: `https://www.canva.com/design/${noAction[1]}/${noAction[2]}/view?mode=preview`,
      designId: noAction[1]!,
    };
  }

  // Pattern: /design/{designId}/view
  const viewOnly = url.match(/\/design\/([A-Za-z0-9_-]+)\/view/);
  if (viewOnly) {
    return { viewUrl: url.split("?")[0] + "?mode=preview", designId: viewOnly[1]! };
  }

  return undefined;
}

/**
 * Fetches the Canva public view page and extracts the presigned image URL.
 *
 * Strategy:
 * - Fetch the /view page with a search engine bot User-Agent (bypasses Cloudflare)
 * - Parse the HTML for presigned S3 URLs on document-export.canva.com
 * - These URLs are the actual rendered design images (no further auth needed)
 */
async function fetchDesignImageUrl(viewUrl: string): Promise<string | undefined> {
  const res = await fetch(viewUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Accept": "text/html",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[SYNC-CANVA] View page fetch failed: ${res.status}, headers=${JSON.stringify(Object.fromEntries(res.headers.entries()))}, body=${body.slice(0, 500)}`);
    return undefined;
  }

  const html = await res.text();

  // Look for presigned S3 URLs on document-export.canva.com (preview > thumbnail)
  const previewMatch = html.match(
    /https:\/\/document-export\.canva\.com\/[^"'<>\s]+\/preview\/[^"'<>\s]+/,
  );
  if (previewMatch) {
    return decodeHtmlEntities(previewMatch[0]);
  }

  // Fallback: thumbnail version
  const thumbMatch = html.match(
    /https:\/\/document-export\.canva\.com\/[^"'<>\s]+\/thumbnail\/[^"'<>\s]+/,
  );
  if (thumbMatch) {
    return decodeHtmlEntities(thumbMatch[0]);
  }

  // Fallback: any presigned canva CDN URL
  const cdnMatch = html.match(
    /https:\/\/[a-z0-9-]+\.canva\.com\/[^"'<>\s]*X-Amz-Signature=[^"'<>\s]+/,
  );
  if (cdnMatch) {
    return decodeHtmlEntities(cdnMatch[0]);
  }

  return undefined;
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/**
 * Syncs a Canva design to S3 by fetching the rendered image from the public share link.
 * No Canva API auth required — uses the public view page + presigned CDN URLs.
 *
 * Supports:
 *   - canva.link short URLs
 *   - canva.com/design/.../edit URLs
 *   - canva.com/design/.../view URLs
 *   - Direct CDN image URLs
 */
export async function syncFromCanva(
  document: Record<string, unknown>,
): Promise<SyncResult> {
  const documentId = document.document_id as string;
  const sourceUrl = (document.source_url as string) ?? "";
  const sourceId = (document.source_id as string) ?? "";
  const ownerEmail = (document.owner_email as string) ?? (document.org_id as string);
  const currentVersion = (document.current_version as number) ?? 0;

  // Client-provided file data (fallback path from frontend)
  const fileDataBase64 = document._fileData as string | undefined;
  const fileMime = (document._fileMime as string) ?? "image/png";

  console.log(`[SYNC-CANVA] Starting sync for document=${documentId}, source_url=${sourceUrl}`);

  if (!sourceUrl && !sourceId && !fileDataBase64) {
    return { success: false, error: "No source URL — paste a Canva share link" };
  }

  try {
    let fileBuffer: Buffer;
    let mime: string;
    let designId = sourceId;

    if (fileDataBase64) {
      // Client sent file data directly (browser-side upload fallback)
      fileBuffer = Buffer.from(fileDataBase64, "base64");
      mime = fileMime;
      console.log(`[SYNC-CANVA] Using client-provided data: ${fileBuffer.length} bytes`);
    } else {
      const inputUrl = sourceUrl || sourceId;

      // Check if input is already a direct image URL
      const isDirectImage = /\.(png|jpg|jpeg|pdf|gif|svg|webp)(\?|$)/i.test(inputUrl)
        || inputUrl.includes("document-export.canva.com");

      if (isDirectImage) {
        console.log(`[SYNC-CANVA] Direct image URL, fetching...`);
        const res = await fetch(inputUrl, { redirect: "follow" });
        if (!res.ok) {
          return { success: false, error: `Failed to download image: HTTP ${res.status}` };
        }
        fileBuffer = Buffer.from(await res.arrayBuffer());
        mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
      } else {
        // Normalize to /view URL and fetch the rendered design
        const normalized = await normalizeToViewUrl(inputUrl);
        if (!normalized) {
          return {
            success: false,
            error: "Could not parse URL. Accepted: canva.link/..., canva.com/design/.../edit, canva.com/design/.../view",
          };
        }

        designId = normalized.designId;
        console.log(`[SYNC-CANVA] Resolved: designId=${designId}, viewUrl=${normalized.viewUrl}`);

        // Fetch the presigned image URL from the view page
        const imageUrl = await fetchDesignImageUrl(normalized.viewUrl);
        if (!imageUrl) {
          return {
            success: false,
            error: "Could not extract design image from Canva. Ensure the design is shared as 'Anyone with the link'.",
          };
        }

        console.log(`[SYNC-CANVA] Got presigned image URL: ${imageUrl.slice(0, 100)}...`);

        // Download the actual image from the presigned URL
        const imgRes = await fetch(imageUrl, { redirect: "follow" });
        if (!imgRes.ok) {
          return { success: false, error: `Image download failed: HTTP ${imgRes.status}` };
        }

        fileBuffer = Buffer.from(await imgRes.arrayBuffer());
        mime = imgRes.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
      }

      console.log(`[SYNC-CANVA] Downloaded: ${fileBuffer.length} bytes, mime=${mime}`);
    }

    if (fileBuffer.length < 1000) {
      return { success: false, error: "Downloaded content too small — not a valid design" };
    }

    // Determine extension
    const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg"
      : mime.includes("png") ? "png"
      : mime.includes("pdf") ? "pdf"
      : mime.includes("gif") ? "gif"
      : mime.includes("svg") ? "svg"
      : "png";

    // Hash for change detection
    const contentHash = createHash("sha256").update(fileBuffer).digest("hex");

    const storedHash = document.content_hash as string | undefined;
    if (currentVersion > 0 && storedHash === contentHash) {
      console.log(`[SYNC-CANVA] Content unchanged, skipping`);
      return { success: true, skipped: true, version_number: currentVersion };
    }

    // Upload to S3
    const nextVersion = currentVersion + 1;
    const designName = (document.title as string) ?? "design";
    const sanitizedName = `${designName}.${ext}`
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_");
    const ownerFolder = ownerEmail.toLowerCase().replace(/[^a-z0-9@._-]/g, "");
    const docSlug = ((document.slug as string) ?? "").split("/").pop() ?? "doc";
    const shortId = documentId.slice(0, 8);
    const s3Key = `${ownerFolder}/${docSlug}_${shortId}/v${nextVersion}_${sanitizedName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mime,
        Metadata: {
          "original-filename": encodeURIComponent(sanitizedName),
          "document-id": documentId,
          "canva-design-id": designId || "unknown",
        },
      }),
    );
    console.log(`[SYNC-CANVA] Uploaded to S3: ${s3Key} (${fileBuffer.length} bytes)`);

    // Create version record
    const now = new Date().toISOString();
    await ddbClient.send(
      new PutCommand({
        TableName: VERSIONS_TABLE,
        Item: {
          document_id: documentId,
          version_number: nextVersion,
          s3_key: s3Key,
          s3_version_id: "",
          file_size_bytes: fileBuffer.length,
          content_hash: contentHash,
          original_filename: sanitizedName,
          imported_at: now,
          imported_by: "canva-sync-agent",
        },
      }),
    );

    // Update document
    await ddbClient.send(
      new UpdateCommand({
        TableName: DOCS_TABLE,
        Key: { document_id: documentId },
        UpdateExpression:
          "SET current_version = :v, updated_at = :now, mime_type = :mt, content_hash = :ch",
        ExpressionAttributeValues: {
          ":v": nextVersion,
          ":now": now,
          ":mt": mime,
          ":ch": contentHash,
        },
      }),
    );

    console.log(`[SYNC-CANVA] ✅ Done: document=${documentId}, version=${nextVersion}`);
    return { success: true, version_number: nextVersion };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[SYNC-CANVA] ❌ Failed for document=${documentId}:`, error);
    return { success: false, error: message };
  }
}
