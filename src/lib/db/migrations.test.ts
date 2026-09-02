// @vitest-environment node
/**
 * NIZAM · migrations tests — v0 example shape -> current schema, idempotent
 * Implemented by: KIRO Contract 2 / Phase 2.3
 */
import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '@/lib/db/schema';
import {
  migrate,
  downgradeV5toV4,
  downgradeV6toV5,
  downgradeV7toV6,
  downgradeV8toV7,
  downgradeV9toV8,
} from './migrations.ts';
import { createEmptyDb } from './schema.ts';

/** The v0 example shape from data/ledgers/nizam_db.example.json. */
const v0Example = {
  schemaVersion: undefined, // pre-versioned files may lack the field entirely
  meta: { currency: 'EGP', moneyBase: 'milliunits', createdAt: null },
  accounts: [
    { id: 'acc_cib_debit', name: 'CIB Current', type: 'CIB_DEBIT', onBudget: true, balance: 0 },
  ],
  categoryGroups: [{ id: 'grp_essentials', name: 'Essentials', order: 0 }],
  categories: [{ id: 'cat_rent', groupId: 'grp_essentials', name: 'Rent', target: null }],
  months: [{ month: '2026-07', budgeted: { cat_rent: 5000 }, activity: { cat_rent: -3000 }, available: { cat_rent: 2000 } }],
  payees: [],
  transactions: [],
};

describe('migrate', () => {
  it('migrates the v0 example shape to the current schema', () => {
    const db = migrate(v0Example);
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(db.accounts[0]?.type).toBe('CIB_DEBIT');
    expect(db.accounts[0]?.clearedBalance).toBe(0);
    expect(db.categoryGroups[0]?.hidden).toBe(false);
    expect(db.categories[0]?.isCreditCardPayment).toBe(false);
    expect(db.months[0]?.categories['cat_rent']).toEqual({
      assigned: 5000,
      activity: -3000,
      available: 2000,
    });
    expect(db.meta.revision).toBe(0);
    expect(db.meta.conflicts).toEqual([]);
  });

  it('is idempotent — migrating v1 output again yields the same db', () => {
    const once = migrate(v0Example);
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('passes a fresh current db through unchanged', () => {
    const db = createEmptyDb('2026-07-29T00:00:00.000Z');
    expect(migrate(JSON.parse(JSON.stringify(db)))).toEqual(db);
  });

  it('rejects a FUTURE schema version', () => {
    expect(() => migrate({ schemaVersion: 999 })).toThrow(/newer/);
  });
});

/**
 * A v4 store with money in every monetary field, one FX rate, and NO currency
 * anywhere (v4 had nowhere to record one). Synthetic and redacted throughout.
 */
function v4Fixture() {
  return {
    schemaVersion: 4,
    meta: {
      currency: 'EGP',
      moneyBase: 'milliunits',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      revision: 7,
      conflicts: [],
    },
    accounts: [
      {
        id: 'acc_a',
        name: 'Synthetic Current',
        type: 'CIB_DEBIT',
        onBudget: true,
        balance: 1_234_567,
        clearedBalance: 1_200_000,
        accountIdentifier: '00001234',
        creditLimit: null,
        closed: false,
        order: 0,
        paymentCategoryId: null,
      },
      {
        id: 'acc_b',
        name: 'Synthetic Card',
        type: 'CREDIT_OTHER',
        onBudget: true,
        balance: -987_654,
        clearedBalance: -900_000,
        accountIdentifier: '00005678',
        creditLimit: 50_000_000,
        closed: false,
        order: 1,
        paymentCategoryId: null,
      },
    ],
    categoryGroups: [{ id: 'grp_1', name: 'Essentials', order: 0, hidden: false }],
    categories: [
      {
        id: 'cat_1',
        groupId: 'grp_1',
        name: 'Rent',
        order: 0,
        hidden: false,
        target: null,
        isCreditCardPayment: false,
        linkedAccountId: null,
      },
    ],
    months: [{ month: '2026-01', categories: { cat_1: { assigned: 5_000_000, activity: -4_999_999, available: 1 } } }],
    payees: [{ id: 'pay_1', name: 'Synthetic Payee' }],
    transactions: [
      {
        id: 'txn_1',
        accountId: 'acc_a',
        date: '2026-01-15',
        payee: 'Synthetic Payee',
        categoryId: 'cat_1',
        memo: '',
        amount: -4_999_999,
        cleared: 'reconciled',
        approved: true,
        transferAccountId: null,
        transferTransactionId: null,
        splits: null,
        importInfo: null,
      },
      {
        id: 'txn_2',
        accountId: 'acc_b',
        date: '2026-01-20',
        payee: 'Synthetic Payee',
        categoryId: null,
        memo: 'odd amount to catch rounding',
        amount: 1,
        cleared: 'uncleared',
        approved: false,
        transferAccountId: null,
        transferTransactionId: null,
        splits: null,
        importInfo: null,
      },
    ],
    obligations: [],
    policy: {
      minimumLiquidityBuffer: 3_000_000,
      essentialLivingMonthly: 20_000_000,
      uncertaintyBps: 500,
      stalenessBps: 250,
      staleAfterDays: 30,
      expectedInflow: null,
    },
    decisions: [],
    assets: [
      {
        id: 'ast_1',
        name: 'Synthetic Holding',
        kind: 'financial',
        currency: 'USD',
        value: 2_500_000,
        liquid: true,
        liquidationDiscountBps: 0,
        valuationSource: 'manual',
        valuationAsOf: '2026-01-31',
      },
    ],
    fxRates: [{ currency: 'USD', perUnitNum: 4925, perUnitDen: 100, source: 'manual', asOf: '2026-01-31' }],
    macro: {
      referenceCurrency: 'EGP',
      annualInflationBps: 3000,
      inflationSource: 'manual',
      inflationAsOf: '2026-01-31',
    },
  };
}

type RawRow = Record<string, unknown>;
type RawDoc = Record<string, unknown>;

/** Rows of an untyped document collection, without reaching for `any`. */
const rows = (value: unknown): RawRow[] => (Array.isArray(value) ? (value as RawRow[]) : []);

/** Every monetary field in the document, flattened, for a drift comparison. */
function moneyFingerprint(db: unknown): string {
  const d = (db ?? {}) as RawDoc;
  return JSON.stringify({
    accounts: rows(d.accounts).map((a) => [a.id, a.balance, a.clearedBalance, a.creditLimit]),
    months: rows(d.months).map((m) => [m.month, m.categories]),
    transactions: rows(d.transactions).map((t) => [t.id, t.amount, t.splits]),
    policy: d.policy,
    assets: rows(d.assets).map((a) => [a.id, a.value, a.currency]),
    fxRates: rows(d.fxRates).map((r) => [r.currency, r.perUnitNum, r.perUnitDen]),
  });
}

describe('v4 -> v5 currency carriers (C6 Step 2a)', () => {
  it('backfills currency from the store meta, not from a hardcoded constant', () => {
    const db = migrate(v4Fixture());
    // v4 migrates all the way to the current SCHEMA_VERSION (was 5, now 6+).
    // The currency backfill happens at v4->v5; this test checks that result, not the version number.
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(db.accounts.map((a) => a.currency)).toEqual(['EGP', 'EGP']);
    expect(db.transactions.map((t) => t.currency)).toEqual(['EGP', 'EGP']);
    expect(db.fxRates[0]?.conversionVersion).toBe(0);
  });

  it('uses the store currency even when it is NOT the base currency', () => {
    const raw = v4Fixture();
    raw.meta.currency = 'SAR';
    const db = migrate(raw);
    // Proves the backfill reads meta.currency rather than defaulting to 'EGP'.
    expect(db.accounts.every((a) => a.currency === 'SAR')).toBe(true);
    expect(db.transactions.every((t) => t.currency === 'SAR')).toBe(true);
  });

  it('moves NO money: every monetary field is byte-identical after migration', () => {
    const before = v4Fixture();
    const after = migrate(v4Fixture());
    expect(moneyFingerprint(after)).toBe(moneyFingerprint(before));
  });

  it('widens FxRate.asOf to observedAt datetime through migrate() (owner decision D1, 2026-09-02)', () => {
    const db = migrate(v4Fixture());
    expect(db.fxRates[0]?.observedAt).toBe('2026-01-31T00:00:00Z');
    expect((db.fxRates[0] as unknown as Record<string, unknown>).asOf).toBeUndefined();
  });

  it('round-trips v4 -> v5 -> v4 with ZERO monetary drift (vNext P3)', () => {
    // Since Step 6, migrate() advances all the way to the current version (v6+), not just v5.
    // The round-trip therefore goes through every intermediate downgrade step.
    const original = v4Fixture();
    const current = migrate(JSON.parse(JSON.stringify(original)));
    // Full downgrade chain: current -> v7 -> v6 -> v5 -> v4, each step strips only what it added.
    const v7 = downgradeV8toV7(JSON.parse(JSON.stringify(current)));
    const v6 = downgradeV7toV6(JSON.parse(JSON.stringify(v7)));
    const v5 = downgradeV6toV5(JSON.parse(JSON.stringify(v6)));
    const down = downgradeV5toV4(JSON.parse(JSON.stringify(v5)));

    expect(down.schemaVersion).toBe(4);
    expect(moneyFingerprint(down)).toBe(moneyFingerprint(original));
    // The added fields are gone again, so the shape is genuinely v4.
    expect(rows(down.accounts).every((a) => !('currency' in a))).toBe(true);
    expect(rows(down.transactions).every((t) => !('currency' in t))).toBe(true);
    expect(rows(down.fxRates).every((r) => !('conversionVersion' in r))).toBe(true);
    expect(down).toEqual(original);
  });

  it('REFUSES to downgrade a genuinely multi-currency store rather than lose a currency', () => {
    const up = migrate(v4Fixture()) as unknown as RawDoc;
    rows(up.accounts)[1]!.currency = 'USD'; // a real second currency now exists
    expect(() => downgradeV5toV4(JSON.parse(JSON.stringify(up)))).toThrow(/more than one currency/);
  });

  it('rejects a malformed currency code at the persistence boundary', () => {
    const raw = v4Fixture() as unknown as RawDoc;
    raw.schemaVersion = 5;
    rows(raw.accounts)[0]!.currency = 'egyptian pounds';
    rows(raw.accounts)[1]!.currency = 'EGP';
    rows(raw.transactions).forEach((t) => {
      t.currency = 'EGP';
    });
    rows(raw.fxRates).forEach((r) => {
      r.conversionVersion = 0;
    });
    expect(() => migrate(raw)).toThrow();
  });
});

/**
 * A minimal v5 store for testing the v5->v6 migration. Synthetic identifiers throughout.
 * Uses the v4Fixture() from the Step 2a tests as the base (migrated to v5).
 */
function v5Fixture(): Record<string, unknown> {
  const v5 = migrate(v4Fixture()) as unknown as RawDoc;
  // Step 6 candidate candidates are absent on v5 — that is what we are testing.
  const { transactionCandidates: _tc, ...noTc } = v5 as Record<string, unknown>;
  void _tc;
  return { ...noTc, schemaVersion: 5 };
}

describe('v5 -> v6 candidate staging tier (C6 Step 6)', () => {
  it('injects an empty transactionCandidates array on a bare v5 db', () => {
    const result = migrate(v5Fixture());
    expect(result.schemaVersion).toBe(SCHEMA_VERSION); // migration always advances to current
    expect(result.transactionCandidates).toEqual([]);
  });

  it('tolerates a v5 db that already has transactionCandidates (idempotent)', () => {
    const raw = { ...v5Fixture(), transactionCandidates: [] };
    const result = migrate(raw);
    expect(result.transactionCandidates).toEqual([]);
  });

  it('moves NO money across the v5->v6 boundary', () => {
    const before = v5Fixture();
    const after = migrate(v5Fixture());
    expect(moneyFingerprint(after)).toBe(moneyFingerprint(before));
  });

  it('round-trips v5 -> v6 -> v5 with no structural loss', () => {
    const original = v5Fixture();
    const v6 = migrate(JSON.parse(JSON.stringify(original)));
    const back = downgradeV6toV5(JSON.parse(JSON.stringify(v6)));
    // The downgraded form has schemaVersion 5 and no transactionCandidates.
    expect((back as Record<string, unknown>).schemaVersion).toBe(5);
    expect('transactionCandidates' in (back as Record<string, unknown>)).toBe(false);
    // Every other field is unchanged.
    const { schemaVersion: _s1, ...orig } = original;
    const { schemaVersion: _s2, ...down } = back as Record<string, unknown>;
    expect(down).toEqual(orig);
  });
});

describe('downgradeV6toV5', () => {
  it('drops transactionCandidates when the collection is empty', () => {
    const v6 = migrate(v5Fixture());
    const back = downgradeV6toV5(v6) as Record<string, unknown>;
    expect(back.schemaVersion).toBe(5);
    expect('transactionCandidates' in back).toBe(false);
  });

  it('refuses when transactionCandidates is non-empty rather than silently dropping rows', () => {
    const v6 = migrate(v5Fixture());
    // Manufacture one synthetic candidate.
    const candidate = { ...v6.transactions[0], duplicateStatus: 'unique' };
    const withCandidates = { ...v6, transactionCandidates: [candidate] };
    expect(() => downgradeV6toV5(withCandidates)).toThrow(/refused/i);
    expect(() => downgradeV6toV5(withCandidates)).toThrow(/1 unreviewed candidate/);
  });
});

describe('exclusion guarantee: transactionCandidates never affect any engine (Step 6)', () => {
  it('a db with N candidates produces the same netWorth as the same db with zero candidates', async () => {
    const { netWorth } = await import('@/features/netWorth/netWorth.ts');
    const { createEmptyDb } = await import('@/lib/db/schema.ts');

    const base = createEmptyDb('2026-09-02T00:00:00.000Z');
    const withCandidates = {
      ...base,
      transactionCandidates: [
        {
          id: 'cand_1',
          accountId: 'acc_synth',
          date: '2026-09-01',
          payee: 'Test Merchant',
          categoryId: null,
          memo: '',
          amount: 999_000_000, // huge, to make any leakage obvious
          currency: 'EGP' as const,
          cleared: 'cleared' as const,
          approved: false,
          transferAccountId: null,
          transferTransactionId: null,
          splits: null,
          importInfo: null,
          duplicateStatus: 'unique' as const,
        },
      ],
    };

    const nwBase = netWorth(base);
    const nwWith = netWorth(withCandidates);

    // Both must be zero for an empty db — candidates must not leak into the engine.
    expect(nwWith.nominal).toBe(nwBase.nominal);
    expect(nwWith.liquid).toBe(nwBase.liquid);
    expect(nwWith.liquidation).toBe(nwBase.liquidation);
  });
});

// ---------------------------------------------------------------------------
// v6 -> v7 target vocabulary widening (architecture Step 7)
// ---------------------------------------------------------------------------

/**
 * Returns a minimal v6-shaped store with one category of each legacy target type.
 *
 * Built on `createEmptyDb` so that all required fields (meta.updatedAt, meta.revision,
 * meta.conflicts, policy, macro) are present and valid. The schemaVersion is then
 * overridden to 6 so `migrate()` runs the v6->v7 step. Synthetic identifiers throughout.
 */
function v6WithTargetsFixture(): Record<string, unknown> {
  const base = createEmptyDb('2026-01-01T00:00:00.000Z');
  return {
    ...(base as unknown as Record<string, unknown>),
    schemaVersion: 6,
    categoryGroups: [{ id: 'grp_1', name: 'Essentials', order: 0, hidden: false }],
    categories: [
      {
        id: 'cat_monthly',
        groupId: 'grp_1',
        name: 'Groceries',
        order: 0,
        hidden: false,
        isCreditCardPayment: false,
        linkedAccountId: null,
        target: { type: 'monthly', amount: 50_000, targetMonth: null },
      },
      {
        id: 'cat_dated',
        groupId: 'grp_1',
        name: 'Holiday',
        order: 1,
        hidden: false,
        isCreditCardPayment: false,
        linkedAccountId: null,
        target: { type: 'target_by_date', amount: 200_000, targetMonth: '2026-12' },
      },
      {
        id: 'cat_dated_null',
        groupId: 'grp_1',
        name: 'Vague',
        order: 2,
        hidden: false,
        isCreditCardPayment: false,
        linkedAccountId: null,
        target: { type: 'target_by_date', amount: 100_000, targetMonth: null },
      },
      {
        id: 'cat_none',
        groupId: 'grp_1',
        name: 'Misc',
        order: 3,
        hidden: false,
        isCreditCardPayment: false,
        linkedAccountId: null,
        target: null,
      },
    ],
  };
}

describe('v6 -> v7 target vocabulary widening (Step 7)', () => {
  it('migrates `monthly` -> `monthly_funding` with rollover=set_aside, obligationId=null', () => {
    const db = migrate(v6WithTargetsFixture());
    const cat = db.categories.find((c) => c.id === 'cat_monthly')!;
    expect(cat.target?.type).toBe('monthly_funding');
    expect(cat.target?.rollover).toBe('set_aside');
    expect(cat.target?.obligationId).toBeNull();
    // Amount is preserved exactly — no monetary drift.
    expect(cat.target?.amount).toBe(50_000);
  });

  it('migrates `target_by_date` -> `target_balance_by_date` preserving targetMonth', () => {
    const db = migrate(v6WithTargetsFixture());
    const cat = db.categories.find((c) => c.id === 'cat_dated')!;
    expect(cat.target?.type).toBe('target_balance_by_date');
    expect(cat.target?.targetMonth).toBe('2026-12');
    expect(cat.target?.amount).toBe(200_000);
  });

  it('target_by_date with null targetMonth becomes target_balance (honest, not broken)', () => {
    const db = migrate(v6WithTargetsFixture());
    const cat = db.categories.find((c) => c.id === 'cat_dated_null')!;
    expect(cat.target?.type).toBe('target_balance');
    expect(cat.target?.targetMonth).toBeNull(); // targetMonth stays null for the balance family
  });

  it('null target passes through unchanged', () => {
    const db = migrate(v6WithTargetsFixture());
    const cat = db.categories.find((c) => c.id === 'cat_none')!;
    expect(cat.target).toBeNull();
  });

  it('moves NO money across the v6->v7 boundary', () => {
    const db = migrate(v6WithTargetsFixture());
    const sum = db.categories.reduce((acc, c) => acc + (c.target?.amount ?? 0), 0);
    // The three targets had amounts 50000+200000+100000=350000; cat_dated_null becomes
    // target_balance so it still carries its amount.
    expect(sum).toBe(50_000 + 200_000 + 100_000);
  });

  it('round-trips v6 -> v7 -> v6 via downgradeV7toV6 with no loss', () => {
    const v7 = migrate(v6WithTargetsFixture());
    const back = downgradeV7toV6(JSON.parse(JSON.stringify(v7))) as Record<string, unknown>;
    expect(back.schemaVersion).toBe(6);
    const cats = back.categories as { id: string; target: Record<string, unknown> | null }[];
    const monthly = cats.find((c) => c.id === 'cat_monthly')!;
    expect(monthly.target?.type).toBe('monthly');
    const dated = cats.find((c) => c.id === 'cat_dated')!;
    expect(dated.target?.type).toBe('target_by_date');
    // target_balance round-trips to target_by_date (the only name v6 had for "dated without date")
    const vague = cats.find((c) => c.id === 'cat_dated_null')!;
    expect(vague.target?.type).toBe('target_by_date');
  });

  it('downgradeV7toV6 refuses when a v7-only type is present', () => {
    const v7 = migrate(v6WithTargetsFixture());
    // inject a sinking_fund (v7 only) — downgrade must refuse
    const modified = JSON.parse(JSON.stringify(v7));
    const cat = modified.categories.find((c: { id: string }) => c.id === 'cat_monthly');
    cat.target.type = 'sinking_fund';
    cat.target.targetMonth = '2026-12';
    expect(() => downgradeV7toV6(modified)).toThrow(/refused/i);
    expect(() => downgradeV7toV6(modified)).toThrow(/sinking_fund/);
  });
});

// ---------------------------------------------------------------------------
// v7 -> v8: FxRate.asOf -> observedAt datetime widening (owner decision D1, 2026-09-02)
// ---------------------------------------------------------------------------

/** A minimal v7-shaped store with one FX rate, built on the v4 fixture chain. */
function v7WithFxFixture(): Record<string, unknown> {
  const v7 = migrate(v4Fixture()) as unknown as Record<string, unknown>;
  return {
    ...v7,
    schemaVersion: 7,
    fxRates: [
      { currency: 'USD', perUnitNum: 4925, perUnitDen: 100, source: 'manual', asOf: '2026-03-15', conversionVersion: 0 },
      { currency: 'SAR', perUnitNum: 1313, perUnitDen: 100, source: 'manual', asOf: '2026-03-16', conversionVersion: 2 },
    ],
  };
}

describe('v7 -> v8 FxRate.asOf -> observedAt widening (owner decision D1, 2026-09-02)', () => {
  it('appends T00:00:00Z to every fxRates[].asOf and renames the field to observedAt', () => {
    const db = migrate(v7WithFxFixture());
    // `migrate()` always advances to the CURRENT version, so this pins SCHEMA_VERSION
    // rather than the literal 8. Pinning 8 made the test fail the moment Step 4 added v9
    // even though the v7->v8 widening it actually covers was untouched.
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    expect(db.fxRates.map((r) => r.observedAt)).toEqual(['2026-03-15T00:00:00Z', '2026-03-16T00:00:00Z']);
    expect(db.fxRates.every((r) => !('asOf' in (r as unknown as Record<string, unknown>)))).toBe(true);
  });

  it('moves NO money and preserves conversionVersion — this is a datetime widening, not a rate change', () => {
    const db = migrate(v7WithFxFixture());
    expect(db.fxRates.map((r) => [r.perUnitNum, r.perUnitDen, r.conversionVersion])).toEqual([
      [4925, 100, 0],
      [1313, 100, 2],
    ]);
  });

  it('preserves chronological ordering exactly — the widened strings sort identically to the originals', () => {
    const db = migrate(v7WithFxFixture());
    const sortedByObservedAt = [...db.fxRates].sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
    expect(sortedByObservedAt.map((r) => r.currency)).toEqual(['USD', 'SAR']);
  });

  it('running v7->v8 on an already-v8 row is a no-op (idempotent)', () => {
    const once = migrate(v7WithFxFixture());
    const twice = migrate(JSON.parse(JSON.stringify(once)));
    expect(twice.fxRates).toEqual(once.fxRates);
  });

  it('round-trips v7 -> v8 -> v7 via downgradeV8toV7 with no loss', () => {
    const v8 = migrate(v7WithFxFixture());
    const back = downgradeV8toV7(JSON.parse(JSON.stringify(v8))) as Record<string, unknown>;
    expect(back.schemaVersion).toBe(7);
    const fxRates = back.fxRates as { currency: string; asOf: string }[];
    expect(fxRates.map((r) => [r.currency, r.asOf])).toEqual([
      ['USD', '2026-03-15'],
      ['SAR', '2026-03-16'],
    ]);
  });

  it('downgradeV8toV7 refuses when an observedAt carries a real (non-midnight) time', () => {
    const v8 = migrate(v7WithFxFixture()) as unknown as Record<string, unknown>;
    const modified = JSON.parse(JSON.stringify(v8));
    modified.fxRates[0].observedAt = '2026-03-15T14:32:07Z';
    expect(() => downgradeV8toV7(modified)).toThrow(/refused/i);
    expect(() => downgradeV8toV7(modified)).toThrow(/USD@2026-03-15T14:32:07Z/);
  });
});

// ---------------------------------------------------------------------------
// v8 -> v9: versioned allocations + correction links (Step 4, C6 Phase 6.4,
// owner decision D4-A, 2026-09-02)
// ---------------------------------------------------------------------------

/** A v8-shaped store carrying one plain transaction, built on the v4 fixture chain. */
function v8WithTransactionFixture(): Record<string, unknown> {
  const current = migrate(v4Fixture()) as unknown as Record<string, unknown>;
  const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  raw.schemaVersion = 8;
  return raw;
}

/** Deep-clone a migrated store back to a raw record so a test can mutate it. */
function rawClone(db: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
}

/**
 * Index into a raw fixture row list, failing loudly if the row is absent.
 *
 * `noUncheckedIndexedAccess` is on, and a silent `?.` here would let a fixture that lost its
 * rows pass a test that then asserts nothing.
 */
function rowAt(rows: Record<string, unknown>[], i: number): Record<string, unknown> {
  const row = rows[i];
  if (!row) throw new Error(`fixture has no row at index ${i}`);
  return row;
}

describe('v8 -> v9 versioned allocations + correction links (owner decision D4-A)', () => {
  it('advances the version and rewrites NO transaction row — absence means version 0', () => {
    const before = v8WithTransactionFixture();
    const beforeTxns = JSON.parse(JSON.stringify(before.transactions));
    const db = migrate(before);
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    // The whole point: the new fields are optional and absent, so the rows are byte-identical.
    expect(db.transactions).toEqual(beforeTxns);
    for (const t of db.transactions) {
      const row = t as unknown as Record<string, unknown>;
      expect('allocationSetVersion' in row).toBe(false);
      expect('supersededAllocations' in row).toBe(false);
      expect('correction' in row).toBe(false);
    }
  });

  it('moves no money at all', () => {
    const before = v8WithTransactionFixture();
    const sumBefore = (before.transactions as { amount: number }[]).reduce((s, t) => s + t.amount, 0);
    const db = migrate(before);
    expect(db.transactions.reduce((s, t) => s + t.amount, 0)).toBe(sumBefore);
  });

  it('accepts a v9 row that DOES carry the new fields', () => {
    const raw = v8WithTransactionFixture();
    const txns = raw.transactions as Record<string, unknown>[];
    txns[0] = {
      ...txns[0],
      allocationSetVersion: 2,
      supersededAllocations: [
        {
          version: 1,
          legs: [{ id: 'spl_a', categoryId: null, amount: -1000, memo: 'was' }],
          supersededAt: '2026-09-02T10:00:00Z',
        },
      ],
      correction: null,
    };
    const db = migrate(raw);
    const t = db.transactions[0] as unknown as Record<string, unknown>;
    expect(t.allocationSetVersion).toBe(2);
    expect((t.supersededAllocations as unknown[]).length).toBe(1);
  });

  it('rejects a fractional leg amount inside superseded history — integrality is not relaxed by age', () => {
    const raw = v8WithTransactionFixture();
    const txns = raw.transactions as Record<string, unknown>[];
    txns[0] = {
      ...txns[0],
      supersededAllocations: [
        {
          version: 1,
          legs: [{ id: 'spl_a', categoryId: null, amount: -1000.5, memo: 'float' }],
          supersededAt: '2026-09-02T10:00:00Z',
        },
      ],
    };
    expect(() => migrate(raw)).toThrow();
  });

  it('rejects a superseded set whose supersededAt is a bare date, not a datetime', () => {
    const raw = v8WithTransactionFixture();
    const txns = raw.transactions as Record<string, unknown>[];
    txns[0] = {
      ...txns[0],
      supersededAllocations: [{ version: 1, legs: [], supersededAt: '2026-09-02' }],
    };
    expect(() => migrate(raw)).toThrow();
  });

  it('rejects a correction link with an unknown role', () => {
    const raw = v8WithTransactionFixture();
    const txns = raw.transactions as Record<string, unknown>[];
    txns[0] = {
      ...txns[0],
      correction: {
        correctsTransactionId: 'txn_x',
        role: 'amendment',
        correctionGroupId: 'cor_1',
        reason: 'why',
      },
    };
    expect(() => migrate(raw)).toThrow();
  });

  it('round-trips v8 -> v9 -> v8 with no loss when no row carries Step 4 state', () => {
    const v9 = migrate(v8WithTransactionFixture());
    const back = downgradeV9toV8(rawClone(v9));
    expect(back.schemaVersion).toBe(8);
    expect(back.transactions).toEqual(JSON.parse(JSON.stringify(v9.transactions)));
  });

  it('downgradeV9toV8 REFUSES when a row carries a correction link', () => {
    const modified = rawClone(migrate(v8WithTransactionFixture()));
    const txns = modified.transactions as Record<string, unknown>[];
    rowAt(txns, 0).correction = {
      correctsTransactionId: 'txn_original',
      role: 'reversal',
      correctionGroupId: 'cor_1',
      reason: 'statement said 250, ledger said 205',
    };
    expect(() => downgradeV9toV8(modified)).toThrow(/refused/i);
    expect(() => downgradeV9toV8(modified)).toThrow(/correction/);
  });

  it('downgradeV9toV8 REFUSES when a row carries superseded allocation history', () => {
    const modified = rawClone(migrate(v8WithTransactionFixture()));
    const txns = modified.transactions as Record<string, unknown>[];
    rowAt(txns, 0).allocationSetVersion = 1;
    rowAt(txns, 0).supersededAllocations = [
      {
        version: 0,
        legs: [{ id: 'spl_a', categoryId: null, amount: -1000, memo: 'was' }],
        supersededAt: '2026-09-02T10:00:00Z',
      },
    ];
    expect(() => downgradeV9toV8(modified)).toThrow(/refused/i);
    expect(() => downgradeV9toV8(modified)).toThrow(/supersededAllocations/);
  });

  it('downgradeV9toV8 REFUSES on a candidate too, not only a canonical transaction', () => {
    const modified = rawClone(migrate(v8WithTransactionFixture()));
    modified.transactionCandidates = [
      {
        id: 'cand_1',
        accountId: 'acc_1',
        date: '2026-09-01',
        payee: 'p',
        categoryId: null,
        memo: '',
        amount: -1000,
        currency: 'EGP',
        cleared: 'uncleared',
        approved: false,
        transferAccountId: null,
        transferTransactionId: null,
        splits: null,
        importInfo: null,
        duplicateStatus: 'ambiguous',
        allocationSetVersion: 3,
      },
    ];
    expect(() => downgradeV9toV8(modified)).toThrow(/refused/i);
    expect(() => downgradeV9toV8(modified)).toThrow(/transactionCandidates/);
  });

  it('downgradeV9toV8 does NOT refuse on an explicit allocationSetVersion of 0', () => {
    const modified = rawClone(migrate(v8WithTransactionFixture()));
    const txns = modified.transactions as Record<string, unknown>[];
    rowAt(txns, 0).allocationSetVersion = 0;
    rowAt(txns, 0).correction = null;
    rowAt(txns, 0).supersededAllocations = [];
    const back = downgradeV9toV8(modified);
    expect(back.schemaVersion).toBe(8);
    const out = rowAt(back.transactions as Record<string, unknown>[], 0);
    expect('allocationSetVersion' in out).toBe(false);
    expect('correction' in out).toBe(false);
    expect('supersededAllocations' in out).toBe(false);
  });

  it('running the v8->v9 step twice is a no-op (idempotent)', () => {
    const once = migrate(v8WithTransactionFixture());
    const twice = migrate(rawClone(once));
    expect(twice).toEqual(once);
  });
});
