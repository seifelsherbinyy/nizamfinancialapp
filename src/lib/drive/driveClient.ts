/**
 * NIZAM · Thin Drive REST client (files list/get/create/update media)
 * Implemented by: KIRO Contract 2 / Phase 2.2
 * Depends on: oauth.ts
 *
 * Plain fetch against Drive API v3 (no gapi discovery client).
 * https://developers.google.com/workspace/drive/api/reference/rest/v3
 * Exponential backoff with jitter on 403/429/5xx.
 */
import { getAccessToken } from '@/lib/drive/oauth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const META_FIELDS = 'id,name,version,modifiedTime,parents,appProperties,mimeType';

export interface DriveFileMeta {
  id: string;
  name: string;
  /** Drive's monotonically-increasing file version (optimistic concurrency guard). */
  version: number;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  mimeType?: string;
}

export interface DriveClient {
  listFiles(query: string): Promise<DriveFileMeta[]>;
  getFileMeta(fileId: string): Promise<DriveFileMeta>;
  downloadText(fileId: string): Promise<string>;
  createFolder(name: string, parentId?: string): Promise<DriveFileMeta>;
  createTextFile(
    name: string,
    content: string,
    options?: { parents?: string[]; appProperties?: Record<string, string>; mimeType?: string },
  ): Promise<DriveFileMeta>;
  updateTextFile(fileId: string, content: string, mimeType?: string): Promise<DriveFileMeta>;
  deleteFile(fileId: string): Promise<void>;
}

class DriveHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Drive API error ${status}: ${body.slice(0, 300)}`);
    this.name = 'DriveHttpError';
  }
}

function isRetryable(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type TokenProvider = () => string | null;

interface RawMeta {
  id?: string;
  name?: string;
  version?: string | number;
  modifiedTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  mimeType?: string;
}

function toMeta(raw: RawMeta): DriveFileMeta {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    version: typeof raw.version === 'string' ? Number(raw.version) : (raw.version ?? 0),
    modifiedTime: raw.modifiedTime,
    parents: raw.parents,
    appProperties: raw.appProperties,
    mimeType: raw.mimeType,
  };
}

/**
 * Create a Drive client. `getToken` defaults to the live OAuth session;
 * tests inject their own.
 */
export function createDriveClient(getToken: TokenProvider = getAccessToken): DriveClient {
  async function request(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    const token = getToken();
    if (!token) throw new Error('NIZAM: not signed in to Google Drive');
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      if (isRetryable(res.status) && attempt < 4) {
        const backoff = Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
        await sleep(backoff);
        return request(url, init, attempt + 1);
      }
      throw new DriveHttpError(res.status, body);
    }
    return res;
  }

  return {
    async listFiles(query: string): Promise<DriveFileMeta[]> {
      const files: DriveFileMeta[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: query,
          fields: `nextPageToken,files(${META_FIELDS})`,
          pageSize: '100',
          spaces: 'drive',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await request(`${API}/files?${params}`, { method: 'GET' });
        const data = (await res.json()) as { files?: RawMeta[]; nextPageToken?: string };
        for (const f of data.files ?? []) files.push(toMeta(f));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return files;
    },

    async getFileMeta(fileId: string): Promise<DriveFileMeta> {
      const res = await request(`${API}/files/${fileId}?fields=${encodeURIComponent(META_FIELDS)}`, {
        method: 'GET',
      });
      return toMeta((await res.json()) as RawMeta);
    },

    async downloadText(fileId: string): Promise<string> {
      const res = await request(`${API}/files/${fileId}?alt=media`, { method: 'GET' });
      return res.text();
    },

    async createFolder(name: string, parentId?: string): Promise<DriveFileMeta> {
      const res = await request(`${API}/files?fields=${encodeURIComponent(META_FIELDS)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      });
      return toMeta((await res.json()) as RawMeta);
    },

    async createTextFile(name, content, options): Promise<DriveFileMeta> {
      const metadata = {
        name,
        mimeType: options?.mimeType ?? 'application/json',
        ...(options?.parents ? { parents: options.parents } : {}),
        ...(options?.appProperties ? { appProperties: options.appProperties } : {}),
      };
      const boundary = `nizam_${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${metadata.mimeType}\r\n\r\n` +
        `${content}\r\n` +
        `--${boundary}--`;
      const res = await request(
        `${UPLOAD_API}/files?uploadType=multipart&fields=${encodeURIComponent(META_FIELDS)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        },
      );
      return toMeta((await res.json()) as RawMeta);
    },

    async updateTextFile(fileId, content, mimeType = 'application/json'): Promise<DriveFileMeta> {
      const res = await request(
        `${UPLOAD_API}/files/${fileId}?uploadType=media&fields=${encodeURIComponent(META_FIELDS)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': mimeType },
          body: content,
        },
      );
      return toMeta((await res.json()) as RawMeta);
    },

    async deleteFile(fileId: string): Promise<void> {
      await request(`${API}/files/${fileId}`, { method: 'DELETE' });
    },
  };
}
