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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createJournalPersistenceAdapter,
  type JournalLedgerPort,
  type JournalMirrorPort,
  type JournalPersistenceAdapter,
  type JournalPersistenceAdapterConfig,
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


/**
 * Frozen record identity.
 *
 * The defect these tests exist for: identity used to be derived from the payload, so an edited
 * retry of the same logical journal session hashed differently, landed on a different path and
 * became a SECOND entry with nothing reporting a problem. Every test below forces that failure
 * mode and requires it to be refused, not merely observes a happy path.
 */
describe('journalPersistenceAdapter - frozen record identity (SMOKE-04/05/07/08/09)', () => {
  const RECORD = 'yawmiyat-2026-09-02-synthetic';

  function entriesDir(dataDir: string): string {
    return join(dataDir, 'journal', 'entries');
  }

  function canonicalCount(dataDir: string): number {
    const dir = entriesDir(dataDir);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  }

  function readDoc(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  }

  /** A clock that advances on every read, so anything frozen must be frozen on purpose. */
  function advancingClock(): () => string {
    let tick = 0;
    return () => {
      const iso = new Date(Date.UTC(2026, 8, 2, 12, 0, tick)).toISOString();
      tick += 1;
      return iso;
    };
  }

  function wire(dataDir: string, over: Partial<JournalPersistenceAdapterConfig> = {}) {
    const ledger = createLedgerDouble();
    const mirror = createMirrorDouble();
    const config: JournalPersistenceAdapterConfig = {
      dataDir,
      ledger,
      mirror,
      mirrorApproved: () => true,
      now: advancingClock(),
      ...over,
    };
    return { ledger, mirror, config, adapter: createJournalPersistenceAdapter(config) };
  }

  it('SMOKE-04 one request produces one canonical JSON, one derived mirror, one THABAT event, and a fully populated receipt', () => {
    const dataDir = tempDataDir();
    const { adapter, ledger, mirror } = wire(dataDir);

    const receipt = adapter.appendRecord({
      recordId: RECORD,
      text: 'Synthetic session body.',
      sourceRef: 'synthetic-source-frozen-1',
      recordedAt: '2026-09-02T09:00:00.000Z',
    });

    expect(receipt.status).toBe('OK');
    expect(receipt.mode).toBe('CREATE');
    expect(receipt.recordId).toBe(RECORD);
    expect(receipt.canonicalPath).not.toBeNull();
    expect(receipt.mirrorPath).not.toBeNull();
    expect(receipt.schemaValid).toBe(true);
    expect(receipt.hashMatch).toBe(true);
    expect(receipt.readBackConfirmed).toBe(true);
    expect(receipt.recoveryAction).toBeNull();

    // Canonical artifact: exactly one, at a path derived from the record identity only.
    expect(canonicalCount(dataDir)).toBe(1);
    expect(receipt.canonicalPath).toBe(join(entriesDir(dataDir), `${RECORD}.json`));

    // Derived artifact and ledger event: exactly one each.
    expect(mirror.store.size).toBe(1);
    expect(ledger.countRowsFor(RECORD)).toBe(1);

    const doc = readDoc(receipt.canonicalPath!);
    expect(doc.recordId).toBe(RECORD);
    expect(doc.revision).toBe(1);
    expect(doc.schemaVersion).toBe(2);
    expect(typeof doc.payloadHash).toBe('string');
  });

  it('SMOKE-05 replaying the identical request five times leaves exactly one logical record, and calls two to five report IDEMPOTENT_REPLAY', () => {
    const dataDir = tempDataDir();
    const { adapter, ledger, mirror } = wire(dataDir);
    const request = {
      recordId: RECORD,
      text: 'Replay me.',
      sourceRef: 'synthetic-source-frozen-2',
      recordedAt: '2026-09-02T09:05:00.000Z',
    };

    const receipts = [1, 2, 3, 4, 5].map(() => adapter.appendRecord(request));

    expect(receipts[0]!.mode).toBe('CREATE');
    for (const later of receipts.slice(1)) {
      expect(later.mode).toBe('IDEMPOTENT_REPLAY');
      expect(later.status).toBe('OK');
      expect(later.readBackConfirmed).toBe(true);
      expect(later.recordId).toBe(RECORD);
    }

    // One logical journal entry, one ledger event, one mirrored copy. Not five of anything.
    expect(canonicalCount(dataDir)).toBe(1);
    expect(ledger.rows).toHaveLength(1);
    expect(mirror.store.size).toBe(1);
  });

  it('capturedAt is frozen on the first attempt: an advancing clock across five replays never moves it', () => {
    const dataDir = tempDataDir();
    const { adapter } = wire(dataDir);
    const request = {
      recordId: RECORD,
      text: 'Frozen capture time.',
      sourceRef: 'synthetic-source-frozen-3',
      recordedAt: '2026-09-02T09:10:00.000Z',
    };

    const first = adapter.appendRecord(request);
    const firstCapturedAt = readDoc(first.canonicalPath!).capturedAt;
    expect(typeof firstCapturedAt).toBe('string');

    for (let i = 0; i < 4; i += 1) adapter.appendRecord(request);

    expect(readDoc(first.canonicalPath!).capturedAt).toBe(firstCapturedAt);
    // Proof the clock really was moving, so the assertion above is not vacuous.
    const other = adapter.appendRecord({ ...request, recordId: `${RECORD}-b`, text: 'Different session.' });
    expect(readDoc(other.canonicalPath!).capturedAt).not.toBe(firstCapturedAt);
  });

  it('SMOKE-07 default policy: the same recordId with a CHANGED payload is refused and cannot create a second session', () => {
    const dataDir = tempDataDir();
    const { adapter, ledger, mirror } = wire(dataDir); // updatePolicy defaults to REFUSE
    const base = {
      recordId: RECORD,
      text: 'Original body.',
      sourceRef: 'synthetic-source-frozen-4',
      recordedAt: '2026-09-02T09:15:00.000Z',
    };

    const created = adapter.appendRecord(base);
    expect(created.mode).toBe('CREATE');

    const edited = adapter.appendRecord({ ...base, text: 'EDITED body, same logical session.' });

    expect(edited.status).toBe('FAILED');
    expect(edited.failureCode).toBe('JOURNAL_UPDATE_NOT_PERMITTED');
    expect(edited.recordId).toBe(RECORD); // NOT a new identity
    expect(edited.recoveryAction).not.toBeNull();

    // The single most important assertion in this file: still ONE canonical record.
    expect(canonicalCount(dataDir)).toBe(1);
    expect(readDoc(created.canonicalPath!).text).toBe('Original body.'); // prior truth untouched
    expect(ledger.rows).toHaveLength(1);
    expect(mirror.store.size).toBe(1);
  });

  it('SMOKE-07 REVISE policy: a changed payload revises the SAME record, archives the prior revision, and still logs one THABAT event', () => {
    const dataDir = tempDataDir();
    const { adapter, ledger } = wire(dataDir, { updatePolicy: 'REVISE' });
    const base = {
      recordId: RECORD,
      text: 'Revision one.',
      sourceRef: 'synthetic-source-frozen-5',
      recordedAt: '2026-09-02T09:20:00.000Z',
    };

    const first = adapter.appendRecord(base);
    const capturedAt = readDoc(first.canonicalPath!).capturedAt;

    const second = adapter.appendRecord({ ...base, text: 'Revision two.' });

    expect(second.status).toBe('OK');
    expect(second.mode).toBe('UPDATE');
    expect(second.recordId).toBe(RECORD);
    expect(canonicalCount(dataDir)).toBe(1); // one record, revised, not two records
    const doc = readDoc(second.canonicalPath!);
    expect(doc.revision).toBe(2);
    expect(doc.text).toBe('Revision two.');
    expect(doc.capturedAt).toBe(capturedAt); // still the same logical session
    // Nothing was discarded: the superseded revision is preserved.
    expect(existsSync(join(dataDir, 'journal', 'revisions', `${RECORD}.r1.json`))).toBe(true);
    // One logical session means one ledger event, even across a revision.
    expect(ledger.rows).toHaveLength(1);
  });

  it('SMOKE-09 a recordId that tries to traverse or name a path is refused, and nothing is written anywhere', () => {
    const dataDir = tempDataDir();
    const { adapter } = wire(dataDir);
    const hostile = ['../escape', '../../etc/passwd', 'a/b', 'a\\b', '..', 'a..b', '.hidden', '', '   ', 'C:name'];

    for (const recordId of hostile) {
      const receipt = adapter.appendRecord({
        recordId,
        text: 'Should never persist.',
        sourceRef: 'synthetic-source-frozen-6',
        recordedAt: '2026-09-02T09:25:00.000Z',
      });
      expect(receipt.status).toBe('FAILED');
      expect(receipt.failureCode).toBe('JOURNAL_RECORD_ID_INVALID');
      expect(receipt.canonicalPath).toBeNull();
      expect(receipt.schemaValid).toBe(false);
    }

    // No canonical directory was even created, so no probe reached the filesystem.
    expect(canonicalCount(dataDir)).toBe(0);
  });

  it('SMOKE-08 an invalid payload under a valid recordId creates no canonical artifact', () => {
    const dataDir = tempDataDir();
    const { adapter } = wire(dataDir);
    const receipt = adapter.appendRecord({
      recordId: RECORD,
      text: '   ',
      sourceRef: 'synthetic-source-frozen-7',
      recordedAt: '2026-09-02T09:30:00.000Z',
    });
    expect(receipt.status).toBe('FAILED');
    expect(receipt.failureCode).toBe('JOURNAL_PAYLOAD_TEXT_INVALID');
    expect(receipt.canonicalPath).toBeNull();
    expect(canonicalCount(dataDir)).toBe(0);
  });

  it('the read-back anchor lives in a second file: a self-consistent tamper of the canonical JSON alone is still caught', () => {
    const dataDir = tempDataDir();
    const { adapter } = wire(dataDir);
    const receipt = adapter.appendRecord({
      recordId: RECORD,
      text: 'Anchored content.',
      sourceRef: 'synthetic-source-frozen-8',
      recordedAt: '2026-09-02T09:35:00.000Z',
    });
    expect(adapter.verify(RECORD).hashMatches).toBe(true);

    // Tamper the entry AND recompute its own payloadHash so the file is internally consistent.
    // A single-file anchor would accept this. The state file, elsewhere on disk, must not.
    const doc = readDoc(receipt.canonicalPath!);
    const forgedText = 'ATTACKER CONTENT';
    const forgedHash = createHash('sha256')
      .update(
        JSON.stringify({ recordId: RECORD, sourceRef: doc.sourceRef, recordedAt: doc.recordedAt, text: forgedText }),
        'utf8',
      )
      .digest('hex');
    writeFileSync(receipt.canonicalPath!, JSON.stringify({ ...doc, text: forgedText, payloadHash: forgedHash }, null, 2), 'utf8');

    expect(adapter.verify(RECORD).parses).toBe(true);
    expect(adapter.verify(RECORD).hashMatches).toBe(false);
  });

  it('documents the defect being fixed: the legacy content-addressed path DOES fork on an edit, the frozen-identity path does not', () => {
    const dataDir = tempDataDir();
    const { adapter } = wire(dataDir);

    // Legacy entry point: identity comes from the payload, so an edited retry forks.
    adapter.appendWithReceipt('Legacy body.', 'synthetic-source-frozen-9', '2026-09-02T09:40:00.000Z');
    adapter.appendWithReceipt('Legacy body, edited.', 'synthetic-source-frozen-9', '2026-09-02T09:40:00.000Z');
    expect(canonicalCount(dataDir)).toBe(2); // the historical defect, reproduced on purpose

    // Frozen identity: the same edit under one caller-owned recordId cannot fork.
    const dataDir2 = tempDataDir();
    const frozen = wire(dataDir2).adapter;
    const req = {
      recordId: RECORD,
      text: 'Frozen body.',
      sourceRef: 'synthetic-source-frozen-9',
      recordedAt: '2026-09-02T09:40:00.000Z',
    };
    frozen.appendRecord(req);
    frozen.appendRecord({ ...req, text: 'Frozen body, edited.' });
    expect(canonicalCount(dataDir2)).toBe(1);
  });
});
