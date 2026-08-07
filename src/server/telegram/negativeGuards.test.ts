// @vitest-environment node
/**
 * NIZAM · Phase 4 negative guards — the two pins Phases 4.1-4.3 left constant-relative
 * Implemented by: PFOS Contract 12 / Phase 4.4 (spec 06-two-agent-vps)
 * Owning requirements: R11 (secret-token header, fail closed), R12 (allowlist),
 *   R13/R14 (dedup), R15 (accept fast) — as composed on the accept path
 * Depends on: ./auth, ./acceptHandler, ../db/store, ../ports/telegram
 *
 * Task 4.4's nominal scope — missing token, wrong token, non-allowlisted sender, duplicate
 * update, and two bots sharing one update identifier — is already covered, at the unit level by
 * `auth.test.ts` / `updateDedupRepo.test.ts` and at the composed level by `acceptHandler.test.ts`.
 * Restating any of it here would add a green line and no evidence, so this file does not.
 *
 * It closes the two places where a guard is asserted only RELATIVE to a value the code itself
 * owns — the failure shape Phase 3.4 found in R7, where every assertion about the 120-character
 * cap was written against `SIGNAL_NOTE_MAX_LENGTH`, so raising the constant would have kept the
 * suite green while violating the requirement outright.
 *
 *  1. **The provider's token rule (§5.2, R11).** `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` §1.4
 *     records a rule verified against the provider's own documentation: a secret token is 1-256
 *     characters drawn from `[A-Za-z0-9_-]`, and a value outside that set can never be echoed
 *     back on a request. `auth.ts` encodes it as `TELEGRAM_SECRET_TOKEN_MAX_LENGTH` and
 *     `TELEGRAM_SECRET_TOKEN_PATTERN`, and every existing assertion — the over-length
 *     fail-closed case, the at-the-limit accepting case — is expressed in terms of those two
 *     names. Raising the length or widening the charset would therefore leave the whole suite
 *     green while the fail-closed rule stopped matching the transport it exists to guard: an
 *     operator would configure a token the provider cannot echo, `secretTokenIsConfigured` would
 *     call it configured, and every request would be refused at the *token* stage instead of the
 *     *configuration* stage — a guard that is armed against nothing, reporting the wrong reason.
 *     This is the one place the rule's own number and alphabet are written down, which is what
 *     makes the constant-relative assertions elsewhere load-bearing.
 *  2. **"The refusal reveals nothing about which check failed" (§5.2), across ALL FOUR stages.**
 *     `acceptHandler.test.ts` proves two refusals are identical by reference. The accept path has
 *     four refusing stages, and the enqueue stage is the one a later edit is most likely to give
 *     its own shape, because it is the only refusal that carries a distinct failure code
 *     internally. Comparing every stage's answer against the single frozen value closes that.
 *
 * Every identifier below is synthetic and deliberately short (R24, steering §0b): no real token,
 * bot, sender, host, or path appears.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoreHandle } from '../db/connection';
import { openFinanceStore } from '../db/store';
import type { TelegramAcceptDecision, TelegramDelivery, TelegramTransportConfig } from '../ports/telegram';
import {
  authorizeDelivery,
  secretTokenIsConfigured,
  TELEGRAM_SECRET_TOKEN_MAX_LENGTH,
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

const BOT = 'bot-one';
const SENDER = 'op-1';
const OUTSIDER = 'op-9';
const TOKEN = 'tok-test-1';
const WRONG_TOKEN = 'tok-test-2';
const UPDATE_ID = 41;
const BODY = '{"t":"hello"}';

/**
 * The alphabet the architecture recorded, spelled out here rather than imported, so this file
 * agrees with the *documentation* and not merely with the module under test.
 */
const DOCUMENTED_TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Characters the provider's set excludes. Each would be un-echoable, so each must fail closed. */
const CHARACTERS_OUTSIDE_THE_DOCUMENTED_SET = [
  '.',
  ' ',
  '+',
  '/',
  '=',
  ':',
  ',',
  '%',
  '\t',
  '\u00e9',
  '\u{1F510}',
] as const;

const POLICY: TelegramAuthPolicy = { expectedSecretToken: TOKEN, allowedSenderIds: [SENDER] };
const SUBJECT: TelegramAuthSubject = { botId: BOT, senderId: SENDER, secretTokenHeader: TOKEN };

describe('the provider token rule is pinned to the number and alphabet §1.4 verified (R11)', () => {
  it('caps the expected token at the 256 characters the architecture names, so the constant cannot drift', () => {
    // Pinned by Phase 4.4. Every other assertion about this bound — the fail-closed over-length
    // case in `auth.test.ts`, the at-the-limit accepting case beside it — is written RELATIVE to
    // TELEGRAM_SECRET_TOKEN_MAX_LENGTH, so raising it would keep them all green while the guard
    // accepted a token the transport can never echo back.
    expect(TELEGRAM_SECRET_TOKEN_MAX_LENGTH).toBe(256);

    // The bound itself, in literals, on both sides of the edge.
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: 'a'.repeat(256) })).toBe(true);
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: 'a'.repeat(257) })).toBe(false);
    // And the documented minimum: one character is a legal token, zero is not.
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: 'a' })).toBe(true);
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: '' })).toBe(false);
  });

  it('fails closed on a 257-character expected token even when the header echoes it exactly', () => {
    const overLong = 'a'.repeat(257);
    const audit: TelegramAuthAuditLine[] = [];
    const decision = authorizeDelivery(
      { ...SUBJECT, secretTokenHeader: overLong },
      { ...POLICY, expectedSecretToken: overLong },
      (line) => audit.push(line),
    );
    expect(decision).toEqual({ authorized: false });
    // The configuration stage, not the token stage: the guard is unarmed, not merely mismatched.
    expect(audit.map((line) => line.stage)).toEqual(['configuration']);
  });

  it('accepts every character in the documented alphabet, one at a time', () => {
    for (const character of DOCUMENTED_TOKEN_ALPHABET) {
      expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: character })).toBe(true);
    }
    // And the whole alphabet as one token, so it is not merely single characters that pass.
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: DOCUMENTED_TOKEN_ALPHABET })).toBe(true);
  });

  it.each(CHARACTERS_OUTSIDE_THE_DOCUMENTED_SET)(
    'fails closed on an expected token containing %j, which the provider could never echo',
    (character) => {
      const illegal = `tok${character}test`;
      expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: illegal })).toBe(false);
      // Fail closed means refused even when the header carries the very value configured.
      expect(
        authorizeDelivery({ ...SUBJECT, secretTokenHeader: illegal }, { ...POLICY, expectedSecretToken: illegal }),
      ).toEqual({ authorized: false });
    },
  );
});

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
    allowedSenderIds: [SENDER],
    apiBaseUrlRef: '<TELEGRAM_API_BASE>',
    mode: 'webhook',
    maxConcurrentWorkItems: 2,
    ...overrides,
  };
}

function deliveryOf(overrides: Partial<TelegramDelivery> = {}): TelegramDelivery {
  return {
    botId: BOT,
    updateId: UPDATE_ID,
    senderId: SENDER,
    secretTokenHeader: TOKEN,
    receivedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    rawBody: BODY,
    ...overrides,
  };
}

interface Harness {
  readonly ctx: TelegramAcceptContext;
  readonly audit: readonly TelegramAcceptAuditLine[];
}

function openHarness(transport: TelegramTransportConfig = transportOf(), newId?: () => string): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-neg4-'));
  const handles: StoreHandle[] = [];
  const now = stepClock();
  let n = 0;
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  handles.push(handle);
  const audit: TelegramAcceptAuditLine[] = [];
  cleanups.push(() => {
    for (const h of handles) h.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    ctx: {
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
    },
    audit,
  };
}

describe('every refusing stage answers with the SAME value, so no reason leaks (§5.2)', () => {
  it('all four stages return the one frozen rejected value, identical by reference', () => {
    // One refusal per stage, each from its own store so no earlier claim colours a later one.
    const configuration = openHarness(transportOf({ expectedSecretToken: '' }));
    const token = openHarness();
    const allowlist = openHarness();
    const enqueue = openHarness(transportOf(), () => {
      throw new Error('NIZAM test: durable enqueue unavailable');
    });

    const refusals: readonly (readonly [string, TelegramAcceptDecision, Harness])[] = [
      ['configuration', acceptDelivery(configuration.ctx, deliveryOf()), configuration],
      ['token', acceptDelivery(token.ctx, deliveryOf({ secretTokenHeader: WRONG_TOKEN })), token],
      ['allowlist', acceptDelivery(allowlist.ctx, deliveryOf({ senderId: OUTSIDER })), allowlist],
      ['enqueue', acceptDelivery(enqueue.ctx, deliveryOf()), enqueue],
    ];

    for (const [stage, decision, harness] of refusals) {
      // The answer is one value, not a per-stage shape: identical by reference, single-keyed.
      expect(decision).toBe(TELEGRAM_ACCEPT_REJECTED);
      expect(Object.keys(decision)).toEqual(['outcome']);
      // And these really are four DIFFERENT refusals — the audit, which §5.3 requires and which
      // is a separate path from the response, says so.
      expect(harness.audit.map((line) => line.stage)).toEqual([stage]);
    }

    // Nowhere to put a reason, so a later call site cannot grow one by accident.
    expect(Object.isFrozen(TELEGRAM_ACCEPT_REJECTED)).toBe(true);
  });
});
