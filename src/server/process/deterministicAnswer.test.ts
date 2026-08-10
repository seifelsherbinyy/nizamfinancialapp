// @vitest-environment node
/**
 * NIZAM · The deterministic reply is a sentence, and it carries no figure
 * Implemented by: PFOS Contract 12 / Phase 2, task **B7**, seam **S6** (spec 07-bot-bringup-v1)
 * Owning requirements: R16 (the `T0` route reaches no model), R24 (no deployment particular, no
 *   real amount), contract 12 §6 (no figure is sourced outside the deterministic engines, and the
 *   engines are not wired to chat in v1.0)
 * Depends on: ./deterministicAnswer, ./turnIntake (the real extraction step), ../routing/turnDispatch,
 *   ../routing/turnClassifier, ../ports/telegram (types). No network, no store, no clock.
 */
import { describe, expect, it } from 'vitest';

import type { TelegramWorkItem } from '../ports/telegram.ts';
import { INTENT_FAMILY, TURN_INTENTS, type TurnIntent } from '../routing/turnClassifier.ts';
import { createModelChannel, dispatchTurn } from '../routing/turnDispatch.ts';
import {
  ANSWERED_INTENTS,
  answerDeterministically,
  DETERMINISTIC_ANSWERS,
  NO_FIGURE_PATTERN,
  OUT_OF_FAMILY_ANSWER,
} from './deterministicAnswer.ts';
import { NO_ENGINE_VERDICTS, readInboundTurn, refuseUnplannedTurn } from './turnIntake.ts';

function factsFor(intent: TurnIntent) {
  return { ...NO_ENGINE_VERDICTS, intent, missingInformation: false, toolRequirement: false };
}

function workItem(text: string): TelegramWorkItem {
  return {
    queuedRef: 'turn-ref-b7',
    botId: 'bot-under-test',
    updateId: 1,
    senderId: 'sender-under-test',
    rawBody: JSON.stringify({ update_id: 1, message: { text } }),
    enqueuedAt: '2026-08-11T00:00:00.000Z',
    attempt: 1,
  };
}

describe('the answered intent set is named, listed and exactly the deterministic family', () => {
  it('lists the six intents the classifier routes T0, and nothing else', () => {
    expect([...ANSWERED_INTENTS]).toEqual(TURN_INTENTS.filter((intent) => INTENT_FAMILY[intent] === 'deterministic'));
    expect(ANSWERED_INTENTS).toHaveLength(6);
  });

  it('gives every intent in the union a sentence, so an unlisted intent cannot fall through', () => {
    for (const intent of TURN_INTENTS) {
      expect(typeof DETERMINISTIC_ANSWERS[intent]).toBe('string');
      expect(DETERMINISTIC_ANSWERS[intent].length).toBeGreaterThan(40);
    }
  });

  it('answers every non-deterministic intent with the out-of-family sentence', () => {
    for (const intent of TURN_INTENTS) {
      if (INTENT_FAMILY[intent] === 'deterministic') continue;
      expect(DETERMINISTIC_ANSWERS[intent]).toBe(OUT_OF_FAMILY_ANSWER);
    }
  });
});

describe('the reply is a human sentence, never an identifier and never a figure', () => {
  it('is a sentence rather than the turn reference', () => {
    const answer = answerDeterministically(factsFor('recalculate_balances'), 'turn-ref-b7');
    expect(answer).not.toBe('turn-ref-b7');
    expect(answer).not.toContain('turn-ref-b7');
    expect(answer.endsWith('.')).toBe(true);
  });

  it('holds no digit anywhere in any sentence (§6: this tier sources no monetary number)', () => {
    for (const intent of TURN_INTENTS) {
      expect(DETERMINISTIC_ANSWERS[intent]).not.toMatch(NO_FIGURE_PATTERN);
    }
  });

  it('is deterministic: the same facts always give the same sentence', () => {
    const first = answerDeterministically(factsFor('compute_safe_to_spend'), 'a');
    const second = answerDeterministically(factsFor('compute_safe_to_spend'), 'b');
    expect(first).toBe(second);
  });

  it('answers an unreadable turn by saying so, rather than by guessing an operation', () => {
    const turn = readInboundTurn(workItem('/notacommand'));
    expect(turn.facts.intent).toBe('validate_schema');
    expect(answerDeterministically(turn.facts, turn.turnRef)).toContain('could not read that');
  });
});

describe('the route that produces it still reaches no model (R16)', () => {
  it('answers a real T0 turn through dispatchTurn without touching the port', async () => {
    let invocations = 0;
    const outcome = await dispatchTurn(
      {
        channel: createModelChannel({
          async complete() {
            invocations += 1;
            throw new Error('the port must not be reached on the deterministic route');
          },
        }),
        executeDeterministically: answerDeterministically,
        planModelRequest: refuseUnplannedTurn,
      },
      readInboundTurn(workItem('/balances')).facts,
      'turn-ref-b7',
    );

    expect(outcome.route).toBe('code_only');
    if (outcome.route !== 'code_only') throw new Error('expected the deterministic route');
    expect(outcome.answer).toBe(DETERMINISTIC_ANSWERS.recalculate_balances);
    expect(invocations).toBe(0);
  });
});
