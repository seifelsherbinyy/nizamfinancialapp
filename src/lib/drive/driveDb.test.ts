/**
 * NIZAM · driveDb tests — ensure/create, atomic save, snapshots, conflict guard
 * Implemented by: KIRO Contract 2 / Phase 2.2
 */
import { describe, it, expect } from 'vitest';
import { FakeDrive } from '../../../tests/helpers/fakeDriveClient.ts';
import { ensureDb, loadDb, saveDb, pruneSnapshots, DB_FILE_NAME, SNAPSHOT_RETAIN } from './driveDb.ts';
import { createEmptyDb, SCHEMA_VERSION } from '@/lib/db/schema';

const NOW = '2026-07-29T10:00:00.000Z';
const empty = () => createEmptyDb(NOW);

describe('ensureDb', () => {
  it('creates the NIZAM folder and canonical file on first run', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), empty);
    expect(handle.fileId).toBeTruthy();
    expect(handle.folderId).toBeTruthy();
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    const files = [...drive.files.values()];
    expect(files.some((f) => f.name === 'NIZAM')).toBe(true);
    expect(files.some((f) => f.name === DB_FILE_NAME)).toBe(true);
  });

  it('reuses the existing folder + file on subsequent runs', async () => {
    const drive = new FakeDrive();
    const first = await ensureDb(drive.client(), empty);
    const second = await ensureDb(drive.client(), empty);
    expect(second.handle.fileId).toBe(first.handle.fileId);
    expect(drive.files.size).toBe(2); // folder + db only
  });

  it('honors a preferred folder id', async () => {
    const drive = new FakeDrive();
    const folder = await drive.client().createFolder('MyFolder');
    const { handle } = await ensureDb(drive.client(), empty, folder.id);
    expect(handle.folderId).toBe(folder.id);
  });
});

describe('saveDb / loadDb', () => {
  it('round-trips: create -> save -> reload; snapshot appears', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), empty);

    const edited = structuredClone(db);
    edited.payees.push({ id: 'pay_1', name: 'Test Payee' });
    const result = await saveDb(drive.client(), handle, edited, new Date('2026-07-29T10:05:00Z'));
    expect(result.conflict).toBe(false);

    const reloaded = await loadDb(drive.client(), handle.fileId);
    expect(reloaded.db.payees).toEqual([{ id: 'pay_1', name: 'Test Payee' }]);
    if (!result.conflict) expect(reloaded.version).toBe(result.version);

    const snapshots = [...drive.files.values()].filter(
      (f) => f.appProperties?.nizam === 'snapshot',
    );
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.name).toMatch(/^nizam_db\.\d{8}-\d{4}\.json$/);
  });

  it('detects a version conflict and returns the remote instead of clobbering', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), empty);

    // Another device writes first.
    const other = structuredClone(db);
    other.payees.push({ id: 'pay_other', name: 'Other Device' });
    drive.externalUpdate(handle.fileId, JSON.stringify(other));

    const mine = structuredClone(db);
    mine.payees.push({ id: 'pay_mine', name: 'This Device' });
    const result = await saveDb(drive.client(), handle, mine);

    expect(result.conflict).toBe(true);
    if (result.conflict) {
      expect(result.remote.db.payees).toEqual([{ id: 'pay_other', name: 'Other Device' }]);
    }
    // Canonical file untouched by our attempted save.
    const remote = await loadDb(drive.client(), handle.fileId);
    expect(remote.db.payees.map((p) => p.id)).toEqual(['pay_other']);
  });

  it('prunes snapshots beyond the retention limit', async () => {
    const drive = new FakeDrive();
    const { handle, db } = await ensureDb(drive.client(), empty);
    let current = { ...handle };
    for (let i = 0; i < SNAPSHOT_RETAIN + 4; i++) {
      const edited = structuredClone(db);
      edited.meta.revision = i + 1;
      const res = await saveDb(
        drive.client(),
        current,
        edited,
        new Date(Date.UTC(2026, 6, 1 + i, 12, 0)),
      );
      expect(res.conflict).toBe(false);
      if (!res.conflict) current = { ...current, version: res.version };
    }
    await pruneSnapshots(drive.client(), handle.folderId);
    const snapshots = [...drive.files.values()].filter(
      (f) => f.appProperties?.nizam === 'snapshot',
    );
    expect(snapshots.length).toBeLessThanOrEqual(SNAPSHOT_RETAIN);
  });
});
