/**
 * NIZAM · spend_ledger repository — append-only, keyed by agent, actual reported cost only
 * Implemented by: PFOS Contract 06 / Phase 1.4 (spec 06-two-agent-vps), owning requirement R5
 * Depends on: connection.ts (StoreHandle), ../../features/routing/spendLedger (the PURE read model)
 *
 * Contract 06 §6.2, made mechanical rather than remembered:
 *
 *  1. **Actual, not estimated (§6.2.1).** {@link appendSpend} accepts only a value whose
 *     `costSource` is the single-member literal `provider_reported_actual`, so a pre-flight estimate
 *     is a compile error; it is re-checked at runtime, and the table's own CHECK is the third belt. A
 *     pre-flight estimate may GATE a call. It may never be what gets recorded.
 *  2. **Append-only (§6.2.2).** This module has no update path and no delete path — not a private
 *     one, not a "correction" one. `spendLedgerRepo.test.ts` scans this source for the two SQL verbs
 *     and fails if either appears, so append-only is a property of the file rather than a convention.
 *     A correction is another {@link appendSpend} with its OWN `request_ref`.
 *  3. **Keyed by agent (§6.2.3).** Every read of remaining budget is scoped to one agent. The scoping
 *     is done by the pure {@link weeklySpend}, over rows this repository fetched for BOTH agents, so
 *     the per-agent boundary is exercised at runtime and not merely encoded in a WHERE clause. That is
 *     what makes R17 reachable: exhausting one agent leaves the other untouched.
 *  4. **A failed call with reported cost is still recorded (§6.2.4).** Cost that was incurred counts,
 *     regardless of whether the result was usable, so there is no "was it successful" gate on the
 *     write path.
 *
 * The week bucket is derived HERE, at write time, and stored (§6.1), so the read model never
 * re-derives it ambiguously. The derivation itself is the pure `weekKeyOf`.
 *
 * The cap is not in this file. Not as a constant, not as a default, not in a comment (§6.3 keeps it
 * as `<AGENT_WEEKLY_CAP_USD>`): a cap is injected configuration supplied by the caller.
 *
 * Cost is provider accounting in integer micro-USD, NOT a figure in the owner's financial ledger
 * (§6.1). This module deliberately does not import `src/lib/money/`, and introduces no arithmetic of
 * its own beyond an integer sum performed by the shared pure function. No float. No prompt text and no
 * completion text touches any column here — the columns do not exist (§3.4).
 */
import type { StoreHandle } from './connection.ts';
import {
  agentWeeklyBudget,
  assertSpendRowShape,
  COST_SOURCE_ACTUAL,
  SpendLedgerError,
  weeklySpend,
  weekKeyOf,
  type AgentWeeklyBudget,
  type AgentWeeklyCap,
  type CostSourceActual,
  type SpendAgent,
  type SpendLedgerRow,
} from '../../features/routing/spendLedger.ts';

/**
 * What the provider reported on a COMPLETED call. The `costSource` field is the type-level gate:
 * its only inhabitant is the actual-cost literal, so an object describing an estimate does not type
 * check against this interface.
 */
export interface ProviderReportedSpend {
  /** Surrogate key supplied by the caller (correlation is `requestRef`, not this). */
  readonly id: string;
  readonly agent: SpendAgent;
  /** UTC completion timestamp. The week bucket is derived from it here and stored. */
  readonly occurredAt: string;
  /** The model the provider actually served, as reported. */
  readonly modelId: string;
  /** Actual reported cost, integer micro-USD. */
  readonly costMicroUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Correlation identifier for the telemetry row. A correction carries its own. */
  readonly requestRef: string;
  /** Provenance. Only the actual-cost literal is accepted, at compile time and at run time. */
  readonly costSource: CostSourceActual;
}

const INSERT_SQL = `
INSERT INTO spend_ledger
  (id, agent, occurred_at, week_key, model_id, cost_micro_usd, prompt_tokens, completion_tokens, request_ref, cost_source)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`.trim();

const SELECT_WEEK_SQL = `
SELECT id, agent, occurred_at, week_key, model_id, cost_micro_usd, prompt_tokens, completion_tokens, request_ref, cost_source
FROM spend_ledger
WHERE week_key = ?
ORDER BY occurred_at, id
`.trim();

const SELECT_AGENT_WEEK_SQL = `
SELECT id, agent, occurred_at, week_key, model_id, cost_micro_usd, prompt_tokens, completion_tokens, request_ref, cost_source
FROM spend_ledger
WHERE agent = ? AND week_key = ?
ORDER BY occurred_at, id
`.trim();

interface SpendLedgerRecord {
  readonly id: string;
  readonly agent: string;
  readonly occurred_at: string;
  readonly week_key: string;
  readonly model_id: string;
  readonly cost_micro_usd: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly request_ref: string;
  readonly cost_source: string;
}

/** Map a stored record to the read model the pure functions consume. */
function toRow(record: SpendLedgerRecord): SpendLedgerRow {
  const row = {
    id: String(record.id),
    agent: record.agent as SpendAgent,
    occurredAt: String(record.occurred_at),
    weekKey: String(record.week_key),
    modelId: String(record.model_id),
    costMicroUsd: Number(record.cost_micro_usd),
    promptTokens: Number(record.prompt_tokens),
    completionTokens: Number(record.completion_tokens),
    requestRef: String(record.request_ref),
    costSource: record.cost_source as CostSourceActual,
  } satisfies SpendLedgerRow;
  // A row that would not pass the write guard must not silently pass the read path either.
  assertSpendRowShape(row);
  return row;
}

/**
 * Append one completed call's ACTUAL reported cost. The only write path in this module.
 *
 * Refuses, with a typed {@link SpendLedgerError} and without writing anything:
 *  - a cost source that is not the provider's reported actual (an estimate);
 *  - a non-integer or negative cost — no rounding, no coercion, no "helpful" repair;
 *  - a non-integer token count, an unknown agent, an empty `request_ref`, an empty `id`;
 *  - a completion timestamp that is not an unambiguous UTC instant.
 *
 * @returns The row exactly as it was stored, including the derived `weekKey`.
 */
export function appendSpend(handle: StoreHandle, entry: ProviderReportedSpend): SpendLedgerRow {
  if (typeof entry.id !== 'string' || entry.id.trim() === '') {
    throw new SpendLedgerError('SPEND_ROW_ID_EMPTY', 'NIZAM spend ledger: a row id is required', {
      requestRef: String(entry.requestRef),
    });
  }
  // §6.2.1 — the runtime belt behind the type-level one. An estimate cannot be recorded.
  if (entry.costSource !== COST_SOURCE_ACTUAL) {
    throw new SpendLedgerError(
      'SPEND_COST_SOURCE_NOT_ACTUAL',
      `NIZAM spend ledger: refusing to record cost source "${String(entry.costSource)}". Only ${COST_SOURCE_ACTUAL} is recorded (§6.2.1); a pre-flight estimate may gate a call and is never what lands in the ledger.`,
      { id: entry.id, requestRef: entry.requestRef, received: entry.costSource },
    );
  }

  // Derived at write time and stored, so the read model never re-derives it (§6.1).
  const weekKey = weekKeyOf(entry.occurredAt);

  const row: SpendLedgerRow = {
    id: entry.id,
    agent: entry.agent,
    occurredAt: entry.occurredAt,
    weekKey,
    modelId: entry.modelId,
    costMicroUsd: entry.costMicroUsd,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    requestRef: entry.requestRef,
    costSource: COST_SOURCE_ACTUAL,
  };
  // Every guard runs BEFORE the statement is prepared, so a rejected value never reaches the engine.
  assertSpendRowShape(row);
  if (typeof row.modelId !== 'string' || row.modelId.trim() === '') {
    throw new SpendLedgerError('SPEND_MODEL_ID_EMPTY', 'NIZAM spend ledger: model_id is required as reported', {
      id: row.id,
    });
  }

  handle.db
    .prepare(INSERT_SQL)
    .run(
      row.id,
      row.agent,
      row.occurredAt,
      row.weekKey,
      row.modelId,
      row.costMicroUsd,
      row.promptTokens,
      row.completionTokens,
      row.requestRef,
      row.costSource,
    );
  return row;
}

/**
 * Every row in one week, for BOTH agents. Handed to the pure read model, which does the per-agent
 * scoping — so §6.2.3 is exercised rather than assumed by a WHERE clause.
 */
export function readWeekRows(handle: StoreHandle, weekKey: string): SpendLedgerRow[] {
  return handle.db
    .prepare(SELECT_WEEK_SQL)
    .all(weekKey)
    .map((record) => toRow(record as unknown as SpendLedgerRecord));
}

/** One agent's rows in one week. The narrow query, for callers that already know the scope. */
export function readAgentWeekRows(handle: StoreHandle, agent: SpendAgent, weekKey: string): SpendLedgerRow[] {
  return handle.db
    .prepare(SELECT_AGENT_WEEK_SQL)
    .all(agent, weekKey)
    .map((record) => toRow(record as unknown as SpendLedgerRecord));
}

/**
 * One agent's weekly total, in integer micro-USD. The repository fetches; the pure
 * {@link weeklySpend} totals. No aggregation across agents happens on this path, ever.
 */
export function weeklySpendMicroUsd(handle: StoreHandle, agent: SpendAgent, weekKey: string): number {
  return weeklySpend(readWeekRows(handle, weekKey), agent, weekKey);
}

/**
 * The per-agent cap decision over the stored ledger. The cap arrives in `cap`; this module supplies
 * no default for it, because §6.3 forbids a cap literal in ledger code.
 */
export function agentBudgetFromStore(handle: StoreHandle, cap: AgentWeeklyCap): AgentWeeklyBudget {
  return agentWeeklyBudget(readWeekRows(handle, cap.weekKey), cap);
}
