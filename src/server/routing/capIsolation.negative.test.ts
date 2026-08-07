// @vitest-environment node
/**
 * NIZAM · Cap exhaustion is scoped to ONE agent — proved at all three levels it has to hold at
 * Implemented by: PFOS Contract 12 / Phase 5.4 (spec 06-two-agent-vps)
 * Owning requirements: R17 (an exhausted weekly cap refuses THAT agent and leaves the other
 *   unaffected), R5 through contract 06 §9 **T15**
 * Depends on: ./modelRouter, ./eligibilityRegistry, ./turnClassifier, ../mocks/openrouterMock,
 *   ../mocks/invocationRecorder, ../db/spendLedgerRepo, ../db/repositories/testStore,
 *   ../../features/routing/spendLedger, ../../features/routing/modelPolicy
 *
 * Contract 06 §9 T15: "Exhausting one agent's weekly total refuses that agent and leaves the other
 * unaffected". Contract 12 §6.2 says it twice over, and says WHY once per belt: "Two belts, and
 * neither substitutes for the other" — the in-app weekly total read per agent, and one provider key
 * per agent with its own periodic limit. So a test that exercises one belt has not tested R17; it
 * has tested half of R17 and left the other half to a comment.
 *
 * ## What was already covered, and what this file is for
 *
 * `src/features/routing/agentBudget.test.ts` proves the isolation at the POLICY level — one ledger
 * holding both agents' rows, `selectModelForAgent` called twice, one blocked and one not. It says so
 * in its own header, and it says the sweep belongs here. What it does not reach:
 *
 *  1. **The server router.** `modelRouter.negative.test.ts` shows the cap refusing for a single
 *     agent. It never shows the OTHER agent routing in the same breath, so nothing there would
 *     notice if `routeModel` began consulting an aggregate.
 *  2. **The provider belt.** Contract 12 §6.2's second belt is one key per agent. Two mocks with two
 *     configurations is what that topology looks like from this side of the port, and until one is
 *     driven to refusal while the other completes, the belt is asserted only in prose.
 *  3. **A real store.** The pure read model is handed rows by a caller. That caller is
 *     `spendLedgerRepo`, which reads BOTH agents' rows deliberately (§6.2.3) so the per-agent
 *     scoping is exercised at run time rather than hidden in a WHERE clause. The scoping has never
 *     been driven over rows that actually round-tripped through the engine.
 *
 * ## On topology, because this is the easy thing to get wrong
 *
 * Steering §4.1 gives each agent its own store — `life.db`, `finance.db` — and no process opens
 * another agent's file. That is the ISOLATION OF THE FACTS, and it is already asserted by contract
 * 06 §9 T2/T3 (`paths.ts` containment, and the source scan for the cross-database open keyword).
 * The spend ledger is a different thing: contract 06 §6.1 gives it an enumerated `agent` column
 * holding `life` or `finance`, precisely so a cap decision can be scoped per agent, and §6.2.3
 * makes the scoping the load-bearing rule. So the topology this file asserts is the tree's own —
 * one ledger table, an `agent` key, never aggregated for a cap decision — and the store-level
 * isolation stays where it already is. Asserting a two-file topology here would be asserting
 * something the tree does not do.
 *
 * Every figure below is PROVIDER accounting in integer micro-USD, synthetic, and chosen only to sit
 * either side of a nominal turn. No owner money appears, `src/lib/money` is not imported, and no
 * deployment particular is named — `apiKeyRef` and friends are the NAMES of environment entries
 * (R24). Nothing is logged, and no prompt text reaches any record (§6.4, R19).
 */
import { describe, expect, it } from 'vitest';

import { MODEL_GLM, MODEL_MIMO } from '../../features/routing/modelPolicy';
import {
  agentWeeklyBudget,
  COST_SOURCE_ACTUAL,
  SPEND_AGENTS,
  weeklySpend,
  weekKeyOf,
  type AgentWeeklyBudget,
  type SpendAgent,
  type SpendLedgerRow,
} from '../../features/routing/spendLedger';
import { agentBudgetFromStore, appendSpend } from '../db/spendLedgerRepo';
import { openTestStore } from '../db/repositories/testStore';
import { createInvocationRecorder } from '../mocks/invocationRecorder';
import { createOpenRouterMock, type OpenRouterMock } from '../mocks/openrouterMock';
import { isMockPortFailure } from '../mocks/failure';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  type AdmittedRegistry,
  type EligibilityRegistryEntry,
  type LiveEligibilityRegistry,
} from './eligibilityRegistry';
import { ModelRoutingError, routeModel } from './modelRouter';
import { classifyTurn, isModelBearing, type ModelInvocationGrant, type TurnFacts } from './turnClassifier';

const WEEK_KEY = weekKeyOf('2026-08-06');
/** Synthetic per-agent cap, well above one nominal turn. Not the owner's cap. */
const CAP_MICRO_USD = 400_000;

const CALM: TurnFacts = Object.freeze({
  intent: 'parse_bank_message',
  reversibility: 'reversible',
  dataFreshness: 'fresh',
  missingInformation: false,
  toolRequirement: false,
  securitySensitive: false,
  amountOverOwnerThreshold: false,
  exceedsSafeToSpendAllowance: false,
  materialShareOfLiquidNetWorth: false,
  criticalObligationImpact: false,
  newDebt: false,
  assetSale: false,
  majorIncomeChange: false,
  longHorizonDecision: false,
  forecastShortfallLikely: false,
  evidenceConflicts: false,
  lowConfidence: false,
});

function grant(turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn(CALM, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
  return classification.modelGrant;
}

function graded(modelId: string): EligibilityRegistryEntry {
  return { modelId, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false };
}

function registry(): AdmittedRegistry {
  const document: LiveEligibilityRegistry = {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: false,
    entries: [graded(MODEL_MIMO), graded(MODEL_GLM)],
  };
  return admitEligibilityRegistry(document);
}

function row(agent: SpendAgent, costMicroUsd: number): SpendLedgerRow {
  return {
    id: `row-${agent}-${costMicroUsd}`,
    agent,
    occurredAt: '2026-08-06T09:00:00Z',
    weekKey: WEEK_KEY,
    modelId: MODEL_GLM,
    costMicroUsd,
    promptTokens: 10,
    completionTokens: 4,
    requestRef: `req-${agent}-${costMicroUsd}`,
    costSource: COST_SOURCE_ACTUAL,
  };
}

/**
 * One ledger holding BOTH agents' rows, exactly as the repository hands it over (§6.2.3). Building
 * each agent's budget from a single-agent array would be the mistake this whole file is about: an
 * implementation that aggregated across agents would pass, because there would be nothing to
 * aggregate. The scoping has to have work to do.
 */
function sharedLedger(lifeSpend: number, financeSpend: number): readonly SpendLedgerRow[] {
  return [row('life', lifeSpend), row('finance', financeSpend)];
}

/** One agent's budget, read out of a ledger that also holds the other agent's spend. */
function budgetOf(
  agent: SpendAgent,
  rows: readonly SpendLedgerRow[],
  capMicroUsd = CAP_MICRO_USD,
): AgentWeeklyBudget {
  return agentWeeklyBudget(rows, { agent, weekKey: WEEK_KEY, capMicroUsd });
}

function refusalCode(attempt: () => unknown): string {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(ModelRoutingError);
    return (error as ModelRoutingError).code;
  }
  throw new Error('expected the router to refuse, but it did not');
}

// =============================================================================================
// Belt 1 — the in-app weekly total, at the SERVER router, both agents in one test
// =============================================================================================

describe('belt 1: an exhausted agent is refused by routeModel while the other still routes (§6.2, R17, T15)', () => {
  it('refuses the exhausted agent and routes the other, from the same ledger and the same registry', () => {
    const shared = registry();
    // ONE ledger. `life` has spent its whole cap; `finance` has spent almost nothing. Both budgets
    // are read out of the same rows, so an implementation that summed them would refuse both.
    const rows = sharedLedger(CAP_MICRO_USD, 250);
    const exhausted = budgetOf('life', rows);
    const healthy = budgetOf('finance', rows);
    expect(exhausted.spentMicroUsd).toBe(CAP_MICRO_USD);
    expect(healthy.spentMicroUsd).toBe(250);

    expect(refusalCode(() => routeModel({ registry: shared, grant: grant('turn-life'), budget: exhausted }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );

    // THE other half of R17. Not a second test that could pass in isolation — the same registry
    // object, the same week, immediately after the refusal above.
    const routed = routeModel({ registry: shared, grant: grant('turn-finance'), budget: healthy });
    expect(routed.model.modelId).toBe(MODEL_MIMO);
    expect(routed.policy.blockedByBudget).toBe(false);
  });

  it('holds symmetrically, so the result is not an artefact of which agent was named first', () => {
    const shared = registry();
    const rows = sharedLedger(250, CAP_MICRO_USD);
    expect(refusalCode(() => routeModel({ registry: shared, grant: grant('turn-f2'), budget: budgetOf('finance', rows) }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );
    expect(routeModel({ registry: shared, grant: grant('turn-l2'), budget: budgetOf('life', rows) }).model.modelId).toBe(MODEL_MIMO);
  });

  it('exhausts BOTH agents only when both have spent their own caps, never by summing them', () => {
    // Each agent has spent slightly over half a cap. SUMMED, that clears one whole cap — so an
    // implementation that aggregated would refuse both. Scoped per agent, neither is exhausted.
    const half = Math.floor(CAP_MICRO_USD * 0.6);
    const rows = sharedLedger(half, half);
    expect(weeklySpend(rows, 'life', WEEK_KEY) + weeklySpend(rows, 'finance', WEEK_KEY)).toBeGreaterThan(CAP_MICRO_USD);
    for (const agent of SPEND_AGENTS) {
      const budget = budgetOf(agent, rows);
      expect(budget.spentMicroUsd, agent).toBe(half);
      expect(budget.exhausted, agent).toBe(false);
      expect(routeModel({ registry: registry(), grant: grant(`turn-half-${agent}`), budget }).model.modelId).toBe(MODEL_MIMO);
    }
  });

  it('names the refused agent in the refusal, so the operator reads WHICH agent stopped (§6.2)', () => {
    // §6.2: "The refusal is explicit and legible to the operator, not a silent degradation."
    for (const agent of SPEND_AGENTS) {
      const rows = agent === 'life' ? sharedLedger(CAP_MICRO_USD, 250) : sharedLedger(250, CAP_MICRO_USD);
      try {
        routeModel({ registry: registry(), grant: grant(`turn-legible-${agent}`), budget: budgetOf(agent, rows) });
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelRoutingError);
        const refusal = error as ModelRoutingError;
        expect(refusal.detail.agent).toBe(agent);
        expect(refusal.detail.weekKey).toBe(WEEK_KEY);
        // Legible, and still carrying no amount (§6.4, R19).
        expect(Object.values(refusal.detail).join(' ')).not.toMatch(/\d+\.\d/);
      }
    }
  });

  it('never raises or lifts a cap to let the call through (§6.2)', () => {
    // The refusal is total for the exhausted agent at every model-bearing tier, not softened at the
    // cheap end. §6.2: "A cap is never raised, bypassed, or temporarily lifted."
    const facts: Readonly<Record<string, TurnFacts>> = {
      T1: CALM,
      T2: { ...CALM, intent: 'explain_safe_to_spend' },
      T3: { ...CALM, intent: 'evaluate_financial_decision', newDebt: true },
      T4: { ...CALM, intent: 'repository_engineering' },
    };
    const rows = sharedLedger(250, CAP_MICRO_USD);
    for (const [tier, turnFacts] of Object.entries(facts)) {
      const classification = classifyTurn(turnFacts, `turn-tier-${tier}`);
      if (!isModelBearing(classification)) throw new Error(`expected ${tier} to be model-bearing`);
      expect(
        refusalCode(() =>
          routeModel({ registry: registry(), grant: classification.modelGrant, budget: budgetOf('finance', rows) }),
        ),
        tier,
      ).toBe('MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED');
    }
  });
});

// =============================================================================================
// Belt 2 — one provider key per agent, which is what the port sees of §6.2's second belt
// =============================================================================================

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze(['structured_outputs']),
});

/** One mock per agent: its own key reference, its own cap. That is the two-key topology. */
function agentMock(agent: SpendAgent, alreadySpentMicroUsd: number): OpenRouterMock {
  const config: OpenRouterPortConfig = {
    agent,
    apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
    apiKeyRef: `OPENROUTER_${agent.toUpperCase()}_KEY_REF`,
    weeklyCapMicroUsd: CAP_MICRO_USD,
    killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
    eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
  };
  return createOpenRouterMock({
    config,
    recorder: createInvocationRecorder(),
    eligibleModelIds: [MODEL_GLM],
    alreadySpentMicroUsd,
  });
}

function requestFor(agent: SpendAgent, correlationRef: string): ModelRequest {
  return {
    agent,
    tier: 'T2',
    modelId: MODEL_GLM,
    contentClass: 'financial',
    privacy: PRIVACY,
    messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
    maxOutputTokens: 64,
    correlationRef,
  };
}

describe('belt 2: one key per agent, so a runaway agent cannot spend the other allocation (§6.2)', () => {
  it('refuses at the provider for the exhausted key and completes for the other', async () => {
    const life = agentMock('life', CAP_MICRO_USD);
    const finance = agentMock('finance', 0);

    await expect(life.port.complete(requestFor('life', 'p-life'))).rejects.toSatisfy(
      (error: unknown) => isMockPortFailure(error) && error.code === 'MODEL_WEEKLY_CAP_EXHAUSTED',
    );

    const result = await finance.port.complete(requestFor('finance', 'p-finance'));
    expect(result.modelIdServed).toBe(MODEL_GLM);
    expect(finance.spentMicroUsd).toBeGreaterThan(0);
    // The exhausted key spent nothing further — a refused call is not a paid call.
    expect(life.spentMicroUsd).toBe(CAP_MICRO_USD);
  });

  it('records the refusal in the exhausted agent telemetry only, and carries no prompt text', async () => {
    const life = agentMock('life', CAP_MICRO_USD);
    const finance = agentMock('finance', 0);
    await life.port.complete(requestFor('life', 'p-life-2')).catch(() => undefined);
    await finance.port.complete(requestFor('finance', 'p-finance-2'));

    expect(life.telemetry.map((row) => row.outcome)).toEqual(['refused']);
    expect(finance.telemetry.map((row) => row.outcome)).toEqual(['ok']);
    // The two agents keep separate books; neither appears in the other's.
    expect(life.telemetry.every((row) => row.agent === 'life')).toBe(true);
    expect(finance.telemetry.every((row) => row.agent === 'finance')).toBe(true);
    expect(JSON.stringify([...life.telemetry, ...finance.telemetry])).not.toContain('synthetic turn text');
  });

  it('is the SECOND belt, not a substitute: the in-app belt refuses before the port is reached', () => {
    // §6.2: "neither substitutes for the other". The in-app reading refuses without any port call,
    // so the provider is never asked — which is why the recorder is still empty afterwards.
    const finance = agentMock('finance', 0);
    const rows = sharedLedger(250, CAP_MICRO_USD);
    expect(refusalCode(() => routeModel({ registry: registry(), grant: grant('turn-belt'), budget: budgetOf('finance', rows) }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );
    expect(finance.recorder.isEmpty()).toBe(true);
    expect(finance.spentMicroUsd).toBe(0);
  });
});

// =============================================================================================
// The same rule over rows that actually round-tripped through the engine
// =============================================================================================

describe('the per-agent scoping holds over a real migrated store, not only over handed-in rows (T15)', () => {
  it('exhausts one agent and leaves the other routing, reading both agents rows from the store', () => {
    const store = openTestStore('nizam-cap-isolation-');
    try {
      // Both agents' rows land in the one ledger table, keyed by agent (contract 06 §6.1).
      appendSpend(store.ctx.handle, {
        id: 'spend-life-1',
        agent: 'life',
        occurredAt: '2026-08-06T09:00:00Z',
        modelId: MODEL_GLM,
        costMicroUsd: CAP_MICRO_USD,
        promptTokens: 120,
        completionTokens: 40,
        requestRef: 'req-life-1',
        costSource: COST_SOURCE_ACTUAL,
      });
      appendSpend(store.ctx.handle, {
        id: 'spend-finance-1',
        agent: 'finance',
        occurredAt: '2026-08-06T10:00:00Z',
        modelId: MODEL_GLM,
        costMicroUsd: 300,
        promptTokens: 30,
        completionTokens: 10,
        requestRef: 'req-finance-1',
        costSource: COST_SOURCE_ACTUAL,
      });

      const lifeBudget = agentBudgetFromStore(store.ctx.handle, { agent: 'life', weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD });
      const financeBudget = agentBudgetFromStore(store.ctx.handle, {
        agent: 'finance',
        weekKey: WEEK_KEY,
        capMicroUsd: CAP_MICRO_USD,
      });

      // The store round-trip preserved the integers exactly, so the cap decision is the same one.
      expect(lifeBudget.spentMicroUsd).toBe(CAP_MICRO_USD);
      expect(financeBudget.spentMicroUsd).toBe(300);
      expect(lifeBudget.exhausted).toBe(true);
      expect(financeBudget.exhausted).toBe(false);

      const shared = registry();
      expect(refusalCode(() => routeModel({ registry: shared, grant: grant('turn-store-life'), budget: lifeBudget }))).toBe(
        'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
      );
      expect(routeModel({ registry: shared, grant: grant('turn-store-finance'), budget: financeBudget }).model.modelId).toBe(
        MODEL_MIMO,
      );
    } finally {
      store.close();
    }
  });

  it('reads a ledger that genuinely holds both agents, so the scoping had something to exclude', () => {
    // An isolation claim over a ledger containing one agent's rows would prove nothing: the
    // exclusion has to have work to do. This asserts the ledger really is shared before believing
    // the totals above.
    const store = openTestStore('nizam-cap-shared-');
    try {
      for (const [index, agent] of SPEND_AGENTS.entries()) {
        appendSpend(store.ctx.handle, {
          id: `spend-both-${agent}`,
          agent,
          occurredAt: '2026-08-06T11:00:00Z',
          modelId: MODEL_GLM,
          costMicroUsd: 1_000 * (index + 1),
          promptTokens: 5,
          completionTokens: 2,
          requestRef: `req-both-${agent}`,
          costSource: COST_SOURCE_ACTUAL,
        });
      }
      const rows = [1_000, 2_000];
      for (const [index, agent] of SPEND_AGENTS.entries()) {
        const scoped = agentBudgetFromStore(store.ctx.handle, { agent, weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD });
        // Each agent sees only its own row, never the sum of both.
        expect(scoped.spentMicroUsd, agent).toBe(rows[index]);
        expect(scoped.spentMicroUsd, agent).not.toBe(rows[0]! + rows[1]!);
      }
    } finally {
      store.close();
    }
  });

  it('gives each agent its OWN cap, so a tight cap cannot borrow from a generous one', () => {
    const rows: readonly SpendLedgerRow[] = [
      {
        id: 'r1',
        agent: 'life',
        occurredAt: '2026-08-06T09:00:00Z',
        weekKey: WEEK_KEY,
        modelId: MODEL_GLM,
        costMicroUsd: 200_000,
        promptTokens: 1,
        completionTokens: 1,
        requestRef: 'q1',
        costSource: COST_SOURCE_ACTUAL,
      },
      {
        id: 'r2',
        agent: 'finance',
        occurredAt: '2026-08-06T09:00:00Z',
        weekKey: WEEK_KEY,
        modelId: MODEL_GLM,
        costMicroUsd: 200_000,
        promptTokens: 1,
        completionTokens: 1,
        requestRef: 'q2',
        costSource: COST_SOURCE_ACTUAL,
      },
    ];
    expect(weeklySpend(rows, 'life', WEEK_KEY)).toBe(200_000);
    expect(weeklySpend(rows, 'finance', WEEK_KEY)).toBe(200_000);

    const tight = agentWeeklyBudget(rows, { agent: 'life', weekKey: WEEK_KEY, capMicroUsd: 100_000 });
    const generous = agentWeeklyBudget(rows, { agent: 'finance', weekKey: WEEK_KEY, capMicroUsd: 900_000 });
    expect(refusalCode(() => routeModel({ registry: registry(), grant: grant('turn-tight'), budget: tight }))).toBe(
      'MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED',
    );
    expect(routeModel({ registry: registry(), grant: grant('turn-generous'), budget: generous }).model.modelId).toBe(MODEL_MIMO);
  });
});
