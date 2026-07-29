/**
 * NIZAM · Drive-as-database adapter — load/save canonical nizam_db.json
 * Implemented by: KIRO Contract 2 / Phase 2.2
 * Depends on: driveClient.ts, lib/db/schema.ts, lib/db/migrations.ts
 *
 * Save discipline (steering drive-db.md):
 *  1. Optimistic-concurrency check: remote `version` must equal our last-synced version,
 *     otherwise the caller must merge first (saveDb returns { conflict: true }).
 *  2. Snapshot `nizam_db.YYYYMMDD-HHmm.json` is uploaded BEFORE the canonical write,
 *     so a crash mid-save never loses the previous state.
 *  3. Canonical file is media-updated (atomic per Drive call); new version captured.
 *  4. Old snapshots pruned (keep newest SNAPSHOT_RETAIN).
 */
import type { DriveClient, DriveFileMeta } from '@/lib/drive/driveClient';
import { migrate } from '@/lib/db/migrations';
import type { NizamDb } from '@/lib/db/schema';

export const DB_FILE_NAME = 'nizam_db.json';
export const FOLDER_NAME = 'NIZAM';
export const SNAPSHOT_RETAIN = 10;

const APP_PROP_DB = { nizam: 'db' } as const;
const APP_PROP_SNAPSHOT = { nizam: 'snapshot' } as const;

export interface DriveDbHandle {
  folderId: string;
  fileId: string;
  /** Drive file version at our last successful load/save. */
  version: number;
}

export interface LoadResult {
  db: NizamDb;
  version: number;
}

export type SaveResult =
  | { conflict: false; version: number }
  | { conflict: true; remote: LoadResult };

function snapshotName(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `nizam_db.${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/**
 * Find or create the NIZAM folder + canonical db file.
 * If `preferredFolderId` is set (VITE_NIZAM_DRIVE_FOLDER_ID) it is used as-is.
 * Returns the handle plus the loaded (or freshly created) database.
 */
export async function ensureDb(
  client: DriveClient,
  createEmpty: () => NizamDb,
  preferredFolderId?: string,
): Promise<{ handle: DriveDbHandle; db: NizamDb }> {
  let folderId = preferredFolderId?.trim() || null;

  if (!folderId) {
    const folders = await client.listFiles(
      `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    );
    folderId = folders[0]?.id ?? (await client.createFolder(FOLDER_NAME)).id;
  }

  const existing = await client.listFiles(
    `name='${DB_FILE_NAME}' and '${folderId}' in parents and trashed=false`,
  );
  const dbFile = existing[0];

  if (dbFile) {
    const { db, version } = await loadDb(client, dbFile.id);
    return { handle: { folderId, fileId: dbFile.id, version }, db };
  }

  const fresh = createEmpty();
  const created = await client.createTextFile(DB_FILE_NAME, JSON.stringify(fresh, null, 2), {
    parents: [folderId],
    appProperties: { ...APP_PROP_DB },
  });
  return { handle: { folderId, fileId: created.id, version: created.version }, db: fresh };
}

/** Download + migrate + validate the canonical db file. */
export async function loadDb(client: DriveClient, fileId: string): Promise<LoadResult> {
  const [meta, text] = await Promise.all([client.getFileMeta(fileId), client.downloadText(fileId)]);
  const raw: unknown = JSON.parse(text);
  const db = migrate(raw);
  return { db, version: meta.version };
}

/**
 * Save with optimistic concurrency + snapshot + prune.
 * On version conflict, returns the fresh remote instead of writing.
 */
export async function saveDb(
  client: DriveClient,
  handle: DriveDbHandle,
  db: NizamDb,
  now: Date = new Date(),
): Promise<SaveResult> {
  // 1. Concurrency guard.
  const remoteMeta = await client.getFileMeta(handle.fileId);
  if (remoteMeta.version !== handle.version) {
    const remote = await loadDb(client, handle.fileId);
    return { conflict: true, remote };
  }

  const json = JSON.stringify(db, null, 2);

  // 2. Snapshot BEFORE touching the canonical file.
  await client.createTextFile(snapshotName(now), json, {
    parents: [handle.folderId],
    appProperties: { ...APP_PROP_SNAPSHOT },
  });

  // 3. Atomic media update of the canonical file.
  const updated = await client.updateTextFile(handle.fileId, json);

  // 4. Prune old snapshots (best-effort).
  try {
    await pruneSnapshots(client, handle.folderId);
  } catch {
    // pruning is housekeeping — never fail a save over it
  }

  return { conflict: false, version: updated.version };
}

/** Keep only the newest SNAPSHOT_RETAIN snapshots in the folder. */
export async function pruneSnapshots(client: DriveClient, folderId: string): Promise<void> {
  const snapshots = await client.listFiles(
    `'${folderId}' in parents and appProperties has { key='nizam' and value='snapshot' } and trashed=false`,
  );
  const byNameDesc = [...snapshots].sort((a, b) => b.name.localeCompare(a.name));
  const stale: DriveFileMeta[] = byNameDesc.slice(SNAPSHOT_RETAIN);
  for (const s of stale) {
    await client.deleteFile(s.id);
  }
}
