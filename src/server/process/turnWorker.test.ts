// @vitest-environment node
/**
 * NIZAM · The slow side wired to turn dispatch — and the T0 branch that reaches no model
 * Implemented by: PFOS Contract 12 / Phase 10.7 (spec 06-two-agent-vps)
 * Owning requirements: R29 (the entrypoint wires `workerRunner` to `routing/turnDispatch`),
 *   R16 (a `T0` turn invokes no model), R15 (the slow side settles its own failures)
 * Depends on: ./turnWorker, ../routing/turnClassifier. The channel is a recorder, so "no model was
 *   invoked" is an observation about an empty record rather than a claim about a code path.
 */
import { describe, expect, it } from 'vitest';

import type { ModelRequest, ModelResult } from '../ports/openrouter.ts';
import type { TelegramWorkItem } from '../ports/telegram.ts';
import type { ModelChannel } from '../routing/turnDispatch.ts';
import { classifyTurn, type ModelInvocationGrant, type TurnFacts } from '../routing/turnClassifier.ts';
import { conservativeTurnFacts, CONSERVATIVE_INTENT, createTurnDispatchWorker, type TurnDispatchObservation } from './turnWorker.ts';

function item(queuedRef: string): TelegramWorkItem {
  return {
    queuedRef,
    botId: 'bot-b',
    updateId: 1,
    senderId: '101',
    rawBody: '{}',
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    attempt: 1,
  };
}

interface Recorder extends ModelChannel {
  readonly calls: readonly string[];
}

function recordingChannel(): Recorder {
  const calls: string[] = [];
  return {
    calls,
    invoke: async (grant: ModelInvocationGrant, request: ModelRequest): Promise<ModelResult> => {
      void grant;
      calls.push(request.correlationRef);
      throw new Error('the recorder never answers; reaching it is the failure under test');
    },
  };
}

describe('the conservative facts reader classifies T0, so no model can be invoked (R16)', () => {
  it('classifies deterministically by the deterministic-intent rule', () => {
    const classification = classifyTurn(conservativeTurnFacts(), 'turn-1');
    expect(classification.tier).toBe('T0');
    expect(classification.rule).toBe('deterministic_intent');
    expect(CONSERVATIVE_INTENT).toBe('validate_schema');
  });

  it('dispatches a queued item down the deterministic route and never touches the channel', async () => {
    const channel = recordingChannel();
    const observed: TurnDispatchObservation[] = [];
    const worker = createTurnDispatchWorker({
      dispatch: {
        channel,
        executeDeterministically: (_facts, turnRef) => `answered-${turnRef}`,
        planModelRequest: () => {
          throw new Error('a T0 turn must never reach the planner');
        },
      },
      readTurnFacts: () => conservativeTurnFacts(),
      onDispatch: (observation) => observed.push(observation),
    });

    const outcome = await worker.process(item('q-1'));

    expect(outcome).toEqual({ outcome: 'done' });
    expect(channel.calls).toEqual([]);
    expect(observed).toEqual([{ queuedRef: 'q-1', route: 'code_only', tier: 'T0', rule: 'deterministic_intent' }]);
  });
});

describe('a model-bearing turn goes through the channel, and its refusal stays a queue failure', () => {
  const conversational: TurnFacts = { ...conservativeTurnFacts(), intent: 'explain_safe_to_spend' };

  it('reaches the planner and the channel for a non-T0 turn', async () => {
    const channel = recordingChannel();
    const worker = createTurnDispatchWorker({
      dispatch: {
        channel,
        executeDeterministically: () => {
          throw new Error('a model-bearing turn must not take the deterministic route');
        },
        planModelRequest: (grant) =>
          ({ tier: grant.tier, correlationRef: grant.turnRef, modelId: 'm', privacyPolicyRef: 'p' }) as unknown as ModelRequest,
      },
      readTurnFacts: () => conversational,
    });

    // The channel refuses, and the refusal propagates untouched: `workerRunner` is what turns it into
    // a retry with backoff or an abandonment, and this module does not duplicate that decision.
    await expect(worker.process(item('q-2'))).rejects.toThrow();
    expect(channel.calls).toEqual(['q-2']);
  });
});
