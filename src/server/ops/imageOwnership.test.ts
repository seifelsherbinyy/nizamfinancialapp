// @vitest-environment node
/**
 * NIZAM · The image ownership record accounts for every reference, and the port posture agrees
 * Implemented by: PFOS Contract 12 / Phase 10.8 (spec 06-two-agent-vps)
 * Owning requirements: R28 (a Dockerfile for every image this repository owns, and a documented
 *   build path producing the exact tag the topology references), R30 (the firewall posture and the
 *   port bindings agree, and the certificate-challenge resolution is recorded), R22 (the readiness
 *   command an image declares exists inside it)
 * Depends on: ./imageOwnership, ./healthProbe (the readiness command name), ./caddyTemplate (the
 *   challenge-disabling directive name), and the real tree on disk read as text
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The real tree produces no finding, over counts asserted to be non-zero, and the two
 * properties task 10.8 turns on - which references this repository builds, and which challenge the
 * three artifacts agree on - are asserted separately so a reader sees the requirement and its
 * evidence in one place.
 *
 * NEGATIVE. Every finding code has a row that takes the real artifact, breaks one property, and
 * observes that code fire by name. A checker only ever observed passing is not evidence that it
 * checks. The coverage test at the end fails if a code is added without a row.
 *
 * The F12 cases are deliberately symmetric: the resolution actually chosen is asserted, AND the
 * rejected resolution is driven through the same checker to show it would have been held just as
 * tightly. A cross-artifact assertion that only holds for the choice its author made is not an
 * assertion about agreement.
 *
 * Nothing here builds an image, resolves a tag, or runs a command in any document (steering §2).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HTTP_CHALLENGE_DISABLE_DIRECTIVE } from './caddyTemplate';
import { PROBE_COMMAND_NAME } from './healthProbe';
import {
  ADMIN_PORT_PLACEHOLDER,
  CHALLENGE_NEEDING_CLEARTEXT_PORT,
  CHALLENGE_ON_TLS_PORT,
  IMAGE_OWNERSHIP_FINDING_CODES,
  IMAGE_REFERENCE_SHAPE,
  OWNERSHIP_STATES,
  auditImageOwnership,
  auditImageOwnershipFiles,
  auditPortPosture,
  auditPortPostureFiles,
  baseMatchesRuntimeMajor,
  documentsBuildPath,
  firewallAllowedPorts,
  RECIPE_FLAG,
  TAG_FLAG,
  imageReferencesOf,
  parseOwnershipRecord,
  parseRecipe,
  publishedHostPorts,
  recipesOnDisk,
  type ImageOwnershipFindingCode,
  type ImageOwnershipInput,
  type PortPostureInput,
  type RecipeInput,
} from './imageOwnership';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Line endings normalized so the mutation anchors do not depend on the checkout's setting. */
function textAt(relative: string): string {
  return readFileSync(join(REPO, relative), 'utf8').split('\r\n').join('\n');
}

const RECORD = textAt('ops/IMAGE_BUILD.md');
const COMPOSE = textAt('ops/docker-compose.yml');
const REGISTER = textAt('ops/GATE_REGISTER.md');
const PROXY_CONFIG = textAt('ops/Caddyfile');
const RECIPES: readonly RecipeInput[] = recipesOnDisk(REPO).map((r) => ({ path: r.path, text: (r.text ?? '').split('\r\n').join('\n') }));
const RUNTIME_MAJOR = textAt('.nvmrc').trim();

function baseInput(): ImageOwnershipInput {
  return {
    record: RECORD,
    compose: COMPOSE,
    runtimeMajor: RUNTIME_MAJOR,
    recipesOnDisk: RECIPES,
    probe: (relative) => existsSync(join(REPO, relative)),
  };
}

function basePosture(): PortPostureInput {
  return { register: REGISTER, compose: COMPOSE, proxyConfig: PROXY_CONFIG, record: RECORD };
}

/** A mutation that must actually change the text, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    const next = t.replace(from, () => to);
    if (next === t) throw new Error('the mutation left the text unchanged, so the case would prove nothing');
    return next;
  };
}

interface NegativeCase {
  readonly code: ImageOwnershipFindingCode;
  readonly why: string;
  readonly apply: (input: ImageOwnershipInput) => ImageOwnershipInput;
}

/** The recipe row this repository owns, used as the anchor for the row-shape cases. */
const OWNED_ROW = '| `<FINANCE_IMAGE_REF>` | `BUILT_HERE` | `ops/images/finance-agent/Dockerfile` | - |';
const EXTERNAL_ROW = '| `<LIFE_IMAGE_REF>` | `EXTERNAL` | - | - |';
const PENDING_ROW = '| `<BUS_IMAGE_REF>` | `OWNED_BUILD_PENDING` | - | finding `O2` |';

function withRecord(apply: (t: string) => string): (input: ImageOwnershipInput) => ImageOwnershipInput {
  return (input) => ({ ...input, record: apply(input.record ?? '') });
}
function withRecipe(apply: (t: string) => string): (input: ImageOwnershipInput) => ImageOwnershipInput {
  return (input) => ({
    ...input,
    recipesOnDisk: input.recipesOnDisk.map((r) => ({ path: r.path, text: apply(r.text ?? '') })),
  });
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  // --- the inputs themselves --------------------------------------------------------------------
  {
    code: 'RECORD_UNREADABLE',
    why: 'an unreadable record leaves every reference unaccounted for, which is a finding and never a skip',
    apply: (input) => ({ ...input, record: null }),
  },
  {
    code: 'COMPOSE_UNREADABLE',
    why: 'without the topology the set of references to account for is unknown, so the audit must not report success',
    apply: (input) => ({ ...input, compose: null }),
  },
  {
    code: 'RECIPE_UNREADABLE',
    why: 'a recipe that will not read had none of the properties R28 asks of it checked',
    apply: (input) => ({ ...input, recipesOnDisk: input.recipesOnDisk.map((r) => ({ path: r.path, text: null })) }),
  },
  {
    code: 'RECORD_TABLE_MISSING',
    why: 'a record that parses to no row accounts for nothing and must never read as a record in which all is well',
    apply: withRecord((t) => t.replace(/^\|.*$/gm, 'removed')),
  },
  {
    code: 'CROSS_READ_EMPTY',
    why: 'at zero on either side every assertion in this module would hold vacuously',
    apply: (input) => ({ ...input, record: '# nothing', compose: null }),
  },
  // --- the record against the topology, in both directions --------------------------------------
  {
    code: 'IMAGE_REFERENCE_UNRECORDED',
    why: 'finding O1 exactly: the topology names an image and nothing says whether this repository builds it',
    apply: withRecord(swap(OWNED_ROW, '| `<UNRELATED_IMAGE_REF>` | `EXTERNAL` | - | - |')),
  },
  {
    code: 'RECORDED_REFERENCE_UNKNOWN',
    why: 'a row for an image nothing runs is a row nobody maintains',
    apply: withRecord(swap(EXTERNAL_ROW, `${EXTERNAL_ROW}\n| \`<GHOST_IMAGE_REF>\` | \`EXTERNAL\` | - | - | it does not exist |`)),
  },
  {
    code: 'RECORD_ROW_DUPLICATED',
    why: 'two rows for one reference leave which one governs it a guess',
    apply: withRecord(swap(EXTERNAL_ROW, `${EXTERNAL_ROW} second |\n${EXTERNAL_ROW}`)),
  },
  // --- each row's own shape ---------------------------------------------------------------------
  {
    code: 'OWNERSHIP_STATE_UNDECLARED',
    why: 'a fourth state invented in a table cell is a policy no checker holds',
    apply: withRecord(swap('| `EXTERNAL` | - | - |', '| `SOMEBODY_ELSES_PROBLEM` | - | - |')),
  },
  {
    code: 'ROW_REASON_MISSING',
    why: 'an unexplained state is one the next reader changes',
    apply: withRecord(swap(PENDING_ROW, `${PENDING_ROW}   .   |\n| \`<PLACEHOLDER_IMAGE_REF>\` | \`EXTERNAL\` | - | - |`)),
  },
  {
    code: 'ROW_NAMES_RECIPE_IT_MAY_NOT',
    why: 'a row that disclaims the image and names a recipe for it claims and disclaims it at once',
    apply: withRecord(swap(EXTERNAL_ROW, '| `<LIFE_IMAGE_REF>` | `EXTERNAL` | `ops/images/life-agent/Dockerfile` | - |')),
  },
  {
    code: 'ROW_NAMES_NO_RECIPE',
    why: 'a row that claims the build and names no recipe leaves R28 unmet for that image',
    apply: withRecord(swap('| `BUILT_HERE` | `ops/images/finance-agent/Dockerfile` |', '| `BUILT_HERE` | - |')),
  },
  {
    code: 'ROW_NAMES_NO_BLOCKER',
    why: 'a pending build with no owner is a hope, and this state is only stronger than silence while it carries one',
    apply: withRecord(swap('| `OWNED_BUILD_PENDING` | - | finding `O2` |', '| `OWNED_BUILD_PENDING` | - | - |')),
  },
  {
    code: 'ROW_NAMES_BLOCKER_IT_MAY_NOT',
    why: 'a settled row that also names a blocker reads as both settled and waiting',
    apply: withRecord(swap(EXTERNAL_ROW, '| `<LIFE_IMAGE_REF>` | `EXTERNAL` | - | `task 99.9` |')),
  },
  // --- the record against the recipes on disk, in both directions --------------------------------
  {
    code: 'RECIPE_ABSENT',
    why: 'a record that points a reader at a file that is not there is one they stop trusting',
    apply: withRecord(swap('`ops/images/finance-agent/Dockerfile`', '`ops/images/finance-agent/Dockerfile.absent`')),
  },
  {
    code: 'RECIPE_UNCLAIMED',
    why: 'an unclaimed recipe builds an image nothing runs, or runs an image nothing records',
    apply: (input) => ({
      ...input,
      recipesOnDisk: [...input.recipesOnDisk, { path: 'ops/images/orphan/Dockerfile', text: 'FROM node:0\nUSER node\nENTRYPOINT ["node"]\n' }],
    }),
  },
  {
    code: 'BUILD_PATH_UNDOCUMENTED',
    why: 'R28 asks for a path producing the exact tag, and one value resolved once is what keeps the build and the topology from disagreeing',
    apply: withRecord(swap('--file ops/images/finance-agent/Dockerfile --tag <FINANCE_IMAGE_REF> .', '--file ops/images/finance-agent/Dockerfile .')),
  },
  // --- what a recipe this repository owns must and must not contain ------------------------------
  {
    code: 'RECIPE_BASE_NOT_PINNED_TO_RUNTIME',
    why: 'an image on an unverified runtime is one the gates were never run against',
    apply: withRecipe(swap('FROM node:24-bookworm-slim AS runtime', 'FROM node:latest AS runtime')),
  },
  {
    code: 'RECIPE_ENDS_PRIVILEGED',
    why: 'a process with privilege has privilege to lose, and the last directive is what decides it',
    apply: withRecipe(swap('\nUSER node\n', '\nUSER root\n')),
  },
  {
    code: 'RECIPE_OMITS_PROBE_COMMAND',
    why: 'the restore drill invokes that name, and R22 holds only if the command exists inside the image',
    apply: withRecipe((t) => t.split(PROBE_COMMAND_NAME).join('some-other-name')),
  },
  {
    code: 'RECIPE_DECLARES_HEALTHCHECK',
    why: 'the topology declares one per service with its own timings, and two policies drift',
    apply: withRecipe(swap('\nUSER node\n', '\nHEALTHCHECK CMD ["true"]\nUSER node\n')),
  },
  {
    code: 'RECIPE_PUBLISHES_PORT',
    why: 'the published port belongs to the proxy service and to nothing else, and phase 1 binds none at all',
    apply: withRecipe(swap('\nUSER node\n', '\nEXPOSE 1\nUSER node\n')),
  },
  {
    code: 'RECIPE_CARRIES_ENV_DEFAULT',
    why: 'a default in the image turns a refused boot into a guessed one',
    apply: withRecipe(swap('\nUSER node\n', '\nENV TELEGRAM_MODE=longPoll\nUSER node\n')),
  },
  {
    code: 'RECIPE_HAS_NO_ENTRYPOINT',
    why: 'without one, what the image runs is whatever the base image happened to declare',
    apply: withRecipe((t) => t.replace(/^ENTRYPOINT .*$/gm, '# removed')),
  },
];

describe('the ownership record accounts for every image the topology names (R28, task 10.8)', () => {
  it('produces no finding against the real tree, over counts asserted to be non-zero', () => {
    const report = auditImageOwnership(baseInput());
    expect(report.findings).toEqual([]);
    expect(report.referencesExamined).toBeGreaterThan(0);
    expect(report.rowsExamined).toBe(report.referencesExamined);
    expect(report.recipesExamined).toBeGreaterThan(0);
  });

  it('produces no finding through the real file entry point either', () => {
    const report = auditImageOwnershipFiles(REPO);
    expect(report.findings).toEqual([]);
    expect(report.rowsExamined).toBeGreaterThan(0);
  });

  it('records exactly one reference as built here, and the rest as owned elsewhere or blocked (O1)', () => {
    // The ownership boundary is the substance of this task, so it is asserted rather than described:
    // the finance agent is this repository (steering §1); the life agent is Python and belongs to the
    // other repository, which steering §6 forbids this session from modifying; the proxy is an
    // upstream release; and three references are owned here in library form with no process to
    // package, which is the state R28 did not anticipate.
    const rows = parseOwnershipRecord(RECORD);
    const byState = new Map<string, string[]>();
    for (const row of rows) byState.set(row.state, [...(byState.get(row.state) ?? []), row.reference]);

    expect(byState.get('BUILT_HERE')).toEqual(['<FINANCE_IMAGE_REF>']);
    expect(byState.get('EXTERNAL')).toEqual(['<LIFE_IMAGE_REF>', '<PROXY_IMAGE_REF>']);
    expect(byState.get('OWNED_BUILD_PENDING')).toEqual(['<BUS_IMAGE_REF>', '<SCHEDULER_IMAGE_REF>', '<BACKUP_IMAGE_REF>']);
    for (const row of rows) expect(row.reference).toMatch(IMAGE_REFERENCE_SHAPE);
    for (const row of rows) expect(OWNERSHIP_STATES).toContain(row.state as (typeof OWNERSHIP_STATES)[number]);
  });

  it('names every image reference the topology declares, one per service, and no other', () => {
    const references = imageReferencesOf(COMPOSE);
    const recorded = new Set(parseOwnershipRecord(RECORD).map((r) => r.reference));
    expect([...references.values()].sort()).toEqual([...recorded].sort());
    for (const reference of references.values()) expect(reference).toMatch(IMAGE_REFERENCE_SHAPE);
  });

  it('reads the recipe as facts: pinned base, unprivileged tail, the probe command, no port and no default', () => {
    expect(RECIPES.length).toBeGreaterThan(0);
    for (const recipe of RECIPES) {
      const facts = parseRecipe(recipe.text ?? '');
      expect(facts.bases.length).toBeGreaterThan(0);
      for (const base of facts.bases) expect(baseMatchesRuntimeMajor(base, RUNTIME_MAJOR)).toBe(true);
      expect(facts.finalUser).not.toBeNull();
      expect(facts.finalUser?.toLowerCase()).not.toBe('root');
      expect(facts.installedCommands).toContain(PROBE_COMMAND_NAME);
      expect(facts.declaresHealthcheck).toBe(false);
      expect(facts.publishesPort).toBe(false);
      expect(facts.carriesEnvDefault).toBe(false);
      expect(facts.hasEntrypoint).toBe(true);
    }
  });

  it('treats a bare build argument as carrying nothing and an assigned one as a default', () => {
    // The distinction matters: `ARG NAME` declares an input the builder supplies and leaves no value
    // in the image, which is not what R27 forbids. `ARG NAME=value` does.
    expect(parseRecipe('FROM node:24\nARG SOMETHING\nUSER node\nENTRYPOINT ["node"]\n').carriesEnvDefault).toBe(false);
    expect(parseRecipe('FROM node:24\nARG SOMETHING=value\nUSER node\nENTRYPOINT ["node"]\n').carriesEnvDefault).toBe(true);
  });

  it('reads a directive split across a continuation as one directive, and ignores a quoted one in a comment', () => {
    const facts = parseRecipe('# EXPOSE 1 is deliberately absent\nFROM node:24\nRUN true \\\n && install -d /data\nUSER node\nENTRYPOINT ["node"]\n');
    expect(facts.publishesPort).toBe(false);
    expect(facts.finalUser).toBe('node');
  });

  it('refuses a base with no tag, a floating tag, and a major that disagrees with the pinned one', () => {
    expect(baseMatchesRuntimeMajor('node:24-bookworm-slim', '24')).toBe(true);
    expect(baseMatchesRuntimeMajor('node:24', '24')).toBe(true);
    expect(baseMatchesRuntimeMajor('node:24.1.0', '24')).toBe(true);
    expect(baseMatchesRuntimeMajor('node', '24')).toBe(false);
    expect(baseMatchesRuntimeMajor('node:current', '24')).toBe(false);
    expect(baseMatchesRuntimeMajor('node:22-bookworm-slim', '24')).toBe(false);
    expect(baseMatchesRuntimeMajor('node:240', '24')).toBe(false);
  });

  it('requires the recipe and the tag on one invocation, because that is what leaves nothing to match', () => {
    expect(documentsBuildPath(`x ${RECIPE_FLAG} a/Dockerfile ${TAG_FLAG} <X_IMAGE_REF> .`, 'a/Dockerfile', '<X_IMAGE_REF>')).toBe(true);
    expect(documentsBuildPath(`x ${RECIPE_FLAG} a/Dockerfile .\nthen ${TAG_FLAG} <X_IMAGE_REF>`, 'a/Dockerfile', '<X_IMAGE_REF>')).toBe(false);
    // The record's own table row names both on one line. It is not an invocation, and accepting it
    // would let the document satisfy the check it exists to be held to.
    expect(documentsBuildPath('| `<X_IMAGE_REF>` | `BUILT_HERE` | `a/Dockerfile` | - |', 'a/Dockerfile', '<X_IMAGE_REF>')).toBe(false);
  });
});

describe('the firewall posture, the bindings and the challenge resolution agree (R30, finding F12)', () => {
  it('produces no finding against the real artifacts, through both entry points', () => {
    expect(auditPortPosture(basePosture())).toEqual([]);
    expect(auditPortPostureFiles(REPO)).toEqual([]);
  });

  it('records the resolution actually chosen, and the three artifacts carry it', () => {
    // Task 10.8's decision, asserted rather than described. The register names the challenge that
    // needs only the TLS port and does NOT name the one that needs the cleartext port; the topology
    // publishes exactly that one host port; and the proxy configuration switches the other challenge
    // off, so issuance does not rest on a failed attempt and a retry.
    expect(REGISTER).toContain(CHALLENGE_ON_TLS_PORT);
    expect(REGISTER).not.toContain(CHALLENGE_NEEDING_CLEARTEXT_PORT);
    expect(RECORD).toContain(CHALLENGE_ON_TLS_PORT);
    expect(publishedHostPorts(COMPOSE)).toEqual(['<TLS_PORT>']);
    expect(PROXY_CONFIG).toContain(HTTP_CHALLENGE_DISABLE_DIRECTIVE);
  });

  it('compares the recorded firewall allowance against the bindings, excluding the administrative port', () => {
    const allowed = firewallAllowedPorts(REGISTER);
    expect(allowed).toContain(ADMIN_PORT_PLACEHOLDER);
    expect(allowed.filter((p) => p !== ADMIN_PORT_PLACEHOLDER)).toEqual([...publishedHostPorts(COMPOSE)]);
  });

  it('would have held the rejected resolution just as tightly, which is what makes it an agreement check', () => {
    // The checker is neutral: it reads the challenge the register names and requires the other two
    // artifacts to match THAT choice. So the rejected resolution, recorded coherently, also passes -
    // and recorded incoherently, fails. Without this case the module would only be evidence that one
    // particular decision was written down consistently.
    const cleartextRegister = REGISTER.split(CHALLENGE_ON_TLS_PORT).join(CHALLENGE_NEEDING_CLEARTEXT_PORT).replace(
      'ufw allow <TLS_PORT>/tcp',
      'ufw allow <TLS_PORT>/tcp\n   ufw allow <CHALLENGE_PORT>/tcp',
    );
    const twoPortCompose = COMPOSE.replace('      - "<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"', '      - "<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"\n      - "<CHALLENGE_PORT>:<CHALLENGE_PORT>"');
    const enabledProxy = PROXY_CONFIG.split(HTTP_CHALLENGE_DISABLE_DIRECTIVE).join('# challenge left enabled');
    const coherent = auditPortPosture({
      register: cleartextRegister,
      compose: twoPortCompose,
      proxyConfig: enabledProxy,
      record: RECORD.split(CHALLENGE_ON_TLS_PORT).join(CHALLENGE_NEEDING_CLEARTEXT_PORT),
    });
    expect(coherent).toEqual([]);

    // The same choice, recorded in the register alone and contradicted everywhere else.
    const incoherent = auditPortPosture({ ...basePosture(), register: cleartextRegister });
    expect(incoherent.map((f) => f.code).sort()).toEqual(
      ['CHALLENGE_DISABLED_STATE_DISAGREES', 'CHALLENGE_PORT_BINDING_DISAGREES', 'CHALLENGE_RESOLUTION_NOT_IN_RECORD', 'FIREWALL_OPENS_UNBOUND_PORT'].sort(),
    );
  });

  it('reads no host port out of a topology it cannot parse, so an unreadable file disagrees rather than agrees', () => {
    expect(publishedHostPorts('this is not the supported subset')).toEqual([]);
    expect(auditPortPosture({ ...basePosture(), compose: '' }).map((f) => f.code)).toContain('CHALLENGE_PORT_BINDING_DISAGREES');
  });
});

interface PostureCase {
  readonly code: ImageOwnershipFindingCode;
  readonly why: string;
  readonly apply: (input: PortPostureInput) => PortPostureInput;
}

const POSTURE_CASES: readonly PostureCase[] = [
  {
    code: 'FIREWALL_POSTURE_UNREADABLE',
    why: 'with no recorded allowance there is no posture for the bindings to agree with, in either direction',
    apply: (input) => ({ ...input, register: input.register.split('ufw allow').join('# allowance removed') }),
  },
  {
    code: 'FIREWALL_OPENS_UNBOUND_PORT',
    why: 'an open port that reaches nothing fails while the firewall looks correct, which is the defect R30 exists to close',
    apply: (input) => ({ ...input, register: input.register.replace('ufw allow <TLS_PORT>/tcp', 'ufw allow <TLS_PORT>/tcp\n   ufw allow <UNBOUND_PORT>/tcp') }),
  },
  {
    code: 'BINDING_NOT_ADMITTED_BY_FIREWALL',
    why: 'a service the firewall does not admit starts, reports healthy, and is unreachable',
    apply: (input) => ({ ...input, register: input.register.replace('ufw allow <TLS_PORT>/tcp', 'ufw allow <SOMETHING_ELSE>/tcp') }),
  },
  {
    code: 'CHALLENGE_RESOLUTION_UNRECORDED',
    why: 'R30 requires the resolution recorded in the register rather than inferred from either artifact alone',
    apply: (input) => ({ ...input, register: input.register.split(CHALLENGE_ON_TLS_PORT).join('some challenge') }),
  },
  {
    code: 'CHALLENGE_RESOLUTION_AMBIGUOUS',
    why: 'a document naming both records a discussion rather than a decision',
    apply: (input) => ({ ...input, register: `${input.register}\nand also ${CHALLENGE_NEEDING_CLEARTEXT_PORT}\n` }),
  },
  {
    code: 'CHALLENGE_PORT_BINDING_DISAGREES',
    why: 'a second binding is a port opened for a challenge nothing performs',
    apply: (input) => ({
      ...input,
      compose: input.compose.replace('      - "<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"', '      - "<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"\n      - "<EXTRA_PORT>:<EXTRA_PORT>"'),
    }),
  },
  {
    code: 'CHALLENGE_DISABLED_STATE_DISAGREES',
    why: 'the proxy would attempt a challenge against a port nothing publishes, and issuance becomes a retry loop',
    apply: (input) => ({ ...input, proxyConfig: input.proxyConfig.split(HTTP_CHALLENGE_DISABLE_DIRECTIVE).join('# left enabled') }),
  },
  {
    code: 'CHALLENGE_RESOLUTION_NOT_IN_RECORD',
    why: 'the build path assumes a port posture, so a recipe built for the other challenge asks for a port nobody opened',
    apply: (input) => ({ ...input, record: input.record.split(CHALLENGE_ON_TLS_PORT).join('the other one') }),
  },
];

describe('every finding fires when the property it holds is broken', () => {
  for (const testCase of NEGATIVE_CASES) {
    it(`${testCase.code}: ${testCase.why}`, () => {
      const codes = auditImageOwnership(testCase.apply(baseInput())).findings.map((f) => f.code);
      expect(codes).toContain(testCase.code);
    });
  }

  for (const testCase of POSTURE_CASES) {
    it(`${testCase.code}: ${testCase.why}`, () => {
      const codes = auditPortPosture(testCase.apply(basePosture())).map((f) => f.code);
      expect(codes).toContain(testCase.code);
    });
  }

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([...NEGATIVE_CASES.map((c) => c.code), ...POSTURE_CASES.map((c) => c.code)]);
    expect(IMAGE_OWNERSHIP_FINDING_CODES.filter((c) => !covered.has(c))).toEqual([]);
  });
});
