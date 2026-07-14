import { aerostackApiClient } from "@/api/client";

export interface AosDocument {
  document_id: string;
  org_id: string;
  owner_email: string;
  title: string;
  slug: string;
  description?: string;
  source_provider: "canva" | "google_drive" | "manual";
  source_id?: string;
  source_url?: string;
  mime_type: string;
  current_version: number;
  visibility: "public" | "internal" | "restricted";
  tags: string[];
  is_deleted: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Saved signing layout (intake fields + marker positions) for reuse. */
  signing_template?: SigningTemplate;
}

export interface SigningTemplate {
  intake_form_fields?: IntakeFormField[];
  field_markers?: FieldMarker[];
  /** Role labels only (e.g. ["enterprise", "Counterparty"]) — not real names/emails. */
  signer_roles?: string[];
  email_subject?: string;
  email_body?: string;
}

export interface DocumentVersion {
  document_id: string;
  version_number: number;
  s3_key: string;
  s3_version_id: string;
  file_size_bytes: number;
  content_hash: string;
  source_modified_at?: string;
  imported_at: string;
  imported_by: string;
}

export interface DocumentAccess {
  access_id: string;
  document_id: string;
  grantee_type: "person" | "role" | "org" | "public";
  grantee_id: string;
  permission: "view" | "edit" | "admin";
  granted_by: string;
  granted_at: string;
}

export interface CreateDocumentRequest {
  title: string;
  slug: string;
  description?: string;
  source_provider: "canva" | "google_drive" | "manual";
  source_id?: string;
  source_url?: string;
  mime_type: string;
  visibility: "public" | "internal" | "restricted";
  tags?: string[];
  org_id: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  slug?: string;
  description?: string;
  visibility?: "public" | "internal" | "restricted";
  tags?: string[];
  signing_template?: SigningTemplate;
}

export interface ShareDocumentRequest {
  grantee_type: "person" | "role" | "org" | "public";
  grantee_id: string;
  permission: "view" | "edit" | "admin";
}

export interface UploadUrlResponse {
  upload_url: string;
  s3_key: string;
  expires_in_seconds: number;
  max_size_bytes: number;
}

// ─── API Functions ───

export async function listDocuments(params?: {
  org_id?: string;
  visibility?: string;
  limit?: number;
  cursor?: string;
}) {
  const res = await aerostackApiClient.get("/documents", { params });
  return res.data.data as {
    documents: AosDocument[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export async function createDocument(data: CreateDocumentRequest) {
  const res = await aerostackApiClient.post("/documents", data);
  return res.data.data as AosDocument;
}

export async function getDocument(documentId: string) {
  const res = await aerostackApiClient.get(`/documents/${documentId}`);
  return res.data.data as AosDocument;
}

export async function updateDocument(
  documentId: string,
  data: UpdateDocumentRequest,
) {
  const res = await aerostackApiClient.put(`/documents/${documentId}`, data);
  return res.data.data as AosDocument;
}

export async function deleteDocument(documentId: string) {
  const res = await aerostackApiClient.delete(`/documents/${documentId}`);
  return res.data.data;
}

export async function getVersions(documentId: string) {
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/versions`,
  );
  return res.data.data as {
    versions: DocumentVersion[];
    count: number;
  };
}

export async function getUploadUrl(
  documentId: string,
  fileName: string,
  contentType: string,
) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/upload`,
    { fileName, contentType },
  );
  return res.data.data as UploadUrlResponse;
}

export async function confirmUpload(documentId: string, s3Key: string, originalFilename?: string) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/confirm-upload`,
    { s3_key: s3Key, original_filename: originalFilename },
  );
  return res.data.data;
}

export async function getDownloadUrl(
  documentId: string,
  version?: number,
  mode?: "inline" | "attachment",
) {
  const params: Record<string, string> = {};
  if (version) params.version = String(version);
  if (mode) params.mode = mode;
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/download`,
    { params },
  );
  return res.data.data as {
    download_url: string;
    filename: string;
    version_number: number;
    file_size_bytes: number;
    expires_in_seconds: number;
  };
}

export async function shareDocument(
  documentId: string,
  data: ShareDocumentRequest,
) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/share`,
    data,
  );
  return res.data.data as DocumentAccess;
}

export async function revokeAccess(documentId: string, accessId: string) {
  const res = await aerostackApiClient.delete(
    `/documents/${documentId}/share/${accessId}`,
  );
  return res.data.data;
}

export async function listAccess(documentId: string) {
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/access`,
  );
  return res.data.data as {
    access: DocumentAccess[];
    count: number;
  };
}

export async function checkBatchAccess(documentIds: string[]) {
  const res = await aerostackApiClient.post(
    `/documents/check-access`,
    { document_ids: documentIds },
  );
  return res.data.data as {
    access: Record<string, boolean>;
    signers?: Record<string, Array<{ name: string; email: string; role_label: string; status?: string }>>;
  };
}

export async function requestAccess(documentId: string, requesterEmail: string, message?: string) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/request-access`,
    { requester_email: requesterEmail, message },
  );
  return res.data.data as { message: string; owner_email: string };
}

export async function getShareLink(documentId: string) {
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/share-link`,
  );
  return res.data.data as {
    share_url: string;
    visibility: string;
    slug: string;
    document_id: string;
  };
}

export async function triggerSync(documentId: string, fileData?: { fileData: string; fileMime: string }) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/sync`,
    fileData ?? {},
  );
  return res.data.data as {
    synced: boolean;
    version?: number;
    skipped?: boolean;
    error?: string;
    requiresClientUpload?: boolean;
  };
}

/**
 * Resolves a canva.link short URL to its destination via the backend proxy.
 * Replaces the Vite dev-only proxy so it works in deployed environments too.
 */
export async function resolveCanvaLink(code: string) {
  const res = await aerostackApiClient.get("/documents/canva/resolve", {
    params: { code },
  });
  return res.data.data as { location: string };
}

/**
 * Fetches a Canva design page's raw HTML via the backend proxy (Googlebot UA).
 * `path` is a Canva design view path, e.g. /design/<id>/<token>/view?mode=preview
 */
export async function fetchCanvaProxyHtml(path: string) {
  const res = await aerostackApiClient.get("/documents/canva/proxy", {
    params: { path },
  });
  return res.data.data as { html: string };
}

// ─────────────────── Dropbox Sign (formerly DocuSign) e-Signature API ───────────────────

export interface DropboxSigner {
  name: string;
  email: string;
  role_label: string;
}

export type DocuSignSigner = DropboxSigner;

export interface DropboxSignerWithUrl extends DropboxSigner {
  signing_url: string;
}

export type DocuSignSignerWithUrl = DropboxSignerWithUrl;

export interface IntakeFormField {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "date" | "textarea";
  required?: boolean;
  placeholder?: string;
  /**
   * Restrict this field to a specific signer (by recipient_id).
   * Empty/undefined = shown to every signer.
   * Used by templates so each role only fills the fields their role needs.
   */
  recipient_id?: string;
}

/** Drag-and-drop placement of a field on the PDF (PDF point coordinates). */
export interface FieldMarker {
  /** "__signature__" / "__date__" / "__name__" or an intake form field id. */
  field_id: string;
  /** 1-indexed page number. */
  page: number;
  /** Left edge in PDF points (0 = left). */
  x: number;
  /** Bottom edge in PDF points (0 = bottom — PDF native coordinates). */
  y: number;
  width: number;
  height: number;
  /** Recipient ID this marker belongs to (e.g. "1", "2"). Empty = any signer. */
  recipient_id?: string;
}

export interface DropboxSignRequest {
  envelope_id: string;
  document_id: string;
  org_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  status: "sent" | "delivered" | "completed" | "voided" | "declined";
  signers: Array<DropboxSigner & { recipient_id: string; status: string; sign_link?: string; signed_at?: string; signed_ip?: string }>;
  email_subject: string;
  email_body?: string;
  intake_form_fields?: IntakeFormField[];
  notify_emails?: string[];
  certificate_stored: boolean;
  signed_pdf_key?: string;
  certificate_key?: string;
  completed_at?: string;
}

export type DocuSignEnvelope = DropboxSignRequest;

export interface CreateSignRequest {
  signers: DropboxSigner[];
  email_subject?: string;
  email_body?: string;
  intake_form_fields?: IntakeFormField[];
  notify_emails?: string[];
  /** Sender-defined positions for signature, date, name, and form fields. */
  field_markers?: FieldMarker[];
}

export type CreateEnvelopeRequest = CreateSignRequest;

export interface CreateSignResponse {
  envelope_id: string;
  document_id: string;
  status: string;
  signers: Array<{
    name: string;
    email: string;
    role_label: string;
    sign_link: string;
    email_sent: boolean;
  }>;
  created_at: string;
  email_warnings?: string[];
}

export type CreateEnvelopeResponse = CreateSignResponse;

/**
 * Creates a Dropbox Sign request for a document and returns embedded signing URLs.
 * The signers can sign directly within Aerostack via the returned URLs (no redirect).
 */
export async function createDropboxSignRequest(
  documentId: string,
  data: CreateSignRequest,
) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/sign/envelopes`,
    data,
  );
  return res.data.data as CreateSignResponse;
}

export const createDocuSignEnvelope = createDropboxSignRequest;

/**
 * Lists all Dropbox Sign requests for a given document.
 */
export async function listDropboxSignRequests(documentId: string) {
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/sign/envelopes`,
  );
  return res.data.data as { envelopes: DropboxSignRequest[]; count: number };
}

export const listDocuSignEnvelopes = listDropboxSignRequests;

/**
 * Gets a fresh embedded signing URL for a specific signer on an existing request.
 * The returned URL can be opened in an iframe/popup so the user never leaves Aerostack.
 */
export async function getDropboxSignSigningUrl(
  documentId: string,
  envelopeId: string,
  signerEmail: string,
) {
  const res = await aerostackApiClient.post(
    `/documents/${documentId}/sign/envelopes/${envelopeId}/signing-url`,
    { signer_email: signerEmail },
  );
  return res.data.data as { signing_url: string; envelope_id: string; signer_email: string; client_id?: string };
}

export const getDocuSignSigningUrl = getDropboxSignSigningUrl;

// ─────────────────── Public sign-link API (no auth) ───────────────────

import axios from "axios";

const publicSignClient = axios.create({
  baseURL: import.meta.env.VITE_Aerostack_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

export interface SignLinkResolveResponse {
  envelope_id: string;
  document_id: string;
  document_title: string;
  sender_email: string;
  status: string;
  me: {
    name: string;
    email: string;
    role_label: string;
    recipient_id: string;
    status: string;
  };
  signers: Array<{ name: string; role_label: string; status: string }>;
  intake_form_fields: IntakeFormField[];
  intake_form_responses: { responses: Record<string, string>; submitted_at: string } | null;
  intake_form_already_submitted: boolean;
  already_signed: boolean;
  /** Sequential routing — only true if this signer is the active one. */
  is_my_turn: boolean;
  /** True when earlier signers haven't completed yet. */
  waiting_on_earlier_signers: boolean;
  active_recipient_id: string;
}

/** Verifies a sign-link token and returns the envelope + intake form schema. */
export async function resolveSignLink(envelopeId: string, token: string) {
  const res = await publicSignClient.get(
    `/documents/sign/link/${envelopeId}`,
    { params: { token } },
  );
  return res.data.data as SignLinkResolveResponse;
}

/**
 * Submits the intake form and returns a fresh DocuSign embedded signing URL.
 * Call this from the public sign landing page right before rendering the iframe.
 */
export async function startSignLink(
  envelopeId: string,
  token: string,
  intakeResponses: Record<string, string>,
) {
  const res = await publicSignClient.post(
    `/documents/sign/link/${envelopeId}/start`,
    { token, intake_responses: intakeResponses },
  );
  return res.data.data as {
    signing_url: string;
    envelope_id: string;
    signer_email: string;
    client_id?: string;
  };
}

/**
 * Submits the intake form + drawn signature → Aerostack bakes everything into the
 * PDF and locks the result in S3 with Object Lock COMPLIANCE.
 * No DocuSign iframe involved — the entire signing UX stays in Aerostack.
 */
export async function completeSignLink(
  envelopeId: string,
  token: string,
  data: {
    intake_responses: Record<string, string>;
    signature_data_url: string;
    typed_name: string;
  },
) {
  const res = await publicSignClient.post(
    `/documents/sign/link/${envelopeId}/complete`,
    { token, ...data },
  );
  return res.data.data as {
    success: boolean;
    all_signers_complete: boolean;
    signed_pdf_sha256: string;
    message: string;
  };
}


/**
 * Returns short-lived presigned URLs for the Aerostack-signed PDF + DocuSign
 * certificate. Used by the Signatures tab to preview/download a completed
 * envelope. Only signed envelopes have these URLs available.
 */
export async function getSignedEnvelopeDownload(
  documentId: string,
  envelopeId: string,
  options: { forceDownload?: boolean } = {},
) {
  const params = options.forceDownload ? "?download=1" : "";
  const res = await aerostackApiClient.get(
    `/documents/${documentId}/sign/envelopes/${envelopeId}/signed-download${params}`,
  );
  return res.data.data as {
    envelope_id: string;
    signed_pdf_url: string;
    signed_pdf_sha256: string | null;
    certificate_url: string | null;
    completed_at: string | null;
    expires_in_seconds: number;
  };
}
