// @vitest-environment node
/**
 * NIZAM · Backup executable-shell tests
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning contract: Contract 12; owning requirements R20, R22, R27 and R29.
 * Phase: 10.9 — test the existing backupStart.ts wrapper; ops scripts remain text-only.
 *
 * backupStart.ts is intentionally executable on import, so importing it in a unit test would start
 * the process as a side effect. These tests audit the tiny source boundary instead: the real file is
 * read, its required wiring is checked, and each negative mutation is proved to fire.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./backupStart.ts', import.meta.url), 'utf8');

function mutateOnce(source: string, from: string, to: string): string {
  const occurrences = source.split(from).length - 1;
  expect(occurrences, `mutation anchor must occur exactly once: ${from}`).toBe(1);
  const mutated = source.replace(from, to);
  expect(mutated).not.toBe(source);
  return mutated;
}

function assertEntrypointWiring(source: string): void {
  expect(source).toContain("import { backupMain } from './backupMain.ts';");
  expect(source).toContain('const outcome = await backupMain(nodeProcess.argv.slice(2));');
  expect(source).toContain('nodeProcess.exitCode = outcome.exitCode;');
  expect(source).not.toContain('process.exit(');
  expect(source).not.toContain('execFile');
  expect(source).not.toContain('ops/restore/restore.sh');
}

describe('backupStart remains a one-purpose executable shell', () => {
  it('passes process arguments to backupMain and propagates its outcome code', () => {
    assertEntrypointWiring(SOURCE);
  });

  it('does not add a second backup or restore mechanism', () => {
    expect(SOURCE.match(/backupMain\(/g)).toHaveLength(1);
    expect(SOURCE.match(/nodeProcess\.exitCode/g)).toHaveLength(1);
    expect(SOURCE).not.toContain("from 'node:fs'");
    expect(SOURCE).not.toContain("from 'node:child_process'");
    expect(SOURCE).not.toContain('fetch(');
  });

  it('fires when the argument vector is no longer passed through', () => {
    const mutated = mutateOnce(SOURCE, 'backupMain(nodeProcess.argv.slice(2))', 'backupMain([])');
    expect(() => assertEntrypointWiring(mutated)).toThrow();
  });

  it('fires when the wrapper stops propagating the runtime outcome', () => {
    const mutated = mutateOnce(SOURCE, 'nodeProcess.exitCode = outcome.exitCode;', 'nodeProcess.exitCode = 0;');
    expect(() => assertEntrypointWiring(mutated)).toThrow();
  });
});
