/**
 * NIZAM · decisions repository — contract 06 §3.2, §4.2, §8.1 (R1, R2)
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../moneyBoundary.ts, ../errors.ts, rows.ts, support.ts
 *
 * THE REGISTRY IS APPEND-ONLY. Contract 06 §3.2 and §8.1: "a decision is superseded by a
 * new row, never edited". PFOS contract 03 §12 says the same thing from the other side — a
 * historical record is never rewritten, because the whole value of the registry is that a
 * later review scores against what was actually believed at the time.
 *
 * So this repository has no update and no delete, and that is not the only line of defence:
 *
 *  1. STRUCTURAL. Migration 4 puts two BEFORE triggers on `decisions` that refuse any
 *     UPDATE and any DELETE. The rule therefore holds for every path into the store, not
 *     just for callers who came through this module. A repository that merely declines to
 *     offer a mutation is a convention; a trigger is the rule.
 *  2. NO SUCCESSOR-SIDE EDIT. Superseding INSERTS the successor with
 *     `supersedes_decision_id` pointing back at its predecessor and `audit_version` one
 *     higher. The predecessor is not touched at all — not even its `outcome`. "Which row is
 *     current" is therefore DERIVED (the row nothing supersedes) rather than stored, which
 *     is what makes the no-update rule possible in the first place.
 *  3. NO FORK. Superseding a decision that already has a successor is REFUSED, because two
 *     successors would make "the current row" ambiguous, and no rule for choosing between
 *     them has been agreed.
 *
 * An outcome or an observed effect that arrives later is recorded the same way: a new row
 * carrying it, superseding the old one. That is the only write shape this table has.
 *
 * Every write asserts its monetary values through the boundary guard BEFORE a statement is
 * prepared (§4.2.3). Both effect columns are nullable, because an effect that has not been
 * estimated or not yet been observed has no value — and an absent effect is never read as
 * a zero effect.
 */
import { assertMonetaryCoverage, assertOptionalMoneyField } from '../moneyBoundary.ts';
import { RepositoryStateError } from '../errors.ts';
import {
  ASSIGNABLE_DECISION_OUTCOME_STATES,
  type DecisionInsert,
  type DecisionOutcomeState,
  type DecisionRow,
} from './rows.ts';
import { recordAudit, toNullableText, withTransaction, type RepositoryContext } from './support.ts';

const TABLE = 'decisions';

/** The monetary columns of `decisions`, named once for the coverage assertion. */
const MONEY_FIELDS = ['expected_effect_milliunits', 'observed_effect_milliunits'] as const;

/**
 * Refuse a caller that self-declares the DERIVED state — contract 06 §3.2 ADDENDUM A1.
 *
 * The applied DDL's `outcome` CHECK admits `'superseded'`, but no write path can ever
 * legitimately produce it: superseding APPENDS a successor and leaves the predecessor
 * untouched (§8.1, and migration 4's triggers refuse an UPDATE regardless), so "which row is
 * current" is derived as `NOT EXISTS (successor)` rather than stored. A row carrying
 * `outcome = 'superseded'` would therefore be a claim about lineage made by whoever inserted
 * it, unbacked by the lineage columns and free to contradict them.
 *
 * The resolution recorded in ADDENDUM A1 is to refuse the assignment here, at the write path,
 * rather than to change the CHECK — editing an applied migration would move its checksum,
 * which §5.1 forbids and the migrator's own guard would refuse. Reads still accept the full
 * enum, because a store repaired by hand may hold the value and refusing to READ history is
 * not a fix for anything.
 */
function assertAssignableOutcome(input: DecisionInsert): void {
  const candidate = input.outcome;
  if (candidate === undefined) return;
  if (!(ASSIGNABLE_DECISION_OUTCOME_STATES as readonly string[]).includes(candidate)) {
    throw new RepositoryStateError(
      'REPOSITORY_DERIVED_STATE_NOT_ASSIGNABLE',
      `NIZAM store: ${TABLE}.outcome cannot be set to '${String(candidate)}' by a caller. Whether a decision still stands is DERIVED from the lineage columns (the row nothing supersedes), never stored, because recording it would mean editing the predecessor — which contract 06 §8.1 and migration 4's triggers both forbid. Assignable states are ${ASSIGNABLE_DECISION_OUTCOME_STATES.join(', ')}; append a successor instead.`,
      { table: TABLE, rowId: input.id },
    );
  }
}

export interface DecisionListFilter {
  /**
   * By default only CURRENT decisions are returned — the rows nothing supersedes. An audit
   * read asks for the superseded ones explicitly; they are still there, always.
   */
  readonly includeSuperseded?: boolean;
  /** Restrict to one decision kind. */
  readonly kind?: string;
}

/** What a supersede produced: the untouched predecessor and the row that now stands. */
export interface DecisionSupersedeResult {
  /** The predecessor, byte-identical to before the call. Nothing about it was edited. */
  readonly superseded: DecisionRow;
  readonly successor: DecisionRow;
}

export interface DecisionsRepository {
  /** Append a decision. The only other write on this table is `supersede`. */
  insert(input: DecisionInsert): DecisionRow;
  get(id: string): DecisionRow | null;
  list(filter?: DecisionListFilter): DecisionRow[];
  /**
   * Record a revised decision by APPENDING it. The predecessor is left exactly as it was;
   * a second supersede of the same predecessor is refused rather than allowed to fork.
   */
  supersede(originalId: string, successor: DecisionInsert): DecisionSupersedeResult;
  /** The row that supersedes this one, or null when this one is current. */
  successorOf(id: string): DecisionRow | null;
  /** Follow the chain to the row that currently stands. Throws if the id is unknown. */
  current(id: string): DecisionRow;
}

function mapRow(raw: Record<string, unknown>): DecisionRow {
  const expected = raw['expected_effect_milliunits'];
  const observed = raw['observed_effect_milliunits'];
  return {
    id: String(raw['id']),
    decidedAt: String(raw['decided_at']),
    kind: String(raw['kind']),
    rationale: String(raw['rationale']),
    expectedEffectMilliunits: expected === null || expected === undefined ? null : Number(expected),
    observedEffectMilliunits: observed === null || observed === undefined ? null : Number(observed),
    outcome: String(raw['outcome']) as DecisionOutcomeState,
    supersedesDecisionId: toNullableText(raw['supersedes_decision_id']),
    auditVersion: Number(raw['audit_version']),
  };
}

export function createDecisionsRepository(ctx: RepositoryContext): DecisionsRepository {
  const { db } = ctx.handle;

  const readOne = (id: string): DecisionRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return raw ? mapRow(raw) : null;
  };

  const requireOne = (id: string): DecisionRow => {
    const row = readOne(id);
    if (!row) {
      throw new RepositoryStateError('REPOSITORY_ROW_NOT_FOUND', `NIZAM store: no ${TABLE} row with id ${id}`, {
        table: TABLE,
        rowId: id,
      });
    }
    return row;
  };

  const readSuccessor = (id: string): DecisionRow | null => {
    const raw = db.prepare(`SELECT * FROM ${TABLE} WHERE supersedes_decision_id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return raw ? mapRow(raw) : null;
  };

  /**
   * The one INSERT statement. `supersedesDecisionId` and `auditVersion` are set by the
   * supersede path and by nothing else, so an ordinary append cannot claim to supersede.
   */
  const insertRow = (
    input: DecisionInsert,
    lineage: { supersedesDecisionId: string | null; auditVersion: number },
  ): DecisionRow => {
    // The guards run first, and they account for every monetary column of the table plus
    // the one column whose value is derived rather than declared (ADDENDUM A1).
    assertAssignableOutcome(input);
    assertMonetaryCoverage(TABLE, MONEY_FIELDS);
    const expected = assertOptionalMoneyField(TABLE, 'expected_effect_milliunits', input.expectedEffectMilliunits);
    const observed = assertOptionalMoneyField(TABLE, 'observed_effect_milliunits', input.observedEffectMilliunits);

    // Nothing above threw, so a statement may now be prepared.
    db.prepare(
      `INSERT INTO ${TABLE}
         (id, decided_at, kind, rationale, expected_effect_milliunits, observed_effect_milliunits,
          outcome, supersedes_decision_id, audit_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.decidedAt,
      input.kind,
      input.rationale ?? '',
      expected,
      observed,
      input.outcome ?? 'pending',
      lineage.supersedesDecisionId,
      lineage.auditVersion,
    );
    return requireOne(input.id);
  };

  return {
    insert(input: DecisionInsert): DecisionRow {
      return withTransaction(db, () => {
        const row = insertRow(input, { supersedesDecisionId: null, auditVersion: 1 });
        recordAudit(ctx, { action: 'decision.insert', entityTable: TABLE, entityId: row.id });
        return row;
      });
    },

    get(id: string): DecisionRow | null {
      return readOne(id);
    },

    list(filter: DecisionListFilter = {}): DecisionRow[] {
      const clauses: string[] = [];
      const bindings: string[] = [];
      if (filter.kind !== undefined) {
        clauses.push('kind = ?');
        bindings.push(filter.kind);
      }
      if (!filter.includeSuperseded) {
        // Current means "nothing supersedes it". Derived, never stored, because storing it
        // would require editing the predecessor — the one thing this table forbids.
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM ${TABLE} successor WHERE successor.supersedes_decision_id = ${TABLE}.id)`,
        );
      }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const raws = db
        .prepare(`SELECT * FROM ${TABLE}${where} ORDER BY decided_at, id`)
        .all(...bindings) as Record<string, unknown>[];
      return raws.map(mapRow);
    },

    supersede(originalId: string, successor: DecisionInsert): DecisionSupersedeResult {
      return withTransaction(db, () => {
        const original = requireOne(originalId);
        const existing = readSuccessor(original.id);
        if (existing) {
          throw new RepositoryStateError(
            'REPOSITORY_ROW_ALREADY_SUPERSEDED',
            `NIZAM store: ${TABLE} row ${originalId} has already been superseded by ${existing.id}. Supersede that row instead, so the chain stays single-threaded.`,
            { table: TABLE, rowId: originalId },
          );
        }

        const inserted = insertRow(successor, {
          supersedesDecisionId: original.id,
          auditVersion: original.auditVersion + 1,
        });

        // The predecessor is deliberately NOT touched here. No status move, no outcome
        // rewrite, no timestamp: the registry is append-only, and migration 4's triggers
        // would refuse the statement even if this line existed.
        recordAudit(ctx, {
          action: 'decision.supersede',
          entityTable: TABLE,
          entityId: inserted.id,
          detail: `supersedes ${original.id}`,
        });

        return { superseded: requireOne(original.id), successor: inserted };
      });
    },

    successorOf(id: string): DecisionRow | null {
      return readSuccessor(id);
    },

    current(id: string): DecisionRow {
      let row = requireOne(id);
      // The chain is acyclic by construction — a cycle would need an UPDATE, which the
      // triggers refuse — but the walk is bounded anyway rather than trusting that.
      const seen = new Set<string>([row.id]);
      for (;;) {
        const next = readSuccessor(row.id);
        if (!next || seen.has(next.id)) return row;
        seen.add(next.id);
        row = next;
      }
    },
  };
}
