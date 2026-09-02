/**
 * NIZAM · Daily transaction capture — the deterministic ask / capture / parse of the owner's day
 * Owning contract: PFOS Contract 15 (Daily Transaction Capture and Candidate Staging),
 *   subordinate to Contract 02 §5 (ingestion, state model, dedup), Contract 03 (the deterministic
 *   engine is the sole source of monetary truth), Contract 06 (store schema and the money
 *   persistence boundary), Contract 14 §5 (deterministic-first routing), and money-rules.md.
 * Phase: Phase 15 — the owner daily capture surface (owner decision D7, 2026-09-02).
 * Depends on: node:crypto (digest only), ../../lib/money/money.ts, ../../lib/money/currency.ts,
 *   and TYPES ONLY from ../../lib/db/schema.ts and ../../features/transactions/transaction.types.ts.
 *
 * WHAT THIS MODULE IS NOT. It holds no clock, no network, no model call, no store handle, no
 * randomness and no float. It writes nothing. It never promotes a candidate, never sets
 * `approved`, and never touches canonical `transactions[]`. The owner states an amount and this
 * module converts it to integer milliunits or REFUSES — there is no third outcome (Contract 15 §5).
 *
 * WHY IT IS NOT A HERMES TOOL. `src/server/hermes/runtimeAdapter.ts` already refuses any bounded
 * tool payload key matching amount/balance/currency/money/price/cost/financial, so a monetary
 * field is unrepresentable across the Hermes tool boundary. A capture tool would have required
 * weakening that guard. It is not weakened and `HERMES_TOOL_NAMES` is unchanged (Contract 15 §2.1).
 */
import { createHash } from 'node:crypto';

import { CURRENCY_CODE_PATTERN, type CurrencyCode } from '../../lib/money/currency.ts';
import { StrictMoneyError, fromDecimalStrict, type Money } from '../../lib/money/money.ts';
import type { TransactionCandidate } from '../../lib/db/schema.ts';
import type { ImportInfo } from '../../features/transactions/transaction.types.ts';

/** One capture channel, so a row count answers "how many days replied" (Contract 15 §3.1). */
export const CAPTURE_CHANNEL = 'owner_daily_capture';

/** Bumped whenever the §5.2 grammar changes, so a re-parse at a newer grammar is detectable. */
export const CAPTURE_GRAMMAR_VERSION = 1;

/** Per-reply line bound. A reply longer than this is refused whole rather than truncated. */
export const MAX_CAPTURE_LINES = 40;

/**
 * The exact reply that records "nothing moved today" (Contract 15 §6.2, declinable without
 * penalty). ONE token, matched exactly after trimming and case-folding. It is deliberately not a
 * keyword list: guessing that some phrase means "nothing" is the kind of inference this module
 * exists to avoid, and the prompt text below states the token verbatim so the owner never guesses.
 */
export const CAPTURE_DECLINATION_REPLY = 'none';

/** Contract 15 §5.3. Every failure is one of these; none of them produces a partial candidate. */
export const CAPTURE_REFUSAL_CODES = [
  'CAPTURE_LINE_EMPTY',
  'CAPTURE_DIRECTION_MISSING',
  'CAPTURE_AMOUNT_MISSING',
  'CAPTURE_AMOUNT_UNPARSEABLE',
  'CAPTURE_AMOUNT_NOT_POSITIVE',
  'CAPTURE_CURRENCY_MISSING',
  'CAPTURE_CURRENCY_UNKNOWN',
  'CAPTURE_ACCOUNT_MISSING',
  'CAPTURE_ACCOUNT_UNKNOWN',
  'CAPTURE_PAYEE_MISSING',
  'CAPTURE_DATE_MALFORMED',
  'CAPTURE_DATE_IN_FUTURE',
  'CAPTURE_TOO_MANY_LINES',
] as const;
export type CaptureRefusalCode = (typeof CAPTURE_REFUSAL_CODES)[number];

export const CAPTURE_DIRECTIONS = ['out', 'in'] as const;
export type CaptureDirection = (typeof CAPTURE_DIRECTIONS)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A refusal carries its code, the line number, and — when the strict money parser refused — that
 * parser's own reason code, unflattened. It NEVER carries the offending amount text, so a refusal
 * can be logged and surfaced without echoing a figure back through a model path.
 */
export interface CaptureRefusal {
  readonly code: CaptureRefusalCode;
  /** 1-based, counted over the reply's physical lines so the owner can point at one. */
  readonly lineNumber: number;
  /** Present only for `CAPTURE_AMOUNT_UNPARSEABLE`. */
  readonly strictMoneyCode?: string;
}

/** An account the owner may name. An array, not a map, so a duplicated alias is representable. */
export interface CaptureAccountAlias {
  readonly alias: string;
  readonly accountId: string;
}

export interface CaptureContext {
  /** The owner-local day this reply belongs to, `YYYY-MM-DD`. Supplied, never read from a clock. */
  readonly captureDate: string;
  /** Currencies the store knows. A code outside this set is refused, never coerced. */
  readonly knownCurrencies: readonly CurrencyCode[];
  /** Alias resolution input. Contract 15 §10.3: a caller input, not a stored registry. */
  readonly accountAliases: readonly CaptureAccountAlias[];
  /** Reference to the `source_events` row this reply was captured as. Provenance anchor. */
  readonly sourceEventRef: string;
}

/** The structural shape `sourceEventsRepository.append` accepts, restated so this module stays
 * free of a store dependency. Field names match the repository exactly and are asserted by test. */
export interface CapturedSourceEvent {
  readonly id: string;
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly contentHash: string;
  readonly rawPayload: string;
}

export interface DailyCapturePrompt {
  /** Identity of the ask. The owner-local date alone, so two schedulers cannot ask twice. */
  readonly promptId: string;
  readonly ownerLocalDate: string;
  readonly text: string;
}

export interface DailyCaptureParse {
  readonly captureDate: string;
  /** True only when the whole reply is exactly {@link CAPTURE_DECLINATION_REPLY}. */
  readonly declined: boolean;
  readonly candidates: readonly TransactionCandidate[];
  readonly refusals: readonly CaptureRefusal[];
}

// ---------------------------------------------------------------------------------------------
// §6 — the asking half
// ---------------------------------------------------------------------------------------------

/**
 * Compose the daily prompt. Deterministic: same owner-local date in, byte-identical text out.
 *
 * No model is called, so the ask spends nothing against any cap and cannot fail because a provider
 * is unreachable. The text carries NO figure — no balance, no total, no remaining budget, no
 * comparison with yesterday (Contract 15 §6.2). It asks; it does not report.
 */
export function composeDailyCapturePrompt(ownerLocalDate: string): DailyCapturePrompt {
  assertIsoDate(ownerLocalDate, 'ownerLocalDate');
  const text = [
    `Daily capture for ${ownerLocalDate}. What moved today?`,
    '',
    'One movement per line:',
    '  out <amount> <CUR> acct:<alias> <payee> [@YYYY-MM-DD] [| memo]',
    '  in  <amount> <CUR> acct:<alias> <payee> [@YYYY-MM-DD] [| memo]',
    '',
    `Nothing to record? Reply exactly: ${CAPTURE_DECLINATION_REPLY}`,
    '',
    'Everything captured here is staged for your review. Nothing is added to the ledger',
    'until you promote it.',
  ].join('\n');
  return Object.freeze({ promptId: `daily-capture:${ownerLocalDate}`, ownerLocalDate, text });
}

/** Contract 15 §3.1. Identity of a reply within its owner-local day. */
export function dailyCaptureIdempotencyKey(ownerLocalDate: string, sequence: number): string {
  assertIsoDate(ownerLocalDate, 'ownerLocalDate');
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('NIZAM capture: reply sequence must be a positive safe integer');
  }
  return `${ownerLocalDate}#${sequence}`;
}

/**
 * Build the verbatim capture row. The reply's bytes are NOT normalized, trimmed, re-cased or
 * re-wrapped: they are the owner's and a future parser may read them (Contract 15 §3.1, §3.4).
 * Capture durability and parse success are independent by design.
 */
export function buildCapturedSourceEvent(input: {
  readonly ownerLocalDate: string;
  readonly sequence: number;
  readonly reply: string;
}): CapturedSourceEvent {
  const idempotencyKey = dailyCaptureIdempotencyKey(input.ownerLocalDate, input.sequence);
  const contentHash = sha256(input.reply);
  return Object.freeze({
    id: `srcev_${CAPTURE_CHANNEL}_${input.ownerLocalDate}_${input.sequence}`,
    channel: CAPTURE_CHANNEL,
    idempotencyKey,
    contentHash,
    rawPayload: input.reply,
  });
}

// ---------------------------------------------------------------------------------------------
// §5 — the money origination boundary
// ---------------------------------------------------------------------------------------------

/**
 * Parse one capture line. Returns a candidate OR a refusal, never both and never a partial.
 *
 * The sign comes from `direction` and ONLY from `direction`; the amount token is an unsigned
 * magnitude. A signed amount here would compete with the direction for authority over the sign,
 * and a wrong sign is a double-magnitude error, so a non-positive magnitude is refused.
 */
export function parseCaptureLine(
  line: string,
  lineNumber: number,
  ctx: CaptureContext,
): { readonly candidate: TransactionCandidate } | { readonly refusal: CaptureRefusal } {
  const refuse = (code: CaptureRefusalCode, strictMoneyCode?: string) => ({
    refusal: Object.freeze(
      strictMoneyCode === undefined ? { code, lineNumber } : { code, lineNumber, strictMoneyCode },
    ),
  });

  const whole = line.trim();
  if (whole === '') return refuse('CAPTURE_LINE_EMPTY');

  // memo is split off first so a `|` inside a memo cannot be read as structure
  const pipeAt = whole.indexOf('|');
  const memo = pipeAt < 0 ? '' : whole.slice(pipeAt + 1).trim();
  const head = pipeAt < 0 ? whole : whole.slice(0, pipeAt).trim();

  // any `@`-prefixed token is a date override; malformed is refused, never demoted to payee text
  const rawTokens = head.split(/\s+/u).filter((t) => t !== '');
  const dateTokens = rawTokens.filter((t) => t.startsWith('@'));
  if (dateTokens.length > 1) return refuse('CAPTURE_DATE_MALFORMED');
  let date = ctx.captureDate;
  if (dateTokens.length === 1) {
    const override = dateTokens[0]!.slice(1);
    if (!isCalendarDate(override)) return refuse('CAPTURE_DATE_MALFORMED');
    if (override > ctx.captureDate) return refuse('CAPTURE_DATE_IN_FUTURE');
    date = override;
  }
  const tokens = rawTokens.filter((t) => !t.startsWith('@'));

  const directionToken = (tokens[0] ?? '').toLowerCase();
  if (!isDirection(directionToken)) return refuse('CAPTURE_DIRECTION_MISSING');

  const amountToken = tokens[1];
  if (amountToken === undefined) return refuse('CAPTURE_AMOUNT_MISSING');
  let magnitude: Money;
  try {
    magnitude = fromDecimalStrict(amountToken);
  } catch (error) {
    if (error instanceof StrictMoneyError) return refuse('CAPTURE_AMOUNT_UNPARSEABLE', error.code);
    return refuse('CAPTURE_AMOUNT_UNPARSEABLE');
  }
  if (magnitude <= 0) return refuse('CAPTURE_AMOUNT_NOT_POSITIVE');

  const currencyToken = tokens[2];
  if (currencyToken === undefined || !/^[A-Za-z]{3}$/u.test(currencyToken)) {
    return refuse('CAPTURE_CURRENCY_MISSING');
  }
  // Case folding is NOT inference: it cannot produce a DIFFERENT currency. Defaulting would be,
  // and is never done — Contract 6 I1.2, currency is required and never inferred from the account.
  const currency = currencyToken.toUpperCase();
  if (!CURRENCY_CODE_PATTERN.test(currency) || !ctx.knownCurrencies.includes(currency)) {
    return refuse('CAPTURE_CURRENCY_UNKNOWN');
  }

  const accountToken = tokens[3];
  if (accountToken === undefined || !accountToken.toLowerCase().startsWith('acct:')) {
    return refuse('CAPTURE_ACCOUNT_MISSING');
  }
  const alias = accountToken.slice('acct:'.length).trim().toLowerCase();
  if (alias === '') return refuse('CAPTURE_ACCOUNT_MISSING');
  const matches = ctx.accountAliases.filter((entry) => entry.alias.trim().toLowerCase() === alias);
  // Zero AND more-than-one are the same refusal: neither identifies an account, and there is no
  // "the usual account" fallback anywhere in this path.
  if (matches.length !== 1) return refuse('CAPTURE_ACCOUNT_UNKNOWN');
  const accountId = matches[0]!.accountId;

  const payee = tokens.slice(4).join(' ').trim();
  if (payee === '') return refuse('CAPTURE_PAYEE_MISSING');

  const amount: Money = directionToken === 'out' ? -magnitude : magnitude;
  const normalizedPayee = payee.toLowerCase().replace(/\s+/gu, ' ');
  const contentHash = captureContentHash({
    date,
    direction: directionToken,
    magnitude,
    currency,
    accountId,
    normalizedPayee,
  });

  const importInfo: ImportInfo = {
    duplicateKey: contentHash,
    // There is no file. The capture row is the honest provenance anchor (Contract 15 §7.1).
    sourceFile: ctx.sourceEventRef,
    sourcePageOrSheet: `line:${lineNumber}`,
    // Honest: the owner typed it. Labelling it `parser` would overstate its verification level.
    extractionMethod: 'manual',
    // A statement about PROVENANCE, not about correctness. It authorizes no promotion.
    confidenceScore: 1,
    confidenceReason: 'owner-stated in daily capture; amount converted by strict milliunit parse',
    batchId: ctx.sourceEventRef,
    contentHash,
    parserVersion: CAPTURE_GRAMMAR_VERSION,
    // Contract 15 §10.1: `chat` would be the honest value but widening a closed enum is a schema
    // change under owner sign-off. Nothing is widened here.
    sourceType: 'manual',
    normalizedPayee,
  };

  const candidate: TransactionCandidate = {
    id: `txcand_${contentHash.slice(0, 16)}_${lineNumber}`,
    accountId,
    date,
    payee,
    // Categorization is a budgeting decision, not a reading of the owner's words (§4.4).
    categoryId: null,
    memo,
    amount,
    currency,
    // A conversational report is not a bank confirmation (§4.4).
    cleared: 'uncleared',
    // §4.1 — this path has no code that sets this true.
    approved: false,
    transferAccountId: null,
    transferTransactionId: null,
    splits: null,
    importInfo,
    // §7.2 — fail closed. `unique` is a claim that dedup ran; this module has not run it.
    duplicateStatus: 'ambiguous',
  };
  return { candidate: Object.freeze(candidate) };
}

/**
 * Parse a whole reply. Blank lines are skipped rather than refused, so a trailing newline is not a
 * finding; the empty-line refusal is reachable through {@link parseCaptureLine} directly, which is
 * where an empty line is genuinely a caller error.
 */
export function parseDailyCaptureReply(reply: string, ctx: CaptureContext): DailyCaptureParse {
  assertIsoDate(ctx.captureDate, 'captureDate');
  const frozen = (value: DailyCaptureParse) => Object.freeze(value);

  if (reply.trim().toLowerCase() === CAPTURE_DECLINATION_REPLY) {
    return frozen({ captureDate: ctx.captureDate, declined: true, candidates: [], refusals: [] });
  }

  const physical = reply.split(/\r\n|\n|\r/u);
  const contentLines = physical.filter((line) => line.trim() !== '');
  if (contentLines.length > MAX_CAPTURE_LINES) {
    // Refused whole rather than truncated: keeping the first N would silently drop the rest.
    return frozen({
      captureDate: ctx.captureDate,
      declined: false,
      candidates: [],
      refusals: [Object.freeze({ code: 'CAPTURE_TOO_MANY_LINES' as const, lineNumber: 1 })],
    });
  }

  const candidates: TransactionCandidate[] = [];
  const refusals: CaptureRefusal[] = [];
  physical.forEach((line, index) => {
    if (line.trim() === '') return;
    const outcome = parseCaptureLine(line, index + 1, ctx);
    if ('candidate' in outcome) candidates.push(outcome.candidate);
    else refusals.push(outcome.refusal);
  });
  return frozen({
    captureDate: ctx.captureDate,
    declined: false,
    candidates: Object.freeze(candidates),
    refusals: Object.freeze(refusals),
  });
}

/**
 * Deterministic fingerprint over the financially consequential fields ONLY.
 * `memo` and `categoryId` are deliberately excluded, so a later edit cannot change the
 * fingerprint (Contract 15 §7.1). The magnitude is used rather than the signed amount, with the
 * direction carried as its own field, so `out 5` and `in 5` hash differently by construction.
 */
export function captureContentHash(fields: {
  readonly date: string;
  readonly direction: CaptureDirection;
  readonly magnitude: Money;
  readonly currency: CurrencyCode;
  readonly accountId: string;
  readonly normalizedPayee: string;
}): string {
  const canonical = [
    fields.date,
    fields.direction,
    // Integer milliunits, rendered as an integer. No decimal form enters the hash input.
    String(fields.magnitude),
    fields.currency,
    fields.accountId,
    fields.normalizedPayee,
  ].join('\u0000');
  return sha256(canonical);
}

/** One clarifying question per refusal. Fixed text: a model never composes a money question. */
export function clarifyingQuestionFor(refusal: CaptureRefusal): string {
  const at = `Line ${refusal.lineNumber}: `;
  switch (refusal.code) {
    case 'CAPTURE_LINE_EMPTY':
      return `${at}the line is empty. Send the movement, or "${CAPTURE_DECLINATION_REPLY}" for a day with nothing.`;
    case 'CAPTURE_DIRECTION_MISSING':
      return `${at}start the line with "out" or "in". I will not guess the direction.`;
    case 'CAPTURE_AMOUNT_MISSING':
      return `${at}no amount followed the direction. What was the amount?`;
    case 'CAPTURE_AMOUNT_UNPARSEABLE':
      return `${at}the amount was not a plain decimal with at most three decimal places, so it was refused rather than rounded. Please restate it.`;
    case 'CAPTURE_AMOUNT_NOT_POSITIVE':
      return `${at}give the amount as a positive magnitude; "out" or "in" carries the direction.`;
    case 'CAPTURE_CURRENCY_MISSING':
      return `${at}no currency code followed the amount. Which currency?`;
    case 'CAPTURE_CURRENCY_UNKNOWN':
      return `${at}that currency code is not one this store knows. I will not substitute another.`;
    case 'CAPTURE_ACCOUNT_MISSING':
      return `${at}name the account as "acct:<alias>". There is no default account.`;
    case 'CAPTURE_ACCOUNT_UNKNOWN':
      return `${at}that account alias matches nothing, or matches more than one. Which account?`;
    case 'CAPTURE_PAYEE_MISSING':
      return `${at}nothing was left to read as a payee. Who was it paid to, or received from?`;
    case 'CAPTURE_DATE_MALFORMED':
      return `${at}a back-date must be one "@YYYY-MM-DD" token.`;
    case 'CAPTURE_DATE_IN_FUTURE':
      return `${at}that date is later than the capture date. I only record what has happened.`;
    case 'CAPTURE_TOO_MANY_LINES':
      return `The reply exceeded ${MAX_CAPTURE_LINES} lines, so none of it was parsed rather than part of it being dropped. Please send it in smaller batches.`;
  }
}

// ---------------------------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isDirection(value: string): value is CaptureDirection {
  return (CAPTURE_DIRECTIONS as readonly string[]).includes(value);
}

/** Shape only. Used where a malformed value is a caller error rather than an owner typo. */
function assertIsoDate(value: string, label: string): void {
  if (!isCalendarDate(value)) {
    throw new RangeError(`NIZAM capture: ${label} must be a real YYYY-MM-DD calendar date`);
  }
}

/** Shape AND existence: `2026-02-30` is well-shaped and is not a day. */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
