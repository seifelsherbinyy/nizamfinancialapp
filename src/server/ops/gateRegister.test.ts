// @vitest-environment node
/**
 * NIZAM · The gate register is complete enough to stand the deployment up, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 9.3 (spec 06-two-agent-vps)
 * Owning requirements: R23 (every human gate carries its reason, its steps, its verification and
 *   its prerequisites, and none is attempted or claimed done), R24 (no deployment particular, and
 *   no verification line that prints a value), steering §2 and §7 (the BUILD/GATE split and gate
 *   discipline)
 * Depends on: ./gateRegister and the artifacts it reads from disk as text - ops/DEPLOYMENT_CONTROL.md
 *   and the six ops/env/*.env.example templates
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The register on disk produces no finding, and the two cross-reads are asserted to have
 * examined a NON-ZERO number of items - a checker that passes by not running is the failure mode
 * this file exists to rule out. The properties that carry the weight are asserted separately as
 * well: every gate present, G7 closed, every status blocked, every gate-attributed environment
 * entry named by a step of its own gate and answered by that gate's verification block.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real file, breaks one
 * property, and observes that code fire by name. The coverage test at the end fails if a code is
 * added without a row. A tamper that reports zero findings is a false pass, and a thrown error is
 * not a fired gate, so each mutation helper throws on a rotted anchor rather than silently matching
 * nothing.
 *
 * NOTHING HERE EXECUTES ANYTHING AND NOTHING HERE ATTEMPTS A GATE. No shell is invoked, no command
 * from the register is run, no host, record, bot, key, consent, webhook or keypair is touched, and
 * no `Status:` is written (steering §2 on writing versus running).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENTRY_SPECS, TRACKED_SUFFIX } from './envTemplates.ts';
import {
  ALL_GATES,
  BLOCKED_STATUS,
  CLOSED_STATUS_PREFIX,
  GATE_REGISTER_FINDING_CODES,
  OPEN_GATES,
  REQUIRED_GATE_SUBSECTIONS,
  auditGateRegister,
  auditGateRegisterFiles,
  gateAttributedEntries,
  makePathProbe,
  namesEntry,
  parseGateRegister,
  quotedPaths,
  type GateRegisterFindingCode,
} from './gateRegister.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OPS_DIR = `${REPO_ROOT}ops`;
const ENV_DIR = `${OPS_DIR}/env`;

/** Line endings are normalized so the mutation anchors below do not depend on the checkout's
 *  setting. The file entry point is exercised separately against the bytes on disk. */
const read = (path: string): string => readFileSync(path, 'utf8').split('\r\n').join('\n');

const REGISTER = read(`${OPS_DIR}/DEPLOYMENT_CONTROL.md`);

const ENV_TEMPLATES: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(ENV_DIR)
    .filter((name) => name.endsWith(TRACKED_SUFFIX))
    .map((name) => [name.slice(0, -TRACKED_SUFFIX.length), read(`${ENV_DIR}/${name}`)]),
);

const PROBE = makePathProbe(REPO_ROOT);

interface Overrides {
  readonly register?: (text: string) => string;
  readonly templates?: Readonly<Record<string, string>>;
}

function codesFor(overrides: Overrides = {}): readonly GateRegisterFindingCode[] {
  const register = overrides.register === undefined ? REGISTER : overrides.register(REGISTER);
  if (overrides.register !== undefined && register === REGISTER) {
    throw new Error('the mutation left the register unchanged, so the case would prove nothing');
  }
  return auditGateRegister({
    source: register,
    envTemplates: overrides.templates ?? ENV_TEMPLATES,
    probe: PROBE,
  }).findings.map((f) => f.code);
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

/** Exchange two anchors, so membership is unchanged and only the order moves. */
function reorder(first: string, second: string): (t: string) => string {
  return (t) => {
    for (const anchor of [first, second]) {
      if (!t.includes(anchor)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(anchor)}`);
    }
    const held = '\u0000HELD\u0000';
    return t.replace(first, () => held).replace(second, () => first).replace(held, () => second);
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of a shape the
// harness scanners forbid and never trips one of them by carrying its own test material.
const ABSENT_PATH = 'ops/' + 'sys' + 'temd' + '/nizam' + '.' + 'service';
const PERFORMED_CLAIM_SHAPE = 'G1 ' + 'has been' + ' ' + 'provisioned' + '.';
const VALUE_PRINTING_SHAPE = 'c' + 'at <PROXY_ENV_PATH>';
const TABBED_LINE = '\t' + 'one tabbed line';

/** Injected just above the summary, which keeps every gate section intact - so each of these cases
 *  breaks the one property it names and nothing else. */
const inject = (text: string): ((t: string) => string) => swap('## Summary', `${text}\n\n## Summary`);

interface NegativeCase {
  readonly code: GateRegisterFindingCode;
  readonly why: string;
  readonly overrides: Overrides;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  // --- fail-closed -----------------------------------------------------------------------------
  {
    code: 'REGISTER_OUTSIDE_SUBSET',
    why: 'a tab indents differently in two viewers, so it is indentation nobody can review',
    overrides: { register: inject(TABBED_LINE) },
  },
  {
    code: 'REGISTER_OUTSIDE_SUBSET',
    why: 'a document with no level-one heading is one a reader cannot identify',
    overrides: { register: swap('# NIZAM Deployment Control Record', 'NIZAM Deployment Control Record') },
  },
  {
    code: 'ENV_COMPANION_UNREADABLE',
    why: 'a template outside the supported subset cannot be read for its entries, and skipping it would let the gate cross-read pass by not running',
    overrides: { templates: { ...ENV_TEMPLATES, 'proxy.env': 'export LIFE_HOSTNAME=<LIFE_HOSTNAME>\n' } },
  },
  {
    code: 'ENV_COMPANION_UNREADABLE',
    why: 'no template at all means no entry can be attributed to a gate',
    overrides: { templates: {} },
  },
  {
    code: 'CROSS_READ_EMPTY',
    why: 'a cross-read that examined nothing must never be able to report success',
    overrides: { templates: {} },
  },

  // --- the gate set ----------------------------------------------------------------------------
  {
    code: 'GATE_MISSING',
    why: 'a gate that is absent is not a gate that was cleared, it is one a reader concludes was lost',
    overrides: { register: swap('## G8 - Backup keypair', '## G9 - Backup keypair') },
  },
  {
    code: 'GATE_UNEXPECTED',
    why: 'a gate nobody numbered is a gate nobody sequenced',
    overrides: { register: swap('## G8 - Backup keypair', '## G9 - Backup keypair') },
  },
  {
    code: 'GATE_SECTION_MISSING',
    why: 'a gate with no stated reason for needing a human reads as a step somebody forgot to automate',
    overrides: { register: swap('### Why a human is required', '### Background') },
  },
  {
    code: 'GATE_SECTION_MISSING',
    why: 'a gate that never says what it unblocks gives an operator no way to judge the cost of leaving it',
    overrides: { register: swap('### Unblocks', '### Consequences') },
  },
  {
    code: 'GATE_PREREQUISITE_UNRECORDED',
    why: 'an operator working top to bottom needs to know what must precede each gate, and "nothing" has to be written down',
    overrides: {
      register: swap(
        '| **G1** provision + harden the host | creates the trust root of the deployment | - |',
        '| **G1** provision + harden the host | creates the trust root of the deployment |  |',
      ),
    },
  },
  {
    code: 'G7_NOT_CLOSED',
    why: 'reopening a decision the owner closed is the one thing the G7 section exists to prevent',
    overrides: { register: swap(`**Status: ${CLOSED_STATUS_PREFIX} (owner decision, 2026-08-06)**`, `**Status: ${BLOCKED_STATUS}**`) },
  },
  {
    code: 'G7_NOT_CLOSED',
    why: 'without the line saying so, a later reader reads a closed decision as an open one',
    overrides: { register: swap('**not** to be raised again by any agent', '**not** currently a priority for any agent') },
  },

  // --- the status, and the failure mode the register calls the most damaging --------------------
  {
    code: 'GATE_STATUS_UNEXPECTED',
    why: 'blocked awaiting a human is the only status an agent may ever write, and anything else claims work nobody did',
    overrides: { register: swap(`**Status: ${BLOCKED_STATUS}**`, '**Status: SATISFIED**') },
  },
  {
    code: 'GATE_STATUS_UNEXPECTED',
    why: 'a determination recorded inside an open gate is blocked too, and a second status is where that quietly stops being true',
    overrides: {
      register: swap(
        `**Status: ${BLOCKED_STATUS}. One decision, made once, before the first real backup.**`,
        '**Status: RESOLVED. One decision, made once, before the first real backup.**',
      ),
    },
  },
  {
    code: 'GATE_DESCRIBED_AS_PERFORMED',
    why: 'gate discipline rule 5 makes claiming a gated item done the single most damaging thing possible in this document',
    overrides: { register: inject(PERFORMED_CLAIM_SHAPE) },
  },

  // --- the steps, and the verification that answers them ---------------------------------------
  {
    code: 'STEP_WITHOUT_VERIFICATION',
    why: 'a step whose outcome is not checked is a step assumed to have worked',
    overrides: { register: swap('### VERIFICATION', '### Checks') },
  },
  {
    code: 'ENTRY_STEP_MISSING',
    why: 'this is the check that would have caught the nine entries the first half of task 9.3 found unnamed, and there is no default for any of them',
    overrides: { register: swap('`LIFE_HOSTNAME=<LIFE_HOSTNAME>`', 'the life-site hostname') },
  },
  {
    code: 'ENTRY_STEP_NOT_VERIFIED',
    why: 'an entry placed but never checked is one discovered missing at the worst possible moment',
    overrides: { register: swap("grep -c '^LIFE_HOSTNAME=' <PROXY_ENV_PATH>", "grep -c '^ACME_CONTACT=' <PROXY_ENV_PATH>") },
  },
  {
    code: 'VERIFICATION_PRINTS_A_VALUE',
    why: 'the register\u2019s own rule is to record the observation and never the value, and a grep without a counting flag prints the assignment',
    overrides: { register: swap("grep -c '^LIFE_HOSTNAME=' <PROXY_ENV_PATH>", "grep '^LIFE_HOSTNAME=' <PROXY_ENV_PATH>") },
  },
  {
    code: 'VERIFICATION_PRINTS_A_VALUE',
    why: 'a whole-file print of an environment file prints every secret in it at once',
    overrides: { register: swap("grep -c '^LIFE_HOSTNAME=' <PROXY_ENV_PATH>", VALUE_PRINTING_SHAPE) },
  },

  // --- what the register quotes ----------------------------------------------------------------
  {
    code: 'QUOTED_PATH_MISSING',
    why: 'this is the check that would have caught the unit-file directory reference at authoring time rather than at review',
    overrides: { register: swap('`ops/BUS_NETWORK_BINDING.md`', `\`${ABSENT_PATH}\``) },
  },

  // --- the reading order -----------------------------------------------------------------------
  {
    code: 'ORDERING_NOT_STATED',
    why: 'an unstated order is one each reader invents, and the sequence is what makes eight gates workable',
    overrides: { register: swapAll('### Ordering', '### Sequence') },
  },
  {
    code: 'ORDERING_NOT_STATED',
    why: 'a gate left out of the stated order is one an operator sequences by guessing',
    overrides: { register: swapAll('G5', 'the storage gate') },
  },
  {
    code: 'NEXT_ACTION_NOT_FIRST_GATE',
    why: 'four gates end by writing a secret into a directory only G1 creates, so anything else first produces secrets with nowhere to live',
    overrides: { register: swap('**Start at G1.**', '**Start wherever is convenient.**') },
  },
  {
    code: 'NEXT_ACTION_NOT_FIRST_GATE',
    why: 'a register that lists eight gates and names no starting point is a list rather than a plan',
    overrides: { register: swap('## SINGLE NEXT HUMAN ACTION', '## Where to begin, roughly') },
  },

  // --- the two places an outcome is recorded back ----------------------------------------------
  {
    code: 'WAL_DETERMINATION_RECORD_MISSING',
    why: 'a decision with nowhere to land is one that gets made twice, differently',
    overrides: { register: swap('**Record here when decided:**', '**Worth noting once decided:**') },
  },
  {
    code: 'WAL_DETERMINATION_RECORD_MISSING',
    why: 'without the determination, every rollback across a migration is blocked on a human nobody told',
    overrides: {
      register: swap('### The write-ahead-log sidecar determination, at the first-backup step', '### A note on the snapshot step'),
    },
  },
  {
    code: 'PROVISIONAL_REGISTRY_RECORD_MISSING',
    why: 'an unrecorded provisional registry is one a later reader reads as measured, and a provisional registry may never promote a model',
    overrides: {
      register: swap('### Recorded observation - registry is PROVISIONAL as of', '### Recorded observation - the eligibility document as of'),
    },
  },
];

describe('the gate register on disk is the shape task 9.3 requires', () => {
  it('parses, and carries a section for every gate', () => {
    const doc = parseGateRegister(REGISTER);
    const named = doc.sections
      .map((section) => /^~?~?(G\d+)/.exec(section.title)?.[1])
      .filter((gate): gate is string => gate !== undefined);
    expect([...new Set(named)].sort()).toEqual([...ALL_GATES].sort());
  });

  it('produces no finding at all, and both cross-reads examined something', () => {
    const report = auditGateRegister({ source: REGISTER, envTemplates: ENV_TEMPLATES, probe: PROBE });
    expect(report.findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
    expect(report.gateAttributedEntriesExamined).toBeGreaterThan(0);
    expect(report.quotedPathsExamined).toBeGreaterThan(0);
  });

  it('the file entry point agrees with the text entry point on the real artifacts', () => {
    const report = auditGateRegisterFiles(OPS_DIR, REPO_ROOT);
    expect(report.findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
    expect(report.gateAttributedEntriesExamined).toBeGreaterThan(0);
    expect(report.quotedPathsExamined).toBeGreaterThan(0);
  });

  it('records every open gate as blocked awaiting a human, and G7 as closed', () => {
    const doc = parseGateRegister(REGISTER);
    for (const gate of OPEN_GATES) {
      const section = doc.sections.find((candidate) => candidate.title.startsWith(`${gate} `));
      expect(section?.statuses[0], gate).toBe(BLOCKED_STATUS);
    }
    const closed = doc.sections.find((candidate) => candidate.title.includes('G7'));
    expect(closed?.statuses[0] ?? '').toContain(CLOSED_STATUS_PREFIX);
  });

  it('gives every open gate all four of the things a gate is', () => {
    const doc = parseGateRegister(REGISTER);
    for (const gate of OPEN_GATES) {
      const section = doc.sections.find((candidate) => candidate.title.startsWith(`${gate} `));
      for (const required of REQUIRED_GATE_SUBSECTIONS) {
        expect(section?.subsections.some((sub) => required.title.test(sub.title)), `${gate} ${required.key}`).toBe(true);
      }
    }
  });

  it('names every gate-attributed environment entry in a step of its own gate, and verifies each', () => {
    const { entries, unparseable } = gateAttributedEntries(ENV_TEMPLATES);
    expect(unparseable).toEqual([]);
    expect(entries.length).toBeGreaterThan(0);
    const doc = parseGateRegister(REGISTER);
    for (const owned of entries) {
      const section = doc.sections.find((candidate) => candidate.title.startsWith(`${owned.gate} `));
      const steps = section?.subsections.find((sub) => /^Steps\b/i.test(sub.title));
      const verify = section?.subsections.find((sub) => /^VERIFICATION\b/.test(sub.title));
      expect(namesEntry(steps?.prose ?? '', owned.entry), `${owned.gate} step names ${owned.entry}`).toBe(true);
      expect(namesEntry(verify?.prose ?? '', owned.entry), `${owned.gate} verifies ${owned.entry}`).toBe(true);
    }
  });

  it('quotes only repository paths that exist, and quotes a useful number of them', () => {
    const paths = quotedPaths(parseGateRegister(REGISTER));
    expect(paths.length).toBeGreaterThan(5);
    expect(paths.filter((path) => !PROBE(path))).toEqual([]);
  });

  it('distinguishes an entry name from the placeholder that shares its spelling', () => {
    expect(namesEntry('LIFE_HOSTNAME=<LIFE_HOSTNAME>', 'LIFE_HOSTNAME')).toBe(true);
    expect(namesEntry('the record for <LIFE_HOSTNAME>', 'LIFE_HOSTNAME')).toBe(false);
  });

  it('attributes an entry to a gate only through the one environment vocabulary', () => {
    const { entries } = gateAttributedEntries(ENV_TEMPLATES);
    for (const owned of entries) {
      expect(ENTRY_SPECS[owned.entry]?.gate, owned.entry).toBe(owned.gate);
    }
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c, index) => [`${c.code} #${index}`, c.why, c] as const))('%s fires when %s', (_label, _why, testCase) => {
    const codes = codesFor(testCase.overrides);
    expect(codes.length, 'a tamper that reports no finding at all is a false pass').toBeGreaterThan(0);
    expect(codes).toContain(testCase.code);
  });

  it('an unreadable register is a finding, never a skip', () => {
    const codes = auditGateRegister({
      source: null,
      unreadable: 'the register could not be read',
      envTemplates: ENV_TEMPLATES,
      probe: PROBE,
    }).findings.map((f) => f.code);
    expect(codes).toContain('REGISTER_UNREADABLE');
  });

  it('an absent register on disk is a finding, and the file entry point reports it', () => {
    const report = auditGateRegisterFiles(`${OPS_DIR}/does-not-exist`, REPO_ROOT);
    expect(report.findings.map((f) => f.code)).toContain('REGISTER_UNREADABLE');
    expect(report.quotedPathsExamined).toBe(0);
  });

  it('a quoted path that does not exist is a finding, not a skip', () => {
    const findings = auditGateRegister({
      source: REGISTER,
      envTemplates: ENV_TEMPLATES,
      probe: (path) => path !== 'ops/Caddyfile' && PROBE(path),
    }).findings;
    expect(findings.map((f) => f.code)).toContain('QUOTED_PATH_MISSING');
    expect(findings.some((f) => f.detail.includes('ops/Caddyfile'))).toBe(true);
  });

  it('a mutation helper throws rather than matching nothing, so a rotted anchor cannot pass quietly', () => {
    expect(() => swap('an anchor that was never in this document', 'x')(REGISTER)).toThrow(/anchor no longer present/);
    expect(() => swapAll('an anchor that was never in this document', 'x')(REGISTER)).toThrow(/anchor no longer present/);
    expect(() => reorder('## Summary', 'an anchor that was never in this document')(REGISTER)).toThrow(/anchor no longer present/);
  });

  it('a tamper that changes nothing is refused, so no case can pass by not mutating', () => {
    expect(() => codesFor({ register: (t) => t })).toThrow(/unchanged/);
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([...NEGATIVE_CASES.map((c) => c.code), 'REGISTER_UNREADABLE']);
    const uncovered = GATE_REGISTER_FINDING_CODES.filter((code) => !covered.has(code));
    expect(uncovered).toEqual([]);
  });
});
