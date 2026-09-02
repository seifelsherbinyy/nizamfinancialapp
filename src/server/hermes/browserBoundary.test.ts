/**
 * Browser/server bundle boundary tests.
 * Owning contract: UPOI task 4.2; PFOS Contract 12 and 13.
 * Phase: Phase 4.2 execution-only Hermes boundary.
 * Depends on: the browser source tree and the server-only routing/benchmark/Hermes modules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BROWSER_ROOTS = [
  join(ROOT, 'src', 'App.tsx'),
  join(ROOT, 'src', 'app'),
  join(ROOT, 'src', 'features'),
  join(ROOT, 'src', 'lib'),
  join(ROOT, 'src', 'state'),
];
const SERVER_IMPORT = /(?:from|import\s*\()\s*['"`](?:(?:@\/)|(?:\.\.\/)+|(?:src\/))server\/(?:routing|benchmark|hermes)[^'"`]*['"`]/u;

function sourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx|js|jsx)$/u.test(entry.name) ? [child] : [];
  });
}

describe('browser/server boundary', () => {
  it('does not import server-only Hermes, routing, or benchmark modules', () => {
    const violations = BROWSER_ROOTS.flatMap(sourceFiles).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return SERVER_IMPORT.test(source) ? [relative(ROOT, file)] : [];
    });
    expect(violations).toEqual([]);
  });
});
