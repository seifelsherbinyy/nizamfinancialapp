/**
 * NIZAM · fx_rates repository — contract 06 §4.4 (R2, R4)
 * Implemented by: PFOS Contract 06 / Phase 1.3 (spec 06-two-agent-vps)
 * Depends on: ../moneyBoundary.ts, rows.ts, support.ts
 *
 * A rate is the one place a float would look harmless and would not be. Contract 06 §4.4:
 * "a rate, a percentage, or an exchange rate is never stored as a float that later
 * multiplies money. Rates are stored as an integer numerator and an integer denominator,
 * and applied through `mulRatio`, which uses an exact intermediate. A rate table row that
 * cannot be expressed as an integer pair is rejected at the boundary by the same guard as
 * §4.2."
 *
 * So this repository has exactly one job beyond storage: run `assertRatePair` BEFORE a
 * statement is prepared, so a rate that is not an integer pair never reaches SQLite. The
 * guard is the same one every monetary column crosses, it throws the same typed error, and
 * it rounds nothing.
 *
 * `toFxRate` hands a stored row to the browser tier's own `FxRate` shape — the type the
 * net-worth engine's `toEgp` / `fromEgp` / `convert` already take. That is the whole point
 * of §4.3: the server does not convert currency with its own arithmetic, it hands the same
 * integer pair to the same engine. The import is type-only, so nothing about the browser
 * tier is resolved at runtime here.
 *
 * This table is a rate HISTORY, not a cache: a rate is appended, never edited, because a
 * conversion already recorded against last week's rate must stay re-derivable (contract 03
 * §8.3). There is no update path and no delete path.
 */
import type { FxRate } from '../../../features/netWorth/netWorth.types.ts';
import { assertRatePair } from '../moneyBoundary.ts';
import { RepositoryStateError } from '../errors.ts';
import type { FxRateInsert, FxRateRow } from './rows.ts';
import { recordAudit, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'fx_rates';

export interface FxRateListFilter {
  /** Restrict to one currency pair. */
  readonly baseCurrency?: string;
  readonly quoteCurrency?: string;
  /** Inclusive upper bound on `observed_at`, i.e. "the table as it stood on this date". */
  readonly asOfOnOrBefore?: string;
}

export interface FxRatesRepository {
  /** Append a rate. Guarded first: a non-integer pair never reaches the statement. */
  insert(input: FxRateInsert): FxRateRow;
  get(id: string): FxRateRow | null;
  /** Oldest first, then id, so the order is total and stable across runs. */
  list(filter?: FxRateListFilter): FxRateRow[];
  /** The most recent rate for a pair on or before `asOf`, or null when there is none. */
  latest(baseCurrency: string, quoteCurrency: string, asOf: string): FxRateRow | null;
}

function mapRow(raw: Record<string, unknown>): FxRateRow {
  return {
    id: String(raw['id']),
    baseCurrency: String(raw['base_currency']),
    quoteCurrency: String(raw['quote_currency']),
    rateNum: Number(raw['rate_num']),
    rateDen: Number(raw['rate_den']),
    observedAt: String(raw['observed_at']),
    source: String(raw['source']),
    recordedAt: String(raw['recorded_at']),
  };
}

/**
 * A stored row as the net-worth engine's `FxRate`. `currency` is the row's BASE currency
 * because that engine's rates are always "one unit of `currency` in EGP milliunits"; the
 * quote side is the engine's own base and is asserted by the caller that selected the row.
 */
export function toFxRate(row: FxRateRow): FxRate {
  return {
    currency: row.baseCurrency,
    perUnitNum: row.rateNum,
    perUnitDen: row.rateDen,
    source: row.source,
    observedAt: row.observedAt,
    // The server-tier FX row does not carry a conversion version yet. Adding that
    // column is a separate, authorized server schema change; 0 is the documented
    // initial semantics rather than a guess about a newer rule.
    conversionVersion: 0,
  };
}

export function createFxRatesRepository(ctx: RepositoryContext): FxRatesRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): FxRateRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): FxRateRow => {
    const row = readOne(id);
    if (!row) {
      throw new RepositoryStateError('REPOSITORY_ROW_NOT_FOUND', `NIZAM store: no ${TABLE} row with id ${id}`, {
        table: TABLE,
        rowId: id,
      });
    }
    return row;
  };

  return {
    insert(input: FxRateInsert): FxRateRow {
      // The §4.4 guard runs first. Nothing below is reached for a rate that is not an
      // integer pair, which is what makes "writes nothing" true rather than hopeful.
      const rate = assertRatePair(TABLE, { num: input.rateNum, den: input.rateDen });
      const at = ctx.now();

      return withTransaction(db, () => {
        db.prepare(
          `INSERT INTO ${TABLE}
             (id, base_currency, quote_currency, rate_num, rate_den, observed_at, source, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.id,
          input.baseCurrency,
          input.quoteCurrency,
          rate.num,
          rate.den,
          input.observedAt,
          input.source,
          at,
        );
        recordAudit(ctx, {
          action: 'fxRate.insert',
          entityTable: TABLE,
          entityId: input.id,
          // Column names and the pair's identity only. The rate itself is a stored fact,
          // not something the audit trail restates outside its guarded columns.
          detail: `${input.baseCurrency}/${input.quoteCurrency} observed_at=${input.observedAt}`,
        });
        return requireOne(input.id);
      });
    },

    get(id: string): FxRateRow | null {
      return readOne(id);
    },

    list(filter: FxRateListFilter = {}): FxRateRow[] {
      const clauses: string[] = [];
      const bindings: string[] = [];
      if (filter.baseCurrency !== undefined) {
        clauses.push('base_currency = ?');
        bindings.push(filter.baseCurrency);
      }
      if (filter.quoteCurrency !== undefined) {
        clauses.push('quote_currency = ?');
        bindings.push(filter.quoteCurrency);
      }
      if (filter.asOfOnOrBefore !== undefined) {
        clauses.push('observed_at <= ?');
        bindings.push(filter.asOfOnOrBefore);
      }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const raws = db
        .prepare(`SELECT * FROM ${TABLE}${where} ORDER BY observed_at, id`)
        .all(...bindings) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    latest(baseCurrency: string, quoteCurrency: string, asOf: string): FxRateRow | null {
      const raw = db
        .prepare(
          `SELECT * FROM ${TABLE}
            WHERE base_currency = ? AND quote_currency = ? AND observed_at <= ?
            ORDER BY observed_at DESC, recorded_at DESC, id DESC
            LIMIT 1`,
        )
        .get(baseCurrency, quoteCurrency, asOf) as Record<string, unknown> | undefined;
      return raw ? mapRow(raw) : null;
    },
  };
}
