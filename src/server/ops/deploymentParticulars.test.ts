// @vitest-environment node
/**
 * NIZAM · The tree carries no deployment particular, and the gate that says so cannot pass by not running
 * Implemented by: PFOS Contract 12 / Phase 9.0 (spec 06-two-agent-vps)
 * Owning requirements: R24 (no deployment particular in a tracked file), steering §0b (the repository
 *   may hold the design, never a particular), steering §4.1 (separate stores, and no keyword that
 *   opens a second one on an existing connection)
 * Depends on: ./deploymentParticulars, ./composeTemplate (the ONE no-deployment-particular scan, here
 *   injected exactly as the harness injects it), ./patchSeries (only to prove the two declared-token
 *   lists cannot drift apart), and the real tree on disk
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The real tree produces no finding, over a scan set whose size is asserted to be non-zero,
 * and the declared-token list is asserted to be exactly current.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that breaks one property and observes that
 * code fire BY NAME. The three fail-closed paths - a root that is not there, a root that matches
 * nothing, a file that will not read - are exercised through the real file entry point as well, and
 * each must RETURN a finding: a thrown error is not a fired gate, and a tamper reporting zero findings
 * is a false pass. The coverage test at the end fails if a code is added without a row.
 *
 * Every forbidden shape below is assembled from fragments, so this file holds no contiguous copy of
 * anything the scans forbid and never trips them.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanForParticulars, type ComposeFinding } from './composeTemplate';
import { DECLARED_DOTTED_TOKENS as PATCH_DECLARED_TOKENS } from './patchSeries';
import {
  DECLARED_DOTTED_TOKENS,
  FIXTURE_SHAPED_PATH,
  PARTICULAR_FINDING_CODES,
  SCAN_ROOTS,
  SERVER_ROOT,
  auditDeploymentParticulars,
  auditDeploymentParticularsFiles,
  collectFiles,
  dottedTokensIn,
  mapParticularFindings,
  maskPlaceholderAuthority,
  normalizeForScan,
  type Artifact,
  type ParticularFindingCode,
  type ParticularScanInput,
} from './deploymentParticulars';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

// --- shapes assembled from fragments ----------------------------------------------------------
const URL_CONCRETE = 'ht' + 'tp' + '://' + 'probe-endpoint' + '.' + 'inva' + 'lid';
const URL_PLACEHOLDER_AUTHORITY = 'ht' + 'tps' + '://' + 'money.' + '<DOMAIN>' + '/<ANY_PATH>';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'tree.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';
const MALFORMED_PLACEHOLDER = '<' + 'lower_case' + '>';
const UNDECLARED_TOKEN = 'module' + '.' + 'attribute';
const ROW_APPEND_NAME = 'ins' + 'ert';
const ROW_APPEND_SHORT = 'i' + 'n' + 's';
const SECOND_STORE_KEYWORD = 'AT' + 'TACH';

/** A synthetic input whose non-overridden parts are healthy, so each case breaks exactly one thing. */
function inputWith(overrides: Partial<ParticularScanInput> = {}): ParticularScanInput {
  const artifacts: readonly Artifact[] = overrides.artifacts ?? [{ path: 'ops/probe.md', text: 'a clean line\n' }];
  return {
    roots: overrides.roots ?? [{ root: 'ops', exists: true, files: artifacts.map((a) => a.path) }],
    artifacts,
    serverArtifacts: overrides.serverArtifacts ?? [{ path: 'src/server/probe.ts', text: 'export const ok = 1;\n' }],
    trackedFiles: overrides.trackedFiles ?? [],
  };
}

function codesFor(overrides: Partial<ParticularScanInput>, scan = scanForParticulars): readonly ParticularFindingCode[] {
  return auditDeploymentParticulars(inputWith(overrides), scan).findings.map((f) => f.code);
}

/** An ops artifact carrying one injected shape and nothing else unusual. */
function opsCarrying(text: string): Partial<ParticularScanInput> {
  return { artifacts: [{ path: 'ops/probe.md', text: `a clean line\n${text}\n` }] };
}

/** A server artifact carrying one injected line. */
function serverCarrying(line: string): Partial<ParticularScanInput> {
  return { serverArtifacts: [{ path: 'src/server/probe.ts', text: `// a clean line\n${line}\n` }] };
}

interface NegativeCase {
  readonly code: ParticularFindingCode;
  readonly why: string;
  readonly overrides: Partial<ParticularScanInput>;
  readonly scan?: (source: string) => readonly ComposeFinding[];
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  // --- fail closed ------------------------------------------------------------------------------
  {
    code: 'SCAN_ROOT_MISSING',
    why: 'a root that is not there makes every assertion about it pass vacuously',
    overrides: { roots: [{ root: 'ops-that-moved', exists: false, files: [] }] },
  },
  {
    code: 'SCAN_ROOT_EMPTY',
    why: 'a root that matches nothing is a check that does not run',
    overrides: { roots: [{ root: 'ops', exists: true, files: [] }] },
  },
  {
    code: 'SCAN_SET_EMPTY',
    why: 'zero artifacts read is the failure this whole check exists to prevent',
    overrides: { artifacts: [] },
  },
  {
    code: 'SERVER_TREE_EMPTY',
    why: 'with no server file collected, both named bans would report clean without looking at anything',
    overrides: { serverArtifacts: [] },
  },
  {
    code: 'ARTIFACT_UNREADABLE',
    why: 'a file that will not read was not scanned, and unscanned is not clean',
    overrides: { artifacts: [{ path: 'ops/probe.md', text: null }] },
  },
  {
    code: 'FIXTURE_OUTSIDE_SCAN_SET',
    why: 'every fixture is in scope, so a fixture-shaped path the scan set does not hold is a gap, not a naming choice',
    overrides: { trackedFiles: ['src/elsewhere/fixtures/recorded-run.json'] },
  },
  // --- R24, re-reported from the ONE shared scan -------------------------------------------------
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'an absolute address with a concrete authority is an endpoint written down, and every endpoint is injected at run time',
    overrides: opsCarrying(URL_CONCRETE),
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'no address of the host, in any notation',
    overrides: opsCarrying(ADDRESS_SHAPED),
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'write a placeholder, never a name',
    overrides: opsCarrying(HOSTNAME_SHAPED),
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'a long digit run is the shape of a messaging user identifier',
    overrides: opsCarrying(LONG_DIGIT_RUN),
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'no real monetary figure in a fixture or an aside',
    overrides: opsCarrying(CURRENCY_SHAPED),
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is not recognizable as one, so a real value could sit in its shape',
    overrides: opsCarrying(MALFORMED_PLACEHOLDER),
  },
  {
    code: 'PARTICULAR_SCAN_UNMAPPED',
    why: 'a widened shared scan must never be narrowed here by dropping a code this checker has no name for',
    overrides: {},
    scan: () => [{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' } as ComposeFinding],
  },
  // --- the declared-token vocabulary, both directions --------------------------------------------
  {
    code: 'DOTTED_TOKEN_UNDECLARED',
    why: 'a dotted token nobody declared is either a host name or an oversight, and the mask must not decide which',
    overrides: opsCarrying(UNDECLARED_TOKEN),
  },
  {
    code: 'DECLARED_TOKEN_UNUSED',
    why: 'an entry that matches nothing in the tree is an entry nobody is reading, and it could be admitting a host name',
    overrides: opsCarrying('nothing declared appears here'),
  },
  // --- steering §4.1, over src/server/** ---------------------------------------------------------
  {
    code: 'ROW_APPEND_STATEMENT_AS_LOCAL',
    why: 'a local named after the row-append statement is how an ad-hoc row write gets in beside the money boundary guard',
    overrides: serverCarrying(`const ${ROW_APPEND_NAME} = handle.db.prepare(SOME_SQL);`),
  },
  {
    code: 'SECOND_STORE_KEYWORD_PRESENT',
    why: 'steering §4.1 permits opening a second store on an existing connection nowhere, ever, and a mention in prose is where the idea starts',
    overrides: serverCarrying(`// never ${SECOND_STORE_KEYWORD} another agent's store`),
  },
];

// ---------------------------------------------------------------------------------------------
// POSITIVE - the real tree
// ---------------------------------------------------------------------------------------------

describe('the real tree', () => {
  const report = auditDeploymentParticularsFiles(scanForParticulars);

  it('carries no deployment particular anywhere under the declared roots', () => {
    expect(report.findings.map((f) => `${f.code} ${f.detail}`)).toEqual([]);
  });

  it('examined a non-zero number of files, so the verdict is evidence and not silence', () => {
    expect(report.artifactsScanned).toBeGreaterThan(0);
    expect(report.serverFilesScanned).toBeGreaterThan(0);
    for (const root of SCAN_ROOTS) {
      expect(report.perRoot[root], root).toBeGreaterThan(0);
    }
  });

  it('scans the recorded-replay fixtures, which is where every fixture in this repository lives', () => {
    const fixtures = collectFiles('src/server/mocks/fixtures') ?? [];
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) expect(FIXTURE_SHAPED_PATH.test(f)).toBe(true);
  });

  it('leaves no dotted token unaccounted for once the declared ones are masked', () => {
    for (const root of SCAN_ROOTS) {
      for (const path of collectFiles(root) ?? []) {
        expect(dottedTokensIn(normalizeForScan(readFileSync(join(REPO, path), 'utf8'))), path).toEqual([]);
      }
    }
  });

  it('agrees with the cross-repo series on every token the two lists share, so they cannot drift', () => {
    const mine = new Set(DECLARED_DOTTED_TOKENS);
    const theirsPresentHere = PATCH_DECLARED_TOKENS.filter((t) =>
      (collectFiles('ops') ?? []).some((p) => readFileSync(join(REPO, p), 'utf8').includes(t)),
    );
    expect(theirsPresentHere.filter((t) => !mine.has(t))).toEqual([]);
  });

  it('holds neither banned token contiguously in its own source, so the checker cannot flag itself', () => {
    for (const file of ['deploymentParticulars.ts', 'deploymentParticulars.test.ts']) {
      const text = readFileSync(join(REPO, 'src/server/ops', file), 'utf8');
      expect(new RegExp('(?<![A-Za-z0-9_$])' + ROW_APPEND_NAME + '(?![A-Za-z0-9_$])').test(text), file).toBe(false);
      expect(new RegExp('(?<![A-Za-z0-9_$])' + SECOND_STORE_KEYWORD + '(?![A-Za-z0-9_$])', 'i').test(text), file).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The one judgement this module adds, stated and exercised
// ---------------------------------------------------------------------------------------------

describe('an absolute address is only permitted when its authority is injected', () => {
  it('masks the scheme when the authority carries a placeholder, so a human-facing command survives', () => {
    expect(scanForParticulars(maskPlaceholderAuthority(URL_PLACEHOLDER_AUTHORITY)).map((f) => f.code)).toEqual([]);
  });

  it('does NOT mask it when the authority is concrete, so the shared scan still reports it', () => {
    expect(scanForParticulars(maskPlaceholderAuthority(URL_CONCRETE)).map((f) => f.code)).toContain('PARTICULAR_URL_SCHEME');
  });
});

// ---------------------------------------------------------------------------------------------
// NEGATIVE - each code fires by name
// ---------------------------------------------------------------------------------------------

describe('every finding code fires on a real break', () => {
  for (const c of NEGATIVE_CASES) {
    it(`${c.code}: ${c.why}`, () => {
      expect(codesFor(c.overrides, c.scan ?? scanForParticulars)).toContain(c.code);
    });
  }

  it('the short form of the row-append statement is refused as a binding name too', () => {
    expect(codesFor(serverCarrying(`let ${ROW_APPEND_SHORT} = 1;`))).toContain('ROW_APPEND_STATEMENT_AS_LOCAL');
  });

  it('a repository method reached through a receiver is a named boundary and is not a finding', () => {
    expect(codesFor(serverCarrying(`accounts.${ROW_APPEND_NAME}(row);`))).not.toContain('ROW_APPEND_STATEMENT_AS_LOCAL');
  });

  it('the statement inside a prepared string, and prose about it, are not findings', () => {
    const sql = `const written = db.prepare('${ROW_APPEND_NAME.toUpperCase()} INTO t VALUES (?)');`;
    expect(codesFor(serverCarrying(sql))).not.toContain('ROW_APPEND_STATEMENT_AS_LOCAL');
  });

  it('a longer word that merely contains the second-store keyword is not that keyword', () => {
    expect(codesFor(serverCarrying(`// the bus is ${SECOND_STORE_KEYWORD.toLowerCase()}ed to one network`))).not.toContain(
      'SECOND_STORE_KEYWORD_PRESENT',
    );
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'x' } as ComposeFinding], 'ops/probe.md');
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });
});

// ---------------------------------------------------------------------------------------------
// The fail-closed paths, through the REAL file entry point
// ---------------------------------------------------------------------------------------------

describe('the file entry point fails closed rather than throwing or passing', () => {
  it('a directory that does not exist is a finding', () => {
    const report = auditDeploymentParticularsFiles(scanForParticulars, {
      roots: ['ops/definitely-not-here'],
      trackedFiles: [],
    });
    expect(report.findings.map((f) => f.code)).toContain('SCAN_ROOT_MISSING');
    expect(report.artifactsScanned).toBe(0);
  });

  it('a root that exists and matches nothing is a finding, not an empty pass', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nizam-empty-'));
    const report = auditDeploymentParticularsFiles(scanForParticulars, { roots: [empty], trackedFiles: [] });
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('SCAN_ROOT_EMPTY');
    expect(codes).toContain('SCAN_SET_EMPTY');
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('a server root that does not exist leaves both named bans unable to report clean', () => {
    const report = auditDeploymentParticularsFiles(scanForParticulars, {
      serverRoot: 'src/server-that-moved',
      trackedFiles: [],
    });
    expect(report.findings.map((f) => f.code)).toContain('SERVER_TREE_EMPTY');
    expect(report.serverFilesScanned).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

it('every finding code has a negative case, so a new code cannot arrive untested', () => {
  const covered = new Set<string>(NEGATIVE_CASES.map((c) => c.code));
  expect(PARTICULAR_FINDING_CODES.filter((c) => !covered.has(c))).toEqual([]);
  expect(SERVER_ROOT).toBe('src/server');
});
