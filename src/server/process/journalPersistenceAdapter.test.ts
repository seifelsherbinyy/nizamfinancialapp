// @vitest-environment node
/**
 * NIZAM · Local journal persistence adapter tests
 * Owning authority: PFOS Contract 14; Contracts 06 and 12; money rules.
 * Phase 14 — offline single-window composition; Stage 5 (durability hardening)
 * Depends on: journalPersistenceAdapter.ts, singleWindowFlow.ts (the port under test).
 *
 * Synthetic-only: no real host, no real Drive, no real THABAT. `JournalLedgerPort` and
 * `JournalMirrorPort` are deterministic in-memory doubles standing in for nizamcore's THABAT
 * ledger and an approved Drive mirror respectively — see the adapter's module header for why
 * this repository never implements the real far side of either boundary.
 *
 * Each behaviour is shown by forcing the failure it guards against, not only by observing a
 * happy path succeed (contract 06 §9 discipline, reused here for the same reason).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createJournalPersistenceAdapter,
  type JournalLedgerPort,
  type JournalMirrorPort,
  type JournalPersistenceAdapter,
} from './journalPersistenceAdapter.ts';
import type { SingleWindowJournalRecord } from './singleWindowFlow.ts';

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()!();
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nizam-journal-adapter-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Deterministic in-memory THABAT stand-in: an append-only row list keyed by entryRef. */
function createLedgerDouble(): JournalLedgerPort & { rows: Array<{ entryRef: string; contentHash: string }> } {
  const rows: Array<{ entryRef: string; contentHash: string }> = [];
  return {
    rows,
    appendRow(entryRef, contentHash) {
      rows.push({ entryRef, contentHash });
      return { rowRef: `ledger-row-${rows.length}` };
    },
    countRowsFor(entryRef) {
      return rows.filter((row) => row.entryRef === entryRef).length;
    },
  };
}

/** Deterministic in-memory approved-Drive-mirror stand-in. */
function createMirrorDouble(): JournalMirrorPort & { store: Map<string, string> } {
  const store = new Map<string, string>();
  let counter = 0;
  return {
    store,
    mirror(_entryRef, _contentHash, payload) {
      counter += 1;
      const mirrorRef = `drive-mirror-${counter}`;
      store.set(mirrorRef, payload);
      return { mirrorRef };
    },
    readBack(mirrorRef) {
      const payload = store.get(mirrorRef);
      if (payload === undefined) throw new Error(`no mirrored payload for ${mirrorRef}`);
      return { contentHash: createHash('sha256').update(payload, 'utf8').digest('hex') };
    },
  };
}

function fixedNow(iso: string): () => string {
  return () => iso;
}

describe('journalPersistenceAdapter', () => {
  it('runs a synthetic journal end-to-end: LOCAL_WRITTEN, then ledger, then an approved Drive mirror', () => {
    const dataDir = tempDataDir();
    const ledger = createLedgerDouble();
    const mirror = createMirrorDouble();
    const adapter = createJournalPersistenceAdapter({
      dataDir,
      ledger,
      mirror,
      mirrorApproved: () => true,
      now: fixedNow('2026-09-02T00:00:00.000Z'),
    });

    const receipt = adapter.appendWithReceipt('Synthetic YAWMIYAT dump.', 'synthetic-source-1', '2026-09-02T00:00:00.000Z');

    expect(receipt.state).toBe('DRIVE_MIRRORED');
    expect(receipt.local).not.toBeNull();
    expect(receipt.ledger).not.toBeNull();
    expect(receipt.mirror).not.toBeNull();
    expect(receipt.pending).toEqual([]);

    // Local file exists and parses (the "VPS/local" receipt, proven independently of the call above).
    const localVerification = adapter.verify(receipt.entryRef);
    expect(localVerification.exists).toBe(true);
    expect(localVerification.parses).toBe(true);
    expect(localVerification.hashMatches).toBe(true);
    const onDisk = JSON.parse(readFileSync(receipt.local!.path, 'utf8')) as SingleWindowJournalRecord & { text: string };
    expect(onDisk.text).toBe('Synthetic YAWMIYAT dump.');

    // THABAT-stand-in ledger row exists exactly once.
    expect(ledger.countRowsFor(receipt.entryRef)).toBe(1);

    // Approved Drive-mirror stand-in exists and matches the local content hash.
    expect(receipt.mirror!.contentHash).toBe(receipt.local!.contentHash);
    const mirrored = mirror.store.get(receipt.mirror!.mirrorRef);
    expect(mirrored).toBe(readFileSync(receipt.local!.path, 'utf8'));
  });

  it('stays LOCAL_WRITTEN with no ledger/mirror configured (pure local-only rehearsal)', () => {
    const dataDir = tempDataDir();
    const adapter = createJournalPersistenceAdapter({ dataDir, now: fixedNow('2026-09-02T00:00:00.000Z') });
    const receipt = adapter.appendWithReceipt('Local-only entry.', 'synthetic-source-2', '2026-09-02T00:00:01.000Z');
    expect(receipt.state).toBe('LOCAL_WRITTEN');
    expect(receipt.ledger).toBeNull();
    expect(receipt.mirror).toBeNull();
  });

  it('refuses to mirror without HIMAYAH approval, and still reaches LOCAL_WRITTEN (never blocks local truth)', () => {
    const dataDir = tempDataDir();
    const ledger = createLedgerDouble();
    const mirror = createMirrorDouble();
    const adapter = createJournalPersistenceAdapter({
      dataDir,
      ledger,
      mirror,
      mirrorApproved: () => false,
      now: fixedNow('2026-09-02T00:00:00.000Z'),
    });
    const receipt = adapter.appendWithReceipt('Not yet Drive-safe.', 'synthetic-source-3', '2026-09-02T00:00:02.000Z');
    expect(receipt.state).toBe('LOCAL_WRITTEN');
    expect(receipt.mirror).toBeNull();
    expect(mirror.store.size).toBe(0);
    expect(ledger.countRowsFor(receipt.entryRef)).toBe(1);
  });

  it('stages a Drive mirror failure for retry and NEVER rolls back the already-verified local truth', () => {
    const dataDir = tempDataDir();
    const ledger = createLedgerDouble();
    const failingMirror: JournalMirrorPort = {
      mirror: () => {
        throw new Error('synthetic transient Drive failure');
      },
      readBack: () => {
        throw new Error('unreachable');
      },
    };
    const adapter = createJournalPersistenceAdapter({
      dataDir,
      ledger,
      mirror: failingMirror,
      mirrorApproved: () => true,
      now: fixedNow('2026-09-02T00:00:00.000Z'),
    });
    const receipt = adapter.appendWithReceipt('Mirror will fail once.', 'synthetic-source-4', '2026-09-02T00:00:03.000Z');

    expect(receipt.state).toBe('STAGED_RETRY');
    expect(receipt.pending).toEqual(['mirror']);
    expect(receipt.local).not.toBeNull(); // local truth retained
    expect(adapter.verify(receipt.entryRef).hashMatches).toBe(true); // still valid on disk

    // Now let the mirror succeed and retry.
    const workingMirror = createMirrorDouble();
    const healedAdapter = createJournalPersistenceAdapter({
      dataDir,
      ledger,
      mirror: workingMirror,
      mirrorApproved: () => true,
      now: fixedNow('2026-09-02T00:00:04.000Z'),
    });
    const retried = healedAdapter.retryStaged();
    expect(retried).toHaveLength(1);
    expect(retried[0]!.state).toBe('DRIVE_MIRRORED');
    expect(ledger.countRowsFor(receipt.entryRef)).toBe(1); // ledger never duplicated across the retry
  });

  it('detects tampering: mutating the on-disk entry after a successful write fails independent verification', () => {
    const dataDir = tempDataDir();
    const adapter = createJournalPersistenceAdapter({ dataDir, now: fixedNow('2026-09-02T00:00:00.000Z') });
    const receipt = adapter.appendWithReceipt('Untampered content.', 'synthetic-source-5', '2026-09-02T00:00:05.000Z');
    expect(adapter.verify(receipt.entryRef).hashMatches).toBe(true);

    // Tamper the single verification condition: rewrite the stored text in place.
    const tampered = JSON.parse(readFileSync(receipt.local!.path, 'utf8')) as SingleWindowJournalRecord & { text: string };
    writeFileSync(receipt.local!.path, JSON.stringify({ ...tampered, text: 'ATTACKER-MODIFIED CONTENT' }, null, 2), 'utf8');

    const verification = adapter.verify(receipt.entryRef);
    expect(verification.exists).toBe(true);
    expect(verification.parses).toBe(true);
    expect(verification.hashMatches).toBe(false); // the one condition we tampered now fails, as required
  });

  it('restart/re-run with identical inputs never creates a duplicate file or a duplicate ledger row', () => {
    const dataDir = tempDataDir();
    const ledger = createLedgerDouble();
    const mirror = createMirrorDouble();
    const config = { dataDir, ledger, mirror, mirrorApproved: () => true, now: fixedNow('2026-09-02T00:00:06.000Z') };

    const firstProcess: JournalPersistenceAdapter = createJournalPersistenceAdapter(config);
    const first = firstProcess.appendWithReceipt('Idempotent payload.', 'synthetic-source-6', '2026-09-02T00:00:06.000Z');
    expect(first.state).toBe('DRIVE_MIRRORED');

    // Simulate a process restart: a brand-new adapter instance over the SAME dataDir.
    const secondProcess: JournalPersistenceAdapter = createJournalPersistenceAdapter(config);
    const second = secondProcess.appendWithReceipt('Idempotent payload.', 'synthetic-source-6', '2026-09-02T00:00:06.000Z');

    expect(second.entryRef).toBe(first.entryRef);
    expect(second.state).toBe(first.state);
    expect(ledger.countRowsFor(first.entryRef)).toBe(1); // still exactly one row, not two
    expect(mirror.store.size).toBe(1); // still exactly one mirrored copy, not two
  });

  it('fails closed on an invalid payload without writing anything to disk', () => {
    const dataDir = tempDataDir();
    const adapter = createJournalPersistenceAdapter({ dataDir, now: fixedNow('2026-09-02T00:00:07.000Z') });
    const receipt = adapter.appendWithReceipt('   ', 'synthetic-source-7', '2026-09-02T00:00:07.000Z');
    expect(receipt.state).toBe('FAILED');
    expect(receipt.failureCode).toBe('JOURNAL_PAYLOAD_TEXT_INVALID');
    expect(receipt.local).toBeNull();
  });

  it('the SingleWindowJournalPort-compatible append() throws rather than silently returning a partial record on failure', () => {
    const dataDir = tempDataDir();
    const adapter = createJournalPersistenceAdapter({ dataDir, now: fixedNow('2026-09-02T00:00:08.000Z') });
    expect(() => adapter.append('', 'synthetic-source-8', '2026-09-02T00:00:08.000Z')).toThrow();
  });
});
