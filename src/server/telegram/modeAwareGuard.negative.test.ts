// @vitest-environment node
/**
 * NIZAM · Both directions of the mode-aware guard — ladder rung L1 (R26, R26.1)
 * Implemented by: PFOS Contract 12 / Phase 10.6 (spec 06-two-agent-vps)
 * Owning requirements: R26 (the mode selects which gates apply, and `webhook` is not relaxed),
 *   R26.1 (dedup in both modes; the offset advances only after the enqueue commits),
 *   with R11, R12, R13, R14 held to unchanged
 * Depends on: ./auth, ./acceptHandler, ./liveTransport, ./workQueueRepo, ../db/store
 *
 * Design's testing strategy, restated because this file is the place it bites: *a test that has
 * only ever been observed passing is not evidence. Each negative test must be shown failing the
 * guarded operation, not merely returning a value.* So every case below is asserted against the
 * **guarded operation** - the accept path and the poll loop, over a real store - and every refusal
 * is checked to have written **nothing**: no dedup claim, no queue row. A decision object with the
 * right shape and a row in the table behind it would be a pass and a breach at once.
 *
 * D6 adds four cases and this file carries all four:
 *
 *  1. **Both directions of the mode axis.** `longPoll` refuses an unlisted sender; `longPoll`
 *     accepts the owner **with no secret-token header at all**; an empty allowlist under `longPoll`
 *     refuses everyone, the otherwise-authorised sender included.
 *  2. **The regression fence.** `webhook` still refuses an **absent**, an **empty**, an
 *     **over-length** and an **out-of-charset** expected token. These four are the whole reason the
 *     fence exists: if the mode axis had been landed by relaxing the webhook path so one branch
 *     could serve both modes, these are the tests that would go green while the door opened.
 *  3. **The same update twice produces one effect in both modes**, and in `longPoll` a crash before
 *     the enqueue commits **re-delivers** rather than loses - asserted against the **offset**, not
 *     against a sleep.
 *  4. **The refusal is indistinguishable as to stage in both modes**, because the decision type has
 *     nowhere to put a reason and every refusal returns the one frozen value.
 *
 * Every value here is synthetic and deliberately short (R24, steering §0b): no real token, sender,
 * bot, host, path, identifier or figure appears, and no secret value is invented - the tokens are
 * shaped from the provider's own documented charset so the configuration gate is exercised against
 * realistic shapes rather than convenient ones.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openFinanceStore } from '../db/store';
import {
  TELEGRAM_TRANSPORT_MODES,
  type TelegramAcceptDecision,
  type TelegramDelivery,
  type TelegramTransportConfig,
  type TelegramTransportMode,
  type TelegramWorkItem,
  type TelegramWorkerPort,
  type TelegramWorkOutcome,
} from '../ports/telegram';
import {
  applicableAuthStages,
  authorizeDelivery,
  TELEGRAM_AUTH_REFUSED,
  TELEGRAM_AUTH_STAGES,
  TELEGRAM_MODE_APPLICABLE_GATES,
  type TelegramAuthAuditLine,
  type TelegramAuthPolicy,
  type TelegramAuthSubject,
} from './auth';
import {
  acceptDelivery,
  TELEGRAM_ACCEPT_REJECTED,
  type TelegramAcceptAuditLine,
  type TelegramAcceptContext,
} from './acceptHandler';
import { createLiveTelegramTransport, type TelegramFetchRequest, type TelegramUpdateBatch } from './liveTransport';
import { workQueueDepth } from './workQueueRepo';

const BOT = 'bot-one';
const OWNER = 'op-1';
const OUTSIDER = 'op-9';
const TOKEN = 'tok-test-1';
const WRONG_TOKEN = 'tok-test-2';
const BODY = '{"t":"hello"}';

/**
 * The expected-token shapes R11 fails closed on: the four the mandate names, plus `null`, because
 * the loader's own type admits it and a shape the type admits must be refused rather than assumed
 * unreachable. Named pairs, so the fence reads as a list of facts rather than a loop over values.
 */
const UNUSABLE_EXPECTED_TOKENS: [string, string | null | undefined][] = [
  ['absent', undefined],
  ['null', null],
  ['empty', ''],
  ['over-length', 'a'.repeat(257)],
  ['out-of-charset', 'tok test.1'],
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

function transportOf(overrides: Partial<TelegramTransportConfig> = {}): TelegramTransportConfig {
  return {
    botId: BOT,
    expectedSecretToken: TOKEN,
    allowedSenderIds: [OWNER],
    apiBaseUrlRef: '<MSG_API_BASE>',
    mode: 'webhook',
    maxConcurrentWorkItems: 2,
    ...overrides,
  };
}

/**
 * A delivery as each mode presents it. Under `longPoll` the header is **absent** - `null` - because
 * an outbound read has no header, which is the whole premise of R26.
 */
function deliveryOf(mode: TelegramTransportMode, overrides: Partial<TelegramDelivery> = {}): TelegramDelivery {
  return {
    botId: BOT,
    updateId: 71,
    senderId: OWNER,
    secretTokenHeader: mode === 'webhook' ? TOKEN : null,
    receivedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    rawBody: BODY,
    ...overrides,
  };
}

interface Harness {
  readonly ctx: TelegramAcceptContext;
  readonly audit: readonly TelegramAcceptAuditLine[];
  /** Row counts per state, read from the engine — the guarded operation's own record. */
  depth(): Readonly<Record<'queued' | 'running' | 'done' | 'failed', number>>;
  /** Whether the dedup table claimed this pair. A refusal must claim nothing. */
  claimed(updateId: number): boolean;
}

function openHarness(transport: TelegramTransportConfig = transportOf(), newId?: () => string): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-mode-'));
  const now = stepClock();
  const { handle } = openFinanceStore({ dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' }, now);
  cleanups.push(() => {
    handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const audit: TelegramAcceptAuditLine[] = [];
  let n = 0;
  const ctx: TelegramAcceptContext = {
    transport,
    handle,
    now,
    newId:
      newId ??
      ((): string => {
        n += 1;
        return `wq-${String(n).padStart(3, '0')}`;
      }),
    audit: (line) => audit.push(line),
  };
  return {
    ctx,
    audit,
    depth: () => workQueueDepth({ handle, now, newId: ctx.newId }),
    claimed: (updateId: number) => {
      const row = handle.db.prepare('SELECT COUNT(*) AS n FROM update_dedup WHERE bot_id = ? AND update_id = ?').get(BOT, updateId);
      return Number((row as { n?: unknown }).n) > 0;
    },
  };
}

/** A refusal wrote nothing at all: no queue row in any state, and no dedup claim. */
function expectNothingHappened(harness: Harness, updateId: number): void {
  expect(harness.depth()).toEqual({ queued: 0, running: 0, done: 0, failed: 0 });
  expect(harness.claimed(updateId)).toBe(false);
}

// ---------------------------------------------------------------------------------------------
// The table itself: enumerable, covering, and fail-closed on a mode nobody declared
// ---------------------------------------------------------------------------------------------

describe('the applicable-gate table is exactly the port\'s mode set (R26, D1)', () => {
  it('declares one row per declared mode and no row for anything else', () => {
    expect(Object.keys(TELEGRAM_MODE_APPLICABLE_GATES).sort()).toEqual([...TELEGRAM_TRANSPORT_MODES].sort());
    // The asymmetry, in literals rather than relative to the table under test: webhook is all
    // three, longPoll is the allowlist alone. Writing it out is the point — asserting the table
    // against itself would pass however it changed.
    expect(TELEGRAM_MODE_APPLICABLE_GATES.webhook).toEqual(['configuration', 'token', 'allowlist']);
    expect(TELEGRAM_MODE_APPLICABLE_GATES.longPoll).toEqual(['allowlist']);
    // longPoll is weaker by EXACTLY one gate, and the allowlist is the one it keeps (R12).
    expect(TELEGRAM_MODE_APPLICABLE_GATES.longPoll).not.toEqual([]);
    expect(TELEGRAM_AUTH_STAGES).toEqual(['configuration', 'token', 'allowlist']);
  });

  it('falls back to the FULL set for a mode nobody declared, never the empty one', () => {
    // A typo in configuration must refuse more, not less. `parseTransportMode` refuses such a
    // value at startup; this is the second belt on the same door.
    const unknown = 'webHook' as TelegramTransportMode;
    expect(applicableAuthStages(unknown)).toEqual([...TELEGRAM_AUTH_STAGES]);
    const harness = openHarness(transportOf({ mode: unknown }));
    // And it refuses the guarded operation: the header is absent, which the full set rejects.
    expect(acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 72 }))).toBe(TELEGRAM_ACCEPT_REJECTED);
    expectNothingHappened(harness, 72);
  });
});

// ---------------------------------------------------------------------------------------------
// longPoll: the allowlist is the whole guard, and it refuses by default
// ---------------------------------------------------------------------------------------------

describe('longPoll: the allowlist is the whole guard (R26)', () => {
  it('REFUSES an unlisted sender, and the accept path writes nothing', () => {
    const harness = openHarness(transportOf({ mode: 'longPoll' }));
    const decision = acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 81, senderId: OUTSIDER }));
    expect(decision).toBe(TELEGRAM_ACCEPT_REJECTED);
    // Shown failing the GUARDED OPERATION: nothing durable exists behind that decision.
    expectNothingHappened(harness, 81);
    expect(harness.audit.map((line) => line.stage)).toEqual(['allowlist']);
  });

  it('ACCEPTS the owner with NO secret-token header at all — the case the unchanged guard broke', () => {
    // This is the trap R26 exists to close. Under the pre-Phase-10 guard the configuration stage
    // was read first and the token gate could not pass with a null header, so every message the
    // owner sent was refused and the bot presented as verified-live and silently broken.
    const harness = openHarness(transportOf({ mode: 'longPoll' }));
    const delivery = deliveryOf('longPoll', { updateId: 82 });
    expect(delivery.secretTokenHeader).toBeNull();
    const decision = acceptDelivery(harness.ctx, delivery);
    expect(decision.outcome).toBe('enqueued');
    expect(harness.depth().queued).toBe(1);
    expect(harness.claimed(82)).toBe(true);
    expect(harness.audit).toEqual([]);
  });

  it('refuses that SAME delivery under webhook, so the two modes are not one path', () => {
    // One field of configuration different, nothing else: the mode. Under webhook a null header is
    // refused, which is R11 doing its job — and it proves longPoll's acceptance above came from
    // the mode axis rather than from a relaxation that would have opened webhook too.
    const harness = openHarness(transportOf({ mode: 'webhook' }));
    expect(acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 83 }))).toBe(TELEGRAM_ACCEPT_REJECTED);
    expectNothingHappened(harness, 83);
  });

  it('refuses EVERYONE under an empty allowlist, including the otherwise-authorised sender', () => {
    const harness = openHarness(transportOf({ mode: 'longPoll', allowedSenderIds: [] }));
    for (const [i, senderId] of [OWNER, OUTSIDER, ''].entries()) {
      const decision = acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 90 + i, senderId }));
      expect(decision).toBe(TELEGRAM_ACCEPT_REJECTED);
      expectNothingHappened(harness, 90 + i);
    }
    // "Not applicable" is not a default that opens a door: an unconfigured longPoll deployment
    // admits NOBODY. The accepting case it differs from by one field of policy:
    const configured = openHarness(transportOf({ mode: 'longPoll' }));
    expect(acceptDelivery(configured.ctx, deliveryOf('longPoll', { updateId: 93 })).outcome).toBe('enqueued');
  });

  it('refuses an empty sender identifier, which is nobody rather than everybody', () => {
    const harness = openHarness(transportOf({ mode: 'longPoll', allowedSenderIds: [OWNER] }));
    expect(acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 94, senderId: '' }))).toBe(
      TELEGRAM_ACCEPT_REJECTED,
    );
    expectNothingHappened(harness, 94);
  });

  it('does not consult the token gate, so an unusable expected token still admits the owner', () => {
    // The gate is NOT APPLICABLE, and this is what that means operationally: the entry the owner
    // must still fill (task 10.3 marks it "phase 1 - fill, unused") does not decide a longPoll
    // delivery, and an owner whose deployment has no webhook secret is not locked out of his bot.
    for (const [, expectedSecretToken] of UNUSABLE_EXPECTED_TOKENS) {
      const harness = openHarness(
        transportOf({ mode: 'longPoll', expectedSecretToken: expectedSecretToken as string }),
      );
      expect(acceptDelivery(harness.ctx, deliveryOf('longPoll', { updateId: 95 })).outcome).toBe('enqueued');
      // And the allowlist is still the guard under every one of those configurations.
      const refused = openHarness(
        transportOf({ mode: 'longPoll', expectedSecretToken: expectedSecretToken as string }),
      );
      expect(acceptDelivery(refused.ctx, deliveryOf('longPoll', { updateId: 96, senderId: OUTSIDER }))).toBe(
        TELEGRAM_ACCEPT_REJECTED,
      );
      expectNothingHappened(refused, 96);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The regression fence: webhook is not relaxed
// ---------------------------------------------------------------------------------------------

describe('webhook is NOT relaxed by the mode axis — the regression fence (R11, R26)', () => {
  it.each(UNUSABLE_EXPECTED_TOKENS)(
    'still refuses every request when the expected token is %s, header echoing it or not',
    (_shape, expectedSecretToken) => {
      const echoed = typeof expectedSecretToken === 'string' ? expectedSecretToken : null;
      for (const [i, header] of [echoed, TOKEN, null].entries()) {
        const harness = openHarness(transportOf({ expectedSecretToken: expectedSecretToken as string }));
        const updateId = 100 + i;
        expect(acceptDelivery(harness.ctx, deliveryOf('webhook', { updateId, secretTokenHeader: header }))).toBe(
          TELEGRAM_ACCEPT_REJECTED,
        );
        // Fail closed means the guarded operation did nothing, not merely that a value came back.
        expectNothingHappened(harness, updateId);
        // The configuration stage, not the token stage: the guard is unarmed, not mismatched.
        expect(harness.audit.map((line) => line.stage)).toEqual(['configuration']);
      }
    },
  );

  it('still refuses an absent, an empty and a wrong header under a usable expected token', () => {
    for (const [i, header] of [null, '', WRONG_TOKEN].entries()) {
      const harness = openHarness();
      const updateId = 110 + i;
      expect(acceptDelivery(harness.ctx, deliveryOf('webhook', { updateId, secretTokenHeader: header }))).toBe(
        TELEGRAM_ACCEPT_REJECTED,
      );
      expectNothingHappened(harness, updateId);
      expect(harness.audit.map((line) => line.stage)).toEqual(['token']);
    }
    // The accepting case, one field different: the header that echoes the configured value.
    const granted = openHarness();
    expect(acceptDelivery(granted.ctx, deliveryOf('webhook', { updateId: 113 })).outcome).toBe('enqueued');
  });

  it('still refuses an unlisted sender carrying the correct token', () => {
    const harness = openHarness();
    expect(acceptDelivery(harness.ctx, deliveryOf('webhook', { updateId: 114, senderId: OUTSIDER }))).toBe(
      TELEGRAM_ACCEPT_REJECTED,
    );
    expectNothingHappened(harness, 114);
    expect(harness.audit.map((line) => line.stage)).toEqual(['allowlist']);
  });

  it('keeps all three gates consulted, so no gate became unreachable', () => {
    // Each stage reached in turn, from the same starting configuration: if the mode axis had
    // dropped a gate from webhook, one of these would come back granted.
    const cases: readonly (readonly [string, Partial<TelegramTransportConfig>, Partial<TelegramDelivery>])[] = [
      ['configuration', { expectedSecretToken: '' }, {}],
      ['token', {}, { secretTokenHeader: WRONG_TOKEN }],
      ['allowlist', {}, { senderId: OUTSIDER }],
    ];
    for (const [stage, transport, delivery] of cases) {
      const harness = openHarness(transportOf(transport));
      expect(acceptDelivery(harness.ctx, deliveryOf('webhook', { updateId: 120, ...delivery }))).toBe(
        TELEGRAM_ACCEPT_REJECTED,
      );
      expect(harness.audit.map((line) => line.stage)).toEqual([stage]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Dedup in both modes, and the offset as the durability boundary
// ---------------------------------------------------------------------------------------------

const doneWorker: TelegramWorkerPort = {
  async process(_item: TelegramWorkItem): Promise<TelegramWorkOutcome> {
    return { outcome: 'done' };
  },
};

describe('the same update twice produces ONE effect, in both modes (R26.1, R13)', () => {
  it.each([...TELEGRAM_TRANSPORT_MODES])('is deduped on the (bot, update) pair under %s', (mode) => {
    const harness = openHarness(transportOf({ mode }));
    const delivery = deliveryOf(mode, { updateId: 130 });

    const first = acceptDelivery(harness.ctx, delivery);
    const second = acceptDelivery(harness.ctx, delivery);

    expect(first.outcome).toBe('enqueued');
    // A duplicate is a SUCCESS acknowledgement, not an error: an error would earn another retry.
    expect(second.outcome).toBe('duplicate');
    // One effect, read from the engine rather than from the decisions.
    expect(harness.depth().queued).toBe(1);
  });

  it.each([...TELEGRAM_TRANSPORT_MODES])(
    'keeps the per-bot half of the key under %s, so two bots do not collide (R14)',
    (mode) => {
      const harness = openHarness(transportOf({ mode }));
      // The same update identifier, a different bot: a legitimate second update, not a duplicate.
      const other = 'bot-two';
      expect(acceptDelivery(harness.ctx, deliveryOf(mode, { updateId: 131 })).outcome).toBe('enqueued');
      const second = acceptDelivery(
        { ...harness.ctx, transport: transportOf({ mode, botId: other }) },
        deliveryOf(mode, { updateId: 131, botId: other }),
      );
      expect(second.outcome).toBe('enqueued');
      expect(harness.depth().queued).toBe(2);
    },
  );
});

describe('longPoll: a crash BEFORE the enqueue commits re-delivers rather than loses (R26.1, D2)', () => {
  it('leaves the offset where it was, then enqueues exactly once on the next poll', async () => {
    // The crash is driven at the durability boundary: the id source the queue write needs is
    // unavailable on the first attempt and available afterwards, so the first accept rolls its
    // transaction back and the second commits. Nothing here sleeps.
    let attempts = 0;
    let sequence = 0;
    const harness = openHarness(transportOf({ mode: 'longPoll' }), () => {
      attempts += 1;
      if (attempts === 1) throw new Error('NIZAM test: durable enqueue unavailable');
      sequence += 1;
      return `wq-${String(sequence).padStart(3, '0')}`;
    });

    const served: TelegramFetchRequest[] = [];
    const live = createLiveTelegramTransport({
      accept: harness.ctx,
      client: {
        async fetchUpdates(request: TelegramFetchRequest): Promise<TelegramUpdateBatch> {
          served.push(request);
          // The provider re-serves what was never acknowledged, and only that.
          return { updates: request.offset <= 140 ? [{ updateId: 140, senderId: OWNER, rawBody: BODY }] : [] };
        },
        async sendMessage() {
          throw new Error('NIZAM test: the outbound path is not exercised here');
        },
      },
      worker: doneWorker,
      poll: { timeoutSeconds: 25, limit: 10 },
      send: { baseMs: 500, maxMs: 8_000, maxAttempts: 3 },
      sleep: async () => undefined,
    });

    // The crash. Asserted against the OFFSET, which is the acknowledgement (D2).
    const crashed = await live.pollOnce();
    expect(crashed.results.map((r) => [r.outcome, r.offsetAdvanced])).toEqual([['not-durable', false]]);
    expect(crashed.offsetAfter).toBe(crashed.offsetBefore);
    expect(live.currentOffset()).toBe(0);
    // Nothing was stored, so there is nothing to lose and nothing to double-count.
    expectNothingHappened(harness, 140);
    expect(harness.audit.map((line) => line.stage)).toEqual(['enqueue']);

    // The re-delivery. The provider serves the same update again because the offset never moved.
    const recovered = await live.pollOnce();
    expect(served.map((request) => request.offset)).toEqual([0, 0]);
    expect(recovered.results.map((r) => [r.outcome, r.offsetAdvanced])).toEqual([['enqueued', true]]);
    expect(live.currentOffset()).toBe(141);
    // Exactly once: the crash cost a retry, not a lost update and not a duplicated one.
    expect(harness.depth().queued).toBe(1);
    expect(harness.claimed(140)).toBe(true);

    // And a third poll is served nothing, because the offset now acknowledges it.
    const settled = await live.pollOnce();
    expect(settled.fetched).toBe(0);
    expect(harness.depth().queued).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The refusal says nothing about which check failed, in either mode
// ---------------------------------------------------------------------------------------------

describe('the refusal is indistinguishable as to stage, in BOTH modes (§5.2, R26)', () => {
  it('answers every refusal in either mode with the one frozen value, identical by reference', () => {
    const policy: TelegramAuthPolicy = { expectedSecretToken: TOKEN, allowedSenderIds: [OWNER] };
    const subject: TelegramAuthSubject = { botId: BOT, senderId: OWNER, secretTokenHeader: TOKEN };
    const refusals: readonly (readonly [TelegramTransportMode, TelegramAuthSubject, TelegramAuthPolicy])[] = [
      // webhook: one refusal per applicable gate.
      ['webhook', subject, { ...policy, expectedSecretToken: '' }],
      ['webhook', { ...subject, secretTokenHeader: null }, policy],
      ['webhook', { ...subject, secretTokenHeader: WRONG_TOKEN }, policy],
      ['webhook', { ...subject, senderId: OUTSIDER }, policy],
      // longPoll: the allowlist refusals, with no header at all.
      ['longPoll', { ...subject, secretTokenHeader: null, senderId: OUTSIDER }, policy],
      ['longPoll', { ...subject, secretTokenHeader: null }, { ...policy, allowedSenderIds: [] }],
      ['longPoll', { ...subject, secretTokenHeader: null, senderId: '' }, policy],
    ];

    for (const [mode, s, p] of refusals) {
      const decision = authorizeDelivery(s, p, mode);
      // The same object, not merely the same shape: a per-reason refusal is not constructible.
      expect(decision).toBe(TELEGRAM_AUTH_REFUSED);
      expect(Object.keys(decision)).toEqual(['authorized']);
    }
    expect(Object.isFrozen(TELEGRAM_AUTH_REFUSED)).toBe(true);
    // Nowhere to put a reason: the granted value has the same single key.
    expect(Object.keys(authorizeDelivery(subject, policy, 'webhook'))).toEqual(['authorized']);
  });

  it('carries the stage on the AUDIT path only, and never a token or a body', () => {
    const lines: TelegramAuthAuditLine[] = [];
    const policy: TelegramAuthPolicy = { expectedSecretToken: TOKEN, allowedSenderIds: [OWNER] };
    authorizeDelivery({ botId: BOT, senderId: OUTSIDER, secretTokenHeader: null }, policy, 'longPoll', (line) =>
      lines.push(line),
    );
    authorizeDelivery({ botId: BOT, senderId: OUTSIDER, secretTokenHeader: TOKEN }, policy, 'webhook', (line) =>
      lines.push(line),
    );
    // Both modes refused at the allowlist, and the audit — the separate path §5.3 requires — is
    // where that fact lives. It is not in the answer either caller received.
    expect(lines.map((line) => line.stage)).toEqual(['allowlist', 'allowlist']);
    expect(lines.map((line) => line.tokenHeaderPresent)).toEqual([false, true]);
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(BODY);
  });

  it('audits exactly one line per refusal in longPoll, never a second for a gate it does not apply', () => {
    const lines: TelegramAuthAuditLine[] = [];
    // Everything wrong at once: no header, no usable expected token, and an unlisted sender.
    const decision = authorizeDelivery(
      { botId: BOT, senderId: OUTSIDER, secretTokenHeader: null },
      { expectedSecretToken: '', allowedSenderIds: [] },
      'longPoll',
      (line) => lines.push(line),
    );
    expect(decision.authorized).toBe(false);
    // One line, and it is the allowlist: the configuration gate is not applicable, so it does not
    // report — which is what keeps the longPoll refusal a single indistinguishable answer.
    expect(lines.map((line) => line.stage)).toEqual(['allowlist']);
  });
});

// ---------------------------------------------------------------------------------------------
// The port's own contract, held across the axis
// ---------------------------------------------------------------------------------------------

describe('the decision type still has nowhere to put a reason (R26, §5.2)', () => {
  it('returns the one accept-path rejected value in both modes', () => {
    const decisions: TelegramAcceptDecision[] = [];
    for (const mode of TELEGRAM_TRANSPORT_MODES) {
      const harness = openHarness(transportOf({ mode }));
      decisions.push(acceptDelivery(harness.ctx, deliveryOf(mode, { updateId: 150, senderId: OUTSIDER })));
    }
    for (const decision of decisions) {
      expect(decision).toBe(TELEGRAM_ACCEPT_REJECTED);
      expect(Object.keys(decision)).toEqual(['outcome']);
    }
  });
});
