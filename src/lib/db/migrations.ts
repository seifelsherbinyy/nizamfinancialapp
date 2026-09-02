/**
 * NIZAM · Schema migrations (forward-only, idempotent)
 * Implemented by: KIRO Contract 2 / Phase 2.3
 * Depends on: schema.ts
 *
 * `migrate` accepts any historical shape of nizam_db.json and returns a value
 * that validates against the CURRENT schema. Running it on current data is a no-op.
 */
import { SCHEMA_VERSION, validateDb, type NizamDb } from '@/lib/db/schema';
import { DEFAULT_POLICY } from '@/features/safeToSpend/policy.types';
import { BASE_CURRENCY, toCurrencyCode } from '@/lib/money/currency';

type RawDb = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): RawDb {
  return typeof value === 'object' && value !== null ? (value as RawDb) : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * v0 -> v1: the pre-release example shape (data/ledgers/nizam_db.example.json).
 *  - months carried three parallel maps `budgeted` / `activity` / `available`
 *    -> folded into `categories: { [id]: { assigned, activity, available } }`.
 *  - accounts/categories gained required fields (defaults filled).
 *  - meta gained revision + conflicts.
 */
function migrateV0toV1(raw: RawDb): RawDb {
  const meta = asRecord(raw.meta);
  const months = asArray(raw.months).map((m) => {
    const mm = asRecord(m);
    if (typeof mm.categories === 'object' && mm.categories !== null) {
      return mm; // already folded
    }
    const budgeted = asRecord(mm.budgeted);
    const activity = asRecord(mm.activity);
    const available = asRecord(mm.available);
    const ids = new Set([...Object.keys(budgeted), ...Object.keys(activity), ...Object.keys(available)]);
    const categories: RawDb = {};
    for (const id of ids) {
      categories[id] = {
        assigned: int(budgeted[id]),
        activity: int(activity[id]),
        available: int(available[id]),
      };
    }
    return { month: str(mm.month), categories };
  });

  const accounts = asArray(raw.accounts).map((a, i) => {
    const aa = asRecord(a);
    return {
      id: str(aa.id, `acc_${i}`),
      name: str(aa.name, `Account ${i + 1}`),
      type: str(aa.type, 'BANK_OTHER'),
      onBudget: bool(aa.onBudget, true),
      balance: int(aa.balance),
      clearedBalance: int(aa.clearedBalance, int(aa.balance)),
      accountIdentifier: strOrNull(aa.accountIdentifier),
      creditLimit: typeof aa.creditLimit === 'number' ? int(aa.creditLimit) : null,
      closed: bool(aa.closed),
      order: int(aa.order, i),
      paymentCategoryId: strOrNull(aa.paymentCategoryId),
    };
  });

  const categoryGroups = asArray(raw.categoryGroups).map((g, i) => {
    const gg = asRecord(g);
    return {
      id: str(gg.id, `grp_${i}`),
      name: str(gg.name, `Group ${i + 1}`),
      order: int(gg.order, i),
      hidden: bool(gg.hidden),
    };
  });

  const categories = asArray(raw.categories).map((c, i) => {
    const cc = asRecord(c);
    return {
      id: str(cc.id, `cat_${i}`),
      groupId: str(cc.groupId),
      name: str(cc.name, `Category ${i + 1}`),
      order: int(cc.order, i),
      hidden: bool(cc.hidden),
      target: cc.target && typeof cc.target === 'object' ? cc.target : null,
      isCreditCardPayment: bool(cc.isCreditCardPayment),
      linkedAccountId: strOrNull(cc.linkedAccountId),
    };
  });

  return {
    schemaVersion: 1,
    meta: {
      currency: str(meta.currency, 'EGP'),
      moneyBase: 'milliunits',
      createdAt: strOrNull(meta.createdAt),
      updatedAt: strOrNull(meta.updatedAt),
      revision: int(meta.revision),
      conflicts: asArray(meta.conflicts),
    },
    accounts,
    categoryGroups,
    categories,
    months,
    payees: asArray(raw.payees),
    transactions: asArray(raw.transactions),
  };
}

/**
 * v1 -> v2 (PFOS Stage 1): adds the obligation registry and the version-controlled
 * financial policy. Purely additive — every existing collection is passed through
 * untouched, so a v1 file loads with an empty obligation list and default policy
 * and produces byte-identical budget numbers.
 */
function migrateV1toV2(raw: RawDb): RawDb {
  const policy = asRecord(raw.policy);
  const hasPolicy = Object.keys(policy).length > 0;
  return {
    ...raw,
    schemaVersion: 2,
    obligations: asArray(raw.obligations),
    policy: hasPolicy
      ? {
          minimumLiquidityBuffer: int(policy.minimumLiquidityBuffer, DEFAULT_POLICY.minimumLiquidityBuffer),
          essentialLivingMonthly: int(policy.essentialLivingMonthly, DEFAULT_POLICY.essentialLivingMonthly),
          uncertaintyBps: int(policy.uncertaintyBps, DEFAULT_POLICY.uncertaintyBps),
          stalenessBps: int(policy.stalenessBps, DEFAULT_POLICY.stalenessBps),
          staleAfterDays: int(policy.staleAfterDays, DEFAULT_POLICY.staleAfterDays),
          expectedInflow: policy.expectedInflow ?? null,
        }
      : { ...DEFAULT_POLICY },
  };
}

/**
 * v2 -> v3 (PFOS Stage 3): adds the append-only decision outcome registry. Purely
 * additive — a v2 file loads with an empty decision list and unchanged everything else.
 */
function migrateV2toV3(raw: RawDb): RawDb {
  return {
    ...raw,
    schemaVersion: 3,
    decisions: asArray(raw.decisions),
  };
}

/**
 * v3 -> v4 (PFOS Stage 4): adds net-worth entities (assets, fx rates, macro). Purely
 * additive — a v3 file loads with empty asset/fx lists and a zeroed macro context, so
 * every existing number (budget, safe-to-spend, forecast) is byte-identical.
 */
function migrateV3toV4(raw: RawDb): RawDb {
  const macro = asRecord(raw.macro);
  const hasMacro = Object.keys(macro).length > 0;
  return {
    ...raw,
    schemaVersion: 4,
    assets: asArray(raw.assets),
    fxRates: asArray(raw.fxRates),
    macro: hasMacro
      ? {
          referenceCurrency: str(macro.referenceCurrency, 'EGP'),
          annualInflationBps: int(macro.annualInflationBps, 0),
          inflationSource: str(macro.inflationSource, 'unset'),
          inflationAsOf: str(macro.inflationAsOf, '1970-01-01'),
        }
      : { referenceCurrency: 'EGP', annualInflationBps: 0, inflationSource: 'unset', inflationAsOf: '1970-01-01' },
  };
}

/**
 * v4 -> v5 (C6 Step 2a): explicit currency carriers.
 *  - `Account.currency` and `Transaction.currency` are added (FN-YNAB-01, C6 I1.2).
 *  - `FxRate.conversionVersion` is added.
 *
 * PURELY ADDITIVE. No existing field is renamed, retyped or dropped, and NO
 * monetary value is touched: `amount`, `balance`, `clearedBalance`, `creditLimit`
 * and every FX ratio pass through byte-identical. A v4 store is single-currency by
 * construction (money-rules assumed EGP throughout and there was nowhere to record
 * anything else), so `meta.currency` — already persisted and defaulted to 'EGP'
 * since v1 — is the correct and non-guessing source for the backfill.
 *
 * `FxRate.asOf` is left untouched at this step. It is widened to `observedAt` two
 * versions later, at v7->v8 (owner decision D1, 2026-09-02, vNext P2) — see
 * `migrateV7toV8` below.
 */
function migrateV4toV5(raw: RawDb): RawDb {
  const meta = asRecord(raw.meta);
  // The store's own recorded currency, not a hardcoded guess.
  const storeCurrency = toCurrencyCode(meta.currency, BASE_CURRENCY);

  const accounts = asArray(raw.accounts).map((a) => {
    const aa = asRecord(a);
    return { ...aa, currency: toCurrencyCode(aa.currency, storeCurrency) };
  });

  const transactions = asArray(raw.transactions).map((t) => {
    const tt = asRecord(t);
    return { ...tt, currency: toCurrencyCode(tt.currency, storeCurrency) };
  });

  const fxRates = asArray(raw.fxRates).map((r) => {
    const rr = asRecord(r);
    return { ...rr, conversionVersion: int(rr.conversionVersion, 0) };
  });

  return { ...raw, schemaVersion: 5, accounts, transactions, fxRates };
}

/**
 * v5 -> v4 REVERSE migration. Not part of the forward-only `migrate` chain; it
 * exists so the vNext reversibility bar (P3) is provable: a v4 fixture must
 * migrate up and back with ZERO monetary drift. Exported for tests and for an
 * emergency downgrade path.
 *
 * Strips only the fields v5 added. Any row whose currency differs from the store
 * currency CANNOT be represented in v4, so this refuses rather than silently
 * discarding the distinction — losing a currency would misstate money.
 */
export function downgradeV5toV4(raw: RawDb): RawDb {
  const meta = asRecord(raw.meta);
  const storeCurrency = toCurrencyCode(meta.currency, BASE_CURRENCY);

  const offenders: string[] = [];
  const strip = (rows: unknown[], kind: string): RawDb[] =>
    rows.map((row) => {
      const r = asRecord(row);
      const c = toCurrencyCode(r.currency, storeCurrency);
      if (c !== storeCurrency) offenders.push(`${kind} ${str(r.id, '(no id)')} is ${c}`);
      const { currency: _dropped, ...rest } = r;
      return rest;
    });

  const accounts = strip(asArray(raw.accounts), 'account');
  const transactions = strip(asArray(raw.transactions), 'transaction');
  if (offenders.length > 0) {
    throw new Error(
      'NIZAM downgrade v5->v4 refused: v4 cannot represent more than one currency. ' +
        offenders.join('; '),
    );
  }

  const fxRates = asArray(raw.fxRates).map((r) => {
    const { conversionVersion: _dropped, ...rest } = asRecord(r);
    return rest;
  });

  return { ...raw, schemaVersion: 4, accounts, transactions, fxRates };
}

/**
 * v5 -> v6: adds the candidate staging tier.
 *  - `transactionCandidates` is injected as an empty array; existing databases have no candidates.
 *  - All other collections are unchanged.
 *  - SCHEMA_VERSION bumped to 6.
 *  - Running on a v6 database is a no-op (the field already exists).
 */
function migrateV5toV6(raw: RawDb): RawDb {
  return {
    ...raw,
    schemaVersion: 6,
    transactionCandidates: asArray(raw.transactionCandidates),
  };
}

/**
 * v6 -> v5 (non-destructive downgrade for testing; outside the forward `migrate()` chain).
 *
 * Refuses if `transactionCandidates` is non-empty: dropping unreviewed rows without owner
 * knowledge would silently destroy import history.
 */
export function downgradeV6toV5(raw: unknown): Record<string, unknown> {
  const db = typeof raw === 'object' && raw !== null ? (raw as RawDb) : ({} as RawDb);
  const candidates = asArray(db.transactionCandidates);
  if (candidates.length > 0) {
    throw new Error(
      `NIZAM downgrade v6->v5 refused: ${candidates.length} unreviewed candidate(s) would be silently dropped. Promote or discard them first.`,
    );
  }
  const { transactionCandidates: _dropped, ...rest } = db;
  return { ...rest, schemaVersion: 5 };
}

// ---------------------------------------------------------------------------
// v6 -> v7: target vocabulary widening (architecture Step 7)
// ---------------------------------------------------------------------------

/** The two v6 target names and their v7 replacements. Total and lossless. */
const V6_TARGET_RENAME: Record<string, string> = {
  monthly: 'monthly_funding',
  target_by_date: 'target_balance_by_date',
};

/**
 * v6 -> v7: widens `CategoryTarget.type` from two names to the eight-type vocabulary and
 * adds the two new fields.
 *
 * Renames rather than aliases (see budget.types.ts): `monthly` -> `monthly_funding`,
 * `target_by_date` -> `target_balance_by_date`. Lossless and reversible.
 *
 * Behaviour preservation:
 *  - `rollover` defaults to `set_aside`, which is what the v6 engine did for `monthly`
 *    (it compared against `assigned`, ignoring what carried in). For every balance and
 *    obligation family the engine forces `refill`, so the stored value is inert there
 *    and the default cannot change a figure.
 *  - `obligationId` defaults to null; v6 had no way to link a target to an obligation.
 *  - A `target_by_date` with a NULL targetMonth becomes `target_balance`. The v6 engine
 *    substituted `monthsLeft = 1` for that shape, a silent fallback; `target_balance` is
 *    its honest equivalent and yields the same shortfall figure. Such a row cannot have
 *    been created by the UI, but the migration must be total.
 *  - No monetary field is read or written. Zero monetary drift by construction.
 *  - Running on a v7 database is a no-op (unknown names are left alone and the two new
 *    fields are preserved when already present).
 */
function migrateV6toV7(raw: RawDb): RawDb {
  const categories = asArray(raw.categories).map((c) => {
    const cat = asRecord(c);
    if (cat.target === null || cat.target === undefined) return { ...cat, target: null };
    const target = asRecord(cat.target);
    const rawType = str(target.type);
    let type = V6_TARGET_RENAME[rawType] ?? rawType;
    const targetMonth = strOrNull(target.targetMonth);
    if (type === 'target_balance_by_date' && targetMonth === null) {
      type = 'target_balance';
    }
    // Stored rollover is normalised to what the engine will actually apply, so the
    // record never implies a choice that has no effect: only the per-month family
    // consults it, and every other family is structurally `refill`.
    const perMonth = type === 'monthly_funding';
    const rollover = str(target.rollover);
    return {
      ...cat,
      target: {
        ...target,
        type,
        targetMonth,
        rollover: perMonth ? (rollover === 'refill' ? 'refill' : 'set_aside') : 'refill',
        obligationId: strOrNull(target.obligationId),
      },
    };
  });
  return { ...raw, schemaVersion: 7, categories };
}

/**
 * v7 target types that v6 cannot express and that the downgrade must refuse.
 *
 * `target_balance` is NOT in this list because it is structurally equivalent to the
 * v6 `target_by_date` with a null targetMonth — that was the only way to express
 * "reach a balance with no deadline" in v6, and the migration converts it in both
 * directions losslessly. Refusing it would make a v7->v6->v7 round-trip impossible
 * even though no new information was added.
 */
const V7_ONLY_TARGET_TYPES = [
  'sinking_fund',
  'acquisition',
  'emergency_reserve',
  'obligation_reserve',
  'debt_reduction',
];

/**
 * v7 -> v6 (non-destructive downgrade for testing; outside the forward `migrate()` chain).
 *
 * Refuses when any category uses one of the six target types v6 has no name for, or
 * carries an obligation link v6 cannot store. Silently collapsing a `debt_reduction`
 * into `monthly` would invent a funding demand, so refusal is the only honest outcome.
 */
export function downgradeV7toV6(raw: unknown): Record<string, unknown> {
  const db = typeof raw === 'object' && raw !== null ? (raw as RawDb) : ({} as RawDb);
  const cats = asArray(db.categories).map(asRecord);
  const offending: string[] = [];
  for (const cat of cats) {
    if (cat.target === null || cat.target === undefined) continue;
    const target = asRecord(cat.target);
    const type = str(target.type);
    if (V7_ONLY_TARGET_TYPES.includes(type)) offending.push(`${str(cat.id)}:${type}`);
    else if (strOrNull(target.obligationId) !== null) offending.push(`${str(cat.id)}:obligationId`);
  }
  if (offending.length > 0) {
    throw new Error(
      `NIZAM downgrade v7->v6 refused: ${offending.length} target(s) cannot be expressed in v6 (${offending.join(', ')}). Change them to a monthly or dated target first.`,
    );
  }
  const reverse: Record<string, string> = {
    monthly_funding: 'monthly',
    target_balance_by_date: 'target_by_date',
    // target_balance is the v7 name for "target_by_date with no date"; v6 expressed
    // this as target_by_date with a null targetMonth — functionally identical.
    target_balance: 'target_by_date',
  };
  const categories = cats.map((cat) => {
    if (cat.target === null || cat.target === undefined) return { ...cat, target: null };
    const { rollover: _r, obligationId: _o, ...target } = asRecord(cat.target);
    const type = str(target.type);
    return { ...cat, target: { ...target, type: reverse[type] ?? type } };
  });
  return { ...db, schemaVersion: 6, categories };
}

// ---------------------------------------------------------------------------
// v7 -> v8: FxRate.asOf -> observedAt datetime widening (owner decision D1, 2026-09-02)
// ---------------------------------------------------------------------------

/**
 * v7 -> v8: widens every `fxRates[].asOf` (date-only `YYYY-MM-DD`) to `observedAt`
 * (ISO 8601 UTC datetime), by appending `T00:00:00Z`.
 *
 * Ordering is preserved EXACTLY: every migrated row gets the same time-of-day, so a
 * lexicographic comparison of the widened strings yields the identical order as the
 * date-only strings did. No monetary field is read or written — `perUnitNum`,
 * `perUnitDen` and `conversionVersion` pass through untouched, so this migration
 * cannot move money.
 *
 * A row already carrying `observedAt` (e.g. a v8 row re-migrated through v7->v8 by a
 * caller that did not check the version first) is left alone, so this is idempotent.
 * A row with neither key is impossible in practice (schema-validated input) but is
 * given `1970-01-01T00:00:00Z` rather than thrown away, matching the total-migration
 * discipline used elsewhere in this file.
 */
function migrateV7toV8(raw: RawDb): RawDb {
  const fxRates = asArray(raw.fxRates).map((r) => {
    const row = asRecord(r);
    if (typeof row.observedAt === 'string') return row;
    const asOf = typeof row.asOf === 'string' ? row.asOf : '1970-01-01';
    const { asOf: _dropped, ...rest } = row;
    return { ...rest, observedAt: `${asOf}T00:00:00Z` };
  });
  return { ...raw, schemaVersion: 8, fxRates };
}

/**
 * v8 -> v7 (non-destructive downgrade for testing; outside the forward `migrate()` chain).
 *
 * Refuses when any `observedAt` carries a real time other than midnight UTC: truncating
 * `14:32:07Z` back to a bare date would silently discard the information the widening
 * exists to hold, and a caller that later ordered same-day rates by wall time would get a
 * different, wrong answer with no signal anything changed.
 */
export function downgradeV8toV7(raw: unknown): Record<string, unknown> {
  const db = typeof raw === 'object' && raw !== null ? (raw as RawDb) : ({} as RawDb);
  const rows = asArray(db.fxRates).map(asRecord);
  const offending: string[] = [];
  const fxRates = rows.map((row) => {
    const observedAt = str(row.observedAt);
    const match = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?Z$/.exec(observedAt);
    if (!match) {
      offending.push(`${str(row.currency)}@${observedAt}`);
      return row;
    }
    const { observedAt: _dropped, ...rest } = row;
    return { ...rest, asOf: match[1] };
  });
  if (offending.length > 0) {
    throw new Error(
      `NIZAM downgrade v8->v7 refused: ${offending.length} FX observation(s) carry a real time that a date-only asOf cannot hold (${offending.join(', ')}). Downgrade is not possible without losing information.`,
    );
  }
  return { ...db, schemaVersion: 7, fxRates };
}

/**
 * Migrate any historical raw JSON value to the current schema and validate it.
 * Forward-only; idempotent (current-version input passes through untouched).
 */
export function migrate(rawValue: unknown): NizamDb {
  let raw = asRecord(rawValue);
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `NIZAM db schemaVersion ${version} is newer than this app understands (${SCHEMA_VERSION}). Update the app.`,
    );
  }
  if (version < 1) {
    raw = migrateV0toV1(raw);
  }
  if (version < 2) {
    raw = migrateV1toV2(raw);
  }
  if (version < 3) {
    raw = migrateV2toV3(raw);
  }
  if (version < 4) {
    raw = migrateV3toV4(raw);
  }
  if (version < 5) {
    raw = migrateV4toV5(raw);
  }
  if (version < 6) {
    raw = migrateV5toV6(raw);
  }
  if (version < 7) {
    raw = migrateV6toV7(raw);
  }
  if (version < 8) {
    raw = migrateV7toV8(raw);
  }
  return validateDb(raw);
}
