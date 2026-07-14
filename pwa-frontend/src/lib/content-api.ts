/**
 * Content Agent API client — typed fetch wrappers for the content pipeline.
 */
import type {
  ContentBrief,
  ContentDraft,
} from './content-agent-config';

const TOOLS_API_BASE = (import.meta.env.VITE_TOOLS_API_URL ?? '').replace(/\/+$/, '');
const CONTENT_API_BASE = (import.meta.env.VITE_CONTENT_API_URL ?? '').replace(/\/+$/, '');

function appendContentPath(base: string): string {
  if (!base) return '';
  return base.endsWith('/content') ? base : `${base}/content`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

const CONTENT_ENDPOINTS = unique([
  appendContentPath(CONTENT_API_BASE),
  appendContentPath(TOOLS_API_BASE),
  CONTENT_API_BASE,
]);

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function requestToEndpoint<T>(
  endpoint: string,
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${endpoint}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message ?? `${res.status}: ${res.statusText}`;
      return { success: false, error: msg };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: message };
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  if (CONTENT_ENDPOINTS.length === 0) {
    return { success: false, error: 'VITE_CONTENT_API_URL or VITE_TOOLS_API_URL not configured' };
  }

  let last: ApiResponse<T> = { success: false, error: 'Request failed' };
  for (const endpoint of CONTENT_ENDPOINTS) {
    const res = await requestToEndpoint<T>(endpoint, path, options);
    if (res.success) return res;
    const err = String(res.error ?? '').toLowerCase();
    const retryable =
      err.includes('unknown action') ||
      err.includes('not found') ||
      err.includes('404') ||
      err.includes('failed to fetch') ||
      err.includes('network error');
    last = res;
    if (!retryable) return res;
  }
  return last;
}

export interface BriefInput {
  platform: string;
  topic: string;
  audience: string;
  tone: string;
  brandVoice: string;
  ctaType: string;
  ctaLink?: string;
  customContext?: string;
  storyHook?: string;
  scheduledDate?: string;
}

interface ListBriefsResponse {
  briefs: Record<string, unknown>[];
  count: number;
}

interface GetBriefResponse {
  brief: Record<string, unknown>;
  drafts: Record<string, unknown>[];
}

interface GenerateDraftResponse {
  draft_id: string;
  draft: Record<string, unknown>;
}

/** At least one field should be set (server validates). */
export type UpdateDraftPayload = {
  content?: string;
  suggested_hashtags?: string[];
  image_s3_key?: string;
  clear_image?: boolean;
};

const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024;

export async function uploadContentDraftImage(
  briefId: string,
  draftId: string,
  file: File,
  opts?: { content?: string; suggested_hashtags?: string[] },
): Promise<{ success: boolean; error?: string; image_url?: string | null }> {
  if (!file.type.startsWith('image/')) {
    return { success: false, error: 'Please choose an image file' };
  }
  if (file.size > MAX_DRAFT_IMAGE_BYTES) {
    return { success: false, error: 'Image must be 8 MB or smaller' };
  }

  const presign = await contentApi.presignImageUpload(briefId, draftId, file.type);
  if (!presign.success || !presign.data?.upload_url || !presign.data?.image_key) {
    return { success: false, error: presign.error ?? 'Could not start upload' };
  }

  const put = await fetch(presign.data.upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': presign.data.content_type || file.type },
  });
  if (!put.ok) {
    return { success: false, error: `Upload failed (${put.status})` };
  }

  const patch: UpdateDraftPayload = { image_s3_key: presign.data.image_key };
  if (opts?.content !== undefined) patch.content = opts.content;
  if (opts?.suggested_hashtags !== undefined) patch.suggested_hashtags = opts.suggested_hashtags;

  const upd = await contentApi.updateDraft(briefId, draftId, patch);
  if (!upd.success) {
    return { success: false, error: upd.error ?? 'Could not attach image to draft' };
  }

  return { success: true, image_url: upd.data?.image_url ?? undefined };
}

export const contentApi = {
  createBrief: (brief: BriefInput) =>
    request<{ brief_id: string; brief: Record<string, unknown> }>('', {
      method: 'POST',
      body: JSON.stringify({ action: 'create_brief', brief }),
    }),

  generateDraft: (briefId: string, brief: BriefInput) =>
    request<GenerateDraftResponse>('', {
      method: 'POST',
      body: JSON.stringify({ action: 'generate_draft', brief_id: briefId, brief }),
    }),

  listBriefs: () =>
    request<ListBriefsResponse>('?action=list_briefs'),

  getBrief: (briefId: string) =>
    request<GetBriefResponse>(`?action=get_brief&id=${briefId}`),

  updateStatus: (
    briefId: string,
    status: string,
    options?: { sk?: string; scheduled_date?: string },
  ) =>
    request<{ brief_id: string; status: string }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_status',
        brief_id: briefId,
        status,
        ...(options?.sk != null ? { sk: options.sk } : {}),
        ...(options?.scheduled_date != null && options.scheduled_date !== ''
          ? { scheduled_date: options.scheduled_date }
          : {}),
      }),
    }),

  updateDraft: (
    briefId: string,
    draftId: string,
    payload: UpdateDraftPayload,
  ) =>
    request<{ brief_id: string; draft_id: string; updated: boolean; image_url?: string | null }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update_draft',
        brief_id: briefId,
        draft_id: draftId,
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        ...(payload.suggested_hashtags !== undefined
          ? { suggested_hashtags: payload.suggested_hashtags }
          : {}),
        ...(payload.image_s3_key !== undefined ? { image_s3_key: payload.image_s3_key } : {}),
        ...(payload.clear_image ? { clear_image: true } : {}),
      }),
    }),

  presignImageUpload: (briefId: string, draftId: string, contentType: string) =>
    request<{
      upload_url: string;
      image_key: string;
      content_type: string;
      expires_in: number;
    }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'presign_image_upload',
        brief_id: briefId,
        draft_id: draftId,
        content_type: contentType,
      }),
    }),

  postToLinkedIn: (
    briefId: string,
    options?: { draftId?: string; markPublished?: boolean; force?: boolean },
  ) =>
    request<{
      brief_id: string;
      linkedin_post_urn?: string;
      published: boolean;
    }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'post_to_linkedin',
        brief_id: briefId,
        ...(options?.draftId != null && options.draftId !== '' ? { draft_id: options.draftId } : {}),
        ...(options?.markPublished === false ? { mark_published: false } : {}),
        ...(options?.force ? { force: true } : {}),
      }),
    }),

  listCalendar: () =>
    request<{ slots: Record<string, unknown>[]; count: number }>('?action=list_calendar'),

  deleteBrief: (briefId: string) =>
    request<{
      brief_id: string;
      deleted_items: number;
      deleted_images: number;
      image_delete_errors: number;
    }>('', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete_brief', brief_id: briefId }),
    }),
};
