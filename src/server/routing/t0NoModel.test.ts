// @vitest-environment node
/**
 * NIZAM · The empirical half of R16 — a T0 corpus through the real path, and an empty record
 * Implemented by: PFOS Contract 12 / Phase 5.1 (spec 06-two-agent-vps)
 * Owning requirements: R16 (a turn classified `T0` invokes no model)
 * Depends on: ./turnDispatch, ./turnClassifier, ../mocks/openrouterMock, ../mocks/invocationRecorder,
 *   ../ports/openrouter (types), ../../features/routing/modelPolicy (the contract 10 roster)
 *
 * Contract 12 §6.1 states the acceptance shape and then names the false negative:
 *
 *   "This is proved structurally: on the `T0` path the model port is **not called**, and the test
 *    asserts against a port mock that records invocations, then asserts the record is empty. A test
 *    that merely asserts the response looks deterministic is insufficient. It would pass if a model
 *    were called and its output discarded, which still spends money and still sends content to a
 *    provider."
 *
 * So nothing below inspects the deterministic answer as evidence. The evidence is that
 * {@link InvocationRecorder} holds nothing after the whole corpus has been dispatched through the
 * same {@link dispatchTurn} the runtime uses, with the same channel and the same mock — not a
 * stubbed variant, and not the classifier alone.
 *
 * **The corpus is adversarial on purpose.** Six deterministic intents from contract 10 crossed with
 * six fact profiles, one of which sets every high-impact verdict at once. If any escalation signal
 * could lift a deterministic intent out of T0, this corpus would find it and the recorder would stop
 * being empty. Thirty-six turns is not a large number; it is every deterministic intent under every
 * shape of pressure the fact set can express.
 *
 * **An empty record only proves something if a full one is reachable.** The positive control at the
 * bottom dispatches one non-T0 turn through the identical wiring and asserts the recorder DID
 * capture it. Without that, "the record is empty" would be equally consistent with a recorder that
 * never records, which is exactly the shape of ceremony §6.1 warns against.
 *
 * No figure appears in any fixture (§6, R24), no key or endpoint is named — `apiKeyRef` and
 * `apiBaseUrlRef` are the NAMES of environment entries — and no prompt text is recorded anywhere,
 * because the recorder's detail type cannot hold it (§6.4, R19).
 */
import { describe, expect, it } from 'vitest';

import { MODEL_GLM } from '../../features/routing/modelPolicy.ts';
import { createInvocationRecorder, type InvocationRecorder } from '../mocks/invocationRecorder.ts';
import { createOpenRouterMock, type OpenRouterMock } from '../mocks/openrouterMock.ts';
import type { ModelRequest, OpenRouterPortConfig, ProviderPrivacyPolicy } from '../ports/openrouter.ts';
import { createModelChannel, dispatchTurn, type TurnDispatchDependencies } from './turnDispatch.ts';
import {
  INTENT_FAMILY,
  TURN_INTENTS,
  type ModelInvocationGrant,
  type TurnFacts,
  type TurnIntent,
} from './turnClassifier.ts';

// ---------------------------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------------------------

/** Contract 10's six deterministic examples, read out of the family map rather than retyped. */
const DETERMINISTIC_INTENTS: readonly TurnIntent[] = TURN_INTENTS.filter(
  (intent) => INTENT_FAMILY[intent] === 'deterministic',
);

const BASE: TurnFacts = Object.freeze({
  intent: 'recalculate_balances',
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

/**
 * Six fact profiles, from benign to every-verdict-true. Each is named, so a failure says which
 * shape of pressure lifted a turn off the deterministic path.
 */
const PRESSURE_PROFILES: readonly (readonly [string, Partial<TurnFacts>])[] = [
  ['nothing remarkable', {}],
  [
    'every high-impact verdict at once',
    {
      newDebt: true,
      criticalObligationImpact: true,
      amountOverOwnerThreshold: true,
      assetSale: true,
      majorIncomeChange: true,
      longHorizonDecision: true,
      forecastShortfallLikely: true,
    },
  ],
  ['facts missing and freshness unknown', { missingInformation: true, dataFreshness: 'unknown' }],
  ['security sensitive and tool bearing', { securitySensitive: true, toolRequirement: true }],
  [
    'irreversible and material',
    { reversibility: 'irreversible', materialShareOfLiquidNetWorth: true, exceedsSafeToSpendAllowance: true },
  ],
  ['evidence conflicting, confidence low, data stale', { evidenceConflicts: true, lowConfidence: true, dataFreshness: 'stale' }],
];

interface CorpusTurn {
  readonly turnRef: string;
  readonly label: string;
  readonly facts: TurnFacts;
}

/** Thirty-six turns: every deterministic intent under every pressure profile. */
const T0_CORPUS: readonly CorpusTurn[] = DETERMINISTIC_INTENTS.flatMap((intent, intentIndex) =>
  PRESSURE_PROFILES.map(([label, overrides], profileIndex) => ({
    turnRef: `t0-corpus-${intentIndex}-${profileIndex}`,
    label: `${intent} under ${label}`,
    facts: { ...BASE, ...overrides, intent },
  })),
);

// ---------------------------------------------------------------------------------------------
// The wiring — the same one a runtime would use
// ---------------------------------------------------------------------------------------------

/** Injected configuration. Both `*Ref` fields are NAMES of environment entries, never values. */
const PORT_CONFIG: OpenRouterPortConfig = Object.freeze({
  agent: 'finance',
  apiBaseUrlRef: 'OPENROUTER_API_BASE_REF',
  apiKeyRef: 'OPENROUTER_FINANCE_KEY_REF',
  // Provider accounting in integer micro-USD, injected. Not owner money, and not a real cap.
  weeklyCapMicroUsd: 10_000,
  killSwitchSentinelPathRef: 'NIZAM_KILL_SWITCH_SENTINEL_REF',
  eligibilityRegistryPathRef: 'MODEL_ELIGIBILITY_REGISTRY_REF',
});

const PRIVACY: ProviderPrivacyPolicy = Object.freeze({
  training: 'excluded',
  dataCollectingProviders: 'denied',
  zeroDataRetention: 'required',
  requiredParameters: Object.freeze(['structured_outputs']),
});

interface Harness {
  readonly recorder: InvocationRecorder;
  readonly mock: OpenRouterMock;
  readonly deps: TurnDispatchDependencies<string>;
  /** How many times the deterministic executor ran. */
  readonly deterministicRuns: () => number;
  /** How many times a model request was PLANNED — which needs a grant, so T0 cannot reach it. */
  readonly plannedRequests: () => number;
}

function harness(): Harness {
  const recorder = createInvocationRecorder();
  const mock = createOpenRouterMock({ config: PORT_CONFIG, recorder, eligibleModelIds: [MODEL_GLM] });
  let deterministicRuns = 0;
  let plannedRequests = 0;

  const deps: TurnDispatchDependencies<string> = {
    channel: createModelChannel(mock.port),
    executeDeterministically: (_facts: TurnFacts, turnRef: string): string => {
      deterministicRuns += 1;
      return `code-only:${turnRef}`;
    },
    planModelRequest: (grant: ModelInvocationGrant, _facts: TurnFacts): ModelRequest => {
      plannedRequests += 1;
      return {
        agent: PORT_CONFIG.agent,
        tier: grant.tier,
        modelId: MODEL_GLM,
        contentClass: 'financial',
        privacy: PRIVACY,
        messages: [{ role: 'user', content: 'synthetic turn text, never recorded' }],
        maxOutputTokens: 64,
        correlationRef: grant.turnRef,
      };
    },
  };

  return { recorder, mock, deps, deterministicRuns: () => deterministicRuns, plannedRequests: () => plannedRequests };
}

// =============================================================================================
// R16 — the corpus, and the empty record
// =============================================================================================

describe('a corpus of T0 turns through the real path leaves the invocation record empty (§6.1, R16)', () => {
  it('has a corpus worth calling one: every deterministic intent under every pressure profile', () => {
    expect(DETERMINISTIC_INTENTS.length).toBe(6);
    expect(PRESSURE_PROFILES.length).toBe(6);
    expect(T0_CORPUS.length).toBe(36);
    expect(new Set(T0_CORPUS.map((turn) => turn.turnRef)).size).toBe(36);
  });

  it('dispatches all 36 by code only, and the recorder holds nothing at all', async () => {
    const { recorder, mock, deps, deterministicRuns, plannedRequests } = harness();

    for (const turn of T0_CORPUS) {
      const outcome = await dispatchTurn(deps, turn.facts, turn.turnRef);
      // The route, not the answer, is what §6.1 cares about — the answer is not evidence.
      expect(outcome.route, turn.label).toBe('code_only');
      expect(outcome.tier, turn.label).toBe('T0');
      expect(outcome.rule, turn.label).toBe('deterministic_intent');
    }

    // THE assertion. An empty record is the only thing that distinguishes "no call was made" from
    // "a call was made and its output discarded" (§6.1).
    expect(recorder.all).toEqual([]);
    expect(recorder.isEmpty()).toBe(true);
    expect(recorder.isEmpty('openrouter')).toBe(true);
    expect(recorder.isEmpty('openrouter', 'complete')).toBe(true);
    expect(recorder.countOf('openrouter')).toBe(0);

    // Corroboration from the mock's own books: no telemetry row, and no provider spend.
    expect(mock.telemetry).toEqual([]);
    expect(mock.spentMicroUsd).toBe(0);

    // And the request was never even planned, because planning needs a grant a T0 turn has not got.
    expect(plannedRequests()).toBe(0);
    // Every turn was answered — an empty record from a path that did nothing would prove nothing.
    expect(deterministicRuns()).toBe(36);
  });
});

// =============================================================================================
// The positive control — the recorder can fail, so its silence means something
// =============================================================================================

describe('the same wiring DOES record a non-T0 turn, so an empty record is evidence (§6.1)', () => {
  it('captures one openrouter invocation for a T2 turn, on the identical channel and mock', async () => {
    const { recorder, mock, deps, deterministicRuns, plannedRequests } = harness();
    const conversational: TurnFacts = { ...BASE, intent: 'explain_safe_to_spend' };

    const outcome = await dispatchTurn(deps, conversational, 'control-t2');
    expect(outcome.route).toBe('model');
    expect(outcome.tier).toBe('T2');

    expect(recorder.isEmpty()).toBe(false);
    expect(recorder.countOf('openrouter', 'complete')).toBe(1);
    expect(mock.telemetry).toHaveLength(1);
    expect(mock.spentMicroUsd).toBeGreaterThan(0);
    expect(plannedRequests()).toBe(1);
    expect(deterministicRuns()).toBe(0);
  });

  it('records a redacted projection only — no prompt text reaches the record (§6.4, R19)', async () => {
    const { recorder, deps } = harness();
    await dispatchTurn(deps, { ...BASE, intent: 'periodic_briefing' }, 'control-redaction');

    const [invocation] = recorder.callsTo('openrouter', 'complete');
    if (invocation === undefined) throw new Error('expected one recorded invocation');
    expect(Object.keys(invocation.detail).sort()).toEqual([
      'agent',
      'contentClass',
      'correlationRef',
      'messageCount',
      'modelId',
      'tier',
      'zeroDataRetention',
    ]);
    expect(JSON.stringify(invocation)).not.toContain('synthetic turn text');
  });
});
