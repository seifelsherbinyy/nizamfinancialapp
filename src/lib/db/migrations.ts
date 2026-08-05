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
  return validateDb(raw);
}
