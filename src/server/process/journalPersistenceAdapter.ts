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
  | 'JOURNAL_RECORD_ID_INVALID'
  | 'JOURNAL_UPDATE_NOT_PERMITTED'
  | 'JOURNAL_LOCAL_READBACK_MISMATCH';

/**
 * How this attempt resolved against the record identity that already exists on disk.
 * CREATE            no document for this recordId yet.
 * IDEMPOTENT_REPLAY a document exists and the canonical payload hash is byte-identical:
 *                   nothing is rewritten and no downstream boundary is re-invoked.
 * UPDATE            a document exists and the payload changed: the SAME logical record is
 *                   revised in place. A changed payload can never mint a second record.
 */
export type JournalPersistenceMode = 'CREATE' | 'UPDATE' | 'IDEMPOTENT_REPLAY';

/**
 * What a caller may do when a recordId already holds a DIFFERENT payload.
 * 'REFUSE' (default) fails closed and writes nothing.
 * 'REVISE'           writes a new revision of the same record and archives the prior one.
 * Neither value can produce a second logical record — that is the point of the enum.
 */
export type JournalUpdatePolicy = 'REFUSE' | 'REVISE';

/**
 * Persistence request with a CALLER-FROZEN identity.
 *
 * The recordId names the logical journal session. It is chosen once, before the first attempt, and
 * every retry reuses it verbatim. It is deliberately NOT derived from the payload: a
 * payload-derived key means an edited retry hashes differently, lands on a different path and
 * silently becomes a second journal entry. That is the duplicate-entry mechanism this request
 * shape exists to remove.
 */
export interface JournalAppendRequest {
  readonly recordId: string;
  readonly text: string;
  readonly sourceRef: string;
  readonly recordedAt: string;
}

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

/**
 * Coarse outcome. Deliberately four values, because a caller that must decide whether to act
 * should not have to interpret a state machine.
 *   OK          the canonical record is persisted and independently read back.
 *   FAILED      nothing durable was produced by this attempt.
 *   RECOVERED   a previously staged attempt reached OK on a later pass.
 *   NEEDS_HUMAN local truth is safe but a boundary outside this module must act before it is
 *               complete. The reason is always in recoveryAction, never left to be inferred.
 */
export type JournalPersistenceStatus = 'OK' | 'FAILED' | 'RECOVERED' | 'NEEDS_HUMAN';

export interface JournalPersistenceReceipt {
  /** Back-compatible alias of recordId, kept because SingleWindowJournalRecord names it. */
  readonly entryRef: string;
  readonly state: JournalPersistenceState;
  readonly record: SingleWindowJournalRecord | null;
  readonly local: JournalPersistenceLocalReceipt | null;
  readonly ledger: JournalPersistenceLedgerReceipt | null;
  readonly mirror: JournalPersistenceMirrorReceipt | null;
  readonly pending: readonly ('ledger' | 'mirror')[];
  readonly failureCode?: JournalPersistenceFailureCode;

  // --- declared receipt surface: every field below is observed, never inferred ---
  readonly status: JournalPersistenceStatus;
  readonly mode: JournalPersistenceMode;
  readonly recordId: string;
  /** Path of the canonical JSON. Non-null exactly when a canonical document is on disk. */
  readonly canonicalPath: string | null;
  /** Reference of the derived mirror. Null when absent, unapproved, or pending. */
  readonly mirrorPath: string | null;
  /** Identity and payload passed validation before anything was written. */
  readonly schemaValid: boolean;
  /** The re-read document's recomputed payload hash equals the expected payload hash. */
  readonly hashMatch: boolean;
  /** An independent re-open of the canonical JSON succeeded in full. */
  readonly readBackConfirmed: boolean;
  readonly recoveryAction: string | null;
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
  /**
   * What to do when a recordId already holds a different payload. Default 'REFUSE': fail
   * closed, write nothing. Neither setting can create a second logical record.
   */
  readonly updatePolicy?: JournalUpdatePolicy;
  readonly now: () => string;
}

export interface JournalPersistenceAdapter extends SingleWindowJournalPort {
  /**
   * The identity-frozen entry point. Prefer this everywhere: the caller owns recordId, so a
   * retry of an edited payload revises one record instead of minting a second one.
   */
  appendRecord(request: JournalAppendRequest): JournalPersistenceReceipt;
  /**
   * Legacy content-addressed entry point, retained for SingleWindowJournalPort callers. It
   * derives recordId from the payload, which means an EDITED retry is a different record. New
   * callers use appendRecord and choose their own stable identity.
   */
  appendWithReceipt(text: string, sourceRef: string, recordedAt: string): JournalPersistenceReceipt;
  /** Independent re-read of the local file, ignoring any in-memory belief about its state. */
  verify(entryRef: string): JournalPersistenceVerification;
  /** Re-attempt every STAGED_RETRY entry's pending ledger/mirror steps. Never touches local truth. */
  retryStaged(): JournalPersistenceReceipt[];
}

const MAX_TEXT_LENGTH = 20_000;
const MAX_RECORD_ID_LENGTH = 200;

/**
 * A recordId becomes a path segment, so it is validated as an identifier and never as a path.
 * Only characters that cannot traverse, escape, or name a device are admitted, and the caller
 * gets a typed refusal rather than a sanitised value: silently rewriting an identity would
 * change which record was written while the call still looked successful.
 */
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Canonical document version. v1 documents carried no version field and no payloadHash. */
const SCHEMA_VERSION = 2;

/** The canonical on-disk shape. `payloadHash` covers the identity-anchored payload only. */
interface StoredJournalDocument {
  readonly schemaVersion: number;
  readonly recordId: string;
  /** Frozen on CREATE. Every later attempt on this recordId reuses the stored value verbatim. */
  readonly capturedAt: string;
  readonly revision: number;
  readonly sourceRef: string;
  readonly recordedAt: string;
  readonly text: string;
  readonly payloadHash: string;
}

/** Shape actually parsed off disk, which may be a v1 document with none of the v2 fields. */
interface ParsedDocument {
  readonly schemaVersion?: unknown;
  readonly recordId?: unknown;
  readonly entryRef?: unknown;
  readonly capturedAt?: unknown;
  readonly revision?: unknown;
  readonly sourceRef?: unknown;
  readonly recordedAt?: unknown;
  readonly text?: unknown;
  readonly payloadHash?: unknown;
}

interface StateFileShape {
  readonly recordId: string;
  readonly state: JournalPersistenceState;
  readonly mode: JournalPersistenceMode;
  readonly capturedAt: string;
  readonly revision: number;
  readonly payloadHash: string;
  readonly ledger: JournalPersistenceLedgerReceipt | null;
  readonly mirror: JournalPersistenceMirrorReceipt | null;
  readonly pending: readonly ('ledger' | 'mirror')[];
  readonly failureCode?: JournalPersistenceFailureCode;
  /** Legacy v1 state files keyed this instead of recordId. Read, never written. */
  readonly entryRef?: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function validateRecordId(recordId: string): JournalPersistenceFailureCode | null {
  if (typeof recordId !== 'string' || recordId.trim() === '' || recordId.length > MAX_RECORD_ID_LENGTH) {
    return 'JOURNAL_RECORD_ID_INVALID';
  }
  // Checked explicitly as well as by the pattern: `a..b` satisfies the character class.
  if (recordId.includes('..')) return 'JOURNAL_RECORD_ID_INVALID';
  if (!RECORD_ID_PATTERN.test(recordId)) return 'JOURNAL_RECORD_ID_INVALID';
  return null;
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

/**
 * Change detector, not an identity. Deterministic because the object literal fixes key order,
 * and identity-anchored because recordId is inside it: the same text under a different record
 * hashes differently, so a hash collision cannot merge two records.
 *
 * capturedAt and revision are deliberately OUTSIDE the hash. capturedAt is frozen metadata and
 * revision changes on every revision, so including either would make an unchanged payload look
 * changed and defeat idempotent replay.
 */
function payloadHashFor(recordId: string, sourceRef: string, recordedAt: string, text: string): string {
  return sha256(JSON.stringify({ recordId, sourceRef, recordedAt, text }));
}

/** Legacy content-addressed key, retained only to derive a recordId for legacy callers. */
function entryRefFor(text: string, sourceRef: string, recordedAt: string): string {
  return sha256(`${sourceRef}\u241F${text}\u241F${recordedAt}`);
}

function serializeDocument(doc: StoredJournalDocument): string {
  return JSON.stringify(
    {
      schemaVersion: doc.schemaVersion,
      recordId: doc.recordId,
      capturedAt: doc.capturedAt,
      revision: doc.revision,
      sourceRef: doc.sourceRef,
      recordedAt: doc.recordedAt,
      text: doc.text,
      payloadHash: doc.payloadHash,
    },
    null,
    2,
  );
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
  const updatePolicy: JournalUpdatePolicy = config.updatePolicy ?? 'REFUSE';
  const entryPathOf = (ref: string): string => resolveStorePath(config.dataDir, join(subdirectory, 'entries', `${ref}.json`));
  const statePathOf = (ref: string): string => resolveStorePath(config.dataDir, join(subdirectory, 'state', `${ref}.json`));
  const revisionPathOf = (ref: string, revision: number): string =>
    resolveStorePath(config.dataDir, join(subdirectory, 'revisions', `${ref}.r${revision}.json`));

  function loadState(recordId: string): StateFileShape | null {
    const raw = readJson<StateFileShape>(statePathOf(recordId));
    if (raw === null) return null;
    // A v1 state file has entryRef and no recordId. Normalise on read; never rewrite silently.
    return raw.recordId !== undefined ? raw : { ...raw, recordId: raw.entryRef ?? recordId };
  }

  function saveState(state: StateFileShape): void {
    atomicWrite(statePathOf(state.recordId), JSON.stringify(state, null, 2));
  }

  /**
   * Independent read-back. Re-opens whatever is on disk RIGHT NOW and recomputes the payload
   * hash from the stored fields.
   *
   * The anchor is deliberately NOT inside the document being checked. For a v2 document the
   * expected hash comes from the state file, a separate file in a separate directory, so a
   * tamper must alter two files consistently to pass. When no state file exists the stored
   * payloadHash is used, which still catches any edit to text, sourceRef, recordedAt or
   * recordId, because those four are exactly what the hash covers.
   */
  function verify(recordId: string): JournalPersistenceVerification {
    const entryPath = entryPathOf(recordId);
    if (!existsSync(entryPath)) {
      return { entryRef: recordId, exists: false, parses: false, hashMatches: false, contentHash: null };
    }
    const raw = readFileSync(entryPath, 'utf8');
    const contentHash = sha256(raw);
    let parsed: ParsedDocument;
    try {
      parsed = JSON.parse(raw) as ParsedDocument;
    } catch {
      return { entryRef: recordId, exists: true, parses: false, hashMatches: false, contentHash };
    }
    const fieldsPresent =
      typeof parsed.sourceRef === 'string' && typeof parsed.text === 'string' && typeof parsed.recordedAt === 'string';
    if (!fieldsPresent) {
      return { entryRef: recordId, exists: true, parses: false, hashMatches: false, contentHash };
    }

    if (parsed.schemaVersion === undefined) {
      // v1 document: identity WAS the content hash, so recompute it and compare to the request.
      const recomputedRef = entryRefFor(parsed.text as string, parsed.sourceRef as string, parsed.recordedAt as string);
      const hashMatches = recomputedRef === recordId && parsed.entryRef === recordId;
      return { entryRef: recordId, exists: true, parses: true, hashMatches, contentHash };
    }

    if (typeof parsed.recordId !== 'string' || typeof parsed.payloadHash !== 'string') {
      return { entryRef: recordId, exists: true, parses: false, hashMatches: false, contentHash };
    }
    const recomputed = payloadHashFor(
      parsed.recordId,
      parsed.sourceRef as string,
      parsed.recordedAt as string,
      parsed.text as string,
    );
    const state = loadState(recordId);
    const externalAnchor = state?.payloadHash;
    const hashMatches =
      parsed.recordId === recordId &&
      recomputed === parsed.payloadHash &&
      (externalAnchor === undefined || externalAnchor === recomputed);
    return { entryRef: recordId, exists: true, parses: true, hashMatches, contentHash };
  }

  function statusFor(state: JournalPersistenceState, recovered: boolean): JournalPersistenceStatus {
    if (state === 'FAILED') return 'FAILED';
    if (state === 'STAGED_RETRY') return 'NEEDS_HUMAN';
    return recovered ? 'RECOVERED' : 'OK';
  }

  function recoveryActionFor(state: StateFileShape): string | null {
    if (state.state === 'STAGED_RETRY') {
      return `call retryStaged() once the pending boundary is reachable: ${state.pending.join(', ')}`;
    }
    if (state.failureCode === 'JOURNAL_UPDATE_NOT_PERMITTED') {
      return 'recordId already holds a different payload: pass updatePolicy REVISE to revise this record, or choose a new recordId for a genuinely new session';
    }
    if (state.failureCode === 'JOURNAL_LOCAL_READBACK_MISMATCH') {
      return 'canonical read-back did not match: preserve the artifact for inspection, do not rewrite over it';
    }
    return null;
  }

  function receiptFrom(
    record: SingleWindowJournalRecord | null,
    local: JournalPersistenceLocalReceipt | null,
    state: StateFileShape,
    verification: JournalPersistenceVerification | null,
    recovered: boolean,
  ): JournalPersistenceReceipt {
    return {
      entryRef: state.recordId,
      state: state.state,
      record,
      local,
      ledger: state.ledger,
      mirror: state.mirror,
      pending: state.pending,
      ...(state.failureCode !== undefined ? { failureCode: state.failureCode } : {}),
      status: statusFor(state.state, recovered),
      mode: state.mode,
      recordId: state.recordId,
      canonicalPath: verification?.exists === true ? entryPathOf(state.recordId) : null,
      mirrorPath: state.mirror?.mirrorRef ?? null,
      schemaValid: state.failureCode === undefined || state.failureCode === 'JOURNAL_LOCAL_READBACK_MISMATCH' || state.failureCode === 'JOURNAL_UPDATE_NOT_PERMITTED',
      hashMatch: verification?.hashMatches ?? false,
      readBackConfirmed: verification !== null && verification.exists && verification.parses && verification.hashMatches,
      recoveryAction: recoveryActionFor(state),
    };
  }

  /** Receipt for a refusal that never reached disk. Nothing is written, including no state file. */
  function refusal(recordId: string, failureCode: JournalPersistenceFailureCode): JournalPersistenceReceipt {
    return {
      entryRef: recordId,
      state: 'FAILED',
      record: null,
      local: null,
      ledger: null,
      mirror: null,
      pending: [],
      failureCode,
      status: 'FAILED',
      mode: 'CREATE',
      recordId,
      canonicalPath: null,
      mirrorPath: null,
      schemaValid: false,
      hashMatch: false,
      readBackConfirmed: false,
      recoveryAction: null,
    };
  }

  /** Attempt ledger then mirror for an already-written, already-verified record. */
  function attemptDownstream(
    recordId: string,
    record: SingleWindowJournalRecord,
    contentHash: string,
    documentJson: string,
  ): { ledger: JournalPersistenceLedgerReceipt | null; mirror: JournalPersistenceMirrorReceipt | null; pending: Array<'ledger' | 'mirror'>; state: JournalPersistenceState } {
    const pending: Array<'ledger' | 'mirror'> = [];

    let ledger: JournalPersistenceLedgerReceipt | null = null;
    if (config.ledger !== undefined) {
      try {
        // Idempotent on recordId, so a revision of the same logical record does not append a
        // second THABAT event. One logical session, one event.
        const existingRows = config.ledger.countRowsFor(recordId);
        ledger = existingRows > 0 ? { rowRef: recordId } : config.ledger.appendRow(recordId, contentHash);
      } catch {
        pending.push('ledger');
      }
    }

    const ledgerBlocking = config.ledger !== undefined && ledger === null;
    const mirrorWanted = config.mirror !== undefined && (config.mirrorApproved?.(record) ?? false);
    let mirror: JournalPersistenceMirrorReceipt | null = null;
    if (mirrorWanted && !ledgerBlocking) {
      try {
        const { mirrorRef } = config.mirror!.mirror(recordId, contentHash, documentJson);
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
    return { ledger, mirror, pending, state };
  }

  function appendRecord(request: JournalAppendRequest): JournalPersistenceReceipt {
    const { recordId, text, sourceRef, recordedAt } = request;

    const idFailure = validateRecordId(recordId);
    if (idFailure !== null) {
      // The refused id is NOT echoed into a path. It is reported back so the caller can see
      // what it sent, and nothing is created anywhere.
      return refusal(typeof recordId === 'string' ? recordId : String(recordId), idFailure);
    }
    const payloadFailure = validatePayload(text, sourceRef, recordedAt);
    if (payloadFailure !== null) return refusal(recordId, payloadFailure);

    const payloadHash = payloadHashFor(recordId, sourceRef, recordedAt, text);
    const record: SingleWindowJournalRecord = { entryRef: recordId, sourceRef, recordedAt };
    const entryPath = entryPathOf(recordId);
    const existing = readJson<ParsedDocument>(entryPath);
    const existingState = loadState(recordId);

    let mode: JournalPersistenceMode;
    let capturedAt: string;
    let revision: number;

    if (existing !== null && typeof existing.payloadHash === 'string' && typeof existing.capturedAt === 'string') {
      if (existing.payloadHash === payloadHash) {
        // IDEMPOTENT REPLAY. Do not rewrite the document and do not re-invoke any boundary.
        // Still read back, because the caller is being told the record is persisted.
        const verification = verify(recordId);
        const replayState: StateFileShape = existingState !== null
          ? { ...existingState, mode: 'IDEMPOTENT_REPLAY' }
          : {
              recordId,
              state: 'LOCAL_WRITTEN',
              mode: 'IDEMPOTENT_REPLAY',
              capturedAt: existing.capturedAt,
              revision: typeof existing.revision === 'number' ? existing.revision : 1,
              payloadHash,
              ledger: null,
              mirror: null,
              pending: [],
            };
        return receiptFrom(
          record,
          verification.exists ? { path: entryPath, contentHash: verification.contentHash! } : null,
          replayState,
          verification,
          false,
        );
      }
      // Same record, different payload. This is the branch that used to be impossible to reach,
      // because a content-derived key sent an edited payload to a different path and created a
      // second journal entry. It is now explicit, and neither outcome creates a second record.
      if (updatePolicy === 'REFUSE') {
        const verification = verify(recordId);
        const refusedState: StateFileShape = {
          recordId,
          state: 'FAILED',
          mode: 'UPDATE',
          capturedAt: existing.capturedAt,
          revision: typeof existing.revision === 'number' ? existing.revision : 1,
          payloadHash: existing.payloadHash,
          ledger: existingState?.ledger ?? null,
          mirror: existingState?.mirror ?? null,
          pending: existingState?.pending ?? [],
          failureCode: 'JOURNAL_UPDATE_NOT_PERMITTED',
        };
        // No write of any kind: the prior canonical record stands untouched.
        return receiptFrom(record, null, refusedState, verification, false);
      }
      mode = 'UPDATE';
      capturedAt = existing.capturedAt; // frozen: a revision is the same logical session
      revision = (typeof existing.revision === 'number' ? existing.revision : 1) + 1;
      // Preserve the superseded revision before overwriting. Nothing is discarded.
      atomicWrite(revisionPathOf(recordId, revision - 1), JSON.stringify(existing, null, 2));
    } else if (existing !== null) {
      // A v1 document, or a v2 document missing its hash. Do not guess and do not overwrite.
      const verification = verify(recordId);
      const blockedState: StateFileShape = {
        recordId,
        state: 'FAILED',
        mode: 'UPDATE',
        capturedAt: typeof existing.capturedAt === 'string' ? existing.capturedAt : recordedAt,
        revision: 1,
        payloadHash,
        ledger: existingState?.ledger ?? null,
        mirror: existingState?.mirror ?? null,
        pending: existingState?.pending ?? [],
        failureCode: 'JOURNAL_UPDATE_NOT_PERMITTED',
      };
      return receiptFrom(record, null, blockedState, verification, false);
    } else {
      mode = 'CREATE';
      capturedAt = config.now(); // frozen here, once, for the life of this record
      revision = 1;
    }

    const documentJson = serializeDocument({
      schemaVersion: SCHEMA_VERSION,
      recordId,
      capturedAt,
      revision,
      sourceRef,
      recordedAt,
      text,
      payloadHash,
    });
    const contentHash = sha256(documentJson);

    atomicWrite(entryPath, documentJson);

    // The state file is written BEFORE downstream so the external hash anchor exists for the
    // read-back below. Local truth first, boundaries after.
    const preState: StateFileShape = {
      recordId,
      state: 'LOCAL_WRITTEN',
      mode,
      capturedAt,
      revision,
      payloadHash,
      ledger: existingState?.ledger ?? null,
      mirror: null,
      pending: [],
    };
    saveState(preState);

    const verification = verify(recordId);
    if (!verification.hashMatches) {
      const failed: StateFileShape = { ...preState, state: 'FAILED', failureCode: 'JOURNAL_LOCAL_READBACK_MISMATCH' };
      saveState(failed);
      return receiptFrom(record, null, failed, verification, false);
    }

    const downstream = attemptDownstream(recordId, record, contentHash, documentJson);
    const finalState: StateFileShape = { ...preState, ...downstream };
    saveState(finalState);
    return receiptFrom(record, { path: entryPath, contentHash }, finalState, verification, false);
  }

  function appendWithReceipt(text: string, sourceRef: string, recordedAt: string): JournalPersistenceReceipt {
    const payloadFailure = validatePayload(text, sourceRef, recordedAt);
    if (payloadFailure !== null) {
      return refusal(`invalid-${sha256(`${sourceRef}\u241F${recordedAt}\u241F${config.now()}`)}`, payloadFailure);
    }
    return appendRecord({ recordId: entryRefFor(text, sourceRef, recordedAt), text, sourceRef, recordedAt });
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
      const recordId = fileName.slice(0, -'.json'.length);
      const existingState = loadState(recordId);
      if (existingState === null || existingState.state !== 'STAGED_RETRY') continue;

      const entryPath = entryPathOf(recordId);
      const stored = readJson<ParsedDocument>(entryPath);
      if (stored === null) continue;
      if (typeof stored.sourceRef !== 'string' || typeof stored.recordedAt !== 'string') continue;

      const record: SingleWindowJournalRecord = {
        entryRef: recordId,
        sourceRef: stored.sourceRef,
        recordedAt: stored.recordedAt,
      };
      const documentJson = readFileSync(entryPath, 'utf8');
      const contentHash = sha256(documentJson);

      const downstream = attemptDownstream(recordId, record, contentHash, documentJson);
      const nextState: StateFileShape = { ...existingState, ...downstream };
      saveState(nextState);
      const verification = verify(recordId);
      // RECOVERED is claimed only when this pass actually left STAGED_RETRY behind.
      const recovered = nextState.state !== 'STAGED_RETRY';
      results.push(receiptFrom(record, { path: entryPath, contentHash }, nextState, verification, recovered));
    }
    return results;
  }

  return {
    append(text: string, sourceRef: string, recordedAt: string): SingleWindowJournalRecord {
      const receipt = appendWithReceipt(text, sourceRef, recordedAt);
      if (receipt.state === 'FAILED' || receipt.record === null) {
        throw new JournalPersistenceError(
          receipt.failureCode ?? 'JOURNAL_LOCAL_READBACK_MISMATCH',
          `NIZAM journal: entry ${receipt.recordId} did not reach a local-written state${receipt.failureCode ? ` (${receipt.failureCode})` : ''}.`,
        );
      }
      return receipt.record;
    },
    appendRecord,
    appendWithReceipt,
    verify,
    retryStaged,
  };
}
