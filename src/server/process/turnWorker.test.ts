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
import type { TelegramWorkerPort, TelegramWorkItem } from '../ports/telegram.ts';
import type { ModelChannel } from '../routing/turnDispatch.ts';
import { classifyTurn, type ModelInvocationGrant, type TurnFacts } from '../routing/turnClassifier.ts';
import {
  conservativeTurnFacts,
  CONSERVATIVE_INTENT,
  createBindableReplySender,
  createTurnDispatchWorker,
  TURN_ROUTING_UNAVAILABLE_REPLY,
  type TurnDispatchObservation,
  type TurnReply,
} from './turnWorker.ts';

function item(queuedRef: string, attempt = 1): TelegramWorkItem {
  return {
    queuedRef,
    botId: 'bot-b',
    updateId: 1,
    senderId: '101',
    rawBody: '{}',
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    attempt,
  };
}

/** The conversation this synthetic turn arrived on. Opaque, and not a real identifier (R24). */
const TARGET = { chatRef: 'conversation-a' } as const;

/** A recorder in place of the outbound port, so "the answer was sent" is an observation. */
function recordingSender(): { readonly sent: TurnReply[]; readonly send: (reply: TurnReply) => Promise<void> } {
  const sent: TurnReply[] = [];
  return {
    sent,
    send: async (reply: TurnReply): Promise<void> => {
      sent.push(reply);
    },
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

  it('sends the composed answer to the originating conversation and never touches the channel', async () => {
    const channel = recordingChannel();
    const replies = recordingSender();
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
      readReplyTarget: () => TARGET,
      renderAnswer: (answer: string) => answer,
      sendReply: replies.send,
      onDispatch: (observation) => observed.push(observation),
    });

    const outcome = await worker.process(item('q-1'));

    // `done` is now the report of a DELIVERED reply. Until task A-G4 the answer below was computed
    // and dropped, and this assertion was `done` with nothing sent.
    expect(outcome).toEqual({ outcome: 'done' });
    expect(replies.sent).toEqual([{ queuedRef: 'q-1', target: TARGET, text: 'answered-q-1' }]);
    expect(channel.calls).toEqual([]);
    expect(observed).toEqual([{ queuedRef: 'q-1', route: 'code_only', tier: 'T0', rule: 'deterministic_intent' }]);
  });

  it('abandons a turn whose update names no conversation rather than reporting it delivered', async () => {
    const replies = recordingSender();
    const worker = createTurnDispatchWorker({
      dispatch: {
        channel: recordingChannel(),
        executeDeterministically: () => 'an answer with nowhere to go',
        planModelRequest: () => {
          throw new Error('a T0 turn must never reach the planner');
        },
      },
      readTurnFacts: () => conservativeTurnFacts(),
      readReplyTarget: () => null,
      renderAnswer: (answer: string) => answer,
      sendReply: replies.send,
    });

    expect(await worker.process(item('q-3'))).toEqual({ outcome: 'abandoned', code: 'TELEGRAM_SEND_REFUSED' });
    expect(replies.sent).toEqual([]);
  });

  it('propagates a refused send, so an undelivered answer is never settled as done', async () => {
    const worker = createTurnDispatchWorker({
      dispatch: {
        channel: recordingChannel(),
        executeDeterministically: () => 'an answer the provider refused',
        planModelRequest: () => {
          throw new Error('a T0 turn must never reach the planner');
        },
      },
      readTurnFacts: () => conservativeTurnFacts(),
      readReplyTarget: () => TARGET,
      renderAnswer: (answer: string) => answer,
      sendReply: async () => {
        throw Object.assign(new Error('the provider refused'), { code: 'TELEGRAM_SEND_REFUSED' });
      },
    });

    // The runner turns this into a retry with backoff or an abandonment. This module adds no loop.
    await expect(worker.process(item('q-4'))).rejects.toThrow('the provider refused');
  });
});

describe('an unbound reply sender refuses rather than discarding the answer', () => {
  it('throws until the transport binds it, and delivers afterwards', async () => {
    const replies = createBindableReplySender();
    const reply: TurnReply = { queuedRef: 'q-5', target: TARGET, text: 'a sentence' };

    await expect(replies.send(reply)).rejects.toThrow(/nowhere to go/);

    const recorder = recordingSender();
    replies.bind(recorder.send);
    await replies.send(reply);
    expect(recorder.sent).toEqual([reply]);
  });
});

describe('a model-bearing turn goes through the channel, and its refusal stays a queue failure', () => {
  const conversational: TurnFacts = { ...conservativeTurnFacts(), intent: 'explain_safe_to_spend' };

  function modelBearingWorker(sendReply: (reply: TurnReply) => Promise<void>, channel: Recorder): TelegramWorkerPort {
    return createTurnDispatchWorker({
      dispatch: {
        channel,
        executeDeterministically: () => {
          throw new Error('a model-bearing turn must not take the deterministic route');
        },
        planModelRequest: (grant) =>
          ({ tier: grant.tier, correlationRef: grant.turnRef, modelId: 'm', privacyPolicyRef: 'p' }) as unknown as ModelRequest,
      },
      readTurnFacts: () => conversational,
      readReplyTarget: () => TARGET,
      renderAnswer: (answer: string) => answer,
      sendReply,
    });
  }

  it('reaches the planner and the channel for a non-T0 turn', async () => {
    const channel = recordingChannel();
    const worker = modelBearingWorker(recordingSender().send, channel);

    // The channel refuses, and the refusal propagates untouched: `workerRunner` is what turns it into
    // a retry with backoff or an abandonment, and this module does not duplicate that decision.
    await expect(worker.process(item('q-2'))).rejects.toThrow();
    expect(channel.calls).toEqual(['q-2']);
  });

  it('tells the owner routing was unavailable, once, and still records the failure (A-G4)', async () => {
    const replies = recordingSender();
    const worker = modelBearingWorker(replies.send, recordingChannel());

    await expect(worker.process(item('q-6'))).rejects.toThrow();
    expect(replies.sent).toEqual([{ queuedRef: 'q-6', target: TARGET, text: TURN_ROUTING_UNAVAILABLE_REPLY }]);
    // A refusal names the fact and guesses no figure: the model tier never sources a monetary number,
    // and a refusal composed on this path must not invent one either (contract 12 §6).
    expect(TURN_ROUTING_UNAVAILABLE_REPLY).not.toMatch(/\d/);

    // Spoken on the first attempt only: the runner's bounded retry is a schedule, not a reason to
    // repeat the same refusal to the owner on every pass.
    await expect(worker.process(item('q-6', 2))).rejects.toThrow();
    expect(replies.sent).toHaveLength(1);
  });
});
