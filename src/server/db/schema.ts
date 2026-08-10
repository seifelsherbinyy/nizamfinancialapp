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

/**
 * Contract 12 §5.5 — give `work_queue` the columns the accept-fast path actually needs. Phase 4.3.
 *
 * §3.3's `work_queue` was declared in migration 003 with the operational minimum: identity,
 * timing, state, attempts. `TelegramWorkItem` (`../ports/telegram.ts`) additionally requires the
 * sender and the raw body, because §5.5.1 acknowledges the delivery *before* anything reads it —
 * so the body has to be durable on this side of the acknowledgement or it is simply gone (§5.5.2).
 * `not_before` is the backoff instant a §5.5.4 queue retry sets: a downstream failure is rescheduled
 * here, inside the queue, and never handed back to the provider as a failed delivery.
 *
 * A NEW migration rather than an edit to 003, because an applied migration is frozen (§5.1) and the
 * migrator's checksum guard refuses a rewritten one rather than guessing which state is correct.
 *
 * These four statements cannot all be defensive, and that is worth stating rather than hiding:
 * SQLite's `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` form. What makes the run
 * once-only is the recorded version — §5.2.2 skips a recorded migration without executing a single
 * statement — not the DDL's own idempotence. The two index statements are defensive because they can be.
 *
 * `UNIQUE (bot_id, update_id)` is the structural half of §5.5.3's idempotence: enqueueing is a
 * conflict-ignoring insert, so the same delivery cannot produce two units of work even if the
 * accept path is entered twice concurrently. It is the same device §5.4.2 uses for dedup, for the
 * same reason — a unique index cannot be raced, and a read-then-write check can.
 */
const MIGRATION_006: readonly string[] = [
  `ALTER TABLE work_queue ADD COLUMN sender_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE work_queue ADD COLUMN raw_body TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE work_queue ADD COLUMN not_before TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_queue_delivery ON work_queue(bot_id, update_id)`,
  `CREATE INDEX IF NOT EXISTS work_queue_claimable ON work_queue(state, not_before, enqueued_at)`,
];

/**
 * Contract 06 §3.3 / §6.2 and contract 12 §6.4 — finish `model_telemetry`. Phase 5.3 (R19).
 *
 * §3.3 declared the table in migration 003 with tokens, latency, schema validity, and model
 * identity. Three things §6.4 permits an operator to see were missing from it, and one thing
 * §6.2.1 requires of any recorded cost was not expressible:
 *
 *  - **The ACTUAL reported cost.** There was no cost column at all, so "what the provider
 *    reported" had nowhere to land beside the call it describes. `actual_cost_micro_usd` is
 *    integer micro-USD of PROVIDER accounting, exactly as `spend_ledger.cost_micro_usd` is,
 *    and `actual_cost_source` carries the same single-value CHECK: an estimate cannot be
 *    written into the actual column at all, whatever path reaches the table.
 *  - **The pre-flight estimate, in a column that cannot be read as the actual.** §6.2.1 lets an
 *    estimate GATE a call and never be what is recorded; contract 11 adapts cost policy from
 *    what was recorded. If the two shared a column — or a name a query could confuse — the
 *    governance loop would be adapting from its own guesses and confirming itself. So the
 *    estimate is `preflight_estimate_micro_usd`: nullable, because most calls have no estimate,
 *    and named for its provenance, so neither column is the bare `cost` a careless SELECT picks
 *    up. Note that neither name is `cost_micro_usd`; the ambiguous name exists in no table.
 *  - **The model actually SERVED.** 003's `model_id` is the model the router asked for. A
 *    provider may serve another, and §6.4 lists "a model identity" among what may be logged —
 *    which is only useful if the served identity is recorded next to the requested one.
 *  - **The per-request privacy assertion.** §6.4: every request carries the provider privacy
 *    policy, and "a per-request assertion is what a test can observe". Single-valued, so a row
 *    that exists is a row whose request carried the policy.
 *
 * And the triggers, for the reason migration 004 and 005 give: telemetry is EVIDENCE. Contract
 * 11 promotes and demotes models from it, and an editable evidence table is a governance input
 * that can be quietly rewritten to justify a decision after the fact. The repository exposes no
 * update path and no delete path and its test scans the source to prove it — but that is a
 * property of one module, and the handle is what every future caller reaches.
 *
 * A NEW migration rather than an edit to 003, because an applied migration is frozen (§5.1) and
 * the migrator refuses a rewritten checksum rather than guessing which state is correct. The five
 * `ADD COLUMN` statements cannot be defensive: SQLite's `ALTER TABLE ADD COLUMN` has no
 * `IF NOT EXISTS` form, and what makes the run once-only is the recorded version — §5.2.2 skips a
 * recorded migration without executing a single statement — not the DDL's own re-runnability.
 *
 * No column here can hold prompt or completion text, and none ever will (§3.4). The absence is
 * asserted against the live `table_info` by `modelTelemetryRepo.test.ts` and against this DDL
 * text by the same file, so it is a property of the shipped table rather than of this comment.
 */
const MIGRATION_007: readonly string[] = [
  `ALTER TABLE model_telemetry ADD COLUMN actual_cost_micro_usd INTEGER NOT NULL DEFAULT 0
     CHECK (actual_cost_micro_usd >= 0)`,
  `ALTER TABLE model_telemetry ADD COLUMN actual_cost_source TEXT NOT NULL DEFAULT 'provider_reported_actual'
     CHECK (actual_cost_source = 'provider_reported_actual')`,
  `ALTER TABLE model_telemetry ADD COLUMN preflight_estimate_micro_usd INTEGER
     CHECK (preflight_estimate_micro_usd IS NULL OR preflight_estimate_micro_usd >= 0)`,
  `ALTER TABLE model_telemetry ADD COLUMN model_id_served TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE model_telemetry ADD COLUMN privacy_policy_asserted TEXT NOT NULL DEFAULT 'true'
     CHECK (privacy_policy_asserted = 'true')`,
  `CREATE INDEX IF NOT EXISTS model_telemetry_agent_occurred ON model_telemetry(agent, occurred_at)`,
  `CREATE TRIGGER IF NOT EXISTS model_telemetry_append_only_update
     BEFORE UPDATE ON model_telemetry
   BEGIN
     SELECT RAISE(ABORT, 'model_telemetry is append-only: telemetry is the evidence contract 11 promotes and demotes models from, so a recorded call is never edited (contract 06 3.3, contract 12 6.4)');
   END`,
  `CREATE TRIGGER IF NOT EXISTS model_telemetry_append_only_delete
     BEFORE DELETE ON model_telemetry
   BEGIN
     SELECT RAISE(ABORT, 'model_telemetry is append-only: a call that happened is never unrecorded; retention pruning is an explicit operation, never an incidental delete (contract 06 3.3, 8.2)');
   END`,
];

/**
 * Column names `model_telemetry` must never grow (§3.4, contract 12 §6.4, R19).
 *
 * The list is the guard, not a comment about one: `modelTelemetryRepo.test.ts` asserts the live
 * `table_info` of EVERY table in the store contains no column whose name equals one of these, and
 * asserts the same about the DDL text of every migration above. §3.4 forbids prompt text and
 * completion text in any column under any name, and a name is the one part of "under any name"
 * a test can actually enumerate.
 *
 * Matching is by exact column name, deliberately. `prompt_tokens` and `completion_tokens` are
 * COUNTS — a measurement of content, which §6.4 explicitly permits an operator to see, in the
 * same way `signal_audit.note_length` measures a note it does not keep. A substring rule would
 * forbid the counts and pass anything named `narrative`, which is the wrong trade in both
 * directions.
 */
export const TELEMETRY_FORBIDDEN_COLUMNS = [
  'body',
  'completion',
  'completion_text',
  'content',
  'message',
  'messages',
  'prompt',
  'prompt_text',
  'raw_request',
  'raw_response',
  'reasoning',
  'reasoning_text',
  'request_body',
  'response',
  'response_body',
  'response_text',
  'text',
  'transcript',
] as const;

/**
 * Spec 08 wave A2 — the provenance columns §3.2 promises and the DDL did not carry. Phase 2.2.
 *
 * The spec's own table map says `transactions` carries "its own confidence score, confidence reason,
 * extraction method and duplicate key". Migration 002 declared the duplicate key and none of the other
 * three, so a load that satisfied K4 was not expressible: there was nowhere for a source reference or
 * an extraction method to land, and a row with unknown provenance could only be stored as though it
 * had none. These columns are what make K4 a property of the store rather than of a report about it.
 *
 * Four of them exist because of what the LIVE artifact turned out to hold, and each is worth stating:
 *
 *  - `extraction_method` accepts `unknown` as a FOURTH value. Without it, an unrecognised upstream
 *    extractor has no honest home, and finding F23 is the shared importer picking `manual` for that
 *    case — a machine-extracted row claiming a human entered it, which K4 forbids in as many words.
 *  - `extraction_method_raw` and `transaction_type_raw` keep the upstream token VERBATIM. The
 *    canonical export's nine transaction-type tokens and its one extractor token are none of them in
 *    this repository's vocabulary, so a translation is unavoidable; keeping the source token beside the
 *    translated one is what makes the translation auditable rather than lossy.
 *  - `confidence_bps` and `confidence_band` are SEPARATE columns because the source turned out to hold
 *    an ordinal word where the schema document promised a 0..1 score. Rendering a band as a score
 *    invents precision nobody measured, and reading the word with a numeric coercion — which is what
 *    the lenient path does — yields zero on every row. A band is stored as a band.
 *
 * Confidence is basis points rather than a real, for the reason §4.4 gives about rates: this tier holds
 * no floating-point quantity that later multiplies or filters money. `transaction_links` already
 * expresses a confidence this way, so the vocabulary is not new.
 *
 * `statements.close_exception_reason` is the other half of A2.5: a period whose totals do not satisfy
 * the balance equation is closed as an accepted exception AND a reason, never silently balanced. The
 * column holds a reason CODE — no amount, because a residual is a monetary value and this is a text
 * column outside the §4.2 guard.
 *
 * `document_index.set_name` and `set_ordinal` are A4.2: the owner's recovery plan is one ordered set
 * across five horizons, and ordering is meaning there rather than presentation — an agent that applied
 * the year-long monitoring horizon as though it were the immediate triage would be giving advice the
 * owner never agreed to. The unique index makes two documents claiming the same position impossible.
 *
 * A NEW migration rather than an edit, because an applied migration is frozen (§5.1). The `ADD COLUMN`
 * statements cannot be defensive — SQLite has no `IF NOT EXISTS` form for them — and what makes the run
 * once-only is the recorded version (§5.2.2), not the DDL's own re-runnability.
 */
const MIGRATION_008: readonly string[] = [
  `ALTER TABLE transactions ADD COLUMN source_file TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE transactions ADD COLUMN source_page_or_sheet TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE transactions ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'unknown'
     CHECK (extraction_method IN ('parser', 'ocr', 'manual', 'unknown'))`,
  `ALTER TABLE transactions ADD COLUMN extraction_method_raw TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE transactions ADD COLUMN transaction_type_raw TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE transactions ADD COLUMN confidence_bps INTEGER
     CHECK (confidence_bps IS NULL OR confidence_bps BETWEEN 0 AND 10000)`,
  `ALTER TABLE transactions ADD COLUMN confidence_band TEXT
     CHECK (confidence_band IS NULL OR confidence_band IN ('high', 'medium', 'low'))`,
  `ALTER TABLE transactions ADD COLUMN confidence_reason TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS transactions_extraction_method ON transactions(extraction_method)`,
  `ALTER TABLE statements ADD COLUMN close_exception_reason TEXT`,
  `ALTER TABLE document_index ADD COLUMN set_name TEXT`,
  `ALTER TABLE document_index ADD COLUMN set_ordinal INTEGER
     CHECK (set_ordinal IS NULL OR set_ordinal >= 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS document_index_set_position ON document_index(set_name, set_ordinal)`,
];

/** The DDL of each migration, keyed by version. Consumed only by `migrations.ts`. */
export const SCHEMA_STATEMENTS: Readonly<Record<number, readonly string[]>> = {
  1: MIGRATION_001,
  2: MIGRATION_002,
  3: MIGRATION_003,
  4: MIGRATION_004,
  5: MIGRATION_005,
  6: MIGRATION_006,
  7: MIGRATION_007,
  8: MIGRATION_008,
} as const;
