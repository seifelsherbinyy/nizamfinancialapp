// @vitest-environment node
/**
 * NIZAM · The excluded classification is not referenced by any artifact in this tier
 * Implemented by: PFOS Contract 12 / Phase 3.4 (spec 06-two-agent-vps)
 * Owning requirements: R10 (exclusion), contract 12 §4.4.3 and §4.4.5, T15
 * Depends on: the artifact trees of this tier (read from disk, nothing imported)
 *
 * Contract 12 §4.4 makes a claim STRONGER than "the bus rejects it". Five things are stated; this
 * file owns the third and the fifth, which nothing else asserted:
 *
 *   §4.4.1 not a member of the tier enum   → `schemaParity.test.ts`, `envelopeValidation.test.ts`
 *   §4.4.2 not stored in any of the three stores → contract 06 §3.4/§7.2; `signalStore.test.ts` DDL
 *   §4.4.3 **not REFERENCED** — no artifact in this tier (source, template, fixture, eval case, log,
 *          backup manifest, runbook) names, counts, summarizes, or points at such content
 *   §4.4.4 not transmitted                 → the tier enum is the only channel, so §4.4.1 carries it
 *   §4.4.5 **the posture is EXCLUSION, not filtering** — "there is no code path that handles it and
 *          no test that exercises carrying it. The only test is that an attempt to introduce it is
 *          refused."
 *
 * "Names" and "points at" are two different shapes, so two kinds of token are scanned for: the
 * classification's own name, and the other repository's family-domain path that carries it. An
 * artifact naming that path would be pointing at the content without ever naming the class.
 *
 * ## What this is scoped to, and why
 *
 * Four roots, discovered from disk rather than from a list, so an artifact added tomorrow is covered
 * on the day it lands:
 *
 *   `src/server/**`             the tier's source and its FIXTURES (design "repo layout")
 *   `ops/**`                    its TEMPLATES, RUNBOOKS, gate register, Phase 7's BACKUP MANIFESTS
 *   `src/features/benchmark/**` its EVAL CASES (Phase 6.1 completes the set here)
 *   `src/features/routing/**`   the read-model half of the tier that lives outside `src/server`
 *
 * That is every artifact kind §4.4.3 enumerates except a LOG, and this tier has no tracked log: a log
 * is runtime output on a host that does not exist yet (contract 12 §7), so asserting about a file that
 * cannot be present would be theatre. Recorded as a gap rather than papered over.
 *
 * ## The exception, handled honestly rather than by widening the rule
 *
 * Five documents DO name the classification contiguously: contracts 06 and 12,
 * `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`, `.kiro/steering/two-agent-vps.md`, and this spec's
 * `requirements.md`. They are **out of scope, and not by exemption**: §4.4.3 enumerates the artifact
 * kinds it binds — source, template, fixture, eval case, log, backup manifest, runbook — and a
 * governing document is none of them. A contract, a steering file and a requirements document are the
 * instruments that FORBID the thing, and a prohibition that could not be written down would be
 * unenforceable. So no carve-out is added to the rule: those files simply are not artifacts in the
 * tier, and no root below contains one.
 *
 * ## Why the tokens are assembled from fragments
 *
 * Every scanner here (`db/isolation.test.ts`, `db/moneyImplementation.test.ts`,
 * `ports/interfaceOnly.test.ts`, `mocks/determinism.test.ts`, and Phase 3.1/3.2's tests) assembles
 * its forbidden tokens from fragments so it never matches itself. This one must do the same in both
 * directions: a contiguous copy would fail its own contiguous rule, and the three Phase 3.1/3.2 tests
 * that assert the REFUSAL would be reported as references.
 *
 * ## Fail closed
 *
 * A missing root, an empty root, an unreadable file, a needle that cannot match, or a coverage set
 * missing an artifact kind is a FAILURE here, never a silent pass. A scanner that can pass vacuously
 * is worse than no scanner.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The four roots that hold this tier's artifacts, with the §4.4.3 kinds each one supplies. */
const TIER_ROOTS: readonly { readonly label: string; readonly path: string; readonly kinds: string }[] = [
  { label: 'src/server', path: join(REPO_ROOT, 'src', 'server'), kinds: 'source, fixture' },
  { label: 'ops', path: join(REPO_ROOT, 'ops'), kinds: 'template, runbook, backup manifest' },
  { label: 'src/features/benchmark', path: join(REPO_ROOT, 'src', 'features', 'benchmark'), kinds: 'eval case' },
  { label: 'src/features/routing', path: join(REPO_ROOT, 'src', 'features', 'routing'), kinds: 'source' },
];

/**
 * The forbidden tokens, none of them ever written contiguously in this file: the classification's own
 * name, and two forms of the other repository's family-domain path — the pointer shape §4.4.3 forbids
 * alongside the name.
 */
const EXCLUDED_TOKENS: readonly { readonly label: string; readonly fragments: readonly string[] }[] = [
  { label: 'the excluded tier name', fragments: ['strict_', 'local_', 'maximum'] },
  { label: 'the upstream family-domain path', fragments: ['AH', 'EL__family', '_network'] },
  { label: 'the upstream family-domain segment', fragments: ['family', '_network'] },
];

/**
 * The only files permitted to name a token at all, and then only in assembled-from-fragments form.
 * §4.4.5: the sole test is that an attempt to introduce it is refused, so this list is exactly the
 * tests that assert a refusal. It is checked in BOTH directions — an unlisted file that names it is a
 * new reference, and a listed file that stopped naming it is a refusal test that rotted away.
 */
const REFUSAL_TESTS: readonly string[] = [
  // Phase 2.1 — the tier enum has no such member, asserted at the port
  'src/server/ports/interfaceOnly.test.ts',
  // Phase 2.2 — the mock refuses a draft claiming it and stores nothing
  'src/server/mocks/signalBusMock.test.ts',
  // Phase 3.1 — the validator refuses it as an unknown enum member, with its own reason
  'src/server/signals/envelopeValidation.test.ts',
  'src/server/signals/schemaParity.test.ts',
  // Phase 3.2 — no policy can grant it, and the gate module never names it
  'src/server/signals/consentGate.test.ts',
  // Phase 10.19 — the bus PROCESS refuses a publish claiming it, at the endpoint the agents dial,
  // and the append-only store is read afterwards to show nothing was written
  'src/server/process/busServer.test.ts',
  // Phase 3.4 — this scan
  'src/server/signals/exclusion.test.ts',
];

interface Artifact {
  readonly rel: string;
  readonly text: string;
  readonly isTest: boolean;
}

/** Every file under a root, of every extension: a fixture is JSON and a runbook is Markdown. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** POSIX-shaped, so an assertion reads the same on either platform. */
function relPath(full: string): string {
  return relative(REPO_ROOT, full).split(sep).join('/');
}

/**
 * Collapse adjacent string-literal concatenation and array-element separation, so a token assembled
 * from fragments reads as the token itself. This is what lets the scan see through the very technique
 * every scanner here uses, which is why it is applied to non-test artifacts only.
 */
function joinFragments(text: string): string {
  return text.replace(/['"`]\s*(?:\+|,)\s*['"`]/g, '');
}

function hitsIn(text: string, fragments: readonly string[]): number[] {
  const needle = new RegExp(fragments.join(''), 'i');
  const lines: number[] = [];
  text.split('\n').forEach((line, index) => {
    if (needle.test(line)) lines.push(index + 1);
  });
  return lines;
}

function namesAnyToken(text: string): boolean {
  return EXCLUDED_TOKENS.some((token) => hitsIn(text, token.fragments).length > 0);
}

/** Collected once, at module scope, so every assertion below reads the same tree. */
const ARTIFACTS: readonly Artifact[] = TIER_ROOTS.flatMap((root) =>
  walk(root.path).map((full) => {
    const rel = relPath(full);
    return { rel, text: readFileSync(full, 'utf8'), isTest: /\.test\.tsx?$/.test(rel) };
  }),
);

// =============================================================================================
// The scan is shown to be real before it is trusted (fail closed)
// =============================================================================================

describe('the scan cannot pass vacuously (fail closed)', () => {
  it('finds every tier root on disk, so no root is silently skipped', () => {
    for (const root of TIER_ROOTS) {
      expect(existsSync(root.path), root.label).toBe(true);
    }
    expect(TIER_ROOTS).toHaveLength(4);
  });

  it('collects a non-empty artifact set from EVERY root, not merely from the tree as a whole', () => {
    for (const root of TIER_ROOTS) {
      const prefix = root.label + '/';
      expect(
        ARTIFACTS.filter((artifact) => artifact.rel.startsWith(prefix)).length,
        root.label,
      ).toBeGreaterThan(0);
    }
    expect(ARTIFACTS.length).toBeGreaterThan(40);
  });

  it('read every artifact it collected, so an unreadable file is a failure and not an absence', () => {
    // The collection above throws on an unreadable file rather than skipping it, which is the point;
    // this re-counts the tree independently so a silently shortened collection cannot go unnoticed.
    const onDisk = TIER_ROOTS.flatMap((root) => walk(root.path)).length;
    expect(ARTIFACTS).toHaveLength(onDisk);
    expect(ARTIFACTS.every((artifact) => typeof artifact.text === 'string')).toBe(true);
  });

  it('covers every artifact kind §4.4.3 names that exists in this tier today', () => {
    const has = (predicate: (rel: string) => boolean) => ARTIFACTS.some((artifact) => predicate(artifact.rel));
    expect(has((rel) => rel.startsWith('src/server/') && rel.endsWith('.ts'))).toBe(true); // source
    expect(has((rel) => rel.startsWith('src/server/mocks/fixtures/'))).toBe(true); // fixture
    expect(has((rel) => rel.startsWith('ops/') && rel.endsWith('.md'))).toBe(true); // template, runbook
    expect(has((rel) => rel.startsWith('src/features/benchmark/'))).toBe(true); // eval case
    // A LOG is the one enumerated kind with no tracked artifact — see the header. Asserted as an
    // absence so that the day one appears under a scanned root, it is scanned rather than exempt.
    expect(has((rel) => rel.endsWith('.log'))).toBe(false);
  });

  it('lists no refusal test that is not on disk, so the allowlist cannot drift into fiction', () => {
    for (const rel of REFUSAL_TESTS) {
      expect(
        ARTIFACTS.some((artifact) => artifact.rel === rel),
        rel,
      ).toBe(true);
    }
    expect(new Set(REFUSAL_TESTS).size).toBe(REFUSAL_TESTS.length);
  });

  it('uses needles that provably match the things they look for, and nothing else', () => {
    // Without this the assertions further down could be green because a regex was malformed. The
    // planted-reference negative was also run by hand against the real tree; this is its permanent,
    // self-contained form.
    for (const token of EXCLUDED_TOKENS) {
      const planted = `a signal claiming ${token.fragments.join('')} must be refused`;
      expect(hitsIn(planted, token.fragments), token.label).toEqual([1]);
      expect(hitsIn('a directional level and nothing else', token.fragments), token.label).toEqual([]);
    }
    expect(EXCLUDED_TOKENS).toHaveLength(3);
  });

  it('sees through fragment assembly, which is the technique every scanner here uses', () => {
    const [first, second, third] = EXCLUDED_TOKENS[0]!.fragments;
    const assembled = `const excluded = '${first}' + '${second}' + '${third}';`;
    expect(hitsIn(assembled, EXCLUDED_TOKENS[0]!.fragments)).toEqual([]);
    expect(hitsIn(joinFragments(assembled), EXCLUDED_TOKENS[0]!.fragments)).toEqual([1]);
  });
});

// =============================================================================================
// §4.4.3 — no artifact in this tier references the excluded classification
// =============================================================================================

describe('§4.4.3 no artifact in this tier references the excluded classification (R10, T15)', () => {
  it('names it nowhere, in code or in prose, in any artifact under any root', () => {
    // Absolute and case-insensitive. Comments are IN scope: a comment that names the thing is a
    // reference, which is why this file's own header describes it rather than spelling it.
    const offenders: string[] = [];
    for (const artifact of ARTIFACTS) {
      for (const token of EXCLUDED_TOKENS) {
        for (const line of hitsIn(artifact.text, token.fragments)) {
          offenders.push(`${artifact.rel}:${line} (${token.label})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not name it in assembled form either, in anything that is not a refusal test', () => {
    // Exclusion, not filtering (§4.4.5): a production module has no reason to hold a token in any
    // form, because there is no code path that handles it. Phase 3.2 asserted this for one module;
    // this generalizes it to every non-test artifact in the tier, `ops/**` included.
    const offenders: string[] = [];
    for (const artifact of ARTIFACTS) {
      if (artifact.isTest) continue;
      const joined = joinFragments(artifact.text);
      for (const token of EXCLUDED_TOKENS) {
        for (const line of hitsIn(joined, token.fragments)) {
          offenders.push(`${artifact.rel}:${line} (${token.label}, assembled)`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(ARTIFACTS.filter((artifact) => !artifact.isTest).length).toBeGreaterThan(0);
  });

  it('looks for the pointer shape as well as the name, since either one is a reference', () => {
    // Two of the three tokens are the upstream family-domain path rather than the classification
    // name: an artifact could point at the content without naming its class, and §4.4.3 binds
    // "points at" as tightly as "names". This asserts the pointer tokens are part of the scan rather
    // than declared and forgotten.
    const labels = EXCLUDED_TOKENS.map((token) => token.label);
    expect(labels).toContain('the upstream family-domain path');
    expect(labels).toContain('the upstream family-domain segment');
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// =============================================================================================
// §4.4.5 — the posture is exclusion, so the only test is that an attempt is refused
// =============================================================================================

describe('§4.4.5 the only artifacts that name it are the ones asserting its refusal', () => {
  const naming = ARTIFACTS.filter((artifact) => namesAnyToken(joinFragments(artifact.text)))
    .map((artifact) => artifact.rel)
    .sort();

  it('is exactly the enumerated refusal tests, in both directions', () => {
    // An unlisted file naming it is a new reference. A listed file that stopped naming it is a
    // refusal test that quietly went away, which is the failure mode this list exists to catch.
    expect(naming).toEqual([...REFUSAL_TESTS].sort());
  });

  it('are all tests, because a code path that handled it would not be exclusion', () => {
    for (const rel of REFUSAL_TESTS) {
      expect(rel.endsWith('.test.ts'), rel).toBe(true);
    }
  });

  it('exercise no carrying of it: each one asserts a refusal rather than a round trip', () => {
    // Mechanically: every file that names a token also speaks this repo's refusal vocabulary, so the
    // check is not a prose grep on a hopeful synonym.
    const refusalVocabulary = /(?:refuse[sd]?\b|refusal|not\.toContain|toEqual\(\[\]\)|tier_not_a_member)/;
    for (const rel of naming) {
      const artifact = ARTIFACTS.find((candidate) => candidate.rel === rel)!;
      expect(refusalVocabulary.test(artifact.text), rel).toBe(true);
    }
    expect(naming.length).toBeGreaterThan(0);
  });
});
