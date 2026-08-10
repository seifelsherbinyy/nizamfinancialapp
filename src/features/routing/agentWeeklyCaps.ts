/**
 * NIZAM · The per-agent weekly cap, and the two units one placeholder could not serve
 * Owning contract: PFOS Contract 06 §6.2.3 / §6.3 (a cap decision is scoped to ONE agent and never
 *   aggregated), consuming contract 10/11's `modelPolicy` total. Owning requirement **R17**.
 * Build phase: spec 06-two-agent-vps, Phase 10.10 — the per-agent cap companion, and **F13**.
 * Depends on: ./spendLedger (the pure read model and its integer unit), ./modelPolicy
 *   (`WEEKLY_BUDGET_USD`, the TOTAL). Nothing else — no store, no clock, no `src/lib/money/`.
 *
 * ## D-CAP, as settled
 *
 * The owner's ceiling is a hard **USD 5.00 per week in total**, met by **two keys at 2.50 each**.
 * `WEEKLY_BUDGET_USD` in `modelPolicy` stays as the **total** and is not re-scoped: it is the account
 * ceiling contract 11's governance fractions are measured against, and halving it would silently turn
 * every one of those fractions into a per-agent fraction. What the code lacked was the **companion** —
 * the per-agent half, and the relation between the two halves and the total. That is this module.
 *
 * Every figure below is an **integer micro-USD**, derived from the total rather than restated. There
 * is no decimal literal here, no `parseFloat`, no `.toFixed(`, and no arithmetic that could round: the
 * one USD-to-micro conversion is {@link microUsdFromUsd}, applied ONCE to a configuration value that
 * is already a whole number of dollars (§6.1, AC07).
 *
 * ## Isolation is what R17 is about, and it is structural
 *
 * `weeklySpend` filters rows to one agent, so one agent's rows cannot reach the other's total; this
 * module keeps that property and adds the missing statement, which is that **a cap is a per-agent
 * value with a per-agent decision.** {@link decideAgentCaps} returns one decision per agent, each
 * built from that agent's own rows and its own cap, and there is no field on the result that spans
 * both. An exhausted agent refuses ITS model calls and leaves the other's decision untouched.
 *
 * And the deterministic half of R17 is a named field rather than a comment:
 * {@link AgentCapDecision.deterministicAlertsProduced} is typed `true`, so a build that tried to make
 * exhaustion suppress an obligation alert would not compile. A cap is a spend guard, not a service
 * outage — losing a due-date warning because a model budget ran out is forbidden (§6.2).
 *
 * ## F13 — one placeholder cannot serve two units, so it stops being one placeholder
 *
 * `DEPLOYMENT_VALUE_LEDGER.md` §7 records the collision, and both sides of it are individually right:
 *
 *  - `loadAgentModelBinding` reads `FINANCE_WEEKLY_CAP` / `LIFE_WEEKLY_CAP` as `weeklyCapMicroUsd` — a
 *    **bare run of digits** in the ledger's integer accounting unit, where a decimal is **refused
 *    rather than rounded**, because there is no floating-point money in this repository.
 *  - `ops/GATE_REGISTER.md` G4 step 2 interpolates the **same placeholder** into the provider's
 *    key-creation body as `"limit": <FINANCE_WEEKLY_CAP>`, where the provider's field takes a
 *    **decimal** amount.
 *
 * A literal `2.50` typed into the environment entry is a startup refusal, and a literal `2500000` sent
 * to the provider would be a limit a million times too large. The resolution is not to pick a unit; it
 * is to **stop the two units sharing a name**:
 *
 * | Facing | Name | Unit | Who reads it |
 * |---|---|---|---|
 * | the ledger | `LEDGER_WEEKLY_CAP_ENTRY[agent]` | integer micro-USD | `loadAgentModelBinding`, at boot |
 * | the provider | `PROVIDER_KEY_LIMIT_PLACEHOLDER[agent]` | decimal USD **text** | the G4 command, once |
 *
 * The provider-facing form is a **string**, deliberately. A decimal `number` in a variable named for a
 * limit is the shape AC07 forbids, and it would also be the shape that invites arithmetic on it. A
 * string is rendered from the integer by {@link providerKeyLimitUsdText} using integer digits only,
 * and read back by {@link microUsdFromProviderKeyLimitUsdText}, which refuses more precision than the
 * unit can carry rather than rounding it away. The conversion is **one function each way**, and the
 * round trip is asserted, so the two artifacts cannot drift.
 *
 * The provider-facing name is deliberately **not** an environment entry: it is a value the operator
 * interpolates into one gate command and never stores, so adding it to `ops/env/*.env.example` would
 * create a seventh unowned entry in a file set the value ledger enumerates exactly.
 * `ops/GATE_REGISTER.md` was **not edited** — it outranks this module on gate verification. The
 * one-line change its G4 step needs is recorded as a recommendation for the owner in the build log.
 */
import { WEEKLY_BUDGET_USD } from './modelPolicy';
import {
  agentWeeklyBudget,
  isSpendAgent,
  microUsdFromUsd,
  MICRO_USD_PER_USD,
  SPEND_AGENTS,
  SpendLedgerError,
  type AgentWeeklyBudget,
  type SpendAgent,
  type SpendLedgerRow,
} from './spendLedger';

// ---------------------------------------------------------------------------------------------
// D-CAP: the total, the count, and the per-agent half derived from both
// ---------------------------------------------------------------------------------------------

/**
 * The owner's weekly ceiling **in total**, in the ledger's integer unit.
 *
 * Derived from `modelPolicy`'s `WEEKLY_BUDGET_USD` rather than written again, so the two can never
 * disagree: this is the same ruling expressed in the unit the ledger enforces in.
 */
export const WEEKLY_CAP_TOTAL_MICRO_USD: number = microUsdFromUsd(WEEKLY_BUDGET_USD);

/** The agents the total is divided between. Both of them, and there is no third to add. */
export const CAPPED_AGENTS: readonly SpendAgent[] = SPEND_AGENTS;

/** Discriminator for every refusal this module raises. A caller matches `code`, never prose. */
export type AgentCapErrorCode =
  | 'CAP_TOTAL_NOT_DIVISIBLE'
  | 'CAP_AGENT_COUNT_INVALID'
  | 'CAP_SUM_EXCEEDS_TOTAL'
  | 'CAP_LIMIT_TEXT_MALFORMED'
  | 'CAP_LIMIT_TEXT_TOO_PRECISE';

/** A typed refusal. `detail` carries entry names, agent identities and integer counts — never a value. */
export class AgentCapError extends Error {
  readonly code: AgentCapErrorCode;
  readonly detail: Readonly<Record<string, string>>;

  constructor(code: AgentCapErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentCapError';
    this.code = code;
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(detail)) flat[key] = String(value);
    this.detail = Object.freeze(flat);
  }
}

/**
 * Split a total between agents in the ledger's integer unit.
 *
 * An **inexact** division is refused rather than rounded, in either direction. Rounding down would
 * strand budget the owner authorised; rounding up would hand out more than the total, which is the one
 * direction this repository never takes. A total that will not divide is a configuration to fix, not a
 * remainder to absorb.
 */
export function perAgentCapMicroUsd(totalMicroUsd: number, agentCount: number): number {
  if (!Number.isSafeInteger(agentCount) || agentCount < 1) {
    throw new AgentCapError(
      'CAP_AGENT_COUNT_INVALID',
      `NIZAM agent caps: the number of capped agents must be a positive whole number, got ${String(agentCount)}`,
      { agentCount },
    );
  }
  if (!Number.isSafeInteger(totalMicroUsd) || totalMicroUsd < 0) {
    throw new SpendLedgerError(
      'SPEND_CAP_INVALID',
      `NIZAM agent caps: the total must be a non-negative safe integer of micro-USD, got ${String(totalMicroUsd)}`,
      { received: totalMicroUsd },
    );
  }
  if (totalMicroUsd % agentCount !== 0) {
    throw new AgentCapError(
      'CAP_TOTAL_NOT_DIVISIBLE',
      `NIZAM agent caps: the total does not divide evenly between ${String(agentCount)} agents; an inexact split is refused rather than rounded, because rounding down strands authorised budget and rounding up hands out more than the total`,
      { agentCount },
    );
  }
  return totalMicroUsd / agentCount;
}

/** D-CAP's per-agent half: the total divided between the two agents, in integer micro-USD. */
export const PER_AGENT_WEEKLY_CAP_MICRO_USD: number = perAgentCapMicroUsd(
  WEEKLY_CAP_TOTAL_MICRO_USD,
  CAPPED_AGENTS.length,
);

/** The default per-agent caps: D-CAP's two equal halves, one per agent. */
export function defaultAgentCapsMicroUsd(): Readonly<Record<SpendAgent, number>> {
  const out: Record<SpendAgent, number> = { life: 0, finance: 0 };
  for (const agent of CAPPED_AGENTS) out[agent] = PER_AGENT_WEEKLY_CAP_MICRO_USD;
  return Object.freeze(out);
}

/** The sum of a per-agent cap set, in integer micro-USD. */
export function capsSumMicroUsd(caps: Readonly<Record<SpendAgent, number>>): number {
  let sum = 0;
  for (const agent of CAPPED_AGENTS) sum += caps[agent];
  return sum;
}

/**
 * The relation D-CAP asserts: the per-agent caps together must not exceed the total.
 *
 * Refuses when they do. It does **not** scale them down to fit — a silent adjustment would mean the
 * figure an operator reads in a file is not the figure being enforced. And it never raises the total to
 * accommodate them, which is the direction steering forbids outright. A sum BELOW the total is
 * permitted and is not a finding: spending less than authorised is always allowed.
 */
export function assertCapsWithinTotal(
  caps: Readonly<Record<SpendAgent, number>>,
  totalMicroUsd: number = WEEKLY_CAP_TOTAL_MICRO_USD,
): void {
  const sum = capsSumMicroUsd(caps);
  if (sum > totalMicroUsd) {
    throw new AgentCapError(
      'CAP_SUM_EXCEEDS_TOTAL',
      'NIZAM agent caps: the per-agent caps sum to more than the owner\'s weekly total; the caps are refused rather than scaled to fit, and the total is never raised to accommodate them',
      { agents: CAPPED_AGENTS.length },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The per-agent decision (R17)
// ---------------------------------------------------------------------------------------------

/** One agent's cap outcome. Nothing on this shape spans both agents (§6.2.3). */
export interface AgentCapDecision {
  readonly agent: SpendAgent;
  readonly budget: AgentWeeklyBudget;
  /** True exactly when THIS agent's own total has reached ITS own cap. */
  readonly modelCallsRefused: boolean;
  /**
   * Always `true`, and typed so it cannot become anything else. R17's second half: exhaustion refuses
   * model calls and never suppresses a deterministic obligation alert.
   */
  readonly deterministicAlertsProduced: true;
}

/**
 * Decide both agents' caps for one week from one row set. **Pure**: the rows, the week and the caps
 * are all arguments, and no clock or store is reachable from here.
 *
 * The caps are checked against the total first, so a configuration that over-allocates is refused
 * before it can permit a call.
 */
export function decideAgentCaps(
  rows: readonly SpendLedgerRow[],
  weekKey: string,
  caps: Readonly<Record<SpendAgent, number>> = defaultAgentCapsMicroUsd(),
  totalMicroUsd: number = WEEKLY_CAP_TOTAL_MICRO_USD,
): Readonly<Record<SpendAgent, AgentCapDecision>> {
  assertCapsWithinTotal(caps, totalMicroUsd);
  const out: Record<string, AgentCapDecision> = {};
  for (const agent of CAPPED_AGENTS) {
    const budget = agentWeeklyBudget(rows, { agent, weekKey, capMicroUsd: caps[agent] ?? 0 });
    out[agent] = {
      agent,
      budget,
      modelCallsRefused: budget.exhausted,
      deterministicAlertsProduced: true,
    };
  }
  return Object.freeze(out) as Readonly<Record<SpendAgent, AgentCapDecision>>;
}

// ---------------------------------------------------------------------------------------------
// F13: two names, two units, one conversion each way
// ---------------------------------------------------------------------------------------------

/** The entry the LEDGER reads, per agent. Integer micro-USD, and a decimal is refused at boot. */
export const LEDGER_WEEKLY_CAP_ENTRY: Readonly<Record<SpendAgent, string>> = Object.freeze({
  life: 'LIFE_WEEKLY_CAP',
  finance: 'FINANCE_WEEKLY_CAP',
});

/**
 * The placeholder the PROVIDER's key-creation body takes, per agent. Decimal USD, as **text**.
 *
 * Not an environment entry: it is interpolated into one gate command and never stored, which is why it
 * has a distinct name and no home in `ops/env/`.
 */
export const PROVIDER_KEY_LIMIT_PLACEHOLDER: Readonly<Record<SpendAgent, string>> = Object.freeze({
  life: 'LIFE_KEY_LIMIT_USD',
  finance: 'FINANCE_KEY_LIMIT_USD',
});

/** Micro-USD has six decimal places, so a decimal with more precision cannot be represented. */
export const PROVIDER_LIMIT_MAX_DECIMAL_PLACES = 6;
/** The fewest places the rendered decimal carries, so a whole-dollar limit still reads as money. */
export const PROVIDER_LIMIT_MIN_DECIMAL_PLACES = 2;

/** `<whole>` or `<whole>.<up to six digits>`. No sign, no exponent, no separator, no blank part. */
const PROVIDER_LIMIT_TEXT = /^(\d+)(?:\.(\d{1,9}))?$/;

/**
 * Render an integer micro-USD cap as the decimal USD **text** the provider's field takes.
 *
 * Integer digits only: the whole part is an exact division and the fractional part is the remainder,
 * zero-padded to six places and then trimmed to the shortest exact form of at least two places. There
 * is no rounding step, because there is nothing to round — every micro-USD value has an exact decimal
 * representation in six places.
 */
export function providerKeyLimitUsdText(microUsd: number): string {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) {
    throw new SpendLedgerError(
      'SPEND_CAP_INVALID',
      `NIZAM agent caps: only a non-negative integer micro-USD figure renders as a provider limit, got ${String(microUsd)}`,
      { received: microUsd },
    );
  }
  const remainder = microUsd % MICRO_USD_PER_USD;
  const whole = (microUsd - remainder) / MICRO_USD_PER_USD;
  const padded = String(remainder).padStart(PROVIDER_LIMIT_MAX_DECIMAL_PLACES, '0');
  const trimmed = padded.replace(/0+$/, '');
  const places = Math.max(trimmed.length, PROVIDER_LIMIT_MIN_DECIMAL_PLACES);
  return `${String(whole)}.${padded.slice(0, places)}`;
}

/**
 * Read the provider's decimal USD text back into integer micro-USD.
 *
 * No `parseFloat` and no `Number(...)` over the decimal as a whole: the two integer parts are read
 * separately and combined by integer arithmetic, so the value never passes through a float that could
 * lose a digit. More precision than micro-USD can hold is **refused rather than rounded** — the same
 * rule `loadAgentModelBinding` applies to the integer entry, which is the whole point of having one
 * conversion instead of two conventions.
 */
export function microUsdFromProviderKeyLimitUsdText(text: string): number {
  const match = typeof text === 'string' ? PROVIDER_LIMIT_TEXT.exec(text.trim()) : null;
  if (match === null) {
    throw new AgentCapError(
      'CAP_LIMIT_TEXT_MALFORMED',
      `NIZAM agent caps: a provider limit must be written as digits with an optional decimal point, got "${String(text)}"`,
      { received: text },
    );
  }
  const wholeText = match[1] ?? '0';
  const fractionText = match[2] ?? '';
  if (fractionText.length > PROVIDER_LIMIT_MAX_DECIMAL_PLACES) {
    throw new AgentCapError(
      'CAP_LIMIT_TEXT_TOO_PRECISE',
      `NIZAM agent caps: a provider limit carries at most ${String(PROVIDER_LIMIT_MAX_DECIMAL_PLACES)} decimal places, because that is the ledger's own precision; more is refused rather than rounded`,
      { places: fractionText.length },
    );
  }
  const whole = Number.parseInt(wholeText, 10);
  const fraction = fractionText.length === 0 ? 0 : Number.parseInt(fractionText.padEnd(PROVIDER_LIMIT_MAX_DECIMAL_PLACES, '0'), 10);
  const total = whole * MICRO_USD_PER_USD + fraction;
  if (!Number.isSafeInteger(total)) {
    throw new SpendLedgerError(
      'SPEND_TOTAL_UNREPRESENTABLE',
      'NIZAM agent caps: the provider limit exceeds exact integer range in micro-USD; refusing to report an approximate figure',
      { received: text },
    );
  }
  return total;
}

/**
 * Both spellings of ONE agent's cap, so a caller that needs the pair cannot mismatch them.
 *
 * The only place the two units meet, and they meet as two named fields rather than as one placeholder
 * with two readings.
 */
export interface AgentCapSpellings {
  readonly agent: SpendAgent;
  /** The entry name the ledger reads, and the integer value it must hold. */
  readonly ledgerEntry: string;
  readonly ledgerValueMicroUsd: number;
  /** The gate placeholder the provider's body takes, and the decimal text it must hold. */
  readonly providerPlaceholder: string;
  readonly providerLimitUsdText: string;
}

export function agentCapSpellings(agent: SpendAgent, capMicroUsd: number = PER_AGENT_WEEKLY_CAP_MICRO_USD): AgentCapSpellings {
  if (!isSpendAgent(agent)) {
    throw new SpendLedgerError(
      'SPEND_AGENT_UNKNOWN',
      `NIZAM agent caps: an agent identity must be one of ${SPEND_AGENTS.join(', ')}, got "${String(agent)}"`,
      { received: agent },
    );
  }
  return {
    agent,
    ledgerEntry: LEDGER_WEEKLY_CAP_ENTRY[agent],
    ledgerValueMicroUsd: capMicroUsd,
    providerPlaceholder: PROVIDER_KEY_LIMIT_PLACEHOLDER[agent],
    providerLimitUsdText: providerKeyLimitUsdText(capMicroUsd),
  };
}
