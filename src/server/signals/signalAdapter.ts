/**
 * NIZAM · closed signal adapter with schema-versioned append receipts
 * Owning contract: PFOS Contract 12 — Two-Agent VPS Deployment & Operations; UPOI task 5.2
 * Phase: Phase 5.2 closed signal adapter composition
 * Owning requirements: 1.2, 1.4, 2.2
 * Depends on: signalStore.ts, envelopeSchema.ts, envelopeValidation.ts
 *
 * This is the UPOI composition seam over the existing signal validator and append-only store.
 * It does not create a second envelope vocabulary, database writer, consent policy, or hash.
 * Every candidate still passes the existing validator, every accepted row still goes through the
 * store's append-only transaction, and a repeated signal id remains a refused duplicate.
 */
import type { SignalDraft } from '../ports/signalBus.ts';
import { SIGNAL_ENVELOPE_SCHEMA_ID, SIGNAL_ENVELOPE_SCHEMA_VERSION } from './envelopeSchema.ts';
import {
  appendSignal,
  SIGNAL_STORE_FILE_NAME,
  SIGNAL_STORE_MIGRATIONS,
  type SignalStoreContext,
} from './signalStore.ts';
import { SIGNAL_STORE_NAME } from './signalStoreSchema.ts';

/** The adapter receipt's own closed schema. It contains references and state, never payload text. */
export const SIGNAL_RECEIPT_SCHEMA_ID = 'urn:nizam:signalbus:append-receipt:1';
export const SIGNAL_RECEIPT_SCHEMA_VERSION = 1 as const;
export const SIGNAL_STORE_SCHEMA_VERSION = SIGNAL_STORE_MIGRATIONS[SIGNAL_STORE_MIGRATIONS.length - 1]?.version ?? 0;

export interface SignalSchemaReceipt {
  readonly receiptSchemaId: typeof SIGNAL_RECEIPT_SCHEMA_ID;
  readonly receiptSchemaVersion: typeof SIGNAL_RECEIPT_SCHEMA_VERSION;
  readonly envelopeSchemaId: typeof SIGNAL_ENVELOPE_SCHEMA_ID;
  readonly envelopeSchemaVersion: typeof SIGNAL_ENVELOPE_SCHEMA_VERSION;
  readonly storeSchemaVersion: number;
  readonly storeName: typeof SIGNAL_STORE_NAME;
  readonly storeFileName: typeof SIGNAL_STORE_FILE_NAME;
}

export interface SignalAppendReceipt extends SignalSchemaReceipt {
  readonly outcome: 'stored';
  readonly signalId: string;
  readonly hash: string;
  readonly storedAt: string;
}

const SCHEMA_RECEIPT: SignalSchemaReceipt = Object.freeze({
  receiptSchemaId: SIGNAL_RECEIPT_SCHEMA_ID,
  receiptSchemaVersion: SIGNAL_RECEIPT_SCHEMA_VERSION,
  envelopeSchemaId: SIGNAL_ENVELOPE_SCHEMA_ID,
  envelopeSchemaVersion: SIGNAL_ENVELOPE_SCHEMA_VERSION,
  storeSchemaVersion: SIGNAL_STORE_SCHEMA_VERSION,
  storeName: SIGNAL_STORE_NAME,
  storeFileName: SIGNAL_STORE_FILE_NAME,
});

/** Append one untrusted draft and return only a redacted, schema-versioned receipt. */
export function appendSignalWithReceipt(ctx: SignalStoreContext, candidate: unknown): SignalAppendReceipt {
  const stored = appendSignal(ctx, candidate);
  return Object.freeze({
    ...SCHEMA_RECEIPT,
    outcome: 'stored',
    signalId: stored.envelope.signalId,
    hash: stored.envelope.hash,
    storedAt: stored.storedAt,
  });
}

/** Typed convenience for callers that already hold a draft; runtime validation remains in the store. */
export function appendSignalDraftWithReceipt(ctx: SignalStoreContext, draft: SignalDraft): SignalAppendReceipt {
  return appendSignalWithReceipt(ctx, draft);
}
