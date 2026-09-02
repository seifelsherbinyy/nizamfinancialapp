/**
 * NIZAM · Optional finance-agent Drive knowledge capability
 * Implemented by: PFOS Contract 12 / Phase 10 environment loader, extended by Contract 13 §5
 * Owning requirements: no ambient reads outside environment.ts, no secret output, read-only Drive
 * knowledge, and an unavailable archive must not become a fabricated answer
 * Depends on: ./environment (the injected EnvSource)
 *
 * Absence is deliberate: the finance agent may boot offline without Drive. A partial or
 * unsubstituted capability is refused so the process cannot quietly operate with half an archive.
 */
import type { EnvSource } from './environment.ts';

export const KNOWLEDGE_DRIVE_ENTRIES = Object.freeze({
  rootFolderId: 'KNOWLEDGE_DRIVE_ROOT_ID',
  refreshToken: 'KNOWLEDGE_DRIVE_REFRESH_TOKEN',
  clientId: 'KNOWLEDGE_DRIVE_CLIENT_ID',
  clientSecret: 'KNOWLEDGE_DRIVE_CLIENT_SECRET',
  tokenUrl: 'KNOWLEDGE_DRIVE_TOKEN_URL',
} as const);

export type KnowledgeDriveEntry = (typeof KNOWLEDGE_DRIVE_ENTRIES)[keyof typeof KNOWLEDGE_DRIVE_ENTRIES];

export class KnowledgeEnvironmentError extends Error {
  readonly entry: KnowledgeDriveEntry | null;

  constructor(entry: KnowledgeDriveEntry | null, message: string) {
    super(`NIZAM knowledge environment: ${message}`);
    this.name = 'KnowledgeEnvironmentError';
    this.entry = entry;
  }
}

export interface KnowledgeSecret {
  readonly entry: KnowledgeDriveEntry;
  toString(): string;
  toJSON(): string;
}

const secretValues = new WeakMap<KnowledgeSecret, string>();

function secret(entry: KnowledgeDriveEntry, value: string): KnowledgeSecret {
  const holder = Object.freeze({
    entry,
    toString: (): string => '[redacted]',
    toJSON: (): string => '[redacted]',
  }) as KnowledgeSecret;
  secretValues.set(holder, value);
  return holder;
}

export function revealKnowledgeSecret(value: KnowledgeSecret): string {
  const resolved = secretValues.get(value);
  if (resolved === undefined) throw new KnowledgeEnvironmentError(value.entry, 'the secret was not produced by the knowledge loader');
  return resolved;
}

export interface KnowledgeDriveConfig {
  readonly rootFolderId: string;
  readonly refreshToken: KnowledgeSecret;
  readonly clientId: string;
  readonly clientSecret: KnowledgeSecret;
  readonly tokenUrl: string;
}

function present(env: EnvSource, entry: KnowledgeDriveEntry): string | null {
  const value = env[entry];
  if (value === undefined || value.trim().length === 0) return null;
  if (/^<[A-Z][A-Z0-9_]*>$/.test(value.trim())) {
    throw new KnowledgeEnvironmentError(entry, `${entry} still carries its template placeholder`);
  }
  return value;
}

/** Return null only when every Drive knowledge entry is absent; partial configuration is refused. */
export function loadKnowledgeDriveConfig(env: EnvSource): KnowledgeDriveConfig | null {
  const entries = Object.values(KNOWLEDGE_DRIVE_ENTRIES);
  const values = entries.map((entry) => [entry, present(env, entry)] as const);
  if (values.every(([, value]) => value === null)) return null;
  const missing = values.find(([, value]) => value === null)?.[0];
  if (missing !== undefined) throw new KnowledgeEnvironmentError(missing, `the Drive knowledge capability is partial; ${missing} is absent`);
  const byName = Object.fromEntries(values) as Record<KnowledgeDriveEntry, string>;
  const rootFolderId = byName[KNOWLEDGE_DRIVE_ENTRIES.rootFolderId] ?? '';
  const tokenUrl = byName[KNOWLEDGE_DRIVE_ENTRIES.tokenUrl] ?? '';
  if (!/^[A-Za-z0-9_-]+$/.test(rootFolderId)) throw new KnowledgeEnvironmentError(KNOWLEDGE_DRIVE_ENTRIES.rootFolderId, 'the Drive root folder reference is malformed');
  if (!tokenUrl.startsWith('https://')) throw new KnowledgeEnvironmentError(KNOWLEDGE_DRIVE_ENTRIES.tokenUrl, 'the token endpoint must use HTTPS');
  return Object.freeze({
    rootFolderId,
    refreshToken: secret(KNOWLEDGE_DRIVE_ENTRIES.refreshToken, byName[KNOWLEDGE_DRIVE_ENTRIES.refreshToken] ?? ''),
    clientId: byName[KNOWLEDGE_DRIVE_ENTRIES.clientId] ?? '',
    clientSecret: secret(KNOWLEDGE_DRIVE_ENTRIES.clientSecret, byName[KNOWLEDGE_DRIVE_ENTRIES.clientSecret] ?? ''),
    tokenUrl,
  });
}

export function describeKnowledgeDrivePresence(env: EnvSource): Readonly<Record<KnowledgeDriveEntry, boolean>> {
  return Object.freeze(Object.fromEntries(Object.values(KNOWLEDGE_DRIVE_ENTRIES).map((entry) => [entry, present(env, entry) !== null])) as Record<KnowledgeDriveEntry, boolean>);
}
