// @vitest-environment node
/**
 * NIZAM · The token comparison is constant-time — contract 12 §5.2 (R11)
 * Implemented by: PFOS Contract 12 / Phase 4.1 (spec 06-two-agent-vps)
 * Depends on: ./auth, node:fs, node:url
 *
 * §5.2 makes constant-time comparison a FUNCTIONAL requirement with its own test, so this file
 * exists to prove it rather than to assert it.
 *
 * **Why it is proved structurally.** A wall-clock timing test is not evidence here: on a shared
 * or virtualized host, scheduler noise, turbo clocking and JIT warm-up all dwarf the few hundred
 * nanoseconds a short-circuit would leak, so such a test either fails at random or passes on
 * code that leaks. It would be a flaky test that certifies nothing. What CAN be proved
 * deterministically is the two structural facts a short-circuit needs in order to exist:
 *
 *   1. a **branch or an early exit** in the comparison — so the comparison's own source is
 *      asserted to contain no `if`, no loop, no `break`, no ternary, no `&&`/`||`, no `===`, and
 *      exactly one `return`; and
 *   2. a **length-dependent amount of work** — so the number of bytes actually handed to the
 *      timing-safe primitive is asserted to be identical for an empty token and a 4096-character
 *      one.
 *
 * With both denied, there is nothing left for a timing signal to be carried by. The source-text
 * assertions are deliberately a guard against a FUTURE edit reintroducing a short-circuit, which
 * is the realistic failure mode: the leak is easy to add back in a one-line "optimization" and
 * invisible in behaviour.
 *
 * The third fact §5.2 needs is that the length-mismatch **throw** is gone. `timingSafeEqual`
 * raises on unequal-length buffers, and that raise is itself a timing and control-flow signal,
 * so the tests below drive every length relationship — shorter, longer, empty, multi-byte — and
 * require an answer rather than an exception.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  constantTimeTokenEquals,
  equalizedTokenDigest,
  TOKEN_DIGEST_BYTES,
  TOKEN_DIGEST_KEY_BYTES,
} from './auth.ts';

const AUTH_SOURCE = readFileSync(fileURLToPath(new URL('./auth.ts', import.meta.url)), 'utf8');

/** The statements of one top-level exported function, with its signature and braces removed. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n}', open);
  expect(close).toBeGreaterThan(open);
  return source.slice(open + 1, close);
}

/** Everything a short-circuit would have to be spelled with. */
const SHORT_CIRCUIT_SPELLINGS: readonly (readonly [string, string])[] = [
  ['if', 'a conditional'],
  ['else', 'a conditional'],
  ['for', 'a loop'],
  ['while', 'a loop'],
  ['break', 'an early loop exit'],
  ['?', 'a ternary'],
  ['&&', 'a short-circuiting conjunction'],
  ['||', 'a short-circuiting disjunction'],
  ['===', 'a value comparison'],
  ['!==', 'a value comparison'],
  ['.length', 'a length inspection'],
  ['startsWith', 'a prefix comparison'],
  ['indexOf', 'a prefix comparison'],
  ['charCodeAt', 'a per-character comparison'],
  ['localeCompare', 'a collating comparison'],
  ['slice', 'a truncation'],
];

describe('the comparison has no branch and no early exit (§5.2, R11)', () => {
  const body = functionBody(AUTH_SOURCE, 'constantTimeTokenEquals');

  it.each(SHORT_CIRCUIT_SPELLINGS)('contains no %s (%s)', (spelling) => {
    expect(body).not.toContain(spelling);
  });

  it('has exactly one return, so there is no path that exits early', () => {
    expect(body.match(/\breturn\b/g)?.length).toBe(1);
  });

  it('delegates to the timing-safe primitive from the platform, not to its own loop', () => {
    expect(AUTH_SOURCE).toContain("from 'node:crypto'");
    expect(AUTH_SOURCE).toContain('timingSafeEqual');
    expect(body).toContain('timingSafeEqual(');
  });

  it('equalizes both operands with the same keyed digest, and that helper is branch-free too', () => {
    const helper = functionBody(AUTH_SOURCE, 'equalizedTokenDigest');
    for (const [spelling] of SHORT_CIRCUIT_SPELLINGS) expect(helper).not.toContain(spelling);
    expect(helper.match(/\breturn\b/g)?.length).toBe(1);
    // Both operands, one key, one call each: the two digests are the only things compared.
    expect(body.match(/equalizedTokenDigest\(/g)?.length).toBe(2);
  });
});

describe('the work done does not depend on the length of either operand', () => {
  const key = Buffer.alloc(TOKEN_DIGEST_KEY_BYTES, 7);

  it.each([0, 1, 2, 32, 256, 4096])('reduces a %i-character operand to the same width', (length) => {
    expect(equalizedTokenDigest('t'.repeat(length), key).length).toBe(TOKEN_DIGEST_BYTES);
  });

  it('reduces a multi-byte operand to the same width, so byte length is not a signal either', () => {
    // Four astral characters are sixteen UTF-8 bytes, not four.
    expect(equalizedTokenDigest('\u{1F510}\u{1F510}\u{1F510}\u{1F510}', key).length).toBe(TOKEN_DIGEST_BYTES);
  });

  it('is keyed, not a bare hash: a different key gives a different digest for the same operand', () => {
    const other = Buffer.alloc(TOKEN_DIGEST_KEY_BYTES, 9);
    expect(equalizedTokenDigest('same-operand', key).equals(equalizedTokenDigest('same-operand', other))).toBe(false);
    expect(equalizedTokenDigest('same-operand', key).equals(equalizedTokenDigest('same-operand', key))).toBe(true);
  });
});

describe('the length-mismatch throw is removed rather than special-cased (§5.2)', () => {
  /** Every length relationship, including the two the naive primitive raises on. */
  const mismatched: readonly (readonly [string, string])[] = [
    ['', 'a-configured-token'],
    ['a-configured-token', ''],
    ['', ''],
    ['a', 'a-configured-token'],
    ['a-configured-token-and-more', 'a-configured-token'],
    ['t'.repeat(4096), 'a-configured-token'],
    ['a-configured-token', 't'.repeat(4096)],
    ['\u{1F510}', 'a-configured-token'],
  ];

  it.each(mismatched)('answers instead of throwing for %j vs %j', (provided, expected) => {
    expect(() => constantTimeTokenEquals(provided, expected)).not.toThrow();
    expect(typeof constantTimeTokenEquals(provided, expected)).toBe('boolean');
  });
});

describe('and it is still a correct comparison', () => {
  it('holds for identical operands, including empty and multi-byte ones', () => {
    expect(constantTimeTokenEquals('a-configured-token', 'a-configured-token')).toBe(true);
    expect(constantTimeTokenEquals('', '')).toBe(true);
    expect(constantTimeTokenEquals('\u{1F510}-token', '\u{1F510}-token')).toBe(true);
  });

  it('fails for a first-character difference, a last-character difference, and a length difference', () => {
    expect(constantTimeTokenEquals('X-configured-token', 'a-configured-token')).toBe(false);
    expect(constantTimeTokenEquals('a-configured-tokeX', 'a-configured-token')).toBe(false);
    expect(constantTimeTokenEquals('a-configured-toke', 'a-configured-token')).toBe(false);
  });

  it('gives the same answer on every call, so the per-call key is not a source of flakiness', () => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(constantTimeTokenEquals('a-configured-token', 'a-configured-token')).toBe(true);
      expect(constantTimeTokenEquals('a-configured-tokeX', 'a-configured-token')).toBe(false);
    }
  });
});
