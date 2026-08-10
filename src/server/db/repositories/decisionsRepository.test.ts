// @vitest-environment node
/**
 * NIZAM · decisions repository tests — contract 06 §9 T5/T6, §3.2, §8.1
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: decisionsRepository.ts, testStore.ts, ../errors.ts
 *
 * T5   a non-integer monetary value is refused at the persistence boundary with a typed
 *      error naming the field, and the store is left with nothing written.
 * T6   both effect columns round-trip as the exact integers they were given, and a
 *      nullable effect stays null rather than becoming a zero effect.
 *
 * §3.2/§8.1 THE REGISTRY IS APPEND-ONLY, and the tests below assert that as a property of
 *      the STORE rather than of this module's manners. Three separate claims:
 *
 *        a) the repository exposes no mutating method at all — nothing to call;
 *        b) an UPDATE issued straight at the handle, bypassing the repository entirely, is
 *           refused by migration 4's trigger;
 *        c) a DELETE is refused the same way.
 *
 *      (a) alone would only be a convention: the next caller reaches the handle. (b) and (c)
 *      are what make the rule hold for every path into the store, which is why they are
 *      asserted through raw SQL and not through the repository.
 *
 * Supersession is therefore the only revision shape: a NEW row pointing back at its
 * predecessor, with the predecessor left byte-identical — asserted here against the raw
 * stored row, not just the mapped one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MonetaryBoundaryError, RepositoryStateError } from '../errors.ts';
import { createDecisionsRepository, type DecisionsRepository } from './decisionsRepository.ts';
import type { DecisionInsert } from './rows.ts';
import { openTestStore, type TestStore } from './testStore.ts';

let store: TestStore;
let decisions: DecisionsRepository;

const BASE: DecisionInsert = {
  id: 'dec-base',
  decidedAt: '2026-02-01T09:00:00.000Z',
  kind: 'debt_paydown_order',
  rationale: 'Fund the highest-harm tier first.',
  expectedEffectMilliunits: 1_250_000,
  observedEffectMilliunits: null,
};

/** The raw stored row, so an assertion covers storage rather than the mapping layer. */
function rawRow(id: string): Record<string, unknown> | undefined {
  return store.ctx.handle.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  store = openTestStore('nizam-decisions-');
  decisions = createDecisionsRepository(store.ctx);
});

afterEach(() => {
  store.close();
});

describe('decisionsRepository — round-trip (§9 T6, R2)', () => {
  it('T6 preserves both effect columns as the exact integers they were given', () => {
    const written = decisions.insert({
      ...BASE,
      id: 'dec-exact',
      expectedEffectMilliunits: Number.MAX_SAFE_INTEGER,
      observedEffectMilliunits: -Number.MAX_SAFE_INTEGER,
    });

    expect(written.expectedEffectMilliunits).toBe(Number.MAX_SAFE_INTEGER);
    expect(written.observedEffectMilliunits).toBe(-Number.MAX_SAFE_INTEGER);
    // Read back through a second call, so this covers storage and not the value the
    // insert happened to be holding.
    expect(decisions.get('dec-exact')).toEqual(written);
  });

  it('keeps an unobserved effect null rather than reading it as a zero effect', () => {
    const written = decisions.insert(BASE);
    expect(written.observedEffectMilliunits).toBeNull();
    expect(decisions.get(BASE.id)?.observedEffectMilliunits).toBeNull();
  });

  it('keeps an unestimated effect null too, and both nulls independently', () => {
    const written = decisions.insert({
      ...BASE,
      id: 'dec-unestimated',
      expectedEffectMilliunits: null,
      observedEffectMilliunits: 7,
    });
    expect(written.expectedEffectMilliunits).toBeNull();
    expect(written.observedEffectMilliunits).toBe(7);
    expect(decisions.get('dec-unestimated')).toEqual(written);
  });

  it('preserves the non-monetary facts and starts a fresh decision at version 1', () => {
    const written = decisions.insert(BASE);
    expect(written.decidedAt).toBe('2026-02-01T09:00:00.000Z');
    expect(written.kind).toBe('debt_paydown_order');
    expect(written.rationale).toBe('Fund the highest-harm tier first.');
    expect(written.outcome).toBe('pending');
    expect(written.supersedesDecisionId).toBeNull();
    expect(written.auditVersion).toBe(1);
    expect(decisions.get(BASE.id)).toEqual(written);
  });

  it('returns null for an id the store does not hold', () => {
    expect(decisions.get('dec-absent')).toBeNull();
  });
});

describe('decisionsRepository — append-only is structural (§3.2, §8.1)', () => {
  it('exposes no update, delete, or in-place edit method at all', () => {
    const surface = Object.keys(decisions).sort();
    expect(surface).toEqual(['current', 'get', 'insert', 'list', 'successorOf', 'supersede']);
    // Named explicitly as well as by the exact-surface check above, so a future addition
    // has to argue with this line rather than silently widen the set.
    for (const forbidden of ['update', 'delete', 'remove', 'edit', 'patch', 'set', 'void']) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it('refuses an UPDATE issued straight at the handle, bypassing this module', () => {
    decisions.insert(BASE);
    const before = rawRow(BASE.id);

    expect(() =>
      store.ctx.handle.db.prepare(`UPDATE decisions SET outcome = 'confirmed' WHERE id = ?`).run(BASE.id),
    ).toThrow(/append-only/i);

    expect(rawRow(BASE.id)).toEqual(before);
  });

  it('refuses a DELETE the same way, so a decision cannot be removed by any path', () => {
    decisions.insert(BASE);

    expect(() => store.ctx.handle.db.prepare('DELETE FROM decisions WHERE id = ?').run(BASE.id)).toThrow(
      /append-only/i,
    );

    expect(decisions.get(BASE.id)).not.toBeNull();
  });
});

describe('decisionsRepository — supersession appends, never edits (§8.1)', () => {
  it('leaves the predecessor byte-identical and points the successor back at it', () => {
    decisions.insert(BASE);
    const before = rawRow(BASE.id);

    const { superseded, successor } = decisions.supersede(BASE.id, {
      ...BASE,
      id: 'dec-revised',
      decidedAt: '2026-02-08T09:00:00.000Z',
      rationale: 'A statement arrived; the expected effect was too high.',
      expectedEffectMilliunits: 980_000,
      observedEffectMilliunits: 940_000,
      outcome: 'confirmed',
    });

    // Not one column of the predecessor moved — not its outcome, not a timestamp.
    expect(rawRow(BASE.id)).toEqual(before);
    expect(superseded.outcome).toBe('pending');
    expect(superseded.auditVersion).toBe(1);
    expect(superseded.supersedesDecisionId).toBeNull();

    // The successor carries the lineage and the next audit version.
    expect(successor.id).toBe('dec-revised');
    expect(successor.supersedesDecisionId).toBe(BASE.id);
    expect(successor.auditVersion).toBe(2);
    expect(successor.expectedEffectMilliunits).toBe(980_000);
    expect(successor.observedEffectMilliunits).toBe(940_000);
    expect(successor.outcome).toBe('confirmed');
  });

  it('records an outcome that arrives later as a new row, since editing is impossible', () => {
    decisions.insert(BASE);
    const { successor } = decisions.supersede(BASE.id, {
      ...BASE,
      id: 'dec-reviewed',
      observedEffectMilliunits: 1_100_000,
      outcome: 'confirmed',
    });

    expect(decisions.get(BASE.id)?.observedEffectMilliunits).toBeNull();
    expect(successor.observedEffectMilliunits).toBe(1_100_000);
    // Both rows are still there; nothing was traded away to record the observation.
    expect(decisions.list({ includeSuperseded: true }).map((d) => d.id)).toEqual([BASE.id, 'dec-reviewed']);
  });

  it('refuses a second successor rather than forking the chain', () => {
    decisions.insert(BASE);
    decisions.supersede(BASE.id, { ...BASE, id: 'dec-first-successor' });

    try {
      decisions.supersede(BASE.id, { ...BASE, id: 'dec-second-successor' });
      expect.unreachable('a forked supersession chain must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryStateError);
      expect((error as RepositoryStateError).code).toBe('REPOSITORY_ROW_ALREADY_SUPERSEDED');
      expect((error as RepositoryStateError).table).toBe('decisions');
      expect((error as RepositoryStateError).rowId).toBe(BASE.id);
    }

    // The refused row was not written, so the chain stays single-threaded.
    expect(decisions.get('dec-second-successor')).toBeNull();
    expect(decisions.list({ includeSuperseded: true }).map((d) => d.id)).toEqual([BASE.id, 'dec-first-successor']);
  });

  it('refuses to supersede a decision that is not there, and writes nothing', () => {
    try {
      decisions.supersede('dec-absent', { ...BASE, id: 'dec-orphan' });
      expect.unreachable('superseding a missing decision must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryStateError);
      expect((error as RepositoryStateError).code).toBe('REPOSITORY_ROW_NOT_FOUND');
    }
    expect(decisions.list({ includeSuperseded: true })).toEqual([]);
  });
});

describe('decisionsRepository — "current" is derived, never stored', () => {
  it('lists only the rows nothing supersedes, and every row on request', () => {
    decisions.insert(BASE);
    decisions.supersede(BASE.id, { ...BASE, id: 'dec-v2' });
    decisions.insert({ ...BASE, id: 'dec-other', kind: 'buffer_target', decidedAt: '2026-02-03T09:00:00.000Z' });

    expect(decisions.list().map((d) => d.id).sort()).toEqual(['dec-other', 'dec-v2']);
    expect(decisions.list({ includeSuperseded: true }).map((d) => d.id).sort()).toEqual([
      BASE.id,
      'dec-other',
      'dec-v2',
    ]);
  });

  it('filters by kind, over current rows and over the whole history alike', () => {
    decisions.insert(BASE);
    decisions.supersede(BASE.id, { ...BASE, id: 'dec-v2' });
    decisions.insert({ ...BASE, id: 'dec-buffer', kind: 'buffer_target' });

    expect(decisions.list({ kind: 'buffer_target' }).map((d) => d.id)).toEqual(['dec-buffer']);
    expect(
      decisions.list({ kind: 'debt_paydown_order', includeSuperseded: true }).map((d) => d.id).sort(),
    ).toEqual([BASE.id, 'dec-v2']);
  });

  it('follows a chain of successors to the row that currently stands', () => {
    decisions.insert(BASE);
    decisions.supersede(BASE.id, { ...BASE, id: 'dec-v2' });
    decisions.supersede('dec-v2', { ...BASE, id: 'dec-v3' });

    expect(decisions.successorOf(BASE.id)?.id).toBe('dec-v2');
    expect(decisions.successorOf('dec-v2')?.id).toBe('dec-v3');
    expect(decisions.successorOf('dec-v3')).toBeNull();

    // Every link resolves to the same standing row, whichever end you enter from.
    for (const entry of [BASE.id, 'dec-v2', 'dec-v3']) {
      expect(decisions.current(entry).id).toBe('dec-v3');
    }
    expect(decisions.current('dec-v3').auditVersion).toBe(3);
  });

  it('refuses to resolve a chain from an id the store does not hold', () => {
    expect(() => decisions.current('dec-absent')).toThrow(RepositoryStateError);
  });
});

describe('decisionsRepository — the money boundary (§9 T5, §4.2, R2)', () => {
  /** Every shape an upstream parse mistake actually arrives in. None is rounded. */
  const NON_INTEGERS: readonly { readonly label: string; readonly value: unknown }[] = [
    { label: 'a fractional milliunit', value: 1_250_000.5 },
    { label: 'a decimal string', value: '1250000' },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'a value beyond safe-integer precision', value: Number.MAX_SAFE_INTEGER + 2 },
    { label: 'a boolean', value: true },
  ];

  for (const { label, value } of NON_INTEGERS) {
    it(`T5 refuses ${label} in expected_effect_milliunits and writes nothing`, () => {
      try {
        decisions.insert({ ...BASE, id: 'dec-rejected', expectedEffectMilliunits: value as never });
        expect.unreachable('a non-integer monetary value must be refused at the boundary');
      } catch (error) {
        expect(error).toBeInstanceOf(MonetaryBoundaryError);
        const boundary = error as MonetaryBoundaryError;
        expect(boundary.code).toBe('MONETARY_VALUE_NOT_INTEGER');
        // The field is on the error object, not only inside prose that is free to change.
        expect(boundary.field).toBe('expected_effect_milliunits');
        expect(boundary.table).toBe('decisions');
      }

      // Nothing was rounded into the store, and no partial row survived the refusal.
      expect(decisions.get('dec-rejected')).toBeNull();
      expect(decisions.list({ includeSuperseded: true })).toEqual([]);
    });
  }

  it('refuses a non-integer observed effect too, naming that column', () => {
    try {
      decisions.insert({ ...BASE, id: 'dec-rejected-observed', observedEffectMilliunits: 940_000.25 as never });
      expect.unreachable('a non-integer observed effect must be refused');
    } catch (error) {
      expect((error as MonetaryBoundaryError).field).toBe('observed_effect_milliunits');
    }
    expect(decisions.get('dec-rejected-observed')).toBeNull();
  });

  it('refuses a non-integer on the supersede path, leaving the predecessor current', () => {
    decisions.insert(BASE);

    expect(() =>
      decisions.supersede(BASE.id, { ...BASE, id: 'dec-bad-successor', expectedEffectMilliunits: 0.5 as never }),
    ).toThrow(MonetaryBoundaryError);

    expect(decisions.get('dec-bad-successor')).toBeNull();
    expect(decisions.successorOf(BASE.id)).toBeNull();
    expect(decisions.current(BASE.id).id).toBe(BASE.id);
  });
});

describe('decisionsRepository — the audit trail (contract 02 §9)', () => {
  it('records one row per append, naming the lineage and never an amount', () => {
    decisions.insert(BASE);
    decisions.supersede(BASE.id, { ...BASE, id: 'dec-v2', expectedEffectMilliunits: 980_000 });

    const rows = store.ctx.handle.db
      .prepare(`SELECT action, entity_id, detail, actor FROM audit_log WHERE entity_table = 'decisions' ORDER BY id`)
      .all() as { action: string; entity_id: string; detail: string; actor: string }[];

    expect(rows.map((r) => r.action)).toEqual(['decision.insert', 'decision.supersede']);
    // The supersede entry is attributed to the row that was APPENDED, because the
    // predecessor was not touched and an entry against it would misdescribe the write.
    expect(rows[1]?.entity_id).toBe('dec-v2');
    expect(rows[1]?.detail).toBe(`supersedes ${BASE.id}`);
    expect(rows.every((r) => r.actor === 'test-actor')).toBe(true);
    // The trail states the lineage, never the figures. The predecessor id carries no digit.
    expect(rows.some((r) => /\d/.test(r.detail))).toBe(false);
  });

  it('leaves no audit row behind when a write is refused', () => {
    expect(() => decisions.insert({ ...BASE, expectedEffectMilliunits: 1.5 as never })).toThrow(
      MonetaryBoundaryError,
    );

    const count = store.ctx.handle.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };
    expect(count.n).toBe(0);
  });
});
