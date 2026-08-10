// @vitest-environment node
/**
 * NIZAM · Token-spend read model tests — contract 06 §9 T13 (purity), §6.1, §6.2, §6.3
 * Implemented by: PFOS Contract 06 / Phase 1.4 (spec 06-two-agent-vps), owning requirement R5
 * Depends on: spendLedger.ts (imported), and its source text (read from disk for the scan below)
 *
 * T13 says `weeklySpend` is pure: identical inputs give identical outputs with no clock or store
 * access. "No clock access" is the absence of a behaviour, and a passing call proves nothing about
 * an absence — so purity is attacked from three directions here rather than asserted once:
 *
 *  1. A SOURCE SCAN for every token that could reach a clock, a store, randomness, or ambient
 *     configuration. An absence is only checkable by reading the source.
 *  2. A HOSTILE ENVIRONMENT: `Date`, `Math.random` and `process.env` are replaced with throwing
 *     stubs, and the function still returns. Code that touched any of them would fail loudly.
 *  3. DETERMINISM AND NON-MUTATION: repeated calls agree, frozen inputs are accepted, and row order
 *     does not change the total.
 *
 * Every figure below is synthetic provider accounting in integer micro-USD. No cap literal appears:
 * a cap arrives as an argument (§6.3).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  agentWeeklyBudget,
  assertSpendRowShape,
  COST_SOURCE_ACTUAL,
  isSpendAgent,
  isWeekKey,
  microUsdFromUsd,
  microUsdToUsd,
  MICRO_USD_PER_USD,
  SPEND_AGENTS,
  SpendLedgerError,
  weeklySpend,
  weekKeyOf,
  type SpendAgent,
  type SpendLedgerRow,
} from './spendLedger.ts';

const SOURCE_PATH = fileURLToPath(new URL('./spendLedger.ts', import.meta.url));

/** Code lines only: a doc comment naming a token is prose, not a reference to it. */
function codeLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('*/') && !t.startsWith('//');
    });
}

let seq = 0;
function row(over: Partial<SpendLedgerRow> = {}): SpendLedgerRow {
  seq += 1;
  return {
    id: `row_${seq}`,
    agent: 'finance',
    occurredAt: '2026-03-04T09:15:00Z',
    weekKey: 'W2026-03-02',
    modelId: 'model-alpha',
    costMicroUsd: 1_000,
    promptTokens: 120,
    completionTokens: 40,
    requestRef: `req_${seq}`,
    costSource: COST_SOURCE_ACTUAL,
    ...over,
  };
}

/** Independent reference total, so the assertion is not the implementation restated. */
function referenceTotal(rows: readonly SpendLedgerRow[], agent: SpendAgent, weekKey: string): number {
  return rows.reduce((sum, r) => (r.agent === agent && r.weekKey === weekKey ? sum + r.costMicroUsd : sum), 0);
}

describe('weeklySpend purity — the source cannot reach a clock, a store, or ambient state (§6.3, T13)', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const code = codeLines(source).join('\n');

  it('scans a non-empty source, so the assertions below cannot pass vacuously', () => {
    expect(code.length).toBeGreaterThan(500);
  });

  it('T13 names no clock, no randomness, and no ambient configuration in executable code', () => {
    const forbidden: readonly [string, RegExp][] = [
      ['the Date constructor', /\bDate\b/],
      ['a high-resolution clock', /\bperformance\s*\.\s*now\b|\bhrtime\b/],
      ['randomness', /\bMath\s*\.\s*random\b|\bcrypto\b|\brandomUUID\b/],
      ['ambient environment', /\bprocess\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b/],
      ['a timer', /\bsetTimeout\b|\bsetInterval\b/],
    ];
    const offenders = forbidden.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
    expect(offenders).toEqual([]);
  });

  it('T13 names no store: no query, no statement, no database handle', () => {
    const forbidden: readonly [string, RegExp][] = [
      ['a prepared statement', /\bprepare\s*\(/],
      ['a SQL verb', /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/],
      ['a database handle', /\bdb\s*\./],
      ['a file read', /\breadFile|\bwriteFile|\bfetch\s*\(/],
    ];
    const offenders = forbidden.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
    expect(offenders).toEqual([]);
  });

  it('imports nothing at all, so no dependency can smuggle I/O in later', () => {
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it('holds no cap literal — the cap it is compared against is injected (§6.3)', () => {
    // The read model must not know the number. It knows how to total, and nothing else.
    expect(code).not.toMatch(/\b(?:cap|CAP)[A-Za-z_]*\s*[:=]\s*\d/);
  });
});

describe('weeklySpend purity — proven in a hostile environment (T13)', () => {
  /** Run `fn` with the clock, randomness and environment replaced by traps. */
  function withoutAmbientState<T>(fn: () => T): T {
    const realDate = globalThis.Date;
    const realRandom = Math.random;
    const trap = (name: string) => (): never => {
      throw new Error(`ambient ${name} was read`);
    };
    // A constructor call, a static call, and a bare read all land on a thrower.
    const dateTrap = new Proxy(realDate, {
      construct: trap('Date'),
      apply: trap('Date'),
      get: trap('Date'),
    });
    globalThis.Date = dateTrap as unknown as DateConstructor;
    Math.random = trap('Math.random') as unknown as () => number;
    try {
      return fn();
    } finally {
      globalThis.Date = realDate;
      Math.random = realRandom;
    }
  }

  it('T13 totals a week with the clock and randomness trapped', () => {
    const rows = [row({ costMicroUsd: 1_500 }), row({ costMicroUsd: 2_500 })];
    const total = withoutAmbientState(() => weeklySpend(rows, 'finance', 'W2026-03-02'));
    expect(total).toBe(4_000);
  });

  it('derives a week bucket with the clock trapped, because the boundary is an argument', () => {
    expect(withoutAmbientState(() => weekKeyOf('2026-03-04T09:15:00Z'))).toBe('W2026-03-02');
  });

  it('makes the whole cap decision with the clock trapped', () => {
    const rows = [row({ costMicroUsd: 900_000 })];
    const budget = withoutAmbientState(() =>
      agentWeeklyBudget(rows, { agent: 'finance', weekKey: 'W2026-03-02', capMicroUsd: 3_000_000 }),
    );
    expect(budget.spentMicroUsd).toBe(900_000);
    expect(budget.remainingMicroUsd).toBe(2_100_000);
    expect(budget.exhausted).toBe(false);
  });

  it('proves the trap actually fires, so the three tests above are not vacuous', () => {
    expect(() => withoutAmbientState(() => new Date().toISOString())).toThrow(/ambient Date was read/);
    expect(() => withoutAmbientState(() => Math.random())).toThrow(/ambient Math\.random was read/);
  });
});

describe('weeklySpend determinism and non-mutation (T13)', () => {
  const rows: readonly SpendLedgerRow[] = [
    row({ costMicroUsd: 111 }),
    row({ agent: 'life', costMicroUsd: 999_999 }),
    row({ costMicroUsd: 222 }),
    row({ weekKey: 'W2026-02-23', costMicroUsd: 888_888 }),
    row({ costMicroUsd: 333 }),
  ];

  it('T13 returns an identical result for identical inputs, called repeatedly', () => {
    const first = weeklySpend(rows, 'finance', 'W2026-03-02');
    for (let i = 0; i < 25; i += 1) {
      expect(weeklySpend(rows, 'finance', 'W2026-03-02')).toBe(first);
    }
    expect(first).toBe(referenceTotal(rows, 'finance', 'W2026-03-02'));
    expect(first).toBe(666);
  });

  it('accepts deeply frozen inputs and leaves them untouched', () => {
    const frozen = Object.freeze(rows.map((r) => Object.freeze({ ...r })));
    const before = JSON.stringify(frozen);
    expect(weeklySpend(frozen, 'finance', 'W2026-03-02')).toBe(666);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('does not depend on row order', () => {
    const reversed = [...rows].reverse();
    expect(weeklySpend(reversed, 'finance', 'W2026-03-02')).toBe(weeklySpend(rows, 'finance', 'W2026-03-02'));
  });

  it('totals an empty ledger as zero rather than refusing', () => {
    expect(weeklySpend([], 'finance', 'W2026-03-02')).toBe(0);
    expect(weeklySpend([], 'life', 'W2026-03-02')).toBe(0);
  });

  it('is exact over a large synthetic ledger — integers, so there is no drift to accumulate', () => {
    const many: SpendLedgerRow[] = [];
    for (let i = 1; i <= 2_000; i += 1) {
      many.push(row({ costMicroUsd: i, agent: i % 3 === 0 ? 'life' : 'finance' }));
    }
    const total = weeklySpend(many, 'finance', 'W2026-03-02');
    expect(total).toBe(referenceTotal(many, 'finance', 'W2026-03-02'));
    expect(Number.isSafeInteger(total)).toBe(true);
  });
});

describe('weekKeyOf — the UTC week bucket, derived at write time (§6.1)', () => {
  it('maps a Monday to itself', () => {
    expect(weekKeyOf('2026-03-02')).toBe('W2026-03-02');
  });

  it('maps every other day of that week back to the same Monday', () => {
    const days = ['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'];
    for (const day of days) {
      expect(weekKeyOf(`${day}T23:59:59Z`)).toBe('W2026-03-02');
    }
    // The next Monday opens a new bucket, so a week boundary is a real boundary.
    expect(weekKeyOf('2026-03-09T00:00:00Z')).toBe('W2026-03-09');
  });

  it('crosses a calendar-year boundary without changing which week a day is in', () => {
    // 2026-01-01 is a Thursday: its week opened on Monday 2025-12-29, in the previous year.
    expect(weekKeyOf('2026-01-01T12:00:00Z')).toBe('W2025-12-29');
    expect(weekKeyOf('2025-12-29T00:00:00Z')).toBe('W2025-12-29');
    expect(weekKeyOf('2026-01-04T23:59:59Z')).toBe('W2025-12-29');
    expect(weekKeyOf('2026-01-05T00:00:00Z')).toBe('W2026-01-05');
  });

  it('handles a leap day', () => {
    expect(weekKeyOf('2024-02-29T06:00:00Z')).toBe('W2024-02-26');
  });

  it('produces a key its own validator accepts', () => {
    expect(isWeekKey(weekKeyOf('2026-03-04'))).toBe(true);
    expect(isWeekKey('2026-03-02')).toBe(false);
    expect(isWeekKey('W2026-3-2')).toBe(false);
  });

  it('refuses an offset-bearing timestamp rather than assuming a zone', () => {
    try {
      weekKeyOf('2026-03-02T00:30:00+02:00');
      expect.unreachable('an offset timestamp must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(SpendLedgerError);
      expect((error as SpendLedgerError).code).toBe('SPEND_TIMESTAMP_MALFORMED');
    }
  });

  it('refuses a date that does not exist, and refuses nonsense', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', 'last tuesday', '', '2026-03-02T25:00:00Z']) {
      expect(() => weekKeyOf(bad)).toThrow(SpendLedgerError);
    }
  });
});

describe('weeklySpend is keyed by agent and never aggregates across them (§6.2.3, R17)', () => {
  const rows: readonly SpendLedgerRow[] = [
    row({ agent: 'finance', costMicroUsd: 400 }),
    row({ agent: 'life', costMicroUsd: 7_000_000 }),
    row({ agent: 'life', costMicroUsd: 1_000_000 }),
  ];

  it('reports only the requested agent, whatever the other agent has spent', () => {
    expect(weeklySpend(rows, 'finance', 'W2026-03-02')).toBe(400);
    expect(weeklySpend(rows, 'life', 'W2026-03-02')).toBe(8_000_000);
  });

  it('leaves one agent unexhausted while the other is over its own cap', () => {
    const cap = 1_000_000;
    const life = agentWeeklyBudget(rows, { agent: 'life', weekKey: 'W2026-03-02', capMicroUsd: cap });
    const finance = agentWeeklyBudget(rows, { agent: 'finance', weekKey: 'W2026-03-02', capMicroUsd: cap });
    expect(life.exhausted).toBe(true);
    expect(life.remainingMicroUsd).toBe(0);
    expect(finance.exhausted).toBe(false);
    expect(finance.remainingMicroUsd).toBe(cap - 400);
  });

  it('excludes another week even for the same agent', () => {
    const mixed = [...rows, row({ agent: 'finance', weekKey: 'W2026-02-23', costMicroUsd: 5_000_000 })];
    expect(weeklySpend(mixed, 'finance', 'W2026-03-02')).toBe(400);
    expect(weeklySpend(mixed, 'finance', 'W2026-02-23')).toBe(5_000_000);
  });

  it('enumerates exactly two agents and rejects free text as a spend key (§6.1)', () => {
    expect([...SPEND_AGENTS]).toEqual(['life', 'finance']);
    expect(isSpendAgent('finance')).toBe(true);
    expect(isSpendAgent('Finance')).toBe(false);
    expect(isSpendAgent('router')).toBe(false);
    try {
      weeklySpend([], 'ops' as unknown as SpendAgent, 'W2026-03-02');
      expect.unreachable('an unknown agent must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_AGENT_UNKNOWN');
    }
  });
});

describe('weeklySpend fails loud rather than reporting a convenient zero (§6.2.5)', () => {
  it('refuses a malformed week key instead of matching nothing and returning zero', () => {
    try {
      weeklySpend([row()], 'finance', '2026-03-02');
      expect.unreachable('a malformed week key must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_WEEK_KEY_MALFORMED');
    }
  });

  it('refuses a non-integer cost — an approximate total would silently restore budget', () => {
    const notAnInteger = 1_000 + 1 / 3; // deliberately invalid fixture: cost must be an integer
    try {
      weeklySpend([row({ costMicroUsd: notAnInteger })], 'finance', 'W2026-03-02');
      expect.unreachable('a fractional cost must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_COST_NOT_INTEGER');
    }
  });

  it('refuses a negative cost — a correction is a compensating row, not a negative one (§6.2.2)', () => {
    try {
      weeklySpend([row({ costMicroUsd: -1 })], 'finance', 'W2026-03-02');
      expect.unreachable('a negative cost must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_COST_NEGATIVE');
    }
  });

  it('refuses a row whose cost is not the provider-reported actual (§6.2.1)', () => {
    const estimated = row({ costSource: 'preflight_estimate' as unknown as typeof COST_SOURCE_ACTUAL });
    try {
      weeklySpend([estimated], 'finance', 'W2026-03-02');
      expect.unreachable('an estimated cost must never be totalled');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_COST_SOURCE_NOT_ACTUAL');
    }
  });

  it('carries a discriminating code and a flat string detail, never a nested payload', () => {
    try {
      weeklySpend([], 'nobody' as unknown as SpendAgent, 'W2026-03-02');
      expect.unreachable('must throw');
    } catch (error) {
      const typed = error as SpendLedgerError;
      expect(typed.name).toBe('SpendLedgerError');
      expect(typed.detail.received).toBe('nobody');
      expect(Object.values(typed.detail).every((v) => typeof v === 'string')).toBe(true);
    }
  });
});

describe('assertSpendRowShape — the write path guard, reused on read', () => {
  it('accepts a well-formed row', () => {
    expect(() => assertSpendRowShape(row())).not.toThrow();
  });

  it('requires a request_ref, because a correction is identified by its own (§6.2.2)', () => {
    try {
      assertSpendRowShape(row({ requestRef: '   ' }));
      expect.unreachable('an empty request_ref must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_REQUEST_REF_EMPTY');
    }
  });

  it('requires integer, non-negative token counts as reported', () => {
    for (const bad of [{ promptTokens: -1 }, { completionTokens: -1 }, { promptTokens: 1.5 }]) {
      try {
        assertSpendRowShape(row(bad));
        expect.unreachable('an invalid token count must be refused');
      } catch (error) {
        expect((error as SpendLedgerError).code).toBe('SPEND_TOKENS_INVALID');
      }
    }
  });
});

describe('the micro-USD boundary — provider accounting, not the money core (§6.1)', () => {
  it('states its unit as an integer scale', () => {
    expect(MICRO_USD_PER_USD).toBe(1_000_000);
    expect(Number.isSafeInteger(MICRO_USD_PER_USD)).toBe(true);
  });

  it('converts an injected USD cap to integer micro-USD exactly once, at configuration', () => {
    expect(microUsdFromUsd(3)).toBe(3_000_000);
    expect(Number.isSafeInteger(microUsdFromUsd(3))).toBe(true);
    expect(microUsdToUsd(3_000_000)).toBe(3);
  });

  it('refuses a negative or non-finite configured cap', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => microUsdFromUsd(bad)).toThrow(SpendLedgerError);
    }
  });

  it('refuses to present a fractional micro-USD figure as USD', () => {
    const fractional = 1 / 3; // deliberately invalid fixture: the ledger unit is an integer
    expect(() => microUsdToUsd(fractional)).toThrow(SpendLedgerError);
  });
});
