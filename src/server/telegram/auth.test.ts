// @vitest-environment node
/**
 * NIZAM · Both authenticity checks, in order — contract 12 §5.2, §5.3 (R11, R12)
 * Implemented by: PFOS Contract 12 / Phase 4.1 (spec 06-two-agent-vps)
 * Depends on: ./auth, ../ports/telegram
 *
 * Design's testing strategy is explicit: "a test that has only ever been observed passing is not
 * evidence. Each negative test must be shown failing the guarded operation, not merely returning
 * a value." So every refusal below is paired with the accepting case it differs from by one
 * field, and the ordering is proved by the stage the audit records rather than asserted in prose.
 *
 * Every value here is synthetic (R24): no real token, sender, bot, or host appears, and the
 * tokens are drawn from the provider's own documented charset so the configuration checks are
 * exercised against realistic shapes rather than convenient ones.
 */
import { describe, expect, it } from 'vitest';

import {
  authorizeDelivery as authorizeDeliveryInMode,
  authPolicyFromTransport,
  secretTokenIsConfigured,
  senderIsAllowlisted,
  TELEGRAM_AUTH_GRANTED,
  TELEGRAM_AUTH_REFUSED,
  TELEGRAM_AUTH_SUBJECT_KEYS,
  TELEGRAM_SECRET_TOKEN_HEADER,
  TELEGRAM_SECRET_TOKEN_MAX_LENGTH,
  type TelegramAuthAuditLine,
  type TelegramAuthAuditSink,
  type TelegramAuthDecision,
  type TelegramAuthPolicy,
  type TelegramAuthSubject,
} from './auth';
import type { TelegramTransportConfig } from '../ports/telegram';

/**
 * **Every assertion in this file is a `webhook` assertion**, and Phase 10.5's mode axis (R26) does
 * not move one of them: all three gates apply in `webhook`, in the same order, so this file is the
 * regression fence that shows R11 was not relaxed to let one code path serve both modes.
 *
 * The mode is bound here rather than spelled at each of the call sites below, so the fence reads as
 * one decision instead of forty. `longPoll`'s half of the axis is asserted separately, against the
 * guarded operation, in `modeAwareGuard.negative.test.ts`.
 */
function authorizeDelivery(
  subject: TelegramAuthSubject,
  policy: TelegramAuthPolicy,
  audit?: TelegramAuthAuditSink,
): TelegramAuthDecision {
  return authorizeDeliveryInMode(subject, policy, 'webhook', audit);
}

const EXPECTED_TOKEN = 'synthetic-token-alpha_01';

const POLICY: TelegramAuthPolicy = {
  expectedSecretToken: EXPECTED_TOKEN,
  allowedSenderIds: ['sender-one'],
};

const SUBJECT: TelegramAuthSubject = {
  botId: 'bot-alpha',
  senderId: 'sender-one',
  secretTokenHeader: EXPECTED_TOKEN,
};

/** An audit sink and its lines, so a refusal's stage is observable without being in the answer. */
function auditing(): { sink: (line: TelegramAuthAuditLine) => void; lines: TelegramAuthAuditLine[] } {
  const lines: TelegramAuthAuditLine[] = [];
  return { sink: (line) => lines.push(line), lines };
}

describe('the granted path (§5.2, §5.3)', () => {
  it('authorizes a correct token from an allowlisted sender, and audits nothing', () => {
    const audit = auditing();
    expect(authorizeDelivery(SUBJECT, POLICY, audit.sink)).toEqual({ authorized: true });
    expect(audit.lines).toEqual([]);
  });

  it('names the provider header the value is read from, and nothing else about the deployment', () => {
    expect(TELEGRAM_SECRET_TOKEN_HEADER).toBe('X-Telegram-Bot-Api-Secret-Token');
  });

  it('reads its policy out of an injected transport configuration, with no default of its own', () => {
    const transport: TelegramTransportConfig = {
      botId: 'bot-alpha',
      expectedSecretToken: EXPECTED_TOKEN,
      allowedSenderIds: ['sender-one'],
      apiBaseUrlRef: 'TELEGRAM_API_BASE_REF',
      mode: 'webhook',
      maxConcurrentWorkItems: 2,
    };
    expect(authPolicyFromTransport(transport)).toEqual(POLICY);
    expect(authorizeDelivery(SUBJECT, authPolicyFromTransport(transport))).toEqual({ authorized: true });
  });
});

describe('the token gate (§5.2, R11)', () => {
  it('refuses an ABSENT header — absent is not empty', () => {
    const audit = auditing();
    expect(authorizeDelivery({ ...SUBJECT, secretTokenHeader: null }, POLICY, audit.sink)).toEqual({
      authorized: false,
    });
    expect(audit.lines.map((line) => [line.stage, line.tokenHeaderPresent])).toEqual([['token', false]]);
  });

  it('refuses an EMPTY header — empty is not valid, and it is a different fact from absent', () => {
    const absent = auditing();
    const empty = auditing();
    authorizeDelivery({ ...SUBJECT, secretTokenHeader: null }, POLICY, absent.sink);
    authorizeDelivery({ ...SUBJECT, secretTokenHeader: '' }, POLICY, empty.sink);
    expect(empty.lines[0]?.stage).toBe('token');
    // Both refused, and the audit still tells the two facts apart without recording either value.
    expect(absent.lines[0]?.tokenHeaderPresent).toBe(false);
    expect(empty.lines[0]?.tokenHeaderPresent).toBe(true);
  });

  it('refuses a mismatched token: a prefix, a superstring, and a same-length near-miss', () => {
    for (const wrong of [
      EXPECTED_TOKEN.slice(0, -1),
      `${EXPECTED_TOKEN}X`,
      `${EXPECTED_TOKEN.slice(0, -1)}X`,
      'X',
      'synthetic-token-beta_010',
    ]) {
      expect(authorizeDelivery({ ...SUBJECT, secretTokenHeader: wrong }, POLICY)).toEqual({ authorized: false });
    }
    // And the one-character-different accepting case still passes, so the gate is not stuck shut.
    expect(authorizeDelivery(SUBJECT, POLICY)).toEqual({ authorized: true });
  });

  it('never carries the token in the audit, in any form', () => {
    const audit = auditing();
    authorizeDelivery({ ...SUBJECT, secretTokenHeader: 'a-wrong-but-well-shaped-token' }, POLICY, audit.sink);
    const serialized = JSON.stringify(audit.lines);
    expect(serialized).not.toContain(EXPECTED_TOKEN);
    expect(serialized).not.toContain('a-wrong-but-well-shaped-token');
    expect(Object.keys(audit.lines[0] ?? {}).sort()).toEqual([
      'botId',
      'code',
      'senderId',
      'stage',
      'tokenHeaderPresent',
    ]);
  });
});

describe('an unconfigured expected token FAILS CLOSED (§5.2)', () => {
  const unconfigured: readonly (string | null | undefined)[] = [
    undefined,
    null,
    '',
    ' ',
    'not a legal token',
    'x'.repeat(TELEGRAM_SECRET_TOKEN_MAX_LENGTH + 1),
  ];

  it('refuses EVERY request, including one carrying the configured value', () => {
    for (const expectedSecretToken of unconfigured) {
      const audit = auditing();
      const policy: TelegramAuthPolicy = { ...POLICY, expectedSecretToken };
      // The header echoes whatever was configured, which on a broken guard would look "right".
      const echoing: TelegramAuthSubject = {
        ...SUBJECT,
        secretTokenHeader: typeof expectedSecretToken === 'string' ? expectedSecretToken : null,
      };
      expect(authorizeDelivery(echoing, policy, audit.sink)).toEqual({ authorized: false });
      expect(audit.lines.map((line) => [line.stage, line.code])).toEqual([
        ['configuration', 'TELEGRAM_CONFIG_FAILS_CLOSED'],
      ]);
      expect(secretTokenIsConfigured(policy)).toBe(false);
    }
  });

  it('accepts only a token the provider could actually echo', () => {
    expect(secretTokenIsConfigured(POLICY)).toBe(true);
    expect(secretTokenIsConfigured({ ...POLICY, expectedSecretToken: 'a'.repeat(TELEGRAM_SECRET_TOKEN_MAX_LENGTH) })).toBe(
      true,
    );
  });
});

describe('the allowlist gate (§5.3, R12)', () => {
  it('refuses a sender absent from the list', () => {
    const audit = auditing();
    expect(authorizeDelivery({ ...SUBJECT, senderId: 'sender-unlisted' }, POLICY, audit.sink)).toEqual({
      authorized: false,
    });
    expect(audit.lines.map((line) => line.stage)).toEqual(['allowlist']);
  });

  it('treats an EMPTY allowlist as nobody, not everybody', () => {
    const audit = auditing();
    const policy: TelegramAuthPolicy = { ...POLICY, allowedSenderIds: [] };
    expect(authorizeDelivery(SUBJECT, policy, audit.sink)).toEqual({ authorized: false });
    expect(audit.lines.map((line) => line.stage)).toEqual(['allowlist']);
    expect(senderIsAllowlisted('sender-one', [])).toBe(false);
    // Same subject, same token, one field of policy different: the accepting case.
    expect(authorizeDelivery(SUBJECT, POLICY)).toEqual({ authorized: true });
  });

  it('treats an empty sender identifier as nobody', () => {
    expect(senderIsAllowlisted('', ['sender-one'])).toBe(false);
    expect(authorizeDelivery({ ...SUBJECT, senderId: '' }, POLICY)).toEqual({ authorized: false });
  });

  it('matches exactly — no trimming, no case folding, no prefix', () => {
    for (const sender of [' sender-one', 'sender-one ', 'Sender-One', 'sender-on', 'sender-one-two']) {
      expect(authorizeDelivery({ ...SUBJECT, senderId: sender }, POLICY)).toEqual({ authorized: false });
    }
  });
});

describe('a non-allowlisted sender never reaches a parser (§5.3)', () => {
  it('is never handed the content at all: the subject has no body field', () => {
    expect([...TELEGRAM_AUTH_SUBJECT_KEYS]).toEqual(['botId', 'senderId', 'secretTokenHeader']);
    expect([...TELEGRAM_AUTH_SUBJECT_KEYS]).not.toContain('rawBody');
  });

  it('does not so much as READ a body that is smuggled onto the subject', () => {
    // A tripwire rather than an assertion about intent: reading the property throws, so any code
    // path that touched the content would fail this test loudly.
    const withTripwire = (senderId: string): TelegramAuthSubject =>
      Object.defineProperty({ ...SUBJECT, senderId }, 'rawBody', {
        enumerable: true,
        get(): never {
          throw new Error('the authorizer parsed the content');
        },
      }) as TelegramAuthSubject;

    const audit = auditing();
    expect(authorizeDelivery(withTripwire('sender-unlisted'), POLICY, audit.sink)).toEqual({ authorized: false });
    expect(authorizeDelivery(withTripwire('sender-one'), POLICY, audit.sink)).toEqual({ authorized: true });
    expect(audit.lines.map((line) => line.stage)).toEqual(['allowlist']);
  });
});

describe('the refusal reveals nothing about which check failed (§5.2)', () => {
  it('answers every refusal with one identical value, by reference', () => {
    const refusals = [
      authorizeDelivery({ ...SUBJECT, secretTokenHeader: null }, POLICY),
      authorizeDelivery({ ...SUBJECT, secretTokenHeader: '' }, POLICY),
      authorizeDelivery({ ...SUBJECT, secretTokenHeader: 'wrong-token' }, POLICY),
      authorizeDelivery({ ...SUBJECT, senderId: 'sender-unlisted' }, POLICY),
      authorizeDelivery(SUBJECT, { ...POLICY, allowedSenderIds: [] }),
      authorizeDelivery(SUBJECT, { ...POLICY, expectedSecretToken: '' }),
    ];
    for (const refusal of refusals) {
      expect(refusal).toBe(TELEGRAM_AUTH_REFUSED);
      expect(Object.keys(refusal)).toEqual(['authorized']);
    }
    expect(authorizeDelivery(SUBJECT, POLICY)).toBe(TELEGRAM_AUTH_GRANTED);
  });

  it('has nowhere to put a reason: the decision is frozen and single-keyed', () => {
    expect(Object.isFrozen(TELEGRAM_AUTH_REFUSED)).toBe(true);
    expect(Object.isFrozen(TELEGRAM_AUTH_GRANTED)).toBe(true);
  });
});

describe('the check ORDER is token, then allowlist, then anything else (§5.2 before §5.3)', () => {
  /** Every combination of the three gates, with the stage §5.3's order requires. */
  interface OrderingCase {
    readonly name: string;
    readonly policy: TelegramAuthPolicy;
    readonly subject: TelegramAuthSubject;
    readonly stage: TelegramAuthAuditLine['stage'] | 'granted';
  }
  const table: OrderingCase[] = [
    {
      name: 'unconfigured + right token + allowlisted → configuration wins',
      policy: { ...POLICY, expectedSecretToken: '' },
      subject: SUBJECT,
      stage: 'configuration',
    },
    {
      name: 'unconfigured + wrong token + unlisted → configuration still wins',
      policy: { ...POLICY, expectedSecretToken: null, allowedSenderIds: [] },
      subject: { ...SUBJECT, secretTokenHeader: 'wrong-token', senderId: 'sender-unlisted' },
      stage: 'configuration',
    },
    {
      name: 'configured + wrong token + allowlisted → token',
      policy: POLICY,
      subject: { ...SUBJECT, secretTokenHeader: 'wrong-token' },
      stage: 'token',
    },
    {
      name: 'configured + wrong token + UNLISTED → token, because the token check comes first',
      policy: POLICY,
      subject: { ...SUBJECT, secretTokenHeader: 'wrong-token', senderId: 'sender-unlisted' },
      stage: 'token',
    },
    {
      name: 'configured + absent token + UNLISTED → token',
      policy: POLICY,
      subject: { ...SUBJECT, secretTokenHeader: null, senderId: 'sender-unlisted' },
      stage: 'token',
    },
    {
      name: 'configured + right token + unlisted → allowlist',
      policy: POLICY,
      subject: { ...SUBJECT, senderId: 'sender-unlisted' },
      stage: 'allowlist',
    },
    { name: 'configured + right token + allowlisted → granted', policy: POLICY, subject: SUBJECT, stage: 'granted' },
  ];

  it.each(table)('$name', ({ policy, subject, stage }) => {
    const audit = auditing();
    const decision = authorizeDelivery(subject, policy, audit.sink);
    if (stage === 'granted') {
      expect(decision).toEqual({ authorized: true });
      expect(audit.lines).toEqual([]);
      return;
    }
    expect(decision).toEqual({ authorized: false });
    expect(audit.lines.map((line) => line.stage)).toEqual([stage]);
  });

  it('the allowlist can never grant what the token gate refused', () => {
    // Widening the allowlist to include everyone does not rescue a bad token.
    const permissive: TelegramAuthPolicy = { ...POLICY, allowedSenderIds: ['sender-one', 'sender-unlisted'] };
    for (const header of [null, '', 'wrong-token']) {
      expect(authorizeDelivery({ ...SUBJECT, secretTokenHeader: header }, permissive)).toEqual({ authorized: false });
    }
  });

  it('audits exactly one line per refusal — the first failing stage, never a second', () => {
    const audit = auditing();
    authorizeDelivery(
      { ...SUBJECT, secretTokenHeader: null, senderId: 'sender-unlisted' },
      { ...POLICY, allowedSenderIds: [] },
      audit.sink,
    );
    expect(audit.lines.length).toBe(1);
    expect(audit.lines[0]?.stage).toBe('token');
  });

  it('reaches the same decision with no audit sink attached', () => {
    expect(authorizeDelivery({ ...SUBJECT, senderId: 'sender-unlisted' }, POLICY)).toEqual({ authorized: false });
    expect(authorizeDelivery(SUBJECT, POLICY)).toEqual({ authorized: true });
  });
});
