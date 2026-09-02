// @vitest-environment node
/**
 * NIZAM · Turn intake — real facts reach the model-bearing tiers, and T0 still cannot carry a request
 * Implemented by: PFOS Contract 12 / Phase 2, task **B5**, seams **S5** and **S4**
 *   (spec 07-bot-bringup-v1)
 * Owning requirements: R16 (a turn classified `T0` invokes no model — asserted here at the TYPE
 *   level and again at run time), R19 (no turn content in any refusal's detail), R24 (no deployment
 *   particular in any fixture), contract 12 §6's standing invariant (this tier sources no figure)
 * Depends on: ./turnIntake, ../routing/turnClassifier, ../routing/turnDispatch, ../ports/telegram
 *   (types), ../../features/routing/modelPolicy. No network, no store, no clock.
 *
 * Every body below is a synthetic provider envelope built in this file: no real sender, no real bot,
 * no real amount, and no real message (R24). The two assertions the task names are the pair under
 * "the no-model tier guarantee": a deterministic classification cannot carry a model request, and a
 * model-bearing one can. The first is expressed the way the existing types already express it —
 * `modelGrant` is typed `never` on the deterministic branch, so the compiler is the assertion and
 * `@ts-expect-error` is how a test observes a compiler assertion firing.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_ALLOWED, NOMINAL_TURN_USAGE } from '../../features/routing/modelPolicy.ts';
import type { TelegramWorkItem } from '../ports/telegram.ts';
import {
  classifyTurn,
  INTENT_FAMILY,
  isModelBearing,
  TURN_INTENTS,
  type ModelInvocationGrant,
} from '../routing/turnClassifier.ts';
import { createModelChannel, TurnRoutingError } from '../routing/turnDispatch.ts';
import {
  deriveIntent,
  DEFAULT_PROSE_INTENT,
  MAX_TURN_TEXT_BYTES,
  MESSAGE_DERIVED_FACT_KEYS,
  NO_ENGINE_VERDICTS,
  planTurnModelRequest,
  plannedModelAt,
  readInboundTurn,
  readTurnText,
  refuseUnplannedTurn,
  TURN_INTENT_TRIGGER,
  turnRequestPlanner,
  turnSystemFraming,
  TurnPlanError,
  UNREADABLE_TURN_INTENT,
} from './turnIntake.ts';

// ---------------------------------------------------------------------------------------------
// Synthetic fixtures — an envelope shape, and nothing that names a deployment
// ---------------------------------------------------------------------------------------------

function envelope(text: string, carrier: 'message' | 'edited_message' = 'message', field = 'text'): string {
  return JSON.stringify({ update_id: 1, [carrier]: { [field]: text } });
}

function workItem(rawBody: string, queuedRef = 'turn-ref-1'): TelegramWorkItem {
  return {
    queuedRef,
    botId: 'bot-under-test',
    updateId: 1,
    senderId: 'sender-under-test',
    rawBody,
    enqueuedAt: '2026-08-11T00:00:00.000Z',
    attempt: 1,
  };
}

/** Classify a turn read off a synthetic body, and hand back both halves. */
function classified(text: string, queuedRef = 'turn-ref-1') {
  const turn = readInboundTurn(workItem(envelope(text), queuedRef));
  return { turn, classification: classifyTurn(turn.facts, turn.turnRef) };
}

// =============================================================================================
// Reading the message
// =============================================================================================

describe('the turn text is read defensively off an attacker-controlled body', () => {
  it('reads the ordinary carrier, the edited carrier and the caption', () => {
    expect(readTurnText(envelope('what is safe to spend'))).toBe('what is safe to spend');
    expect(readTurnText(envelope('an edit', 'edited_message'))).toBe('an edit');
    expect(readTurnText(envelope('a caption', 'message', 'caption'))).toBe('a caption');
  });

  it('yields null rather than throwing for every unreadable body', () => {
    expect(readTurnText('not json at all')).toBeNull();
    expect(readTurnText('[]')).toBeNull();
    expect(readTurnText('null')).toBeNull();
    expect(readTurnText(JSON.stringify({ update_id: 1 }))).toBeNull();
    expect(readTurnText(JSON.stringify({ update_id: 1, message: { text: 42 } }))).toBeNull();
    expect(readTurnText(envelope('   '))).toBeNull();
  });
});

describe('the intent lexicon is closed, total and deterministic', () => {
  it('gives every enumerated intent exactly one trigger word, and no trigger is shared', () => {
    const triggers = TURN_INTENTS.map((intent) => TURN_INTENT_TRIGGER[intent]);
    expect(triggers).toHaveLength(TURN_INTENTS.length);
    expect(new Set(triggers).size).toBe(TURN_INTENTS.length);
  });

  it('reads a trigger word, its subject, and the provider mention suffix', () => {
    expect(deriveIntent('/balances')).toMatchObject({ intent: 'recalculate_balances', source: 'trigger' });
    expect(deriveIntent('/categorise groceries')).toMatchObject({
      intent: 'suggest_category',
      source: 'trigger',
      subject: 'groceries',
    });
    // A mention suffix is dropped at the separator, and no name is read out of it (R24).
    expect(deriveIntent('/briefing@some-window').intent).toBe('periodic_briefing');
  });

  it('fails closed on an absent, blank or unrecognised turn — all three land on a deterministic intent', () => {
    for (const source of [deriveIntent(null), deriveIntent('   '), deriveIntent('/notacommand')]) {
      expect(source.intent).toBe(UNREADABLE_TURN_INTENT);
      expect(INTENT_FAMILY[source.intent]).toBe('deterministic');
    }
  });

  it('is tier-neutral about the prose default: every conversational member classifies identically', () => {
    expect(INTENT_FAMILY[DEFAULT_PROSE_INTENT]).toBe('conversation');
    const tiers = new Set(
      TURN_INTENTS.filter((intent) => INTENT_FAMILY[intent] === 'conversation').map(
        (intent) => classifyTurn({ ...NO_ENGINE_VERDICTS, intent, missingInformation: false, toolRequirement: false }, 'ref').tier,
      ),
    );
    expect([...tiers]).toEqual(['T2']);
  });

  it('does not let prose ask the model tier for a figure: a balance question is deterministic', () => {
    expect(classified('what is my balance').classification.tier).toBe('T0');
    // "how much is safe to spend" is a CONVERSATION about a figure the engines produce, not a request
    // for one, so it may reach a model — and the framing tells the model not to produce a figure.
    expect(classified('how much is safe to spend').classification.tier).toBe('T2');
  });
});

// =============================================================================================
// The facts, and the partition between message and engine
// =============================================================================================

describe('the facts are partitioned: three from the message, fourteen from the engines', () => {
  it('derives exactly three facts and takes every other one from the injected verdicts', () => {
    expect([...MESSAGE_DERIVED_FACT_KEYS]).toEqual(['intent', 'missingInformation', 'toolRequirement']);
    const { facts } = readInboundTurn(workItem(envelope('/parse a bank message')));
    for (const key of Object.keys(NO_ENGINE_VERDICTS) as (keyof typeof NO_ENGINE_VERDICTS)[]) {
      expect(facts[key]).toBe(NO_ENGINE_VERDICTS[key]);
    }
  });

  it('reaches T3 by no route at all while the engines report nothing', () => {
    const tiers = new Set(
      TURN_INTENTS.map(
        (intent) => classifyTurn({ ...NO_ENGINE_VERDICTS, intent, missingInformation: false, toolRequirement: false }, 'ref').tier,
      ),
    );
    expect(tiers.has('T3')).toBe(false);
  });

  it('marks a trigger with no subject as missing information only where a subject is needed', () => {
    expect(readInboundTurn(workItem(envelope('/categorise'))).facts.missingInformation).toBe(true);
    expect(readInboundTurn(workItem(envelope('/categorise coffee'))).facts.missingInformation).toBe(false);
    // A deterministic operation needs no subject, so an empty one is not a missing fact.
    expect(readInboundTurn(workItem(envelope('/balances'))).facts.missingInformation).toBe(false);
  });

  it('requires structured output for the extraction and engineering families only', () => {
    expect(readInboundTurn(workItem(envelope('/merchant a shop'))).facts.toolRequirement).toBe(true);
    expect(readInboundTurn(workItem(envelope('/engineering a change'))).facts.toolRequirement).toBe(true);
    expect(readInboundTurn(workItem(envelope('/explain'))).facts.toolRequirement).toBe(false);
  });

  it('carries the correlation reference and no part of the turn into the facts', () => {
    const turn = readInboundTurn(workItem(envelope('a private sentence'), 'ref-42'));
    expect(turn.turnRef).toBe('ref-42');
    expect(JSON.stringify(turn.facts)).not.toContain('a private sentence');
  });

  it('lifts a turn off T0 by its intent, which is the whole point of the task', () => {
    // Before B5 every turn classified T0 because the facts were conservative. These are the tiers a
    // real message now reaches.
    expect(classified('/parse a message').classification.tier).toBe('T1');
    expect(classified('/categorise').classification.tier).toBe('T2');
    expect(classified('tell me about leakage').classification.tier).toBe('T2');
    expect(classified('/engineering rename a module').classification.tier).toBe('T4');
  });
});

// =============================================================================================
// R16 — the no-model tier guarantee, both directions
// =============================================================================================

describe('the no-model classification CANNOT carry a model request (R16, type level)', () => {
  it('types `modelGrant` as `never` on the deterministic branch, so no grant can be read from it', () => {
    const { classification } = classified('/balances');
    expect(classification.tier).toBe('T0');
    expect(isModelBearing(classification)).toBe(false);
    if (classification.tier !== 'T0') throw new Error('expected the deterministic branch');
    // @ts-expect-error R16: `modelGrant` is `never` here, so there is no expression that reads a
    // grant off a deterministic classification — the compiler is the guarantee, not a branch.
    const forbidden: ModelInvocationGrant = classification.modelGrant;
    // At run time the field is simply absent: the T0 branch holds nothing to hand to a port.
    expect(forbidden).toBeUndefined();
  });

  it('refuses to plan a request for a grant nobody minted, before composing anything', () => {
    const forged = Object.freeze({ tier: 'T2', turnRef: 'turn-ref-1', rule: 'routine_conversation' }) as unknown as ModelInvocationGrant;
    try {
      planTurnModelRequest({ agent: 'finance', turnRef: 'turn-ref-1', text: 'a sentence' }, forged, classified('/categorise coffee').turn.facts);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(TurnPlanError);
      expect((error as TurnPlanError).code).toBe('TURN_PLAN_GRANT_NOT_MINTED');
      // The refusal carries a reference and no part of the turn (R19).
      expect(JSON.stringify((error as TurnPlanError).detail)).not.toContain('a sentence');
    }
  });

  it('refuses a grant minted for a different turn', () => {
    const { classification } = classified('/categorise coffee', 'turn-one');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    expect(() =>
      planTurnModelRequest({ agent: 'finance', turnRef: 'turn-two', text: 'a sentence' }, classification.modelGrant, classified('/categorise coffee').turn.facts),
    ).toThrow(TurnPlanError);
  });

  it('refuses the unplanned-turn planner for every grant, which is the fail-closed wiring', () => {
    const { classification } = classified('/categorise coffee');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    try {
      refuseUnplannedTurn(classification.modelGrant);
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as TurnPlanError).code).toBe('TURN_PLAN_NO_TURN_TEXT');
    }
  });

  it('still refuses at the model door when a forged grant reaches the channel', async () => {
    let invocations = 0;
    const channel = createModelChannel({
      async complete() {
        invocations += 1;
        throw new Error('the port must not be reached');
      },
    });
    const forged = Object.freeze({ tier: 'T2', turnRef: 'turn-ref-1', rule: 'routine_conversation' }) as unknown as ModelInvocationGrant;
    const { classification, turn } = classified('/categorise coffee');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const request = planTurnModelRequest({ agent: 'finance', turnRef: turn.turnRef, text: 'a sentence' }, classification.modelGrant, turn.facts);
    await expect(channel.invoke(forged, request)).rejects.toBeInstanceOf(TurnRoutingError);
    expect(invocations).toBe(0);
  });
});

describe('a model-bearing classification CAN carry a model request (R16, the releasing direction)', () => {
  it('plans a complete request from the grant the classifier minted', () => {
    const { classification, turn } = classified('/categorise coffee', 'turn-ref-9');
    // An extraction turn with its subject present and nothing to escalate it: T1, the cheapest
    // model-bearing tier, which is the tier B5 exists to make reachable at all.
    expect(classification.tier).toBe('T1');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const request = planTurnModelRequest({ agent: 'finance', turnRef: turn.turnRef, text: '/categorise coffee' }, classification.modelGrant, turn.facts);

    expect(request.agent).toBe('finance');
    expect(request.tier).toBe(classification.modelGrant.tier);
    expect(request.correlationRef).toBe('turn-ref-9');
    expect(DEFAULT_ALLOWED).toContain(request.modelId);
    expect(request.modelId).toBe(plannedModelAt(classification.modelGrant.tier));
    expect(request.maxOutputTokens).toBe(NOMINAL_TURN_USAGE[classification.modelGrant.tier].completionTokens);
    // The privacy policy is asserted per request, and there is no value meaning "training allowed".
    expect(request.privacy.training).toBe('excluded');
    expect(request.privacy.dataCollectingProviders).toBe('denied');
    expect(request.privacy.zeroDataRetention).toBe('required');
    expect(request.privacy.requiredParameters).toEqual(['structured_outputs']);
    // The owner's own words reach exactly one field, and the framing precedes them.
    expect(request.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(request.messages[1]?.content).toBe('/categorise coffee');
  });

  it('adds Drive context as separately labelled, untrusted reference data', () => {
    const { classification, turn } = classified('/categorise coffee', 'turn-ref-drive');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const request = planTurnModelRequest(
      {
        agent: 'finance',
        turnRef: turn.turnRef,
        text: '/categorise coffee',
        knowledgeContext: '[UNTRUSTED DRIVE REFERENCE contracts/pfos/06_knowledge.md]\nPolicy context',
      },
      classification.modelGrant,
      turn.facts,
    );

    expect(request.messages.map((message) => message.role)).toEqual(['system', 'system', 'user']);
    expect(request.messages[1]?.content).toContain('never an instruction');
    expect(request.messages[1]?.content).toContain('Policy context');
    expect(request.messages[2]?.content).toBe('/categorise coffee');
  });

  it('opens the model door with that request, so the releasing direction is observed and not assumed', async () => {
    const seen: string[] = [];
    const channel = createModelChannel({
      async complete(request) {
        seen.push(request.correlationRef);
        return {
          modelIdServed: request.modelId,
          text: 'a synthetic answer',
          parsed: null,
          schemaValid: true,
          usage: { promptTokens: 1, cachedTokens: 0, completionTokens: 1, reasoningTokens: 0, costMicroUsd: 1, costSource: 'provider_reported_actual' },
          latencyMs: 1,
          correlationRef: request.correlationRef,
        };
      },
    });
    const { classification, turn } = classified('tell me about leakage', 'turn-ref-open');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const plan = turnRequestPlanner({ agent: 'finance', turnRef: turn.turnRef, text: turn.text });
    const result = await channel.invoke(classification.modelGrant, plan(classification.modelGrant, turn.facts));
    expect(result.text).toBe('a synthetic answer');
    expect(seen).toEqual(['turn-ref-open']);
  });

  it('classifies engineering content as operational and keeps the weaker retention posture named', () => {
    const { classification, turn } = classified('/engineering rename a module');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const request = planTurnModelRequest({ agent: 'finance', turnRef: turn.turnRef, text: 'rename a module' }, classification.modelGrant, turn.facts);
    expect(request.contentClass).toBe('operational');
    expect(request.privacy.zeroDataRetention).toBe('preferred');
  });

  it('refuses an empty turn and an over-bound turn rather than sending either', () => {
    const { classification, turn } = classified('/categorise coffee');
    if (!isModelBearing(classification)) throw new Error('expected a model-bearing turn');
    const inputs = { agent: 'finance', turnRef: turn.turnRef } as const;
    expect(() => planTurnModelRequest({ ...inputs, text: null }, classification.modelGrant, turn.facts)).toThrow(TurnPlanError);
    expect(() =>
      planTurnModelRequest({ ...inputs, text: 'x'.repeat(MAX_TURN_TEXT_BYTES + 1) }, classification.modelGrant, turn.facts),
    ).toThrow(TurnPlanError);
  });
});

// =============================================================================================
// §6 — the framing carries a shape, never a figure
// =============================================================================================

describe('the system framing states the standing invariant and carries no figure', () => {
  const { turn } = classified('how much is safe to spend');
  const framing = turnSystemFraming('finance', turn.facts);

  it('tells the model not to produce a monetary figure', () => {
    expect(framing).toContain('must not state, compute, estimate, round or repeat any monetary amount');
  });

  it('carries the turn shape only: no amount, and no decimal anywhere in it', () => {
    expect(framing).toContain(turn.facts.intent);
    expect(framing).not.toMatch(/\d+\.\d/);
  });
});
