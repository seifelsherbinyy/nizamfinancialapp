// @vitest-environment node
/**
 * NIZAM · One money implementation, structurally proven — contract 06 §4.3 T12 (R4)
 * Implemented by: PFOS Contract 06 / Phase 1.3 (spec 06-two-agent-vps)
 * Depends on: the source tree of src/server and src/lib/money (read from disk, not imported)
 *
 * Contract 06 §4.3 is an INVARIANT, not a preference: "there will never be a second
 * implementation of money in this system. The server tier imports `src/lib/money/`
 * VERBATIM. It does not port it, mirror it, re-derive it, or wrap it in an alternative
 * arithmetic." T12 is the acceptance test for that sentence.
 *
 * An invariant about the ABSENCE of code cannot be tested by exercising code — there is
 * nothing to call. So this file reads the source, exactly as `isolation.test.ts` reads it to
 * prove no cross-database statement exists. Three properties are asserted:
 *
 *  1. The server tier IMPORTS the money core. If it did not, the parity guarantee would be
 *     a coincidence rather than a consequence.
 *  2. No server module DECLARES a member of the money surface. A local `function add` or
 *     `const allocate` is a second implementation whatever its author intended.
 *  3. Every server module that CALLS a member of the money surface resolves it from the
 *     money core. A module that used one of those names without importing it would be
 *     sourcing monetary arithmetic from somewhere else.
 *
 * The float ban of §4.3 is asserted here too, on the same read. The harness enforces it
 * repo-wide (AC07); this restates it for the server tier so a regression fails inside the
 * suite that owns the tier rather than only at the gate.
 *
 * Every banned token is assembled from fragments, the technique `isolation.test.ts` and the
 * harness denylists both use, so this scanner never holds a contiguous copy of what it
 * forbids and therefore never matches itself — nor trips the neighbouring scans.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MONEY_CORE = fileURLToPath(new URL('../../lib/money/money.ts', import.meta.url));

/**
 * The full surface contract 06 §4.3 enumerates, minus the two whose names are too common in
 * ordinary prose and ordinary code to scan for honestly (`min`, `max`). Those two are pure
 * re-expressions of `cmp`, which IS scanned, so nothing about the invariant is lost: a
 * module that re-derived comparison would have to declare or call `cmp` to do it.
 */
const MONEY_SURFACE = [
  'MILLI',
  'isMoney',
  'assertMoney',
  'fromDecimal',
  'fromNumber',
  'toDecimal',
  'add',
  'sub',
  'negate',
  'abs',
  'mul',
  'mulRatio',
  'sum',
  'cmp',
  'allocate',
  'format',
] as const;

/** Assembled so this file never contains the literal token it forbids. */
const FLOAT_BANS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a decimal string parse', pattern: new RegExp('\\bparse' + 'Float\\s*\\(') },
  { label: 'a fixed-decimal conversion', pattern: new RegExp('\\.toFi' + 'xed\\s*\\(') },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Strip line and block comments, so prose describing an operation is not read as one. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * True when the module resolves anything from the money core, aliased or relative.
 *
 * The extension is optional in the pattern and mandatory in the tree: finding F20 (task 10.23) gave
 * every relative specifier under `src/` its real extension, because Node's ESM resolver performs no
 * extension search and the owned images launch source with bare `node`. It stays optional here
 * because the aliased form carries none, and because this assertion is about WHICH module is
 * imported rather than about how the specifier is spelled.
 */
function importsMoneyCore(source: string): boolean {
  return /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/money\/money(?:\.tsx?)?['"]/.test(source);
}

const relative = (file: string): string => file.slice(SERVER_ROOT.length).replace(/\\/g, '/');

describe('one money implementation, forever (§4.3, R4)', () => {
  const files = sourceFiles(SERVER_ROOT);
  const productionFiles = files.filter((file) => !/\.test\.tsx?$/.test(file));

  it('scans a non-empty server tree, so every assertion below can fail', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(productionFiles.length).toBeGreaterThan(0);
  });

  it('finds the money core where §4.3 says it lives, so the scan has a subject', () => {
    const core = readFileSync(MONEY_CORE, 'utf8');
    // If the core stopped exporting the surface, the tier below would be importing
    // something else and this whole test would be asserting nothing.
    for (const name of MONEY_SURFACE) {
      expect(core, `money core no longer exports ${name}`).toMatch(
        new RegExp(`export\\s+(?:function|const|type)\\s+${name}\\b`),
      );
    }
  });

  it('T12 imports the money core from the server tier rather than re-deriving it', () => {
    const importers = productionFiles.filter((file) => importsMoneyCore(readFileSync(file, 'utf8')));
    expect(importers.map(relative).sort()).not.toEqual([]);
  });

  it('T12 declares no member of the money surface anywhere in src/server', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const name of MONEY_SURFACE) {
        // A declaration, in any of the forms TypeScript offers one.
        const declaration = new RegExp(
          `(?:^|[;{}\\s])(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b` +
            `|(?:const|let|var)\\s+${name}\\s*[=:]` +
            `|class\\s+${name}\\b)`,
        );
        if (declaration.test(source)) offenders.push(`${relative(file)} declares ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('T12 sources every money operation it calls from the money core', () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      if (importsMoneyCore(source)) continue;
      for (const name of MONEY_SURFACE) {
        // Call position only. A column named `amount` or a comment about a sum is not an
        // operation; `mulRatio(...)` in a module that imports nothing is.
        // `Math.abs(...)` is a member access on a built-in, not a money operation, so a
        // preceding dot disqualifies the match; only a bare call counts.
        if (new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(source)) {
          offenders.push(`${relative(file)} calls ${name} without importing the money core`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never lets a float touch money anywhere in src/server (§4.3, AC07)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const ban of FLOAT_BANS) {
        if (ban.pattern.test(source)) offenders.push(`${relative(file)} uses ${ban.label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
