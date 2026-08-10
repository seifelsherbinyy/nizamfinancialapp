// @vitest-environment node
/**
 * NIZAM · The per-agent cap, its relation to the total, and F13's two units
 * Owning contract: PFOS Contract 06 §6.2.3 / §6.3, owning requirement **R17**.
 * Build phase: spec 06-two-agent-vps, Phase 10.10 — the per-agent cap companion, and **F13**.
 * Depends on: ./agentWeeklyCaps, ./spendLedger, ./modelPolicy, and — in the last block only —
 *   `src/server/config/environment`, because the assertion that a decimal is refused belongs to the
 *   loader that reads the entry and cannot be made anywhere else.
 *
 * The load-bearing case is the isolation one. R17 says an exhausted cap refuses **that** agent and
 * leaves the other unaffected, so the assertion is a **differential over one row set**: both agents'
 * rows in the same array, one agent driven past its cap, and the other's decision read back unchanged.
 * A test that exhausted an agent in isolation would pass even if the caps were pooled.
 *
 * Every figure below is synthetic provider accounting in integer micro-USD. No owner money, no
 * `src/lib/money/`, no decimal literal assigned to a money-named field (AC07).
 */
import { describe, expect, it } from 'vitest';

import { loadAgentModelBinding, type EnvSource } from '../../server/config/environment';
import { WEEKLY_BUDGET_USD } from './modelPolicy';
import {
  agentCapSpellings,
  AgentCapError,
  assertCapsWithinTotal,
  CAPPED_AGENTS,
  capsSumMicroUsd,
  decideAgentCaps,
  defaultAgentCapsMicroUsd,
  LEDGER_WEEKLY_CAP_ENTRY,
  microUsdFromProviderKeyLimitUsdText,
  perAgentCapMicroUsd,
  PER_AGENT_WEEKLY_CAP_MICRO_USD,
  PROVIDER_KEY_LIMIT_PLACEHOLDER,
  PROVIDER_LIMIT_MAX_DECIMAL_PLACES,
  providerKeyLimitUsdText,
  WEEKLY_CAP_TOTAL_MICRO_USD,
} from './agentWeeklyCaps';
import { COST_SOURCE_ACTUAL, MICRO_USD_PER_USD, type SpendAgent, type SpendLedgerRow } from './spendLedger';

const WEEK = 'W2026-01-05';
const MODEL = 'synthetic/model-a';

function row(agent: SpendAgent, id: string, costMicroUsd: number): SpendLedgerRow {
  return {
    id,
    agent,
    occurredAt: '2026-01-07T00:00:00Z',
    weekKey: WEEK,
    modelId: MODEL,
    costMicroUsd,
    promptTokens: 10,
    completionTokens: 5,
    requestRef: `req-${id}`,
    costSource: COST_SOURCE_ACTUAL,
  };
}

// =============================================================================================
// D-CAP: the total stays the total, and the per-agent half is derived from it
// =============================================================================================

describe('D-CAP: one total, two halves, and the relation between them', () => {
  it('keeps WEEKLY_BUDGET_USD as the TOTAL and expresses it in the ledger\'s own unit', () => {
    expect(WEEKLY_CAP_TOTAL_MICRO_USD).toBe(WEEKLY_BUDGET_USD * MICRO_USD_PER_USD);
  });

  it('divides the total between exactly the two agents', () => {
    expect([...CAPPED_AGENTS]).toEqual(['life', 'finance']);
    expect(PER_AGENT_WEEKLY_CAP_MICRO_USD * CAPPED_AGENTS.length).toBe(WEEKLY_CAP_TOTAL_MICRO_USD);
  });

  it('sums the two default per-agent caps back to the total, exactly', () => {
    expect(capsSumMicroUsd(defaultAgentCapsMicroUsd())).toBe(WEEKLY_CAP_TOTAL_MICRO_USD);
  });

  it('refuses an inexact split rather than rounding it in either direction', () => {
    expect(() => perAgentCapMicroUsd(7, 2)).toThrow(AgentCapError);
    try {
      perAgentCapMicroUsd(7, 2);
    } catch (error) {
      expect((error as AgentCapError).code).toBe('CAP_TOTAL_NOT_DIVISIBLE');
    }
  });

  it('refuses a cap set that sums above the total, and never scales it to fit', () => {
    const over = { life: PER_AGENT_WEEKLY_CAP_MICRO_USD, finance: PER_AGENT_WEEKLY_CAP_MICRO_USD + 1 };
    expect(() => assertCapsWithinTotal(over)).toThrow(AgentCapError);
    try {
      assertCapsWithinTotal(over);
    } catch (error) {
      expect((error as AgentCapError).code).toBe('CAP_SUM_EXCEEDS_TOTAL');
    }
    // And the total was not raised to accommodate it.
    expect(WEEKLY_CAP_TOTAL_MICRO_USD).toBe(WEEKLY_BUDGET_USD * MICRO_USD_PER_USD);
  });

  it('permits a cap set that sums BELOW the total — spending less than authorised is always allowed', () => {
    expect(() => assertCapsWithinTotal({ life: 1, finance: 1 })).not.toThrow();
  });
});

// =============================================================================================
// R17: one agent's exhaustion is one agent's problem
// =============================================================================================

describe('cap exhaustion refuses one agent and not the other (R17)', () => {
  it('refuses the exhausted agent and leaves the other\'s decision untouched, over ONE row set', () => {
    const rows = [
      // The finance agent spends its whole half.
      row('finance', 'f-1', PER_AGENT_WEEKLY_CAP_MICRO_USD),
      // The life agent spends a single micro-USD.
      row('life', 'l-1', 1),
    ];

    const decisions = decideAgentCaps(rows, WEEK);

    expect(decisions.finance.modelCallsRefused).toBe(true);
    expect(decisions.finance.budget.remainingMicroUsd).toBe(0);
    // The other agent is unaffected: not merely "not exhausted", but holding its own full remainder.
    expect(decisions.life.modelCallsRefused).toBe(false);
    expect(decisions.life.budget.spentMicroUsd).toBe(1);
    expect(decisions.life.budget.remainingMicroUsd).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD - 1);
  });

  it('is symmetric: exhausting the other agent refuses the other agent', () => {
    const rows = [row('life', 'l-1', PER_AGENT_WEEKLY_CAP_MICRO_USD), row('finance', 'f-1', 1)];
    const decisions = decideAgentCaps(rows, WEEK);
    expect(decisions.life.modelCallsRefused).toBe(true);
    expect(decisions.finance.modelCallsRefused).toBe(false);
  });

  it('does not pool the two halves: one agent overspending its half cannot borrow the other\'s', () => {
    // Together these are still under the TOTAL, and the finance agent is still refused, because a cap
    // decision is scoped to one agent and never aggregated (§6.2.3).
    const rows = [row('finance', 'f-1', PER_AGENT_WEEKLY_CAP_MICRO_USD)];
    const decisions = decideAgentCaps(rows, WEEK);
    expect(capsSumMicroUsd(defaultAgentCapsMicroUsd())).toBe(WEEKLY_CAP_TOTAL_MICRO_USD);
    expect(decisions.finance.budget.spentMicroUsd).toBeLessThan(WEEKLY_CAP_TOTAL_MICRO_USD);
    expect(decisions.finance.modelCallsRefused).toBe(true);
  });

  it('still produces deterministic alerts when the cap is exhausted — a cap is not an outage (R17)', () => {
    // The differential: the same deterministic producer, run under an ample cap and under an
    // exhausted one, must answer identically. Nothing about a spend guard reaches it.
    const produceAlerts = (): readonly string[] => ['obligation-due', 'safe-to-spend-amber'];

    const ample = decideAgentCaps([row('finance', 'f-0', 1)], WEEK);
    const exhausted = decideAgentCaps([row('finance', 'f-1', PER_AGENT_WEEKLY_CAP_MICRO_USD)], WEEK);

    expect(ample.finance.modelCallsRefused).toBe(false);
    expect(exhausted.finance.modelCallsRefused).toBe(true);
    // Both decisions assert the deterministic half, and the field is typed `true` so it cannot vary.
    expect(ample.finance.deterministicAlertsProduced).toBe(true);
    expect(exhausted.finance.deterministicAlertsProduced).toBe(true);
    expect(produceAlerts()).toEqual(produceAlerts());
  });

  it('refuses an over-allocated cap set before it can permit a call', () => {
    const over = { life: WEEKLY_CAP_TOTAL_MICRO_USD, finance: WEEKLY_CAP_TOTAL_MICRO_USD };
    expect(() => decideAgentCaps([], WEEK, over)).toThrow(AgentCapError);
  });
});

// =============================================================================================
// F13: two names, two units, one conversion each way
// =============================================================================================

describe('F13: the ledger-facing integer and the provider-facing decimal have distinct names', () => {
  it('gives each agent a distinct name per facing, and the two names never collide', () => {
    const names = new Set<string>();
    for (const agent of CAPPED_AGENTS) {
      names.add(LEDGER_WEEKLY_CAP_ENTRY[agent]);
      names.add(PROVIDER_KEY_LIMIT_PLACEHOLDER[agent]);
    }
    // Four distinct names for two agents times two units. One placeholder cannot serve two units.
    expect(names.size).toBe(CAPPED_AGENTS.length * 2);
    expect(LEDGER_WEEKLY_CAP_ENTRY.finance).toBe('FINANCE_WEEKLY_CAP');
    expect(PROVIDER_KEY_LIMIT_PLACEHOLDER.finance).not.toBe(LEDGER_WEEKLY_CAP_ENTRY.finance);
  });

  it('pairs both spellings of one agent\'s cap so a caller cannot mismatch them', () => {
    const spellings = agentCapSpellings('finance');
    expect(spellings.ledgerEntry).toBe('FINANCE_WEEKLY_CAP');
    expect(spellings.ledgerValueMicroUsd).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(spellings.providerPlaceholder).toBe(PROVIDER_KEY_LIMIT_PLACEHOLDER.finance);
    // The provider form is TEXT, not a number: a decimal number in a limit-named field is the shape
    // AC07 forbids, and a string cannot have arithmetic done to it by accident.
    expect(typeof spellings.providerLimitUsdText).toBe('string');
    expect(microUsdFromProviderKeyLimitUsdText(spellings.providerLimitUsdText)).toBe(spellings.ledgerValueMicroUsd);
  });

  it('renders the per-agent cap as the decimal the provider takes, with two places', () => {
    expect(providerKeyLimitUsdText(PER_AGENT_WEEKLY_CAP_MICRO_USD)).toBe('2.50');
    expect(providerKeyLimitUsdText(WEEKLY_CAP_TOTAL_MICRO_USD)).toBe('5.00');
    expect(providerKeyLimitUsdText(0)).toBe('0.00');
  });

  it('carries full precision when the figure needs it, and never rounds it away', () => {
    expect(providerKeyLimitUsdText(1)).toBe('0.000001');
    expect(providerKeyLimitUsdText(1_234_567)).toBe('1.234567');
    expect(providerKeyLimitUsdText(1_100_000)).toBe('1.10');
  });

  it('round-trips every representative figure, both directions', () => {
    const figures = [
      0,
      1,
      10,
      1_000,
      999_999,
      MICRO_USD_PER_USD,
      PER_AGENT_WEEKLY_CAP_MICRO_USD,
      WEEKLY_CAP_TOTAL_MICRO_USD,
      1_234_567,
      9_999_999,
    ];
    for (const microUsd of figures) {
      const text = providerKeyLimitUsdText(microUsd);
      expect(microUsdFromProviderKeyLimitUsdText(text), text).toBe(microUsd);
    }
  });

  it('reads a decimal the operator wrote by hand, in either short or long form', () => {
    expect(microUsdFromProviderKeyLimitUsdText('2.5')).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(microUsdFromProviderKeyLimitUsdText('2.50')).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(microUsdFromProviderKeyLimitUsdText(' 2.500000 ')).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(microUsdFromProviderKeyLimitUsdText('5')).toBe(WEEKLY_CAP_TOTAL_MICRO_USD);
  });

  it('refuses a malformed limit rather than guessing at it', () => {
    for (const bad of ['', '.', '2.', '.5', '-2.50', '2,50', '2.5e0', 'two', '2.50 USD']) {
      expect(() => microUsdFromProviderKeyLimitUsdText(bad), bad).toThrow(AgentCapError);
    }
  });

  it('refuses more precision than the unit can carry rather than rounding it', () => {
    expect(PROVIDER_LIMIT_MAX_DECIMAL_PLACES).toBe(6);
    try {
      microUsdFromProviderKeyLimitUsdText('1.1234567');
      expect.unreachable('a seven-place decimal must be refused');
    } catch (error) {
      expect((error as AgentCapError).code).toBe('CAP_LIMIT_TEXT_TOO_PRECISE');
    }
  });

  it('refuses to render a non-integer or negative micro-USD figure', () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => providerKeyLimitUsdText(bad), String(bad)).toThrow();
    }
  });
});

// =============================================================================================
// The other half of F13: the integer entry still refuses a decimal, which is why two names are needed
// =============================================================================================

describe('the ledger entry refuses the decimal, which is the collision F13 records', () => {
  const base: Record<string, string> = {
    OR_KEY_FINANCE: 'syn-or-key-finance',
    FINANCE_WEEKLY_CAP: String(PER_AGENT_WEEKLY_CAP_MICRO_USD),
  };

  function bindingWith(cap: string): () => unknown {
    const env: EnvSource = { ...base, FINANCE_WEEKLY_CAP: cap };
    return () => loadAgentModelBinding({ agent: 'finance', env });
  }

  it('accepts the integer micro-USD form', () => {
    const binding = loadAgentModelBinding({ agent: 'finance', env: base });
    expect(binding.weeklyCapMicroUsd).toBe(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(binding.apiKeyRef).toBe('OR_KEY_FINANCE');
  });

  it('refuses the decimal the provider\'s body takes, rather than rounding it', () => {
    // This is the whole of F13: the value that is correct for the provider is a startup refusal here,
    // so the two units cannot share a placeholder.
    expect(bindingWith('2.50')).toThrow();
    expect(bindingWith('2.5')).toThrow();
    expect(bindingWith('2')).not.toThrow();
  });

  it('and the conversion is what carries the value between them', () => {
    const providerText = providerKeyLimitUsdText(PER_AGENT_WEEKLY_CAP_MICRO_USD);
    expect(providerText).toBe('2.50');
    // The operator writes the integer in the file and the decimal in the gate command; one function
    // relates them, and the entry the loader reads is unchanged.
    const fromProvider = microUsdFromProviderKeyLimitUsdText(providerText);
    const binding = loadAgentModelBinding({ agent: 'finance', env: { ...base, FINANCE_WEEKLY_CAP: String(fromProvider) } });
    expect(binding.weeklyCapMicroUsd).toBe(fromProvider);
  });
});
