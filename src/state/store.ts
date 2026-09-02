/**
 * NIZAM · Zustand store — app state, actions, sync triggers
 * Implemented by: KIRO Contract 2 / Phase 2.4
 * Repaired by: KIRO Contract 2 / Phase 2.4 — never substitute local or remote
 *   for an absent merge base; pass null through to the sync engine.
 * Depends on: lib/drive/*, lib/db/*
 *
 * Data flow: mutate() -> new immutable NizamDb in memory -> Dexie cache (dirty)
 *            -> debounced push to Drive (when signed in + online).
 */
import { create } from 'zustand';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import {
  getCache,
  markDirty,
  readDbFromCache,
  readSyncPoint,
  saveSyncPoint,
  writeDbToCache,
} from '@/lib/db/localCache';
import { createDriveClient } from '@/lib/drive/driveClient';
import { ensureDb, type DriveDbHandle } from '@/lib/drive/driveDb';
import { createDebouncer, pullDb, pushDb } from '@/lib/drive/sync';
import { getSession, signIn, signOut } from '@/lib/drive/oauth';

export type SessionStatus = 'signedOut' | 'signingIn' | 'signedIn';
export type SyncStatus = 'idle' | 'pulling' | 'pushing' | 'offline' | 'error';

export interface NizamState {
  sessionStatus: SessionStatus;
  sessionError: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  /** In-memory working copy (source for all selectors). Null until hydrated. */
  db: NizamDb | null;
  handle: DriveDbHandle | null;
  /** Last-synced base for 3-way merge. */
  baseDb: NizamDb | null;

  hydrateFromCache: () => Promise<void>;
  connectDrive: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Apply a mutation to a draft copy of the db; persists + schedules push. */
  mutate: (fn: (draft: NizamDb) => void) => void;
  /** Force an immediate push (used by tests / on 'online'). */
  flushNow: () => Promise<void>;
}

const debouncer = createDebouncer(1500);
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

export const useNizamStore = create<NizamState>((set, get) => {
  async function persistLocal(db: NizamDb): Promise<void> {
    const cache = getCache();
    await writeDbToCache(cache, db);
    await markDirty(cache, true);
  }

  async function doPush(): Promise<void> {
    const { db, handle, baseDb } = get();
    if (!db || !handle || !getSession() || !isOnline()) return;
    set({ syncStatus: 'pushing', syncError: null });
    try {
      const outcome = await pushDb(
        { client: createDriveClient(), handle, getBase: () => baseDb },
        db,
      );
      const newHandle: DriveDbHandle = { ...handle, version: outcome.version };
      await saveSyncPoint(getCache(), {
        fileId: newHandle.fileId,
        folderId: newHandle.folderId,
        version: outcome.version,
        db: outcome.db,
      });
      set({ db: outcome.db, baseDb: outcome.db, handle: newHandle, syncStatus: 'idle' });
      if (outcome.merged) {
        await writeDbToCache(getCache(), outcome.db);
      }
    } catch (e) {
      set({ syncStatus: 'error', syncError: e instanceof Error ? e.message : String(e) });
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void get().flushNow();
    });
    window.addEventListener('offline', () => set({ syncStatus: 'offline' }));
  }

  return {
    sessionStatus: 'signedOut',
    sessionError: null,
    syncStatus: 'idle',
    syncError: null,
    db: null,
    handle: null,
    baseDb: null,

    async hydrateFromCache() {
      const cache = getCache();
      const [db, syncPoint] = await Promise.all([readDbFromCache(cache), readSyncPoint(cache)]);
      if (db) {
        set({
          db,
          baseDb: syncPoint?.baseDb ?? null,
          handle: syncPoint
            ? { fileId: syncPoint.fileId, folderId: syncPoint.folderId, version: syncPoint.version }
            : null,
        });
      }
    },

    async connectDrive() {
      set({ sessionStatus: 'signingIn', sessionError: null });
      try {
        await signIn();
        set({ sessionStatus: 'signedIn', syncStatus: 'pulling' });
        const client = createDriveClient();
        const folderId = (import.meta.env.VITE_NIZAM_DRIVE_FOLDER_ID as string | undefined) ?? '';
        const { handle } = await ensureDb(
          client,
          () => createEmptyDb(new Date().toISOString()),
          folderId,
        );
        // Fresh pull to be safe (ensureDb already loaded, but re-read is cheap and uniform).
        const latest = await pullDb({ client, handle });
        const local = get().db;
        const cache = getCache();
        const { isDirty } = await import('@/lib/db/localCache');
        const dirty = local ? await isDirty(cache) : false;
        if (local && dirty) {
          // Local offline edits exist: push (merges against remote if needed).
          set({ db: local, handle: { ...handle, version: latest.version } });
          const outcome = await pushDb(
            {
              client,
              handle: { ...handle, version: latest.version },
              getBase: () => get().baseDb,
            },
            local,
          );
          await saveSyncPoint(cache, {
            fileId: handle.fileId,
            folderId: handle.folderId,
            version: outcome.version,
            db: outcome.db,
          });
          await writeDbToCache(cache, outcome.db);
          set({
            db: outcome.db,
            baseDb: outcome.db,
            handle: { ...handle, version: outcome.version },
            syncStatus: 'idle',
          });
        } else {
          await writeDbToCache(cache, latest.db);
          await saveSyncPoint(cache, {
            fileId: handle.fileId,
            folderId: handle.folderId,
            version: latest.version,
            db: latest.db,
          });
          set({
            db: latest.db,
            baseDb: latest.db,
            handle: { ...handle, version: latest.version },
            syncStatus: 'idle',
          });
        }
      } catch (e) {
        set({
          sessionStatus: 'signedOut',
          syncStatus: 'error',
          sessionError: e instanceof Error ? e.message : String(e),
        });
      }
    },

    async disconnect() {
      debouncer.cancel();
      await signOut();
      set({ sessionStatus: 'signedOut' });
    },

    mutate(fn) {
      const current = get().db;
      if (!current) throw new Error('NIZAM: mutate() before db is loaded');
      const draft = structuredClone(current);
      fn(draft);
      draft.meta.revision = current.meta.revision + 1;
      draft.meta.updatedAt = new Date().toISOString();
      set({ db: draft });
      void persistLocal(draft);
      if (getSession() && isOnline()) {
        debouncer.schedule(() => void doPush());
      }
    },

    async flushNow() {
      debouncer.cancel();
      await doPush();
    },
  };
});
