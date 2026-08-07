// @vitest-environment node
/**
 * NIZAM · work_queue repository tests — durable across a restart, idempotent per item
 * Implemented by: PFOS Contract 12 / Phase 4.3 (spec 06-two-agent-vps)
 * Owning requirements: R15 (accept fast, process asynchronously)
 * Depends on: ../db/store (a real migrated store), ./workQueueRepo
 *
 * Tested against the actual engine rather than a double, because every property under test is a
 * property OF the engine: that a row written before a close is readable after a re-open, that a
 * conditional update reports zero rows when it loses, and that `UNIQUE (bot_id, update_id)` refuses
 * a second unit of work for one delivery. A double would assert nothing about any of them.
 *
 * The restart case (§5.5.2) closes the handle and opens a NEW one against the same file, which is the
 * only honest way to test durability: asserting the pragma would test that we asked, not that it held.
 *
 * Every identifier below is synthetic and deliberately short (R24, steering §0b).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoreHandle } from '../db/connection';
import { openFinanceStore } from '../db/store';
import {
  abandonExhaustedWork,
  claimNextWork,
  enqueueWork,
  pruneSettledWork,
  reclaimStalledWork,
  retryNotBefore,
  settleWork,
  WORK_ATTEMPTS_EXHAUSTED,
  workQueueDepth,
  WorkQueueError,
  type WorkQueueContext,
  type WorkRetryPolicy,
} from './workQueueRepo';

const BOT_ONE = 'bot-one';
const BOT_TWO = 'bot-two';
const SENDER = 'op-1';
const SHARED_UPDATE_ID = 41;
/** Synthetic body. Untrusted data, never an instruction (§6.4). */
const BODY = '{"t":"hello"}';

const RETRY: WorkRetryPolicy = { baseMs: 1_000, maxMs: 60_000, maxAttempts: 3 };

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

function stepIds(prefix = 'wq'): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `${prefix}-${String(n).padStart(3, '0')}`;
  };
}

interface Harness {
  readonly ctx: WorkQueueContext;
  /** A NEW connection to the SAME store file, standing in for a restart or a second process. */
  reopen(): WorkQueueContext;
  closeAll(): void;
}

function openHarness(prefix = 'nizam-wq-'): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const handles: StoreHandle[] = [];
  let generation = 0;
  const open = (): WorkQueueContext => {
    generation += 1;
    const now = stepClock();
    const { handle } = openFinanceStore(
      { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
      now,
    );
    handles.push(handle);
    return { handle, now, newId: stepIds(`wq${generation}`) };
  };
  const ctx = open();
  const closeAll = (): void => {
    for (const handle of handles) {
      try {
        handle.close();
      } catch {
        // Already closed by a test that was proving a restart.
      }
    }
  };
  cleanups.push(() => {
    closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { ctx, reopen: open, closeAll };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('work_queue durability (contract 12 §5.5.2)', () => {
  it('an enqueued item survives a restart: closed, re-opened, still claimable', () => {
    const h = openHarness();
    const { queuedRef, inserted } = enqueueWork(h.ctx, {
      botId: BOT_ONE,
      updateId: SHARED_UPDATE_ID,
      senderId: SENDER,
      rawBody: BODY,
    });
    expect(inserted).toBe(true);

    // The restart. This handle is gone; nothing is held in memory across the boundary.
    h.ctx.handle.close();

    const after = h.reopen();
    expect(workQueueDepth(after)).toMatchObject({ queued: 1, running: 0, done: 0, failed: 0 });

    const claimed = claimNextWork(after, 1);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.queuedRef).toBe(queuedRef);
    // The payload survived too, which is what makes the item processable at all: nothing had read
    // the body before the acknowledgement (§5.5.1).
    expect(claimed[0]?.rawBody).toBe(BODY);
    expect(claimed[0]?.senderId).toBe(SENDER);
  });

  it('two bots sharing one update identifier are two units of work, not one (R14)', () => {
    const h = openHarness();
    const first = enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const second = enqueueWork(h.ctx, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
    expect(second.queuedRef).not.toBe(first.queuedRef);
    expect(workQueueDepth(h.ctx).queued).toBe(2);
  });
});

describe('work_queue idempotence (contract 12 §5.5.3)', () => {
  it('the same delivery enqueued twice is one unit of work, and the second reports the first ref', () => {
    const h = openHarness();
    const first = enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const again = enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });

    expect(first.inserted).toBe(true);
    expect(again.inserted).toBe(false);
    expect(again.queuedRef).toBe(first.queuedRef);
    expect(workQueueDepth(h.ctx).queued).toBe(1);
  });

  it('two connections cannot both claim one row', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const other = h.reopen();

    const mine = claimNextWork(h.ctx, 5);
    const theirs = claimNextWork(other, 5);

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(workQueueDepth(h.ctx)).toMatchObject({ queued: 0, running: 1 });
  });

  it('settling the same item twice writes once: the second settlement is a no-op', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const item = claimNextWork(h.ctx, 1)[0];
    expect(item).toBeDefined();

    const first = settleWork(h.ctx, item!.queuedRef, { outcome: 'done' });
    const second = settleWork(h.ctx, item!.queuedRef, { outcome: 'done' });

    expect(first.settled).toBe(true);
    expect(second.settled).toBe(false);
    expect(workQueueDepth(h.ctx)).toMatchObject({ done: 1, queued: 0, running: 0 });
  });

  it('a done item is not claimable again, so one item yields one effect', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const item = claimNextWork(h.ctx, 1)[0];
    settleWork(h.ctx, item!.queuedRef, { outcome: 'done' });

    expect(claimNextWork(h.ctx, 5)).toHaveLength(0);
  });

  it('an item stuck running after a crash is reclaimed, not abandoned and not duplicated', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const item = claimNextWork(h.ctx, 1)[0];
    expect(item?.attempt).toBe(1);
    // The crash: nothing settles the row. It is durable and unreachable until reclaimed.
    expect(claimNextWork(h.ctx, 5)).toHaveLength(0);

    const reclaimed = reclaimStalledWork(h.ctx, 1);
    expect(reclaimed).toBe(1);

    const again = claimNextWork(h.ctx, 1)[0];
    expect(again?.queuedRef).toBe(item?.queuedRef);
    // The attempt counter advanced, so a backoff is computed for the attempt actually being made.
    expect(again?.attempt).toBe(2);
    expect(workQueueDepth(h.ctx).running).toBe(1);
  });
});

describe('work_queue retry scheduling (contract 12 §5.5.4)', () => {
  it('a retried item is not claimable until its backoff instant', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const item = claimNextWork(h.ctx, 1)[0];

    // Far enough ahead that the stepping clock cannot reach it inside this test.
    const notBefore = new Date(Date.UTC(2026, 0, 2)).toISOString();
    const settlement = settleWork(h.ctx, item!.queuedRef, { outcome: 'retry', notBefore });

    expect(settlement.settled).toBe(true);
    expect(settlement.state).toBe('queued');
    expect(workQueueDepth(h.ctx)).toMatchObject({ queued: 1, running: 0 });
    expect(claimNextWork(h.ctx, 5)).toHaveLength(0);
  });

  it('the backoff doubles per attempt and clamps at the injected ceiling', () => {
    const at = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const delayFor = (attempt: number): number => Date.parse(retryNotBefore(RETRY, attempt, at)) - Date.parse(at);

    expect(delayFor(1)).toBe(RETRY.baseMs);
    expect(delayFor(2)).toBe(RETRY.baseMs * 2);
    expect(delayFor(3)).toBe(RETRY.baseMs * 4);
    // Doubling forever would schedule a retry past any horizon; the ceiling is injected, not assumed.
    expect(delayFor(40)).toBe(RETRY.maxMs);
  });

  it('an abandoned item records a reason code and never returns to the claimable set', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const item = claimNextWork(h.ctx, 1)[0];

    expect(abandonExhaustedWork(h.ctx, item!.queuedRef, WORK_ATTEMPTS_EXHAUSTED).settled).toBe(true);
    expect(workQueueDepth(h.ctx)).toMatchObject({ failed: 1, queued: 0, running: 0 });
    expect(claimNextWork(h.ctx, 5)).toHaveLength(0);

    const row = h.ctx.handle.db.prepare('SELECT last_error FROM work_queue WHERE id = ?').get(item!.queuedRef);
    expect((row as { last_error?: unknown }).last_error).toBe(WORK_ATTEMPTS_EXHAUSTED);
  });
});

describe('work_queue refusals and pruning', () => {
  it('a submission missing a bot identifier is refused, because the key would collide', () => {
    const h = openHarness();
    expect(() => enqueueWork(h.ctx, { botId: '  ', updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY })).toThrow(
      WorkQueueError,
    );
  });

  it('a submission missing a sender is refused, so the allowlist decision stays meaningful', () => {
    const h = openHarness();
    expect(() => enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: '', rawBody: BODY })).toThrow(
      WorkQueueError,
    );
  });

  it('a non-integer update identifier is refused', () => {
    const h = openHarness();
    expect(() => enqueueWork(h.ctx, { botId: BOT_ONE, updateId: 1.5, senderId: SENDER, rawBody: BODY })).toThrow(
      WorkQueueError,
    );
  });

  it('pruning removes settled rows and leaves unsettled work alone', () => {
    const h = openHarness();
    enqueueWork(h.ctx, { botId: BOT_ONE, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    enqueueWork(h.ctx, { botId: BOT_TWO, updateId: SHARED_UPDATE_ID, senderId: SENDER, rawBody: BODY });
    const claimed = claimNextWork(h.ctx, 1)[0];
    settleWork(h.ctx, claimed!.queuedRef, { outcome: 'done' });

    // A day later, with a zero-hour window: the settled row goes, the queued one stays.
    const result = pruneSettledWork(h.ctx, 0, new Date(Date.UTC(2026, 0, 2)).toISOString());

    expect(result.prunedRows).toBe(1);
    expect(workQueueDepth(h.ctx)).toMatchObject({ queued: 1, done: 0 });
  });

  it('a negative retention is refused rather than clamped', () => {
    const h = openHarness();
    expect(() => pruneSettledWork(h.ctx, -1, new Date(Date.UTC(2026, 0, 2)).toISOString())).toThrow(WorkQueueError);
  });
});
