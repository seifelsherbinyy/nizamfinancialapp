/**
 * NIZAM · finance.db schema DDL
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: none (DDL text only; repositories arrive in Phase 1.2)
 *
 * Contract 06 §3. Table names are stable identifiers and part of the contract. The
 * column lists here are the required minimum: a later migration may ADD a column and
 * may never repurpose or silently retype one (§5.3).
 *
 * Three rules are mechanical in this file rather than left to review:
 *  1. Every monetary column is `INTEGER` milliunits (§4.1, money-rules §1). There is
 *     no REAL money column, no decimal-string money column, and no money stored as
 *     text. Every table is declared `STRICT`, so the engine itself refuses a REAL
 *     where an INTEGER is declared instead of quietly converting it.
 *  2. A rate is an integer numerator over an integer denominator (§4.4), never a
 *     float that later multiplies money.
 *  3. The columns §3.4 forbids are absent by construction — no credential, no full
 *     account number, no prompt or completion text. Leakage is prevented by the
 *     field not existing, not by a filter that could be bypassed.
 *
 * Vocabulary for transaction type, status, and verification level deliberately mirrors
 * `src/lib/ledger/ledger.types.ts` and contract 02 §4/§6 so the server ledger and the
 * browser ledger describe the same facts with the same words. The SQL is kept literal
 * rather than interpolated from those constants: an applied migration is frozen (§5.1),
 * and text generated from a mutable array would silently change its own checksum.
 */

/** Every table contract 06 §3 names. */
export const TABLES = [
  // §3.1 meta and migration
  'schema_migrations',
  'schema_meta',
  // §3.2 financial facts
  'accounts',
  'source_events',
  'transactions',
  'transaction_links',
  'obligations',
  'statements',
  'decisions',
  'assets',
  'valuations',
  'fx_rates',
  // §3.3 server-tier operational
  'spend_ledger',
  'model_telemetry',
  'update_dedup',
  'work_queue',
  'document_index',
  'audit_log',
] as const;

export type TableName = (typeof TABLES)[number];

/**
 * Column names that carry money, per table. Integer milliunits, all of them.
 * The §4.2 persistence guard consumes this list so the guarded set cannot drift from
 * the DDL by being maintained twice.
 */
export const MONETARY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  accounts: ['balance', 'cleared_balance', 'credit_limit'],
  transactions: ['amount', 'outflow', 'inflow'],
  obligations: ['amount', 'minimum_amount'],
  statements: ['opening_balance', 'closing_balance', 'total_outflow', 'total_inflow', 'minimum_due'],
  decisions: ['expected_effect_milliunits', 'observed_effect_milliunits'],
  assets: ['acquisition_cost'],
  valuations: ['value_milliunits'],
} as const;

/**
 * Column PAIRS that carry a rate, a percentage, or an exchange rate, per table —
 * `[numerator, denominator]`, both INTEGER (§4.4). A rate is never a float that later
 * multiplies money; it is an integer pair applied through the money core's `mulRatio`.
 *
 * Declared here beside the DDL for the same reason `MONETARY_COLUMNS` is: the §4.4 guard
 * reads this list, so the guarded set cannot drift from the schema by being maintained
 * twice. A rate row that cannot be expressed as an integer pair is refused at the
 * boundary by the same guard, with the same typed error, as a non-integer amount.
 *
 * Added by: PFOS Contract 06 / Phase 1.3.
 */
export const RATE_COLUMNS: Readonly<Record<string, readonly [string, string]>> = {
  fx_rates: ['rate_num', 'rate_den'],
} as const;

/**
 * The migrator's own bookkeeping table. Created before any migration runs, because a
 * migration cannot record itself into a table that does not exist yet. Written
 * defensively so a hand-repaired store converges (§5.2.3).
 */
export const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum   TEXT NOT NULL
) STRICT
`.trim();

/** §3.1 — the store's own identity and the engine assertions recorded at creation. */
const MIGRATION_001: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
     id             INTEGER PRIMARY KEY CHECK (id = 1),
     store_name     TEXT NOT NULL,
     created_at     TEXT NOT NULL,
     money_base     TEXT NOT NULL CHECK (money_base = 'milliunits'),
     journal_mode   TEXT NOT NULL,
     foreign_keys   TEXT NOT NULL,
     synchronous    TEXT NOT NULL
   ) STRICT`,
];

/** §3.2 — financial facts. Kept indefinitely (§8.1); corrected by superseding row. */
const MIGRATION_002: readonly string[] = [
  // An account identifier is persisted ONLY as a redacted last-four fragment. A full
  // account number has no column here and never will (§3.4, contract 02 §9).
  `CREATE TABLE IF NOT EXISTS accounts (
     id                       TEXT PRIMARY KEY,
     name                     TEXT NOT NULL,
     type                     TEXT NOT NULL,
     currency                 TEXT NOT NULL DEFAULT 'EGP',
     on_budget                INTEGER NOT NULL DEFAULT 1 CHECK (on_budget IN (0, 1)),
     balance                  INTEGER NOT NULL DEFAULT 0,
     cleared_balance          INTEGER NOT NULL DEFAULT 0,
     credit_limit             INTEGER,
     account_identifier_last4 TEXT CHECK (account_identifier_last4 IS NULL OR length(account_identifier_last4) <= 4),
     closed                   INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
     sort_order               INTEGER NOT NULL DEFAULT 0,
     created_at               TEXT NOT NULL,
     updated_at               TEXT NOT NULL
   ) STRICT`,

  // The immutable inbox. Append-only. The raw payload is retained so a parser change
  // can be replayed, and pruned on its own schedule (§8.2) because it is the most
  // sensitive artifact in the store; the parsed record and its keys stay forever.
  `CREATE TABLE IF NOT EXISTS source_events (
     id                    TEXT PRIMARY KEY,
     received_at           TEXT NOT NULL,
     channel               TEXT NOT NULL,
     idempotency_key       TEXT NOT NULL,
     content_hash          TEXT NOT NULL,
     raw_payload           TEXT,
     raw_payload_pruned_at TEXT,
     parse_state           TEXT NOT NULL DEFAULT 'pending'
                           CHECK (parse_state IN ('pending', 'parsed', 'rejected', 'replayed')),
     document_ref          TEXT,
     UNIQUE (channel, idempotency_key)
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS transactions (
     id                        TEXT PRIMARY KEY,
     account_id                TEXT NOT NULL REFERENCES accounts(id),
     source_event_id           TEXT REFERENCES source_events(id),
     transaction_date          TEXT NOT NULL,
     posting_date              TEXT,
     payee                     TEXT NOT NULL DEFAULT '',
     merchant                  TEXT NOT NULL DEFAULT '',
     memo                      TEXT NOT NULL DEFAULT '',
     category_id               TEXT,
     transaction_type          TEXT NOT NULL
                               CHECK (transaction_type IN ('charge', 'payment', 'fee', 'interest', 'transfer', 'salary')),
     amount                    INTEGER NOT NULL,
     outflow                   INTEGER NOT NULL DEFAULT 0 CHECK (outflow >= 0),
     inflow                    INTEGER NOT NULL DEFAULT 0 CHECK (inflow >= 0),
     currency                  TEXT NOT NULL DEFAULT 'EGP',
     status                    TEXT NOT NULL
                               CHECK (status IN ('pending', 'posted', 'reconciled', 'superseded', 'void')),
     verification_level        TEXT NOT NULL
                               CHECK (verification_level IN ('unverified', 'parser', 'reconciled', 'statement')),
     supersedes_transaction_id TEXT REFERENCES transactions(id),
     audit_version             INTEGER NOT NULL DEFAULT 1 CHECK (audit_version >= 1),
     duplicate_key             TEXT,
     created_at                TEXT NOT NULL,
     updated_at                TEXT NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS transactions_account_date ON transactions(account_id, transaction_date)`,
  `CREATE INDEX IF NOT EXISTS transactions_duplicate_key ON transactions(duplicate_key)`,

  // A suspected duplicate is never deleted automatically (contract 02 §5.2); the
  // relationship is recorded here instead.
  `CREATE TABLE IF NOT EXISTS transaction_links (
     id                   TEXT PRIMARY KEY,
     from_transaction_id  TEXT NOT NULL REFERENCES transactions(id),
     to_transaction_id    TEXT NOT NULL REFERENCES transactions(id),
     link_type            TEXT NOT NULL
                          CHECK (link_type IN ('suspected_duplicate', 'pending_to_posted', 'transfer_pair', 'correction')),
     confidence_bps       INTEGER NOT NULL DEFAULT 0 CHECK (confidence_bps BETWEEN 0 AND 10000),
     created_at           TEXT NOT NULL,
     resolved_at          TEXT,
     resolution           TEXT CHECK (resolution IS NULL OR resolution IN ('confirmed', 'rejected', 'deferred')),
     UNIQUE (from_transaction_id, to_transaction_id, link_type)
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS obligations (
     id             TEXT PRIMARY KEY,
     account_id     TEXT REFERENCES accounts(id),
     name           TEXT NOT NULL,
     kind           TEXT NOT NULL,
     amount         INTEGER NOT NULL,
     minimum_amount INTEGER,
     currency       TEXT NOT NULL DEFAULT 'EGP',
     due_date       TEXT NOT NULL,
     grace_date     TEXT,
     recurrence     TEXT NOT NULL DEFAULT 'none',
     status         TEXT NOT NULL CHECK (status IN ('scheduled', 'paid', 'skipped', 'overdue')),
     priority       INTEGER NOT NULL DEFAULT 0,
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS obligations_due ON obligations(status, due_date)`,

  // A period closes only after the balance equation checks pass, or after an
  // exception is explicitly accepted — never implicitly.
  `CREATE TABLE IF NOT EXISTS statements (
     id              TEXT PRIMARY KEY,
     account_id      TEXT NOT NULL REFERENCES accounts(id),
     statement_month TEXT NOT NULL,
     period_start    TEXT NOT NULL,
     period_end      TEXT NOT NULL,
     opening_balance INTEGER NOT NULL,
     closing_balance INTEGER NOT NULL,
     total_outflow   INTEGER NOT NULL DEFAULT 0 CHECK (total_outflow >= 0),
     total_inflow    INTEGER NOT NULL DEFAULT 0 CHECK (total_inflow >= 0),
     minimum_due     INTEGER,
     close_state     TEXT NOT NULL CHECK (close_state IN ('open', 'balanced', 'exception_accepted')),
     closed_at       TEXT,
     UNIQUE (account_id, statement_month)
   ) STRICT`,

  // Append-only. A decision is superseded by a new row, never edited.
  `CREATE TABLE IF NOT EXISTS decisions (
     id                          TEXT PRIMARY KEY,
     decided_at                  TEXT NOT NULL,
     kind                        TEXT NOT NULL,
     rationale                   TEXT NOT NULL DEFAULT '',
     expected_effect_milliunits  INTEGER,
     observed_effect_milliunits  INTEGER,
     outcome                     TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (outcome IN ('pending', 'confirmed', 'reverted', 'superseded')),
     supersedes_decision_id      TEXT REFERENCES decisions(id),
     audit_version               INTEGER NOT NULL DEFAULT 1 CHECK (audit_version >= 1)
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS assets (
     id               TEXT PRIMARY KEY,
     name             TEXT NOT NULL,
     asset_class      TEXT NOT NULL,
     currency         TEXT NOT NULL DEFAULT 'EGP',
     acquired_at      TEXT,
     acquisition_cost INTEGER,
     created_at       TEXT NOT NULL
   ) STRICT`,

  // A valuation is never overwritten; history is the point.
  `CREATE TABLE IF NOT EXISTS valuations (
     id                TEXT PRIMARY KEY,
     asset_id          TEXT NOT NULL REFERENCES assets(id),
     as_of             TEXT NOT NULL,
     value_milliunits  INTEGER NOT NULL,
     source            TEXT NOT NULL,
     recorded_at       TEXT NOT NULL,
     UNIQUE (asset_id, as_of, recorded_at)
   ) STRICT`,

  // §4.4 — a rate is an integer pair applied through the money core's mulRatio. A row
  // that cannot be expressed as an integer pair is rejected at the boundary.
  `CREATE TABLE IF NOT EXISTS fx_rates (
     id             TEXT PRIMARY KEY,
     base_currency  TEXT NOT NULL,
     quote_currency TEXT NOT NULL,
     rate_num       INTEGER NOT NULL,
     rate_den       INTEGER NOT NULL CHECK (rate_den > 0),
     as_of          TEXT NOT NULL,
     source         TEXT NOT NULL,
     recorded_at    TEXT NOT NULL,
     UNIQUE (base_currency, quote_currency, as_of, source)
   ) STRICT`,
];

/** §3.3 — server-tier operational tables. Bounded retention (§8.2). */
const MIGRATION_003: readonly string[] = [
  // §6.1 — append-only, keyed by agent, actual provider-reported cost in integer
  // micro-USD. The `cost_source` check makes §6.2.1 mechanical: an estimate cannot be
  // recorded here at all. There is no column in a currency the money core owns, so a
  // model cost can never be mistaken for a ledger amount.
  `CREATE TABLE IF NOT EXISTS spend_ledger (
     id                TEXT PRIMARY KEY,
     agent             TEXT NOT NULL CHECK (agent IN ('life', 'finance')),
     occurred_at       TEXT NOT NULL,
     week_key          TEXT NOT NULL,
     model_id          TEXT NOT NULL,
     cost_micro_usd    INTEGER NOT NULL CHECK (cost_micro_usd >= 0),
     prompt_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
     completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
     request_ref       TEXT NOT NULL,
     cost_source       TEXT NOT NULL DEFAULT 'provider_reported_actual'
                       CHECK (cost_source = 'provider_reported_actual')
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS spend_ledger_agent_week ON spend_ledger(agent, week_key)`,

  // No prompt text column. No completion text column. Ever (§3.4).
  `CREATE TABLE IF NOT EXISTS model_telemetry (
     id                TEXT PRIMARY KEY,
     request_ref       TEXT NOT NULL,
     agent             TEXT NOT NULL CHECK (agent IN ('life', 'finance')),
     occurred_at       TEXT NOT NULL,
     model_id          TEXT NOT NULL,
     turn_class        TEXT NOT NULL,
     prompt_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
     completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
     latency_ms        INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
     schema_valid      INTEGER NOT NULL DEFAULT 0 CHECK (schema_valid IN (0, 1)),
     outcome           TEXT NOT NULL
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS model_telemetry_request ON model_telemetry(request_ref)`,

  // Update identifiers are per-bot sequences, so the key must be the pair. A single
  // shared key would make two bots collide (R14).
  `CREATE TABLE IF NOT EXISTS update_dedup (
     bot_id         TEXT NOT NULL,
     update_id      INTEGER NOT NULL,
     first_seen_at  TEXT NOT NULL,
     PRIMARY KEY (bot_id, update_id)
   ) STRICT`,

  `CREATE TABLE IF NOT EXISTS work_queue (
     id           TEXT PRIMARY KEY,
     bot_id       TEXT NOT NULL,
     update_id    INTEGER NOT NULL,
     enqueued_at  TEXT NOT NULL,
     started_at   TEXT,
     completed_at TEXT,
     state        TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
     attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
     last_error   TEXT
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS work_queue_state ON work_queue(state, enqueued_at)`,

  // §7.1 — a POINTER record. No document body, no extracted narrative. The reference
  // is resolved from the runtime environment, never written as a literal in source.
  // A pointer is tombstoned rather than deleted, because a deleted pointer would make
  // the same document look new and be reprocessed.
  `CREATE TABLE IF NOT EXISTS document_index (
     id               TEXT PRIMARY KEY,
     document_ref     TEXT NOT NULL,
     content_hash     TEXT NOT NULL UNIQUE,
     byte_count       INTEGER NOT NULL CHECK (byte_count >= 0),
     document_class   TEXT NOT NULL,
     processing_state TEXT NOT NULL
                      CHECK (processing_state IN ('indexed', 'processed', 'rejected', 'tombstoned')),
     source_event_id  TEXT REFERENCES source_events(id),
     indexed_at       TEXT NOT NULL,
     tombstoned_at    TEXT
   ) STRICT`,

  // Every mutation of a financial record and every external tool call (contract 02 §9),
  // including each prune, which must state its table, cutoff, and row count (§8.3).
  `CREATE TABLE IF NOT EXISTS audit_log (
     id            TEXT PRIMARY KEY,
     occurred_at   TEXT NOT NULL,
     actor         TEXT NOT NULL,
     action        TEXT NOT NULL,
     entity_table  TEXT NOT NULL,
     entity_id     TEXT,
     detail        TEXT NOT NULL DEFAULT '',
     audit_version INTEGER NOT NULL DEFAULT 1 CHECK (audit_version >= 1)
   ) STRICT`,
  `CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log(entity_table, entity_id)`,
];

/**
 * §3.2 / §8.1 — make the decision registry's append-only rule STRUCTURAL.
 *
 * "A decision is superseded by a new row, never edited." A repository that simply
 * declines to expose an update is a convention: the next caller reaches the handle and
 * writes one anyway. These two triggers put the rule in the engine, so an UPDATE or a
 * DELETE against `decisions` is refused whatever the path — repository, migration,
 * diagnostic console, or a later module that has not read this contract.
 *
 * Added as migration 4 rather than by editing migration 2, because an applied migration
 * is frozen (§5.1) and a mistake or an addition is corrected with a NEW migration.
 */
const MIGRATION_004: readonly string[] = [
  `CREATE TRIGGER IF NOT EXISTS decisions_append_only_update
     BEFORE UPDATE ON decisions
   BEGIN
     SELECT RAISE(ABORT, 'decisions is append-only: supersede with a new row, never edit one (contract 06 3.2, 8.1)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS decisions_append_only_delete
     BEFORE DELETE ON decisions
   BEGIN
     SELECT RAISE(ABORT, 'decisions is append-only: a decision is never deleted (contract 06 3.2, 8.1)');
   END`,
];

/**
 * §6.2.2 — the same treatment for the token-spend ledger. Phase 1.4.
 *
 * "No update, no delete, no correction in place. A correction is a compensating row with its own
 * `request_ref`." `spendLedgerRepo.ts` exposes no update path and no delete path, and its test scans
 * the source to prove it — but that is a property of one module, and the engine is what every future
 * caller reaches. These triggers move the refusal into the table.
 *
 * It matters more here than almost anywhere else in the store: an editable spend row is budget that
 * can be silently handed back, which is the one failure §6.2.5 says neither belt may be weakened to
 * allow. Migration 5, because 003 and 004 are frozen once applied (§5.1).
 */
const MIGRATION_005: readonly string[] = [
  `CREATE TRIGGER IF NOT EXISTS spend_ledger_append_only_update
     BEFORE UPDATE ON spend_ledger
   BEGIN
     SELECT RAISE(ABORT, 'spend_ledger is append-only: record a compensating row with its own request_ref, never edit a recorded cost (contract 06 6.2)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS spend_ledger_append_only_delete
     BEFORE DELETE ON spend_ledger
   BEGIN
     SELECT RAISE(ABORT, 'spend_ledger is append-only: a recorded cost was actually incurred and is never removed (contract 06 6.2)');
   END`,
];

/** The DDL of each migration, keyed by version. Consumed only by `migrations.ts`. */
export const SCHEMA_STATEMENTS: Readonly<Record<number, readonly string[]>> = {
  1: MIGRATION_001,
  2: MIGRATION_002,
  3: MIGRATION_003,
  4: MIGRATION_004,
  5: MIGRATION_005,
} as const;
