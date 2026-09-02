/**
 * NIZAM · Daily transaction capture — acceptance suite for Contract 15 §9.1
 * Owning contract: PFOS Contract 15 (Daily Transaction Capture and Candidate Staging).
 * Phase: Phase 15 — the owner daily capture surface (owner decision D7, 2026-09-02).
 * Depends on: ./dailyCapture.ts, ../db/repositories/sourceEventsRepository.ts (types only).
 *
 * Every fixture is synthetic. No real account, payee, figure or identifier appears here.
 * The twelve numbered checks below are Contract 15 §9.1's twelve, in order, and check 12 is the
 * tamper control: a guard that cannot be made to fail is not a guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SourceEventAppend } from '../db/repositories/sourceEventsRepository.ts';
import {
  CAPTURE_CHANNEL,
  CAPTURE_DECLINATION_REPLY,
  CAPTURE_GRAMMAR_VERSION,
  CAPTURE_REFUSAL_CODES,
  MAX_CAPTURE_LINES,
  buildCapturedSourceEvent,
  captureContentHash,
  clarifyingQuestionFor,
  composeDailyCapturePrompt,
  dailyCaptureIdempotencyKey,
  parseCaptureLine,
  parseDailyCaptureReply,
  type CaptureContext,
  type CaptureRefusalCode,
} from './dailyCapture.ts';
import * as captureModule from './dailyCapture.ts';

const CTX: CaptureContext = {
  captureDate: '2026-09-02',
  knownCurrencies: ['EGP', 'USD'],
  accountAliases: [
    { alias: 'main-card', accountId: 'acc-synth-1' },
    { alias: 'cash', accountId: 'acc-synth-2' },
    { alias: 'twin', accountId: 'acc-synth-3' },
    { alias: 'twin', accountId: 'acc-synth-4' },
  ],
  sourceEventRef: 'srcev-synth-1',
};

/** Parse one line and assert it produced a candidate; returns it. */
function candidateOf(line: string, ctx: CaptureContext = CTX) {
  const outcome = parseCaptureLine(line, 1, ctx);
  if (!('candidate' in outcome)) {
    throw new Error(`expected a candidate, got refusal ${outcome.refusal.code}`);
  }
  return outcome.candidate;
}

/** Parse one line and assert it refused with `code`. */
function refusalOf(line: string, code: CaptureRefusalCode, ctx: CaptureContext = CTX) {
  const outcome = parseCaptureLine(line, 1, ctx);
  if ('candidate' in outcome) throw new Error(`expected refusal ${code}, got a candidate`);
  expect(outcome.refusal.code).toBe(code);
  return outcome.refusal;
}

describe('§9.1(1) a well-formed line produces one candidate in integer milliunits', () => {
  it('takes the magnitude from the amount and the sign from the direction', () => {
    const out = candidateOf('out 85.500 EGP acct:main-card Coffee shop');
    expect(out.amount).toBe(-85_500);
    expect(Number.isSafeInteger(out.amount)).toBe(true);
    expect(out.currency).toBe('EGP');
    expect(out.accountId).toBe('acc-synth-1');
    expect(out.payee).toBe('Coffee shop');

    const inflow = candidateOf('in 12000 EGP acct:main-card Monthly salary');
    expect(inflow.amount).toBe(12_000_000);
  });

  it('reads a memo after the pipe and leaves it out of the fingerprint', () => {
    const bare = candidateOf('out 240 EGP acct:cash Groceries');
    const withMemo = candidateOf('out 240 EGP acct:cash Groceries | forgot to log it');
    expect(withMemo.memo).toBe('forgot to log it');
    expect(bare.memo).toBe('');
    // The fingerprint covers financially consequential fields only, so a memo cannot move it.
    expect(withMemo.importInfo?.contentHash).toBe(bare.importInfo?.contentHash);
  });

  it('never renders money as a decimal or a float anywhere in the candidate', () => {
    const c = candidateOf('out 0.001 EGP acct:cash Smallest unit');
    expect(c.amount).toBe(-1);
    expect(JSON.stringify(c)).not.toMatch(/0\.001/u);
  });
});

describe('§9.1(2) the §4.4 fixed fields hold their stated value on every candidate', () => {
  const lines = [
    'out 85.500 EGP acct:main-card Coffee shop',
    'in 12000 USD acct:cash Refund',
    'out 1 EGP acct:cash Parking @2026-09-01 | note',
  ];
  it.each(lines)('%s', (line) => {
    const c = candidateOf(line);
    expect(c.approved).toBe(false);
    expect(c.cleared).toBe('uncleared');
    expect(c.categoryId).toBeNull();
    expect(c.splits).toBeNull();
    expect(c.transferAccountId).toBeNull();
    expect(c.transferTransactionId).toBeNull();
    expect(c.duplicateStatus).toBe('ambiguous');
  });
});

describe('§9.1(3) every refusal code is provoked and produces zero candidates', () => {
  const cases: ReadonlyArray<readonly [CaptureRefusalCode, string]> = [
    ['CAPTURE_LINE_EMPTY', '   '],
    ['CAPTURE_DIRECTION_MISSING', 'spent 85 EGP acct:cash Coffee'],
    ['CAPTURE_AMOUNT_MISSING', 'out'],
    ['CAPTURE_AMOUNT_UNPARSEABLE', 'out eighty-five EGP acct:cash Coffee'],
    ['CAPTURE_AMOUNT_NOT_POSITIVE', 'out 0 EGP acct:cash Coffee'],
    ['CAPTURE_CURRENCY_MISSING', 'out 85 acct:cash Coffee'],
    ['CAPTURE_CURRENCY_UNKNOWN', 'out 85 GBP acct:cash Coffee'],
    ['CAPTURE_ACCOUNT_MISSING', 'out 85 EGP cash Coffee'],
    ['CAPTURE_ACCOUNT_UNKNOWN', 'out 85 EGP acct:nope Coffee'],
    ['CAPTURE_PAYEE_MISSING', 'out 85 EGP acct:cash'],
    ['CAPTURE_DATE_MALFORMED', 'out 85 EGP acct:cash Coffee @2026-9-1'],
    ['CAPTURE_DATE_IN_FUTURE', 'out 85 EGP acct:cash Coffee @2026-09-03'],
  ];

  it.each(cases)('%s', (code, line) => {
    refusalOf(line, code);
    // A refusal is total for its line: the whole-reply parser yields no candidate for it either.
    const parsed = parseDailyCaptureReply(line, CTX);
    expect(parsed.candidates).toHaveLength(0);
  });

  it('refuses a reply longer than the line bound whole, rather than truncating it', () => {
    const reply = Array.from({ length: MAX_CAPTURE_LINES + 1 }, () => 'out 1 EGP acct:cash X').join('\n');
    const parsed = parseDailyCaptureReply(reply, CTX);
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.refusals.map((r) => r.code)).toEqual(['CAPTURE_TOO_MANY_LINES']);
  });

  it('covers every declared refusal code, so the table and the code cannot drift', () => {
    const provoked = new Set<string>([...cases.map(([code]) => code), 'CAPTURE_TOO_MANY_LINES']);
    expect([...CAPTURE_REFUSAL_CODES].filter((c) => !provoked.has(c))).toEqual([]);
  });

  it('gives every refusal a clarifying question that echoes no figure', () => {
    for (const code of CAPTURE_REFUSAL_CODES) {
      const question = clarifyingQuestionFor({ code, lineNumber: 3 });
      expect(question.length).toBeGreaterThan(0);
      expect(question).not.toMatch(/\d+\.\d/u);
    }
  });
});

describe('§9.1(4) precision is refused, never absorbed', () => {
  it('refuses a four-decimal amount rather than rounding it', () => {
    const r = refusalOf('out 85.5001 EGP acct:cash Coffee', 'CAPTURE_AMOUNT_UNPARSEABLE');
    expect(r.strictMoneyCode).toBe('PRECISION_WOULD_ROUND');
  });

  it('refuses a grouping separator rather than stripping it', () => {
    // "1,200" would silently become 1200 under a forgiving parser; at a machine boundary the
    // separator means the upstream format changed, so it is refused.
    const r = refusalOf('out 1,200 EGP acct:cash Rent', 'CAPTURE_AMOUNT_UNPARSEABLE');
    expect(r.strictMoneyCode).toBe('GROUPING_SEPARATOR');
  });

  it('refuses a signed amount, because the direction already owns the sign', () => {
    refusalOf('out -85 EGP acct:cash Coffee', 'CAPTURE_AMOUNT_NOT_POSITIVE');
  });

  it('refuses an amount outside safe integer milliunits', () => {
    refusalOf(`out ${'9'.repeat(20)} EGP acct:cash Absurd`, 'CAPTURE_AMOUNT_UNPARSEABLE');
  });
});

describe('§9.1(5) a currency omission is refused, not defaulted', () => {
  it('does not fall back to the account currency or to the base currency', () => {
    refusalOf('out 85 acct:cash Coffee', 'CAPTURE_CURRENCY_MISSING');
    const parsed = parseDailyCaptureReply('out 85 acct:cash Coffee', CTX);
    expect(parsed.candidates).toHaveLength(0);
  });

  it('case-folds a known code, because folding cannot produce a DIFFERENT currency', () => {
    expect(candidateOf('out 85 egp acct:cash Coffee').currency).toBe('EGP');
  });

  it('keeps a foreign amount in its own currency and attaches no rate', () => {
    const c = candidateOf('out 20 USD acct:main-card Foreign purchase');
    expect(c.currency).toBe('USD');
    expect(c.amount).toBe(-20_000);
    expect(JSON.stringify(c)).not.toMatch(/perUnit|fx|rate/iu);
  });
});

describe('§9.1(6) account resolution refuses both nothing and more than one', () => {
  it('refuses an unknown alias', () => {
    refusalOf('out 85 EGP acct:not-a-thing Coffee', 'CAPTURE_ACCOUNT_UNKNOWN');
  });

  it('refuses an alias that resolves to two accounts rather than picking one', () => {
    refusalOf('out 85 EGP acct:twin Coffee', 'CAPTURE_ACCOUNT_UNKNOWN');
  });

  it('refuses when the alias map is empty, with no default account anywhere', () => {
    refusalOf('out 85 EGP acct:cash Coffee', 'CAPTURE_ACCOUNT_UNKNOWN', {
      ...CTX,
      accountAliases: [],
    });
  });
});

describe('§9.1(7) dates', () => {
  it('accepts a validly back-dated line at the stated date', () => {
    expect(candidateOf('out 240 EGP acct:cash Groceries @2026-09-01').date).toBe('2026-09-01');
  });

  it('defaults to the capture date when no override is given', () => {
    expect(candidateOf('out 240 EGP acct:cash Groceries').date).toBe('2026-09-02');
  });

  it('refuses a future date and a non-existent calendar day', () => {
    refusalOf('out 1 EGP acct:cash X @2026-09-03', 'CAPTURE_DATE_IN_FUTURE');
    refusalOf('out 1 EGP acct:cash X @2026-02-30', 'CAPTURE_DATE_MALFORMED');
  });

  it('refuses two date tokens rather than choosing between them', () => {
    refusalOf('out 1 EGP acct:cash X @2026-09-01 @2026-09-02', 'CAPTURE_DATE_MALFORMED');
  });
});

describe('§9.1(8) and (9) capture is structurally idempotent', () => {
  it('produces the same idempotency key and content hash for the same reply', () => {
    const a = buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 1, reply: 'out 1 EGP acct:cash X' });
    const b = buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 1, reply: 'out 1 EGP acct:cash X' });
    expect(a).toEqual(b);
    expect(a.idempotencyKey).toBe(dailyCaptureIdempotencyKey('2026-09-02', 1));
    expect(a.channel).toBe(CAPTURE_CHANNEL);
  });

  it('produces the SAME key with a DIFFERENT hash when the bytes change — the §3.3 finding', () => {
    const first = buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 1, reply: 'out 1 EGP acct:cash X' });
    const changed = buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 1, reply: 'out 2 EGP acct:cash X' });
    expect(changed.idempotencyKey).toBe(first.idempotencyKey);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it('stores the reply verbatim, without trimming, re-casing or re-wrapping', () => {
    const reply = '  Out 1 EGP acct:CASH  X  \n\n';
    expect(buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 1, reply }).rawPayload).toBe(reply);
  });

  it('is assignable to the repository append shape, so the two cannot drift', () => {
    const event = buildCapturedSourceEvent({ ownerLocalDate: '2026-09-02', sequence: 2, reply: 'none' });
    const append: SourceEventAppend = event;
    expect(append.channel).toBe(CAPTURE_CHANNEL);
    expect(append.idempotencyKey).toBe('2026-09-02#2');
  });

  it('rejects a non-positive or fractional reply sequence', () => {
    expect(() => dailyCaptureIdempotencyKey('2026-09-02', 0)).toThrow(RangeError);
    expect(() => dailyCaptureIdempotencyKey('2026-09-02', 1.5)).toThrow(RangeError);
  });
});

describe('§9.1(10) the prompt is deterministic, figure-free and declinable', () => {
  it('is byte-identical for the same owner-local date', () => {
    expect(composeDailyCapturePrompt('2026-09-02')).toEqual(composeDailyCapturePrompt('2026-09-02'));
  });

  it('is identified by the owner-local date alone, so two schedulers cannot ask twice', () => {
    expect(composeDailyCapturePrompt('2026-09-02').promptId).toBe('daily-capture:2026-09-02');
    expect(composeDailyCapturePrompt('2026-09-03').promptId).not.toBe('daily-capture:2026-09-02');
  });

  it('carries no digit other than the date and the format placeholders', () => {
    const text = composeDailyCapturePrompt('2026-09-02').text;
    const withoutDates = text.replace(/2026-09-02/gu, '').replace(/YYYY-MM-DD/gu, '');
    expect(withoutDates).not.toMatch(/\d/u);
  });

  it('names the declination token verbatim so the owner never guesses it', () => {
    expect(composeDailyCapturePrompt('2026-09-02').text).toContain(CAPTURE_DECLINATION_REPLY);
  });

  it('refuses to compose a prompt for a date that is not a calendar day', () => {
    expect(() => composeDailyCapturePrompt('2026-02-30')).toThrow(RangeError);
    expect(() => composeDailyCapturePrompt('02-09-2026')).toThrow(RangeError);
  });
});

describe('§9.1(10a) declination', () => {
  it('accepts the token as a whole reply with zero candidates and zero refusals', () => {
    for (const reply of ['none', 'None', '  NONE  ']) {
      const parsed = parseDailyCaptureReply(reply, CTX);
      expect(parsed.declined).toBe(true);
      expect(parsed.candidates).toHaveLength(0);
      expect(parsed.refusals).toHaveLength(0);
    }
  });

  it('does not treat a reply that merely CONTAINS the token as a declination', () => {
    const parsed = parseDailyCaptureReply('out 1 EGP acct:cash none of your business', CTX);
    expect(parsed.declined).toBe(false);
    expect(parsed.candidates).toHaveLength(1);
  });
});

describe('§9.1(11) provenance and dedup', () => {
  it('records honest provenance with no invented verification level', () => {
    const info = candidateOf('out 85.500 EGP acct:main-card Coffee shop').importInfo;
    expect(info).not.toBeNull();
    expect(info?.extractionMethod).toBe('manual');
    expect(info?.sourceType).toBe('manual');
    expect(info?.parserVersion).toBe(CAPTURE_GRAMMAR_VERSION);
    expect(info?.sourceFile).toBe(CTX.sourceEventRef);
    expect(info?.duplicateKey).toBe(info?.contentHash);
    expect(info?.normalizedPayee).toBe('coffee shop');
  });

  it('hashes out and in differently even at the same magnitude', () => {
    const shared = { date: '2026-09-02', magnitude: 85_500, currency: 'EGP', accountId: 'acc-synth-1', normalizedPayee: 'x' } as const;
    expect(captureContentHash({ ...shared, direction: 'out' })).not.toBe(
      captureContentHash({ ...shared, direction: 'in' }),
    );
  });

  it('gives a same-day repeat the same dedup key but distinct ids, for owner review', () => {
    const parsed = parseDailyCaptureReply(
      ['out 85.500 EGP acct:main-card Coffee shop', 'out 85.500 EGP acct:main-card Coffee shop'].join('\n'),
      CTX,
    );
    expect(parsed.candidates).toHaveLength(2);
    const [a, b] = parsed.candidates;
    expect(a!.importInfo?.duplicateKey).toBe(b!.importInfo?.duplicateKey);
    expect(a!.id).not.toBe(b!.id);
    // Fail closed: neither is claimed unique, and neither is silently discarded.
    expect([a!.duplicateStatus, b!.duplicateStatus]).toEqual(['ambiguous', 'ambiguous']);
  });

  it('is a pure re-parse: the same reply yields byte-identical candidates', () => {
    const reply = 'out 85.500 EGP acct:main-card Coffee shop\nin 12000 EGP acct:cash Salary';
    expect(parseDailyCaptureReply(reply, CTX)).toEqual(parseDailyCaptureReply(reply, CTX));
  });

  it('mixes candidates and refusals per line without either contaminating the other', () => {
    const parsed = parseDailyCaptureReply(
      ['out 85.500 EGP acct:main-card Coffee shop', 'out 1,200 EGP acct:cash Rent', '', 'in 5 EGP acct:cash Gift'].join('\n'),
      CTX,
    );
    expect(parsed.candidates.map((c) => c.amount)).toEqual([-85_500, 5_000]);
    expect(parsed.refusals.map((r) => [r.code, r.lineNumber])).toEqual([['CAPTURE_AMOUNT_UNPARSEABLE', 2]]);
  });
});

describe('§9.1(12) tamper controls — a guard that cannot be made to fail is not a guard', () => {
  it('a default currency WOULD be caught: the missing-currency refusal is the only outcome', () => {
    // The tamper this fences is `currency = token ?? account.currency`. If that were introduced,
    // this expectation flips from a refusal to a candidate and the test fails.
    const outcome = parseCaptureLine('out 85 acct:cash Coffee', 1, CTX);
    expect('refusal' in outcome).toBe(true);
  });

  it('a sign inferred from a keyword WOULD be caught: no keyword sets the direction', () => {
    for (const line of ['paid 85 EGP acct:cash Coffee', 'received 85 EGP acct:cash Gift', 'spent 85 EGP acct:cash X']) {
      refusalOf(line, 'CAPTURE_DIRECTION_MISSING');
    }
  });

  it('an auto-promotion WOULD be caught: no produced candidate is ever approved or cleared', () => {
    const parsed = parseDailyCaptureReply(
      Array.from({ length: 10 }, (_, i) => `out ${i + 1} EGP acct:cash Repeat payee`).join('\n'),
      CTX,
    );
    expect(parsed.candidates).toHaveLength(10);
    // Repetition is exactly the signal a "promote the obvious ones" shortcut would key off.
    expect(parsed.candidates.every((c) => c.approved === false)).toBe(true);
    expect(parsed.candidates.every((c) => c.cleared === 'uncleared')).toBe(true);
    expect(parsed.candidates.every((c) => c.duplicateStatus !== 'unique')).toBe(true);
  });

  it('a lenient amount parse WOULD be caught: each strict refusal keeps its own reason code', () => {
    expect(refusalOf('out 1.2345 EGP acct:cash X', 'CAPTURE_AMOUNT_UNPARSEABLE').strictMoneyCode).toBe(
      'PRECISION_WOULD_ROUND',
    );
    expect(refusalOf('out 1,200 EGP acct:cash X', 'CAPTURE_AMOUNT_UNPARSEABLE').strictMoneyCode).toBe(
      'GROUPING_SEPARATOR',
    );
    // The Arabic thousands separator is not whitespace, so it survives tokenization and reaches
    // the strict parser. A plain space cannot: the grammar splits on it first, which is why
    // 'out 1 200 EGP ...' refuses CAPTURE_CURRENCY_MISSING instead - asserted below.
    expect(refusalOf('out 1\u066C200 EGP acct:cash X', 'CAPTURE_AMOUNT_UNPARSEABLE').strictMoneyCode).toBe(
      'GROUPING_SEPARATOR',
    );
    refusalOf('out 1 200 EGP acct:cash X', 'CAPTURE_CURRENCY_MISSING');
    expect(refusalOf('out abc EGP acct:cash X', 'CAPTURE_AMOUNT_UNPARSEABLE').strictMoneyCode).toBe('NOT_A_NUMBER');
  });

  it('the module surface offers no promote, approve, or canonical-write function', () => {
    // Read the module's OWN export list, so adding such a function later fails here rather than
    // passing quietly. §8: this contract authorizes no canonical write and no promotion.
    const exported = Object.keys(captureModule).sort();
    expect(exported.filter((name) => /promote|approve|commit|canonical|reconcile|transfer/iu.test(name))).toEqual([]);
    // And nothing here reaches a store: the module names no repository or connection export.
    expect(exported.filter((name) => /repository|store|connection|db$/iu.test(name))).toEqual([]);
    expect(exported.length).toBeGreaterThan(0);
  });

  it('reads the module source and finds no float, clock, network or randomness', () => {
    const source = readFileSync(join(process.cwd(), 'src/server/ingest/dailyCapture.ts'), 'utf8');
    const body = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    for (const forbidden of ['parseFloat', 'toFixed(', 'Math.round', 'Math.random', 'Date.now(', 'fetch(']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});
