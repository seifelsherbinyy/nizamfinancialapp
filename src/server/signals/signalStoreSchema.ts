/**
 * NIZAM · signals.db DDL — append-only at the engine, with the audit mirror beside it
 * Implemented by: PFOS Contract 12 / Phase 3.3 (spec 06-two-agent-vps)
 * Owning requirements: R7 (validated on write and on read), R9 (the store is internal-only)
 * Depends on: ../ports/signalBus (vocabulary, for the parity assertion only)
 *
 * Contract 12 §4.1 names three properties of this store and hands the fourth to another
 * contract:
 *
 *  1. `signals.db`, owned by the bus service, on its own volume, **with an append-only audit
 *     mirror**. Two tables, therefore: `signals` and `signal_audit`.
 *  2. Append-only: no update, no delete, **no correction in place**. A correction is a NEW
 *     signal, which is why there is no `supersedes` column here — the envelope schema (§4.2)
 *     has no such field, and inventing one on the way to storage would widen the envelope
 *     that §4.3 exists to keep narrow.
 *  3. Bound to the internal network only (§2.2.5, R9). That is a deployment property, not
 *     something DDL can assert, so it is documented in `ops/BUS_NETWORK_BINDING.md` and
 *     Phase 7 must honour it.
 *  4. The ENGINE invariants — write-ahead logging, enforced foreign keys, no cross-database
 *     open, local filesystem — are contract 06 §2.2's, applied to this third store. §4.1 says
 *     this contract does not restate them, and neither does this module: the store is opened
 *     through the existing connection factory, which asserts every one of them and reads each
 *     pragma back.
 *
 * Three deliberate mechanics, each a rule made structural rather than remembered:
 *
 *  - **Append-only is a TRIGGER, not a convention.** `signalStore.ts` exports no update path
 *     and no delete path, but that is a property of one module and the handle is what a future
 *     caller reaches. Migration 1 installs `BEFORE UPDATE` / `BEFORE DELETE` triggers on both
 *     tables, exactly as contract 06 migrations 4 and 5 did for `decisions` and `spend_ledger`,
 *     so the refusal holds for every path into the store — repository, diagnostic console, or a
 *     later module that has not read this contract. Unlike those two, the tables and their
 *     refusals are created in the SAME migration: there is no frozen predecessor to work
 *     around here, so `signals` is never reachable in a mutable state at all.
 *  - **This is its own migration series.** `signals.db` is a separate file with its own
 *     `schema_migrations` bookkeeping, so its series starts at version 1. Continuing the
 *     finance series would mean applying the finance tables to the bus store, which is the
 *     opposite of §3.1's separation.
 *  - **The SQL is literal, not generated.** Contract 06 §5.1 freezes an applied migration and
 *     the migrator refuses a checksum mismatch, so DDL interpolated from a mutable array would
 *     silently rewrite its own checksum. The enum members are therefore spelled out below and
 *     `signalStore.test.ts` asserts they still agree with `../ports/signalBus`.
 *
 * And one absence worth stating plainly. §4.3.6: an invalid signal is refused AND AUDITED,
 * never parked in a quarantine table, because that table would be exactly the leak the schema
 * prevents. So `signal_audit` has no column for the refused value — see
 * {@link AUDIT_FORBIDDEN_COLUMNS}, which the test asserts against `table_info`. It records the
 * reason, the path the rule fired at, the producer's own identifier, and the LENGTH of a note.
 * A length is a measurement. The text is what was refused, and it is not stored anywhere.
 *
 * No monetary column exists here, and none can: the envelope has no numeric field, so
 * `src/lib/money` is neither imported nor needed. `note_length` on the audit mirror is the only
 * integer in the store and it counts characters, not units.
 */

/** Every table `signals.db` holds. */
export const SIGNAL_STORE_TABLES = ['schema_migrations', 'signal_store_meta', 'signals', 'signal_audit'] as const;
export type SignalStoreTable = (typeof SIGNAL_STORE_TABLES)[number];

/** The store file contract 12 §4.1 names. Injected as a file name, never as a path. */
export const SIGNAL_STORE_FILE_NAME = 'signals.db';

/** The store's logical name, recorded in its identity row. */
export const SIGNAL_STORE_NAME = 'signals';

/**
 * Column names `signal_audit` must never grow (§4.3.6). A refusal audit that retained the
 * refused value would be a quarantine table by another name, so the test asserts the live
 * `table_info` contains none of these — the list is the guard, not a comment about one.
 */
export const AUDIT_FORBIDDEN_COLUMNS = [
  'value',
  'values',
  'payload',
  'received',
  'refused_value',
  'rejected_value',
  'note',
  'note_text',
  'body',
  'text',
  'raw',
  'raw_payload',
  'quarantine',
] as const;

/** What the audit mirror records. Accepts and refusals, and nothing in between. */
export const SIGNAL_AUDIT_EVENTS = ['accepted', 'refused_on_write', 'refused_on_read'] as const;
export type SignalAuditEvent = (typeof SIGNAL_AUDIT_EVENTS)[number];

/**
 * Version 1 of the signals series: the store's identity, the append-only log, the audit
 * mirror, and the four triggers that make "append-only" a property of the engine.
 */
const SIGNAL_MIGRATION_001: readonly string[] = [
  // The store's own identity, and the three claims contract 12 §12 makes about it in
  // machine-readable form. Recorded once at creation so the store carries proof of the
  // conditions it was created under, exactly as `schema_meta` does for finance.db (06 §3.1).
  `CREATE TABLE IF NOT EXISTS signal_store_meta (
     id                 INTEGER PRIMARY KEY CHECK (id = 1),
     store_name         TEXT NOT NULL,
     created_at         TEXT NOT NULL,
     envelope_schema_id TEXT NOT NULL,
     append_only        TEXT NOT NULL CHECK (append_only = 'true'),
     validated_on       TEXT NOT NULL CHECK (validated_on = 'write_and_read'),
     journal_mode       TEXT NOT NULL,
     foreign_keys       TEXT NOT NULL,
     synchronous        TEXT NOT NULL
   ) STRICT`,

  // The stored envelope, one column per schema field (§4.2). Note what is absent: no numeric
  // column, no second temporal column beyond the envelope's own `ts` and the bus's `stored_at`,
  // no identifier pointing at an account, a transaction, or a document, and no `supersedes`
  // pointer — a correction is a new signal, not an edge back to an old one (§4.1).
  `CREATE TABLE IF NOT EXISTS signals (
     signal_id     TEXT PRIMARY KEY,
     ts            TEXT NOT NULL,
     producer      TEXT NOT NULL CHECK (producer IN ('life', 'finance')),
     kind          TEXT NOT NULL
                   CHECK (kind IN ('money_pressure', 'recovery_state', 'readiness', 'budget_breach')),
     tier          TEXT NOT NULL CHECK (tier IN ('money_safe', 'life_safe')),
     consent_scope TEXT NOT NULL CHECK (consent_scope IN ('shared', 'producer_only')),
     level         TEXT NOT NULL CHECK (level IN ('green', 'amber', 'red')),
     direction     TEXT CHECK (direction IS NULL OR direction IN ('downshift', 'hold', 'upshift')),
     note          TEXT CHECK (note IS NULL OR length(note) <= 120),
     hash          TEXT NOT NULL,
     stored_at     TEXT NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS signals_producer_kind_ts ON signals(producer, kind, ts)`,

  // §4.3.6 — the audit mirror. Every accepted signal and every refusal. `reason`, `at_path`
  // and `failure_code` are nullable because an accept has no reason to give; `producer` and
  // `kind` are nullable because a refused envelope may not have carried a member of either
  // enum, and a refusal must be recordable even when nothing about it was well formed.
  // There is no column for the refused value. See AUDIT_FORBIDDEN_COLUMNS.
  `CREATE TABLE IF NOT EXISTS signal_audit (
     id            TEXT PRIMARY KEY,
     occurred_at   TEXT NOT NULL,
     event         TEXT NOT NULL CHECK (event IN ('accepted', 'refused_on_write', 'refused_on_read')),
     producer      TEXT CHECK (producer IS NULL OR producer IN ('life', 'finance')),
     kind          TEXT CHECK (kind IS NULL OR kind IN ('money_pressure', 'recovery_state', 'readiness', 'budget_breach')),
     signal_id_ref TEXT,
     reason        TEXT,
     at_path       TEXT,
     failure_code  TEXT,
     note_length   INTEGER CHECK (note_length IS NULL OR note_length >= 0),
     hash          TEXT
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS signal_audit_sequence ON signal_audit(occurred_at, id)`,
  `CREATE INDEX IF NOT EXISTS signal_audit_event ON signal_audit(event)`,

  // §4.1, and the pattern contract 06 migrations 4 and 5 established. A repository that simply
  // declines to expose an update is a convention; these put the rule in the engine.
  `CREATE TRIGGER IF NOT EXISTS signals_append_only_update
     BEFORE UPDATE ON signals
   BEGIN
     SELECT RAISE(ABORT, 'signals is append-only: a correction is a new signal, never an edit (contract 12 4.1)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS signals_append_only_delete
     BEFORE DELETE ON signals
   BEGIN
     SELECT RAISE(ABORT, 'signals is append-only: a stored signal is never removed (contract 12 4.1)');
   END`,
  // The mirror is append-only for a sharper reason than the log: an editable audit trail is
  // one where a refusal can be made to look like it never happened.
  `CREATE TRIGGER IF NOT EXISTS signal_audit_append_only_update
     BEFORE UPDATE ON signal_audit
   BEGIN
     SELECT RAISE(ABORT, 'signal_audit is append-only: an audit line is never edited (contract 12 4.1, 4.3.6)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS signal_audit_append_only_delete
     BEFORE DELETE ON signal_audit
   BEGIN
     SELECT RAISE(ABORT, 'signal_audit is append-only: an audit line is never removed (contract 12 4.1, 4.3.6)');
   END`,
];

/** The DDL of each signals-series migration, keyed by version. */
export const SIGNAL_SCHEMA_STATEMENTS: Readonly<Record<number, readonly string[]>> = {
  1: SIGNAL_MIGRATION_001,
} as const;
