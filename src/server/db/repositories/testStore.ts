/**
 * NIZAM · Test scaffolding for the fact repositories — contract 06 §9
 * Implemented by: PFOS Contract 06 / Phase 1.2 (spec 06-two-agent-vps)
 * Depends on: ../store.ts, support.ts
 *
 * A real store on a temporary directory, migrated, with an injected clock and an injected
 * id source. The repositories are tested against the actual engine rather than a double,
 * because the properties under test — that an integer survives a round-trip byte for byte,
 * and that the engine itself refuses to edit an append-only table — are properties OF the
 * engine and a double would assert nothing about them.
 *
 * The clock and the id source are deterministic here for the same reason the repositories
 * take them injected: a test that depended on the wall clock would assert a different fact
 * every time it ran. Nothing in this module is imported by application code.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFinanceStore } from '../store.ts';
import { createRepositoryContext, type RepositoryContext } from './support.ts';

export interface TestStore {
  readonly ctx: RepositoryContext;
  /** Every instant the injected clock has returned, in order. */
  readonly instants: readonly string[];
  close(): void;
}

/** Advance one second per call, from a fixed epoch, so ordering is legible in a failure. */
function stepClock(instants: string[]): () => string {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return (): string => {
    const at = new Date(base + instants.length * 1_000).toISOString();
    instants.push(at);
    return at;
  };
}

/** Sequential ids for the rows a repository mints itself (audit entries, links). */
function stepIds(): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    return `gen-${String(n).padStart(4, '0')}`;
  };
}

/** Open a migrated store in a fresh temporary directory. The caller must `close()`. */
export function openTestStore(prefix = 'nizam-repo-'): TestStore {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const instants: string[] = [];
  const now = stepClock(instants);
  const { handle } = openFinanceStore(
    { dataDir, fileName: 'finance.db', busyTimeoutMs: 5_000, storeName: 'finance' },
    now,
  );
  const ctx = createRepositoryContext({ handle, now, actor: 'test-actor', newId: stepIds() });
  return {
    ctx,
    instants,
    close(): void {
      handle.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
