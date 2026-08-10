// @vitest-environment node
/**
 * NIZAM · Invocation recording, including the empty-record case — contract 12 §6.1 (R16)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./invocationRecorder
 *
 * §6.1 spells out the acceptance shape: "the test asserts against a port mock that records
 * invocations, then asserts the record is empty." Two things have to be true for that to be
 * evidence rather than ceremony. The recorder must genuinely report emptiness when nothing
 * happened, and it must genuinely report a call when one did — a recorder that always answered
 * "empty" would pass every negative test in Phases 3/4/5 while proving nothing. Both directions
 * are asserted below.
 *
 * The `@ts-expect-error` cases are checked by `tsc`, not by the runner: each one fails the
 * typecheck if the forbidden shape ever becomes expressible.
 */
import { describe, expect, it } from 'vitest';

import { createInvocationRecorder } from './invocationRecorder.ts';

describe('the empty record is a real answer (§6.1, R16)', () => {
  it('reports emptiness for the whole log, for a port, and for a member', () => {
    const recorder = createInvocationRecorder();
    expect(recorder.isEmpty()).toBe(true);
    expect(recorder.isEmpty('openrouter')).toBe(true);
    expect(recorder.isEmpty('openrouter', 'complete')).toBe(true);
    expect(recorder.callsTo('openrouter', 'complete')).toEqual([]);
    expect(recorder.countOf('openrouter')).toBe(0);
    expect(recorder.all).toEqual([]);
  });

  it('stops reporting emptiness once a call is recorded, so the assertion above can fail', () => {
    const recorder = createInvocationRecorder();
    recorder.record('openrouter', 'complete', { tier: 'T1' });
    expect(recorder.isEmpty()).toBe(false);
    expect(recorder.isEmpty('openrouter')).toBe(false);
    expect(recorder.isEmpty('openrouter', 'complete')).toBe(false);
    // Narrowing is real: a different port and a different member are still empty.
    expect(recorder.isEmpty('drive')).toBe(true);
    expect(recorder.isEmpty('openrouter', 'somethingElse')).toBe(true);
  });
});

describe('the log is deterministic and ordered', () => {
  it('numbers calls from one, in order, with no clock field', () => {
    const recorder = createInvocationRecorder();
    expect(recorder.record('telegram', 'accept', { updateId: 1 })).toBe(1);
    expect(recorder.record('telegram', 'accept', { updateId: 2 })).toBe(2);
    expect(recorder.all).toEqual([
      { seq: 1, port: 'telegram', member: 'accept', detail: { updateId: 1 } },
      { seq: 2, port: 'telegram', member: 'accept', detail: { updateId: 2 } },
    ]);
  });

  it('gives two recorders driven by the same script identical logs', () => {
    const script = (recorder: ReturnType<typeof createInvocationRecorder>): void => {
      recorder.record('drive', 'uploadEncryptedSnapshot', { storeName: 'finance' });
      recorder.record('drive', 'verifyUploadedSnapshot', { remoteRef: 'snapshot:finance:1' });
      recorder.record('whoop', 'readRecoveryState');
    };
    const first = createInvocationRecorder();
    const second = createInvocationRecorder();
    script(first);
    script(second);
    expect(first.all).toEqual(second.all);
  });

  it('hands out a snapshot, so a caller cannot corrupt the log by mutating what it got', () => {
    const recorder = createInvocationRecorder();
    recorder.record('signalBus', 'publish', { signalId: 'sig-1' });
    const taken = recorder.all as unknown as { seq: number }[];
    taken.length = 0;
    expect(recorder.countOf('signalBus')).toBe(1);
  });

  it('restarts the sequence after a reset, so one recorder can serve several phases', () => {
    const recorder = createInvocationRecorder();
    recorder.record('telegram', 'accept');
    recorder.reset();
    expect(recorder.isEmpty()).toBe(true);
    expect(recorder.record('telegram', 'accept')).toBe(1);
  });

  it('defaults a missing detail to an empty bag rather than to undefined', () => {
    const recorder = createInvocationRecorder();
    recorder.record('whoop', 'readRecoveryState');
    expect(recorder.all[0]?.detail).toEqual({});
  });
});

describe('a content-bearing key is a compile error, not a review comment (§6.4, R19)', () => {
  it('accepts an ordinary redacted bag, so the negatives below are not vacuous', () => {
    const recorder = createInvocationRecorder();
    expect(recorder.record('openrouter', 'complete', { tier: 'T2', messageCount: 3 })).toBe(1);
  });

  it('refuses prompt, completion, content and messages as recorded detail', () => {
    const recorder = createInvocationRecorder();
    // @ts-expect-error a prompt is typed never, so it cannot be written down at all
    recorder.record('openrouter', 'complete', { prompt: 'the operator asked something' });
    // @ts-expect-error likewise a completion
    recorder.record('openrouter', 'complete', { completion: 'the model answered something' });
    // @ts-expect-error and the generic content key
    recorder.record('openrouter', 'complete', { content: 'anything' });
    // @ts-expect-error and the whole message list
    recorder.record('openrouter', 'complete', { messages: 'a joined transcript' });
    expect(recorder.countOf('openrouter', 'complete')).toBe(4);
  });

  it('refuses a nested object, so a whole request cannot be smuggled into one key', () => {
    const recorder = createInvocationRecorder();
    // @ts-expect-error detail holds scalars; a nested payload is not a scalar
    recorder.record('signalBus', 'publish', { payload: { level: 'red' } });
    expect(recorder.countOf('signalBus')).toBe(1);
  });
});
