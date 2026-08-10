// @vitest-environment node
/**
 * NIZAM · The cross-repo series says what it is, claims nothing it cannot, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 8.1-8.4 (spec 06-two-agent-vps)
 * Owning requirements: R23 (applying these files is a human step in a repository this session may
 *   not touch, so it is named and never attempted), R24 (no deployment particular), and the
 *   properties the series must still assert about the other repository: R11/R12 (the transport
 *   guards survive the swap), R13/R14 (dedup keyed on the pair), R10 (the classification whose
 *   egress set is empty stays empty)
 * Depends on: ./patchSeries and the four files it reads - ops/nizamcore-patches/001, 002, 003 and
 *   the README - all read from disk as text
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The four artifacts on disk produce no finding, and the properties that carry the weight
 * are asserted separately as well: the apply order the README states is the file numbering, every
 * specification declares its form and its provenance, every declared dotted token is actually used
 * by an artifact (an allowlist with a stale entry is an allowlist nobody is reading), and no
 * artifact carries a fabricated content address.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real file, breaks one
 * property, and observes that code fire. A checker that has only ever been observed passing is not
 * evidence that it checks. The coverage test at the end fails if a code is added without a row.
 *
 * NOTHING HERE EXECUTES ANYTHING, NOTHING HERE APPLIES ANYTHING, AND NOTHING HERE READS THE OTHER
 * REPOSITORY. No shell is invoked, no repository is cloned or fetched, no diff is applied, and no
 * network call is made (steering section 6, and steering section 2 on writing versus running).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DECLARED_DOTTED_TOKENS,
  FAMILY_CLASSIFICATION_PLACEHOLDER,
  PATCH_FILES,
  PATCH_FINDING_CODES,
  PATCH_IDS,
  README_FILE,
  README_REQUIRED_SECTIONS,
  REQUIRED_HEADER_FIELDS,
  REQUIRED_SECTIONS,
  STATED_BASELINE_TESTS,
  TARGET_BRANCH,
  TARGET_REPOSITORY,
  auditPatchSeries,
  auditPatchSeriesFiles,
  dottedTokensIn,
  mapParticularFindings,
  maskDeclaredTokens,
  parseReadme,
  parseSpecification,
  statedApplyOrder,
  type PatchFindingCode,
} from './patchSeries.ts';

const SERIES_DIR = fileURLToPath(new URL('../../../ops/nizamcore-patches/', import.meta.url));

/** Line endings are normalized so the mutation anchors below do not depend on the checkout's
 *  setting. The file entry point is exercised separately against the bytes on disk. */
const read = (file: string): string => readFileSync(SERIES_DIR + file, 'utf8').split('\r\n').join('\n');

const SOURCES: Readonly<Record<string, string>> = {
  '001': read(PATCH_FILES['001']),
  '002': read(PATCH_FILES['002']),
  '003': read(PATCH_FILES['003']),
};
const README = read(README_FILE);

interface Overrides {
  readonly [artifact: string]: (text: string) => string;
}

function codesFor(overrides: Overrides = {}): readonly PatchFindingCode[] {
  const sources: Record<string, string> = {};
  let changed = false;
  for (const id of PATCH_IDS) {
    const original = SOURCES[id] ?? '';
    const mutate = overrides[id];
    const next = mutate === undefined ? original : mutate(original);
    if (next !== original) changed = true;
    sources[id] = next;
  }
  const mutateReadme = overrides[README_FILE];
  const readme = mutateReadme === undefined ? README : mutateReadme(README);
  if (readme !== README) changed = true;
  if (Object.keys(overrides).length > 0 && !changed) {
    throw new Error('the mutation left every artifact unchanged, so the case would prove nothing');
  }
  return auditPatchSeries({ sources, readme }).map((f) => f.code);
}

/** A mutation that must actually change the text, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    return t.replace(from, () => to);
  };
}

/** The same, for a token that appears more than once and must be gone from all of them. */
function swapAll(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    return t.split(from).join(to);
  };
}

/** Exchange two headings, so membership is unchanged and only the order moves. */
function reorder(first: string, second: string): (t: string) => string {
  return (t) => {
    for (const anchor of [first, second]) {
      if (!t.includes(anchor)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(anchor)}`);
    }
    const held = '\u0000HELD\u0000';
    return t.replace(first, () => held).replace(second, () => first).replace(held, () => second);
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan
// forbids and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'series.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';
const INDEX_SHAPED = 'index ' + '1a2b3c4' + '..' + '5d6e7f8' + ' 100644';
const UNDECLARED_TOKEN = 'module' + '.' + 'attribute';

/** Injected at the head of section three of 001, which keeps the header block and the section
 *  order intact - so each of these cases breaks the one property it names and nothing else. */
const inject = (text: string): ((t: string) => string) => swap('--- 3.1 NEW FILE', `${text}\n\n--- 3.1 NEW FILE`);

/** Strip the numbering off every indented numbered item, so section four has nothing to count. */
const denumber = (t: string): string => t.replace(/^ {2,}\d+\. /gm, '  - ');

interface NegativeCase {
  readonly code: PatchFindingCode;
  readonly why: string;
  readonly overrides: Overrides;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  // --- fail-closed, shared ---------------------------------------------------------------------
  {
    code: 'ARTIFACT_OUTSIDE_SUBSET',
    why: 'a tab indents differently in two viewers, so it is indentation nobody can review',
    overrides: { '001': swap('== 2. WHAT MUST NOT CHANGE ==', '== 2. WHAT MUST NOT CHANGE ==\n\n\tone tabbed line') },
  },
  {
    code: 'ARTIFACT_OUTSIDE_SUBSET',
    why: 'a line in the header block that is neither a label nor a continuation reads as a field and is not one',
    overrides: { '002': swap('TARGET BRANCH     main', 'TARGET BRANCH     main\nStray header note') },
  },
  {
    code: 'HEADER_FIELD_MISSING',
    why: 'a label with nothing after it reads as answered and is not',
    overrides: { '001': swap('TARGET BRANCH     main', 'TARGET BRANCH     ') },
  },
  {
    code: 'EXECUTION_NOTICE_MISSING',
    why: 'steering section 2 permits writing these files and forbids running them, and the notice is where a reader learns which',
    overrides: { [README_FILE]: swap('NOTHING HERE IS EXECUTED BY AN AGENT', 'nothing here is executed by an agent') },
  },
  {
    code: 'SECTION_MISSING',
    why: 'a required section retitled is a section that is gone, whatever still sits under the heading',
    overrides: { '001': swap('== 2. WHAT MUST NOT CHANGE ==', '== 2. WHAT SHOULD NOT CHANGE ==') },
  },
  {
    code: 'SECTION_UNEXPECTED',
    why: 'a reviewer reads one shape three times, and an extra section is a shape nobody checked',
    overrides: { '003': (t) => `${t}\n== 6. EXTRA NOTES FOR THE OPERATOR ==\n\nsomething nobody audited\n` },
  },
  {
    code: 'SECTION_ORDER_UNEXPECTED',
    why: 'the order is the argument: why this is not a diff, what must not change, the change, what to check, what the suite should do',
    overrides: { '001': reorder('WHAT A HUMAN MUST VERIFY AFTER APPLYING', 'EXPECTED TEST DELTA') },
  },
  {
    code: 'SECTION_NUMBERING_UNEXPECTED',
    why: 'the sections are cross-referenced by number from the README and from each other',
    overrides: { '002': swap('== 3. THE CHANGE, IN FULL ==', '== 4. THE CHANGE, IN FULL ==') },
  },
  {
    code: 'TARGET_FILE_NOT_IN_BODY',
    why: 'a declared target nobody explains below the header is a file somebody edits by guessing',
    overrides: { '001': swap('NIZAM__system/relay/asgi_app.py            (new file)', 'NIZAM__system/relay/asgi_main.py            (new file)') },
  },
  {
    code: 'ENV_ASSIGNMENT_WITH_VALUE',
    why: 'a specification may name an environment entry so the operator knows which one; assigning it a value is how a value lands in a tracked file',
    overrides: { '001': inject('NIZAM_WEBHOOK_SECRET=the-operator-pasted-it-here') },
  },

  // --- the honesty set ------------------------------------------------------------------------
  {
    code: 'FORM_NOT_DECLARED',
    why: 'a reader who thinks this is a diff will try to apply it, and the failure will look like a broken file rather than a mislabelled one',
    overrides: { '001': swap('FORM              CHANGE SPECIFICATION.', 'FORM              PATCH.') },
  },
  {
    code: 'TARGET_REPOSITORY_UNEXPECTED',
    why: 'a file applied to the wrong repository is worse than one nobody applied',
    overrides: { '002': swap(`TARGET REPOSITORY ${TARGET_REPOSITORY}`, 'TARGET REPOSITORY nizamfinancialapp') },
  },
  {
    code: 'TARGET_BRANCH_UNEXPECTED',
    why: 'the two repositories deliberately differ on their default branch, so the wrong one is a plausible mistake',
    overrides: { '003': swap(`TARGET BRANCH     ${TARGET_BRANCH}`, 'TARGET BRANCH     master') },
  },
  {
    code: 'AUTHORSHIP_CAVEAT_MISSING',
    why: 'the whole weight of the series rests on it having been written without a checkout, and that belongs where a reviewer reads first',
    overrides: { '001': swap('That session never\n                  cloned', 'That session rarely\n                  cloned') },
  },
  {
    code: 'PROVENANCE_MISSING',
    why: 'a statement about another repository is only as good as the document it came from',
    overrides: { '001': swap('NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md in the finance repository,', 'the architecture note in the finance repository,') },
  },
  {
    code: 'NON_APPLICABILITY_CAVEAT_MISSING',
    why: 'without it, absent context reads as an oversight instead of as a boundary that was respected',
    overrides: { '001': swap('there are no verified context', 'there are barely any verified context') },
  },
  {
    code: 'FABRICATED_INDEX_LINE',
    why: 'a blob hash is a content address computable only from bytes this session never read, so its presence means it was invented',
    overrides: { '001': inject(INDEX_SHAPED) },
  },
  {
    code: 'FABRICATED_INDEX_LINE',
    why: 'the same is true of the README, which is where a reader would most readily believe it',
    overrides: { [README_FILE]: swap('## What must never happen', `${INDEX_SHAPED}\n\n## What must never happen`) },
  },
  {
    code: 'APPLICABILITY_CLAIMED',
    why: 'nobody here applied this or ran the target suite, so an unqualified claim of applicability is the one thing these files must never say',
    overrides: { '001': inject('This series applies cleanly to the target.') },
  },
  {
    code: 'HUMAN_VERIFICATION_THIN',
    why: 'a specification written without a checkout has more than two things a human must check, and a short list reads as confidence nobody earned',
    overrides: { '001': denumber },
  },
  {
    code: 'TEST_DELTA_BASELINE_MISSING',
    why: 'an unlabelled baseline is a number a reader will treat as measured',
    overrides: { '001': swap('That figure was READ FROM THAT NOTE, not observed by this session.', 'That figure is the baseline.') },
  },
  {
    code: 'TEST_DELTA_NAMES_MISSING',
    why: 'a delta stated as a count only cannot be checked against what was actually added',
    overrides: { '001': swapAll('    test_', '    check_') },
  },

  // --- 001, the transport wrapper -------------------------------------------------------------
  {
    code: 'WRAPPER_HANDLER_REWRITTEN',
    why: 'the proven part of the relay is the part that decides, and a wrapper that reimplements it is not a wrapper',
    overrides: { '001': swap('handle_update is not rewritten', 'handle_update is generally preserved') },
  },
  {
    code: 'WRAPPER_GUARD_NOT_PRESERVED',
    why: 'a transport swap that reaches the handler with the token comparison gone is a regression that presents as an open door',
    overrides: { '001': swapAll('constant-time', 'quick') },
  },
  {
    code: 'WRAPPER_GUARD_NOT_PRESERVED',
    why: 'the same for the allowlist: a correct token is not authorization',
    overrides: { '001': swapAll('allowlist', 'permitted list') },
  },
  {
    code: 'HEALTH_ENDPOINT_MISSING',
    why: 'task 8.1 asks for the endpoint by name, and the orchestrator has nothing to probe without it',
    overrides: { '001': swapAll('/healthz', '/ready') },
  },
  {
    code: 'READINESS_NOT_LIVENESS_MISSING',
    why: 'a liveness probe suppresses the one automatic remedy the deployment has, most confidently at the worst moment',
    overrides: { '001': swap('Readiness, not liveness', 'Health check') },
  },
  {
    code: 'FALLBACK_REMOVED',
    why: 'deleting the long-poll path removes the fallback exactly when it becomes the only way in',
    overrides: { '001': swap('poller.py stays exactly as it is', 'poller.py can be retired once this lands') },
  },

  // --- 002, dedup per bot ---------------------------------------------------------------------
  {
    code: 'DEDUP_KEY_NOT_A_PAIR',
    why: 'the pair IS the change; stated any other way it reads as a refinement rather than the correctness fix it is',
    overrides: { '002': swapAll('(bot_id, update_id)', 'the composite key') },
  },
  {
    code: 'DEDUP_DURABILITY_LOST',
    why: 'the existing module survives a crash because the write is a rename, and a rewrite that writes in place trades that away for nothing',
    overrides: { '002': swapAll('os.replace', 'a truncating write') },
  },
  {
    code: 'DEDUP_DUPLICATE_IS_AN_ERROR',
    why: 'raising on a duplicate earns another retry of the update just declined, so the guard manufactures the load it exists to shed',
    overrides: { '002': swap('A DUPLICATE STAYS A SUCCESS, NOT AN ERROR', 'A DUPLICATE IS HANDLED') },
  },
  {
    code: 'DEDUP_RING_NOT_BOUNDED_PER_BOT',
    why: 'one shared bound lets a chatty bot evict the quiet bot\u2019s window, re-opening the replay gap for the quiet one',
    overrides: { '002': (t) => t.replace(/bound is per bot/gi, 'bound is shared') },
  },
  {
    code: 'DEDUP_COLLISION_TEST_MISSING',
    why: 'the collision is latent until a second bot exists, so the only thing keeping the fix honest is a test that fails without it',
    overrides: { '002': swapAll('test_two_bots_emitting_the_same_identifier_are_both_processed', 'test_collision') },
  },

  // --- 003, the egress target -----------------------------------------------------------------
  {
    code: 'EGRESS_TARGET_MISSING',
    why: 'task 8.3 adds exactly one target, and a specification that never names it specifies nothing',
    overrides: { '003': swapAll('signalbus', 'the bus') },
  },
  {
    code: 'EGRESS_TIER_SCOPE_WRONG',
    why: 'the bus is eligible for the two narrow tiers only; content in an existing tier reaches it by being reduced first, never by permission',
    overrides: { '003': swapAll('and for nothing else', 'and for a few others') },
  },
  {
    code: 'FAMILY_TIER_EMPTINESS_NOT_STATED',
    why: 'this is the invariant the change is most likely to break quietly, so it is stated as a requirement rather than assumed',
    overrides: { '003': swap('THE FAMILY CLASSIFICATION KEEPS AN EMPTY EGRESS SET', 'the family tier keeps an empty egress set') },
  },
  {
    code: 'FAMILY_TIER_EMPTINESS_NOT_STATED',
    why: 'the placeholder is how the row is named without naming the content, so a specification that drops it has either lost the assertion or written the key down',
    overrides: { '003': swapAll(FAMILY_CLASSIFICATION_PLACEHOLDER, '<THE_FAMILY_ROW>') },
  },
  {
    code: 'FAMILY_TIER_WIDENED',
    why: 'the content is excluded from the deployment rather than filtered on the way out, and an assignment to that row is the widening',
    overrides: {
      '003': swap(
        `assert EGRESS_MATRIX["${FAMILY_CLASSIFICATION_PLACEHOLDER}"] == set()`,
        `EGRESS_MATRIX["${FAMILY_CLASSIFICATION_PLACEHOLDER}"] = {"signalbus"}`,
      ),
    },
  },
  {
    code: 'FAMILY_TIER_WIDENED',
    why: 'the same widening spelled in the policy document instead of in the module',
    overrides: {
      '003': swap('  "money_safe": {', `  "${FAMILY_CLASSIFICATION_PLACEHOLDER}": { "egress": ["signalbus"] },\n  "money_safe": {`),
    },
  },
  {
    code: 'FAMILY_TIER_WIDENED',
    why: 'and the same again in the prose form the specification uses to restate the row',
    overrides: {
      '003': swap(`${FAMILY_CLASSIFICATION_PLACEHOLDER}   egress: [ ]`, `${FAMILY_CLASSIFICATION_PLACEHOLDER}   egress: [ signalbus ]`),
    },
  },
  {
    code: 'ENVELOPE_SHAPE_UNREFERENCED',
    why: 'a reviewer approving a new egress target needs to see what can travel through it',
    overrides: { '003': swapAll('consent_scope', 'scope') },
  },

  // --- the README -----------------------------------------------------------------------------
  {
    code: 'README_SECTION_MISSING',
    why: 'a required section demoted below the heading level the audit reads is a section that is gone',
    overrides: { [README_FILE]: swap('## What must never happen', '### What must never happen') },
  },
  {
    code: 'README_SECTION_UNEXPECTED',
    why: 'a section this audit does not know about is a section nobody checked',
    overrides: { [README_FILE]: (t) => `${t}\n## Extra appendix\n\nsomething nobody audited\n` },
  },
  {
    code: 'README_SECTION_ORDER_UNEXPECTED',
    why: 'what the files are precedes how to apply them, and what must never happen closes',
    overrides: { [README_FILE]: reorder('## Where this is applied', '## What must never happen') },
  },
  {
    code: 'README_PATCH_UNLISTED',
    why: 'a series member the README does not list is one nobody applies',
    overrides: { [README_FILE]: swapAll(PATCH_FILES['003'], '003-egress.patch') },
  },
  {
    code: 'README_ORDER_MISMATCH',
    why: 'the README\u2019s own claim is that the numbering IS the order, so a stated order that disagrees makes the claim false',
    overrides: { [README_FILE]: swap('**001, then 002, then 003.**', '**003, then 002, then 001.**') },
  },
  {
    code: 'README_ORDER_RATIONALE_MISSING',
    why: 'an order with no argument behind it is one somebody reorders to get a green suite faster',
    overrides: { [README_FILE]: swap('**001 first, because it is purely additive.**', '**001 first, and it is purely additive.**') },
  },
  {
    code: 'README_VERIFY_COMMAND_MISSING',
    why: 'a command with no stated verification is a command whose outcome is assumed',
    overrides: { [README_FILE]: swapAll('**Verify:**', '**Notes:**') },
  },
  {
    code: 'README_TEST_DELTA_MISSING',
    why: 'a change with no expected delta gives a human no way to tell an expected failure from a surprise',
    overrides: { [README_FILE]: swap('| 001 |', '| the first |') },
  },
  {
    code: 'README_BASELINE_MISSING',
    why: 'every delta in the table is measured against the baseline, so an unlabelled one makes three predictions look like three results',
    overrides: { [README_FILE]: swap('**This session did not observe it**', '**This session confirmed it**') },
  },
  {
    code: 'README_SEPARATE_SESSION_MISSING',
    why: 'that boundary is the reason the series is text instead of commits',
    overrides: { [README_FILE]: swap('a **separate\nKiro session opened on the other repository**', 'a **second\nsitting on the other repository**') },
  },

  // --- R24, re-reported from the ONE shared scan ------------------------------------------------
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    overrides: { '001': inject(URL_SHAPED) },
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host, in any notation',
    overrides: { '001': inject(ADDRESS_SHAPED) },
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'R24 - write a placeholder, never a name; and the enumerated token list is what keeps this rule alive over quoted source',
    overrides: { '001': inject(HOSTNAME_SHAPED) },
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    overrides: { '001': inject(LONG_DIGIT_RUN) },
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, not even in an aside',
    overrides: { '001': inject(CURRENCY_SHAPED) },
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is recognized by neither the operator nor the glossary',
    overrides: { '001': inject('<workDir>') },
  },
  {
    code: 'DOTTED_TOKEN_UNDECLARED',
    why: 'a dotted token nobody enumerated is either a hostname or an attribute access nobody reviewed, and the checker cannot tell which',
    overrides: { '001': inject(UNDECLARED_TOKEN) },
  },
];

describe('the four artifacts on disk are the shape Phase 8 requires', () => {
  it('all three specifications parse, with exactly the required sections in order', () => {
    for (const id of PATCH_IDS) {
      const spec = parseSpecification(SOURCES[id] ?? '');
      expect(spec.sections.map((s) => s.title), `${id} sections`).toEqual([...REQUIRED_SECTIONS]);
      expect(spec.sections.map((s) => s.number), `${id} numbering`).toEqual([1, 2, 3, 4, 5]);
      for (const field of REQUIRED_HEADER_FIELDS) {
        expect((spec.header[field] ?? '').length, `${id} ${field}`).toBeGreaterThan(0);
      }
    }
  });

  it('the README parses with exactly the required sections in order', () => {
    expect(parseReadme(README).map((s) => s.title)).toEqual([...README_REQUIRED_SECTIONS]);
  });

  it('produces no finding at all', () => {
    const findings = auditPatchSeries({ sources: { ...SOURCES }, readme: README });
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('the file entry point agrees with the text entry point on the real artifacts', () => {
    expect(auditPatchSeriesFiles(SERIES_DIR)).toEqual([]);
  });

  it('states the apply order as the file numbering', () => {
    expect(statedApplyOrder(README)).toEqual([...PATCH_IDS]);
  });

  it('names the same target repository and branch in all three headers', () => {
    for (const id of PATCH_IDS) {
      const header = parseSpecification(SOURCES[id] ?? '').header;
      expect(header['TARGET REPOSITORY'], id).toBe(TARGET_REPOSITORY);
      expect(header['TARGET BRANCH'], id).toBe(TARGET_BRANCH);
    }
  });

  it('states the baseline it was told rather than one it measured', () => {
    for (const source of [...Object.values(SOURCES), README]) {
      expect(source).toContain(String(STATED_BASELINE_TESTS));
    }
  });

  it('every declared dotted token is actually used, so the allowlist cannot go stale or over-broad', () => {
    const everything = [...Object.values(SOURCES), README].join('\n');
    const unused = DECLARED_DOTTED_TOKENS.filter((token) => !everything.includes(token));
    expect(unused).toEqual([]);
  });

  it('names the family row through a placeholder, never by its key (contract 12 section 4.4.3, R10)', () => {
    // The key belongs to the target repository's policy document. An artifact of THIS tier that
    // wrote it down would be pointing at the content the exclusion posture keeps out of the
    // deployment entirely, which `src/server/signals/exclusion.test.ts` asserts across ops/** too.
    expect(SOURCES['003']).toContain(FAMILY_CLASSIFICATION_PLACEHOLDER);
    expect(README).toContain(FAMILY_CLASSIFICATION_PLACEHOLDER);
  });

  it('leaves no dotted token unaccounted for once the declared ones are masked', () => {
    for (const [where, source] of [...Object.entries(SOURCES), [README_FILE, README] as const]) {
      expect(dottedTokensIn(maskDeclaredTokens(source)), where).toEqual([]);
    }
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c, index) => [`${c.code} #${index}`, c.why, c] as const))('%s fires when %s', (_label, _why, testCase) => {
    expect(codesFor(testCase.overrides)).toContain(testCase.code);
  });

  it('a missing artifact is a finding, never a skip', () => {
    const findings = auditPatchSeriesFiles(`${SERIES_DIR}does-not-exist/`);
    expect(findings.filter((f) => f.code === 'ARTIFACT_UNREADABLE')).toHaveLength(PATCH_IDS.length + 1);
  });

  it('a gap in the series is a finding, because the numbering is the apply order', () => {
    const codes = auditPatchSeries({
      sources: { '001': SOURCES['001'] ?? '', '002': SOURCES['002'] ?? '' },
      readme: README,
    }).map((f) => f.code);
    expect(codes).toContain('SERIES_NUMBERING_UNEXPECTED');
    expect(codes).toContain('ARTIFACT_UNREADABLE');
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' }], '001');
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([
      ...NEGATIVE_CASES.map((c) => c.code),
      'ARTIFACT_UNREADABLE',
      'SERIES_NUMBERING_UNEXPECTED',
      'PARTICULAR_SCAN_UNMAPPED',
    ]);
    const uncovered = PATCH_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});
