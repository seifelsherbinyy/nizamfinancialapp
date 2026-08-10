/**
 * NIZAM · model_telemetry repository — actual reported cost, tokens, latency, schema validity
 * Implemented by: PFOS Contract 12 / Phase 5.3 (spec 06-two-agent-vps), owning requirement R19
 * Depends on: connection.ts (StoreHandle), ../ports/openrouter (the ONE telemetry projection,
 *   imported as a type so nothing is pulled into any bundle),
 *   ../../features/routing/spendLedger (the agent enum, the actual-cost literal, the UTC
 *   timestamp rule — all reused, none re-derived)
 *
 * Contract 12 §6.4 lists exactly what may be written down about a model call: "a tier, a model
 * identity, token counts, latency, a schema validity verdict, an actual reported cost, a
 * correlation reference. Never content." This module is that list, persisted — and built so the
 * sentence after it ("no prompt text and no completion text is written to any log, ever") is
 * mechanical at four independent layers rather than remembered at one.
 *
 * ## Layer 1 — the TYPE cannot hold content
 *
 * The write path accepts nothing broader than {@link ModelCallTelemetry}, which Phase 2.1 already
 * defined as a `Redacted<>` projection: every key named for content is typed `never`, so a field
 * called `prompt` or `completion` or `text` cannot hold a string. There is deliberately **no
 * second telemetry shape** in this file. {@link TelemetryRecord} adds only the two things a stored
 * row needs and a loggable projection has no business carrying — a surrogate key and the UTC
 * instant — plus the optional estimate, which is discussed below. The read model
 * {@link ModelTelemetryRow} is wrapped in the same `Redacted` for the same reason: today it
 * resolves to itself, and tomorrow it refuses to compile if somebody adds a content field to it.
 *
 * ## Layer 2 — the DDL has no column that could hold free text of any length
 *
 * Migration 007's comment in `schema.ts` states the column set and why each one is there.
 * {@link TELEMETRY_FORBIDDEN_COLUMNS} enumerates the names the table must never grow, and
 * `modelTelemetryRepo.test.ts` asserts it against the live `table_info` of every table in the
 * store as well as against the DDL text — so the absence is a property of the shipped schema.
 * What the table does hold about content is the two token COUNTS, which §6.4 permits explicitly:
 * a count is a measurement, in the same way `signal_audit.note_length` measures a note it does
 * not keep.
 *
 * ## Layer 3 — the WRITE PATH accepts nothing broader than that projection
 *
 * The type is the first belt and a cast defeats a type, so {@link recordTelemetry} re-checks at
 * run time what the type states at compile time: every key of the projection is a member of the
 * permitted set, no key is content-named, and no string field is long enough or shaped like prose
 * to be anything other than an identifier, an enum member, or a timestamp. A refused record
 * writes nothing.
 *
 * ## Layer 4 — an independent derivation about the STORED ROW
 *
 * {@link contentBreaches} is the one that holds when the other three do not. It re-derives, from
 * the raw record the engine hands back, that the row's key set is exactly the table's columns and
 * that no value on it is prose. It is deliberately NOT a call back into the write guards — the two
 * would then fail together — and it earns its independence the same way Phase 3.2's
 * `deidentificationBreaches` did: it catches what input validation never saw. A caller that
 * reached the handle and inserted a completion into `model_id` passed no write guard at all, and
 * this is the layer that refuses to serve the result.
 *
 * ## Actual cost versus estimated cost, and why they cannot be confused
 *
 * §6.2.1: a pre-flight estimate may GATE a call and may never be what is recorded. Contract 11
 * adapts cost policy from what was recorded. Adapting from estimates would be self-confirming —
 * the governance loop would be grading its own guesses — so the two figures are separated four
 * ways and not merely documented as different:
 *
 *  1. **Different columns, neither of them the bare `cost`.** `actual_cost_micro_usd` and
 *     `preflight_estimate_micro_usd`. A `SELECT` cannot pick up "the cost" by accident, because
 *     no column in this store is named `cost_micro_usd` in a table that also holds an estimate.
 *  2. **Different TYPES, each with a single-member provenance literal.** The actual arrives inside
 *     {@link ModelCallTelemetry}, whose `costSource` is `CostSourceActual`. An estimate arrives as
 *     {@link PreflightCostEstimate}, whose `estimateSource` is {@link CostSourcePreflightEstimate}.
 *     Neither structure type-checks where the other is wanted, in either direction.
 *  3. **A CHECK at the engine.** `actual_cost_source` admits one value, so a caller reaching the
 *     handle still cannot record an estimate as an actual.
 *  4. **Different names on the read model.** `actualCostMicroUsd` is a number;
 *     {@link ModelTelemetryRow.preflightEstimate} is an object that carries its own provenance,
 *     so a consumer that wants a figure has to name which figure it means.
 *
 * ## Append-only
 *
 * Telemetry is evidence. Contract 11 promotes and demotes models from it, and an editable
 * evidence table is a governance input that can be rewritten after the fact to justify the
 * decision it was supposed to inform. This module exposes no update path and no delete path, and
 * its test scans this source to prove it — but the refusal lives in the table, as the two triggers
 * migration 007 installs, so an edit is refused whatever the path. A correction is another
 * {@link recordTelemetry} with its own `id`.
 *
 * ## Money
 *
 * There is none here. Cost is PROVIDER accounting in integer micro-USD (contract 06 §6.1), kept
 * in its own integer unit so it can never be read as a figure in the owner's ledger, which is
 * integer milliunits behind `src/lib/money`. This module does not import the money core, performs
 * no arithmetic, holds no cap literal, and names no host, path, or key (R24).
 */
import type { StoreHandle } from './connection.ts';
import type { ModelCallTelemetry } from '../ports/openrouter.ts';
import type { Redacted } from '../ports/shapeGuards.ts';
import {
  COST_SOURCE_ACTUAL,
  isSpendAgent,
  SPEND_AGENTS,
  weekKeyOf,
  type CostSourceActual,
  type SpendAgent,
} from '../../features/routing/spendLedger.ts';
import { TELEMETRY_FORBIDDEN_COLUMNS } from './schema.ts';

/**
 * `model_telemetry`'s columns, in `table_info` order: migration 003's declaration followed by
 * migration 007's additions. This list is the permitted key set {@link contentBreaches} checks a
 * stored record against, and the expected shape the test asserts against the live table — so a
 * column added later without a decision about it fails both.
 */
export const MODEL_TELEMETRY_COLUMNS = [
  'id',
  'request_ref',
  'agent',
  'occurred_at',
  'model_id',
  'turn_class',
  'prompt_tokens',
  'completion_tokens',
  'latency_ms',
  'schema_valid',
  'outcome',
  'actual_cost_micro_usd',
  'actual_cost_source',
  'preflight_estimate_micro_usd',
  'model_id_served',
  'privacy_policy_asserted',
] as const;
export type ModelTelemetryColumn = (typeof MODEL_TELEMETRY_COLUMNS)[number];

/**
 * The only provenance a PRE-FLIGHT figure may carry. The mirror image of
 * {@link COST_SOURCE_ACTUAL}: two single-member literals that are not each other, so the
 * confusion §6.2.1 forbids is a type error in both directions.
 */
export const ESTIMATE_SOURCE_PREFLIGHT = 'preflight_estimate';
export type CostSourcePreflightEstimate = typeof ESTIMATE_SOURCE_PREFLIGHT;

/**
 * A pre-flight estimate, which may GATE a call and is never the recorded cost (§6.2.1). It is a
 * RECORD rather than a bare number on purpose: a number could be passed where the actual is
 * wanted, and this cannot.
 */
export interface PreflightCostEstimate {
  readonly estimateSource: CostSourcePreflightEstimate;
  /** Integer micro-USD of provider accounting. Not owner money (§6.1). */
  readonly microUsd: number;
}

/** Every outcome §6.4 distinguishes. Typed from the port, so there is one definition. */
export type TelemetryOutcome = ModelCallTelemetry['outcome'];
export const TELEMETRY_OUTCOMES: readonly TelemetryOutcome[] = ['ok', 'refused', 'provider_error'] as const;

/**
 * One completed (or refused) model call, as it is recorded.
 *
 * `telemetry` is Phase 2.1's projection verbatim — this module defines no second telemetry shape.
 * The two extra fields are the surrogate key and the UTC instant, which a loggable projection has
 * no reason to carry, plus the optional estimate, which is kept beside the projection rather than
 * inside it so that a value describing an estimate can never be handed to a field expecting the
 * provider's actual.
 */
export interface TelemetryRecord {
  readonly id: string;
  /** UTC completion instant. Validated by the SAME rule the spend ledger uses, never a second one. */
  readonly occurredAt: string;
  readonly telemetry: ModelCallTelemetry;
  /** Absent for most calls. Present only where a pre-flight estimate actually gated the call. */
  readonly preflightEstimate?: PreflightCostEstimate;
}

/**
 * One stored row, as a reader sees it. Wrapped in `Redacted` for the same reason the port's
 * projection is: a content field added here later would not compile.
 */
export type ModelTelemetryRow = Redacted<{
  readonly id: string;
  readonly requestRef: string;
  readonly agent: SpendAgent;
  readonly occurredAt: string;
  /** The model the router asked for. */
  readonly modelIdRequested: string;
  /** The model the provider actually served (§6.4 permits a model identity). */
  readonly modelIdServed: string;
  /** The classified tier. Never `T0`, because a `T0` turn invokes no model (§6.1, R16). */
  readonly turnClass: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
  readonly schemaValid: boolean;
  /** What the provider REPORTED, integer micro-USD (§6.2.1). */
  readonly actualCostMicroUsd: number;
  readonly actualCostSource: CostSourceActual;
  /** The estimate that gated the call, carrying its own provenance, or `null`. Never the actual. */
  readonly preflightEstimate: PreflightCostEstimate | null;
  /** A row that exists is a row whose request carried the privacy policy (§6.4). */
  readonly privacyPolicyAsserted: true;
  readonly outcome: TelemetryOutcome;
}>;

/** Discriminator for every refusal this repository raises. A caller matches `code`. */
export const MODEL_TELEMETRY_ERROR_CODES = [
  'TELEMETRY_ID_EMPTY',
  'TELEMETRY_REQUEST_REF_EMPTY',
  'TELEMETRY_AGENT_UNKNOWN',
  'TELEMETRY_TIMESTAMP_MALFORMED',
  'TELEMETRY_TURN_CLASS_INVALID',
  'TELEMETRY_MODEL_ID_EMPTY',
  'TELEMETRY_MEASUREMENT_INVALID',
  'TELEMETRY_SCHEMA_VERDICT_INVALID',
  'TELEMETRY_COST_SOURCE_NOT_ACTUAL',
  'TELEMETRY_ESTIMATE_SOURCE_NOT_PREFLIGHT',
  'TELEMETRY_PRIVACY_NOT_ASSERTED',
  'TELEMETRY_OUTCOME_UNKNOWN',
  'TELEMETRY_CONTENT_FIELD_PRESENT',
  'TELEMETRY_STORED_ROW_BREACHED',
  'TELEMETRY_QUERY_INVALID',
] as const;
export type ModelTelemetryErrorCode = (typeof MODEL_TELEMETRY_ERROR_CODES)[number];

/**
 * A typed refusal.
 *
 * `detail` holds references, key names, enum members, and measurements — never a value that could
 * be content. `TELEMETRY_CONTENT_FIELD_PRESENT` in particular reports the KEY that offended and
 * never what was under it, for the reason §4.3.6 gives about quarantine tables: an error message
 * that quotes the refused value is a log line carrying prompt text, which is the thing R19 forbids.
 */
export class ModelTelemetryError extends Error {
  readonly code: ModelTelemetryErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: ModelTelemetryErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ModelTelemetryError';
    this.code = code;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = Object.freeze(flat);
  }
}

// ---------------------------------------------------------------------------------------------
// Layer 4 — the independent derivation about a stored row
// ---------------------------------------------------------------------------------------------

/** What {@link contentBreaches} can find. Each is a claim the stored row is supposed to satisfy. */
export const TELEMETRY_CONTENT_CLAIMS = [
  'no_field_beyond_the_row_shape',
  'no_content_bearing_field',
  'no_free_text',
] as const;
export type TelemetryContentClaim = (typeof TELEMETRY_CONTENT_CLAIMS)[number];

/** One broken claim: which claim, why, and WHERE. Never the value (§6.4). */
export interface TelemetryContentBreach {
  readonly claim: TelemetryContentClaim;
  readonly reason: 'row_not_an_object' | 'column_unrecognized' | 'column_content_named' | 'value_is_prose';
  readonly at: string;
}

/**
 * The longest a legal value in this row can be. Every string column holds an identifier, an enum
 * member, or a UTC timestamp; the widest of those is a model identity, and 120 characters is far
 * beyond any of them. It is the same bound contract 12 puts on a cross-agent note, for the same
 * reason: past it, a string is not a field value, it is narrative.
 */
export const TELEMETRY_FIELD_MAX_LENGTH = 120;

/**
 * Key-name fragments that mean "this column carries content". Assembled from
 * {@link TELEMETRY_FORBIDDEN_COLUMNS} plus the plural and suffixed forms a rogue column might
 * use, and applied ONLY to keys that are not permitted columns — `prompt_tokens` is a permitted
 * count, and a rule that forbade it would forbid the measurement §6.4 explicitly allows.
 */
const CONTENT_NAME_TOKENS: ReadonlySet<string> = new Set<string>([
  ...TELEMETRY_FORBIDDEN_COLUMNS.flatMap((name) => name.split('_')),
  'narrative',
  'prose',
  'completions',
  'prompts',
  'answer',
  'reply',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lowercased alphanumeric fragments of a key name. */
function nameTokens(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/**
 * Is this string a field value, or is it prose? A newline is decisive on its own — no identifier,
 * enum member, or timestamp contains one, and a model completion very often does — and so is
 * length past {@link TELEMETRY_FIELD_MAX_LENGTH}.
 */
function looksLikeProse(value: string): boolean {
  return value.length > TELEMETRY_FIELD_MAX_LENGTH || /[\n\r\t]/.test(value);
}

/**
 * **The content audit, made about the STORED ROW.** Given the raw record the engine handed back,
 * list every claim it breaks. An empty list is the assertion that this row's keys are exactly the
 * table's columns, that none of them is named for content, and that no value on it is prose.
 *
 * This is contract 12 §6.4 stated from the reading side, and it is a SECOND, independent
 * derivation rather than a call back into the write guards — the two would then fail together, and
 * the case worth catching is precisely the one the write path never saw. It is wired into
 * {@link readTelemetry} and also exercised directly, because a guard only ever observed passing is
 * not evidence.
 */
export function contentBreaches(stored: unknown): readonly TelemetryContentBreach[] {
  if (!isRecord(stored)) {
    return [{ claim: 'no_field_beyond_the_row_shape', reason: 'row_not_an_object', at: 'row' }];
  }
  const permitted: readonly string[] = MODEL_TELEMETRY_COLUMNS;
  const breaches: TelemetryContentBreach[] = [];

  for (const [key, value] of Object.entries(stored)) {
    if (!permitted.includes(key)) {
      const contentNamed = nameTokens(key).some((token) => CONTENT_NAME_TOKENS.has(token));
      breaches.push(
        contentNamed
          ? { claim: 'no_content_bearing_field', reason: 'column_content_named', at: key }
          : { claim: 'no_field_beyond_the_row_shape', reason: 'column_unrecognized', at: key },
      );
    }
    if (typeof value === 'string' && looksLikeProse(value)) {
      breaches.push({ claim: 'no_free_text', reason: 'value_is_prose', at: key });
    }
  }
  return breaches;
}

// ---------------------------------------------------------------------------------------------
// Layer 3 — the write path
// ---------------------------------------------------------------------------------------------

/** Every key {@link ModelCallTelemetry} legitimately carries. A surplus key is refused. */
const PERMITTED_TELEMETRY_KEYS: readonly string[] = [
  'correlationRef',
  'agent',
  'tier',
  'modelIdRequested',
  'modelIdServed',
  'promptTokens',
  'completionTokens',
  'costMicroUsd',
  'costSource',
  'latencyMs',
  'schemaValid',
  'privacyPolicyAsserted',
  'outcome',
];

/** The tier a `T0` turn would carry. A telemetry row for it is a contradiction (§6.1, R16). */
const NO_MODEL_TIER = 'T0';

function requireText(value: unknown, field: string, code: ModelTelemetryErrorCode, why: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ModelTelemetryError(code, `NIZAM model telemetry: ${field} ${why}`, { field });
  }
  if (looksLikeProse(value)) {
    // Reported by key, never by value: quoting it here would be the log line R19 forbids.
    throw new ModelTelemetryError(
      'TELEMETRY_CONTENT_FIELD_PRESENT',
      `NIZAM model telemetry: ${field} carries a value that is prose rather than an identifier, an enum member, or a timestamp. Contract 12 §6.4 permits redacted features only, so the value is refused and is not quoted here (R19).`,
      { field, length: value.length },
    );
  }
  return value;
}

function requireMeasurement(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ModelTelemetryError(
      'TELEMETRY_MEASUREMENT_INVALID',
      `NIZAM model telemetry: ${field} must be a non-negative safe integer as reported, got ${String(value)}. There is no rounding and no coercion at this boundary.`,
      { field, received: value },
    );
  }
  return value;
}

/**
 * The runtime half of layer 1. The projection's type forbids a content field; a cast defeats a
 * type, so the key set is checked here as well. Reports the offending KEY and nothing under it.
 */
function assertNoSurplusKey(telemetry: ModelCallTelemetry): void {
  for (const key of Object.keys(telemetry)) {
    if (PERMITTED_TELEMETRY_KEYS.includes(key)) continue;
    const contentNamed = nameTokens(key).some((token) => CONTENT_NAME_TOKENS.has(token));
    throw new ModelTelemetryError(
      'TELEMETRY_CONTENT_FIELD_PRESENT',
      contentNamed
        ? `NIZAM model telemetry: the field "${key}" is named for model content, and contract 12 §6.4 permits redacted features only — a tier, a model identity, token counts, latency, a schema verdict, an actual reported cost, a correlation reference. Nothing is written, and the offending value is not quoted (R19).`
        : `NIZAM model telemetry: the field "${key}" is not part of the loggable projection, so nothing vouches for it being a redacted feature. It is refused rather than dropped, because dropping it silently would make the next surplus field a leak (§6.4, R19).`,
      { field: key },
    );
  }
}

const INSERT_SQL = `
INSERT INTO model_telemetry
  (id, request_ref, agent, occurred_at, model_id, turn_class, prompt_tokens, completion_tokens,
   latency_ms, schema_valid, outcome, actual_cost_micro_usd, actual_cost_source,
   preflight_estimate_micro_usd, model_id_served, privacy_policy_asserted)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'true')
`.trim();

/**
 * Record one model call. The only write path in this module.
 *
 * Refuses, with a typed {@link ModelTelemetryError} and without writing anything:
 *  - a cost source that is not the provider's reported actual — an estimate never lands here;
 *  - a pre-flight estimate whose own provenance literal is wrong, so the two figures cannot swap;
 *  - a non-integer or negative cost, token count, or latency — no rounding, no repair;
 *  - an unknown agent, an empty identifier, an unknown outcome, a non-boolean schema verdict;
 *  - a completion instant that is not an unambiguous UTC instant;
 *  - a `T0` turn class, because a `T0` turn invokes no model at all (§6.1, R16);
 *  - a projection carrying any field beyond the loggable set, content-named or not (§6.4, R19).
 *
 * @returns The row exactly as it was stored.
 */
export function recordTelemetry(handle: StoreHandle, record: TelemetryRecord): ModelTelemetryRow {
  const { telemetry } = record;
  assertNoSurplusKey(telemetry);

  const id = requireText(record.id, 'id', 'TELEMETRY_ID_EMPTY', 'is required as the row identifier');
  const requestRef = requireText(
    telemetry.correlationRef,
    'correlationRef',
    'TELEMETRY_REQUEST_REF_EMPTY',
    'is required — it is the only link between this row and the spend ledger row for the same call',
  );

  if (!isSpendAgent(telemetry.agent)) {
    throw new ModelTelemetryError(
      'TELEMETRY_AGENT_UNKNOWN',
      `NIZAM model telemetry: agent must be one of ${SPEND_AGENTS.join(', ')}, got "${String(telemetry.agent)}". An unknown agent is refused rather than recorded, because per-agent isolation is what makes R17 reachable.`,
      { received: telemetry.agent },
    );
  }

  // The UTC instant rule is the spend ledger's, reused rather than re-derived: two derivations
  // would eventually disagree about which instant a call happened at, and the correlation between
  // a telemetry row and its ledger row is the whole point of `request_ref`.
  const occurredAt = requireText(
    record.occurredAt,
    'occurredAt',
    'TELEMETRY_TIMESTAMP_MALFORMED',
    'is required as a UTC completion instant',
  );
  try {
    weekKeyOf(occurredAt);
  } catch {
    throw new ModelTelemetryError(
      'TELEMETRY_TIMESTAMP_MALFORMED',
      `NIZAM model telemetry: occurredAt must be UTC as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ, got "${occurredAt}". An offset is refused rather than assumed, by the same rule the spend ledger applies.`,
      { received: occurredAt },
    );
  }

  const turnClass = requireText(
    telemetry.tier,
    'tier',
    'TELEMETRY_TURN_CLASS_INVALID',
    'is required as the classified tier',
  );
  if (turnClass === NO_MODEL_TIER) {
    throw new ModelTelemetryError(
      'TELEMETRY_TURN_CLASS_INVALID',
      `NIZAM model telemetry: a turn classified ${NO_MODEL_TIER} invokes no model, so a telemetry row describing a model call at that tier is a contradiction and is refused (§6.1, R16).`,
      { received: turnClass },
    );
  }

  const modelIdRequested = requireText(
    telemetry.modelIdRequested,
    'modelIdRequested',
    'TELEMETRY_MODEL_ID_EMPTY',
    'is required — the model the router asked for',
  );
  const modelIdServed = requireText(
    telemetry.modelIdServed,
    'modelIdServed',
    'TELEMETRY_MODEL_ID_EMPTY',
    'is required — the model the provider actually served, which may differ from the one requested',
  );

  const promptTokens = requireMeasurement(telemetry.promptTokens, 'promptTokens');
  const completionTokens = requireMeasurement(telemetry.completionTokens, 'completionTokens');
  const latencyMs = requireMeasurement(telemetry.latencyMs, 'latencyMs');

  if (typeof telemetry.schemaValid !== 'boolean') {
    throw new ModelTelemetryError(
      'TELEMETRY_SCHEMA_VERDICT_INVALID',
      `NIZAM model telemetry: schemaValid is a per-call verdict and must be a boolean, got "${String(telemetry.schemaValid)}". A missing verdict is not the same as a failed one, so it is refused rather than defaulted (contract 09/11 consume this field).`,
      { received: telemetry.schemaValid },
    );
  }

  // §6.2.1, the runtime belt behind the type-level one and in front of the table's CHECK.
  if (telemetry.costSource !== COST_SOURCE_ACTUAL) {
    throw new ModelTelemetryError(
      'TELEMETRY_COST_SOURCE_NOT_ACTUAL',
      `NIZAM model telemetry: refusing to record cost source "${String(telemetry.costSource)}" as the actual cost. Only ${COST_SOURCE_ACTUAL} lands in actual_cost_micro_usd (§6.2.1); a pre-flight estimate may gate a call and belongs in preflight_estimate_micro_usd, which contract 11 must never read as an actual.`,
      { received: telemetry.costSource },
    );
  }
  const actualCostMicroUsd = requireMeasurement(telemetry.costMicroUsd, 'costMicroUsd');

  let preflightEstimate: PreflightCostEstimate | null = null;
  if (record.preflightEstimate !== undefined) {
    const estimate = record.preflightEstimate;
    if (estimate.estimateSource !== ESTIMATE_SOURCE_PREFLIGHT) {
      throw new ModelTelemetryError(
        'TELEMETRY_ESTIMATE_SOURCE_NOT_PREFLIGHT',
        `NIZAM model telemetry: an estimate must declare provenance "${ESTIMATE_SOURCE_PREFLIGHT}", got "${String(estimate.estimateSource)}". The two provenance literals are what keep an estimate from being stored as an actual and an actual from being stored as an estimate (§6.2.1).`,
        { received: estimate.estimateSource },
      );
    }
    preflightEstimate = {
      estimateSource: ESTIMATE_SOURCE_PREFLIGHT,
      microUsd: requireMeasurement(estimate.microUsd, 'preflightEstimate.microUsd'),
    };
  }

  // §6.4: a per-request assertion is what a test can observe. A row that exists is a row whose
  // request carried the policy, so a record that cannot assert it is refused rather than stored
  // with the claim left blank.
  if (telemetry.privacyPolicyAsserted !== true) {
    throw new ModelTelemetryError(
      'TELEMETRY_PRIVACY_NOT_ASSERTED',
      'NIZAM model telemetry: every model request carries the provider privacy policy, so a telemetry row that does not assert it is refused. An account-level default is a second belt, never a substitute for the per-request assertion (§6.4, R19).',
      { received: telemetry.privacyPolicyAsserted },
    );
  }

  if (!TELEMETRY_OUTCOMES.includes(telemetry.outcome)) {
    throw new ModelTelemetryError(
      'TELEMETRY_OUTCOME_UNKNOWN',
      `NIZAM model telemetry: outcome must be one of ${TELEMETRY_OUTCOMES.join(', ')}, got "${String(telemetry.outcome)}"`,
      { received: telemetry.outcome },
    );
  }

  const row: ModelTelemetryRow = {
    id,
    requestRef,
    agent: telemetry.agent,
    occurredAt,
    modelIdRequested,
    modelIdServed,
    turnClass,
    promptTokens,
    completionTokens,
    latencyMs,
    schemaValid: telemetry.schemaValid,
    actualCostMicroUsd,
    actualCostSource: COST_SOURCE_ACTUAL,
    preflightEstimate,
    privacyPolicyAsserted: true,
    outcome: telemetry.outcome,
  };

  // Every guard above ran before the statement was prepared, so a refused value never reaches
  // the engine.
  handle.db
    .prepare(INSERT_SQL)
    .run(
      row.id,
      row.requestRef,
      row.agent,
      row.occurredAt,
      row.modelIdRequested,
      row.turnClass,
      row.promptTokens,
      row.completionTokens,
      row.latencyMs,
      row.schemaValid ? 1 : 0,
      row.outcome,
      row.actualCostMicroUsd,
      row.actualCostSource,
      row.preflightEstimate === null ? null : row.preflightEstimate.microUsd,
      row.modelIdServed,
    );
  return row;
}

// ---------------------------------------------------------------------------------------------
// The read path
// ---------------------------------------------------------------------------------------------

const SELECT_COLUMNS = MODEL_TELEMETRY_COLUMNS.join(', ');

const SELECT_ALL_SQL = `
SELECT ${SELECT_COLUMNS}
FROM model_telemetry
ORDER BY occurred_at, id
`.trim();

const SELECT_AGENT_SQL = `
SELECT ${SELECT_COLUMNS}
FROM model_telemetry
WHERE agent = ?
ORDER BY occurred_at, id
`.trim();

const SELECT_REQUEST_SQL = `
SELECT ${SELECT_COLUMNS}
FROM model_telemetry
WHERE request_ref = ?
ORDER BY occurred_at, id
`.trim();

/**
 * Map a raw record to the read model, AFTER layer 4 has cleared it. The order matters: a row that
 * would be refused must not be mapped first, because mapping is what would place an unvetted
 * string into a field a caller trusts.
 */
function toRow(stored: Record<string, unknown>): ModelTelemetryRow {
  for (const breach of contentBreaches(stored)) {
    throw new ModelTelemetryError(
      'TELEMETRY_STORED_ROW_BREACHED',
      `NIZAM model telemetry: refusing to serve the stored column "${breach.at}" — the claim "${breach.claim}" does not hold for it (${breach.reason}). Contract 12 §6.4 permits redacted features only, and the offending value is not quoted here (R19).`,
      { at: breach.at, claim: breach.claim, reason: breach.reason },
    );
  }
  const estimate = stored.preflight_estimate_micro_usd;
  return {
    id: String(stored.id),
    requestRef: String(stored.request_ref),
    agent: stored.agent as SpendAgent,
    occurredAt: String(stored.occurred_at),
    modelIdRequested: String(stored.model_id),
    modelIdServed: String(stored.model_id_served),
    turnClass: String(stored.turn_class),
    promptTokens: Number(stored.prompt_tokens),
    completionTokens: Number(stored.completion_tokens),
    latencyMs: Number(stored.latency_ms),
    schemaValid: Number(stored.schema_valid) === 1,
    actualCostMicroUsd: Number(stored.actual_cost_micro_usd),
    actualCostSource: stored.actual_cost_source as CostSourceActual,
    preflightEstimate:
      estimate === null || estimate === undefined
        ? null
        : { estimateSource: ESTIMATE_SOURCE_PREFLIGHT, microUsd: Number(estimate) },
    privacyPolicyAsserted: true,
    outcome: stored.outcome as TelemetryOutcome,
  };
}

/** What a caller may narrow a read by. There is no free-text filter, because there is no text. */
export interface TelemetryQuery {
  readonly agent?: SpendAgent;
  readonly requestRef?: string;
}

/**
 * Read stored telemetry, running layer 4's derivation over every row before it is served.
 *
 * A row that breaches a claim refuses the whole read rather than being skipped: serving the rows
 * that happen to pass would leave the caller unable to tell a filtered answer from a complete one,
 * which is the same reason the signal store refuses a partial delivery.
 */
export function readTelemetry(handle: StoreHandle, query: TelemetryQuery = {}): readonly ModelTelemetryRow[] {
  if (query.agent !== undefined && !isSpendAgent(query.agent)) {
    throw new ModelTelemetryError(
      'TELEMETRY_QUERY_INVALID',
      `NIZAM model telemetry: a read may be scoped to one of ${SPEND_AGENTS.join(', ')}, got "${String(query.agent)}"`,
      { received: query.agent },
    );
  }
  if (query.requestRef !== undefined && (typeof query.requestRef !== 'string' || query.requestRef.trim() === '')) {
    throw new ModelTelemetryError(
      'TELEMETRY_QUERY_INVALID',
      'NIZAM model telemetry: a correlation reference filter must be a non-empty string',
    );
  }

  const records =
    query.requestRef !== undefined
      ? handle.db.prepare(SELECT_REQUEST_SQL).all(query.requestRef)
      : query.agent !== undefined
        ? handle.db.prepare(SELECT_AGENT_SQL).all(query.agent)
        : handle.db.prepare(SELECT_ALL_SQL).all();

  return records.map((record) => toRow(record as Record<string, unknown>));
}

/** How many calls the store has recorded. A count of rows, not a figure about anything. */
export function recordedCallCount(handle: StoreHandle): number {
  const row = handle.db.prepare('SELECT COUNT(*) AS n FROM model_telemetry').get();
  return Number((row as { n: number }).n);
}
