import { aerostackApiClient } from "@/api/client";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime?: string;
  webViewLink: string;
  iconLink?: string;
  size?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  sharingUser?: { displayName: string; emailAddress: string };
  shared?: boolean;
}

export type DriveTab = "shared" | "mine";

export interface CreateDriveFileRequest {
  name: string;
  type: "document" | "spreadsheet" | "presentation";
}

export interface CreateDriveFileResponse {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  document_id: string;
}

/** Lists the logged-in user's Drive files via the backend service account. */
export async function listDriveFiles(params: {
  tab?: DriveTab;
  query?: string;
}): Promise<DriveFile[]> {
  const res = await aerostackApiClient.get("/documents/drive/files", { params });
  return res.data.data.files as DriveFile[];
}

/** Creates a new Drive file (Doc/Sheet/Slides) and registers it for S3 auto-sync. */
export async function createDriveFile(
  data: CreateDriveFileRequest,
): Promise<CreateDriveFileResponse> {
  const res = await aerostackApiClient.post("/documents/drive/create", data);
  return res.data.data as CreateDriveFileResponse;
}
