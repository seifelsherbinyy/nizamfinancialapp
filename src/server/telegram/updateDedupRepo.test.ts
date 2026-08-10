// @vitest-environment node
/**
 * NIZAM · update_dedup repository tests — the collision test is the one that matters
 * Implemented by: PFOS Contract 12 / Phase 4.2 (spec 06-two-agent-vps)
 * Owning requirements: R13 (a retried delivery has no second side effect),
 *   R14 (dedup is namespaced per bot, because update identifiers collide)
 * Depends on: ../db/store (a real migrated store), ./updateDedupRepo
 *
 * Tested against the actual engine rather than a double, because every property under test is
 * a property OF the engine: that a unique index over the PAIR exists, that a conflicting
 * insert reports zero rows written instead of raising, and that two connections to one store
 * cannot both win the same pair. A double would assert nothing about any of them.
 *
 * Contract 12 §5.4.6 names the test that matters: **two bots emitting the same identifier must
 * both be processed.** A suite that only proves a duplicate is dropped would pass on the broken
 * single-key design, which is why that case is asserted from both directions here — both
 * deliveries are new, and both rows survive.
 *
 * Every identifier below is synthetic and deliberately short (R24, steering §0b).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFinanceStore } from '../db/store.ts';
import type { StoreHandle } from '../db/connection.ts';
import {
  claimDelivery,
  pruneDedupBefore,
  UpdateDedupError,
  type UpdateDedupContext,
} from './updateDedupRepo.ts';

/** Synthetic bots. Two of them, because one bot cannot exhibit the collision R14 describes. */
const BOT_ONE = 'bot-one';
const BOT_TWO = 'bot-two';
/** Short synthetic update identifiers (R24). The same one for both bots is the whole point. */
const SHARED_UPDATE_ID = 41;

const cleanups: Array<() => void> = [];

/** Advance one second per call from a fixed epoch, so an ordering failure is legible. */
function stepClock(start = Date.UTC(2026, 0, 1)): () => string {
  let ticks = 0;
  return (): string => {
    const at = new Date(start + ticks * 1_000).toISOString();
    ticks += 1;
    return at;
  };
}

interface Harness {
  readonly ctx: UpdateDedupContext;
  readonly dataDir: string;
  /** A SECOND connection to the SAME store file, standing in for a second process. */
  openAnotherConnection(): UpdateDedupContext;
}

function openHarness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'nizam-dedup-'));
  const handles: StoreHandle[] = [];
  const open = (): UpdateDedupContext => {
    const now = stepClock();
    const { handle } = openFinanceStore(
      { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
      now,
    );
    handles.push(handle);
    return { handle, now };
  };
  const ctx = open();
  cleanups.push(() => {
    for (const handle of handles) handle.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { ctx, dataDir, openAnotherConnection: open };
}

function rowCount(ctx: UpdateDedupContext): number {
  const row = ctx.handle.db.prepare('SELECT COUNT(*) AS n FROM update_dedup').get();
  return Number((row as { n: number }).n);
}

/** Run something that must be refused, and hand back the typed refusal. */
function refusalOf(attempt: () => unknown): UpdateDedupError {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(UpdateDedupError);
    return error as UpdateDedupError;
  }
  expect.unreachable('the attempt must be refused');
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('update_dedup: the insert is the decision (§5.4.2, R13)', () => {
  it('reports the first delivery of a pair as new', () => {
    const { ctx } = openHarness();
    const claim = claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    expect(claim.outcome).toBe('new');
    expect(claim.key).toEqual({ botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    expect(rowCount(ctx)).toBe(1);
  });

  it('reports the same pair again as a duplicate, writes nothing, and keeps the first instant', () => {
    const { ctx } = openHarness();
    const first = claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    const second = claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });

    expect(second.outcome).toBe('duplicate');
    // A no-op: no second row, and the recorded instant is still the first delivery's.
    expect(rowCount(ctx)).toBe(1);
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
  });

  it('does not surface a duplicate as an error, because an error would earn another retry (§5.4.4)', () => {
    const { ctx } = openHarness();
    claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    expect(() => claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID })).not.toThrow();
  });

  it('refuses a malformed key before the engine is reached', () => {
    const { ctx } = openHarness();
    // An empty bot identifier would silently degrade the key to the identifier alone (R14).
    const noBot = refusalOf(() => claimDelivery(ctx, { botId: '', updateId: SHARED_UPDATE_ID }));
    expect(noBot.code).toBe('DEDUP_BOT_ID_EMPTY');
    expect(noBot.field).toBe('botId');

    const fractional = refusalOf(() => claimDelivery(ctx, { botId: BOT_ONE, updateId: 1.5 }));
    expect(fractional.code).toBe('DEDUP_UPDATE_ID_NOT_INTEGER');
    expect(rowCount(ctx)).toBe(0);
  });
});

describe('update_dedup: two bots, one identifier — the test that matters (§5.4.6, R14)', () => {
  it('treats the SAME update identifier from two different bots as two new deliveries', () => {
    const { ctx } = openHarness();

    const one = claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    const two = claimDelivery(ctx, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID });

    // This is the assertion a store keyed on the identifier alone fails: the second bot's
    // legitimate update would be reported as a duplicate and silently discarded, and the
    // symptom would be one bot going quiet for no visible reason.
    expect(one.outcome).toBe('new');
    expect(two.outcome).toBe('new');
    expect(rowCount(ctx)).toBe(2);

    const rows = ctx.handle.db
      .prepare('SELECT bot_id, update_id FROM update_dedup ORDER BY bot_id')
      .all()
      .map((row) => row as { bot_id: string; update_id: number });
    expect(rows).toEqual([
      { bot_id: BOT_ONE, update_id: SHARED_UPDATE_ID },
      { bot_id: BOT_TWO, update_id: SHARED_UPDATE_ID },
    ]);
  });

  it('keeps each bot on its own sequence, so a duplicate for one is not a duplicate for the other', () => {
    const { ctx } = openHarness();
    claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });

    expect(claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID }).outcome).toBe('duplicate');
    expect(claimDelivery(ctx, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID }).outcome).toBe('new');
    expect(claimDelivery(ctx, { botId: BOT_ONE, updateId: 42 }).outcome).toBe('new');
  });
});

describe('update_dedup: a unique index cannot be raced (§5.4.3)', () => {
  it('lets exactly one of many repeated claims win', () => {
    const { ctx } = openHarness();
    const outcomes = Array.from({ length: 8 }, () =>
      claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID }).outcome,
    );
    expect(outcomes.filter((outcome) => outcome === 'new')).toHaveLength(1);
    expect(rowCount(ctx)).toBe(1);
  });

  it('lets exactly one of two independent connections win the same pair', () => {
    // Two handles on one store file stand in for two processes racing the same delivery. The
    // decision lives in the store, not in either process's memory, so the loser is told it
    // lost — which is the property a read-then-write scheme cannot offer.
    const harness = openHarness();
    const other = harness.openAnotherConnection();

    const first = claimDelivery(harness.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    const second = claimDelivery(other, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });

    expect([first.outcome, second.outcome].filter((outcome) => outcome === 'new')).toHaveLength(1);
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
    expect(rowCount(other)).toBe(1);
  });
});

describe('update_dedup: the constraint is on the PAIR, read back from the engine', () => {
  it('reports a UNIQUE index over exactly (bot_id, update_id), not over the identifier alone', () => {
    const { ctx } = openHarness();

    // Read from the live schema rather than trusting the DDL text: a DDL string can say one
    // thing while the applied store enforces another, and only the engine's answer counts.
    const indexes = ctx.handle.db
      .prepare("PRAGMA index_list('update_dedup')")
      .all()
      .map((row) => row as { name: string; unique: number });

    const uniqueColumnSets = indexes
      .filter((index) => Number(index.unique) === 1)
      .map((index) =>
        ctx.handle.db
          // The index name comes from the engine's own answer above, never from a caller.
          .prepare(`PRAGMA index_info('${index.name}')`)
          .all()
          .map((row) => String((row as { name: string }).name)),
      );

    expect(uniqueColumnSets).toContainEqual(['bot_id', 'update_id']);
    // And nothing narrower: a unique index over either column alone is the collision bug.
    expect(uniqueColumnSets).not.toContainEqual(['update_id']);
    expect(uniqueColumnSets).not.toContainEqual(['bot_id']);
  });

  it('declares update_id as an integer column, so a fractional identifier cannot be stored', () => {
    const { ctx } = openHarness();
    const columns = ctx.handle.db
      .prepare("PRAGMA table_info('update_dedup')")
      .all()
      .map((row) => row as { name: string; type: string; notnull: number });
    expect(columns.find((column) => column.name === 'update_id')).toMatchObject({
      type: 'INTEGER',
      notnull: 1,
    });
    expect(columns.find((column) => column.name === 'bot_id')).toMatchObject({ type: 'TEXT', notnull: 1 });
  });
});

describe('update_dedup: the window is never pruned shorter than the redelivery window (§5.4.5)', () => {
  it('refuses a retention shorter than the provider may redeliver for', () => {
    const { ctx } = openHarness();
    claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });

    const refusal = refusalOf(() =>
      pruneDedupBefore(ctx, { retentionDays: 1, providerMaxRedeliveryDays: 2, asOf: '2026-02-01T00:00:00.000Z' }),
    );
    expect(refusal.code).toBe('DEDUP_RETENTION_SHORTER_THAN_REDELIVERY_WINDOW');
    expect(refusal.field).toBe('retentionDays');
    // Refused means nothing was removed: the replay window is still closed.
    expect(rowCount(ctx)).toBe(1);
  });

  it('removes only the rows older than the cutoff, and re-claiming a pruned pair is new again', () => {
    const harness = openHarness();
    const ctx: UpdateDedupContext = { handle: harness.ctx.handle, now: () => '2026-01-01T00:00:00.000Z' };
    const recent: UpdateDedupContext = { handle: harness.ctx.handle, now: () => '2026-01-20T00:00:00.000Z' };

    claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID });
    claimDelivery(recent, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID });

    const result = pruneDedupBefore(ctx, {
      retentionDays: 7,
      providerMaxRedeliveryDays: 7,
      asOf: '2026-01-22T00:00:00.000Z',
    });

    expect(result).toEqual({ prunedRows: 1, cutoff: '2026-01-15T00:00:00.000Z' });
    expect(rowCount(ctx)).toBe(1);
    // The pruned pair is outside the window now, so it is legitimately new again.
    expect(claimDelivery(ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID }).outcome).toBe('new');
    expect(claimDelivery(recent, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID }).outcome).toBe('duplicate');
  });
});
