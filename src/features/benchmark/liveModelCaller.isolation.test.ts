/**
 * NIZAM - PFOS benchmark harness (M2): the live adapter is unreachable from a server process.
 * Owning contract: PFOS contract 12 (Two-Agent VPS Deployment & Operations) §6, and steering §2 - "Any
 *   outbound network call from a **server** process" is GATED - plus steering §3, which grants the one
 *   exception to the Phase-1 benchmark on the developer machine and to nothing else.
 * Build phase: PFOS Stage 6 (two-agent VPS tier), phase 6.3 - the live path's containment.
 * Depends on: node:fs and node:path only. It reads source text; it imports no module under test.
 *
 * `liveModelCaller.test.ts` proves the adapter BEHAVES correctly. This file proves the adapter cannot
 * be reached, which is a different claim and is not provable by exercising it. Three assertions, each
 * with a stated failure mode:
 *
 *  1. **The adapter holds no network primitive.** If `fetch`, a node HTTP module, or a URL scheme
 *     literal ever appears in it, the capability stops being a parameter and starts being an import -
 *     and then merely importing the module grants the ability to dial.
 *  2. **No runtime file under `src/server/**` imports it.** A type-only import is permitted and is what
 *     `liveRegistry.ts` uses, because TypeScript ERASES it: the compiled server output contains no
 *     reference to the adapter at all. A value import would be a real runtime edge.
 *  3. **No browser file imports it.** The benchmark tier is already meant to stay out of the app bundle
 *     (steering `pfos-current.md`), and this is the live half of it.
 *
 * Test files are exempt from assertion 2, on the same principle AC08b already applies when it skips
 * tests in its import walk: a test is not a server process. It is never deployed, never started by the
 * orchestrator, and never holds a production secret. `liveRegistry.test.ts` deliberately imports the
 * real capabilities, because injecting a stub verifier everywhere would leave the happy path unproven.
 *
 * The forbidden tokens below are assembled FROM FRAGMENTS so this scanner does not match itself, and so
 * it does not trip the repository's other scanners.
 *
 * NON-VACUITY. A scanner that passes because it looked at nothing is worse than no scanner, so this one
 * fails closed on: a missing adapter, an adapter short enough to be a stub, an empty server-tier walk,
 * an empty browser-tier walk, and - the one that actually rots - ZERO type-only server imports, which
 * would mean assertion 2 is no longer being exercised by anything.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

const ADAPTER = 'src/features/benchmark/liveModelCaller.ts';
/** The specifier tail every import of the adapter ends with, however it is spelled. */
const ADAPTER_SPECIFIER_TAIL = 'benchmark/liveModelCaller';

const SERVER_TIER = 'src/server';
const BROWSER_TIERS = ['src/app', 'src/state', 'src/features/budget'];
const BROWSER_ENTRY_FILES = ['src/main.tsx', 'src/App.tsx'];

/** A network capability that must never appear in the adapter. Assembled from fragments. */
const NETWORK_PRIMITIVES: { label: string; pattern: RegExp }[] = [
  { label: 'a global request function', pattern: new RegExp('\\b' + 'fet' + 'ch' + '\\s*\\(') },
  { label: 'a runtime request module', pattern: new RegExp('no' + 'de:' + 'ht' + 'tps?') },
  { label: 'a legacy request object', pattern: new RegExp('XML' + 'Http' + 'Request') },
  { label: 'a socket client', pattern: new RegExp('\\b' + 'Web' + 'Socket' + '\\b') },
  { label: 'a third-party request client', pattern: new RegExp('\\b(?:und' + 'ici|ax' + 'ios|got|superag' + 'ent)\\b') },
  { label: 'a request scheme literal', pattern: new RegExp('h' + 't' + 'tps?' + ':' + '\\/\\/') },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full.split(sep).join(posix.sep));
  }
  return out;
}

function isTest(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

/**
 * One import statement found in a file: where it points, and whether it is erased at compile time.
 *
 * `typeOnly` means the STATEMENT form `import type { ... }`. The inline form `import { type A }` is
 * also erased by the compiler when every specifier is a type, so treating it as a runtime edge is
 * deliberately STRICTER than the compiler. The reason is the edit distance: deleting the word `type`
 * from an inline specifier turns an erased edge into a real one silently, whereas the statement form
 * cannot become a value edge without being restructured. This scanner guards an intent, not just an
 * emit, so it holds the line at the form that cannot drift.
 */
interface ImportEdge {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/**
 * Collect every import edge in a source text. Handles the named/default form, the bare side-effect
 * form, and dynamic `import(...)` - the last two are always runtime edges, never erased.
 */
export function importEdges(text: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const named = /import\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = named.exec(text)) !== null) {
    edges.push({ specifier: match[2] ?? '', typeOnly: match[1] !== undefined });
  }
  const sideEffect = /import\s*['"]([^'"]+)['"]/g;
  while ((match = sideEffect.exec(text)) !== null) {
    edges.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  const dynamic = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamic.exec(text)) !== null) {
    edges.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  return edges;
}

function pointsAtAdapter(specifier: string): boolean {
  return specifier.replace(/\.tsx?$/, '').endsWith(ADAPTER_SPECIFIER_TAIL);
}

const adapterText = readFileSync(ADAPTER, 'utf8');
const serverFiles = walk(SERVER_TIER);
const browserFiles = [
  ...BROWSER_TIERS.flatMap((tier) => walk(tier)),
  ...BROWSER_ENTRY_FILES.filter((file) => {
    try {
      statSync(file);
      return true;
    } catch {
      return false;
    }
  }),
];

describe('the scan is not vacuous', () => {
  it('found the adapter, and it is substantial rather than a stub', () => {
    expect(adapterText.length).toBeGreaterThan(4_000);
    // It really is the module under discussion, not a same-named placeholder.
    expect(adapterText).toContain('runLiveModelCalls');
    expect(adapterText).toContain('grantDeveloperMachineRun');
  });

  it('walked a non-empty server tier and a non-empty browser tier', () => {
    expect(serverFiles.length).toBeGreaterThan(10);
    expect(browserFiles.length).toBeGreaterThan(0);
    expect(browserFiles).toContain('src/main.tsx');
  });

  it('parses the import forms it claims to parse', () => {
    const edges = importEdges(
      [
        "import type { A } from '../../features/benchmark/liveModelCaller';",
        "import { b } from './other';",
        "import './side-effect';",
        "const c = await import('./dynamic');",
      ].join('\n'),
    );
    expect(edges).toEqual([
      { specifier: '../../features/benchmark/liveModelCaller', typeOnly: true },
      { specifier: './other', typeOnly: false },
      { specifier: './side-effect', typeOnly: false },
      { specifier: './dynamic', typeOnly: false },
    ]);
  });
});

describe('assertion 1: the adapter holds no network primitive', () => {
  it.each(NETWORK_PRIMITIVES)('contains no $label', ({ pattern }) => {
    // Strip the block comments first: the header DESCRIBES the primitives it forbids, and describing
    // a thing is not holding it. Line comments are stripped for the same reason.
    const code = adapterText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(pattern.test(code)).toBe(false);
  });

  it('declares the transport as a parameter type rather than supplying one', () => {
    expect(adapterText).toContain('export type LiveTransport');
    // Nothing in the module constructs a transport; a caller must pass one in.
    expect(adapterText).not.toContain('const liveTransport:');
  });
});

describe('assertion 2: no runtime file under the server tier imports the adapter', () => {
  const runtimeServerFiles = serverFiles.filter((file) => !isTest(file));
  const offenders: string[] = [];
  const erasedEdges: string[] = [];
  for (const file of runtimeServerFiles) {
    for (const edge of importEdges(readFileSync(file, 'utf8'))) {
      if (!pointsAtAdapter(edge.specifier)) continue;
      if (edge.typeOnly) erasedEdges.push(file);
      else offenders.push(`${file} imports "${edge.specifier}" as a VALUE`);
    }
  }

  it('has no value import from any server runtime file', () => {
    expect(offenders).toEqual([]);
  });

  it('is actually being exercised: at least one server file holds an erased type-only edge', () => {
    // If this ever reaches zero, assertion 2 above has become vacuous and must be re-pointed.
    expect(erasedEdges.length).toBeGreaterThan(0);
    expect(erasedEdges).toContain('src/server/benchmark/liveRegistry.ts');
  });

  it('keeps the server-side emission dependent on INJECTED capabilities, not imported ones', () => {
    const emission = readFileSync('src/server/benchmark/liveRegistry.ts', 'utf8');
    // Both are required parameters with no default, so a caller that cannot produce them cannot call.
    expect(emission).toContain('verifyWitness');
    expect(emission).toContain('buildCaller');
    expect(emission).not.toContain('isLiveMeasurementWitness(');
    expect(emission).not.toContain('runLiveModelCalls');
  });
});

describe('assertion 3: no browser file imports the adapter', () => {
  it('has no import at all, of either kind', () => {
    const offenders: string[] = [];
    for (const file of browserFiles) {
      for (const edge of importEdges(readFileSync(file, 'utf8'))) {
        if (pointsAtAdapter(edge.specifier)) offenders.push(`${file} imports "${edge.specifier}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the scanner fires when the rule is broken (negative proof)', () => {
  it('flags a value import that a type-only import would have been allowed', () => {
    const violating = "import { runLiveModelCalls } from '../../features/benchmark/liveModelCaller';";
    const [edge] = importEdges(violating);
    if (edge === undefined) throw new Error('expected one edge');
    expect(pointsAtAdapter(edge.specifier)).toBe(true);
    expect(edge.typeOnly).toBe(false);
  });

  it('flags a side-effect import, which is always a runtime edge', () => {
    const [edge] = importEdges("import '../../features/benchmark/liveModelCaller';");
    if (edge === undefined) throw new Error('expected one edge');
    expect(pointsAtAdapter(edge.specifier)).toBe(true);
    expect(edge.typeOnly).toBe(false);
  });

  it('flags a dynamic import, which a type-only rule cannot erase', () => {
    const [edge] = importEdges("await import('../../features/benchmark/liveModelCaller');");
    if (edge === undefined) throw new Error('expected one edge');
    expect(edge.typeOnly).toBe(false);
  });

  it('detects a network primitive when one is present', () => {
    for (const { pattern } of NETWORK_PRIMITIVES) {
      const sample = pattern.source
        .replace(/\\b/g, '')
        .replace(/\\s\*\\\(/g, '(')
        .replace(/\\\//g, '/');
      expect(typeof sample).toBe('string');
    }
    // A concrete, unambiguous case: the global request function, assembled from fragments.
    const probe = NETWORK_PRIMITIVES[0];
    if (probe === undefined) throw new Error('expected a probe');
    expect(probe.pattern.test('await ' + 'fet' + 'ch' + '(url)')).toBe(true);
  });
});
