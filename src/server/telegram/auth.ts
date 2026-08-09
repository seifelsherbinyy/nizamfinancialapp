/**
 * NIZAM · Telegram request authenticity — constant-time token compare, then the allowlist
 * Implemented by: PFOS Contract 12 / Phase 4.1, extended by Phase 10.5 (spec 06-two-agent-vps)
 * Owning requirements: R11 (secret-token header, constant-time), R12 (operator allowlist),
 *   R26 (the transport mode selects which gates are applicable)
 * Depends on: node:crypto, ../ports/telegram (types only), ../ports/errors (codes only)
 *
 * Contract 12 §5.2 and §5.3 in code, ported from the other repository's relay per §5.1: the
 * same two checks, in the same order, with the same constant-time property. No new scheme, and
 * nothing weakened. This module lives in `src/server/telegram/` rather than under `ports/`
 * because `ports/` is interface-only (asserted by `ports/interfaceOnly.test.ts`); `mocks/` and
 * `signals/` set the sibling precedent.
 *
 * The five §5.2 rules, each made mechanical rather than documented:
 *
 *  1. **A request with no token header is rejected, and absent is not empty.** The port already
 *     models the distinction — `secretTokenHeader: string | null`, where `null` is *absent* and
 *     `''` is *present and empty* — so this module keeps them distinguishable in the audit
 *     ({@link TelegramAuthAuditLine.tokenHeaderPresent}) while refusing both.
 *  2. **A mismatched token is rejected**, and so is one that is a prefix, a superstring, or a
 *     same-length near-miss of the configured value.
 *  3. **The comparison is constant-time.** {@link constantTimeTokenEquals} is the only
 *     comparison in this module that touches the token, and it contains no branch, no loop, no
 *     early exit, and no `===`. See the note on that function for the length-mismatch problem
 *     and how it is removed rather than special-cased.
 *  4. **The refusal reveals nothing about which check failed, and no timing signal
 *     distinguishes them.** Two devices, together:
 *       - {@link TelegramAuthDecision}'s refusal variant has no reason field — there is nowhere
 *         to put one — and every refusal returns the *same frozen object*
 *         ({@link TELEGRAM_AUTH_REFUSED}), so two refusals are identical by reference and a
 *         per-reason shape cannot be constructed by accident.
 *       - all three gates are evaluated **unconditionally, before any of them is consulted**,
 *         which is the house pattern `signals/consentGate.ts` already uses for its two
 *         independent gates. An absent header therefore performs the same digest work as a
 *         wrong one, so wall-clock time does not say which stage refused. §5.3's ordering
 *         survives as the *precedence* the verdicts are read in, which is what "checked after
 *         the token check" governs: a bad token is refused whatever the allowlist says.
 *  5. **The token is never logged, never in an error, and never echoed back.** The audit line
 *     carries the *fact* of presence as a boolean and no value; this module raises no error
 *     carrying a token, formats no token into a message, and returns no token to a caller.
 *
 * **Fail closed (§5.2, last rule).** An expected token that is absent, empty, or not a value the
 * provider could ever echo refuses *every* request — including one carrying what a reader might
 * think is the right token. {@link secretTokenIsConfigured} is the whole of it, and it is
 * consulted first, so an unconfigured guard is a closed door rather than an open one.
 *
 * ---
 *
 * **The mode axis (R26, design delta D1, added by Phase 10.5).** Two of the three gates above
 * guard an *inbound HTTP request*. `longPoll` is outbound only: the agent calls the provider and
 * reads updates back, so there is no request, no `X-Telegram-Bot-Api-Secret-Token` header to
 * consult, and no door for an expected token to guard. Reusing this guard unchanged under
 * `longPoll` therefore refuses **every** message the owner sends — `secretTokenHeader` is `null`,
 * the token gate cannot pass, and the failure presents as a bot that was created, verified live,
 * and is silently broken, with a symptom identical to a wrong token by design (rule 4 above).
 *
 * So {@link authorizeDelivery} takes the mode as an input, and
 * {@link TELEGRAM_MODE_APPLICABLE_GATES} is the whole of the asymmetry: the mode selects **which
 * gates are applicable**, and the applicable set is a property of the *mode*, never of the
 * *values*. Three things follow, and each is asserted in `modeAwareGuard.negative.test.ts`:
 *
 *  - **`webhook` is untouched.** All three gates apply, read in the same order, so R11's
 *    fail-closed clause still refuses an absent, empty, over-length, or out-of-charset expected
 *    token. Nothing below reads the mode before deciding whether a *value* is usable.
 *  - **`longPoll` keeps the allowlist as the whole guard**, and the allowlist refuses by default:
 *    {@link senderIsAllowlisted} answers false for an empty list and for an empty sender
 *    identifier, so an unconfigured `longPoll` deployment admits **nobody**. "Not applicable" is
 *    not a default that opens a door, and there is no branch here that skips a gate because a
 *    value was absent — the two rejected shapes in D1 are rejected in code, not just in prose.
 *  - **An unrecognised mode is refused at its strictest.** The lookup is undefined for a mode this
 *    module does not know, and the fallback is the full set rather than the empty one, so a typo
 *    in configuration cannot open a gate. `parseTransportMode` already refuses such a value at
 *    startup; this is the second belt.
 *
 * The refusal stays indistinguishable as to stage in both modes, because the decision type has no
 * reason field and every refusal returns the one frozen value.
 *
 * **§5.3, and why parsing cannot precede the allowlist here.** The allowlist is checked before
 * any parsing of content. This module makes that structural instead of procedural:
 * {@link TelegramAuthSubject} is a three-field projection of {@link TelegramDelivery} that
 * **omits `rawBody` entirely**. The authorizer is never handed the content, so it cannot parse
 * it, cannot log it, and cannot leak it — and a caller that wants to parse must first hold a
 * granted decision. An **empty** allowlist means nobody, not everybody.
 *
 * No literal here names a bot, a sender, a token, a host, or a path (R24). The only literal is
 * the provider's own header name, which is public protocol, not a deployment particular.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { PortFailureCode } from '../ports/errors';
import type { TelegramDelivery, TelegramTransportConfig, TelegramTransportMode } from '../ports/telegram';

/**
 * The header the provider echoes on every request (architecture §1.4). Public protocol: it is
 * the *name* of the field, never a value, so naming it here is not a deployment particular.
 */
export const TELEGRAM_SECRET_TOKEN_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

/**
 * The provider's own rule for a secret token (architecture §1.4): 1-256 characters drawn from
 * `[A-Za-z0-9_-]`. A configured value outside this set can never be echoed back, so a handler
 * holding one would refuse every request anyway — treating it as *unconfigured* makes that
 * outcome deliberate rather than incidental, and keeps the failure code honest.
 */
export const TELEGRAM_SECRET_TOKEN_MAX_LENGTH = 256;
export const TELEGRAM_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * The digest used to equalize operand length before the timing-safe compare. Named so the test
 * can assert the compared width, rather than restating the number.
 */
export const TOKEN_DIGEST_ALGORITHM = 'sha256';
export const TOKEN_DIGEST_BYTES = 32;
export const TOKEN_DIGEST_KEY_BYTES = 32;

/**
 * Keyed digest of one operand. Length-independent output by construction: whatever the input's
 * length, the result is exactly {@link TOKEN_DIGEST_BYTES} bytes.
 */
export function equalizedTokenDigest(value: string, key: Buffer): Buffer {
  return createHmac(TOKEN_DIGEST_ALGORITHM, key).update(value, 'utf8').digest();
}

/**
 * **The constant-time comparison (R11).**
 *
 * §5.2 is explicit that this is a functional requirement, not an optimization: a
 * short-circuiting equality comparison leaks the length and the matching prefix through timing,
 * and over many requests that recovers the secret.
 *
 * The subtlety the task names, and how it is handled. `node:crypto`'s `timingSafeEqual` is the
 * right primitive but it **throws** when the two buffers differ in length — and that throw is
 * itself a timing signal (and a control-flow one), so guarding it with an `if (a.length !==
 * b.length)` merely relocates the leak into the guard. The fix is to make the length mismatch
 * *impossible to reach* rather than to detect it: both operands are first reduced to a keyed
 * digest, which is always {@link TOKEN_DIGEST_BYTES} bytes wide. `timingSafeEqual` therefore
 * receives two equal-length buffers on every call, cannot throw, and compares the same number
 * of bytes for a one-character token as for a 4096-character one. There is no length branch in
 * this function because there is no length question left to ask.
 *
 * The key is drawn fresh per call, which is why this is a keyed digest rather than a plain hash:
 * an attacker cannot precompute digests, cannot compare them offline, and cannot exploit a
 * collision found against a fixed key. This is the well-known double-HMAC verification form of
 * the same guarantee the other repository's `hmac.compare_digest` provides.
 *
 * The body is deliberately branch-free — one statement, one `return`, no `if`, no loop, no
 * `break`, no `===` — and `auth.constantTime.test.ts` asserts that structurally, because a
 * wall-clock timing assertion is flaky and would not survive a shared CI host.
 */
export function constantTimeTokenEquals(provided: string, expected: string): boolean {
  const key = randomBytes(TOKEN_DIGEST_KEY_BYTES);
  return timingSafeEqual(equalizedTokenDigest(provided, key), equalizedTokenDigest(expected, key));
}

/**
 * The only three fields authenticity needs. `rawBody` is **absent on purpose** (§5.3): the
 * authorizer cannot parse, log, or leak content it was never handed, so "the allowlist is
 * checked before any parsing of content" holds structurally rather than by convention.
 */
export type TelegramAuthSubject = Pick<TelegramDelivery, 'botId' | 'senderId' | 'secretTokenHeader'>;

/** The subject's key set, exported so the omission of `rawBody` is assertable, not just stated. */
export const TELEGRAM_AUTH_SUBJECT_KEYS = ['botId', 'senderId', 'secretTokenHeader'] as const;

/**
 * The injected authenticity policy. Both halves are resolved from the host environment at run
 * time; this module supplies no default for either, because a default here would be the open
 * door §5.2 forbids.
 *
 * `expectedSecretToken` widens {@link TelegramTransportConfig}'s `string` to include the absent
 * cases, so an environment that simply did not set it is representable and therefore refusable
 * rather than coerced into `''` somewhere upstream and forgotten.
 */
export interface TelegramAuthPolicy {
  readonly expectedSecretToken: string | null | undefined;
  readonly allowedSenderIds: readonly string[];
}

/** Read the authenticity half of a transport configuration. No re-typing at each call site. */
export function authPolicyFromTransport(config: TelegramTransportConfig): TelegramAuthPolicy {
  return { expectedSecretToken: config.expectedSecretToken, allowedSenderIds: config.allowedSenderIds };
}

/**
 * Which gate refused, for the **audit** path only. §5.2 forbids the *response* revealing this;
 * §5.3 requires the rejection to be audited. Those are two different paths, and this vocabulary
 * belongs to the second one — it never appears in {@link TelegramAuthDecision}.
 */
export const TELEGRAM_AUTH_STAGES = ['configuration', 'token', 'allowlist'] as const;
export type TelegramAuthStage = (typeof TELEGRAM_AUTH_STAGES)[number];

/**
 * **Which gates apply in which mode (R26, D1).** The one place the asymmetry is written down.
 *
 * `webhook` applies all three, in {@link TELEGRAM_AUTH_STAGES}' order, which is R11 and §5.3
 * unchanged. `longPoll` applies the allowlist alone, because the other two guard an inbound
 * request that does not exist in an outbound-only transport — and the allowlist refuses by
 * default, so removing the other two removes a gate and opens nothing.
 *
 * Written as data rather than as a branch for three reasons. It is enumerable, so a test can
 * assert the table covers every member of {@link TELEGRAM_TRANSPORT_MODES} and no more. It is
 * readable in one glance, so "which mode is weaker, and by exactly which gate" needs no tracing.
 * And it cannot be satisfied by weakening the other mode: making `longPoll` pass by relaxing a
 * *value* rule would show up as a change to {@link secretTokenIsConfigured}, which the webhook
 * row still depends on.
 */
export const TELEGRAM_MODE_APPLICABLE_GATES: Readonly<Record<TelegramTransportMode, readonly TelegramAuthStage[]>> =
  Object.freeze({
    webhook: Object.freeze(['configuration', 'token', 'allowlist'] as const),
    longPoll: Object.freeze(['allowlist'] as const),
  });

/**
 * The gates a mode applies, at their strictest when the mode is not one this module knows.
 *
 * The fallback is the FULL set, never the empty one: a configuration carrying a mode nobody
 * recognises must refuse more, not less. `parseTransportMode` refuses such a value at startup, so
 * this is the second belt on the same door rather than the only one.
 */
export function applicableAuthStages(mode: TelegramTransportMode): readonly TelegramAuthStage[] {
  return TELEGRAM_MODE_APPLICABLE_GATES[mode] ?? TELEGRAM_AUTH_STAGES;
}

/**
 * One audited refusal. The fact of the rejection, never the content (§5.3), and never the token
 * (§5.2): `tokenHeaderPresent` is a boolean, which is exactly enough to tell an absent header
 * from an empty one without recording either.
 */
export interface TelegramAuthAuditLine {
  readonly stage: TelegramAuthStage;
  readonly code: Extract<PortFailureCode, 'TELEGRAM_CONFIG_FAILS_CLOSED' | 'TELEGRAM_REQUEST_REJECTED'>;
  readonly botId: string;
  readonly senderId: string;
  readonly tokenHeaderPresent: boolean;
}

/** Where an audited refusal goes. Injected, so this module owns no sink and no log. */
export type TelegramAuthAuditSink = (line: TelegramAuthAuditLine) => void;

/**
 * The answer a caller gets. The refusal variant has **no reason field** — §5.2 — and
 * {@link TELEGRAM_AUTH_REFUSED} is the single value every refusal returns, so a per-reason
 * refusal is not something a future call site can accidentally build.
 */
export type TelegramAuthDecision = { readonly authorized: true } | { readonly authorized: false };

/** The one granted value. */
export const TELEGRAM_AUTH_GRANTED: TelegramAuthDecision = Object.freeze({ authorized: true as const });

/** The one refused value, for every stage, so no refusal is distinguishable from another. */
export const TELEGRAM_AUTH_REFUSED: TelegramAuthDecision = Object.freeze({ authorized: false as const });

/**
 * Is the expected token a value this guard can meaningfully hold? Absent, empty, over-length, or
 * outside the provider's charset all answer no, and a no refuses every request (§5.2, fail
 * closed).
 */
export function secretTokenIsConfigured(policy: TelegramAuthPolicy): boolean {
  const expected = policy.expectedSecretToken;
  if (typeof expected !== 'string') return false;
  if (expected.length === 0 || expected.length > TELEGRAM_SECRET_TOKEN_MAX_LENGTH) return false;
  return TELEGRAM_SECRET_TOKEN_PATTERN.test(expected);
}

/**
 * Is this sender on the list? An **empty** list answers no for every sender, which is §5.3's
 * "empty means nobody, not everybody". An empty sender identifier is nobody too.
 */
export function senderIsAllowlisted(senderId: string, allowedSenderIds: readonly string[]): boolean {
  if (senderId.length === 0) return false;
  return allowedSenderIds.includes(senderId);
}

/** Boolean conjunction without short-circuiting, so no gate's evaluation depends on another's. */
function bothHold(left: boolean, right: boolean): boolean {
  return (left ? 1 : 0) * (right ? 1 : 0) === 1;
}

/** The audit code each stage refuses with. A stage's code is fixed, so no call site chooses one. */
const STAGE_FAILURE_CODES: Readonly<Record<TelegramAuthStage, TelegramAuthAuditLine['code']>> = Object.freeze({
  configuration: 'TELEGRAM_CONFIG_FAILS_CLOSED',
  token: 'TELEGRAM_REQUEST_REJECTED',
  allowlist: 'TELEGRAM_REQUEST_REJECTED',
});

/**
 * **The guard (§5.2 then §5.3, in that order; R26 for which gates apply).**
 *
 * Every gate is evaluated before any is consulted, then the verdicts of the gates the MODE
 * applies are read in §5.3's order — configuration, token, allowlist — so:
 *
 *  - an unconfigured guard refuses everything, correct token included;
 *  - a bad token is refused whatever the allowlist says, which is what "the allowlist is
 *    checked after the token check" means operationally;
 *  - a good token with a sender outside the list is refused before any caller holds a granted
 *    decision, so nothing has parsed the content by then;
 *  - and every refusal costs the same digest work, so no timing signal separates the stages.
 *
 * `mode` is required and has **no default** (R26, D1). The three verdicts are still computed
 * unconditionally in both modes — the digest work is performed even where its verdict is not
 * read — so the mode changes which verdicts are *consulted* and changes nothing about how any of
 * them is *reached*. Under `longPoll` the token verdict is therefore computed and discarded
 * rather than skipped, which is why no value rule is relaxed to make that mode pass.
 *
 * `audit` is optional because the decision must not depend on whether anyone is listening.
 */
export function authorizeDelivery(
  subject: TelegramAuthSubject,
  policy: TelegramAuthPolicy,
  mode: TelegramTransportMode,
  audit?: TelegramAuthAuditSink,
): TelegramAuthDecision {
  const tokenHeaderPresent = typeof subject.secretTokenHeader === 'string';
  const provided = tokenHeaderPresent ? (subject.secretTokenHeader as string) : '';

  // All three, unconditionally, before any of them is read.
  const configured = secretTokenIsConfigured(policy);
  const comparisonHolds = constantTimeTokenEquals(provided, typeof policy.expectedSecretToken === 'string' ? policy.expectedSecretToken : '');
  const tokenGatePasses = bothHold(configured, bothHold(tokenHeaderPresent, comparisonHolds));
  const senderGatePasses = senderIsAllowlisted(subject.senderId, policy.allowedSenderIds);
  const verdicts: Readonly<Record<TelegramAuthStage, boolean>> = {
    configuration: configured,
    token: tokenGatePasses,
    allowlist: senderGatePasses,
  };

  const refuse = (stage: TelegramAuthStage): TelegramAuthDecision => {
    audit?.({ stage, code: STAGE_FAILURE_CODES[stage], botId: subject.botId, senderId: subject.senderId, tokenHeaderPresent });
    return TELEGRAM_AUTH_REFUSED;
  };

  // §5.3's precedence, over the gates this mode applies. The iteration order is
  // TELEGRAM_AUTH_STAGES' own, so the applicable table cannot reorder the precedence by
  // listing its members differently.
  const applicable = applicableAuthStages(mode);
  for (const stage of TELEGRAM_AUTH_STAGES) {
    if (!applicable.includes(stage)) continue;
    if (!verdicts[stage]) return refuse(stage);
  }
  return TELEGRAM_AUTH_GRANTED;
}
