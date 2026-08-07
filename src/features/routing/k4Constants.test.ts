// @vitest-environment node
/**
 * NIZAM · The owner's K4 decision, pinned to its own literals so the constants cannot redefine it
 * Owning contract: PFOS contract 10/11 (the roster, the tier map, the cap ladder), governed by owner
 *   decision **K4** as recorded in `.kiro/steering/pfos-current.md`.
 * Build phase: spec 06-two-agent-vps, Phase 5.4 — negative tests for routing, spend and telemetry.
 * Depends on: ./modelPolicy. Pure, no store, no network, no clock.
 *
 * ## The gap this closes
 *
 * Every existing assertion about K4 in this repository is expressed RELATIVE to the constant it is
 * about. `modelPolicy.test.ts` blocks routing at `spentThisWeekUsd: WEEKLY_BUDGET_USD`.
 * `agentBudget.test.ts` asserts the chosen model is `toContain`-ed in `DEFAULT_ALLOWED`.
 * `modelRouter.negative.test.ts` iterates `PREMIUM_MODELS` and filters `TIER_CAPABLE` by
 * `DEFAULT_ALLOWED`. Each of those is the right assertion to write — they are about behaviour, and
 * they should not hard-code a figure.
 *
 * But taken together they leave a hole with a specific shape. Raise `WEEKLY_BUDGET_USD` from the
 * owner's five to fifty, and every one of them stays green while the cap the owner set has been
 * silently multiplied by ten. Move `x-ai/grok-4.5` from `PREMIUM_MODELS` into `DEFAULT_ALLOWED`, and
 * the premium-refusal tests still pass — because they iterate the very array that was changed — while
 * a model the owner turned OFF becomes the default. The tests would be measuring the code against
 * itself.
 *
 * This is the third instance of that shape found in this build. Phase 3.4 found it on R7's
 * 120-character note cap and pinned `SIGNAL_NOTE_MAX_LENGTH` to `120`. Phase 4.4 found it on R11's
 * token charset rule. The remedy is the same: ONE place where the requirement's own value is written
 * down, which is what makes every relative assertion elsewhere load-bearing.
 *
 * ## What is pinned here, and why only these
 *
 * Only the OWNER-FACING values — the ones that encode a decision the owner made rather than an
 * implementation detail an author may reasonably tune:
 *
 *  - the weekly cap, because K4 says "a hard USD 5.00/week cap";
 *  - the allowed set and the premium set, because K4 says which two are on and which two are off;
 *  - the premium picks, because K4 admits a premium model only "for an ultra-complex task";
 *  - the governance ladder, because contract 11's thresholds are what "restrictive routing" means.
 *
 * Deliberately NOT pinned: `NOMINAL_TURN_USAGE` (a ranking aid, tuned from measurement, not a
 * decision) and the frozen price snapshot (owned by contract 09's pricing module, which pins itself).
 * Pinning those would convert every future recalibration into a test failure that says nothing.
 *
 * The cap is a POLICY figure in USD — the ceiling the owner set on provider spend — not an amount in
 * the owner's financial ledger, so no owner money appears here and `src/lib/money` is not imported.
 * It is not a deployment particular either: it is the published owner decision this build is
 * executing, already written in the steering file and in contract 11 (R24 forbids a real figure from
 * the owner's *finances*, which this is not).
 */
import { describe, expect, it } from 'vitest';

import {
  BUDGET_DISABLE_PREMIUM_FRACTION,
  BUDGET_RESTRICT_FRACTION,
  BUDGET_WARN_FRACTION,
  DEFAULT_ALLOWED,
  MODEL_GLM,
  MODEL_GROK,
  MODEL_KIMI,
  MODEL_MIMO,
  PREMIUM_MODELS,
  TIER_CAPABLE,
  TIER_PREMIUM_PICK,
  WEEKLY_BUDGET_USD,
  budgetPhase,
} from './modelPolicy';

describe('owner decision K4 is pinned to its own numbers, so a constant cannot silently redefine it', () => {
  it('holds the weekly cap at the five dollars K4 states', () => {
    // The one place this number is written down. Every other assertion about the cap in this
    // repository is relative to WEEKLY_BUDGET_USD and would survive a change to it.
    expect(WEEKLY_BUDGET_USD).toBe(5);
  });

  it('keeps the cap decision at the literal boundary, not merely at the constant', () => {
    // Asserted against the literal for the same reason: `budgetPhase(5)` must be exhausted whatever
    // the constant later says, because five is the owner's ceiling.
    expect(budgetPhase(5)).toBe('exhausted');
    expect(budgetPhase(5.01)).toBe('exhausted');
    expect(budgetPhase(4.99)).not.toBe('exhausted');
  });

  it('holds the default allowed set at exactly the two models K4 turned ON', () => {
    // K4: "Default allowed models are {xiaomi/mimo-v2.5, z-ai/glm-5.2}, choosing the cheapest
    // capable." Order matters only for legibility; membership is the decision.
    expect(DEFAULT_ALLOWED).toEqual(['xiaomi/mimo-v2.5', 'z-ai/glm-5.2']);
    // And the exported identities are the same strings, so a rename cannot split the vocabulary.
    expect(MODEL_MIMO).toBe('xiaomi/mimo-v2.5');
    expect(MODEL_GLM).toBe('z-ai/glm-5.2');
  });

  it('holds the premium set at exactly the two models K4 turned OFF', () => {
    // K4: "x-ai/grok-4.5 and moonshotai/kimi-k3 are OFF unless the owner explicitly opts in for an
    // ultra-complex task." Moving either into the allowed set would keep every relative assertion
    // in `modelRouter.negative.test.ts` green while inverting the decision.
    expect(PREMIUM_MODELS).toEqual(['x-ai/grok-4.5', 'moonshotai/kimi-k3']);
    expect(MODEL_GROK).toBe('x-ai/grok-4.5');
    expect(MODEL_KIMI).toBe('moonshotai/kimi-k3');
  });

  it('keeps the two sets disjoint, so no model is both on by default and premium-gated', () => {
    for (const premium of PREMIUM_MODELS) expect(DEFAULT_ALLOWED).not.toContain(premium);
    for (const allowed of DEFAULT_ALLOWED) expect(PREMIUM_MODELS).not.toContain(allowed);
    // Four distinct models, so the roster is the whole roster and nothing was dropped.
    expect(new Set([...DEFAULT_ALLOWED, ...PREMIUM_MODELS]).size).toBe(4);
  });

  it('states the tier roster exactly, so a capable set cannot change under a passing filter', () => {
    // `modelRouter.negative.test.ts` filters TIER_CAPABLE by DEFAULT_ALLOWED and asserts the result
    // is non-empty. That assertion holds for many rosters, including wrong ones. This is the roster.
    expect(TIER_CAPABLE).toEqual({
      T0: [],
      T1: ['xiaomi/mimo-v2.5', 'z-ai/glm-5.2'],
      T2: ['z-ai/glm-5.2', 'x-ai/grok-4.5', 'moonshotai/kimi-k3'],
      T3: ['z-ai/glm-5.2', 'x-ai/grok-4.5', 'moonshotai/kimi-k3'],
      T4: ['moonshotai/kimi-k3', 'z-ai/glm-5.2'],
    });
    // T0 is empty, which is R16 expressed in the roster: there is no model capable at T0 because
    // T0 calls none.
    expect(TIER_CAPABLE.T0).toEqual([]);
  });

  it('admits a premium pick only where contract 10 gives it a role, and nowhere else', () => {
    expect(TIER_PREMIUM_PICK).toEqual({
      T0: null,
      T1: null,
      T2: null,
      T3: 'x-ai/grok-4.5',
      T4: 'moonshotai/kimi-k3',
    });
    // Every non-null pick is a premium model, so the opt-in gate covers all of them.
    for (const pick of Object.values(TIER_PREMIUM_PICK)) {
      if (pick !== null) expect(PREMIUM_MODELS).toContain(pick);
    }
  });

  it('holds contract 11 governance ladder at its stated fractions, in strictly rising order', () => {
    expect(BUDGET_WARN_FRACTION).toBe(0.7);
    expect(BUDGET_RESTRICT_FRACTION).toBe(0.85);
    expect(BUDGET_DISABLE_PREMIUM_FRACTION).toBe(0.95);
    // A ladder that stopped rising would make a phase unreachable, and the phase that would go
    // missing first is the one that holds premium back.
    expect(BUDGET_WARN_FRACTION).toBeLessThan(BUDGET_RESTRICT_FRACTION);
    expect(BUDGET_RESTRICT_FRACTION).toBeLessThan(BUDGET_DISABLE_PREMIUM_FRACTION);
    expect(BUDGET_DISABLE_PREMIUM_FRACTION).toBeLessThan(1);
  });

  it('maps each ladder rung to its phase at the literal fraction of the literal cap', () => {
    // Pinned end to end: the fraction, the cap, and the phase the pair produces.
    expect(budgetPhase(0)).toBe('ok');
    expect(budgetPhase(0.7 * 5)).toBe('warn');
    expect(budgetPhase(0.85 * 5)).toBe('restrict');
    expect(budgetPhase(0.95 * 5)).toBe('critical');
  });
});
