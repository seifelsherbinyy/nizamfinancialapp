/**
 * NIZAM · Google Drive read-only knowledge client
 * Implemented by: PFOS Contract 06 / Phase 2.4, extended by Contract 13 §5
 * Owning requirements: bounded read-only archive access, no Drive writes, no credential logging,
 * and explicit refusal on an unbounded document response
 * Depends on: ./driveKnowledge, ./knowledgeEnvironment
 *
 * This is the only network-owning implementation for the knowledge reader. It receives a complete
 * runtime capability from the composition root; it does not read the ambient environment and it exposes no write
 * method. The configured root folder is enforced by the caller's traversal, not by a broad search.
 */
import {
  DRIVE_DOCUMENT_MIME,
  DRIVE_FOLDER_MIME,
  type DriveKnowledgeClient,
  type DriveKnowledgeFile,
} from './driveKnowledge.ts';
import { revealKnowledgeSecret, type KnowledgeDriveConfig } from '../config/knowledgeEnvironment.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FIELDS = 'id,name,mimeType,size,modifiedTime';
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;

interface RawDriveFile {
  readonly id?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly size?: string;
  readonly modifiedTime?: string;
}

interface RawTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

function mapFile(raw: RawDriveFile): DriveKnowledgeFile {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '',
    mimeType: raw.mimeType ?? '',
    size: raw.size === undefined ? null : Number(raw.size),
    modifiedTime: raw.modifiedTime ?? null,
  };
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok) throw new Error(`NIZAM knowledge: Drive content request failed with status ${String(response.status)}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('NIZAM knowledge: Drive document exceeds the bounded read size');
  }
  if (response.body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('NIZAM knowledge: Drive document exceeds the bounded read size');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let next = await reader.read();
    while (!next.done) {
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error('NIZAM knowledge: Drive document exceeds the bounded read size');
      chunks.push(chunk);
      next = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Build a read-only Drive client from the owner-provided OAuth refresh capability. */
export function createGoogleDriveKnowledgeClient(config: KnowledgeDriveConfig): DriveKnowledgeClient {
  let accessToken = '';
  let accessTokenExpiresAt = 0;

  async function token(): Promise<string> {
    if (accessToken.length > 0 && Date.now() < accessTokenExpiresAt) return accessToken;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: revealKnowledgeSecret(config.clientSecret),
      refresh_token: revealKnowledgeSecret(config.refreshToken),
      grant_type: 'refresh_token',
    });
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`NIZAM knowledge: token exchange failed with status ${String(response.status)}`);
    const parsed = (await response.json()) as RawTokenResponse;
    const next = parsed.access_token ?? '';
    if (next.length === 0 || Buffer.byteLength(next, 'utf8') > MAX_ACCESS_TOKEN_BYTES) {
      throw new Error('NIZAM knowledge: token exchange returned no usable access token');
    }
    accessToken = next;
    accessTokenExpiresAt = Date.now() + Math.max(30_000, Number(parsed.expires_in ?? 300) * 1000 - 30_000);
    return accessToken;
  }

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token()}` },
    });
  }

  return {
    async listChildren(parentId: string): Promise<readonly DriveKnowledgeFile[]> {
      const files: DriveKnowledgeFile[] = [];
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          q: `'${parentId}' in parents and trashed = false`,
          fields: `nextPageToken,files(${DRIVE_FIELDS})`,
          pageSize: '100',
          spaces: 'drive',
        });
        if (pageToken.length > 0) params.set('pageToken', pageToken);
        const response = await request(`${DRIVE_API}/files?${params.toString()}`);
        if (!response.ok) throw new Error(`NIZAM knowledge: Drive listing failed with status ${String(response.status)}`);
        const raw = (await response.json()) as { readonly files?: readonly RawDriveFile[]; readonly nextPageToken?: string };
        for (const file of raw.files ?? []) {
          const mapped = mapFile(file);
          if (mapped.id.length > 0 && (mapped.mimeType === DRIVE_FOLDER_MIME || mapped.mimeType === DRIVE_DOCUMENT_MIME || mapped.mimeType.startsWith('text/') || mapped.mimeType === 'application/json')) {
            files.push(mapped);
          }
        }
        pageToken = raw.nextPageToken ?? '';
      } while (pageToken.length > 0);
      return files;
    },

    async readText(file: DriveKnowledgeFile, maxBytes: number): Promise<string> {
      const url = file.mimeType === DRIVE_DOCUMENT_MIME
        ? `${DRIVE_UPLOAD_API.replace('/upload', '')}/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fplain`
        : `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`;
      return boundedText(await request(url), maxBytes);
    },
  };
}
