// @vitest-environment node
/**
 * NIZAM · spend_ledger repository tests — contract 06 §9 T14, T15, §6.1, §6.2
 * Implemented by: PFOS Contract 06 / Phase 1.4 (spec 06-two-agent-vps), owning requirement R5 (R17)
 * Depends on: spendLedgerRepo.ts, ../db/store.ts (a real migrated store), spendLedger.ts
 *
 * Against a REAL store on a temporary directory, not a double. The three properties under test are
 * properties of the engine as much as of the module — that an integer micro-USD cost survives a
 * round trip byte for byte, that the table itself refuses an edit, and that a per-agent total is
 * scoped by the read model rather than by trust — and a double would assert nothing about any of them.
 *
 *  T14 Actual reported cost is what lands in the ledger; an estimate never does (§6.2.1).
 *  T15 Exhausting one agent's weekly total refuses that agent and leaves the other unaffected
 *      (§6.2.3, R17), proven over one synthetic ledger holding BOTH agents' rows.
 *
 * Every guard is also shown REFUSING, and shown writing nothing when it refuses: §9 says a test that
 * has only ever been observed passing is not evidence.
 *
 * Every figure below is synthetic provider accounting in integer micro-USD. No cap literal is read
 * from source: a cap arrives as an argument (§6.3).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFinanceStore } from './store';
import type { StoreHandle } from './connection';
import {
  agentBudgetFromStore,
  appendSpend,
  readAgentWeekRows,
  readWeekRows,
  weeklySpendMicroUsd,
  type ProviderReportedSpend,
} from './spendLedgerRepo';
import {
  COST_SOURCE_ACTUAL,
  SpendLedgerError,
  type CostSourceActual,
  type SpendAgent,
} from '../../features/routing/spendLedger';

const WEEK = 'W2026-03-02';
/** A synthetic injected cap, integer micro-USD. Deliberately not the owner's real cap. */
const CAP_MICRO_USD = 1_000_000;

let handle: StoreHandle;
let dataDir: string;
let seq = 0;

function entry(over: Partial<ProviderReportedSpend> = {}): ProviderReportedSpend {
  seq += 1;
  return {
    id: `spend_${seq}`,
    agent: 'finance',
    occurredAt: '2026-03-04T09:15:00Z',
    modelId: 'model-alpha',
    costMicroUsd: 1_000,
    promptTokens: 120,
    completionTokens: 40,
    requestRef: `req_${seq}`,
    costSource: COST_SOURCE_ACTUAL,
    ...over,
  };
}

function rowCount(): number {
  const row = handle.db.prepare('SELECT COUNT(*) AS n FROM spend_ledger').get();
  return Number((row as { n: number }).n);
}

/** Read a stored row through SQL, so an assertion is about the table and not about the mapper. */
function storedRow(id: string): Record<string, unknown> | undefined {
  return handle.db.prepare('SELECT * FROM spend_ledger WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nizam-spend-'));
  let tick = 0;
  const now = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 2, 4, 0, 0, tick)).toISOString();
  };
  handle = openFinanceStore({ dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' }, now).handle;
});

afterEach(() => {
  handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('appendSpend records the ACTUAL reported cost (§6.2.1, T14)', () => {
  it('T14 stores the provider figure unchanged, as an integer, in its own micro-USD column', () => {
    const reported = 1_234_567;
    const row = appendSpend(handle, entry({ id: 'spend_actual', costMicroUsd: reported }));
    expect(row.costMicroUsd).toBe(reported);

    const stored = storedRow('spend_actual');
    expect(stored?.cost_micro_usd).toBe(reported);
    expect(Number.isSafeInteger(stored?.cost_micro_usd)).toBe(true);
    // The column is INTEGER in a STRICT table, so the engine itself holds the type.
    expect(typeof stored?.cost_micro_usd).toBe('number');
    expect(stored?.cost_source).toBe(COST_SOURCE_ACTUAL);
  });

  it('T14 refuses an estimate and writes NOTHING — an estimate may gate a call, never land', () => {
    const before = rowCount();
    const estimated = entry({
      id: 'spend_estimated',
      costSource: 'preflight_estimate' as unknown as CostSourceActual,
    });
    try {
      appendSpend(handle, estimated);
      expect.unreachable('an estimated cost must never be recorded');
    } catch (error) {
      expect(error).toBeInstanceOf(SpendLedgerError);
      expect((error as SpendLedgerError).code).toBe('SPEND_COST_SOURCE_NOT_ACTUAL');
    }
    expect(rowCount()).toBe(before);
    expect(storedRow('spend_estimated')).toBeUndefined();
  });

  it("refuses the engine's own path too: a raw INSERT of an estimate is rejected by the CHECK", () => {
    // The repository is the first belt; the table is the second. A caller reaching the handle
    // directly still cannot record an estimate.
    const insert = handle.db.prepare(
      `INSERT INTO spend_ledger
         (id, agent, occurred_at, week_key, model_id, cost_micro_usd, prompt_tokens, completion_tokens, request_ref, cost_source)
       VALUES (?, 'finance', ?, ?, 'model-alpha', 10, 1, 1, ?, 'preflight_estimate')`,
    );
    expect(() => insert.run('spend_raw_estimate', '2026-03-04T09:15:00Z', WEEK, 'req_raw')).toThrow();
    expect(storedRow('spend_raw_estimate')).toBeUndefined();
  });

  it('refuses a non-integer or negative cost without rounding, coercing, or repairing it', () => {
    const before = rowCount();
    const fractional = 1_000 + 1 / 3; // deliberately invalid fixture: the ledger unit is an integer
    for (const [id, cost, code] of [
      ['spend_fraction', fractional, 'SPEND_COST_NOT_INTEGER'],
      ['spend_negative', -1, 'SPEND_COST_NEGATIVE'],
    ] as const) {
      try {
        appendSpend(handle, entry({ id, costMicroUsd: cost }));
        expect.unreachable(`${id} must be refused`);
      } catch (error) {
        expect((error as SpendLedgerError).code).toBe(code);
      }
      expect(storedRow(id)).toBeUndefined();
    }
    expect(rowCount()).toBe(before);
  });

  it('refuses an unknown agent, an empty id, an empty model_id, and an empty request_ref', () => {
    const cases: readonly [string, Partial<ProviderReportedSpend>, string][] = [
      ['unknown agent', { id: 'bad_agent', agent: 'ops' as unknown as SpendAgent }, 'SPEND_AGENT_UNKNOWN'],
      ['empty id', { id: '   ' }, 'SPEND_ROW_ID_EMPTY'],
      ['empty model_id', { id: 'bad_model', modelId: '  ' }, 'SPEND_MODEL_ID_EMPTY'],
      ['empty request_ref', { id: 'bad_ref', requestRef: '' }, 'SPEND_REQUEST_REF_EMPTY'],
      ['fractional tokens', { id: 'bad_tokens', promptTokens: 1.5 }, 'SPEND_TOKENS_INVALID'],
    ];
    for (const [label, over, code] of cases) {
      try {
        appendSpend(handle, entry(over));
        expect.unreachable(`${label} must be refused`);
      } catch (error) {
        expect((error as SpendLedgerError).code, label).toBe(code);
      }
    }
    expect(rowCount()).toBe(0);
  });

  it('refuses a timestamp that is not an unambiguous UTC instant, rather than assuming a zone', () => {
    try {
      appendSpend(handle, entry({ id: 'bad_time', occurredAt: '2026-03-02T00:30:00+02:00' }));
      expect.unreachable('an offset-bearing timestamp must be refused');
    } catch (error) {
      expect((error as SpendLedgerError).code).toBe('SPEND_TIMESTAMP_MALFORMED');
    }
    expect(rowCount()).toBe(0);
  });

  it('§6.2.4 records a call whose result was unusable, because the cost was still incurred', () => {
    // There is no "was it successful" argument on the write path, by design: cost that was
    // incurred is cost that counts.
    appendSpend(handle, entry({ id: 'spend_unusable', costMicroUsd: 777 }));
    expect(weeklySpendMicroUsd(handle, 'finance', WEEK)).toBe(777);
  });
});

describe('the week bucket is derived at WRITE time and stored (§6.1)', () => {
  it('stores the UTC Monday that opens the week, so the read model never re-derives it', () => {
    appendSpend(handle, entry({ id: 'spend_wed', occurredAt: '2026-03-04T09:15:00Z' }));
    expect(storedRow('spend_wed')?.week_key).toBe(WEEK);
    expect(storedRow('spend_wed')?.occurred_at).toBe('2026-03-04T09:15:00Z');
  });

  it('puts a row on the next Monday into the next bucket, so a week boundary is a real boundary', () => {
    appendSpend(handle, entry({ id: 'spend_sun', occurredAt: '2026-03-08T23:59:59Z' }));
    appendSpend(handle, entry({ id: 'spend_mon', occurredAt: '2026-03-09T00:00:00Z' }));
    expect(storedRow('spend_sun')?.week_key).toBe(WEEK);
    expect(storedRow('spend_mon')?.week_key).toBe('W2026-03-09');
    expect(weeklySpendMicroUsd(handle, 'finance', WEEK)).toBe(1_000);
    expect(weeklySpendMicroUsd(handle, 'finance', 'W2026-03-09')).toBe(1_000);
  });
});

describe('the ledger is append-only (§6.2.2)', () => {
  const SOURCE_PATH = fileURLToPath(new URL('./spendLedgerRepo.ts', import.meta.url));

  /** Code lines only: a doc comment naming a verb is prose, not a statement using it. */
  function codeLines(source: string): string[] {
    return source
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return t !== '' && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('*/') && !t.startsWith('//');
      });
  }

  it('exposes no update path and no delete path anywhere in its executable source', () => {
    const code = codeLines(readFileSync(SOURCE_PATH, 'utf8')).join('\n');
    expect(code.length).toBeGreaterThan(500); // the scan below must not pass vacuously
    // The cross-database open statement is deliberately NOT in this list: `isolation.test.ts`
    // already scans the whole `src/server` tree for it, which is strictly stronger, and it does so
    // without writing the keyword. Repeating it here as a literal would trip that scan.
    for (const verb of ['UPDATE', 'DELETE', 'REPLACE INTO']) {
      expect(code.includes(verb), `${verb} must not appear in the repository source`).toBe(false);
    }
    // The barrel would re-export one if it existed; there is nothing to export.
    expect(Object.keys({ appendSpend, readWeekRows, readAgentWeekRows, weeklySpendMicroUsd, agentBudgetFromStore }))
      .toHaveLength(5);
  });

  it('refuses an UPDATE at the engine, so a future caller reaching the handle cannot edit a cost', () => {
    appendSpend(handle, entry({ id: 'spend_frozen', costMicroUsd: 500 }));
    expect(() => handle.db.prepare('UPDATE spend_ledger SET cost_micro_usd = 0 WHERE id = ?').run('spend_frozen'))
      .toThrow(/append-only/);
    expect(storedRow('spend_frozen')?.cost_micro_usd).toBe(500);
  });

  it('refuses a DELETE at the engine — an incurred cost is never removed', () => {
    appendSpend(handle, entry({ id: 'spend_kept', costMicroUsd: 500 }));
    expect(() => handle.db.prepare('DELETE FROM spend_ledger WHERE id = ?').run('spend_kept')).toThrow(/append-only/);
    expect(rowCount()).toBe(1);
  });

  it('corrects by COMPENSATING row, each with its own request_ref', () => {
    appendSpend(handle, entry({ id: 'spend_orig', costMicroUsd: 400, requestRef: 'req_orig' }));
    appendSpend(
      handle,
      // A correction is later in time and carries its OWN request_ref. Rows come back in
      // completion order (occurred_at, then id as the tie-break), so the history stays legible.
      entry({
        id: 'spend_comp',
        occurredAt: '2026-03-05T11:00:00Z',
        costMicroUsd: 150,
        requestRef: 'req_correction',
      }),
    );
    const rows = readAgentWeekRows(handle, 'finance', WEEK);
    expect(rows.map((r) => r.requestRef)).toEqual(['req_orig', 'req_correction']);
    expect(weeklySpendMicroUsd(handle, 'finance', WEEK)).toBe(550);
  });
});

describe('reads are keyed by agent and never aggregated across them (§6.2.3, T15, R17)', () => {
  /** One synthetic ledger holding BOTH agents, exactly as the repository hands it over. */
  beforeEach(() => {
    appendSpend(handle, entry({ id: 'life_1', agent: 'life', costMicroUsd: CAP_MICRO_USD }));
    appendSpend(handle, entry({ id: 'life_2', agent: 'life', costMicroUsd: CAP_MICRO_USD }));
    appendSpend(handle, entry({ id: 'fin_1', agent: 'finance', costMicroUsd: 400 }));
    // Another week for the same agent, to prove the week filter is real.
    appendSpend(handle, entry({ id: 'fin_prev', agent: 'finance', occurredAt: '2026-02-25T10:00:00Z', costMicroUsd: 9_000_000 }));
  });

  it('totals only the requested agent, whatever the other has spent', () => {
    expect(weeklySpendMicroUsd(handle, 'life', WEEK)).toBe(CAP_MICRO_USD * 2);
    expect(weeklySpendMicroUsd(handle, 'finance', WEEK)).toBe(400);
  });

  it('T15 exhausts one agent and leaves the other unaffected, from the SAME store and cap', () => {
    const cap = (agent: SpendAgent) => ({ agent, weekKey: WEEK, capMicroUsd: CAP_MICRO_USD });
    const life = agentBudgetFromStore(handle, cap('life'));
    const finance = agentBudgetFromStore(handle, cap('finance'));

    expect(life.exhausted).toBe(true);
    expect(life.remainingMicroUsd).toBe(0);

    expect(finance.exhausted).toBe(false);
    expect(finance.remainingMicroUsd).toBe(CAP_MICRO_USD - 400);
  });

  it('T15 holds symmetrically — the direction of exhaustion is not privileged', () => {
    appendSpend(handle, entry({ id: 'fin_big', agent: 'finance', costMicroUsd: CAP_MICRO_USD * 4 }));
    const finance = agentBudgetFromStore(handle, { agent: 'finance', weekKey: WEEK, capMicroUsd: CAP_MICRO_USD * 5 });
    const life = agentBudgetFromStore(handle, { agent: 'life', weekKey: WEEK, capMicroUsd: CAP_MICRO_USD * 5 });
    expect(finance.exhausted).toBe(false);

    const tightFinance = agentBudgetFromStore(handle, { agent: 'finance', weekKey: WEEK, capMicroUsd: 500 });
    expect(tightFinance.exhausted).toBe(true);
    // Life's own decision is untouched by finance's cap or its total.
    expect(life.exhausted).toBe(false);
    expect(life.spentMicroUsd).toBe(CAP_MICRO_USD * 2);
  });

  it('gives each agent its OWN cap, so a tight cap cannot borrow from a generous one', () => {
    const tightLife = agentBudgetFromStore(handle, { agent: 'life', weekKey: WEEK, capMicroUsd: 500_000 });
    const roomyFinance = agentBudgetFromStore(handle, { agent: 'finance', weekKey: WEEK, capMicroUsd: 4_000_000 });
    expect(tightLife.exhausted).toBe(true);
    expect(roomyFinance.exhausted).toBe(false);
    expect(roomyFinance.remainingMicroUsd).toBe(4_000_000 - 400);
  });

  it('excludes another week even for the same agent', () => {
    expect(weeklySpendMicroUsd(handle, 'finance', 'W2026-02-23')).toBe(9_000_000);
    expect(weeklySpendMicroUsd(handle, 'finance', WEEK)).toBe(400);
  });

  it('hands the week over for BOTH agents, and lets the pure read model do the scoping', () => {
    const week = readWeekRows(handle, WEEK);
    expect(week.map((r) => r.id).sort()).toEqual(['fin_1', 'life_1', 'life_2']);
    expect(new Set(week.map((r) => r.agent))).toEqual(new Set(['life', 'finance']));
    // The narrow query agrees with the filtered wide one, so neither path is privileged.
    expect(readAgentWeekRows(handle, 'life', WEEK).map((r) => r.id)).toEqual(
      week.filter((r) => r.agent === 'life').map((r) => r.id),
    );
  });

  it('refuses an injected cap that is not a non-negative integer of micro-USD', () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      try {
        agentBudgetFromStore(handle, { agent: 'finance', weekKey: WEEK, capMicroUsd: bad });
        expect.unreachable(`cap ${String(bad)} must be refused`);
      } catch (error) {
        expect((error as SpendLedgerError).code).toBe('SPEND_CAP_INVALID');
      }
    }
  });
});

describe('the ledger holds no owner money and no prompt content (§6.1, §3.4)', () => {
  it('declares no column that could carry prompt or completion text', () => {
    const columns = handle.db
      .prepare("SELECT name FROM pragma_table_info('spend_ledger')")
      .all()
      .map((r) => String((r as { name: string }).name));
    expect(columns).toEqual([
      'id',
      'agent',
      'occurred_at',
      'week_key',
      'model_id',
      'cost_micro_usd',
      'prompt_tokens',
      'completion_tokens',
      'request_ref',
      'cost_source',
    ]);
    for (const forbidden of ['prompt', 'completion', 'text', 'content', 'message']) {
      const offenders = columns.filter((c) => c.includes(forbidden) && !c.endsWith('_tokens'));
      expect(offenders, `no column may carry ${forbidden}`).toEqual([]);
    }
  });

  it('declares no monetary column in the currency the money core owns', () => {
    // Cost is provider accounting in its own integer unit; it can never be read as a ledger amount.
    const columns = handle.db
      .prepare("SELECT name FROM pragma_table_info('spend_ledger')")
      .all()
      .map((r) => String((r as { name: string }).name));
    for (const moneyish of ['amount', 'milliunits', 'balance', 'outflow', 'inflow']) {
      expect(columns.some((c) => c.includes(moneyish))).toBe(false);
    }
  });

  it('does not import the money core anywhere on this path', () => {
    const source = readFileSync(fileURLToPath(new URL('./spendLedgerRepo.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from\s+'[^']*lib\/money/);
  });
});
