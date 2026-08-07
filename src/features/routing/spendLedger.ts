/**
 * NIZAM · Token-spend ledger read model — the weekly total as a PURE function
 * Owning contract: PFOS Contract 06 §6 (the token-spend ledger, owning requirement R5), read by
 *   contract 10/11's routing tier. The append path lives in `src/server/db/spendLedgerRepo.ts`.
 * Build phase: spec 06-two-agent-vps, Phase 1.4 — token-spend ledger + weekly total.
 * Depends on: NOTHING. This module has no imports, by design (see "Why this file lives here").
 *
 * Why this file lives here, and not under `src/server/`
 *   Contract 06 §6.3 requires `weeklySpend` to serve `src/features/routing/modelPolicy.ts` "without
 *   dragging the store into the browser tier". `src/server/**` reaches the runtime SQLite binding, so
 *   nothing in the browser tier may depend on it. The pure read model therefore lives beside the
 *   policy that consumes it, and the server repository depends on THIS file — never the reverse. The
 *   dependency arrow points server → routing, one way.
 *
 * Purity, and how it is mechanical rather than remembered (§6.3, §9 T13)
 *   - No clock. The week boundary is an ARGUMENT. `Date` is not referenced anywhere in this file:
 *     the week bucket is computed with integer calendar arithmetic, so "no clock read" is provable by
 *     the token's absence rather than by reading intent out of the code.
 *   - No database. Rows are handed in by the repository.
 *   - No I/O, no randomness, no ambient configuration. The cap is injected by the caller; there is no
 *     cap literal in this file (§6.3 keeps it as `<AGENT_WEEKLY_CAP_USD>` for exactly that reason).
 *   `spendLedger.test.ts` asserts all of the above by scanning this source, so the guarantee cannot
 *   silently decay into a comment.
 *
 * Cost is NOT money (§6.1)
 *   `cost_micro_usd` is integer micro-USD of provider accounting. It is deliberately kept in its own
 *   integer unit so it can never be mistaken for a figure in the owner's financial ledger, and it
 *   never routes through `src/lib/money/`. There is no second money implementation here — there is no
 *   money here at all. No float, no `parseFloat`, no `.toFixed(`.
 *
 * The LLM tier never sources a monetary number (steering §4.5, §6.3): no function below reads a
 * balance, an obligation, or a safe-to-spend value, and none can, because none is in scope.
 */

/** The two spend keys. Enumerated; never free text (§6.1). */
export const SPEND_AGENTS = ['life', 'finance'] as const;

/** The agent a spend row belongs to. Every cap decision is scoped to exactly one (§6.2.3). */
export type SpendAgent = (typeof SPEND_AGENTS)[number];

/** Micro-USD per USD. The ledger's unit is the micro; USD appears only at a display boundary. */
export const MICRO_USD_PER_USD = 1_000_000;

/**
 * The only cost provenance the ledger accepts. A pre-flight estimate may GATE a call; it may never
 * be what gets recorded (§6.2.1). The single-member union makes an estimate a compile error, and the
 * repository plus the table CHECK make it a runtime refusal as well.
 */
export const COST_SOURCE_ACTUAL = 'provider_reported_actual';
export type CostSourceActual = typeof COST_SOURCE_ACTUAL;

/** Prefix that marks a week key as a week bucket rather than a calendar day. */
const WEEK_KEY_PREFIX = 'W';
/** `W` followed by the ISO calendar date of the UTC Monday that opens the week. */
const WEEK_KEY_PATTERN = /^W\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM-DD`, optionally followed by a UTC time. An offset-bearing timestamp is refused. */
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?Z)?$/;

/** One `spend_ledger` row as the read model sees it (§6.1). Field for field, no more. */
export interface SpendLedgerRow {
  readonly id: string;
  readonly agent: SpendAgent;
  /** UTC timestamp of completion. */
  readonly occurredAt: string;
  /** The bucket stored AT WRITE TIME, so the read model never re-derives it ambiguously (§6.1). */
  readonly weekKey: string;
  readonly modelId: string;
  /** Actual reported cost, integer micro-USD. Never an estimate, never a float. */
  readonly costMicroUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Correlation identifier for the telemetry row. A correction carries its OWN (§6.2.2). */
  readonly requestRef: string;
  readonly costSource: CostSourceActual;
}

/** Discriminator for every refusal this read model raises. */
export type SpendLedgerErrorCode =
  | 'SPEND_AGENT_UNKNOWN'
  | 'SPEND_WEEK_KEY_MALFORMED'
  | 'SPEND_TIMESTAMP_MALFORMED'
  | 'SPEND_COST_NOT_INTEGER'
  | 'SPEND_COST_NEGATIVE'
  | 'SPEND_COST_SOURCE_NOT_ACTUAL'
  | 'SPEND_TOTAL_UNREPRESENTABLE'
  | 'SPEND_CAP_INVALID'
  | 'SPEND_TOKENS_INVALID'
  | 'SPEND_REQUEST_REF_EMPTY'
  | 'SPEND_ROW_ID_EMPTY'
  | 'SPEND_MODEL_ID_EMPTY';

/**
 * A typed refusal, so a caller discriminates on `code` rather than matching a message.
 *
 * Every guard below FAILS LOUD instead of returning zero. A silent zero would look like "nothing has
 * been spent", which restores budget that was actually consumed — the precise failure §6.2.5 says
 * neither belt may be weakened to allow.
 */
export class SpendLedgerError extends Error {
  readonly code: SpendLedgerErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: SpendLedgerErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SpendLedgerError';
    this.code = code;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = flat;
  }
}

/** True for a value in the enumerated agent set. */
export function isSpendAgent(value: unknown): value is SpendAgent {
  return typeof value === 'string' && (SPEND_AGENTS as readonly string[]).includes(value);
}

function assertSpendAgent(value: unknown, field: string): SpendAgent {
  if (!isSpendAgent(value)) {
    throw new SpendLedgerError(
      'SPEND_AGENT_UNKNOWN',
      `NIZAM spend ledger: ${field} must be one of ${SPEND_AGENTS.join(', ')}, got "${String(value)}". An unknown agent is refused rather than totalled as zero, because a zero total would silently restore budget.`,
      { field, received: value },
    );
  }
  return value;
}

/** True for a well-formed week bucket produced by {@link weekKeyOf}. */
export function isWeekKey(value: unknown): value is string {
  return typeof value === 'string' && WEEK_KEY_PATTERN.test(value);
}

function assertWeekKey(value: unknown, field: string): string {
  if (!isWeekKey(value)) {
    throw new SpendLedgerError(
      'SPEND_WEEK_KEY_MALFORMED',
      `NIZAM spend ledger: ${field} must be a week bucket of the form ${WEEK_KEY_PREFIX}YYYY-MM-DD produced by weekKeyOf, got "${String(value)}"`,
      { field, received: value },
    );
  }
  return value;
}

/* ------------------------------------------------------------------------------------------------
 * The week bucket: integer calendar arithmetic, no clock, no Date
 * ------------------------------------------------------------------------------------------------
 * Days-since-epoch and its inverse, after Howard Hinnant's `days_from_civil` / `civil_from_days`
 * (http://howardhinnant.github.io/date_algorithms.html). Exact for every proleptic Gregorian date in
 * the range this store can hold, and integer-only: no floating remainder, no locale, no timezone
 * database, and — the point — no reference to the ambient clock.
 * ---------------------------------------------------------------------------------------------- */

const DAYS_PER_WEEK = 7;
/** 1970-01-01 was a Thursday, so shifting by 3 puts Monday at index 0. */
const EPOCH_TO_MONDAY_SHIFT = 3;

function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(daysSinceEpoch: number): { year: number; month: number; day: number } {
  const z = daysSinceEpoch + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1_460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Derive the UTC week bucket for a completion timestamp. PURE: the timestamp is an argument, and
 * this function reads no clock of its own.
 *
 * The bucket is `W` plus the ISO calendar date of the **UTC Monday** that opens the week, e.g. a
 * completion on a Wednesday yields that Monday. ISO week-year notation (`YYYY-Www`) was rejected on
 * purpose: its year component diverges from the calendar year at the turn of the year, which is
 * exactly the ambiguity §6.1 stores the key at write time to avoid. A Monday date is unambiguous,
 * sorts lexicographically, and is trivially checkable by hand.
 *
 * @param occurredAtUtc `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS[.sss]]Z`. A timestamp carrying an
 *   offset other than `Z` is REFUSED rather than assumed, because an assumed offset can place a row
 *   in the wrong week and quietly hand back budget that was spent.
 */
export function weekKeyOf(occurredAtUtc: string): string {
  const match = typeof occurredAtUtc === 'string' ? UTC_TIMESTAMP_PATTERN.exec(occurredAtUtc) : null;
  if (!match) {
    throw new SpendLedgerError(
      'SPEND_TIMESTAMP_MALFORMED',
      `NIZAM spend ledger: a completion timestamp must be UTC as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ, got "${String(occurredAtUtc)}". An offset is refused rather than assumed.`,
      { received: occurredAtUtc },
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  const calendarValid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    hour <= 23 &&
    minute <= 59 &&
    // A leap second is a real value in the wire format and belongs to the same day.
    second <= 60;
  const days = daysFromCivil(year, month, day);
  const roundTrip = civilFromDays(days);
  if (!calendarValid || roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day) {
    throw new SpendLedgerError(
      'SPEND_TIMESTAMP_MALFORMED',
      `NIZAM spend ledger: "${String(occurredAtUtc)}" is not a real UTC instant`,
      { received: occurredAtUtc },
    );
  }

  const weekdayFromMonday = (((days + EPOCH_TO_MONDAY_SHIFT) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const monday = civilFromDays(days - weekdayFromMonday);
  return `${WEEK_KEY_PREFIX}${pad(monday.year, 4)}-${pad(monday.month, 2)}-${pad(monday.day, 2)}`;
}

/** Validate one row's cost the way the write path does, so a bad row cannot be totalled. */
function assertRowCost(row: SpendLedgerRow, index: number): number {
  if (row.costSource !== COST_SOURCE_ACTUAL) {
    throw new SpendLedgerError(
      'SPEND_COST_SOURCE_NOT_ACTUAL',
      `NIZAM spend ledger: row ${index} (${row.id}) reports cost source "${String(row.costSource)}"; only ${COST_SOURCE_ACTUAL} counts (§6.2.1). An estimate may gate a call and may never be recorded.`,
      { index, id: row.id, received: row.costSource },
    );
  }
  const cost = row.costMicroUsd;
  if (!Number.isSafeInteger(cost)) {
    throw new SpendLedgerError(
      'SPEND_COST_NOT_INTEGER',
      `NIZAM spend ledger: row ${index} (${row.id}) has cost_micro_usd ${String(cost)}, which is not a safe integer. Cost is integer micro-USD; there is no rounding at this boundary.`,
      { index, id: row.id, received: cost },
    );
  }
  if (cost < 0) {
    throw new SpendLedgerError(
      'SPEND_COST_NEGATIVE',
      `NIZAM spend ledger: row ${index} (${row.id}) has a negative cost_micro_usd ${String(cost)}. A correction is a compensating row, not a negative one.`,
      { index, id: row.id, received: cost },
    );
  }
  return cost;
}

/**
 * The weekly total for ONE agent in ONE week, in integer micro-USD. **Pure** (§6.3, §9 T13).
 *
 * Rows are matched on the `week_key` they were STORED with — the bucket is never re-derived here, so
 * two reads of the same ledger can never disagree about which week a row belongs to. Rows for the
 * other agent and rows for other weeks are not merely deprioritised, they are excluded: nothing is
 * ever aggregated across agents for a cap decision (§6.2.3), which is what makes R17 reachable.
 *
 * @param rows Handed in by the repository. Not mutated, not reordered, not read from anywhere.
 * @param agent The one agent this total is for.
 * @param weekKey The week boundary, as an argument. There is no clock in here to ask.
 */
export function weeklySpend(rows: readonly SpendLedgerRow[], agent: SpendAgent, weekKey: string): number {
  const key = assertWeekKey(weekKey, 'weekKey');
  const forAgent = assertSpendAgent(agent, 'agent');

  let total = 0;
  let index = -1;
  for (const row of rows) {
    index += 1;
    if (row.agent !== forAgent || row.weekKey !== key) continue;
    total += assertRowCost(row, index);
    if (!Number.isSafeInteger(total)) {
      throw new SpendLedgerError(
        'SPEND_TOTAL_UNREPRESENTABLE',
        'NIZAM spend ledger: the weekly total exceeded exact integer range; refusing to report an approximate figure',
        { agent: forAgent, weekKey: key },
      );
    }
  }
  return total;
}

/** Injected cap for one agent, in integer micro-USD. There is no default: §6.3 forbids a literal. */
export interface AgentWeeklyCap {
  readonly agent: SpendAgent;
  readonly weekKey: string;
  readonly capMicroUsd: number;
}

/** The cap decision for one agent in one week. Every field is integer micro-USD. */
export interface AgentWeeklyBudget {
  readonly agent: SpendAgent;
  readonly weekKey: string;
  readonly spentMicroUsd: number;
  readonly capMicroUsd: number;
  readonly remainingMicroUsd: number;
  /** True once the agent's own total has reached its own cap. Never influenced by the other agent. */
  readonly exhausted: boolean;
}

function assertCap(capMicroUsd: number): number {
  if (!Number.isSafeInteger(capMicroUsd) || capMicroUsd < 0) {
    throw new SpendLedgerError(
      'SPEND_CAP_INVALID',
      `NIZAM spend ledger: the injected weekly cap must be a non-negative safe integer of micro-USD, got ${String(capMicroUsd)}`,
      { received: capMicroUsd },
    );
  }
  return capMicroUsd;
}

/**
 * The per-agent cap decision. **Pure**, and scoped to one agent by construction: the other agent's
 * rows cannot reach this result, because {@link weeklySpend} excluded them (§6.2.3, R17).
 */
export function agentWeeklyBudget(rows: readonly SpendLedgerRow[], cap: AgentWeeklyCap): AgentWeeklyBudget {
  const agent = assertSpendAgent(cap.agent, 'cap.agent');
  const weekKey = assertWeekKey(cap.weekKey, 'cap.weekKey');
  const capMicroUsd = assertCap(cap.capMicroUsd);
  const spentMicroUsd = weeklySpend(rows, agent, weekKey);
  return {
    agent,
    weekKey,
    spentMicroUsd,
    capMicroUsd,
    remainingMicroUsd: Math.max(0, capMicroUsd - spentMicroUsd),
    exhausted: spentMicroUsd >= capMicroUsd,
  };
}

/**
 * Micro-USD to USD, for the one boundary that speaks USD: contract 10/11's policy thresholds, which
 * are fractions of a cap. Provider accounting, not money — the money core owns no part of this and
 * `src/lib/money/` is deliberately not imported (§6.1).
 */
export function microUsdToUsd(microUsd: number): number {
  if (!Number.isSafeInteger(microUsd)) {
    throw new SpendLedgerError(
      'SPEND_COST_NOT_INTEGER',
      `NIZAM spend ledger: only an integer micro-USD figure converts to USD, got ${String(microUsd)}`,
      { received: microUsd },
    );
  }
  return microUsd / MICRO_USD_PER_USD;
}

/**
 * USD to integer micro-USD, for the configuration boundary where an injected cap is expressed in
 * USD. Applied ONCE, to configuration, never to a recorded cost — a recorded cost arrives from the
 * provider already integral.
 */
export function microUsdFromUsd(usd: number): number {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
    throw new SpendLedgerError(
      'SPEND_CAP_INVALID',
      `NIZAM spend ledger: a configured cap must be a non-negative finite number of USD, got ${String(usd)}`,
      { received: usd },
    );
  }
  return Math.round(usd * MICRO_USD_PER_USD);
}

/** Validate the non-cost fields a row must carry. Used by the write path; exported for reuse. */
export function assertSpendRowShape(row: SpendLedgerRow): void {
  assertSpendAgent(row.agent, 'agent');
  assertWeekKey(row.weekKey, 'weekKey');
  assertRowCost(row, 0);
  if (typeof row.requestRef !== 'string' || row.requestRef.trim() === '') {
    throw new SpendLedgerError(
      'SPEND_REQUEST_REF_EMPTY',
      'NIZAM spend ledger: request_ref is required — a correction is a compensating row with its OWN request_ref (§6.2.2)',
      { id: row.id },
    );
  }
  for (const [field, value] of [
    ['promptTokens', row.promptTokens],
    ['completionTokens', row.completionTokens],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SpendLedgerError(
        'SPEND_TOKENS_INVALID',
        `NIZAM spend ledger: ${field} must be a non-negative safe integer as reported by the provider, got ${String(value)}`,
        { field, received: value },
      );
    }
  }
}
