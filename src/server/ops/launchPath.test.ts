// @vitest-environment node
/**
 * NIZAM · The launch path: bare `node` can start what the three owned images run
 * Implemented by: PFOS Contract 12 / Phase 10.23 (spec 06-two-agent-vps), closing finding **F20**
 * Owning requirements: R28 (a Dockerfile for every image this repository owns, and a build path
 *   producing a runnable one), R29 (the finance-agent process starts and refuses an incomplete
 *   environment), R22 (the readiness command an image declares exists inside it)
 * Depends on: the real tree on disk, read as text. No module under test, deliberately - the subject
 *   is the SHAPE of every specifier in the tree and the agreement between four artifacts.
 *
 * ## Why this file exists, stated as the lesson rather than the symptom
 *
 * Every relative import under `src/` used to be written extensionless. The project's own toolchain
 * resolves that (`moduleResolution: "bundler"`; Vite and Vitest search the same way). Node's ESM
 * resolver performs no extension search, and all three owned images launch source directly with bare
 * `node`, so every `ENTRYPOINT` and every `--health` command died on its first import - before any
 * environment was read, on every host, in every mode. Rung **L2** was unreachable with all eight gates
 * observed, because each container exited immediately.
 *
 * **2126 tests were green while that was true.** They imported these processes through Vitest, which
 * is a different resolver from the one the container has, so they proved the logic and said nothing
 * about the launch. That is the lesson of F20 and the reason this file asserts specifier SHAPE and
 * cross-artifact AGREEMENT rather than behaviour: behaviour was never the thing that was broken.
 *
 * The actual launch - four shims spawned with bare `node` - is asserted by the launch half of
 * **AC16** (`scripts/verify/launch-path.mjs`), because spawning seven processes belongs in the harness
 * rather than in a unit suite. This file additionally asserts that the check is WIRED, since an
 * orphaned checker is the same as no checker.
 *
 * Nothing here spawns a process, builds an image or reads an environment (steering §2).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';

/** The four shims the three owned images and the restore drill invoke. */
const ENTRYPOINTS = [
  'src/server/process/start.ts',
  'src/server/process/busStart.ts',
  'src/server/process/schedulerStart.ts',
  'src/server/process/probe.ts',
] as const;

const DOCKERFILES = [
  { path: 'ops/images/finance-agent/Dockerfile', entrypoint: 'src/server/process/start.ts' },
  { path: 'ops/images/signal-bus/Dockerfile', entrypoint: 'src/server/process/busStart.ts' },
  { path: 'ops/images/scheduler/Dockerfile', entrypoint: 'src/server/process/schedulerStart.ts' },
] as const;

const CHECKER = 'scripts/verify/launch-path.mjs';
const AC16 = 'scripts/verify/toolchain-pin.mjs';
const LADDER_L0 = 'scripts/ladder/l0-config.mjs';
/** The hook task 10.12 needed and task 10.23 made redundant. It must stay gone. */
const RETIRED_HOOK = 'scripts/ladder/ts-resolve.mjs';

const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node|css|svg|png)$/;

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (['.ts', '.tsx'].includes(extname(path))) acc.push(path.split('\\').join('/'));
  }
  return acc;
}

const read = (path: string): string => readFileSync(path, 'utf8');

/**
 * Paths git reports as untracked, or `null` when git cannot answer.
 *
 * The specifier rule is asserted over the repository's OWN content, and an untracked file is by
 * definition not that. Nothing is lost by the exclusion, because **AC14** fails the harness on any
 * untracked file at all - so when the gate is green there is no untracked source file for this rule to
 * have missed. The two checks compose; neither is relaxed. If git cannot answer, nothing is excluded,
 * which is the stricter direction.
 */
function untrackedPaths(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    return new Set(
      out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return null;
  }
}

/**
 * Every relative specifier in a source text, with the ones inside a string literal held out - a test
 * that asserts an import PARSER holds import statements as data, and those are not imports. The rule
 * is textual and blunt: a quote already on the line before the specifier's own means it is inside
 * something. It over-excludes rather than under-excluding, which is why the total is floored below.
 */
function relativeSpecifiers(text: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = [];
  const pattern = /from(?:\s*)(['"])(\.[^'"\n]*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (/['"`]/.test(text.slice(lineStart, match.index))) continue;
    found.push({ specifier: match[2] ?? '', line: text.slice(0, match.index).split('\n').length });
  }
  return found;
}

/** Every specifier in a source text, relative or not, excluding the string-literal cases. */
function allSpecifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /from(?:\s*)(['"])([^'"\n]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (/['"`]/.test(text.slice(lineStart, match.index))) continue;
    found.push(match[2] ?? '');
  }
  return found;
}

/** The module graph bare `node` would actually load, walked the way Node walks it: no search. */
function launchGraph(): { modules: Set<string>; aliased: string[]; unresolved: string[] } {
  const modules = new Set<string>();
  const aliased: string[] = [];
  const unresolved: string[] = [];
  const queue = [...ENTRYPOINTS] as string[];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    for (const specifier of allSpecifiers(read(file))) {
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('@/')) {
        aliased.push(`${file} -> ${specifier}`);
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = join(dirname(file), specifier).split('\\').join('/');
      if (target.endsWith('.json')) {
        if (!existsSync(target)) unresolved.push(`${file} -> ${specifier}`);
        continue;
      }
      // No extension search, exactly as Node does it: the specifier must name the file.
      if (existsSync(target) && statSync(target).isFile()) queue.push(target);
      else unresolved.push(`${file} -> ${specifier}`);
    }
  }
  return { modules, aliased, unresolved };
}

const untracked = untrackedPaths();
const sourceFiles = [...walk('src'), ...walk('tests')].filter((file) => !(untracked?.has(file) ?? false));
const graph = launchGraph();

describe('the scan is not vacuous (F20, task 10.23)', () => {
  it('walked a substantial tree and a substantial launch graph', () => {
    expect(sourceFiles.length).toBeGreaterThan(200);
    expect(graph.modules.size).toBeGreaterThan(20);
  });

  it('counted enough relative specifiers to be guarding the tree it claims to guard', () => {
    const counted = sourceFiles.reduce((total, file) => total + relativeSpecifiers(read(file)).length, 0);
    expect(counted).toBeGreaterThan(500);
  });

  it('holds a specifier inside a string literal out, so a parser test is not read as an import', () => {
    const text = ["const cases = [", "  \"import { b } from './other';\",", "];", "import { real } from './real.ts';"].join('\n');
    expect(relativeSpecifiers(text).map((s) => s.specifier)).toEqual(['./real.ts']);
  });

  it('names the four shims the images and the restore drill invoke, and each exists', () => {
    expect(ENTRYPOINTS.length).toBe(4);
    for (const entrypoint of ENTRYPOINTS) expect(existsSync(entrypoint), entrypoint).toBe(true);
  });
});

describe('every relative specifier names its file, because Node performs no extension search', () => {
  it('carries an extension in every file under src and tests', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      for (const { specifier, line } of relativeSpecifiers(read(file))) {
        if (!HAS_EXTENSION.test(specifier)) offenders.push(`${file}:${line} ${specifier}`);
      }
    }
    expect(offenders, 'extensionless relative specifiers').toEqual([]);
  });

  it('resolves every edge of the launch graph with no search at all', () => {
    expect(graph.unresolved, 'edges bare node could not resolve').toEqual([]);
  });

  it('uses no path alias in the launch graph, which bare node cannot resolve either', () => {
    // A specifier the extension rule accepts and the runtime still refuses. Asserted separately
    // because fixing F20 by extension alone would leave this second way to break the same launch.
    expect(graph.aliased, 'alias specifiers reachable from an entrypoint').toEqual([]);
  });
});

describe('the compiler is configured for the shape the runtime requires', () => {
  const tsconfig = read('tsconfig.json');

  it('permits a TypeScript extension in a specifier', () => {
    expect(tsconfig).toMatch(/"allowImportingTsExtensions"\s*:\s*true/);
  });

  it('emits nothing, which is the condition that makes the permission legal', () => {
    // The compiler refuses the pair otherwise, and for a good reason: an emitted `.ts` specifier
    // would name a file the emitted output does not contain.
    expect(tsconfig).toMatch(/"noEmit"\s*:\s*true/);
  });
});

describe('the four artifacts that name an entrypoint agree', () => {
  it.each(DOCKERFILES)('$path launches $entrypoint, and the tree holds it', ({ path, entrypoint }) => {
    const recipe = read(path);
    const inImage = `/app/${entrypoint}`;
    expect(recipe).toContain(`ENTRYPOINT ["node", "${inImage}"]`);
    expect(existsSync(entrypoint), `${entrypoint} named by ${path}`).toBe(true);
  });

  it.each(DOCKERFILES)('$path installs health and probe commands naming files that exist', ({ path }) => {
    const recipe = read(path);
    const named = [...recipe.matchAll(/exec node \/app\/(src\/[^\s"']+\.ts)/g)].map((m) => m[1] as string);
    expect(named.length, 'exec lines naming a source entrypoint').toBeGreaterThanOrEqual(2);
    for (const target of named) {
      expect(existsSync(target), `${target} named by ${path}`).toBe(true);
      expect(ENTRYPOINTS as readonly string[]).toContain(target);
    }
  });

  it('the npm scripts name an entrypoint this suite covers', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    for (const script of ['start', 'health']) {
      const command = pkg.scripts?.[script] ?? '';
      const named = /(src\/[^\s]+\.ts)/.exec(command)?.[1];
      expect(named, `the ${script} script names a source entrypoint`).toBeDefined();
      expect(ENTRYPOINTS as readonly string[]).toContain(named as string);
    }
  });
});

describe('the check that holds this is wired, and the workaround it replaced is gone', () => {
  it('the launch-path checker exists and spawns the shims with bare node', () => {
    expect(existsSync(CHECKER)).toBe(true);
    const checker = read(CHECKER);
    for (const entrypoint of ENTRYPOINTS) expect(checker).toContain(entrypoint);
    expect(checker).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('AC16 imports it, so the assertion runs on every harness run rather than on request', () => {
    expect(read(AC16)).toMatch(/from\s+["']\.\/launch-path\.mjs["']/);
  });

  it('the resolve hook is gone, and the ladder launches the entrypoint the way a container does', () => {
    expect(existsSync(RETIRED_HOOK), 'the F20 workaround must not outlive F20').toBe(false);
    // Comments are stripped first: the ladder's header RECORDS that it used to launch through a hook,
    // and recording a repair is not performing one. The assertion is about what it executes.
    const code = read(LADDER_L0)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('ts-resolve');
    expect(code).not.toContain('--import');
    expect(code).toContain('spawn(process.execPath, [ENTRYPOINT,');
  });
});
