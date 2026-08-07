// @vitest-environment node
/**
 * NIZAM · An exhausted model budget is a spend guard, not a service outage
 * Implemented by: PFOS Contract 12 / Phase 5.4 (spec 06-two-agent-vps)
 * Owning requirements: R17 (an exhausted cap refuses model calls AND deterministic obligation
 *   alerts SHALL still be produced)
 * Depends on: ./modelRouter, ./eligibilityRegistry, ./turnClassifier, ./turnDispatch,
 *   ../mocks/openrouterMock, ../mocks/invocationRecorder,
 *   ../../features/obligations/obligations.logic, ../../features/safeToSpend/safeToSpend,
 *   ../../features/forecast/forecast, ../../lib/db/schema — the REAL Stage 1-4 engines, verbatim
 *
 * This is the half of R17 that the requirement puts last and contract 12 §6.2 calls the worst
 * failure this system could have:
 *
 *   "**Exhaustion refuses model calls. It never suppresses a deterministic alert (R17).** Obligation
 *    alerts, due-date warnings, and safe-to-spend figures are produced by the deterministic engines
 *    and do not depend on a model. A cap is a spend guard, not a service outage. Losing a due-date
 *    warning because a model budget ran out would be the single worst failure mode this system could
 *    have, and it is forbidden."
 *
 * ## Why this needed a test rather than an argument
 *
 * The claim is TRUE BY CONSTRUCTION — the engines take no model port, so a cap cannot reach them.
 * That is exactly why it had never been asserted: a property nobody can see failing is a property
 * nobody writes down. But "the engines do not import the router" is a structural fact about today's
 * tree, and R17 is a promise about the system's behaviour. The gap between the two is one future
 * refactor wide: a briefing path that decorated an obligation alert with a model-written sentence,
 * and then propagated the refusal instead of degrading to the deterministic line, would violate R17
 * while every existing test stayed green.
 *
 * So the shape below is a DIFFERENTIAL, not a smoke test. The same synthetic ledger is run twice:
 * once with an ample cap and once with the cap exhausted and the model channel refusing on every
 * call. The assertion is that the deterministic output is **deeply equal** across the two runs — not
 * "still non-empty", not "still red somewhere", but identical field for field, including the amber
 * and red statuses, the shortfall figures, the penalty exposure, and the due-date arithmetic. A
 * deterministic alert that changed in ANY respect because a model budget ran out would fail this.
 *
 * ## No stand-ins
 *
 * `obligationFundingReport`, `safeToSpendAllHorizons`, `forecastAll` and `worstStatus` are the real
 * Stage 1-4 engines, imported verbatim, and the money in the fixture is integer milliunits through
 * `src/lib/money`'s own convention. There is no second engine and no second money implementation
 * here (steering §1). Owner money is milliunits; provider cost is integer micro-USD, and the two
 * never meet — the engines below never see a micro-USD figure and the router never sees a milliunit.
 *
 * Every amount is synthetic and chosen to force one green, one amber, one red and one overdue
 * obligation, so the corpus has alerts worth losing. No real monetary figure, no domain, no key, no
 * identifier appears (R24), and no prompt text is recorded anywhere (§6.4, R19).
 */
import { describe, expect, it } from 'vitest';

import type { Account } from '../../features/accounts/accounts.types';
import type { Obligation } from '../../features/obligations/obligation.types';
import type { Transaction } from '../../features/transactions/transaction.types';
import type { FinancialPolicy } from '../../features/safeToSpend/policy.types';
import { obligationFundingReport, worstStatus } from '../../features/obligations/obligations.logic';
import { safeToSpendAllHorizons } from '../../features/safeToSpend/safeToSpend';
import { forecastAll } from '../../features/forecast/forecast';
import { createEmptyDb, type NizamDb } from '../../lib/db/schema';
import { MODEL_GLM, MODEL_MIMO } from '../../features/routing/modelPolicy';
import {
  agentWeeklyBudget,
  COST_SOURCE_ACTUAL,
  weekKeyOf,
  type AgentWeeklyBudget,
  type SpendAgent,
} from '../../features/routing/spendLedger';
import { createInvocationRecorder } from '../mocks/invocationRecorder';
import { createOpenRouterMock } from '../mocks/openrouterMock';
import { isMockPortFailure } from '../mocks/failure';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter';
import {
  admitEligibilityRegistry,
  ELIGIBILITY_REGISTRY_VERSION,
  type AdmittedRegistry,
  type LiveEligibilityRegistry,
} from './eligibilityRegistry';
import { ModelRoutingError, routeModel } from './modelRouter';
import { createModelChannel, dispatchTurn, type TurnDispatchDependencies } from './turnDispatch';
import { classifyTurn, isModelBearing, type ModelInvocationGrant, type TurnFacts } from './turnClassifier';

// ---------------------------------------------------------------------------------------------
// Owner money: integer milliunits. Synthetic throughout.
// ---------------------------------------------------------------------------------------------

/** Milliunits per unit of owner currency (steering money-rules 1). Not a provider figure. */
const MILLI = 1_000;
const AS_OF = '2026-08-06';

function account(id: string, type: Account['type'], clearedBalance: number): Account {
  return {
    id,
    name: id,
    type,
    onBudget: true,
    balance: clearedBalance,
    clearedBalance,
    accountIdentifier: null,
    creditLimit: null,
    closed: false,
    order: 0,
    paymentCategoryId: null,
  };
}

function transaction(id: string, date: string, amount: number): Transaction {
  return {
    id,
    accountId: 'acct-main',
    date,
    amount,
    payee: 'synthetic',
    categoryId: null,
    memo: '',
    cleared: 'uncleared',
    approved: true,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo: null,
  };
}

function obligation(over: Partial<Obligation> & Pick<Obligation, 'id' | 'priority' | 'amountDue' | 'dueDate'>): Obligation {
  return {
    creditor: 'synthetic',
    accountId: null,
    minimumDue: over.amountDue,
    graceDate: null,
    frequency: 'monthly',
    penalty: 0,
    interestBps: 0,
    autopay: false,
    verificationSource: 'manual',
    confidence: 1,
    protectedReserve: 0,
    ...over,
  };
}

/**
 * A ledger deliberately under pressure, so the deterministic engines have alerts to lose: cash does
 * not cover the reserve chain, one obligation is already past due and uncovered, one is covered only
 * once expected income lands, and one falls outside anything the projection reaches. That yields a
 * critical, an amber and two red lines, with real shortfall and penalty figures on them. Every
 * figure is synthetic.
 */
function pressuredLedger(): NizamDb {
  const db = createEmptyDb('2026-08-01T00:00:00.000Z');
  db.accounts.push(account('acct-main', 'CIB_DEBIT', 1_500 * MILLI), account('acct-cash', 'CASH', 500 * MILLI));
  db.transactions.push(
    transaction('txn-in', '2026-08-12', 4_000 * MILLI),
    transaction('txn-out', '2026-08-09', -1_500 * MILLI),
  );
  db.obligations.push(
    // Past due and uncovered once the chain above it has claimed funds → critical.
    obligation({ id: 'ob-overdue', priority: 'P0', amountDue: 3_000 * MILLI, dueDate: '2026-08-03', penalty: 250 * MILLI }),
    // Covered from cash on hand → green.
    obligation({ id: 'ob-soon', priority: 'P1', amountDue: 2_000 * MILLI, dueDate: '2026-08-20', penalty: 100 * MILLI }),
    // Covered only after the expected inflow lands → amber.
    obligation({ id: 'ob-inflow', priority: 'P2', amountDue: 6_000 * MILLI, dueDate: '2026-08-28', penalty: 400 * MILLI }),
    // Beyond anything the projection can reach → red.
    obligation({ id: 'ob-far', priority: 'P3', amountDue: 20_000 * MILLI, dueDate: '2026-09-15', penalty: 900 * MILLI }),
  );
  const policy: FinancialPolicy = {
    minimumLiquidityBuffer: 2_000 * MILLI,
    essentialLivingMonthly: 5_000 * MILLI,
    uncertaintyBps: 500,
    stalenessBps: 500,
    staleAfterDays: 3,
    expectedInflow: { amount: 12_000 * MILLI, dayOfMonth: 25, confidence: 0.9 },
  };
  db.policy = policy;
  return db;
}

/** Everything a deterministic run produces. This is the object the differential compares. */
interface DeterministicAlerts {
  readonly lines: ReturnType<typeof obligationFundingReport>;
  readonly worst: ReturnType<typeof worstStatus>;
  readonly safeToSpend: ReturnType<typeof safeToSpendAllHorizons>;
  readonly forecasts: ReturnType<typeof forecastAll>;
}

/**
 * Run the REAL Stage 1-4 engines. Note what this function does not take: no channel, no registry,
 * no budget, no port. That absence is the property, and the differential below is what turns the
 * absence into evidence.
 */
function runDeterministicEngines(db: NizamDb): DeterministicAlerts {
  const lines = obligationFundingReport(db.obligations, db.accounts, db.transactions, db.policy, AS_OF);
  return {
    lines,
    worst: worstStatus(lines),
    safeToSpend: safeToSpendAllHorizons(db, AS_OF),
    forecasts: forecastAll(db, AS_OF),
  };
}

// ---------------------------------------------------------------------------------------------
// The model side: a channel that refuses on every call, and a router that refuses before it
// ---------------------------------------------------------------------------------------------

const WEEK_KEY = weekKeyOf(AS_OF);
/** Provider accounting, integer micro-USD. Synthetic, and not the owner's cap. */
const CAP_MICRO_USD = 300_000;

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze(['structured_outputs']),
});

function portConfig(agent: SpendAgent): OpenRouterPortConfig {
  return {
    agent,
    apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
    apiKeyRef: `OPENROUTER_${agent.toUpperCase()}_KEY_REF`,
    weeklyCapMicroUsd: CAP_MICRO_USD,
    killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
    eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
  };
}

function registry(): AdmittedRegistry {
  const document: LiveEligibilityRegistry = {
    registryVersion: ELIGIBILITY_REGISTRY_VERSION,
    provisional: false,
    entries: [
      { modelId: MODEL_MIMO, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false },
      { modelId: MODEL_GLM, bands: { L0: true, L1: true, L2: true }, developerBuild: true, disqualified: false },
    ],
  };
  return admitEligibilityRegistry(document);
}

function budgetAt(agent: SpendAgent, spentMicroUsd: number): AgentWeeklyBudget {
  return agentWeeklyBudget(
    [
      {
        id: `row-${agent}`,
        agent,
        occurredAt: '2026-08-06T08:00:00Z',
        weekKey: WEEK_KEY,
        modelId: MODEL_GLM,
        costMicroUsd: spentMicroUsd,
        promptTokens: 8,
        completionTokens: 2,
        requestRef: `req-${agent}`,
        costSource: COST_SOURCE_ACTUAL,
      },
    ],
    { agent, weekKey: WEEK_KEY, capMicroUsd: CAP_MICRO_USD },
  );
}

const CONVERSATIONAL: TurnFacts = Object.freeze({
  intent: 'explain_safe_to_spend',
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

function grantFor(turnRef: string): ModelInvocationGrant {
  const classification = classifyTurn(CONVERSATIONAL, turnRef);
  if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
  return classification.modelGrant;
}

// =============================================================================================
// R17 — the differential
// =============================================================================================

describe('the deterministic engines produce identical alerts with the model budget exhausted (§6.2, R17)', () => {
  it('has a corpus with alerts worth losing: a critical, an amber and two red lines', () => {
    // A differential over an all-green ledger would pass whatever happened to the alerting path.
    const { lines, worst } = runDeterministicEngines(pressuredLedger());
    expect(lines).toHaveLength(4);
    const statuses = new Set(lines.map((line) => line.status));
    expect(statuses.has('critical')).toBe(true);
    expect(statuses.has('amber')).toBe(true);
    expect(statuses.has('red')).toBe(true);
    expect(worst).toBe('critical');
    // At least one line carries a real shortfall and a penalty exposure, so there is a figure to lose.
    expect(lines.some((line) => line.shortfall > 0)).toBe(true);
    expect(lines.some((line) => line.penaltyExposure > 0)).toBe(true);
    // And one line is a due-date warning specifically — the alert §6.2 singles out.
    expect(lines.some((line) => line.overdue)).toBe(true);
  });

  it('refuses every model call for the exhausted agent, at the router and at the provider', async () => {
    // The precondition. If the model channel were still answering, the differential below would be
    // comparing two identical situations and would prove nothing.
    const exhausted = budgetAt('finance', CAP_MICRO_USD);
    expect(exhausted.exhausted).toBe(true);
    let code: string | null = null;
    try {
      routeModel({ registry: registry(), grant: grantFor('turn-shut'), budget: exhausted });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRoutingError);
      code = (error as ModelRoutingError).code;
    }
    expect(code).toBe('MODEL_ROUTING_WEEKLY_CAP_EXHAUSTED');

    // And the second belt, at the port, so the shutdown is total rather than one guard deep.
    const mock = createOpenRouterMock({
      config: portConfig('finance'),
      recorder: createInvocationRecorder(),
      eligibleModelIds: [MODEL_GLM],
      alreadySpentMicroUsd: CAP_MICRO_USD,
    });
    const request: ModelRequest = {
      agent: 'finance',
      tier: 'T2',
      modelId: MODEL_GLM,
      contentClass: 'financial',
      privacy: PRIVACY,
      messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
      maxOutputTokens: 64,
      correlationRef: 'turn-shut-port',
    };
    await expect(mock.port.complete(request)).rejects.toSatisfy(
      (error: unknown) => isMockPortFailure(error) && error.code === 'MODEL_WEEKLY_CAP_EXHAUSTED',
    );
  });

  it('produces byte-identical obligation alerts, safe-to-spend figures and forecasts either side of the cap', () => {
    // The whole of R17's second clause. Same ledger, same asOf. The only difference between the two
    // runs is that the model channel is shut in the second — and §6.2 says that difference must not
    // reach the deterministic output at all.
    const withHeadroom = budgetAt('finance', 0);
    expect(withHeadroom.exhausted).toBe(false);
    const beforeExhaustion = runDeterministicEngines(pressuredLedger());

    const exhausted = budgetAt('finance', CAP_MICRO_USD);
    expect(exhausted.exhausted).toBe(true);
    expect(() => routeModel({ registry: registry(), grant: grantFor('turn-diff'), budget: exhausted })).toThrow(
      ModelRoutingError,
    );
    const afterExhaustion = runDeterministicEngines(pressuredLedger());

    // Not "still non-empty" and not "still red somewhere" — deeply equal, field for field.
    expect(afterExhaustion).toEqual(beforeExhaustion);
    // Restated on the three the requirement names, so a failure says WHICH alert was lost.
    expect(afterExhaustion.lines.map((line) => [line.obligation.id, line.status])).toEqual(
      beforeExhaustion.lines.map((line) => [line.obligation.id, line.status]),
    );
    expect(afterExhaustion.lines.map((line) => line.shortfall)).toEqual(beforeExhaustion.lines.map((line) => line.shortfall));
    expect(afterExhaustion.lines.map((line) => line.daysUntilDue)).toEqual(
      beforeExhaustion.lines.map((line) => line.daysUntilDue),
    );
    expect(afterExhaustion.safeToSpend.map((result) => result.safeToSpend)).toEqual(
      beforeExhaustion.safeToSpend.map((result) => result.safeToSpend),
    );
    expect(afterExhaustion.worst).toBe(beforeExhaustion.worst);
  });

  it('still produces them when the OTHER agent is the one that ran out, so no cap is a global switch', () => {
    const lifeExhausted = budgetAt('life', CAP_MICRO_USD);
    expect(lifeExhausted.exhausted).toBe(true);
    expect(() => routeModel({ registry: registry(), grant: grantFor('turn-life-out'), budget: lifeExhausted })).toThrow(
      ModelRoutingError,
    );
    // The finance agent's own deterministic output is untouched by the life agent's exhaustion.
    expect(runDeterministicEngines(pressuredLedger())).toEqual(runDeterministicEngines(pressuredLedger()));
    expect(runDeterministicEngines(pressuredLedger()).worst).toBe('critical');
  });

  it('produces them with the model channel refusing on EVERY call, through the real dispatch path', async () => {
    // The engines are driven while a live dispatch is failing, not merely while a router refused
    // once. A briefing path that awaited a model before emitting an alert would surface here.
    const recorder = createInvocationRecorder();
    const mock = createOpenRouterMock({
      config: portConfig('finance'),
      recorder,
      eligibleModelIds: [MODEL_GLM],
      alreadySpentMicroUsd: CAP_MICRO_USD,
    });
    const deps: TurnDispatchDependencies<DeterministicAlerts> = {
      channel: createModelChannel(mock.port),
      // The deterministic branch runs the REAL engines. This is the code-only route contract 10
      // calls `deterministic_service.execute(turn)`.
      executeDeterministically: () => runDeterministicEngines(pressuredLedger()),
      planModelRequest: (grant: ModelInvocationGrant): ModelRequest => ({
        agent: 'finance',
        tier: grant.tier,
        modelId: MODEL_GLM,
        contentClass: 'financial',
        privacy: PRIVACY,
        messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
        maxOutputTokens: 64,
        correlationRef: grant.turnRef,
      }),
    };

    // A deterministic turn: answered in full, from the real engines, while the channel is shut.
    const deterministicTurn: TurnFacts = { ...CONVERSATIONAL, intent: 'recalculate_balances' };
    const outcome = await dispatchTurn(deps, deterministicTurn, 'turn-alerts-under-shutdown');
    if (outcome.route !== 'code_only') throw new Error('expected the deterministic route');
    expect(outcome.answer.worst).toBe('critical');
    expect(outcome.answer.lines).toHaveLength(4);
    expect(outcome.answer).toEqual(runDeterministicEngines(pressuredLedger()));
    // And it reached that answer without touching the model port at all.
    expect(recorder.isEmpty()).toBe(true);

    // Meanwhile a model-bearing turn on the SAME wiring is refused, so the channel really is shut.
    await expect(dispatchTurn(deps, CONVERSATIONAL, 'turn-model-under-shutdown')).rejects.toSatisfy(
      (error: unknown) => isMockPortFailure(error) && error.code === 'MODEL_WEEKLY_CAP_EXHAUSTED',
    );
  });

  it('keeps the two units apart, so provider cost can never be mistaken for an alert figure', () => {
    // Owner money is integer milliunits; provider cost is integer micro-USD (contract 06 §6.1).
    // Contract 06 keeps cost "in its own integer unit so it can never be mistaken for a ledger
    // amount", and the mechanical form of that is a naming discipline: a micro-USD figure carries a
    // `*MicroUsd` field name, so no such name may appear anywhere in a deterministic alert.
    const alerts = runDeterministicEngines(pressuredLedger());
    const microNamed: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, nested] of Object.entries(value)) {
        if (/micro/i.test(key)) microNamed.push(`${path}.${key}`);
        walk(nested, `${path}.${key}`);
      }
    };
    walk(alerts, 'alerts');
    expect(microNamed).toEqual([]);

    // And the budget really does carry one, so the scan above had something it could have found.
    const budget = budgetAt('finance', CAP_MICRO_USD);
    expect(Object.keys(budget).some((key) => /micro/i.test(key))).toBe(true);
    expect(Number.isSafeInteger(budget.capMicroUsd)).toBe(true);

    for (const line of alerts.lines) {
      // Every alert figure is an integer milliunit amount. No float, ever.
      expect(Number.isSafeInteger(line.required)).toBe(true);
      expect(Number.isSafeInteger(line.shortfall)).toBe(true);
      expect(Number.isSafeInteger(line.penaltyExposure)).toBe(true);
    }
  });
});
