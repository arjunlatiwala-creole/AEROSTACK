// AOS Document Host Module — Shared Types

export type SourceProvider = "canva" | "google_drive" | "manual";

export type DocumentVisibility = "public" | "internal" | "restricted";

export type DocumentPermission = "view" | "edit" | "admin";

export type GranteeType = "person" | "role" | "org" | "public";

export interface AosDocument {
  document_id: string;
  org_id: string;
  owner_email: string;
  title: string;
  slug: string;
  description?: string;
  source_provider: SourceProvider;
  source_id?: string;
  source_url?: string;
  mime_type: string;
  current_version: number;
  visibility: DocumentVisibility;
  tags: string[];
  is_deleted: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
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
  grantee_type: GranteeType;
  grantee_id: string;
  permission: DocumentPermission;
  granted_by: string;
  granted_at: string;
}

export interface CreateDocumentRequest {
  title: string;
  slug: string;
  description?: string;
  source_provider: SourceProvider;
  source_id?: string;
  source_url?: string;
  mime_type: string;
  visibility: DocumentVisibility;
  tags?: string[];
}

export interface UpdateDocumentRequest {
  title?: string;
  slug?: string;
  description?: string;
  visibility?: DocumentVisibility;
  tags?: string[];
}

export interface ShareDocumentRequest {
  grantee_type: GranteeType;
  grantee_id: string;
  permission: DocumentPermission;
}

export interface UploadUrlResponse {
  upload_url: string;
  s3_key: string;
  expires_in_seconds: number;
}

export interface WebhookPayload {
  provider: SourceProvider;
  source_id: string;
  event_type: "file_updated" | "file_deleted";
  timestamp: string;
}
