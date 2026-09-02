/**
 * NIZAM · Local journal persistence adapter — idempotent write/read-back/ledger/mirror state machine
 * Owning authority: PFOS Contract 14; Contracts 06 and 12; money rules.
 * Phase 14 — offline single-window composition; Stage 5 (durability hardening)
 * Depends on: singleWindowFlow.ts (the port this satisfies), db/paths.ts (data-directory containment).
 *
 * SCOPE, STATED PLAINLY. This module persists to a directory tree inside the caller's own
 * injected `dataDir` — the same "one agent, one data directory" boundary Contract 06 §2.1.2
 * enforces for the finance store. It is the LOCAL half of Contract 14's offline rehearsal
 * ("local journal append", §9). It is not, and does not claim to be, a client for the other
 * repository's live VPS deployment: `nizamcore` owns YAWMIYAT/THABAT/HIMAYAH for real, that
 * repository is owner-gated for any modification (ops/INTEROP_CONTRACT.md — spec 07 task A0 is
 * still an open gate), and nothing here clones, installs, starts, or writes to that host. The
 * `JournalLedgerPort` and `JournalMirrorPort` below are injected boundaries standing in for
 * THABAT and an approved Drive mirror respectively — exactly the way `SingleWindowPfosPort`
 * already stands in for PFOS in this file's sibling. A caller wires a real implementation only
 * once the owner has separately authorised that crossing; this module never invents one.
 *
 * CANONICAL FLOW implemented here: validate payload -> atomic local write -> independent
 * content-addressed read-back verification -> ledger append (if wired) -> optional
 * HIMAYAH-approved mirror (if wired and approved) -> mirror read-back verification. Every step
 * that can be re-run is idempotent on the entry's stable content hash, so re-appending the same
 * payload (e.g. after a restart) never produces a duplicate local file or a duplicate ledger row.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { resolveStorePath } from '../db/paths.ts';
import type { SingleWindowJournalPort, SingleWindowJournalRecord } from './singleWindowFlow.ts';

export type JournalPersistenceState = 'LOCAL_WRITTEN' | 'DRIVE_MIRRORED' | 'STAGED_RETRY' | 'FAILED';

export type JournalPersistenceFailureCode =
  | 'JOURNAL_PAYLOAD_TEXT_INVALID'
  | 'JOURNAL_PAYLOAD_SOURCE_REF_INVALID'
  | 'JOURNAL_PAYLOAD_RECORDED_AT_INVALID'
  | 'JOURNAL_LOCAL_READBACK_MISMATCH';

/** Typed failure for this module — never a silent fallback (same discipline as db/errors.ts). */
export class JournalPersistenceError extends Error {
  readonly code: JournalPersistenceFailureCode;
  constructor(code: JournalPersistenceFailureCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** THABAT stand-in. The real ledger lives in nizamcore; wired only after owner authorisation. */
export interface JournalLedgerPort {
  /** Append one row keyed by entryRef. Must itself be idempotent per entryRef. */
  appendRow(entryRef: string, contentHash: string): { rowRef: string };
  /** Independent re-read: how many rows currently exist for this entryRef, right now. */
  countRowsFor(entryRef: string): number;
}

/** Approved-Drive-mirror stand-in. Wired only after HIMAYAH classification approves the record. */
export interface JournalMirrorPort {
  mirror(entryRef: string, contentHash: string, payload: string): { mirrorRef: string };
  /** Independent re-read of the mirrored copy; throws or returns a differing hash if absent/corrupt. */
  readBack(mirrorRef: string): { contentHash: string };
}

export interface JournalPersistenceLocalReceipt {
  readonly path: string;
  readonly contentHash: string;
}

export interface JournalPersistenceLedgerReceipt {
  readonly rowRef: string;
}

export interface JournalPersistenceMirrorReceipt {
  readonly mirrorRef: string;
  readonly contentHash: string;
}

export interface JournalPersistenceReceipt {
  readonly entryRef: string;
  readonly state: JournalPersistenceState;
  readonly record: SingleWindowJournalRecord | null;
  readonly local: JournalPersistenceLocalReceipt | null;
  readonly ledger: JournalPersistenceLedgerReceipt | null;
  readonly mirror: JournalPersistenceMirrorReceipt | null;
  readonly pending: readonly ('ledger' | 'mirror')[];
  readonly failureCode?: JournalPersistenceFailureCode;
}

export interface JournalPersistenceVerification {
  readonly entryRef: string;
  readonly exists: boolean;
  readonly parses: boolean;
  readonly hashMatches: boolean;
  readonly contentHash: string | null;
}

export interface JournalPersistenceAdapterConfig {
  /** The caller's own data directory. Absolute, must already exist — no fallback location. */
  readonly dataDir: string;
  /** Relative subdirectory under `dataDir` for this adapter's tree. Default: 'journal'. */
  readonly subdirectory?: string;
  readonly ledger?: JournalLedgerPort;
  readonly mirror?: JournalMirrorPort;
  /** HIMAYAH-classification stand-in: must return true before any mirror call is attempted. */
  readonly mirrorApproved?: (record: SingleWindowJournalRecord) => boolean;
  readonly now: () => string;
}

export interface JournalPersistenceAdapter extends SingleWindowJournalPort {
  appendWithReceipt(text: string, sourceRef: string, recordedAt: string): JournalPersistenceReceipt;
  /** Independent re-read of the local file, ignoring any in-memory belief about its state. */
  verify(entryRef: string): JournalPersistenceVerification;
  /** Re-attempt every STAGED_RETRY entry's pending ledger/mirror steps. Never touches local truth. */
  retryStaged(): JournalPersistenceReceipt[];
}

const MAX_TEXT_LENGTH = 20_000;

interface StoredJournalEntry {
  readonly entryRef: string;
  readonly sourceRef: string;
  readonly recordedAt: string;
  readonly text: string;
}

interface StateFileShape {
  readonly entryRef: string;
  readonly state: JournalPersistenceState;
  readonly ledger: JournalPersistenceLedgerReceipt | null;
  readonly mirror: JournalPersistenceMirrorReceipt | null;
  readonly pending: readonly ('ledger' | 'mirror')[];
  readonly failureCode?: JournalPersistenceFailureCode;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function validatePayload(text: string, sourceRef: string, recordedAt: string): JournalPersistenceFailureCode | null {
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT_LENGTH) {
    return 'JOURNAL_PAYLOAD_TEXT_INVALID';
  }
  if (typeof sourceRef !== 'string' || sourceRef.trim() === '' || /[/\\]|\.\./.test(sourceRef)) {
    return 'JOURNAL_PAYLOAD_SOURCE_REF_INVALID';
  }
  if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) {
    return 'JOURNAL_PAYLOAD_RECORDED_AT_INVALID';
  }
  return null;
}

/** Content-addressed key: identical inputs always hash to the same entryRef (idempotency). */
function entryRefFor(text: string, sourceRef: string, recordedAt: string): string {
  return sha256(`${sourceRef}\u241F${text}\u241F${recordedAt}`);
}

function serializeEntry(entry: StoredJournalEntry): string {
  return JSON.stringify({ entryRef: entry.entryRef, sourceRef: entry.sourceRef, recordedAt: entry.recordedAt, text: entry.text }, null, 2);
}

function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  writeFileSync(tmpPath, contents, 'utf8');
  renameSync(tmpPath, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function createJournalPersistenceAdapter(config: JournalPersistenceAdapterConfig): JournalPersistenceAdapter {
  const subdirectory = config.subdirectory ?? 'journal';
  const entryPathOf = (ref: string): string => resolveStorePath(config.dataDir, join(subdirectory, 'entries', `${ref}.json`));
  const statePathOf = (ref: string): string => resolveStorePath(config.dataDir, join(subdirectory, 'state', `${ref}.json`));

  function loadState(entryRef: string): StateFileShape | null {
    return readJson<StateFileShape>(statePathOf(entryRef));
  }

  function saveState(state: StateFileShape): void {
    atomicWrite(statePathOf(state.entryRef), JSON.stringify(state, null, 2));
  }

  /**
   * Independent read-back: re-reads whatever is on disk RIGHT NOW and recomputes its
   * content-addressed key from the stored fields. Tampering with `text`, `sourceRef`,
   * `recordedAt` or the stored `entryRef` after a successful write changes the recomputed
   * key, so this can never pass by re-deriving the same value from the same tampered bytes —
   * the comparison is against the ref the CALLER asked to verify, not against anything read
   * from the same tampered file.
   */
  function verify(entryRef: string): JournalPersistenceVerification {
    const entryPath = entryPathOf(entryRef);
    if (!existsSync(entryPath)) {
      return { entryRef, exists: false, parses: false, hashMatches: false, contentHash: null };
    }
    const raw = readFileSync(entryPath, 'utf8');
    const contentHash = sha256(raw);
    let parsed: Partial<StoredJournalEntry>;
    try {
      parsed = JSON.parse(raw) as Partial<StoredJournalEntry>;
    } catch {
      return { entryRef, exists: true, parses: false, hashMatches: false, contentHash };
    }
    const fieldsPresent =
      typeof parsed.sourceRef === 'string' &&
      typeof parsed.text === 'string' &&
      typeof parsed.recordedAt === 'string' &&
      typeof parsed.entryRef === 'string';
    if (!fieldsPresent) {
      return { entryRef, exists: true, parses: false, hashMatches: false, contentHash };
    }
    const recomputedRef = entryRefFor(parsed.text as string, parsed.sourceRef as string, parsed.recordedAt as string);
    const hashMatches = recomputedRef === entryRef && parsed.entryRef === entryRef;
    return { entryRef, exists: true, parses: true, hashMatches, contentHash };
  }

  function receiptFrom(record: SingleWindowJournalRecord | null, local: JournalPersistenceLocalReceipt | null, state: StateFileShape): JournalPersistenceReceipt {
    return {
      entryRef: state.entryRef,
      state: state.state,
      record,
      local,
      ledger: state.ledger,
      mirror: state.mirror,
      pending: state.pending,
      ...(state.failureCode !== undefined ? { failureCode: state.failureCode } : {}),
    };
  }

  /** Attempt ledger then mirror for an already-local-written, already-verified entry. */
  function attemptDownstream(entryRef: string, record: SingleWindowJournalRecord, contentHash: string, payloadJson: string): StateFileShape {
    const pending: Array<'ledger' | 'mirror'> = [];

    let ledger: JournalPersistenceLedgerReceipt | null = null;
    if (config.ledger !== undefined) {
      try {
        const existingRows = config.ledger.countRowsFor(entryRef);
        ledger = existingRows > 0 ? { rowRef: entryRef } : config.ledger.appendRow(entryRef, contentHash);
      } catch {
        pending.push('ledger');
      }
    }

    const ledgerBlocking = config.ledger !== undefined && ledger === null;
    const mirrorWanted = config.mirror !== undefined && (config.mirrorApproved?.(record) ?? false);
    let mirror: JournalPersistenceMirrorReceipt | null = null;
    if (mirrorWanted && !ledgerBlocking) {
      try {
        const { mirrorRef } = config.mirror!.mirror(entryRef, contentHash, payloadJson);
        const readBack = config.mirror!.readBack(mirrorRef);
        if (readBack.contentHash === contentHash) {
          mirror = { mirrorRef, contentHash: readBack.contentHash };
        } else {
          pending.push('mirror');
        }
      } catch {
        pending.push('mirror');
      }
    } else if (mirrorWanted && ledgerBlocking) {
      pending.push('mirror');
    }

    const state: JournalPersistenceState = pending.length > 0 ? 'STAGED_RETRY' : mirror !== null ? 'DRIVE_MIRRORED' : 'LOCAL_WRITTEN';
    return { entryRef, state, ledger, mirror, pending };
  }

  function appendWithReceipt(text: string, sourceRef: string, recordedAt: string): JournalPersistenceReceipt {
    const failureCode = validatePayload(text, sourceRef, recordedAt);
    if (failureCode !== null) {
      const entryRef = `invalid-${sha256(`${sourceRef}\u241F${recordedAt}\u241F${config.now()}`)}`;
      return { entryRef, state: 'FAILED', record: null, local: null, ledger: null, mirror: null, pending: [], failureCode };
    }

    const entryRef = entryRefFor(text, sourceRef, recordedAt);
    const record: SingleWindowJournalRecord = { entryRef, sourceRef, recordedAt };
    const payloadJson = serializeEntry({ entryRef, sourceRef, recordedAt, text });
    const contentHash = sha256(payloadJson);
    const entryPath = entryPathOf(entryRef);

    const existingState = loadState(entryRef);
    if (existingState !== null && existsSync(entryPath)) {
      // Idempotent replay: identical inputs hash to the same entryRef. Do not rewrite the file
      // and do not re-invoke ledger/mirror — that is precisely the duplicate-on-restart this
      // adapter exists to prevent.
      return receiptFrom(record, { path: entryPath, contentHash }, existingState);
    }

    if (!existsSync(entryPath)) {
      atomicWrite(entryPath, payloadJson);
    }

    const verification = verify(entryRef);
    if (!verification.hashMatches) {
      const state: StateFileShape = { entryRef, state: 'FAILED', ledger: null, mirror: null, pending: [], failureCode: 'JOURNAL_LOCAL_READBACK_MISMATCH' };
      saveState(state);
      return receiptFrom(record, null, state);
    }

    const state = attemptDownstream(entryRef, record, contentHash, payloadJson);
    saveState(state);
    return receiptFrom(record, { path: entryPath, contentHash }, state);
  }

  function retryStaged(): JournalPersistenceReceipt[] {
    let stateDir: string;
    try {
      stateDir = resolveStorePath(config.dataDir, join(subdirectory, 'state'));
    } catch {
      return [];
    }
    if (!existsSync(stateDir)) return [];

    const results: JournalPersistenceReceipt[] = [];
    for (const fileName of readdirSync(stateDir)) {
      if (!fileName.endsWith('.json')) continue;
      const entryRef = fileName.slice(0, -'.json'.length);
      const existingState = loadState(entryRef);
      if (existingState === null || existingState.state !== 'STAGED_RETRY') continue;

      const entryPath = entryPathOf(entryRef);
      const stored = readJson<StoredJournalEntry>(entryPath);
      if (stored === null) continue;

      const record: SingleWindowJournalRecord = { entryRef: stored.entryRef, sourceRef: stored.sourceRef, recordedAt: stored.recordedAt };
      const payloadJson = readFileSync(entryPath, 'utf8');
      const contentHash = sha256(payloadJson);

      const nextState = attemptDownstream(entryRef, record, contentHash, payloadJson);
      saveState(nextState);
      results.push(receiptFrom(record, { path: entryPath, contentHash }, nextState));
    }
    return results;
  }

  return {
    append(text: string, sourceRef: string, recordedAt: string): SingleWindowJournalRecord {
      const receipt = appendWithReceipt(text, sourceRef, recordedAt);
      if (receipt.state === 'FAILED' || receipt.record === null) {
        throw new JournalPersistenceError(
          receipt.failureCode ?? 'JOURNAL_LOCAL_READBACK_MISMATCH',
          `NIZAM journal: entry ${receipt.entryRef} did not reach a local-written state${receipt.failureCode ? ` (${receipt.failureCode})` : ''}.`,
        );
      }
      return receipt.record;
    },
    appendWithReceipt,
    verify,
    retryStaged,
  };
}
