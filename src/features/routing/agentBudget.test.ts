// @vitest-environment node
/**
 * NIZAM · Per-agent budget → model selection tests — contract 06 §6.2.3 / §6.3, R5 and R17
 * Implemented by: PFOS Contract 06 / Phase 1.4 (spec 06-two-agent-vps)
 * Depends on: agentBudget.ts, spendLedger.ts, modelPolicy.ts — all pure, no store, no network
 *
 * This is the seam §6.3 describes: the pure weekly total feeds `modelPolicy` without the store
 * entering the module graph. What is proved here:
 *
 *  - the integer cap decision and the policy's own USD view never disagree at the boundary;
 *  - one agent's exhausted cap does not touch the other's routing (the R17 shape — the full negative
 *    sweep belongs to task 5.4, this is the focused case that per-agent keying makes trivial);
 *  - the cap is injected. Every cap below is a synthetic argument; no figure is read from source.
 */
import { describe, expect, it } from 'vitest';
import { selectModelForAgent } from './agentBudget';
import { COST_SOURCE_ACTUAL, type SpendAgent, type SpendLedgerRow } from './spendLedger';
import { DEFAULT_ALLOWED } from './modelPolicy';

const WEEK = 'W2026-03-02';
/** Synthetic injected caps, integer micro-USD. Deliberately not the owner's real cap. */
const CAP_MICRO_USD = 1_000_000;

let seq = 0;
function spend(agent: SpendAgent, costMicroUsd: number, weekKey = WEEK): SpendLedgerRow {
  seq += 1;
  return {
    id: `row_${seq}`,
    agent,
    occurredAt: '2026-03-04T09:15:00Z',
    weekKey,
    modelId: 'model-alpha',
    costMicroUsd,
    promptTokens: 100,
    completionTokens: 25,
    requestRef: `req_${seq}`,
    costSource: COST_SOURCE_ACTUAL,
  };
}

describe('selectModelForAgent — the per-agent cap drives the policy (§6.3, R5)', () => {
  it('routes normally when the agent has spent almost nothing', () => {
    const result = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows: [spend('finance', 250)],
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(result.budget.spentMicroUsd).toBe(250);
    expect(result.budget.remainingMicroUsd).toBe(CAP_MICRO_USD - 250);
    expect(result.selection.blockedByBudget).toBe(false);
    expect(result.selection.model).not.toBeNull();
    expect(DEFAULT_ALLOWED).toContain(result.selection.model);
  });

  it('refuses the call once the agent has reached its own injected cap', () => {
    const result = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows: [spend('finance', CAP_MICRO_USD)],
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.remainingMicroUsd).toBe(0);
    expect(result.selection.blockedByBudget).toBe(true);
    expect(result.selection.model).toBeNull();
    expect(result.selection.budgetPhase).toBe('exhausted');
  });

  it('never lets the integer decision and the policy view disagree at the boundary', () => {
    // The ledger totals in integers; the policy's thresholds are fractions of a cap in USD. The two
    // must agree about "exhausted", or a spent budget could be handed back by a rounding artefact.
    for (const spentMicroUsd of [
      0,
      1,
      CAP_MICRO_USD - 1,
      CAP_MICRO_USD,
      CAP_MICRO_USD + 1,
      CAP_MICRO_USD * 3,
    ]) {
      const result = selectModelForAgent({
        tier: 'T1',
        agent: 'finance',
        weekKey: WEEK,
        rows: [spend('finance', spentMicroUsd)],
        capMicroUsd: CAP_MICRO_USD,
      });
      expect(result.budget.exhausted, `at ${spentMicroUsd} micro-USD`).toBe(spentMicroUsd >= CAP_MICRO_USD);
      if (result.budget.exhausted) {
        expect(result.selection.budgetPhase, `at ${spentMicroUsd} micro-USD`).toBe('exhausted');
        expect(result.selection.blockedByBudget).toBe(true);
      }
    }
  });

  it('invokes no model at T0, and that is not a budget refusal', () => {
    const result = selectModelForAgent({
      tier: 'T0',
      agent: 'finance',
      weekKey: WEEK,
      rows: [],
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(result.selection.model).toBeNull();
    expect(result.selection.blockedByBudget).toBe(false);
  });

  it('ignores a row from another week when deciding this week', () => {
    const result = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows: [spend('finance', CAP_MICRO_USD * 5, 'W2026-02-23'), spend('finance', 300)],
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(result.budget.spentMicroUsd).toBe(300);
    expect(result.selection.blockedByBudget).toBe(false);
  });
});

describe('the two agents are decided independently (§6.2.3, the R17 shape)', () => {
  // One ledger holding both agents' rows, exactly as the repository hands it over.
  const rows: readonly SpendLedgerRow[] = [
    spend('life', CAP_MICRO_USD),
    spend('life', CAP_MICRO_USD),
    spend('finance', 400),
  ];

  it('refuses the exhausted agent', () => {
    const life = selectModelForAgent({
      tier: 'T1',
      agent: 'life',
      weekKey: WEEK,
      rows,
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(life.budget.spentMicroUsd).toBe(CAP_MICRO_USD * 2);
    expect(life.budget.exhausted).toBe(true);
    expect(life.selection.blockedByBudget).toBe(true);
    expect(life.selection.model).toBeNull();
  });

  it('leaves the other agent routing from the SAME ledger, with the same cap', () => {
    const finance = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows,
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(finance.budget.spentMicroUsd).toBe(400);
    expect(finance.budget.exhausted).toBe(false);
    expect(finance.selection.blockedByBudget).toBe(false);
    expect(finance.selection.model).not.toBeNull();
  });

  it('holds symmetrically: exhausting finance does not touch life', () => {
    const swapped: readonly SpendLedgerRow[] = [spend('finance', CAP_MICRO_USD * 2), spend('life', 400)];
    const finance = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows: swapped,
      capMicroUsd: CAP_MICRO_USD,
    });
    const life = selectModelForAgent({
      tier: 'T1',
      agent: 'life',
      weekKey: WEEK,
      rows: swapped,
      capMicroUsd: CAP_MICRO_USD,
    });
    expect(finance.selection.blockedByBudget).toBe(true);
    expect(life.selection.blockedByBudget).toBe(false);
  });

  it('gives each agent its OWN cap, so a small cap cannot be borrowed from a large one', () => {
    const shared: readonly SpendLedgerRow[] = [spend('life', 900_000), spend('finance', 900_000)];
    const tightLife = selectModelForAgent({
      tier: 'T1',
      agent: 'life',
      weekKey: WEEK,
      rows: shared,
      capMicroUsd: 500_000,
    });
    const roomyFinance = selectModelForAgent({
      tier: 'T1',
      agent: 'finance',
      weekKey: WEEK,
      rows: shared,
      capMicroUsd: 4_000_000,
    });
    expect(tightLife.budget.exhausted).toBe(true);
    expect(roomyFinance.budget.exhausted).toBe(false);
    expect(roomyFinance.budget.remainingMicroUsd).toBe(3_100_000);
  });
});
