/**
 * NIZAM · Sync engine — local cache <-> Drive source-of-truth + conflict resolution
 * Implemented by: KIRO Contract 2 / Phase 2.4
 * Depends on: driveDb.ts, lib/db/localCache.ts, lib/db/schema.ts
 *
 * Strategy (steering drive-db.md):
 *  - pull on open; debounced push on change; offline dirty queue flushed on 'online'.
 *  - On version conflict: 3-way entity merge (base = last-synced, local = cache,
 *    remote = Drive). Both-changed => local wins (last-write-wins) WITH an audit
 *    entry appended to meta.conflicts.
 */
import type { NizamDb, ConflictEntry } from '@/lib/db/schema';
import type { DriveClient } from '@/lib/drive/driveClient';
import { loadDb, saveDb, type DriveDbHandle } from '@/lib/drive/driveDb';

// ---------------------------------------------------------------------------
// 3-way merge (pure, unit-tested)
// ---------------------------------------------------------------------------

function toMap<T>(items: T[], getKey: (item: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of items) m.set(getKey(item), item);
  return m;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface MergeResult {
  merged: NizamDb;
  conflicts: ConflictEntry[];
}

interface CollectionMerge<T> {
  result: T[];
  conflicts: ConflictEntry[];
}

function mergeCollection<T>(
  collection: string,
  base: T[],
  local: T[],
  remote: T[],
  nowIso: string,
  getKey: (item: T) => string,
): CollectionMerge<T> {
  const baseMap = toMap(base, getKey);
  const localMap = toMap(local, getKey);
  const remoteMap = toMap(remote, getKey);
  const conflicts: ConflictEntry[] = [];
  const result: T[] = [];
  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);

    const localChanged = !deepEqual(b, l);
    const remoteChanged = !deepEqual(b, r);

    if (!localChanged && !remoteChanged) {
      if (b !== undefined) result.push(b);
    } else if (localChanged && !remoteChanged) {
      if (l !== undefined) result.push(l); // local add/edit; local delete drops it
    } else if (!localChanged && remoteChanged) {
      if (r !== undefined) result.push(r); // remote add/edit; remote delete drops it
    } else {
      // Both changed (edit/edit, edit/delete, add/add divergent).
      if (deepEqual(l, r)) {
        if (l !== undefined) result.push(l); // converged independently — no conflict
      } else {
        // Local wins (the saving device), audited.
        if (l !== undefined) result.push(l);
        conflicts.push({
          id: `cfl_${collection}_${id}_${nowIso}`,
          at: nowIso,
          collection,
          entityId: id,
          resolution: 'local_wins',
          note:
            l === undefined
              ? 'local deleted, remote edited — local delete kept'
              : r === undefined
                ? 'local edited, remote deleted — local edit kept'
                : 'both edited — local version kept',
        });
      }
    }
  }
  return { result, conflicts };
}

interface SingletonMerge<T> {
  result: T;
  conflicts: ConflictEntry[];
}

/**
 * Three-way merge for a SINGLETON object (one per database, no id) such as the
 * financial policy. Same resolution order as a collection entity: an unopposed
 * change wins, an identical change is not a conflict, and a genuine divergence
 * resolves to local WITH an audit entry — a policy change must never be lost
 * silently, because safe-to-spend reads it.
 */
function mergeSingleton<T>(
  collection: string,
  base: T,
  local: T,
  remote: T,
  nowIso: string,
): SingletonMerge<T> {
  const localChanged = !deepEqual(base, local);
  const remoteChanged = !deepEqual(base, remote);
  if (!localChanged && remoteChanged) return { result: remote, conflicts: [] };
  if (localChanged && remoteChanged && !deepEqual(local, remote)) {
    return {
      result: local,
      conflicts: [
        {
          id: `cfl_${collection}_singleton_${nowIso}`,
          at: nowIso,
          collection,
          entityId: collection,
          resolution: 'local_wins',
          note: 'both edited the policy — local version kept',
        },
      ],
    };
  }
  return { result: local, conflicts: [] };
}

/**
 * Merge three versions of the database. Deterministic; collection-by-collection,
 * entity-by-entity. Returns the merged db plus audit entries for true conflicts.
 */
export function merge3(base: NizamDb, local: NizamDb, remote: NizamDb, nowIso: string): MergeResult {
  const byId = (item: { id: string }) => item.id;
  const accounts = mergeCollection('accounts', base.accounts, local.accounts, remote.accounts, nowIso, byId);
  const groups = mergeCollection('categoryGroups', base.categoryGroups, local.categoryGroups, remote.categoryGroups, nowIso, byId);
  const categories = mergeCollection('categories', base.categories, local.categories, remote.categories, nowIso, byId);
  const months = mergeCollection('months', base.months, local.months, remote.months, nowIso, (m) => m.month);
  const payees = mergeCollection('payees', base.payees, local.payees, remote.payees, nowIso, byId);
  const transactions = mergeCollection('transactions', base.transactions, local.transactions, remote.transactions, nowIso, byId);
  const obligations = mergeCollection('obligations', base.obligations, local.obligations, remote.obligations, nowIso, byId);
  const policy = mergeSingleton('policy', base.policy, local.policy, remote.policy, nowIso);

  const newConflicts = [
    ...accounts.conflicts,
    ...groups.conflicts,
    ...categories.conflicts,
    ...months.conflicts,
    ...payees.conflicts,
    ...transactions.conflicts,
    ...obligations.conflicts,
    ...policy.conflicts,
  ];

  const merged: NizamDb = {
    schemaVersion: local.schemaVersion,
    meta: {
      ...local.meta,
      revision: Math.max(local.meta.revision, remote.meta.revision) + 1,
      updatedAt: nowIso,
      // Union of conflict logs plus the fresh entries (dedup by id).
      conflicts: dedupeConflicts([...remote.meta.conflicts, ...local.meta.conflicts, ...newConflicts]),
    },
    accounts: accounts.result,
    categoryGroups: groups.result,
    categories: categories.result,
    months: months.result,
    payees: payees.result,
    transactions: transactions.result,
    obligations: obligations.result,
    policy: policy.result,
  };
  return { merged, conflicts: newConflicts };
}

function dedupeConflicts(entries: ConflictEntry[]): ConflictEntry[] {
  const seen = new Set<string>();
  const out: ConflictEntry[] = [];
  for (const e of entries) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Push / pull orchestration
// ---------------------------------------------------------------------------

export interface SyncDeps {
  client: DriveClient;
  handle: DriveDbHandle;
  /** Base (last-synced) copy for 3-way merges. */
  getBase: () => NizamDb;
  now?: () => Date;
}

export interface PushOutcome {
  db: NizamDb;
  version: number;
  merged: boolean;
  conflicts: ConflictEntry[];
}

/**
 * Push local state to Drive. If Drive moved on us, merge (base/local/remote),
 * then save the merged result (single retry — if it conflicts again we surface it).
 */
export async function pushDb(deps: SyncDeps, local: NizamDb): Promise<PushOutcome> {
  const now = deps.now ?? (() => new Date());
  const first = await saveDb(deps.client, deps.handle, local, now());
  if (!first.conflict) {
    return { db: local, version: first.version, merged: false, conflicts: [] };
  }

  const nowIso = now().toISOString();
  const { merged, conflicts } = merge3(deps.getBase(), local, first.remote.db, nowIso);
  const retryHandle: DriveDbHandle = { ...deps.handle, version: first.remote.version };
  const second = await saveDb(deps.client, retryHandle, merged, now());
  if (second.conflict) {
    throw new Error('NIZAM sync: repeated version conflict — retry later');
  }
  return { db: merged, version: second.version, merged: true, conflicts };
}

/** Pull the latest remote db. */
export async function pullDb(deps: Pick<SyncDeps, 'client' | 'handle'>): Promise<{ db: NizamDb; version: number }> {
  return loadDb(deps.client, deps.handle.fileId);
}

// ---------------------------------------------------------------------------
// Debounce helper for push-on-change (wired by the store)
// ---------------------------------------------------------------------------

export function createDebouncer(delayMs = 1500): {
  schedule: (fn: () => void) => void;
  cancel: () => void;
  flush: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  return {
    schedule(fn) {
      pending = fn;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const run = pending;
        pending = null;
        run?.();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      const run = pending;
      pending = null;
      run?.();
    },
  };
}
