/**
 * NIZAM · Structured redacted logger — no prompt text, no secret, no owner figure, no particular
 * Implemented by: PFOS Contract 12 / Phase 7.5 (spec 06-two-agent-vps), owning requirements R19, R22
 *   with R24 support (no deployment particular in anything this tier writes down)
 * Depends on: ../ports/shapeGuards (`Redacted`, `ContentBearingKey` — the ONE redaction vocabulary),
 *   ../../features/routing/spendLedger (the agent enum and the UTC instant rule, reused not re-derived),
 *   ./composeTemplate (`scanForParticulars` — the ONE particular scan, reused not re-derived)
 *
 * Contract 12 §6.4 says two things about logs and this module is both of them:
 *
 *   "No prompt text and no completion text is written to any log, EVER. Not at debug level. Not on
 *    error. Not in a crash dump. Not in a bus signal. Not in a backup manifest."
 *   "Logs are STRUCTURED, so redaction is a property of the schema rather than of a formatting string
 *    that someone will eventually change."
 *
 * The second sentence is the mechanism for the first. A formatted log line is a template with a hole
 * in it, and every hole eventually gets a variable somebody did not think about; the failure is silent
 * and looks exactly like a working log. So there is no format string in this module and no way to
 * build one: a caller supplies NAMED FIELDS from a closed set, each of a declared kind, and the
 * serializer is the only thing that produces text.
 *
 * `modelTelemetryRepo.ts` made the same promise about a stored ROW at four independent layers. This is
 * the same promise one layer further out, about a LOG LINE, and it deliberately reuses that module's
 * devices rather than inventing a second vocabulary for the same rule.
 *
 * ## Layer 1 — no field TYPE can hold prose
 *
 * {@link LogFieldValue} is a discriminated union of feature kinds: an enum member, a bounded
 * reference, a count, a duration, a micro-USD figure, a boolean verdict. **There is deliberately no
 * `text` member.** A caller holding a completion has nothing to put it in — not a wide string field,
 * not an `unknown`, not a `Record<string, string>`. The record itself is wrapped in `Redacted<>` from
 * `ports/shapeGuards`, the same wrapper the telemetry projection uses, so a field named for content
 * cannot hold a value even if one is added later; and in {@link NoOwnerFigure}, so a field named for
 * owner money cannot either.
 *
 * ## Layer 2 — the FIELD NAME SET is closed, and each name has exactly one legal kind
 *
 * {@link LOG_FIELD_KINDS} is §6.4's permitted list — "a tier, a model identity, token counts,
 * latency, a schema validity verdict, an actual reported cost, a correlation reference" — plus the
 * operational features §7.3 and §8 need, and nothing else. Each name maps to ONE kind, so
 * `promptTokens` can only ever be a count and `tier` can only ever be an enum member. A field name
 * outside the map is refused rather than dropped: dropping it silently is what makes the NEXT
 * unrecognized field a leak.
 *
 * ## Layer 3 — the WRITE PATH re-checks what the types state
 *
 * A cast defeats a type, so {@link buildRecord} re-checks the key set, the kind of each value, the
 * shape of each string, the integrality of each number, the agent, and the instant at run time. It
 * refuses with a typed error and writes nothing. A refusal reports the offending FIELD NAME and never
 * the value under it — quoting the refused value in the error message would itself be the log line
 * R19 forbids, which is the trap `modelTelemetryRepo.ts` §4.3.6 already names.
 *
 * ## Layer 4 — an independent derivation about the EMITTED LINE
 *
 * {@link logLineBreaches} is the layer that holds when the other three do not, and it is the layer
 * that earned its place: the equivalent check about a stored row in Phase 5.3 caught a real leak that
 * input validation never saw. It takes the FINISHED TEXT — not the record, not the draft, the bytes
 * that would go to the log — parses it back, and re-derives from the exported constants that the key
 * set is exactly the record shape, that no key is content-named or money-named, that no value is
 * prose, that no number is a decimal, and that the line holds no deployment particular. It is not a
 * call back into the write guards: those would fail together with them, and the case worth catching is
 * precisely the one no write guard ever saw — a caller that assembled a line itself, a value that
 * validated fine as a field and serialized into prose, or a field kind whose serialized form differs
 * from its typed form.
 *
 * {@link emitLine} runs layer 4 on its own output and THROWS rather than returning a breached line, so
 * there is no path through this module that produces text a breach was found in.
 *
 * ## Money, twice over
 *
 * Owner money is integer milliunits behind `src/lib/money`. Provider cost is integer micro-USD
 * (contract 06 §6.1). A log line may carry the second and never the first, and the two are kept from
 * being read as one another three ways: the only monetary kind is `micro_usd`; its field name must end
 * in the micro-USD suffix, so no field on a line is named for a bare amount; and layer 4 refuses any
 * DECIMAL number anywhere in the line, because a decimal is the shape of an owner figure and this
 * tier's every legitimate figure is an integer. This module imports no arithmetic at all.
 */
import type { ContentBearingKey, Redacted } from '../ports/shapeGuards.ts';
import { SPEND_AGENTS, isSpendAgent, weekKeyOf, type SpendAgent } from '../../features/routing/spendLedger.ts';
import { scanForParticulars, type ComposeFinding } from './composeTemplate.ts';

// ---------------------------------------------------------------------------------------------
// Layer 1 — the shapes
// ---------------------------------------------------------------------------------------------

/**
 * Key-name fragments that mean "this field carries an OWNER monetary figure". Assembled from
 * fragments so this module never holds a contiguous copy of a token it forbids, the technique
 * `isolation.test.ts` and the harness denylists both use.
 *
 * `cost` is deliberately ABSENT: provider cost in integer micro-USD is a feature §6.4 permits, and a
 * rule that banned it would ban the one figure a governance loop is supposed to read.
 */
export const OWNER_FIGURE_NAME_TOKENS: ReadonlySet<string> = new Set<string>([
  'amount',
  'balance',
  'milli' + 'units',
  'milli',
  'egp',
  'outflow',
  'inflow',
  'budget',
  'available',
  'payee',
  'iban',
]);

/** The keys of `T` whose name reads as an owner monetary figure. */
export type OwnerFigureKey<T> = {
  [K in keyof T]-?: K extends `${string}amount${string}`
    ? K
    : K extends `${string}Amount${string}`
      ? K
      : K extends `${string}balance${string}`
        ? K
        : K extends `${string}Balance${string}`
          ? K
          : never;
}[keyof T];

/**
 * `T` with every owner-money-named field typed `never`.
 *
 * Today it resolves to `T`, because no such field exists. Its purpose is tomorrow, exactly as
 * `NoMagnitude` in `ports/shapeGuards.ts`: an editor who adds `amountMilli` or `accountBalance` to a
 * log record makes that field uninhabitable, so the addition fails to compile rather than quietly
 * opening a channel for the owner's ledger to reach a log file.
 */
export type NoOwnerFigure<T> = T & { readonly [K in OwnerFigureKey<T>]: never };

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Every event this tier writes down. A closed set, so "what gets logged" is reviewable in one read
 * rather than discovered by grepping for a formatting call.
 */
export const LOG_EVENTS = [
  // §7.3 health and restart
  'store_opened',
  'readiness_probed',
  'service_restart_observed',
  // §6 model routing
  'model_call_completed',
  'model_call_refused',
  'turn_classified',
  // §4 the consent bus
  'signal_published',
  'signal_refused',
  // §5 transport
  'update_accepted',
  'update_duplicate_ignored',
  // §5 transport — the outbound provider request (spec 07 task B4, seams S1/S2). Two events rather
  // than one so a refusal is findable without reading a verdict field, and both are added to the
  // CLOSED set rather than reached through a wider one: what this tier writes down stays reviewable
  // in a single read of this list.
  'provider_request_completed',
  'provider_request_refused',
  // §8 the kill switch
  'halt_observed',
  // §7.1/§7.2 operations
  'backup_completed',
  'restore_drill_completed',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

export const LOG_FIELD_KINDS_BY_NAME = {
  // §6.4's permitted features, verbatim.
  tier: 'enum',
  modelIdRequested: 'ref',
  modelIdServed: 'ref',
  promptTokens: 'count',
  completionTokens: 'count',
  latencyMs: 'duration_ms',
  schemaValid: 'verdict',
  actualCostMicroUsd: 'micro_usd',
  outcome: 'enum',
  // §7.3 readiness — a coarse component status and a version, which is all §7.3 permits.
  component: 'enum',
  verdict: 'enum',
  failure: 'enum',
  schemaVersion: 'count',
  restartCount: 'count',
  queueDepth: 'count',
  // §4 the bus — enumerated members of the envelope vocabulary, never a note and never a payload.
  signalKind: 'enum',
  signalLevel: 'enum',
  consentScope: 'enum',
  refusalReason: 'enum',
  // §5 transport — a correlation reference, never an update body and never a user identifier.
  updateRef: 'ref',
  dedupOutcome: 'enum',
  // §8 the halt.
  haltForm: 'enum',
  // §7.1/§7.2 operations — verdicts and counts about an artifact, never its contents.
  storeLabel: 'enum',
  integrityVerdict: 'verdict',
  retainedCount: 'count',
} as const;

export type LoggableFieldName = keyof typeof LOG_FIELD_KINDS_BY_NAME;
export const LOGGABLE_FIELD_NAMES: readonly LoggableFieldName[] = Object.keys(
  LOG_FIELD_KINDS_BY_NAME,
) as readonly LoggableFieldName[];

export const LOG_FIELD_KINDS = ['enum', 'ref', 'count', 'duration_ms', 'micro_usd', 'verdict'] as const;
export type LogFieldKind = (typeof LOG_FIELD_KINDS)[number];

/**
 * One loggable feature. **No member of this union can hold prose**: `enum` and `ref` are bounded
 * single-token strings, the three numeric kinds are integers, and `verdict` is a boolean. There is no
 * `text` kind, and adding one would be the change that breaks R19 — which is why the absence is the
 * design rather than a convention about how to use a wider type.
 */
export type LogFieldValue =
  | { readonly kind: 'enum'; readonly value: string }
  | { readonly kind: 'ref'; readonly value: string }
  | { readonly kind: 'count'; readonly value: number }
  | { readonly kind: 'duration_ms'; readonly value: number }
  | { readonly kind: 'micro_usd'; readonly value: number }
  | { readonly kind: 'verdict'; readonly value: boolean };

/** What a caller hands in. Partial: an event logs the features it has, not a fixed row. */
export type LogFields = Readonly<Partial<Record<LoggableFieldName, LogFieldValue>>>;

/**
 * One structured line, as it is emitted. Wrapped in both guards for the reason each one exists: a
 * content-named field could not hold a value, and neither could an owner-money-named one.
 */
export type LogRecord = Redacted<
  NoOwnerFigure<{
    /** UTC instant, validated by the SAME rule the spend ledger and the telemetry row use. */
    readonly at: string;
    readonly level: LogLevel;
    readonly event: LogEvent;
    readonly agent: SpendAgent;
    /** The only link between a line and the rows describing the same call. Never a user identifier. */
    readonly correlationRef: string | null;
    readonly fields: Readonly<Record<string, LogFieldValue>>;
  }>
>;

/** The record's own key set. Layer 4 re-derives the emitted line's keys against exactly this. */
export const LOG_RECORD_KEYS = ['at', 'level', 'event', 'agent', 'correlationRef', 'fields'] as const;

/**
 * The longest a legal string on a line can be. Every one is an enum member, a bounded reference, or a
 * UTC instant; the widest of those is a model identity. This is the same bound contract 12 puts on a
 * cross-agent note, for the same reason: past it, a string is not a field value, it is narrative.
 */
export const LOG_FIELD_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

export const LOG_ERROR_CODES = [
  'LOG_TIMESTAMP_MALFORMED',
  'LOG_LEVEL_UNKNOWN',
  'LOG_EVENT_UNKNOWN',
  'LOG_AGENT_UNKNOWN',
  'LOG_CORRELATION_REF_INVALID',
  'LOG_FIELD_NOT_LOGGABLE',
  'LOG_FIELD_CONTENT_NAMED',
  'LOG_FIELD_OWNER_FIGURE_NAMED',
  'LOG_FIELD_KIND_WRONG',
  'LOG_FIELD_VALUE_INVALID',
  'LOG_FIELD_VALUE_IS_PROSE',
  'LOG_LINE_BREACHED',
] as const;
export type LogErrorCode = (typeof LOG_ERROR_CODES)[number];

/**
 * A typed refusal. `detail` holds field names, kinds, and lengths — never a value that could be
 * content, a secret, or a figure. The same rule `ModelTelemetryError` follows, and for the same
 * reason: an error message that quotes the refused value is a log line carrying prompt text.
 */
export class RedactedLogError extends Error {
  readonly code: LogErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: LogErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RedactedLogError';
    this.code = code;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = Object.freeze(flat);
  }
}

// ---------------------------------------------------------------------------------------------
// Shared name analysis (one implementation, used by layer 3 AND layer 4)
// ---------------------------------------------------------------------------------------------

/** The content-bearing key names, as values. `ContentBearingKey` is the type of exactly this set. */
export const CONTENT_BEARING_KEYS: readonly ContentBearingKey[] = [
  'body',
  'completion',
  'completionText',
  'content',
  'messages',
  'prompt',
  'promptText',
  'prompts',
  'text',
];

/**
 * Fragments that mean "named for content". Derived from {@link CONTENT_BEARING_KEYS} plus the forms a
 * rogue field might use, and applied ONLY to names that are not permitted fields — `promptTokens` is a
 * permitted COUNT, and a rule that forbade it would forbid the measurement §6.4 explicitly allows.
 */
const CONTENT_NAME_TOKENS: ReadonlySet<string> = new Set<string>([
  ...CONTENT_BEARING_KEYS.flatMap((name) => nameTokens(name)),
  'narrative',
  'prose',
  'answer',
  'reply',
  'note',
  'journal',
  'transcript',
]);

/** Lowercased alphanumeric fragments of a field name. */
export function nameTokens(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/** Is this name one §6.4 would call content rather than a feature? */
export function isContentNamed(key: string): boolean {
  return nameTokens(key).some((token) => CONTENT_NAME_TOKENS.has(token));
}

/** Is this name one that reads as a figure in the OWNER's ledger rather than provider accounting? */
export function isOwnerFigureNamed(key: string): boolean {
  return nameTokens(key).some((token) => OWNER_FIGURE_NAME_TOKENS.has(token));
}

/**
 * Is this string a field value, or is it narrative? A newline, a tab, or a carriage return is
 * decisive on its own — no enum member, reference, or UTC instant contains one, and a model
 * completion very often does — and so is length past {@link LOG_FIELD_MAX_LENGTH}. A run of words is
 * decisive too: an identifier does not contain three spaces.
 */
export function looksLikeProse(value: string): boolean {
  if (value.length > LOG_FIELD_MAX_LENGTH) return true;
  if (/[\n\r\t]/.test(value)) return true;
  return value.split(' ').length > 3;
}

// ---------------------------------------------------------------------------------------------
// Layer 3 — the write path
// ---------------------------------------------------------------------------------------------

function requireFeatureString(fieldName: string, kind: LogFieldKind, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RedactedLogError(
      'LOG_FIELD_VALUE_INVALID',
      `NIZAM log: field "${fieldName}" of kind ${kind} requires a non-empty single-token value. The value is refused and is not quoted here (§6.4, R19).`,
      { field: fieldName, kind },
    );
  }
  if (looksLikeProse(value)) {
    throw new RedactedLogError(
      'LOG_FIELD_VALUE_IS_PROSE',
      `NIZAM log: field "${fieldName}" carries a value that is narrative rather than an enum member, a reference, or an instant. Contract 12 §6.4 permits redacted features only, so nothing is written and the value is not quoted (R19).`,
      { field: fieldName, kind, length: value.length },
    );
  }
  return value;
}

function requireIntegerFeature(fieldName: string, kind: LogFieldKind, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RedactedLogError(
      'LOG_FIELD_VALUE_INVALID',
      `NIZAM log: field "${fieldName}" of kind ${kind} must be a non-negative safe integer as measured, got ${String(value)}. There is no rounding and no coercion at this boundary, and a decimal here would be the shape of an owner figure.`,
      { field: fieldName, kind, received: value },
    );
  }
  return value;
}

/** One field, checked against the name map and its own kind's rules. */
function checkedField(fieldName: string, given: LogFieldValue): LogFieldValue {
  if (isContentNamed(fieldName) && !(LOGGABLE_FIELD_NAMES as readonly string[]).includes(fieldName)) {
    throw new RedactedLogError(
      'LOG_FIELD_CONTENT_NAMED',
      `NIZAM log: the field "${fieldName}" is named for model content, and contract 12 §6.4 permits redacted features only — a tier, a model identity, token counts, latency, a schema verdict, an actual reported cost, a correlation reference. Nothing is written (R19).`,
      { field: fieldName },
    );
  }
  if (isOwnerFigureNamed(fieldName)) {
    throw new RedactedLogError(
      'LOG_FIELD_OWNER_FIGURE_NAMED',
      `NIZAM log: the field "${fieldName}" is named for a figure in the owner's ledger. A log line carries provider accounting in integer micro-USD and never an owner figure; the two must never be readable as one another.`,
      { field: fieldName },
    );
  }
  const expectedKind = (LOG_FIELD_KINDS_BY_NAME as Readonly<Record<string, LogFieldKind>>)[fieldName];
  if (expectedKind === undefined) {
    throw new RedactedLogError(
      'LOG_FIELD_NOT_LOGGABLE',
      `NIZAM log: the field "${fieldName}" is not part of the loggable feature set, so nothing vouches for it being redacted. It is refused rather than dropped, because dropping it silently would make the next unrecognized field a leak (§6.4, R19).`,
      { field: fieldName },
    );
  }
  if (given.kind !== expectedKind) {
    throw new RedactedLogError(
      'LOG_FIELD_KIND_WRONG',
      `NIZAM log: field "${fieldName}" is declared as kind ${expectedKind} and arrived as ${String(given.kind)}. One name has exactly one kind, so a count cannot arrive as a reference and a reference cannot arrive as a count.`,
      { field: fieldName, expected: expectedKind, received: given.kind },
    );
  }
  switch (given.kind) {
    case 'enum':
    case 'ref':
      return { kind: given.kind, value: requireFeatureString(fieldName, given.kind, given.value) };
    case 'count':
    case 'duration_ms':
    case 'micro_usd':
      return { kind: given.kind, value: requireIntegerFeature(fieldName, given.kind, given.value) };
    case 'verdict': {
      // Widened deliberately: the type already says boolean, and this is the run-time belt behind it
      // for a caller that arrived through a cast. Narrowing first would make the branch unreachable
      // to the compiler and unwritable — which is how a type-level guarantee quietly loses its belt.
      const raw: unknown = given.value;
      if (typeof raw !== 'boolean') {
        throw new RedactedLogError(
          'LOG_FIELD_VALUE_INVALID',
          `NIZAM log: field "${fieldName}" is a verdict and must be a boolean, got "${String(raw)}". A missing verdict is not the same as a negative one, so it is refused rather than defaulted.`,
          { field: fieldName, kind: 'verdict' },
        );
      }
      return { kind: 'verdict', value: raw };
    }
  }
  // No default clause, and none is reachable: `expectedKind` is always one of the six declared kinds,
  // so the equality check above has already refused anything whose `kind` is not one of them. A kind
  // added to the union without a case here is a compile error rather than a silent pass-through.
}

export interface LogDraft {
  readonly at: string;
  readonly level: LogLevel;
  readonly event: LogEvent;
  readonly agent: SpendAgent;
  readonly correlationRef?: string | null;
  readonly fields?: LogFields;
}

/**
 * Build one structured record, or refuse it.
 *
 * Refuses, with a typed {@link RedactedLogError} and producing nothing:
 *  - an instant that is not unambiguous UTC — the SAME rule the spend ledger applies, reused rather
 *    than re-derived, because two derivations would eventually disagree about when a call happened;
 *  - an unknown level, event, or agent;
 *  - a correlation reference that is prose or blank;
 *  - a field name outside the loggable set, content-named, or named for an owner figure;
 *  - a field whose kind is not the one its name declares;
 *  - a numeric feature that is not a non-negative safe integer, or a string feature that is prose.
 */
export function buildRecord(draft: LogDraft): LogRecord {
  if (typeof draft.at !== 'string' || draft.at.trim() === '') {
    throw new RedactedLogError('LOG_TIMESTAMP_MALFORMED', 'NIZAM log: every line carries a UTC instant', {
      field: 'at',
    });
  }
  try {
    weekKeyOf(draft.at);
  } catch {
    throw new RedactedLogError(
      'LOG_TIMESTAMP_MALFORMED',
      `NIZAM log: "at" must be UTC as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ, got "${draft.at}". An offset is refused rather than assumed, by the same rule the spend ledger and the telemetry row apply.`,
      { field: 'at' },
    );
  }
  if (!(LOG_LEVELS as readonly string[]).includes(draft.level)) {
    throw new RedactedLogError('LOG_LEVEL_UNKNOWN', `NIZAM log: level must be one of ${LOG_LEVELS.join(', ')}`, {
      received: draft.level,
    });
  }
  if (!(LOG_EVENTS as readonly string[]).includes(draft.event)) {
    throw new RedactedLogError(
      'LOG_EVENT_UNKNOWN',
      `NIZAM log: "${String(draft.event)}" is not a declared event. The event set is closed so that what this tier writes down is reviewable in one read (§6.4).`,
      { received: draft.event },
    );
  }
  if (!isSpendAgent(draft.agent)) {
    throw new RedactedLogError(
      'LOG_AGENT_UNKNOWN',
      `NIZAM log: agent must be one of ${SPEND_AGENTS.join(', ')}, got "${String(draft.agent)}"`,
      { received: draft.agent },
    );
  }

  let correlationRef: string | null = null;
  if (draft.correlationRef !== undefined && draft.correlationRef !== null) {
    const given = draft.correlationRef;
    // Its own code, not a field code: the correlation reference is the ONE link between a line and the
    // ledger and telemetry rows for the same call, so a caller reading the refusal needs to know that
    // is what broke rather than "some field was wrong".
    if (typeof given !== 'string' || given.trim() === '' || looksLikeProse(given)) {
      throw new RedactedLogError(
        'LOG_CORRELATION_REF_INVALID',
        'NIZAM log: the correlation reference must be a single non-empty token. It is the only link between this line and the spend-ledger and telemetry rows for the same call, and a value that is narrative is not a reference. The value is refused and is not quoted here (§6.4, R19).',
        { field: 'correlationRef', length: typeof given === 'string' ? given.length : 0 },
      );
    }
    correlationRef = given;
  }

  const fields: Record<string, LogFieldValue> = {};
  for (const [fieldName, given] of Object.entries(draft.fields ?? {})) {
    if (given === undefined) continue;
    fields[fieldName] = checkedField(fieldName, given);
  }

  return { at: draft.at, level: draft.level, event: draft.event, agent: draft.agent, correlationRef, fields };
}

// ---------------------------------------------------------------------------------------------
// Layer 4 — the independent derivation about the EMITTED LINE
// ---------------------------------------------------------------------------------------------

/** What {@link logLineBreaches} can find. Each is a claim the emitted text is supposed to satisfy. */
export const LOG_LINE_CLAIMS = [
  'no_field_beyond_the_record_shape',
  'no_content_bearing_field',
  'no_owner_figure',
  'no_free_text',
  'no_deployment_particular',
] as const;
export type LogLineClaim = (typeof LOG_LINE_CLAIMS)[number];

/** One broken claim: which claim, why, and WHERE. Never the value (§6.4). */
export interface LogLineBreach {
  readonly claim: LogLineClaim;
  readonly reason:
    | 'line_not_json'
    | 'line_not_an_object'
    | 'key_unrecognized'
    | 'key_content_named'
    | 'key_owner_figure_named'
    | 'value_is_prose'
    | 'value_is_decimal'
    | 'value_kind_unrecognized'
    | 'particular_present';
  readonly at: string;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Map a finding from the shared particular scan onto this module's breach vocabulary. */
function particularBreaches(line: string): readonly LogLineBreach[] {
  return scanForParticulars(line).map((finding: ComposeFinding) => ({
    claim: 'no_deployment_particular' as LogLineClaim,
    reason: 'particular_present' as const,
    // The scan's CODE, never its detail: the detail quotes the offending token.
    at: finding.code,
  }));
}

/**
 * The keys a serialized line legitimately carries: the record's own, the declared feature names, and
 * the two keys of a field value's wrapper. Everything else is classified.
 *
 * The carve-out for declared feature names is what keeps this rule honest rather than merely strict:
 * `promptTokens` is content-NAMED and is a measurement §6.4 explicitly permits, so a check that
 * refused it would refuse the very field the contract allows. It is permitted because it is DECLARED,
 * not because a token list was tuned to let it through — which is the same distinction
 * `modelTelemetryRepo.ts` draws about `prompt_tokens` as a column.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set<string>([
  ...LOG_RECORD_KEYS,
  ...(LOGGABLE_FIELD_NAMES as readonly string[]),
  'kind',
  'value',
]);

/** What a key that is not declared breaks. A key that matches no token is still a breach. */
function classifyKey(path: string, key: string): LogLineBreach | null {
  if (STRUCTURAL_KEYS.has(key)) return null;
  if (isContentNamed(key)) return { claim: 'no_content_bearing_field', reason: 'key_content_named', at: path };
  if (isOwnerFigureNamed(key)) return { claim: 'no_owner_figure', reason: 'key_owner_figure_named', at: path };
  return { claim: 'no_field_beyond_the_record_shape', reason: 'key_unrecognized', at: path };
}

/** Walk any structure, so a value buried under an unexpected key is still inspected. */
function inspectValue(path: string, value: unknown, breaches: LogLineBreach[]): void {
  if (typeof value === 'string') {
    if (looksLikeProse(value)) breaches.push({ claim: 'no_free_text', reason: 'value_is_prose', at: path });
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      // A decimal is the shape of an owner figure; every legitimate figure in this tier is an integer.
      breaches.push({ claim: 'no_owner_figure', reason: 'value_is_decimal', at: path });
    }
    return;
  }
  if (typeof value === 'boolean' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValue(`${path}[${index}]`, entry, breaches));
    return;
  }
  if (isRecordValue(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      const breach = classifyKey(nestedPath, key);
      if (breach !== null) breaches.push(breach);
      inspectValue(nestedPath, nested, breaches);
    }
    return;
  }
  breaches.push({ claim: 'no_field_beyond_the_record_shape', reason: 'value_kind_unrecognized', at: path });
}

/**
 * The `fields` map, re-derived from {@link LOG_FIELD_KINDS_BY_NAME} rather than from the write path:
 * every key must be a declared feature name, every value must be a wrapper carrying that name's
 * declared kind, and every leaf goes through {@link inspectValue}. A field whose serialized kind
 * disagrees with its declared one is reported here even though layer 3 would have refused it, because
 * the case worth catching is the line layer 3 never saw.
 */
function inspectFields(value: unknown, breaches: LogLineBreach[]): void {
  if (!isRecordValue(value)) {
    breaches.push({ claim: 'no_field_beyond_the_record_shape', reason: 'value_kind_unrecognized', at: 'fields' });
    return;
  }
  for (const [fieldName, wrapper] of Object.entries(value)) {
    const path = `fields.${fieldName}`;
    if (!(LOGGABLE_FIELD_NAMES as readonly string[]).includes(fieldName)) {
      breaches.push(
        isContentNamed(fieldName)
          ? { claim: 'no_content_bearing_field', reason: 'key_content_named', at: path }
          : isOwnerFigureNamed(fieldName)
            ? { claim: 'no_owner_figure', reason: 'key_owner_figure_named', at: path }
            : { claim: 'no_field_beyond_the_record_shape', reason: 'key_unrecognized', at: path },
      );
      inspectValue(path, wrapper, breaches);
      continue;
    }
    if (!isRecordValue(wrapper)) {
      breaches.push({ claim: 'no_field_beyond_the_record_shape', reason: 'value_kind_unrecognized', at: path });
      continue;
    }
    const declaredKind = (LOG_FIELD_KINDS_BY_NAME as Readonly<Record<string, LogFieldKind>>)[fieldName];
    if (wrapper.kind !== declaredKind) {
      breaches.push({ claim: 'no_field_beyond_the_record_shape', reason: 'value_kind_unrecognized', at: `${path}.kind` });
    }
    for (const [key, nested] of Object.entries(wrapper)) {
      const nestedPath = `${path}.${key}`;
      const breach = classifyKey(nestedPath, key);
      if (breach !== null) breaches.push(breach);
      inspectValue(nestedPath, nested, breaches);
    }
  }
}

/**
 * **The redaction audit, made about the EMITTED LINE.** Given the finished text, list every claim it
 * breaks. An empty list is the assertion that the line's keys are exactly the record shape, that no
 * key is named for content or for an owner figure, that no value is prose, that no number is a
 * decimal, and that no deployment particular appears anywhere in it — including inside a value the
 * write path considered perfectly ordinary.
 *
 * This is a SECOND, INDEPENDENT derivation rather than a call back into layer 3: the two would then
 * fail together, and the case worth catching is precisely the one layer 3 never saw. The equivalent
 * check about a stored row in Phase 5.3 caught a real leak for exactly that reason, which is why this
 * one is wired into {@link emitLine} and also exercised directly — a guard only ever observed passing
 * is not evidence.
 */
export function logLineBreaches(line: string): readonly LogLineBreach[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [{ claim: 'no_field_beyond_the_record_shape', reason: 'line_not_json', at: 'line' }];
  }
  if (!isRecordValue(parsed)) {
    return [{ claim: 'no_field_beyond_the_record_shape', reason: 'line_not_an_object', at: 'line' }];
  }

  const breaches: LogLineBreach[] = [];
  const permitted: readonly string[] = LOG_RECORD_KEYS;

  for (const key of permitted) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      breaches.push({ claim: 'no_field_beyond_the_record_shape', reason: 'key_unrecognized', at: key });
    }
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!permitted.includes(key)) {
      breaches.push(
        isContentNamed(key)
          ? { claim: 'no_content_bearing_field', reason: 'key_content_named', at: key }
          : isOwnerFigureNamed(key)
            ? { claim: 'no_owner_figure', reason: 'key_owner_figure_named', at: key }
            : { claim: 'no_field_beyond_the_record_shape', reason: 'key_unrecognized', at: key },
      );
      inspectValue(key, value, breaches);
      continue;
    }
    if (key === 'fields') {
      inspectFields(value, breaches);
      continue;
    }
    inspectValue(key, value, breaches);
  }
  breaches.push(...particularBreaches(line));
  return breaches;
}

// ---------------------------------------------------------------------------------------------
// The emitter
// ---------------------------------------------------------------------------------------------

/** Where a line goes. Injected, so nothing in this module holds a path or a stream of its own. */
export type LogSink = (line: string) => void;

/**
 * Serialize a record. Deterministic key order, so two runs over the same record produce the same
 * bytes and a diff in a log is a diff in the facts. This is the ONLY place text is produced, and it
 * takes a checked record rather than a message and arguments — there is no format string to widen.
 */
export function serializeRecord(record: LogRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const key of LOG_RECORD_KEYS) ordered[key] = record[key];
  return JSON.stringify(ordered);
}

/**
 * Build, serialize, and audit one line. Returns the text; throws {@link RedactedLogError} with
 * `LOG_LINE_BREACHED` if layer 4 finds anything, so there is no path through this module that hands
 * back text a breach was found in.
 */
export function emitLine(draft: LogDraft): string {
  const line = serializeRecord(buildRecord(draft));
  const breaches = logLineBreaches(line);
  const first = breaches[0];
  if (first !== undefined) {
    throw new RedactedLogError(
      'LOG_LINE_BREACHED',
      `NIZAM log: refusing to emit a line — the claim "${first.claim}" does not hold at "${first.at}" (${first.reason}). The offending value is not quoted here (§6.4, R19).`,
      { at: first.at, claim: first.claim, reason: first.reason, breaches: breaches.length },
    );
  }
  return line;
}

/**
 * A logger bound to a sink and an agent. The only surface application code touches, and it offers no
 * way to write arbitrary text: the argument is an event and a set of named features.
 */
export interface RedactedLogger {
  readonly log: (level: LogLevel, event: LogEvent, fields?: LogFields, correlationRef?: string | null) => string;
}

/**
 * Create a logger. `now` is injected: this module reads no ambient clock, for the same reason the
 * migrator does not — a line's instant is a fact supplied by its caller, not discovered here.
 */
export function createRedactedLogger(agent: SpendAgent, sink: LogSink, now: () => string): RedactedLogger {
  return {
    log(level, event, fields, correlationRef): string {
      const line = emitLine({ at: now(), level, event, agent, correlationRef: correlationRef ?? null, fields });
      sink(line);
      return line;
    },
  };
}
