import { useState, useEffect, useCallback, useRef } from "react";
import {
  FileText, Plus, Upload, Download, Share2, Trash2, Eye,
  Globe, Lock, Users, Search, Loader2, Copy, ExternalLink,
  History, Link2, Pencil, RefreshCw, LayoutList, LayoutGrid,
  ShieldCheck, PenSquare, CheckCircle2, Clock, AlertCircle, XCircle, Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { jsPDF } from "jspdf";
import Loader from "@/components/Loader";
import DriveConnectPanel from "@/components/aerostack/DriveConnectPanel";
import { FieldMapEditor } from "@/components/aerostack/FieldMapEditor";
import { useAuth } from "@/context/auth/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { fetchAuthSession } from "aws-amplify/auth";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { pdfjs } from "react-pdf";
import {
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getUploadUrl,
  confirmUpload,
  getDownloadUrl,
  getVersions,
  shareDocument,
  revokeAccess,
  listAccess,
  checkBatchAccess,
  getShareLink,
  requestAccess,
  triggerSync,
  resolveCanvaLink,
  fetchCanvaProxyHtml,
  createDocuSignEnvelope,
  listDocuSignEnvelopes,
  getDocuSignSigningUrl,
  getSignedEnvelopeDownload,
  type AosDocument,
  type DocumentVersion,
  type DocumentAccess,
  type CreateDocumentRequest,
  type UpdateDocumentRequest,
  type DocuSignEnvelope,
  type DocuSignSigner,
  type IntakeFormField,
  type FieldMarker,
} from "@/api/document-host";


const VISIBILITY_ICONS = {
  public: <Globe className="w-3 h-3" />,
  internal: <Users className="w-3 h-3" />,
  restricted: <Lock className="w-3 h-3" />,
};

const VISIBILITY_COLORS = {
  public: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  internal: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  restricted: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Result of fetching a Canva design — a file blob with its proper extension. */
interface CanvaFetchResult {
  blob: Blob;
  ext: "png" | "pdf";
  mime: string;
}

/** Export format the user wants for a Canva design. */
type CanvaExportFormat = "pdf" | "png" | "upload";

/** Loads an image URL into an HTMLImageElement to read its dimensions. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Combines multiple page image blobs into a single PDF using jsPDF.
 * Each page is sized to match its image dimensions.
 */
async function imagesToPdf(imageBlobs: Blob[]): Promise<Blob> {
  let pdf: jsPDF | null = null;

  for (const blob of imageBlobs) {
    const dataUrl = await blobToDataUrl(blob);
    const img = await loadImage(dataUrl);
    const orientation = img.width >= img.height ? "landscape" : "portrait";

    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: "px", format: [img.width, img.height] });
    } else {
      pdf.addPage([img.width, img.height], orientation);
    }
    pdf.addImage(dataUrl, "PNG", 0, 0, img.width, img.height);
  }

  if (!pdf) throw new Error("No pages to render");
  return pdf.output("blob");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getMimeType(fileName: string, browserMime?: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc": return "application/msword";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "ppt": return "application/vnd.ms-powerpoint";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls": return "application/vnd.ms-excel";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "md": return "text/markdown";
    case "txt": return "text/plain";
    default: return browserMime && browserMime.trim() !== "" ? browserMime : "application/octet-stream";
  }
}

/**
 * Fetches a Canva design via the backend Canva proxy (Lambda).
 *
 * - Single-page design → returns the high-res preview PNG
 * - Multi-page design → fetches all page thumbnails, combines into a single PDF
 *
 * The backend proxies Canva with a Googlebot UA (bypasses Cloudflare), so this
 * works identically in local dev and deployed environments.
 */
async function fetchCanvaDesignClientSide(
  sourceUrl: string,
  exportFormat: CanvaExportFormat = "pdf",
): Promise<CanvaFetchResult | null> {
  try {
    let designPath = "";

    if (sourceUrl.includes("canva.link")) {
      const shortCode = sourceUrl.replace(/https?:\/\/canva\.link\/?/, "");
      console.log(`[CANVA-CLIENT] Resolving canva.link/${shortCode}`);

      let location: string;
      try {
        ({ location } = await resolveCanvaLink(shortCode));
      } catch (e) {
        console.warn(`[CANVA-CLIENT] Resolve failed:`, e);
        return null;
      }
      console.log(`[CANVA-CLIENT] Resolved to: ${location}`);

      const match = location.match(/\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(edit|view)/);
      if (match) {
        designPath = `/design/${match[1]}/${match[2]}/view?mode=preview`;
      } else {
        console.warn(`[CANVA-CLIENT] Could not parse design path from: ${location}`);
        return null;
      }
    } else {
      const match = sourceUrl.match(/\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(edit|view)/);
      if (match) {
        designPath = `/design/${match[1]}/${match[2]}/view?mode=preview`;
      } else {
        const simpleMatch = sourceUrl.match(/\/design\/([A-Za-z0-9_-]+)/);
        if (simpleMatch) {
          designPath = `/design/${simpleMatch[1]}/view?mode=preview`;
        }
      }
      if (!designPath) return null;
    }

    console.log(`[CANVA-CLIENT] Fetching design page: ${designPath}`);
    let html: string;
    try {
      ({ html } = await fetchCanvaProxyHtml(designPath));
    } catch (e) {
      console.warn(`[CANVA-CLIENT] Page fetch failed:`, e);
      return null;
    }
    console.log(`[CANVA-CLIENT] HTML size: ${html.length}`);

    // Determine page count
    const pageCountMatch = html.match(/"pageCount"\s*:\s*(\d+)/);
    const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 1;
    console.log(`[CANVA-CLIENT] Page count: ${pageCount}`);

    // Collect all presigned export URLs from the HTML
    const allUrls = html.match(/https:\/\/document-export\.canva\.com\/[^"'<>\s]+/g) ?? [];
    const decodedUrls = allUrls.map((u) => u.replace(/&amp;/g, "&"));

    // Helper to find a page URL by number, preferring high-res preview over thumbnail
    const findPageUrl = (pageNum: number): string | undefined => {
      const padded = String(pageNum).padStart(4, "0");
      const preview = decodedUrls.find((u) => u.includes(`/preview/${padded}.`));
      const thumbnail = decodedUrls.find((u) => u.includes(`/thumbnail/${padded}.`));
      return preview ?? thumbnail;
    };

    if (pageCount <= 1 && exportFormat === "png") {
      // Single page, user chose PNG — download the preview image directly
      const url = findPageUrl(1);
      if (!url) {
        console.warn(`[CANVA-CLIENT] No image URL found`);
        return null;
      }
      console.log(`[CANVA-CLIENT] Downloading single page as PNG...`);
      const imgRes = await fetch(url);
      if (!imgRes.ok) return null;
      const blob = await imgRes.blob();
      return { blob, ext: "png", mime: "image/png" };
    }

    // Multi-page — download all pages and combine into PDF
    console.log(`[CANVA-CLIENT] Downloading ${pageCount} pages...`);
    const pageBlobs: Blob[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const url = findPageUrl(i);
      if (!url) {
        console.warn(`[CANVA-CLIENT] Missing page ${i}, skipping`);
        continue;
      }
      const imgRes = await fetch(url);
      if (imgRes.ok) {
        pageBlobs.push(await imgRes.blob());
      }
    }

    if (pageBlobs.length === 0) return null;

    console.log(`[CANVA-CLIENT] Combining ${pageBlobs.length} pages into PDF...`);
    const pdfBlob = await imagesToPdf(pageBlobs);
    return { blob: pdfBlob, ext: "pdf", mime: "application/pdf" };
  } catch (e) {
    console.error(`[CANVA-CLIENT] Error:`, e);
    return null;
  }
}

/** Maps raw error messages to user-friendly text */
function friendlyError(err: unknown, fallback: string): string {
  // Prioritize detailed backend error messages if available
  if (err && typeof err === "object") {
    const axiosErr = err as any;
    const serverMsg = axiosErr.response?.data?.error || axiosErr.response?.data?.message;
    if (serverMsg && typeof serverMsg === "string") {
      return serverMsg;
    }
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch"))
    return "Unable to connect to the server. Please check your internet connection and try again.";
  if (lower.includes("401") || lower.includes("unauthorized"))
    return "Your session has expired. Please sign in again.";
  if (lower.includes("403") || lower.includes("forbidden"))
    return "You don't have permission to perform this action.";
  if (lower.includes("404") || lower.includes("not found"))
    return "The item you're looking for no longer exists or has been moved.";
  if (lower.includes("409") || lower.includes("already in use") || lower.includes("conflict"))
    return raw.includes("Slug") ? "That URL slug is already taken. Please choose a different one." : "A conflict occurred. The item may have been modified by someone else.";
  if (lower.includes("413") || lower.includes("too large"))
    return "The file is too large. Please try a smaller file.";
  if (lower.includes("429") || lower.includes("rate limit"))
    return "Too many requests. Please wait a moment and try again.";
  if (lower.includes("500") || lower.includes("internal server"))
    return "Something went wrong on our end. Please try again in a moment.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The request took too long. Please try again.";
  if (lower.includes("permission denied") || lower.includes("access denied"))
    return "Access denied. You may need to request permission from the document owner.";
  if (lower.includes("canva") && lower.includes("token"))
    return "Canva connection expired. Please reconnect your Canva account.";
  if (lower.includes("drive") && (lower.includes("token") || lower.includes("auth")))
    return "Google Drive connection issue. The sync will retry automatically.";

  return fallback;
}

/**
 * Opens a short-lived presigned S3 PDF URL.
 *
 * Browsers block `window.open` calls that happen after `await` because the
 * user-gesture context is lost — that's why "View Signed PDF" was silently
 * failing. Forcing an anchor click instead carries through the original gesture
 * AND lets us preserve a sensible filename when the user chooses Save.
 */
function openPresignedPdf(url: string, downloadName?: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (downloadName) a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function analyzeNdaPdf(pdfUrl: string): Promise<{
  signers: DocuSignSigner[];
  intakeFields: IntakeFormField[];
  fieldMarkers: FieldMarker[];
}> {
  const loadingTask = pdfjs.getDocument(pdfUrl);
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const signers: DocuSignSigner[] = [];
  const intakeFields: IntakeFormField[] = [];
  const fieldMarkers: FieldMarker[] = [];

  interface TextItemInfo {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const pagesText: Record<number, TextItemInfo[]> = {};
  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const items: TextItemInfo[] = [];
    for (const item of textContent.items as any[]) {
      if (item.str && item.str.trim()) {
        items.push({
          str: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        });
      }
    }
    pagesText[p] = items;
  }

  // Find signature page
  let sigPageNum = numPages;
  let maxSigLabels = 0;
  for (let p = 1; p <= numPages; p++) {
    const pageText = pagesText[p] || [];
    const hasAuditTrail = pageText.some(item => item.str.includes("Aerostack Signing Audit Trail"));
    if (hasAuditTrail) continue;

    const labels = pageText.filter(item =>
      /^name\b|printed name|typed name|title\b|office\b|position\b|^signature\b|^by\b|^date\b/i.test(item.str)
    );
    if (labels.length > maxSigLabels) {
      maxSigLabels = labels.length;
      sigPageNum = p;
    }
  }

  const sigItems = pagesText[sigPageNum] || [];

  const names = sigItems.filter(item => /^names?\b|printed name|typed name|name\s*:/i.test(item.str));
  const titles = sigItems.filter(item => /^titles?\b|office\b|position\b|role\b|title\s*:/i.test(item.str));
  const signatures = sigItems.filter(item => /^signatures?\b|^by\b|signature\s*:|^by\s*:/i.test(item.str));
  const dates = sigItems.filter(item => /^dates?\b|date\s*:/i.test(item.str));
  const fors = sigItems.filter(item => /^company\b|^entities?\b|^for\b|^corporation\b|^organization\b/i.test(item.str));
  const addresses = sigItems.filter(item => /address\b|addr\b/i.test(item.str));
  const emails = sigItems.filter(item => /emails?\b/i.test(item.str));

  let sortedSigs = [...signatures];
  if (sortedSigs.length === 0) {
    names.forEach(n => {
      sortedSigs.push({
        str: "Signature",
        x: n.x,
        y: n.y + 30,
        width: n.width,
        height: n.height
      });
    });
  }
  if (sortedSigs.length === 0) {
    dates.forEach(d => {
      sortedSigs.push({
        str: "Signature",
        x: d.x - 150,
        y: d.y,
        width: d.width,
        height: d.height
      });
    });
  }

  if (sortedSigs.length === 0) {
    return { signers, intakeFields, fieldMarkers };
  }

  sortedSigs.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 25) {
      return a.x - b.x;
    }
    return b.y - a.y;
  });

  sortedSigs.forEach((sig, sigIdx) => {
    const recipientId = String(sigIdx + 1);

    const nameLabel = names
      .filter(n => Math.abs(n.x - sig.x) < 150 && Math.abs(n.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const titleLabel = titles
      .filter(t => Math.abs(t.x - sig.x) < 150 && Math.abs(t.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const dateLabel = dates
      .filter(d => Math.abs(d.x - sig.x) < 300 && Math.abs(d.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const companyLabel = fors
      .filter(f => Math.abs(f.x - sig.x) < 150 && Math.abs(f.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const addressLabel = addresses
      .filter(ad => Math.abs(ad.x - sig.x) < 150 && Math.abs(ad.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const emailLabel = emails
      .filter(em => Math.abs(em.x - sig.x) < 150 && Math.abs(em.y - sig.y) < 80)
      .sort((a, b) => Math.abs(a.y - sig.y) - Math.abs(b.y - sig.y))[0];

    const aboveTexts = sigItems.filter(item =>
      item.y > sig.y &&
      item.y <= sig.y + 60 &&
      Math.abs(item.x - sig.x) < 100 &&
      !/signature|name|title|date|office|position|by\b|signed|address|email|company/i.test(item.str) &&
      !item.str.includes("___")
    );
    aboveTexts.sort((a, b) => a.y - b.y);

    let roleLabel = "";
    if (aboveTexts.length > 0) {
      roleLabel = aboveTexts[0].str;
    }
    if (!roleLabel) {
      if (companyLabel) {
        roleLabel = companyLabel.str;
      }
    }

    if (!roleLabel) {
      roleLabel = sigIdx === 0 ? "Disclosing Party" : "Receiving Party";
    }

    const isEnterprise = roleLabel.toLowerCase().includes("enterprise") || roleLabel.toLowerCase().includes("enterprise");
    const signerName = isEnterprise ? "Will Horn" : "";
    const signerEmail = isEnterprise ? "will@enterprise.io" : "";

    signers.push({
      name: signerName,
      email: signerEmail,
      role_label: roleLabel,
    });

    fieldMarkers.push({
      field_id: "__signature__",
      page: sigPageNum,
      x: Math.round(sig.x + 55),
      y: Math.round(sig.y - 14),
      width: 150,
      height: 30,
      recipient_id: recipientId,
    });

    if (dateLabel) {
      fieldMarkers.push({
        field_id: "__date__",
        page: sigPageNum,
        x: Math.round(dateLabel.x + 40),
        y: Math.round(dateLabel.y),
        width: 100,
        height: 20,
        recipient_id: recipientId,
      });
    }

    if (nameLabel) {
      const prePrintedName = sigItems.find(item =>
        item !== nameLabel &&
        Math.abs(item.y - nameLabel.y) < 4 &&
        item.x > nameLabel.x &&
        item.x < nameLabel.x + 250 &&
        item.str.replace(/_/g, '').trim().length > 2
      );

      if (!prePrintedName && !isEnterprise) {
        intakeFields.push({
          id: `signer_${recipientId}_name`,
          label: `${roleLabel} Name`,
          type: "text",
          required: true,
          recipient_id: recipientId,
        });
        fieldMarkers.push({
          field_id: `signer_${recipientId}_name`,
          page: sigPageNum,
          x: Math.round(nameLabel.x + 100),
          y: Math.round(nameLabel.y),
          width: 180,
          height: 20,
          recipient_id: recipientId,
        });
      }
    }

    if (titleLabel && !isEnterprise) {
      const prePrintedTitle = sigItems.find(item =>
        item !== titleLabel &&
        Math.abs(item.y - titleLabel.y) < 4 &&
        item.x > titleLabel.x &&
        item.x < titleLabel.x + 250 &&
        item.str.replace(/_/g, '').trim().length > 2
      );

      if (!prePrintedTitle) {
        intakeFields.push({
          id: `signer_${recipientId}_title`,
          label: `${roleLabel} Title`,
          type: "text",
          required: true,
          recipient_id: recipientId,
        });
        fieldMarkers.push({
          field_id: `signer_${recipientId}_title`,
          page: sigPageNum,
          x: Math.round(titleLabel.x + 40),
          y: Math.round(titleLabel.y),
          width: 180,
          height: 20,
          recipient_id: recipientId,
        });
      }
    }

    if (companyLabel && !isEnterprise) {
      const prePrintedCompany = sigItems.find(item =>
        item !== companyLabel &&
        Math.abs(item.y - companyLabel.y) < 4 &&
        item.x > companyLabel.x &&
        item.x < companyLabel.x + 250 &&
        item.str.replace(/_/g, '').trim().length > 2
      );

      if (!prePrintedCompany) {
        intakeFields.push({
          id: `signer_${recipientId}_company`,
          label: `${roleLabel} Company`,
          type: "text",
          required: true,
          recipient_id: recipientId,
        });
        fieldMarkers.push({
          field_id: `signer_${recipientId}_company`,
          page: sigPageNum,
          x: Math.round(companyLabel.x + 40),
          y: Math.round(companyLabel.y),
          width: 180,
          height: 20,
          recipient_id: recipientId,
        });
      }
    }

    if (addressLabel && !isEnterprise) {
      const prePrintedAddress = sigItems.find(item =>
        item !== addressLabel &&
        Math.abs(item.y - addressLabel.y) < 4 &&
        item.x > addressLabel.x &&
        item.x < addressLabel.x + 250 &&
        item.str.replace(/_/g, '').trim().length > 2
      );

      if (!prePrintedAddress) {
        intakeFields.push({
          id: `signer_${recipientId}_address`,
          label: `${roleLabel} Address`,
          type: "text",
          required: true,
          recipient_id: recipientId,
        });
        fieldMarkers.push({
          field_id: `signer_${recipientId}_address`,
          page: sigPageNum,
          x: Math.round(addressLabel.x + 60),
          y: Math.round(addressLabel.y),
          width: 250,
          height: 20,
          recipient_id: recipientId,
        });
      }
    }

    if (emailLabel && !isEnterprise) {
      const prePrintedEmail = sigItems.find(item =>
        item !== emailLabel &&
        Math.abs(item.y - emailLabel.y) < 4 &&
        item.x > emailLabel.x &&
        item.x < emailLabel.x + 250 &&
        item.str.replace(/_/g, '').trim().length > 2
      );

      if (!prePrintedEmail) {
        intakeFields.push({
          id: `signer_${recipientId}_email`,
          label: `${roleLabel} Email`,
          type: "text",
          required: true,
          recipient_id: recipientId,
        });
        fieldMarkers.push({
          field_id: `signer_${recipientId}_email`,
          page: sigPageNum,
          x: Math.round(emailLabel.x + 40),
          y: Math.round(emailLabel.y),
          width: 180,
          height: 20,
          recipient_id: recipientId,
        });
      }
    }
  });

  const p1Items = pagesText[1] || [];

  // 1. Effective Date
  const dateTriggerP1 = p1Items.find(item =>
    /entered into|as of\b|date of|agreement date/i.test(item.str)
  );
  if (dateTriggerP1) {
    const underscoreItem = p1Items.find(item =>
      item.str.includes("_") &&
      item.y <= dateTriggerP1.y &&
      item.y >= dateTriggerP1.y - 20
    );
    if (underscoreItem) {
      const recipientId = signers.find(s => !s.role_label.toLowerCase().includes("enterprise") && !s.role_label.toLowerCase().includes("enterprise"))
        ? String(signers.findIndex(s => !s.role_label.toLowerCase().includes("enterprise") && !s.role_label.toLowerCase().includes("enterprise")) + 1)
        : "2";

      if (!intakeFields.some(f => f.id === "effective_date")) {
        intakeFields.push({
          id: "effective_date",
          label: "Effective date",
          type: "date",
          required: true,
          recipient_id: recipientId,
        });
      }
      fieldMarkers.push({
        field_id: "effective_date",
        page: 1,
        x: Math.round(underscoreItem.x + 50),
        y: Math.round(underscoreItem.y),
        width: 100,
        height: 16,
        recipient_id: recipientId,
      });
    }
  }

  // 2. Party Names on Page 1
  signers.forEach((signer, idx) => {
    const recipientId = String(idx + 1);
    const roleClean = signer.role_label.toLowerCase();

    let keyword = "";
    if (roleClean.includes("disclosing")) keyword = "disclosing";
    else if (roleClean.includes("receiving")) keyword = "receiving";
    else if (roleClean.includes("counterparty")) keyword = "counterparty";
    else if (roleClean.includes("enterprise") || roleClean.includes("enterprise")) keyword = "enterprise";

    if (keyword) {
      const partyLabelP1 = p1Items.find(item =>
        new RegExp(keyword, "i").test(item.str) &&
        item.y > 200
      );
      if (partyLabelP1) {
        const underscoreItem = p1Items.find(item =>
          item.str.includes("_") &&
          Math.abs(item.y - partyLabelP1.y) < 6 &&
          item.x > partyLabelP1.x
        );
        if (underscoreItem) {
          const fieldId = `signer_${recipientId}_name`;
          fieldMarkers.push({
            field_id: fieldId,
            page: 1,
            x: Math.round(underscoreItem.x + 10),
            y: Math.round(underscoreItem.y),
            width: 200,
            height: 16,
            recipient_id: recipientId,
          });
        }
      }
    }
  });

  return { signers, intakeFields, fieldMarkers };
}

export default function DashboardDocuments() {
  const [documents, setDocuments] = useState<AosDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [ownerSearch, setOwnerSearch] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"hosting" | "signatures">("hosting");
  const [viewMode, setViewMode] = useState<"list" | "table">("table");

  // Current user info for ownership checks
  const auth = useAuth();
  const { givenRole } = usePermissions();
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");
  const [userAccessMap, setUserAccessMap] = useState<Record<string, boolean>>({});

  const isAdmin = givenRole === "Admin" || givenRole === "Super-Admin";

  // ── DocuSign state ──────────────────────────────────────────────────────────
  const [showSendForSigning, setShowSendForSigning] = useState(false);
  const [isNdaDoc, setIsNdaDoc] = useState(false);
  const [isAnalyzingPdf, setIsAnalyzingPdf] = useState(false);
  const [signingTarget, setSigningTarget] = useState<AosDocument | null>(null);
  const [signSubject, setSignSubject] = useState("");
  const [signBody, setSignBody] = useState("");
  const [signers, setSigners] = useState<DocuSignSigner[]>([
    { name: "", email: "", role_label: "Party A" },
    { name: "", email: "", role_label: "Party B" },
  ]);
  const [sendingForSign, setSendingForSign] = useState(false);
  /** Optional pre-sign intake form fields the sender defines per envelope. */
  const [intakeFields, setIntakeFields] = useState<IntakeFormField[]>([]);
  /** Optional extra emails to notify when the envelope completes (comma-sep). */
  const [notifyEmails, setNotifyEmails] = useState<string>("");
  /** Drag-and-drop field placements on the PDF. */
  const [fieldMarkers, setFieldMarkers] = useState<FieldMarker[]>([]);
  const [showFieldMapEditor, setShowFieldMapEditor] = useState(false);
  const [fieldMapPdfUrl, setFieldMapPdfUrl] = useState<string>("");

  const [signingSession, setSigningSession] = useState<{
    url: string;
    signerEmail: string;
    signerName: string;
    documentTitle: string;
  } | null>(null);
  const signingIframeRef = useRef<HTMLIFrameElement | null>(null);

  /** Envelope detail panel in the Signatures tab */
  const [selectedEnvelopeDoc, setSelectedEnvelopeDoc] = useState<AosDocument | null>(null);
  const [envelopeList, setEnvelopeList] = useState<DocuSignEnvelope[]>([]);
  const [loadingEnvelopes, setLoadingEnvelopes] = useState(false);
  const [gettingSignUrl, setGettingSignUrl] = useState<string>(""); // envelope_id being fetched
  const [docSignersMap, setDocSignersMap] = useState<Record<string, Array<{ name: string; email: string; role_label: string; status?: string }>>>({});
  /** Per-envelope cache: true if a real Dropbox cert is available, false if not, undefined while probing. */
  const [envelopeCertAvailable, setEnvelopeCertAvailable] = useState<Record<string, boolean>>({});


  useEffect(() => {
    if (!auth?.user) return;
    fetchAuthSession().then((session) => {
      const email = session.tokens?.idToken?.payload?.email as string | undefined;
      setCurrentUserEmail(email ?? "");
    }).catch(() => setCurrentUserEmail(""));
  }, [auth?.user]);

  // ── Detect DocuSign return URL ────────────────────────────────────────────
  // After a signer completes the embedded ceremony, DocuSign redirects them
  // back to /documents?signed=1&envelope=<id>. We surface a toast and clean
  // up the URL so it doesn't reappear on refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signed") === "1") {
      toast.success("Thanks for signing — we'll let the other parties know.");
      params.delete("signed");
      params.delete("envelope");
      const newQuery = params.toString();
      const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // After documents load, check access for restricted/signed docs
  useEffect(() => {
    if (!currentUserEmail || !documents.length) return;
    const SIGNED_TAGS = ["signed", "esign", "e-sign"];
    const restrictedDocs = documents.filter((d) => {
      const isSigned = d.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()));
      if (isSigned) return true; // Always query signed docs for access/signers
      const isOwner = d.owner_email?.toLowerCase() === currentUserEmail.toLowerCase();
      if (isAdmin || isOwner) return false;
      return d.visibility === "restricted";
    });

    if (!restrictedDocs.length) {
      setUserAccessMap({});
      return;
    }

    const checkAccess = async () => {
      try {
        const docIds = restrictedDocs.map((d) => d.document_id);
        const { access, signers } = await checkBatchAccess(docIds);
        setUserAccessMap(access);
        setDocSignersMap(signers || {});
      } catch (err) {
        console.error("Failed to check batch access:", err);
        const fallbackMap: Record<string, boolean> = {};
        for (const doc of restrictedDocs) {
          fallbackMap[doc.document_id] = false;
        }
        setUserAccessMap(fallbackMap);
      }
    };
    checkAccess();
  }, [documents, currentUserEmail, isAdmin]);

  const canModify = (doc: AosDocument): boolean => {
    if (isAdmin) return true;
    if (!currentUserEmail) return false;
    return doc.owner_email?.toLowerCase() === currentUserEmail.toLowerCase();
  };

  const canView = (doc: AosDocument): boolean => {
    const SIGNED_TAGS = ["signed", "esign", "e-sign"];
    const isSigned = doc.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()));

    // Treat signed documents as restricted: only admin, owner, or granted users (signers) can view
    if (isSigned) {
      if (isAdmin) return true;
      if (!currentUserEmail) return false;
      if (doc.owner_email?.toLowerCase() === currentUserEmail.toLowerCase()) return true;
      return userAccessMap[doc.document_id] === true;
    }

    if (doc.visibility === "public" || doc.visibility === "internal") return true;
    if (isAdmin) return true;
    if (!currentUserEmail) return false;
    if (doc.owner_email?.toLowerCase() === currentUserEmail.toLowerCase()) return true;
    // Check if user has been granted access
    return userAccessMap[doc.document_id] === true;
  };

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newDoc, setNewDoc] = useState<Partial<CreateDocumentRequest>>({
    source_provider: "manual",
    visibility: "internal",
    org_id: "enterprise",
  });
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [createIsNda, setCreateIsNda] = useState(false);
  const [canvaExportFormat, setCanvaExportFormat] = useState<CanvaExportFormat>("pdf");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isVersionDragActive, setIsVersionDragActive] = useState(false);

  // Upload dialog
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<AosDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Versions dialog
  const [showVersions, setShowVersions] = useState(false);
  const [versionsTarget, setVersionsTarget] = useState<AosDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Share dialog
  const [showShare, setShowShare] = useState(false);
  const [shareTarget, setShareTarget] = useState<AosDocument | null>(null);
  const [shareGranteeType, setShareGranteeType] = useState<string>("person");
  const [shareGranteeId, setShareGranteeId] = useState("");
  const [sharePermission, setSharePermission] = useState<string>("view");
  const [sharing, setSharing] = useState(false);
  const [accessList, setAccessList] = useState<DocumentAccess[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(false);

  // Edit dialog
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<AosDocument | null>(null);
  const [editData, setEditData] = useState<UpdateDocumentRequest>({});
  const [saving, setSaving] = useState(false);

  // Delete confirmation dialog
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AosDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDocuments = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const params: Record<string, string> = { org_id: "enterprise", limit: "100" };
      if (visibilityFilter !== "all") params.visibility = visibilityFilter;
      const result = await listDocuments(params);
      setDocuments(result.documents);
    } catch (err: unknown) {
      const msg = friendlyError(err, "Unable to load documents. Please try again.");
      toast.error(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [visibilityFilter]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Refresh document list silently whenever the tab regains focus and on a slow
  // poll. This catches "signer in another tab/device just signed" without
  // the user having to manually reload — important for the Signatures
  // tab to surface freshly-completed envelopes.
  useEffect(() => {
    const onFocus = () => loadDocuments(true);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => loadDocuments(true), 300_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [loadDocuments]);

  // Prevent browser from opening dragged files when dropped outside the dropzones
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
    };
  }, []);

  const handleCreate = async () => {
    if (!newDoc.title || !newDoc.slug) {
      toast.error("Title and slug are required");
      return;
    }
    if (newDoc.source_provider === "manual" && !newDoc.mime_type) {
      toast.error("MIME type is required for manual uploads");
      return;
    }
    if (newDoc.source_provider === "manual" && !createFile) {
      toast.error("Please select a file to upload");
      return;
    }
    if (newDoc.source_provider === "canva" && !newDoc.source_url && !createFile) {
      toast.error("Paste the Canva share link");
      return;
    }
    if (newDoc.source_provider === "canva" && canvaExportFormat === "upload" && !createFile) {
      toast.error("Please select a file to upload");
      return;
    }
    if (newDoc.source_provider === "google_drive" && !newDoc.source_url) {
      toast.error("Google Drive URL is required");
      return;
    }
    try {
      setCreating(true);
      // For Canva/Drive, default mime_type to PDF (will be updated on first sync)
      const tags = [...(newDoc.tags || [])];
      if (createIsNda && !tags.some(t => t.toLowerCase() === "nda")) {
        tags.push("nda");
      }
      const payload = { ...newDoc, tags } as CreateDocumentRequest;
      if (payload.source_provider !== "manual" && !payload.mime_type) {
        payload.mime_type = "image/png";
      }
      // Canva docs are public (shared via public link); Drive stays internal
      if (payload.source_provider === "canva") {
        payload.visibility = "public";
      } else if (payload.source_provider === "google_drive" && !payload.visibility) {
        payload.visibility = "internal";
      }
      const doc = await createDocument(payload);

      // If manual + file selected, upload immediately
      if (newDoc.source_provider === "manual" && createFile) {
        const resolvedMime = getMimeType(createFile.name, createFile.type);
        const { upload_url, s3_key } = await getUploadUrl(
          doc.document_id,
          createFile.name,
          resolvedMime,
        );
        await fetch(upload_url, {
          method: "PUT",
          body: createFile,
          headers: { "Content-Type": resolvedMime },
        });
        await confirmUpload(doc.document_id, s3_key, createFile.name);
      }

      // For Canva docs: auto-fetch via proxy OR direct file upload
      if (newDoc.source_provider === "canva") {
        if (canvaExportFormat === "upload" && createFile) {
          // User chose to upload their own file (e.g. PPTX exported from Canva)
          const resolvedMime = getMimeType(createFile.name, createFile.type);
          const { upload_url, s3_key } = await getUploadUrl(doc.document_id, createFile.name, resolvedMime);
          await fetch(upload_url, { method: "PUT", body: createFile, headers: { "Content-Type": resolvedMime } });
          await confirmUpload(doc.document_id, s3_key, createFile.name);
          toast.success("File uploaded!");
        } else if (newDoc.source_url) {
          // Auto-fetch via Canva proxy (PDF or PNG)
          try {
            toast.loading("Fetching design from Canva...", { id: "canva-sync" });
            const fetched = await fetchCanvaDesignClientSide(newDoc.source_url, canvaExportFormat as "pdf" | "png");
            if (fetched && fetched.blob.size > 1000) {
              const fileName = `${payload.title || "design"}.${fetched.ext}`;
              const { upload_url, s3_key } = await getUploadUrl(doc.document_id, fileName, fetched.mime);
              await fetch(upload_url, { method: "PUT", body: fetched.blob, headers: { "Content-Type": fetched.mime } });
              await confirmUpload(doc.document_id, s3_key, fileName);
              toast.success("Design synced from Canva!", { id: "canva-sync" });
            } else if (createFile) {
              // Fallback: use manually uploaded file
              const resolvedMime = getMimeType(createFile.name, createFile.type);
              const { upload_url, s3_key } = await getUploadUrl(doc.document_id, createFile.name, resolvedMime);
              await fetch(upload_url, { method: "PUT", body: createFile, headers: { "Content-Type": resolvedMime } });
              await confirmUpload(doc.document_id, s3_key, createFile.name);
              toast.success("File uploaded!", { id: "canva-sync" });
            } else {
              toast.error("Auto-fetch failed. Click ‘Sync’ on the document to retry.", { id: "canva-sync", duration: 5000 });
            }
          } catch {
            toast.error("Auto-fetch failed. Click ‘Sync’ on the document to retry.", { id: "canva-sync", duration: 5000 });
          }
        } else if (createFile) {
          // No URL but file provided (edge case)
          const resolvedMime = getMimeType(createFile.name, createFile.type);
          const { upload_url, s3_key } = await getUploadUrl(doc.document_id, createFile.name, resolvedMime);
          await fetch(upload_url, { method: "PUT", body: createFile, headers: { "Content-Type": resolvedMime } });
          await confirmUpload(doc.document_id, s3_key, createFile.name);
        }
      }

      // For Drive docs, trigger server-side sync
      if (newDoc.source_provider === "google_drive") {
        try {
          await triggerSync(doc.document_id);
        } catch {
          // Sync may fail, user can retry
        }
      }

      const shouldAssign = createIsNda;

      toast.success("Document created");
      setShowCreate(false);
      setNewDoc({ source_provider: "manual", visibility: "internal", org_id: "enterprise" });
      setCreateIsNda(false);
      setCanvaExportFormat("pdf");
      setCreateFile(null);
      await loadDocuments();

      if (shouldAssign) {
        openSendForSigning({ ...doc, tags, current_version: 1 });
      }
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to create document. Please check your inputs and try again."));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (doc: AosDocument) => {
    setDeleteTarget(doc);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteDocument(deleteTarget.document_id);
      toast.success("Document deleted");
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      await loadDocuments();
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to delete document. Please try again."));
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !uploadTarget) return;
    try {
      setUploading(true);
      const resolvedMime = getMimeType(selectedFile.name, selectedFile.type);
      const { upload_url, s3_key } = await getUploadUrl(
        uploadTarget.document_id,
        selectedFile.name,
        resolvedMime,
      );
      // Upload directly to S3
      await fetch(upload_url, {
        method: "PUT",
        body: selectedFile,
        headers: { "Content-Type": resolvedMime },
      });
      // Confirm upload
      await confirmUpload(uploadTarget.document_id, s3_key, selectedFile.name);
      toast.success("File uploaded — new version created");
      setShowUpload(false);
      setSelectedFile(null);
      await loadDocuments();
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Upload failed. Please check the file and try again."));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: AosDocument) => {
    try {
      const { download_url } = await getDownloadUrl(doc.document_id, undefined, "attachment");
      window.open(download_url, "_blank");
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to download. Please try again."));
    }
  };

  const handleViewVersions = async (doc: AosDocument) => {
    setVersionsTarget(doc);
    setShowVersions(true);
    setLoadingVersions(true);
    try {
      const result = await getVersions(doc.document_id);
      setVersions(result.versions);
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to load version history."));
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleShare = async () => {
    if (!shareTarget || !shareGranteeId) return;
    try {
      setSharing(true);
      await shareDocument(shareTarget.document_id, {
        grantee_type: shareGranteeType as "person" | "role" | "org" | "public",
        grantee_id: shareGranteeId,
        permission: sharePermission as "view" | "edit" | "admin",
      });
      toast.success("Access granted");
      setShareGranteeId("");
      // Reload access list
      const { access } = await listAccess(shareTarget.document_id);
      setAccessList(access);
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to share. Please try again."));
    } finally {
      setSharing(false);
    }
  };

  const handleOpenShare = async (doc: AosDocument) => {
    setShareTarget(doc);
    setShowShare(true);
    setLoadingAccess(true);
    try {
      const { access } = await listAccess(doc.document_id);
      setAccessList(access);
    } catch {
      setAccessList([]);
    } finally {
      setLoadingAccess(false);
    }
  };

  const handleRevokeAccess = async (accessId: string) => {
    if (!shareTarget) return;
    try {
      await revokeAccess(shareTarget.document_id, accessId);
      setAccessList((prev) => prev.filter((a) => a.access_id !== accessId));
      toast.success("Access revoked");
    } catch {
      toast.error("Unable to revoke access. Please try again.");
    }
  };

  const handleVisibilityChange = async (newVisibility: string) => {
    if (!shareTarget) return;
    try {
      await updateDocument(shareTarget.document_id, { visibility: newVisibility as "public" | "internal" | "restricted" });
      setShareTarget({ ...shareTarget, visibility: newVisibility as "public" | "internal" | "restricted" });
      toast.success(`Visibility changed to ${newVisibility}`);
      await loadDocuments();
    } catch {
      toast.error("Unable to update visibility. Please try again.");
    }
  };

  const handleOpen = async (doc: AosDocument) => {
    try {
      const { download_url } = await getDownloadUrl(doc.document_id, undefined, "inline");
      // Browsers can render PDFs and images inline; for Office docs use Google Viewer
      const browserNative = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
      if (browserNative.includes(doc.mime_type)) {
        window.open(download_url, "_blank");
      } else {
        // Google Docs Viewer can render docx, pptx, xlsx etc.
        const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(download_url)}&embedded=true`;
        window.open(viewerUrl, "_blank");
      }
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to open document. Please try downloading instead."));
    }
  };

  // ─── DocuSign handlers ─────────────────────────────────────────────────

  const runNdaAnalysis = async (doc: AosDocument) => {
    setIsAnalyzingPdf(true);
    try {
      /* Commenting out auto-generation of template from PDF/doc as requested
      const { download_url } = await getDownloadUrl(doc.document_id, undefined, "inline");
      const result = await analyzeNdaPdf(download_url);
      setSigners(
        result.signers.length > 0
          ? result.signers
          : [
              { name: "Will Horn", email: "will@enterprise.io", role_label: "enterprise" },
              { name: "", email: "", role_label: "Counterparty" },
            ],
      );
      setIntakeFields(result.intakeFields);
      setFieldMarkers(result.fieldMarkers);
      setSignSubject(`Please sign: ${doc.title}`);
      setSignBody(
        "Please review and sign this mutual Non-Disclosure Agreement. The form will collect your information to fill into the document, then you'll sign at the bottom.\n\nThanks!",
      );
      toast.success("NDA detected and automatically analyzed. Fields placed!");
      */

      // Always use the standard static Enterprise NDA template
      setSigners([
        { name: "Will Horn", email: "will@enterprise.io", role_label: "enterprise" },
        { name: "", email: "", role_label: "Counterparty" },
      ]);
      setIntakeFields([
        { id: "counterparty_name", label: "Your full legal name", type: "text", required: true, recipient_id: "2" },
        { id: "counterparty_company", label: "Your company / entity name", type: "text", required: true, recipient_id: "2" },
        { id: "counterparty_title", label: "Your title", type: "text", required: true, recipient_id: "2" },
        { id: "effective_date", label: "Effective date", type: "date", required: true, recipient_id: "2" },
      ]);
      setFieldMarkers([
        { field_id: "__signature__", page: 3, x: 370, y: 75, width: 150, height: 30, recipient_id: "1" },
        { field_id: "__date__", page: 3, x: 350, y: 118, width: 100, height: 20, recipient_id: "1" },
        { field_id: "__signature__", page: 3, x: 110, y: 75, width: 150, height: 30, recipient_id: "2" },
        { field_id: "__date__", page: 3, x: 95, y: 118, width: 100, height: 20, recipient_id: "2" },
        { field_id: "counterparty_name", page: 3, x: 95, y: 177, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_title", page: 3, x: 95, y: 148, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_company", page: 3, x: 80, y: 219, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_company", page: 1, x: 115, y: 673, width: 220, height: 16, recipient_id: "2" },
        { field_id: "effective_date", page: 1, x: 355, y: 699, width: 100, height: 16, recipient_id: "2" },
      ]);
      setSignSubject(`Please sign: ${doc.title}`);
      setSignBody(
        "Please review and sign this mutual Non-Disclosure Agreement. The form will collect your information to fill into the document, then you'll sign at the bottom.\n\nThanks!",
      );
      toast.success("Applied standard Enterprise NDA template layout.");
    } catch (err) {
      console.error("Template setup failed", err);
      toast.error("Unable to load the Enterprise NDA template.");
    } finally {
      setIsAnalyzingPdf(false);
    }
  };

  /** Opens the "Send for signing" dialog with sensible defaults. */
  const openSendForSigning = (doc: AosDocument) => {
    if (doc.source_provider !== "manual" && doc.source_provider !== "google_drive") {
      toast.error("Only manually-uploaded or Google Drive documents can be sent for signature.");
      return;
    }
    if (doc.current_version === 0) {
      toast.error("Upload a file before sending it for signature.");
      return;
    }
    setSigningTarget(doc);

    // Detect if this is an NDA document based on title or slug
    const isNda = String(doc.title ?? "").toLowerCase().includes("nda") ||
      String(doc.slug ?? "").toLowerCase().includes("nda") ||
      String(doc.title ?? "").toLowerCase().includes("mnda") ||
      String(doc.slug ?? "").toLowerCase().includes("mnda");

    setIsNdaDoc(isNda);

    // If this document has a saved signing template, restore everything
    // from it so the sender only has to add real names + emails.
    const tpl = doc.signing_template;
    if (tpl) {
      const signersFromTpl = (tpl.signer_roles ?? []).map((role) => ({
        name: role === "enterprise" ? "Will Horn" : "",
        email: role === "enterprise" ? "will@enterprise.io" : "",
        role_label: role,
      }));
      setSigners(
        signersFromTpl.length > 0
          ? signersFromTpl
          : [
            { name: "Will Horn", email: "will@enterprise.io", role_label: "enterprise" },
            { name: "", email: "", role_label: "Counterparty" },
          ],
      );
      setIntakeFields(tpl.intake_form_fields ?? []);
      setFieldMarkers(tpl.field_markers ?? []);
      setSignSubject(tpl.email_subject ?? `Please sign: ${doc.title}`);
      setSignBody(
        tpl.email_body ??
        "Please review and sign this mutual Non-Disclosure Agreement. The form will collect your information to fill into the document, then you'll sign at the bottom.\n\nThanks!",
      );
      toast.success("Loaded saved signing layout — just add signer details.");
    } else {
      // By default, apply the standard Enterprise NDA template layout directly
      setSigners([
        { name: "Will Horn", email: "will@enterprise.io", role_label: "enterprise" },
        { name: "", email: "", role_label: "Counterparty" },
      ]);
      setIntakeFields([
        { id: "counterparty_name", label: "Your full legal name", type: "text", required: true, recipient_id: "2" },
        { id: "counterparty_company", label: "Your company / entity name", type: "text", required: true, recipient_id: "2" },
        { id: "counterparty_title", label: "Your title", type: "text", required: true, recipient_id: "2" },
        { id: "effective_date", label: "Effective date", type: "date", required: true, recipient_id: "2" },
      ]);
      setFieldMarkers([
        { field_id: "__signature__", page: 3, x: 370, y: 75, width: 150, height: 30, recipient_id: "1" },
        { field_id: "__date__", page: 3, x: 350, y: 118, width: 100, height: 20, recipient_id: "1" },
        { field_id: "__signature__", page: 3, x: 110, y: 75, width: 150, height: 30, recipient_id: "2" },
        { field_id: "__date__", page: 3, x: 95, y: 118, width: 100, height: 20, recipient_id: "2" },
        { field_id: "counterparty_name", page: 3, x: 95, y: 177, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_title", page: 3, x: 95, y: 148, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_company", page: 3, x: 80, y: 219, width: 180, height: 20, recipient_id: "2" },
        { field_id: "counterparty_company", page: 1, x: 115, y: 673, width: 220, height: 16, recipient_id: "2" },
        { field_id: "effective_date", page: 1, x: 355, y: 699, width: 100, height: 16, recipient_id: "2" },
      ]);
      setSignSubject(`Please sign: ${doc.title}`);
      setSignBody(
        "Please review and sign this mutual Non-Disclosure Agreement. The form will collect your information to fill into the document, then you'll sign at the bottom.\n\nThanks!",
      );
      toast.success("Applied standard Enterprise NDA template layout.");
    }
    setNotifyEmails("");
    setShowSendForSigning(true);
  };

  const updateSigner = (index: number, patch: Partial<DocuSignSigner>) => {
    setSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  };

  const addSigner = () => {
    if (signers.length >= 10) {
      toast.error("Maximum 10 signers per envelope.");
      return;
    }
    setSigners((prev) => [
      ...prev,
      { name: "", email: "", role_label: `Party ${String.fromCharCode(65 + prev.length)}` },
    ]);
  };

  const removeSigner = (index: number) => {
    setSigners((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSendForSigning = async () => {
    if (!signingTarget) return;
    const cleaned = signers
      .map((s) => ({ ...s, name: s.name.trim(), email: s.email.trim(), role_label: s.role_label.trim() }))
      .filter((s) => s.name && s.email && s.role_label);
    if (cleaned.length < 1) {
      toast.error("Add at least one signer with a name and email.");
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const s of cleaned) {
      if (!emailRe.test(s.email)) {
        toast.error(`"${s.email}" is not a valid email.`);
        return;
      }
    }
    const labels = new Set(cleaned.map((s) => s.role_label.toLowerCase()));
    if (labels.size !== cleaned.length) {
      toast.error("Each signer needs a unique role label (e.g. Party A, Party B).");
      return;
    }
    try {
      setSendingForSign(true);
      // Validate intake form field IDs are non-empty + unique
      const cleanedFields = intakeFields
        .map((f, idx) => ({
          ...f,
          id: f.id?.trim() || `field_${idx + 1}`,
          label: f.label?.trim() ?? "",
        }))
        .filter((f) => f.label);
      const ids = new Set(cleanedFields.map((f) => f.id));
      if (ids.size !== cleanedFields.length) {
        toast.error("Each intake form field needs a unique ID.");
        return;
      }
      const cleanedNotify = notifyEmails
        .split(",")
        .map((e) => e.trim())
        .filter((e) => emailRe.test(e));

      const res = await createDocuSignEnvelope(signingTarget.document_id, {
        signers: cleaned,
        email_subject: signSubject || undefined,
        email_body: signBody || undefined,
        intake_form_fields: cleanedFields.length > 0 ? cleanedFields : undefined,
        notify_emails: cleanedNotify.length > 0 ? cleanedNotify : undefined,
        field_markers: fieldMarkers.length > 0 ? fieldMarkers : undefined,
      });

      const firstSigner = res.signers[0];
      const firstSignerEmailed = firstSigner ? firstSigner.email_sent : false;

      if (!firstSignerEmailed) {
        toast.success(
          `Envelope created, but failed to send the invitation email to ${firstSigner?.email || "the signer"}. Copy the sign link manually.`,
          { duration: 6000 }
        );
      } else {
        toast.success(`Envelope created. Invitation email sent to the first signer (${firstSigner.email}).`);
      }
      setShowSendForSigning(false);
      await loadDocuments();
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to start the signing ceremony. Please try again."));
    } finally {
      setSendingForSign(false);
    }
  };

  /** Opens the envelope detail panel for a document and loads its envelopes. */
  const handleOpenEnvelopes = async (doc: AosDocument) => {
    if (!canView(doc)) {
      toast.error("You don't have permission to view the signature details for this document.");
      return;
    }
    setSelectedEnvelopeDoc(doc);
    setLoadingEnvelopes(true);
    setEnvelopeCertAvailable({});
    try {
      const { envelopes } = await listDocuSignEnvelopes(doc.document_id);
      setEnvelopeList(envelopes);

      // Probe each completed envelope for a real Dropbox cert. The backend
      // returns certificate_url = null when no real Dropbox-issued audit
      // trail exists yet, which keeps the cert button hidden for
      // placeholder / pending-witness envelopes.
      const completedEnvelopes = envelopes.filter(
        (e) =>
          e.status === "completed" ||
          (e.signers?.length > 0 && e.signers.every((s) => s.status?.toLowerCase() === "completed")),
      );
      const probes = await Promise.allSettled(
        completedEnvelopes.map(async (env) => {
          const res = await getSignedEnvelopeDownload(doc.document_id, env.envelope_id);
          return { envelopeId: env.envelope_id, hasCert: Boolean(res.certificate_url) };
        }),
      );
      const next: Record<string, boolean> = {};
      probes.forEach((p) => {
        if (p.status === "fulfilled") next[p.value.envelopeId] = p.value.hasCert;
      });
      setEnvelopeCertAvailable(next);
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to load signature envelopes."));
      setEnvelopeList([]);
    } finally {
      setLoadingEnvelopes(false);
    }
  };

  /**
   * Finds the most recent completed envelope for a doc and opens or downloads
   * the Aerostack-signed PDF (with all signatures, names, dates baked in).
   * Surfaces an error if no signed copy exists yet — never falls back to the
   * unsigned original, since this lives under the "Signatures" tab and the
   * user is explicitly asking for the signed artifact.
   */
  const handleOpenSignedPdf = async (doc: AosDocument, mode: "open" | "download") => {
    try {
      const { envelopes } = await listDocuSignEnvelopes(doc.document_id);
      const completed = envelopes
        .filter((e) =>
          e.status === "completed" ||
          (e.signers?.length > 0 && e.signers.every((s) => s.status?.toLowerCase() === "completed")),
        )
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];

      if (!completed) {
        toast.error("No signed copy yet. Wait for all signers to complete the envelope.");
        return;
      }

      const dl = await getSignedEnvelopeDownload(doc.document_id, completed.envelope_id, { forceDownload: mode === "download" });
      if (mode === "download") {
        openPresignedPdf(dl.signed_pdf_url, `${doc.title.replace(/[^A-Za-z0-9._-]+/g, "_")}-signed.pdf`);
      } else {
        openPresignedPdf(dl.signed_pdf_url);
      }
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't load the signed PDF."));
    }
  };

  /** Fetches a fresh embedded signing URL and opens the in-app ceremony. */
  const handleSignNow = async (
    doc: AosDocument,
    envelope: DocuSignEnvelope,
    signerEmail: string,
    signerName: string,
  ) => {
    try {
      setGettingSignUrl(envelope.envelope_id);
      const { signing_url } = await getDocuSignSigningUrl(
        doc.document_id,
        envelope.envelope_id,
        signerEmail,
      );
      setSigningSession({
        url: signing_url,
        signerEmail,
        signerName,
        documentTitle: doc.title,
      });
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to open the signing ceremony. Please try again."));
    } finally {
      setGettingSignUrl("");
    }
  };

  const handleEdit = (doc: AosDocument) => {
    setEditTarget(doc);
    // Strip owner_email prefix from slug for editing (user only edits the doc part)
    const docSlug = doc.slug.includes("/")
      ? doc.slug.split("/").slice(1).join("/")
      : doc.slug;
    setEditData({
      title: doc.title,
      slug: docSlug,
      description: doc.description,
      visibility: doc.visibility,
      tags: doc.tags,
    });
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    try {
      setSaving(true);
      // Re-prepend owner email to slug if user edited it
      const payload = { ...editData };
      if (payload.slug && !payload.slug.includes("/")) {
        const ownerPrefix = editTarget.owner_email ?? editTarget.slug.split("/")[0];
        payload.slug = `${ownerPrefix}/${payload.slug}`;
      }
      await updateDocument(editTarget.document_id, payload);
      toast.success("Document updated");
      setShowEdit(false);
      await loadDocuments();
    } catch (err: unknown) {
      toast.error(friendlyError(err, "Unable to save changes. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const copyPublicUrl = async (doc: AosDocument) => {
    try {
      const { share_url } = await getShareLink(doc.document_id);
      navigator.clipboard.writeText(share_url);
      toast.success("Link copied");
    } catch {
      // Fallback to constructing URL locally
      const baseUrl = import.meta.env.VITE_Aerostack_BASE_URL || window.location.origin;
      const url = `${baseUrl}/public/docs/${doc.slug}/v${doc.current_version}`;
      navigator.clipboard.writeText(url);
      toast.success("Link copied");
    }
  };

  const copyShareableUrl = async (doc: AosDocument) => {
    try {
      const { share_url } = await getShareLink(doc.document_id);
      navigator.clipboard.writeText(share_url);
      toast.success("Link copied");
    } catch {
      // Fallback without token
      const baseUrl = import.meta.env.VITE_Aerostack_BASE_URL || window.location.origin;
      const url = `${baseUrl}/public/docs/${doc.slug}/v${doc.current_version}`;
      navigator.clipboard.writeText(url);
      toast.success("Link copied (token may be needed for access)");
    }
  };

  const filteredDocs = documents.filter((doc) => {
    // Hide completely if access is denied
    if (!canView(doc)) return false;
    // Source filter
    if (sourceFilter !== "all" && doc.source_provider !== sourceFilter) return false;
    // Owner filter
    if (ownerFilter === "mine" && doc.owner_email?.toLowerCase() !== currentUserEmail.toLowerCase()) return false;
    if (ownerFilter !== "all" && ownerFilter !== "mine" && doc.owner_email?.toLowerCase() !== ownerFilter.toLowerCase()) return false;
    // Owner email search
    if (ownerSearch && !doc.owner_email?.toLowerCase().includes(ownerSearch.toLowerCase())) return false;
    // Search
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.slug.toLowerCase().includes(q) ||
      doc.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const SIGNED_TAGS = ["signed", "esign", "e-sign"];
  const hostedDocs = filteredDocs.filter(
    (d) => !d.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()))
  );
  const signedDocs = filteredDocs.filter(
    (d) => d.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase())) && canView(d)
  );

  /** Returns the proper shareable URL for a doc, with auth token for restricted/internal docs. */
  async function getDocShareUrl(doc: AosDocument): Promise<string> {
    const isSigned = doc.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()));
    // Canva / Drive docs always use their source URL directly, UNLESS the document has been signed.
    if (!isSigned && doc.source_provider !== "manual" && doc.source_url) return doc.source_url;
    try {
      const { share_url } = await getShareLink(doc.document_id);
      return share_url;
    } catch {
      // Fallback: tokenless URL (works for public docs)
      const baseUrl = (import.meta.env.VITE_Aerostack_BASE_URL as string) || window.location.origin;
      return `${baseUrl}/public/docs/${doc.slug}/v${doc.current_version}`;
    }
  }

  /** Copies the shareable link to clipboard, fetching a proper token-auth URL. */
  async function copyDocLink(doc: AosDocument) {
    const url = await getDocShareUrl(doc);
    navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  /** Opens the shareable link in a new tab with the correct token. */
  async function openDocLink(doc: AosDocument) {
    const url = await getDocShareUrl(doc);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-card">
        <h1 className="text-lg font-bold tracking-tight flex gap-2 items-center">
          <FileText className="w-5 h-5" /> Document Host
        </h1>
        <p className="text-xs text-muted-foreground">
          Manage documents, upload files, auto-sync from Canva/Drive, and share via friendly URLs
        </p>
      </div>

      {/* Top-level Tabs: Hosting / Signatures */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "hosting" | "signatures")}
        className="flex-1 flex flex-col min-h-0"
      >
        {/* Tab triggers row */}
        <div className="px-6 border-b bg-card">
          <TabsList className="h-auto bg-transparent p-0 gap-0">
            <TabsTrigger
              value="hosting"
              id="tab-hosting"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium gap-1.5"
            >
              📁 Hosting
              <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                {hostedDocs.length}
              </span>
            </TabsTrigger>
            {(signedDocs.length > 0 || isAdmin) && (
              <TabsTrigger
                value="signatures"
                id="tab-signatures"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium gap-1.5"
              >
                🔏 Signatures
                <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {signedDocs.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* ═══ HOSTING TAB ═══ */}
        <TabsContent value="hosting" className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden">
          {/* Toolbar */}
          <div className="p-3 border-b bg-card flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue placeholder="Visibility" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All visibility</SelectItem>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="restricted">Restricted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={(v) => { setOwnerFilter(v); setOwnerSearch(""); }}>
              <SelectTrigger className="w-28 h-8 text-sm">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="mine">My docs</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={ownerSearch}
              onChange={(e) => { setOwnerSearch(e.target.value); if (e.target.value) setOwnerFilter("all"); }}
              placeholder="Filter by email..."
              className="w-40 h-8 text-sm"
            />
            {/* View mode toggle */}
            <div className="flex items-center border rounded-md overflow-hidden h-8 shrink-0">
              <button
                id="view-toggle-list"
                type="button"
                title="List view"
                onClick={() => setViewMode("list")}
                className={`flex items-center justify-center px-2.5 h-full transition-colors ${viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-full bg-border" />
              <button
                id="view-toggle-table"
                type="button"
                title="Table view"
                onClick={() => setViewMode("table")}
                className={`flex items-center justify-center px-2.5 h-full transition-colors ${viewMode === "table"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={() => loadDocuments()} disabled={loading} title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New
            </Button>
          </div>

          {/* Source filter pills */}
          <div className="px-3 pt-2 pb-1.5 border-b bg-background">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
              {([
                { value: "all", label: "All Documents", icon: "📄" },
                { value: "manual", label: "Manual Uploads", icon: "📁" },
                { value: "canva", label: "Canva Designs", icon: "🎨" },
                { value: "google_drive", label: "Google Drive", icon: "🔗" },
                { value: "drive_connect", label: "Connect Drive", icon: "➕" },
              ] as const).map(({ value, label, icon }) => {
                const viewableDocs = documents.filter(canView).filter(
                  (d) => !d.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()))
                );
                const count = value === "all"
                  ? viewableDocs.length
                  : value === "drive_connect"
                    ? null
                    : viewableDocs.filter((d) => d.source_provider === value).length;
                const isActive = sourceFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSourceFilter(value)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all shrink-0 ${isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      }`}
                  >
                    <span>{icon}</span>
                    {label}
                    {count !== null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"
                        }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Hosting content — only this section scrolls */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3">
              {sourceFilter === "drive_connect" ? (
                <DriveConnectPanel
                  currentUserEmail={currentUserEmail}
                  onImported={(doc) => {
                    loadDocuments();
                    if (doc && doc.tags?.some((t: string) => t.toLowerCase() === "nda")) {
                      openSendForSigning(doc);
                    }
                  }}
                />
              ) : loading ? (
                <Loader />
              ) : hostedDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[40vh] text-center space-y-4">
                  <FileText className="w-12 h-12 text-muted-foreground" />
                  <h3 className="text-xl font-semibold">No documents yet</h3>
                  <p className="text-muted-foreground max-w-md">
                    Create a document to get started. Upload files manually or connect Canva/Google Drive for auto-sync.
                  </p>
                  <Button onClick={() => setShowCreate(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Create First Document
                  </Button>
                </div>
              ) : viewMode === "list" ? (
                /* ── List View (default compact rows) ── */
                <div className="grid grid-cols-2 gap-2">
                  {hostedDocs.map((doc) => (
                    <div
                      key={doc.document_id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{doc.title}</span>
                        <Badge
                          variant="outline"
                          className={`text-[11px] px-1.5 py-0 shrink-0 ${VISIBILITY_COLORS[doc.visibility]}`}
                        >
                          {VISIBILITY_ICONS[doc.visibility]}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground shrink-0 capitalize">{doc.source_provider === "google_drive" ? "Drive" : doc.source_provider}</span>
                        <span className="text-xs text-muted-foreground shrink-0">v{doc.current_version}</span>
                        <span className="text-xs text-muted-foreground truncate">{doc.owner_email?.split("@")[0]}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {canView(doc) ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Open" onClick={() => handleOpen(doc)} disabled={doc.current_version === 0}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Download" onClick={() => handleDownload(doc)} disabled={doc.current_version === 0}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Versions" onClick={() => handleViewVersions(doc)}>
                              <History className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy link" onClick={() => {
                              if (doc.source_provider !== "manual" && doc.source_url) {
                                navigator.clipboard.writeText(doc.source_url);
                                toast.success("Source link copied");
                              } else {
                                doc.visibility === "public" ? copyPublicUrl(doc) : copyShareableUrl(doc);
                              }
                            }}>
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            {doc.source_provider === "google_drive" && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Sync now" onClick={async () => {
                                try {
                                  toast.loading("Syncing...", { id: "sync" });
                                  const result = await triggerSync(doc.document_id);
                                  if (result.synced) {
                                    toast.success(`Synced! New version: v${result.version}`, { id: "sync" });
                                    await loadDocuments();
                                  } else if (result.skipped) {
                                    toast.success("Already up to date", { id: "sync" });
                                  } else {
                                    toast.error(result.error ? friendlyError(result.error, "Sync failed.") : "Sync failed.", { id: "sync" });
                                  }
                                } catch {
                                  toast.error("Unable to sync right now. Please try again later.", { id: "sync" });
                                }
                              }}>
                                <RefreshCw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </>
                        ) : (
                          <button
                            className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-md transition-colors cursor-pointer border-none"
                            title={`Request access from ${doc.owner_email}`}
                            onClick={async () => {
                              if (!currentUserEmail) {
                                toast.error("Please sign in to request access.");
                                return;
                              }
                              try {
                                await requestAccess(doc.document_id, currentUserEmail);
                                toast.success(`Access request sent to ${doc.owner_email}`);
                              } catch {
                                toast.error("Unable to send access request. Please try again.");
                              }
                            }}
                          >
                            🔒 Request Access
                          </button>
                        )}
                        {doc.source_provider === "manual" || doc.source_provider === "google_drive" ? (
                          canModify(doc) && (
                            <>
                              {doc.tags?.some(t => t.toLowerCase() === "nda") &&
                                !doc.tags?.some(t => ["signed", "esign", "e-sign", "esign-sent"].includes(t.toLowerCase())) && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Send for signature" onClick={() => openSendForSigning(doc)}>
                                    <PenSquare className="w-3.5 h-3.5 text-emerald-600" />
                                  </Button>
                                )}
                              {doc.tags?.some(t => t.toLowerCase() === "nda") && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Signature requests" onClick={() => handleOpenEnvelopes(doc)}>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Share" onClick={() => handleOpenShare(doc)}>
                                <Share2 className="w-3.5 h-3.5" />
                              </Button>
                              {doc.source_provider === "manual" && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Upload new version" onClick={() => { setUploadTarget(doc); setShowUpload(true); }}>
                                  <Upload className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEdit(doc)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(doc)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </>
                          )
                        ) : (
                          <>
                            {doc.visibility === "restricted" && canModify(doc) && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Who has access" onClick={() => handleOpenShare(doc)}>
                                <Users className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {canModify(doc) && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEdit(doc)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(doc)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* ── Table View — shareable link always visible ── */
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-[28%]">Document</th>
                        <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-[10%]">Source</th>
                        <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-[14%]">Owner</th>
                        <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-[30%]">
                          <div className="flex items-center gap-1.5">
                            <Link2 className="w-3 h-3" /> Shareable Link
                          </div>
                        </th>
                        <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs w-[6%]">Ver.</th>
                        <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs w-[12%]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {hostedDocs.map((doc) => {
                        // Display slug in the link column (token fetched on click)
                        const slugDisplay = doc.source_provider !== "manual" && doc.source_url
                          ? doc.source_url.replace(/^https?:\/\//, "").slice(0, 36)
                          : doc.slug.slice(0, 36);
                        const slugFull = doc.source_provider !== "manual" && doc.source_url
                          ? doc.source_url
                          : doc.slug;
                        const isTruncated = slugFull.length > 36;
                        return (
                          <tr key={doc.document_id} className="group hover:bg-accent/40 transition-colors">
                            <td className="py-1 px-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="font-medium truncate">{doc.title}</span>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-1 py-0 shrink-0 ${VISIBILITY_COLORS[doc.visibility]}`}
                                >
                                  {VISIBILITY_ICONS[doc.visibility]}
                                </Badge>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground text-xs capitalize">
                              {doc.source_provider === "google_drive" ? "Drive" : doc.source_provider}
                            </td>
                            <td className="py-2 px-3 text-muted-foreground text-xs truncate max-w-[120px]">
                              {doc.owner_email?.split("@")[0]}
                            </td>
                            <td className="py-1 px-3">
                              {canView(doc) ? (
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    type="button"
                                    title="Open link"
                                    onClick={() => openDocLink(doc)}
                                    className="text-xs text-primary hover:underline truncate font-mono text-left"
                                  >
                                    {slugDisplay}{isTruncated ? "…" : ""}
                                  </button>
                                  <button
                                    type="button"
                                    title="Copy link"
                                    onClick={() => copyDocLink(doc)}
                                    className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Lock className="w-3 h-3" /> Restricted
                                </span>
                              )}
                            </td>
                            <td className="py-1 px-3 text-muted-foreground text-xs">v{doc.current_version}</td>
                            <td className="py-1 px-3">
                              <div className="flex items-center justify-end gap-0.5">
                                {canView(doc) ? (
                                  <>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Open" onClick={() => handleOpen(doc)} disabled={doc.current_version === 0}>
                                      <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Download" onClick={() => handleDownload(doc)} disabled={doc.current_version === 0}>
                                      <Download className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Version history" onClick={() => handleViewVersions(doc)}>
                                      <History className="w-3.5 h-3.5" />
                                    </Button>
                                    {doc.source_provider === "google_drive" && (
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Sync now" onClick={async () => {
                                        try {
                                          toast.loading("Syncing...", { id: "sync" });
                                          const result = await triggerSync(doc.document_id);
                                          if (result.synced) {
                                            toast.success(`Synced! New version: v${result.version}`, { id: "sync" });
                                            await loadDocuments();
                                          } else if (result.skipped) {
                                            toast.success("Already up to date", { id: "sync" });
                                          } else {
                                            toast.error(result.error ? friendlyError(result.error, "Sync failed.") : "Sync failed.", { id: "sync" });
                                          }
                                        } catch {
                                          toast.error("Unable to sync right now. Please try again later.", { id: "sync" });
                                        }
                                      }}>
                                        <RefreshCw className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                  </>
                                ) : (
                                  <button
                                    className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md transition-colors border-none cursor-pointer"
                                    title={`Request access from ${doc.owner_email}`}
                                    onClick={async () => {
                                      if (!currentUserEmail) { toast.error("Please sign in to request access."); return; }
                                      try {
                                        await requestAccess(doc.document_id, currentUserEmail);
                                        toast.success(`Access request sent to ${doc.owner_email}`);
                                      } catch {
                                        toast.error("Unable to send access request. Please try again.");
                                      }
                                    }}
                                  >
                                    🔒 Request
                                  </button>
                                )}
                                {doc.source_provider === "manual" || doc.source_provider === "google_drive" ? (
                                  canModify(doc) && (
                                    <>
                                      {doc.tags?.some(t => t.toLowerCase() === "nda") &&
                                        !doc.tags?.some(t => ["signed", "esign", "e-sign", "esign-sent"].includes(t.toLowerCase())) && (
                                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Send for signature" onClick={() => openSendForSigning(doc)}>
                                            <PenSquare className="w-3.5 h-3.5 text-emerald-600" />
                                          </Button>
                                        )}
                                      {doc.tags?.some(t => t.toLowerCase() === "nda") && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Signature requests" onClick={() => handleOpenEnvelopes(doc)}>
                                          <ShieldCheck className="w-3.5 h-3.5" />
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Share" onClick={() => handleOpenShare(doc)}>
                                        <Share2 className="w-3.5 h-3.5" />
                                      </Button>
                                      {doc.source_provider === "manual" && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Upload new version" onClick={() => { setUploadTarget(doc); setShowUpload(true); }}>
                                          <Upload className="w-3.5 h-3.5" />
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEdit(doc)}>
                                        <Pencil className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(doc)}>
                                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                      </Button>
                                    </>
                                  )
                                ) : (
                                  <>
                                    {doc.visibility === "restricted" && canModify(doc) && (
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Who has access" onClick={() => handleOpenShare(doc)}>
                                        <Users className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                    {canModify(doc) && (
                                      <>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => handleEdit(doc)}>
                                          <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete" onClick={() => handleDelete(doc)}>
                                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                        </Button>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ═══ SIGNATURES TAB ═══ */}
        <TabsContent value="signatures" className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3">
              {signedDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-semibold">No signed documents yet</h3>
                    <p className="text-muted-foreground max-w-sm text-sm">
                      Signed copies with e-sign certificates will appear here. Tag a hosted document with{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">signed</code> to move it into this protected vault.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-medium">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    Signed documents are read-only and protected. Download only — editing is disabled.
                  </div>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-emerald-50/80 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800">
                        <tr>
                          <th className="text-left py-2.5 px-3 font-medium text-emerald-800 dark:text-emerald-300 text-xs w-[30%]">Document</th>
                          <th className="text-left py-2.5 px-3 font-medium text-emerald-800 dark:text-emerald-300 text-xs w-[18%]">Signer / Owner</th>
                          <th className="text-left py-2.5 px-3 font-medium text-emerald-800 dark:text-emerald-300 text-xs w-[16%]">Date</th>
                          <th className="text-left py-2.5 px-3 font-medium text-emerald-800 dark:text-emerald-300 text-xs w-[24%]">
                            <div className="flex items-center gap-1.5">
                              <Link2 className="w-3 h-3" /> Document Link
                            </div>
                          </th>
                          <th className="text-right py-2.5 px-3 font-medium text-emerald-800 dark:text-emerald-300 text-xs w-[12%]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/30">
                        {signedDocs.map((doc) => {
                          const isSigned = doc.tags.some((t) => SIGNED_TAGS.includes(t.toLowerCase()));
                          const useSourceUrl = !isSigned && doc.source_provider !== "manual" && doc.source_url;
                          const slugDisplay = useSourceUrl
                            ? doc.source_url!.replace(/^https?:\/\//, "").slice(0, 44)
                            : doc.slug.slice(0, 44);
                          const slugFull = useSourceUrl ? doc.source_url! : doc.slug;
                          const isTruncated = slugFull.length > 44;
                          return (
                            <tr key={doc.document_id} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span className="font-medium truncate">{doc.title}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-xs">
                                <div className="space-y-1">
                                  <div className="truncate text-muted-foreground" title={doc.owner_email}>
                                    <span className="font-semibold text-emerald-800 dark:text-emerald-400">Owner:</span> {doc.owner_email}
                                  </div>
                                  {(() => {
                                    const signersList = (docSignersMap[doc.document_id] || [])
                                      .map((signer) => signer.name || signer.email)
                                      .filter((value, index, self) => self.indexOf(value) === index);
                                    if (signersList.length === 0) return null;
                                    return (
                                      <div className="truncate text-muted-foreground" title={signersList.join(", ")}>
                                        <span className="font-semibold text-emerald-800 dark:text-emerald-400">Signers:</span> {signersList.join(", ")}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-muted-foreground text-xs">
                                {new Date(doc.updated_at).toLocaleDateString()}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    type="button"
                                    title="Open link"
                                    onClick={() => openDocLink(doc)}
                                    className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline truncate font-mono text-left"
                                  >
                                    {slugDisplay}{isTruncated ? "…" : ""}
                                  </button>
                                  <button
                                    type="button"
                                    title="Copy link"
                                    onClick={() => copyDocLink(doc)}
                                    className="shrink-0 p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600 transition-colors"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center justify-end gap-0.5">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Open signed PDF" onClick={() => handleOpenSignedPdf(doc, "open")} disabled={doc.current_version === 0}>
                                    <Eye className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Download signed PDF" onClick={() => handleOpenSignedPdf(doc, "download")} disabled={doc.current_version === 0}>
                                    <Download className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="View details" onClick={() => handleOpenEnvelopes(doc)}>
                                    <Award className="w-3.5 h-3.5 text-emerald-600" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Create Document Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Create Document</DialogTitle>
            <DialogDescription>
              Register a new document. You can upload a file after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 overflow-y-auto flex-1 pr-1 -mr-1">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={newDoc.title ?? ""}
                onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                placeholder="e.g., Expense Policy"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug (URL path)</Label>
              <Input
                value={newDoc.slug ?? ""}
                onChange={(e) =>
                  setNewDoc({
                    ...newDoc,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                  })
                }
                placeholder="e.g., expense-policy"
              />
              <p className="text-xs text-muted-foreground">
                Public URL: assets.enterprise.io/<strong>{"{your-email}"}/<span>{newDoc.slug || "..."}</span></strong>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={newDoc.description ?? ""}
                onChange={(e) => setNewDoc({ ...newDoc, description: e.target.value })}
                placeholder="Optional description"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={newDoc.source_provider ?? "manual"}
                  onValueChange={(v) =>
                    setNewDoc({
                      ...newDoc,
                      source_provider: v as "canva" | "google_drive" | "manual",
                      visibility: v === "canva" ? "public" : newDoc.visibility ?? "internal",
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual Upload</SelectItem>
                    <SelectItem value="canva">Canva</SelectItem>
                    <SelectItem value="google_drive">Google Drive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newDoc.source_provider === "manual" && (
                <div className="space-y-1.5">
                  <Label>Visibility</Label>
                  <Select
                    value={newDoc.visibility ?? "internal"}
                    onValueChange={(v) =>
                      setNewDoc({ ...newDoc, visibility: v as "public" | "internal" | "restricted" })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="restricted">Restricted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {newDoc.source_provider === "google_drive" && (
                <div className="space-y-1.5">
                  <Label>Visibility</Label>
                  <Select
                    value={newDoc.visibility ?? "internal"}
                    onValueChange={(v) =>
                      setNewDoc({ ...newDoc, visibility: v as "public" | "internal" | "restricted" })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="restricted">Restricted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {newDoc.source_provider === "manual" && (
              <div className="space-y-1.5">
                <Label>MIME Type</Label>
                <Select
                  value={newDoc.mime_type ?? ""}
                  onValueChange={(v) => setNewDoc({ ...newDoc, mime_type: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select file type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application/pdf">PDF</SelectItem>
                    <SelectItem value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word (DOCX)</SelectItem>
                    <SelectItem value="application/msword">Word (DOC)</SelectItem>
                    <SelectItem value="application/vnd.openxmlformats-officedocument.presentationml.presentation">PowerPoint (PPTX)</SelectItem>
                    <SelectItem value="application/vnd.ms-powerpoint">PowerPoint (PPT)</SelectItem>
                    <SelectItem value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">Excel (XLSX)</SelectItem>
                    <SelectItem value="application/vnd.ms-excel">Excel (XLS)</SelectItem>
                    <SelectItem value="image/png">PNG Image</SelectItem>
                    <SelectItem value="image/jpeg">JPEG Image</SelectItem>
                    <SelectItem value="image/webp">WebP Image</SelectItem>
                    <SelectItem value="image/gif">GIF Image</SelectItem>
                    <SelectItem value="text/markdown">Markdown</SelectItem>
                    <SelectItem value="text/plain">Plain Text</SelectItem>
                    <SelectItem value="application/octet-stream">Generic Binary File</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {newDoc.source_provider !== "manual" && (
              <>
                <div className="space-y-1.5">
                  <Label>
                    {newDoc.source_provider === "canva" ? "Canva Design URL" : "Google Drive URL"}
                  </Label>
                  <Input
                    value={newDoc.source_url ?? ""}
                    onChange={(e) => {
                      const url = e.target.value;
                      setNewDoc((prev) => {
                        const updated = { ...prev, source_url: url };
                        // Auto-extract source ID from URL
                        if (prev.source_provider === "canva") {
                          const match = url.match(/\/design\/([A-Za-z0-9_-]+)/);
                          if (match) updated.source_id = match[1];
                          // canva.link short URLs — ID will be resolved server-side
                          if (url.includes("canva.link") && !match) updated.source_id = "";
                        } else if (prev.source_provider === "google_drive") {
                          const match = url.match(/\/d\/([A-Za-z0-9_-]+)/);
                          if (match) updated.source_id = match[1];
                        }
                        return updated;
                      });
                    }}
                    placeholder={newDoc.source_provider === "canva" ? "https://canva.link/... or https://www.canva.com/design/.../edit" : "https://drive.google.com/file/d/..."}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Paste the full URL — the ID will be extracted automatically
                  </p>
                </div>
                {newDoc.source_provider === "canva" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                      📋 In Canva: Share → "Anyone with the link" → copy the link. Both short links (<code>canva.link/...</code>) and full URLs (<code>canva.com/design/.../edit</code>) work.
                    </p>
                    <div className="space-y-1.5">
                      <Label>Save design as</Label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setCanvaExportFormat("pdf"); setCreateFile(null); }}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border py-2 px-2 text-xs font-medium transition-colors ${canvaExportFormat === "pdf"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted"
                            }`}
                        >
                          📄 Auto → PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCanvaExportFormat("png"); setCreateFile(null); }}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border py-2 px-2 text-xs font-medium transition-colors ${canvaExportFormat === "png"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted"
                            }`}
                        >
                          🖼️ Auto → PNG
                        </button>
                        <button
                          type="button"
                          onClick={() => setCanvaExportFormat("upload")}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border py-2 px-2 text-xs font-medium transition-colors ${canvaExportFormat === "upload"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:bg-muted"
                            }`}
                        >
                          ⬆️ Upload File
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {canvaExportFormat === "pdf" && "Auto-fetches all slides and combines into a PDF. Best for presentations and resumes."}
                        {canvaExportFormat === "png" && "Downloads the design as a PNG image. Best for single-page graphics."}
                        {canvaExportFormat === "upload" && "Download the file from Canva (PPTX, PDF, etc.) then upload it below. The Canva URL is kept as the source reference."}
                      </p>
                    </div>
                    {canvaExportFormat === "upload" && (
                      <div className="space-y-1.5">
                        <Label>File <span className="text-destructive">*</span></Label>
                        <label
                          className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isDragActive
                            ? "border-primary bg-primary/10"
                            : "border-muted-foreground/20 bg-muted/30 hover:bg-muted/50"
                            }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragActive(true);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragActive(false);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsDragActive(false);
                            const file = e.dataTransfer.files?.[0] ?? null;
                            if (file) {
                              setCreateFile(file);
                              const resolvedMime = getMimeType(file.name, file.type);
                              setNewDoc((prev) => ({ ...prev, mime_type: resolvedMime }));
                            }
                          }}
                        >
                          {createFile ? (
                            <div className="flex items-center gap-2 px-3">
                              <FileText className="w-5 h-5 text-primary" />
                              <div>
                                <p className="text-sm font-medium">{createFile.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(createFile.size)}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Upload className="w-5 h-5 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">Drag & drop or click to choose your exported Canva file</p>
                              <p className="text-[10px] text-muted-foreground">PPTX, PDF, DOCX, PNG, JPG and more</p>
                            </div>
                          )}
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              setCreateFile(file);
                              if (file) {
                                const resolvedMime = getMimeType(file.name, file.type);
                                setNewDoc((prev) => ({ ...prev, mime_type: resolvedMime }));
                              }
                            }}
                            accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.md,.txt"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
                {newDoc.source_provider === "google_drive" && (
                  <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                    📋 The file will be fetched from Google Drive. Changes will auto-sync via push notifications.
                  </p>
                )}
              </>
            )}
            {newDoc.source_provider === "manual" && (
              <div className="space-y-1.5">
                <Label>File</Label>
                <label
                  className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isDragActive
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/20 bg-muted/30 hover:bg-muted/50"
                    }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragActive(false);
                    const file = e.dataTransfer.files?.[0] ?? null;
                    if (file) {
                      setCreateFile(file);
                      const resolvedMime = getMimeType(file.name, file.type);
                      setNewDoc((prev) => ({ ...prev, mime_type: resolvedMime }));
                    }
                  }}
                >
                  {createFile ? (
                    <div className="flex items-center gap-2 px-3">
                      <FileText className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{createFile.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(createFile.size)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Drag & drop or click to choose a file</p>
                      <p className="text-[10px] text-muted-foreground">PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, PNG, JPG, WEBP, GIF, MD, TXT</p>
                    </div>
                  )}
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setCreateFile(file);
                      if (file) {
                        const resolvedMime = getMimeType(file.name, file.type);
                        setNewDoc((prev) => ({ ...prev, mime_type: resolvedMime }));
                      }
                    }}
                    accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.md,.txt"
                  />
                </label>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={(newDoc.tags ?? []).join(", ")}
                onChange={(e) =>
                  setNewDoc({
                    ...newDoc,
                    tags: e.target.value.split(",").map((t) => t.trim()),
                  })
                }
                onBlur={(e) =>
                  setNewDoc({
                    ...newDoc,
                    tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                  })
                }
                placeholder="e.g., policy, hr, onboarding"
              />
            </div>
            <div className="flex items-start space-x-3 rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-900/5 p-4 mt-3">
              <Checkbox
                id="createIsNda"
                checked={createIsNda}
                onCheckedChange={(checked) => setCreateIsNda(!!checked)}
                className="mt-0.5 border-emerald-400 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="createIsNda" className="cursor-pointer text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Is this an NDA document?
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable secure, in-platform electronic signature flows and automated form creation for this document.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload New Version</DialogTitle>
            <DialogDescription>
              Upload a file for "{uploadTarget?.title}". This creates a new version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>File</Label>
              <label
                className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isVersionDragActive
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/20 bg-muted/30 hover:bg-muted/50"
                  }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsVersionDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsVersionDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsVersionDragActive(false);
                  const file = e.dataTransfer.files?.[0] ?? null;
                  if (file) {
                    setSelectedFile(file);
                  }
                }}
              >
                {selectedFile ? (
                  <div className="flex items-center gap-2 px-3">
                    <FileText className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center p-4">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground font-medium">
                      Drag & drop your file here, or click to browse
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, PNG, JPG, WEBP, GIF, MD, TXT
                    </p>
                  </div>
                )}
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.md,.txt"
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Versions Dialog */}
      <Dialog open={showVersions} onOpenChange={setShowVersions}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              {versionsTarget?.title} — {versions.length} version(s)
            </DialogDescription>
          </DialogHeader>
          {loadingVersions ? (
            <Loader />
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No versions uploaded yet.
            </p>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-3">
                {versions.map((v) => (
                  <Card key={v.version_number}>
                    <CardContent className="py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Version {v.version_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(v.file_size_bytes)} · {new Date(v.imported_at).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          by {v.imported_by === "sync-agent" ? "Auto-sync" : v.imported_by}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          const { download_url } = await getDownloadUrl(
                            v.document_id,
                            v.version_number,
                          );
                          window.open(download_url, "_blank");
                        }}
                      >
                        <Download className="w-4 h-4 mr-1" /> Download
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Share Dialog — Google Drive style */}
      <Dialog open={showShare} onOpenChange={setShowShare}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {shareTarget?.source_provider === "manual"
                ? `Share "${shareTarget?.title}"`
                : `Access Information for "${shareTarget?.title}"`}
            </DialogTitle>
          </DialogHeader>

          {/* Add people input */}
          {shareTarget?.source_provider === "manual" && (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={shareGranteeId}
                  onChange={(e) => setShareGranteeId(e.target.value)}
                  placeholder="Add people by email..."
                  className="flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleShare(); }}
                />
                <Select value={sharePermission} onValueChange={setSharePermission}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">Viewer</SelectItem>
                    <SelectItem value="edit">Editor</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleShare} disabled={!shareGranteeId || sharing} size="sm">
                  {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add"}
                </Button>
              </div>
            </div>
          )}

          {/* People with access */}
          <div className="space-y-2 mt-4">
            <p className="text-sm font-medium text-muted-foreground">People with access</p>

            {/* Owner */}
            <div className="flex items-center gap-3 py-1.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                {shareTarget?.owner_email?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{shareTarget?.owner_email}</p>
              </div>
              <span className="text-xs text-muted-foreground">Owner</span>
            </div>

            {/* Shared people */}
            {loadingAccess ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...
              </div>
            ) : (
              accessList.map((access) => (
                <div key={access.access_id} className="flex items-center gap-3 py-1.5">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {access.grantee_id.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{access.grantee_id}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{access.permission}</p>
                  </div>
                  {shareTarget?.source_provider === "manual" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Remove access"
                      onClick={() => handleRevokeAccess(access.access_id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* General access */}
          <div className="space-y-2 mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-muted-foreground">General access</p>
            {shareTarget?.source_provider === "manual" ? (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  {shareTarget?.visibility === "public" ? <Globe className="w-4 h-4" /> :
                    shareTarget?.visibility === "internal" ? <Users className="w-4 h-4" /> :
                      <Lock className="w-4 h-4" />}
                </div>
                <Select
                  value={shareTarget?.visibility ?? "restricted"}
                  onValueChange={handleVisibilityChange}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restricted">Restricted — only people added above</SelectItem>
                    <SelectItem value="internal">Organization — anyone in the team</SelectItem>
                    <SelectItem value="public">Anyone with the link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  {shareTarget?.visibility === "public" ? <Globe className="w-4 h-4" /> :
                    shareTarget?.visibility === "internal" ? <Users className="w-4 h-4" /> :
                      <Lock className="w-4 h-4" />}
                </div>
                <p className="text-sm text-muted-foreground flex-1">
                  Managed by {shareTarget?.source_provider === "google_drive" ? "Google Drive" : "Canva"}. Change sharing in the source to update here.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowShare(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.title}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
            <DialogDescription>Update document properties</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Title</Label>
              <Input
                value={editData.title ?? ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={editData.slug ?? ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, slug: e.target.value }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={editData.description ?? ""}
                onChange={(e) => setEditData((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            {editTarget?.source_provider !== "canva" && (
              <div>
                <Label>Visibility</Label>
                {editTarget?.source_provider === "manual" ? (
                  <Select
                    value={editData.visibility ?? "internal"}
                    onValueChange={(v) => setEditData((prev) => ({ ...prev, visibility: v as "public" | "internal" | "restricted" }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="restricted">Restricted</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2 p-2 bg-muted rounded">
                    Managed by Google Drive sharing settings. Changes in the source will sync automatically.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
            DocuSign — Send for Signature Dialog
            Initiates an envelope from a hosted document. Both parties get a
            DocuSign-secured form and an embedded signing ceremony URL —
            users never leave Aerostack.
          ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showSendForSigning} onOpenChange={setShowSendForSigning}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenSquare className="w-5 h-5 text-emerald-600" />
              Send for Signature
            </DialogTitle>
            <DialogDescription>
              "{signingTarget?.title}" will be sent to all signers below. They can sign directly inside Aerostack — no DocuSign account needed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto flex-1 pr-1 -mr-1">
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-900/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Once all parties sign, the certified copy and audit certificate are stored securely with S3 Object Lock — no one can delete or alter them.
              </span>
            </div>

            {/* ─── Mutual NDA switch (Hidden as it is always Mutual NDA) ───
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/20">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  Is this a Mutual NDA document?
                </Label>
                <p className="text-xs text-muted-foreground max-w-md">
                  Enabling this reads the PDF pages automatically to detect signature coordinates, parties, roles, names, and titles dynamically.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {isAnalyzingPdf && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analyzing PDF...
                  </span>
                )}
                <Switch
                  checked={isNdaDoc}
                  disabled={isAnalyzingPdf}
                  onCheckedChange={async (checked) => {
                    setIsNdaDoc(checked);
                    if (checked && signingTarget) {
                      await runNdaAnalysis(signingTarget);
                    } else {
                      setSigners([
                        { name: "", email: "", role_label: "Party A" },
                        { name: "", email: "", role_label: "Party B" },
                      ]);
                      setIntakeFields([]);
                      setFieldMarkers([]);
                    }
                  }}
                />
              </div>
            </div>
            ─── */}

            <div className="space-y-1.5">
              <Label>Email subject</Label>
              <Input
                value={signSubject}
                onChange={(e) => setSignSubject(e.target.value)}
                placeholder="Please sign: ..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email body</Label>
              <Textarea
                value={signBody}
                onChange={(e) => setSignBody(e.target.value)}
                rows={3}
                placeholder="Optional message to the signers"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Signers</Label>
                <Button type="button" size="sm" variant="outline" onClick={addSigner} disabled={signers.length >= 10}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add signer
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Each signer gets their own row in the envelope. Tip: place anchor tags like <code className="bg-muted px-1 rounded text-[10px]">[SIGN_PARTY_A]</code>, <code className="bg-muted px-1 rounded text-[10px]">[DATE_PARTY_A]</code>, <code className="bg-muted px-1 rounded text-[10px]">[FULLNAME_PARTY_A]</code> in the document so DocuSign can position the fields automatically.
              </p>

              <div className="space-y-2">
                {signers.map((signer, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-start rounded-lg border bg-card p-3"
                  >
                    <div className="col-span-3 space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Role label</Label>
                      <Input
                        value={signer.role_label}
                        onChange={(e) => updateSigner(idx, { role_label: e.target.value })}
                        placeholder={`Party ${String.fromCharCode(65 + idx)}`}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-4 space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Full name</Label>
                      <Input
                        value={signer.name}
                        onChange={(e) => updateSigner(idx, { name: e.target.value })}
                        placeholder="Jane Doe"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-4 space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Email</Label>
                      <Input
                        type="email"
                        value={signer.email}
                        onChange={(e) => updateSigner(idx, { email: e.target.value })}
                        placeholder="jane@example.com"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-1 flex items-end justify-end h-full pt-5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Remove signer"
                        disabled={signers.length <= 1}
                        onClick={() => removeSigner(idx)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>



            {/* ─── Intake form builder ─── */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Pre-sign intake form (optional)</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setIntakeFields((prev) => [
                      ...prev,
                      {
                        id: `field_${prev.length + 1}`,
                        label: "",
                        type: "text",
                        required: true,
                      },
                    ])
                  }
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add field
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Fields appear on the Aerostack signing page <strong>before</strong> the document loads. Signers must answer required fields before they can sign. Responses are saved on the envelope and included in the completion email.
              </p>
              {intakeFields.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic px-3 py-3 border border-dashed rounded-md text-center">
                  No intake fields. The signer goes straight to the document.
                </div>
              ) : (
                <div className="space-y-2">
                  {intakeFields.map((field, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-start rounded-lg border bg-card p-2.5">
                      <div className="col-span-5 space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Question / label</Label>
                        <Input
                          value={field.label}
                          onChange={(e) =>
                            setIntakeFields((prev) =>
                              prev.map((f, i) => (i === idx ? { ...f, label: e.target.value } : f)),
                            )
                          }
                          placeholder="e.g. Phone number"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={(v) =>
                            setIntakeFields((prev) =>
                              prev.map((f, i) =>
                                i === idx ? { ...f, type: v as IntakeFormField["type"] } : f,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="tel">Phone</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="textarea">Long text</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3 flex items-end justify-center h-full pt-5">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={field.required ?? false}
                            onChange={(e) =>
                              setIntakeFields((prev) =>
                                prev.map((f, i) => (i === idx ? { ...f, required: e.target.checked } : f)),
                              )
                            }
                            className="rounded"
                          />
                          Required
                        </label>
                      </div>
                      <div className="col-span-1 flex items-end justify-end h-full pt-5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Remove field"
                          onClick={() =>
                            setIntakeFields((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Place fields on PDF (Hidden for now as we only use one template) ───
            <div className="space-y-1.5 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Place fields on PDF (optional)</Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!signingTarget) return;
                      try {
                        const { download_url } = await getDownloadUrl(
                          signingTarget.document_id,
                          undefined,
                          "inline",
                        );
                        setFieldMapPdfUrl(download_url);
                        setShowFieldMapEditor(true);
                      } catch (err) {
                        toast.error(friendlyError(err, "Couldn't load the PDF for editing."));
                      }
                    }}
                  >
                    <PenSquare className="w-3.5 h-3.5 mr-1" />
                    {fieldMarkers.length > 0
                      ? `Edit placements (${fieldMarkers.length})`
                      : "Open PDF editor"}
                  </Button>
                  {(fieldMarkers.length > 0 || intakeFields.length > 0) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title="Save the current intake form + field placements on this document so future signing requests reuse them automatically"
                      onClick={async () => {
                        if (!signingTarget) return;
                        try {
                          await updateDocument(signingTarget.document_id, {
                            signing_template: {
                              intake_form_fields: intakeFields,
                              field_markers: fieldMarkers,
                              signer_roles: signers.map((s) => s.role_label),
                              email_subject: signSubject,
                              email_body: signBody,
                            },
                          });
                          toast.success(
                            "Saved as template. Next time you click 'Send for signature' on this document, everything will pre-fill.",
                          );
                          await loadDocuments();
                        } catch (err) {
                          toast.error(friendlyError(err, "Couldn't save the template."));
                        }
                      }}
                    >
                      💾 Save as template
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Drag signature, name, date, and form values onto the PDF. After placing them, click "Save as template" so this layout reuses on every future signing request for this document.
              </p>
            </div>
            ─── */}

            {/* ─── Notify-on-completion ─── */}
            <div className="space-y-1.5 pt-2 border-t">
              <Label className="text-sm">Notify on completion (optional)</Label>
              <Input
                value={notifyEmails}
                onChange={(e) => setNotifyEmails(e.target.value)}
                placeholder="ops@enterprise.io, legal@enterprise.io"
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated emails. You'll automatically be notified as the sender — add others here.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendForSigning(false)} disabled={sendingForSign}>
              Cancel
            </Button>
            <Button onClick={handleSendForSigning} disabled={sendingForSign}>
              {sendingForSign && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              <PenSquare className="w-4 h-4 mr-1.5" />
              Send for signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
            Field Map Editor — drag signature, name, date, form values onto PDF
          ═══════════════════════════════════════════════════════════════════ */}
      <Dialog open={showFieldMapEditor} onOpenChange={setShowFieldMapEditor}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenSquare className="w-5 h-5 text-emerald-600" />
              Place fields on PDF
            </DialogTitle>
            <DialogDescription>
              Drag signature, name, date, and form values onto the document. Each marker shows where its value will be baked into the signed PDF.
            </DialogDescription>
          </DialogHeader>
          {fieldMapPdfUrl && (
            <FieldMapEditor
              pdfUrl={fieldMapPdfUrl}
              initialMarkers={fieldMarkers}
              signers={signers}
              intakeFields={intakeFields}
              onChange={setFieldMarkers}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFieldMapEditor(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
            DocuSign — In-flight envelope detail panel
            Lists every envelope created for a document and lets the current
            user resume signing without leaving Aerostack.
          ═══════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={selectedEnvelopeDoc !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEnvelopeDoc(null);
            setEnvelopeList([]);
            setEnvelopeCertAvailable({});
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Signature envelopes
            </DialogTitle>
            <DialogDescription>
              {selectedEnvelopeDoc?.title} — every signing request created for this document.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mr-1 pr-1">
            {loadingEnvelopes ? (
              <div className="py-12">
                <Loader />
              </div>
            ) : envelopeList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <Clock className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No signature requests yet for this document.</p>
                {selectedEnvelopeDoc && canModify(selectedEnvelopeDoc) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const doc = selectedEnvelopeDoc;
                      setSelectedEnvelopeDoc(null);
                      setEnvelopeList([]);
                      openSendForSigning(doc);
                    }}
                  >
                    <PenSquare className="w-3.5 h-3.5 mr-1.5" /> Send for signature
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {envelopeList.map((env) => {
                  const statusIcon =
                    env.status === "completed" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                      env.status === "voided" || env.status === "declined" ? <XCircle className="w-4 h-4 text-destructive" /> :
                        env.status === "delivered" ? <Clock className="w-4 h-4 text-blue-500" /> :
                          <AlertCircle className="w-4 h-4 text-amber-500" />;
                  const statusColor =
                    env.status === "completed" ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20" :
                      env.status === "voided" || env.status === "declined" ? "text-destructive bg-destructive/10" :
                        "text-amber-700 bg-amber-50 dark:bg-amber-900/20";
                  return (
                    <Card key={env.envelope_id} className="overflow-hidden">
                      <CardHeader className="py-3 px-4 bg-muted/30 flex-row items-center justify-between space-y-0">
                        <div className="space-y-0.5">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {statusIcon}
                            <span className="capitalize">{env.status}</span>
                          </CardTitle>
                          <CardDescription className="text-[11px]">
                            Sent {new Date(env.created_at).toLocaleString()} by {env.created_by}
                          </CardDescription>
                        </div>
                        <Badge className={`text-[10px] ${statusColor}`}>{env.envelope_id.slice(0, 8)}…</Badge>
                      </CardHeader>
                      <CardContent className="p-3 space-y-2">
                        {env.signers
                          .map((signer: typeof env.signers[number] & { signed_at?: string }) => {
                            const isMe = signer.email.toLowerCase() === currentUserEmail.toLowerCase();
                            const canSign =
                              isMe &&
                              env.status !== "completed" &&
                              env.status !== "voided" &&
                              env.status !== "declined" &&
                              signer.status?.toLowerCase() !== "completed" &&
                              signer.status?.toLowerCase() !== "signed";
                            return (
                              <div
                                key={`${env.envelope_id}-${signer.recipient_id}`}
                                className="flex items-center gap-3 px-2 py-1.5 rounded-md border bg-card"
                              >
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-medium shrink-0">
                                  {signer.name?.charAt(0).toUpperCase() || "?"}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">
                                    {signer.name}
                                    {isMe && <span className="ml-1.5 text-[10px] text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">you</span>}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {signer.email} · {signer.role_label}
                                  </p>
                                  {signer.signed_at && (
                                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                                      Signed {new Date(signer.signed_at).toLocaleString()}
                                    </p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] capitalize shrink-0 ${signer.status?.toLowerCase() === "completed" || signer.status?.toLowerCase() === "signed"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                    }`}
                                >
                                  {signer.status || "pending"}
                                </Badge>
                                {canSign && selectedEnvelopeDoc && (
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => handleSignNow(selectedEnvelopeDoc, env, signer.email, signer.name)}
                                    disabled={gettingSignUrl === env.envelope_id}
                                  >
                                    {gettingSignUrl === env.envelope_id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <>
                                        <PenSquare className="w-3 h-3 mr-1" /> Sign now
                                      </>
                                    )}
                                  </Button>
                                )}
                              </div>
                            );
                          })}

                        {/* Cert download (Dropbox audit trail) — only when
                            every signer is done AND a real Dropbox cert exists. */}
                        {selectedEnvelopeDoc && envelopeCertAvailable[env.envelope_id] && (env.status === "completed" || (env.signers?.length > 0 && env.signers.every((s) => s.status?.toLowerCase() === "completed"))) && (
                          <div className="flex flex-wrap gap-2 pt-2 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={async () => {
                                if (!selectedEnvelopeDoc) return;
                                try {
                                  const res = await getSignedEnvelopeDownload(
                                    selectedEnvelopeDoc.document_id,
                                    env.envelope_id,
                                    { forceDownload: true },
                                  );
                                  if (res.certificate_url) {
                                    openPresignedPdf(res.certificate_url, `${selectedEnvelopeDoc.title.replace(/[^A-Za-z0-9._-]+/g, "_")}-certificate.pdf`);
                                  } else {
                                    toast.error("Certificate not available yet.");
                                  }
                                } catch (err) {
                                  toast.error(friendlyError(err, "Couldn't load the certificate."));
                                }
                              }}
                            >
                              <Award className="w-3 h-3 mr-1" /> DocuSign certificate
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedEnvelopeDoc(null);
                setEnvelopeList([]);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════════
            DocuSign — Embedded signing ceremony overlay
            Renders the DocuSign signing UI in an iframe so signers stay
            inside Aerostack at all times. The iframe URL is a short-lived
            recipient view URL fetched on-demand from the backend.
          ═══════════════════════════════════════════════════════════════════ */}
      {signingSession && (
        <div
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="DocuSign signing ceremony"
        >
          <div className="flex items-center justify-between border-b bg-card px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <PenSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{signingSession.documentTitle}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Signing as {signingSession.signerName} · {signingSession.signerEmail}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(signingSession.url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open in new tab
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setSigningSession(null);
                  // After closing, refresh envelope list if it's open
                  if (selectedEnvelopeDoc) {
                    try {
                      const { envelopes } = await listDocuSignEnvelopes(selectedEnvelopeDoc.document_id);
                      setEnvelopeList(envelopes);
                    } catch { /* silent */ }
                  }
                  await loadDocuments();
                }}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" /> Close
              </Button>
            </div>
          </div>
          <iframe
            ref={signingIframeRef}
            src={signingSession.url}
            title="DocuSign signing ceremony"
            // allow same-origin so DocuSign can run; we never embed third-party scripts on top of Aerostack pages
            className="flex-1 w-full border-0"
            // DocuSign requires these features for click-to-sign and biometric prompts
            allow="camera; microphone; geolocation"
          />
        </div>
      )}
    </div>
  );
}
