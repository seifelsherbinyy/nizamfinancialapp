/**
 * NIZAM · sync tests — merge3 matrix + conflict-merge push
 * Implemented by: KIRO Contract 2 / Phase 2.4
 */
import { describe, it, expect } from 'vitest';
import { merge3, pushDb, noCommonAncestorBase } from './sync.ts';
import { ensureDb } from './driveDb.ts';
import { createEmptyDb, type NizamDb } from '@/lib/db/schema';
import { FakeDrive } from '../../../tests/helpers/fakeDriveClient.ts';

const NOW = '2026-07-29T12:00:00.000Z';

function baseDb(): NizamDb {
  const db = createEmptyDb('2026-07-01T00:00:00.000Z');
  db.payees.push({ id: 'pay_1', name: 'Original' });
  db.transactions.push({
    id: 'txn_1',
    accountId: 'acc_1',
    date: '2026-07-10',
    payee: 'Original',
    categoryId: null,
    memo: '',
    amount: -1000,
    cleared: 'cleared',
    currency: 'EGP',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  });
  return db;
}

describe('merge3', () => {
  it('keeps local-only changes', () => {
    const base = baseDb();
    const local = structuredClone(base);
    local.payees.push({ id: 'pay_2', name: 'Local Add' });
    const remote = structuredClone(base);

    const { merged, conflicts } = merge3(base, local, remote, NOW);
    expect(merged.payees.map((p) => p.id).sort()).toEqual(['pay_1', 'pay_2']);
    expect(conflicts).toEqual([]);
  });

  it('takes remote-only changes', () => {
    const base = baseDb();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.transactions[0]!.memo = 'edited remotely';

    const { merged, conflicts } = merge3(base, local, remote, NOW);
    expect(merged.transactions[0]?.memo).toBe('edited remotely');
    expect(conflicts).toEqual([]);
  });

  it('handles deletes on either side', () => {
    const base = baseDb();
    const local = structuredClone(base);
    local.payees = []; // local delete
    const remote = structuredClone(base);
    remote.transactions = []; // remote delete

    const { merged, conflicts } = merge3(base, local, remote, NOW);
    expect(merged.payees).toEqual([]);
    expect(merged.transactions).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('both-edited: local wins WITH an audit entry', () => {
    const base = baseDb();
    const local = structuredClone(base);
    local.transactions[0]!.memo = 'local edit';
    const remote = structuredClone(base);
    remote.transactions[0]!.memo = 'remote edit';

    const { merged, conflicts } = merge3(base, local, remote, NOW);
    expect(merged.transactions[0]?.memo).toBe('local edit');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.resolution).toBe('local_wins');
    expect(merged.meta.conflicts.some((c) => c.entityId === 'txn_1')).toBe(true);
  });

  it('identical independent edits converge without conflict', () => {
    const base = baseDb();
    const local = structuredClone(base);
    local.transactions[0]!.memo = 'same edit';
    const remote = structuredClone(base);
    remote.transactions[0]!.memo = 'same edit';

    const { conflicts } = merge3(base, local, remote, NOW);
    expect(conflicts).toEqual([]);
  });

  it('is deterministic', () => {
    const base = baseDb();
    const local = structuredClone(base);
    local.transactions[0]!.amount = -2000;
    const remote = structuredClone(base);
    remote.transactions[0]!.amount = -3000;

    const a = merge3(base, local, remote, NOW);
    const b = merge3(base, local, remote, NOW);
    expect(a.merged).toEqual(b.merged);
  });
});

describe('pushDb with concurrent edit', () => {
  it('merges against the moved remote and saves (audit logged)', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());

    // Simulate another device editing remotely (version bumps).
    const remoteEdit = structuredClone(db);
    remoteEdit.payees.push({ id: 'pay_remote', name: 'Remote Add' });
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    // Local edit on stale version.
    const local = structuredClone(db);
    local.payees.push({ id: 'pay_local', name: 'Local Add' });

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => db, now: () => new Date(NOW) },
      local,
    );

    expect(outcome.merged).toBe(true);
    expect(outcome.db.payees.map((p) => p.id).sort()).toEqual(['pay_1', 'pay_local', 'pay_remote']);
    expect(outcome.conflicts).toEqual([]); // adds on both sides — no true conflict

    // Offline edits flush deterministically: remote now equals merged.
    const remoteNow = JSON.parse(
      await drive.client().downloadText(handle.fileId),
    ) as NizamDb;
    expect(remoteNow.payees.map((p) => p.id).sort()).toEqual(['pay_1', 'pay_local', 'pay_remote']);
  });

  it('logs an audit conflict when both sides edited the same entity', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());

    const remoteEdit = structuredClone(db);
    remoteEdit.transactions[0]!.memo = 'remote memo';
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    const local = structuredClone(db);
    local.transactions[0]!.memo = 'local memo';

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => db, now: () => new Date(NOW) },
      local,
    );

    expect(outcome.merged).toBe(true);
    expect(outcome.db.transactions[0]?.memo).toBe('local memo');
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.db.meta.conflicts.length).toBeGreaterThan(0);
  });
});

describe('merge base is absent (no sync point)', () => {
  it('builds an empty base that keeps the local schema version', () => {
    const local = baseDb();
    const base = noCommonAncestorBase(local);
    expect(base.schemaVersion).toBe(local.schemaVersion);
    expect(base.payees).toEqual([]);
    expect(base.transactions).toEqual([]);
    expect(base.accounts).toEqual([]);
    expect(base.meta.conflicts).toEqual([]);
  });

  it('unions both sides instead of silently dropping either one', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());

    // Another device added a payee remotely; the version moves on.
    const remoteEdit = structuredClone(db);
    remoteEdit.payees.push({ id: 'pay_remote', name: 'Remote Add' });
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    // This device added a different payee while holding no sync point.
    const local = structuredClone(db);
    local.payees.push({ id: 'pay_local', name: 'Local Add' });

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => null, now: () => new Date(NOW) },
      local,
    );

    expect(outcome.merged).toBe(true);
    // Regression: substituting REMOTE for the missing base dropped pay_local,
    // and substituting LOCAL dropped pay_remote. Both must survive.
    expect(outcome.db.payees.map((p) => p.id).sort()).toEqual(['pay_1', 'pay_local', 'pay_remote']);
    expect(outcome.db.transactions.map((t) => t.id)).toEqual(['txn_1']);
  });

  it('records the missing base in the audit log rather than degrading silently', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());
    const remoteEdit = structuredClone(db);
    remoteEdit.payees.push({ id: 'pay_remote', name: 'Remote Add' });
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => null, now: () => new Date(NOW) },
      structuredClone(db),
    );

    const audit = outcome.db.meta.conflicts.filter((c) => c.entityId === 'mergeBase');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.collection).toBe('meta');
    expect(audit[0]?.resolution).toBe('merged');
    expect(outcome.conflicts.some((c) => c.entityId === 'mergeBase')).toBe(true);
  });

  it('does not emit the missing-base audit entry when a real base exists', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());
    const remoteEdit = structuredClone(db);
    remoteEdit.payees.push({ id: 'pay_remote', name: 'Remote Add' });
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    const local = structuredClone(db);
    local.payees.push({ id: 'pay_local', name: 'Local Add' });

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => db, now: () => new Date(NOW) },
      local,
    );

    expect(outcome.db.meta.conflicts.filter((c) => c.entityId === 'mergeBase')).toEqual([]);
  });

  it('KNOWN LIMIT until tombstones: with no base a local delete cannot be preserved', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), () => baseDb());

    // Remote still holds the payee; this device deleted it but has no sync point,
    // so the deletion is indistinguishable from never having held the row.
    const remoteEdit = structuredClone(db);
    remoteEdit.payees.push({ id: 'pay_remote', name: 'Remote Add' });
    drive.externalUpdate(handle.fileId, JSON.stringify(remoteEdit));

    const local = structuredClone(db);
    local.payees = local.payees.filter((p) => p.id !== 'pay_1');

    const outcome = await pushDb(
      { client: drive.client(), handle, getBase: () => null, now: () => new Date(NOW) },
      local,
    );

    // Documented, audited limitation — a union cannot infer a deletion.
    expect(outcome.db.payees.map((p) => p.id).sort()).toEqual(['pay_1', 'pay_remote']);
    expect(outcome.db.meta.conflicts.some((c) => c.entityId === 'mergeBase')).toBe(true);
  });
});
