// @vitest-environment node
/**
 * NIZAM · model_telemetry repository tests — contract 06 §9 T16, §3.3/§3.4/§6.2; contract 12 §6.4
 * Implemented by: PFOS Contract 12 / Phase 5.3 (spec 06-two-agent-vps), owning requirement R19
 * Depends on: modelTelemetryRepo.ts, ./store.ts (a REAL migrated store), ./schema.ts,
 *   ../ports/openrouter (the one telemetry projection, as a type)
 *
 * T16: "No table accepts a column named in §3.4; telemetry rejects prompt text" (R19).
 *
 * Against a real store on a temporary directory, because three of the claims are properties of the
 * ENGINE rather than of this module: that the table declares no column able to hold content, that
 * the actual-cost column refuses an estimate whatever path reaches it, and that an UPDATE or a
 * DELETE against recorded telemetry is aborted. A double would assert nothing about any of them.
 *
 * Every gate below is also shown REFUSING, and shown writing nothing when it refuses — a test that
 * has only ever been observed passing is not evidence (design, testing strategy). The four layers
 * the module claims are each exercised on their own:
 *
 *   layer 1  the projection's type — asserted by the compiler, and its runtime belt tested here
 *   layer 2  the DDL — asserted against the live `table_info` AND against the migration DDL text
 *   layer 3  the write path — every refusal, with the store left untouched
 *   layer 4  `contentBreaches` over a row the write path NEVER SAW, inserted through the handle
 *
 * Every figure below is synthetic provider accounting in integer micro-USD. No real amount, no
 * real model roster entry, no deployment particular (R24).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFinanceStore } from './store.ts';
import type { StoreHandle } from './connection.ts';
import { SCHEMA_STATEMENTS, TABLES, TELEMETRY_FORBIDDEN_COLUMNS } from './schema.ts';
import {
  contentBreaches,
  ESTIMATE_SOURCE_PREFLIGHT,
  MODEL_TELEMETRY_COLUMNS,
  ModelTelemetryError,
  readTelemetry,
  recordedCallCount,
  recordTelemetry,
  TELEMETRY_FIELD_MAX_LENGTH,
  TELEMETRY_OUTCOMES,
  type ModelTelemetryErrorCode,
  type PreflightCostEstimate,
  type TelemetryRecord,
} from './modelTelemetryRepo.ts';
import { COST_SOURCE_ACTUAL, type SpendAgent } from '../../features/routing/spendLedger.ts';
import type { ModelCallTelemetry } from '../ports/openrouter.ts';

const SOURCE_PATH = fileURLToPath(new URL('./modelTelemetryRepo.ts', import.meta.url));

let handle: StoreHandle;
let dataDir: string;
let seq = 0;

/** A synthetic loggable projection. Named models are fixtures, not roster entries. */
function projection(over: Partial<ModelCallTelemetry> = {}): ModelCallTelemetry {
  return {
    correlationRef: `req_${seq}`,
    agent: 'finance',
    tier: 'T2',
    modelIdRequested: 'model-alpha',
    modelIdServed: 'model-alpha',
    promptTokens: 120,
    completionTokens: 40,
    costMicroUsd: 1_000,
    costSource: COST_SOURCE_ACTUAL,
    latencyMs: 12,
    schemaValid: true,
    privacyPolicyAsserted: true,
    outcome: 'ok',
    ...over,
  } as ModelCallTelemetry;
}

function record(over: Partial<TelemetryRecord> = {}, telemetryOver: Partial<ModelCallTelemetry> = {}): TelemetryRecord {
  seq += 1;
  return {
    id: `tel_${seq}`,
    occurredAt: '2026-03-04T09:15:00Z',
    telemetry: projection({ correlationRef: `req_${seq}`, ...telemetryOver }),
    ...over,
  };
}

function columnsOf(table: string): string[] {
  return handle.db
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all()
    .map((row) => String((row as { name: string }).name));
}

/** Read a stored row through SQL, so an assertion is about the table and not about the mapper. */
function storedRow(id: string): Record<string, unknown> | undefined {
  return handle.db.prepare('SELECT * FROM model_telemetry WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

/** Assert one write refusal: the code, and that the store is untouched. */
function refuses(entry: TelemetryRecord, code: ModelTelemetryErrorCode, label: string): ModelTelemetryError {
  const before = recordedCallCount(handle);
  try {
    recordTelemetry(handle, entry);
    expect.unreachable(`${label} must be refused`);
  } catch (error) {
    expect(error, label).toBeInstanceOf(ModelTelemetryError);
    expect((error as ModelTelemetryError).code, label).toBe(code);
    expect(recordedCallCount(handle), `${label} must write nothing`).toBe(before);
    expect(storedRow(entry.id), `${label} must leave no row`).toBeUndefined();
    return error as ModelTelemetryError;
  }
  throw new Error('unreachable');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'nizam-telemetry-'));
  let tick = 0;
  const now = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 2, 4, 0, 0, tick)).toISOString();
  };
  handle = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  ).handle;
});

afterEach(() => {
  handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Layer 2 — the DDL, live and as text
// ---------------------------------------------------------------------------------------------

describe('T16 no column can hold prompt or completion text (§3.4, §6.4, R19)', () => {
  it('declares exactly the columns the module names, in `table_info` order', () => {
    expect(columnsOf('model_telemetry')).toEqual([...MODEL_TELEMETRY_COLUMNS]);
  });

  it('T16 no table in the store carries a forbidden column name, not only the telemetry table', () => {
    expect(TABLES.length).toBeGreaterThan(10); // the loop below must not pass vacuously
    expect(TELEMETRY_FORBIDDEN_COLUMNS.length).toBeGreaterThan(10);
    for (const table of TABLES) {
      const names = columnsOf(table).map((name) => name.toLowerCase());
      expect(names.length, `${table} must exist`).toBeGreaterThan(0);
      for (const forbidden of TELEMETRY_FORBIDDEN_COLUMNS) {
        expect(names, `${table} must never grow a "${forbidden}" column`).not.toContain(forbidden);
      }
    }
  });

  it('keeps the two token COUNTS, because a measurement of content is not content (§6.4)', () => {
    const names = columnsOf('model_telemetry');
    expect(names).toContain('prompt_tokens');
    expect(names).toContain('completion_tokens');
    // And nothing beyond a count: no column whose name contains the content word without `_tokens`.
    for (const fragment of ['prompt', 'completion', 'text', 'content', 'message']) {
      expect(names.filter((name) => name.includes(fragment) && !name.endsWith('_tokens'))).toEqual([]);
    }
  });

  it('declares no forbidden column in the DDL TEXT of any migration, not merely in the live table', () => {
    // The structural half. A column can only exist if some migration declares it, so scanning the
    // series is the assertion that no future migration can add one without failing here.
    const ddl = Object.values(SCHEMA_STATEMENTS).flat().join('\n').toLowerCase();
    expect(ddl.length).toBeGreaterThan(2_000);
    for (const forbidden of TELEMETRY_FORBIDDEN_COLUMNS) {
      // Word-bounded, so `prompt_tokens` does not read as `prompt`.
      const declared = new RegExp(`(^|[\\s(,])${forbidden}[\\s]+(text|integer|real|blob|any)\\b`, 'm');
      expect(declared.test(ddl), `no migration may declare a "${forbidden}" column`).toBe(false);
    }
  });

  it('names no monetary column in the unit the money core owns, and does not import it', () => {
    const names = columnsOf('model_telemetry');
    for (const moneyish of ['milliunits', 'balance', 'outflow', 'inflow', 'amount']) {
      expect(names.some((name) => name.includes(moneyish)), moneyish).toBe(false);
    }
    expect(readFileSync(SOURCE_PATH, 'utf8')).not.toMatch(/from\s+'[^']*lib\/money/);
  });
});

// ---------------------------------------------------------------------------------------------
// Layer 3 — the write path
// ---------------------------------------------------------------------------------------------

describe('the write path accepts nothing broader than the loggable projection (§6.4, R19)', () => {
  it('refuses a projection carrying a content-named field, and does not quote the value', () => {
    const leaked = 'the owner asked about a statement and the model replied at length';
    const error = refuses(
      record({}, { prompt: leaked } as unknown as Partial<ModelCallTelemetry>),
      'TELEMETRY_CONTENT_FIELD_PRESENT',
      'a projection carrying prompt text',
    );
    expect(error.message).toContain('prompt');
    // The refusal names the KEY. Quoting the value would itself be the log line R19 forbids.
    expect(error.message).not.toContain(leaked);
    expect(JSON.stringify(error.detail)).not.toContain(leaked);
  });

  it('refuses every content-named field the forbidden list knows about', () => {
    for (const field of ['completion', 'text', 'content', 'messages', 'body', 'transcript']) {
      refuses(
        record({}, { [field]: 'x' } as unknown as Partial<ModelCallTelemetry>),
        'TELEMETRY_CONTENT_FIELD_PRESENT',
        `a projection carrying ${field}`,
      );
    }
  });

  it('refuses a surplus field that is NOT content-named either, rather than dropping it', () => {
    const error = refuses(
      record({}, { operatorNote: 'x' } as unknown as Partial<ModelCallTelemetry>),
      'TELEMETRY_CONTENT_FIELD_PRESENT',
      'a surplus field',
    );
    expect(error.message).toContain('not part of the loggable projection');
  });

  it('refuses prose in a permitted field, so an innocuous column name is no way in', () => {
    const prose = 'x'.repeat(TELEMETRY_FIELD_MAX_LENGTH + 1);
    refuses(record({}, { modelIdServed: prose }), 'TELEMETRY_CONTENT_FIELD_PRESENT', 'an over-length model identity');
    refuses(
      record({}, { modelIdRequested: 'model-alpha\nand then the model said' }),
      'TELEMETRY_CONTENT_FIELD_PRESENT',
      'a model identity carrying a newline',
    );
    refuses(record({ id: 'a\nb' }), 'TELEMETRY_CONTENT_FIELD_PRESENT', 'a row id carrying a newline');
  });

  it('records the four permitted measurements and the verdict, unchanged', () => {
    const row = recordTelemetry(
      handle,
      record({ id: 'tel_ok' }, { promptTokens: 321, completionTokens: 89, latencyMs: 1_450, schemaValid: false }),
    );
    expect(row.promptTokens).toBe(321);
    expect(row.completionTokens).toBe(89);
    expect(row.latencyMs).toBe(1_450);
    expect(row.schemaValid).toBe(false);

    const stored = storedRow('tel_ok');
    expect(stored?.prompt_tokens).toBe(321);
    expect(stored?.completion_tokens).toBe(89);
    expect(stored?.latency_ms).toBe(1_450);
    // The verdict is stored as the engine's boolean and read back as one.
    expect(stored?.schema_valid).toBe(0);
    expect(readTelemetry(handle, { requestRef: row.requestRef })[0]?.schemaValid).toBe(false);
  });

  it('records a VALID schema verdict as the other value, so the column is not write-only', () => {
    recordTelemetry(handle, record({ id: 'tel_valid' }, { schemaValid: true }));
    expect(storedRow('tel_valid')?.schema_valid).toBe(1);
  });

  it('refuses a non-integer, negative, or absent measurement without rounding or coercing', () => {
    const cases: readonly [string, Partial<ModelCallTelemetry>][] = [
      ['fractional prompt tokens', { promptTokens: 1.5 }],
      ['negative completion tokens', { completionTokens: -1 }],
      ['fractional latency', { latencyMs: 12.5 }],
      ['negative latency', { latencyMs: -1 }],
      ['a latency that is a string', { latencyMs: '12' as unknown as number }],
      ['a cost that is not an integer', { costMicroUsd: 1_000 + 1 / 3 }],
      ['a negative cost', { costMicroUsd: -1 }],
    ];
    for (const [label, over] of cases) {
      refuses(record({}, over), 'TELEMETRY_MEASUREMENT_INVALID', label);
    }
  });

  it('refuses a missing schema verdict rather than defaulting it — absent is not "invalid"', () => {
    const error = refuses(
      record({}, { schemaValid: undefined as unknown as boolean }),
      'TELEMETRY_SCHEMA_VERDICT_INVALID',
      'an absent schema verdict',
    );
    expect(error.message).toContain('not the same as a failed one');
  });

  it('refuses an unasserted privacy policy, because a row that exists asserts it (§6.4)', () => {
    refuses(
      record({}, { privacyPolicyAsserted: false as unknown as true }),
      'TELEMETRY_PRIVACY_NOT_ASSERTED',
      'a row that does not assert the privacy policy',
    );
  });

  it('stores the per-request privacy assertion, so a test can OBSERVE it rather than trust it', () => {
    recordTelemetry(handle, record({ id: 'tel_privacy' }));
    expect(storedRow('tel_privacy')?.privacy_policy_asserted).toBe('true');
    // The column admits exactly one value, so no row can claim otherwise through the handle.
    expect(() =>
      handle.db
        .prepare(
          `INSERT INTO model_telemetry
             (id, request_ref, agent, occurred_at, model_id, turn_class, prompt_tokens, completion_tokens,
              latency_ms, schema_valid, outcome, actual_cost_micro_usd, actual_cost_source,
              preflight_estimate_micro_usd, model_id_served, privacy_policy_asserted)
           VALUES ('tel_raw_privacy', 'req_raw', 'finance', '2026-03-04T09:15:00Z', 'model-alpha', 'T2',
                   1, 1, 1, 1, 'ok', 1, 'provider_reported_actual', NULL, 'model-alpha', 'false')`,
        )
        .run(),
    ).toThrow();
    expect(storedRow('tel_raw_privacy')).toBeUndefined();
  });

  it('refuses a T0 turn class: a T0 turn invokes no model, so the row is a contradiction (R16)', () => {
    const error = refuses(
      record({}, { tier: 'T0' as unknown as ModelCallTelemetry['tier'] }),
      'TELEMETRY_TURN_CLASS_INVALID',
      'a telemetry row at the no-model tier',
    );
    expect(error.message).toContain('invokes no model');
  });

  it('refuses an unknown agent, an empty identifier, an unknown outcome, and a bad instant', () => {
    refuses(record({}, { agent: 'ops' as unknown as SpendAgent }), 'TELEMETRY_AGENT_UNKNOWN', 'an unknown agent');
    refuses(record({ id: '   ' }), 'TELEMETRY_ID_EMPTY', 'an empty row id');
    refuses(record({}, { correlationRef: '' }), 'TELEMETRY_REQUEST_REF_EMPTY', 'an empty correlation reference');
    refuses(record({}, { modelIdRequested: ' ' }), 'TELEMETRY_MODEL_ID_EMPTY', 'an empty requested model');
    refuses(record({}, { modelIdServed: ' ' }), 'TELEMETRY_MODEL_ID_EMPTY', 'an empty served model');
    refuses(
      record({}, { outcome: 'maybe' as unknown as ModelCallTelemetry['outcome'] }),
      'TELEMETRY_OUTCOME_UNKNOWN',
      'an unknown outcome',
    );
    refuses(
      record({ occurredAt: '2026-03-04T09:15:00+02:00' }),
      'TELEMETRY_TIMESTAMP_MALFORMED',
      'an offset-bearing instant',
    );
    refuses(record({ occurredAt: '2026-02-30' }), 'TELEMETRY_TIMESTAMP_MALFORMED', 'an instant that does not exist');
  });

  it('records every outcome the projection distinguishes, including a refusal and a provider error', () => {
    expect([...TELEMETRY_OUTCOMES].sort()).toEqual(['ok', 'provider_error', 'refused']);
    for (const outcome of TELEMETRY_OUTCOMES) {
      const row = recordTelemetry(handle, record({ id: `tel_${outcome}` }, { outcome }));
      expect(row.outcome).toBe(outcome);
    }
    expect(recordedCallCount(handle)).toBe(TELEMETRY_OUTCOMES.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Actual versus estimated
// ---------------------------------------------------------------------------------------------

describe('actual reported cost and a pre-flight estimate cannot be confused (§6.2.1, contract 11)', () => {
  const estimate = (microUsd: number): PreflightCostEstimate => ({
    estimateSource: ESTIMATE_SOURCE_PREFLIGHT,
    microUsd,
  });

  it('stores the provider figure unchanged in its own column, with its provenance', () => {
    const reported = 1_234_567;
    const row = recordTelemetry(handle, record({ id: 'tel_actual' }, { costMicroUsd: reported }));
    expect(row.actualCostMicroUsd).toBe(reported);
    expect(row.actualCostSource).toBe(COST_SOURCE_ACTUAL);

    const stored = storedRow('tel_actual');
    expect(stored?.actual_cost_micro_usd).toBe(reported);
    expect(Number.isSafeInteger(stored?.actual_cost_micro_usd)).toBe(true);
    expect(stored?.actual_cost_source).toBe(COST_SOURCE_ACTUAL);
  });

  it('declares NO column and NO read-model field that a caller could read as "the cost"', () => {
    // The ambiguity is the failure mode: a query for `cost_micro_usd` would silently pick up
    // whichever figure happened to carry that name.
    expect(columnsOf('model_telemetry')).not.toContain('cost_micro_usd');
    expect(columnsOf('model_telemetry')).not.toContain('cost');
    const row = recordTelemetry(handle, record({ id: 'tel_names' }, { costMicroUsd: 500 }));
    const keys = Object.keys(row);
    expect(keys).toContain('actualCostMicroUsd');
    expect(keys).toContain('preflightEstimate');
    expect(keys).not.toContain('cost');
    expect(keys).not.toContain('costMicroUsd');
  });

  it('refuses an estimate offered as the actual, and writes nothing', () => {
    const error = refuses(
      record({}, { costSource: ESTIMATE_SOURCE_PREFLIGHT as unknown as typeof COST_SOURCE_ACTUAL }),
      'TELEMETRY_COST_SOURCE_NOT_ACTUAL',
      'an estimate offered as the actual cost',
    );
    expect(error.message).toContain('may gate a call');
  });

  it("refuses at the ENGINE too: a raw INSERT of an estimated provenance aborts on the CHECK", () => {
    expect(() =>
      handle.db
        .prepare(
          `INSERT INTO model_telemetry
             (id, request_ref, agent, occurred_at, model_id, turn_class, prompt_tokens, completion_tokens,
              latency_ms, schema_valid, outcome, actual_cost_micro_usd, actual_cost_source,
              preflight_estimate_micro_usd, model_id_served, privacy_policy_asserted)
           VALUES ('tel_raw_estimate', 'req_raw', 'finance', '2026-03-04T09:15:00Z', 'model-alpha', 'T2',
                   1, 1, 1, 1, 'ok', 900, 'preflight_estimate', NULL, 'model-alpha', 'true')`,
        )
        .run(),
    ).toThrow();
    expect(storedRow('tel_raw_estimate')).toBeUndefined();
  });

  it('keeps an estimate in its OWN column, beside an unchanged actual', () => {
    const row = recordTelemetry(
      handle,
      record({ id: 'tel_both', preflightEstimate: estimate(900) }, { costMicroUsd: 1_100 }),
    );
    expect(row.actualCostMicroUsd).toBe(1_100);
    expect(row.preflightEstimate).toEqual({ estimateSource: ESTIMATE_SOURCE_PREFLIGHT, microUsd: 900 });

    const stored = storedRow('tel_both');
    expect(stored?.actual_cost_micro_usd).toBe(1_100);
    expect(stored?.preflight_estimate_micro_usd).toBe(900);
    // Read back, the estimate still carries its provenance, so it cannot be mistaken for the actual.
    const served = readTelemetry(handle, { requestRef: row.requestRef })[0];
    expect(served?.preflightEstimate?.estimateSource).toBe(ESTIMATE_SOURCE_PREFLIGHT);
    expect(served?.actualCostSource).toBe(COST_SOURCE_ACTUAL);
    expect(served?.actualCostMicroUsd).not.toBe(served?.preflightEstimate?.microUsd);
  });

  it('leaves the estimate NULL when none gated the call, rather than copying the actual into it', () => {
    recordTelemetry(handle, record({ id: 'tel_no_estimate' }, { costMicroUsd: 700 }));
    expect(storedRow('tel_no_estimate')?.preflight_estimate_micro_usd).toBeNull();
    expect(readTelemetry(handle, { requestRef: `req_${seq}` })[0]?.preflightEstimate).toBeNull();
  });

  it('refuses an estimate whose provenance literal is wrong — the mirror of the actual guard', () => {
    refuses(
      record({
        preflightEstimate: {
          estimateSource: COST_SOURCE_ACTUAL as unknown as typeof ESTIMATE_SOURCE_PREFLIGHT,
          microUsd: 900,
        },
      }),
      'TELEMETRY_ESTIMATE_SOURCE_NOT_PREFLIGHT',
      'an actual offered as the estimate',
    );
  });

  it('refuses a non-integer or negative estimate, on the same terms as the actual', () => {
    refuses(record({ preflightEstimate: estimate(1.5) }), 'TELEMETRY_MEASUREMENT_INVALID', 'a fractional estimate');
    refuses(record({ preflightEstimate: estimate(-1) }), 'TELEMETRY_MEASUREMENT_INVALID', 'a negative estimate');
  });

  it('lets an estimate be wrong without touching the actual, which is the point of keeping both', () => {
    recordTelemetry(handle, record({ id: 'tel_under', preflightEstimate: estimate(100) }, { costMicroUsd: 5_000 }));
    const served = readTelemetry(handle)[0];
    // Contract 11 governs from the actual. An estimate that was fifty times low is visible AS an
    // estimate, and cannot be summed as though it were spend.
    expect(served?.actualCostMicroUsd).toBe(5_000);
    expect(served?.preflightEstimate?.microUsd).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------
// Append-only
// ---------------------------------------------------------------------------------------------

describe('recorded telemetry is append-only (contract 06 §3.3, contract 12 §6.4)', () => {
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
    // The cross-database open statement is deliberately absent from this list: `isolation.test.ts`
    // scans the whole `src/server` tree for it, which is strictly stronger, and spelling it here
    // would trip that scan.
    for (const verb of ['UPDATE', 'DELETE', 'REPLACE INTO']) {
      expect(code.includes(verb), `${verb} must not appear in the repository source`).toBe(false);
    }
  });

  it('refuses an UPDATE at the engine, so a future caller cannot rewrite the evidence', () => {
    recordTelemetry(handle, record({ id: 'tel_frozen' }, { costMicroUsd: 500, schemaValid: false }));
    expect(() =>
      handle.db.prepare('UPDATE model_telemetry SET schema_valid = 1 WHERE id = ?').run('tel_frozen'),
    ).toThrow(/append-only/);
    expect(() =>
      handle.db.prepare('UPDATE model_telemetry SET actual_cost_micro_usd = 0 WHERE id = ?').run('tel_frozen'),
    ).toThrow(/append-only/);
    const stored = storedRow('tel_frozen');
    expect(stored?.schema_valid).toBe(0);
    expect(stored?.actual_cost_micro_usd).toBe(500);
  });

  it('refuses a DELETE at the engine — a call that happened is never unrecorded', () => {
    recordTelemetry(handle, record({ id: 'tel_kept' }));
    expect(() => handle.db.prepare('DELETE FROM model_telemetry WHERE id = ?').run('tel_kept')).toThrow(/append-only/);
    expect(recordedCallCount(handle)).toBe(1);
  });

  it('corrects by a NEW row with its own id, sharing the correlation reference', () => {
    recordTelemetry(handle, record({ id: 'tel_first' }, { correlationRef: 'req_shared', costMicroUsd: 400 }));
    recordTelemetry(
      handle,
      record({ id: 'tel_second', occurredAt: '2026-03-04T10:00:00Z' }, { correlationRef: 'req_shared', costMicroUsd: 450 }),
    );
    const rows = readTelemetry(handle, { requestRef: 'req_shared' });
    expect(rows.map((row) => row.id)).toEqual(['tel_first', 'tel_second']);
    expect(rows.map((row) => row.actualCostMicroUsd)).toEqual([400, 450]);
  });
});

// ---------------------------------------------------------------------------------------------
// Layer 4 — the independent derivation about a stored row
// ---------------------------------------------------------------------------------------------

describe('contentBreaches is an independent derivation about the STORED row (§6.4, R19)', () => {
  function rawStoredRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'tel_raw',
      request_ref: 'req_raw',
      agent: 'finance',
      occurred_at: '2026-03-04T09:15:00Z',
      model_id: 'model-alpha',
      turn_class: 'T2',
      prompt_tokens: 120,
      completion_tokens: 40,
      latency_ms: 12,
      schema_valid: 1,
      outcome: 'ok',
      actual_cost_micro_usd: 1_000,
      actual_cost_source: COST_SOURCE_ACTUAL,
      preflight_estimate_micro_usd: null,
      model_id_served: 'model-alpha',
      privacy_policy_asserted: 'true',
      ...over,
    };
  }

  it('finds nothing on a row this repository actually wrote', () => {
    recordTelemetry(handle, record({ id: 'tel_clean', preflightEstimate: { estimateSource: ESTIMATE_SOURCE_PREFLIGHT, microUsd: 5 } }));
    const stored = storedRow('tel_clean');
    expect(stored).toBeDefined();
    expect(contentBreaches(stored)).toEqual([]);
  });

  it('fires for each claim when handed a value that breaks it', () => {
    expect(contentBreaches('not a row')).toEqual([
      { claim: 'no_field_beyond_the_row_shape', reason: 'row_not_an_object', at: 'row' },
    ]);
    expect(contentBreaches(rawStoredRow({ operator_flag: 1 }))).toEqual([
      { claim: 'no_field_beyond_the_row_shape', reason: 'column_unrecognized', at: 'operator_flag' },
    ]);
    expect(contentBreaches(rawStoredRow({ completion_text: 'x' }))).toEqual([
      { claim: 'no_content_bearing_field', reason: 'column_content_named', at: 'completion_text' },
    ]);
    expect(contentBreaches(rawStoredRow({ model_id: 'x'.repeat(TELEMETRY_FIELD_MAX_LENGTH + 1) }))).toEqual([
      { claim: 'no_free_text', reason: 'value_is_prose', at: 'model_id' },
    ]);
    expect(contentBreaches(rawStoredRow({ outcome: 'ok\nand the model replied' }))).toEqual([
      { claim: 'no_free_text', reason: 'value_is_prose', at: 'outcome' },
    ]);
  });

  it('retains the PATH and never the value, so a breach is an audit line and not a quarantine', () => {
    const leaked = 'the model replied at length about the statement\nand kept going';
    const breaches = contentBreaches(rawStoredRow({ narrative: leaked }));
    expect(breaches).toContainEqual({ claim: 'no_content_bearing_field', reason: 'column_content_named', at: 'narrative' });
    expect(breaches).toContainEqual({ claim: 'no_free_text', reason: 'value_is_prose', at: 'narrative' });
    // No field on a breach could hold what was refused.
    for (const breach of breaches) {
      expect(Object.keys(breach).sort()).toEqual(['at', 'claim', 'reason']);
      expect(JSON.stringify(breach)).not.toContain('statement');
    }
  });

  it('catches what the write path never saw: prose inserted through the handle (the layer-4 case)', () => {
    // No write guard ran on this row at all. It is the case that makes layer 4 independent rather
    // than redundant, and it is exactly the shape of leak Phase 3.2 found input validation accepts.
    const completion = `Here is the answer.\n${'detail '.repeat(30)}`;
    handle.db
      .prepare(
        `INSERT INTO model_telemetry
           (id, request_ref, agent, occurred_at, model_id, turn_class, prompt_tokens, completion_tokens,
            latency_ms, schema_valid, outcome, actual_cost_micro_usd, actual_cost_source,
            preflight_estimate_micro_usd, model_id_served, privacy_policy_asserted)
         VALUES ('tel_smuggled', 'req_smuggled', 'finance', '2026-03-04T09:15:00Z', ?, 'T2',
                 1, 1, 1, 1, 'ok', 1, 'provider_reported_actual', NULL, 'model-alpha', 'true')`,
      )
      .run(completion);
    expect(recordedCallCount(handle)).toBe(1);

    try {
      readTelemetry(handle);
      expect.unreachable('a stored row carrying prose must not be served');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelTelemetryError);
      expect((error as ModelTelemetryError).code).toBe('TELEMETRY_STORED_ROW_BREACHED');
      expect((error as ModelTelemetryError).detail.at).toBe('model_id');
      // The refusal names the column and never repeats the content.
      expect((error as ModelTelemetryError).message).not.toContain('Here is the answer');
    }
  });

  it('refuses the whole read rather than serving the rows that happen to pass', () => {
    recordTelemetry(handle, record({ id: 'tel_good' }));
    handle.db
      .prepare(
        `INSERT INTO model_telemetry
           (id, request_ref, agent, occurred_at, model_id, turn_class, prompt_tokens, completion_tokens,
            latency_ms, schema_valid, outcome, actual_cost_micro_usd, actual_cost_source,
            preflight_estimate_micro_usd, model_id_served, privacy_policy_asserted)
         VALUES ('tel_bad', 'req_bad', 'finance', '2026-03-05T09:15:00Z', ?, 'T2',
                 1, 1, 1, 1, 'ok', 1, 'provider_reported_actual', NULL, 'model-alpha', 'true')`,
      )
      .run('x'.repeat(TELEMETRY_FIELD_MAX_LENGTH + 1));
    // A partial answer would leave the caller unable to tell it from a complete one.
    expect(() => readTelemetry(handle)).toThrow(ModelTelemetryError);
  });
});

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

describe('reads are scoped and ordered, and carry no text to filter on', () => {
  beforeEach(() => {
    recordTelemetry(handle, record({ id: 'life_1' }, { agent: 'life', correlationRef: 'req_life_1' }));
    recordTelemetry(
      handle,
      record({ id: 'fin_1', occurredAt: '2026-03-04T10:00:00Z' }, { agent: 'finance', correlationRef: 'req_fin_1' }),
    );
    recordTelemetry(
      handle,
      record({ id: 'fin_2', occurredAt: '2026-03-04T11:00:00Z' }, { agent: 'finance', correlationRef: 'req_fin_2' }),
    );
  });

  it('serves every row in completion order when unscoped', () => {
    expect(readTelemetry(handle).map((row) => row.id)).toEqual(['life_1', 'fin_1', 'fin_2']);
  });

  it('scopes to one agent, and the narrow query agrees with the filtered wide one', () => {
    const finance = readTelemetry(handle, { agent: 'finance' });
    expect(finance.map((row) => row.id)).toEqual(['fin_1', 'fin_2']);
    expect(finance.map((row) => row.id)).toEqual(
      readTelemetry(handle)
        .filter((row) => row.agent === 'finance')
        .map((row) => row.id),
    );
    expect(readTelemetry(handle, { agent: 'life' }).map((row) => row.id)).toEqual(['life_1']);
  });

  it('scopes to one correlation reference, which is the link to the spend ledger row', () => {
    expect(readTelemetry(handle, { requestRef: 'req_fin_2' }).map((row) => row.id)).toEqual(['fin_2']);
    expect(readTelemetry(handle, { requestRef: 'req_absent' })).toEqual([]);
  });

  it('refuses a query it cannot honour, rather than answering with everything', () => {
    for (const query of [{ agent: 'ops' as unknown as SpendAgent }, { requestRef: '  ' }]) {
      try {
        readTelemetry(handle, query);
        expect.unreachable(`${JSON.stringify(query)} must be refused`);
      } catch (error) {
        expect((error as ModelTelemetryError).code).toBe('TELEMETRY_QUERY_INVALID');
      }
    }
  });

  it('counts rows without reading any of them', () => {
    expect(recordedCallCount(handle)).toBe(3);
  });
});
