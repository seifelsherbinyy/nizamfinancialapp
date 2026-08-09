// @vitest-environment node
/**
 * NIZAM · The environment templates say what the contract requires, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 7.3 (spec 06-two-agent-vps)
 * Owning requirements: R6 (one file per service, and no service holds another's secret),
 *   R11/R12 (the transport guards are configured, never defaulted), R17 (per-agent cap isolation),
 *   R23 (every value traces to a human gate), R24 (no deployment particular)
 * Depends on: ./envTemplates, ./composeTemplate, the six ops/env templates, ops/docker-compose.yml,
 *   and the port sources under src/server (all read from disk as text, none executed)
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The six templates on disk produce no finding, and the properties the contract names are
 * asserted separately off the parse tree so a reader can see the requirement and its evidence in
 * the same place: one file per service the topology declares an env_file for; every value a
 * placeholder that is its own name; no secret in two files; the halt and the per-agent cap present
 * where they must be; and the entry names still the names the code resolves.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real template set, breaks
 * one property, and observes that code fire. A checker that has only ever been observed passing is
 * not evidence that it checks. The coverage test at the end fails if a code is added without a row.
 *
 * Nothing here executes a template, sources one, or resolves a value. Everything is text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AGENT_CAP_ENTRY,
  BACKUP_TEMPLATE,
  BUS_TEMPLATE,
  CODE_BINDINGS,
  ENTRY_SPECS,
  ENV_FINDING_CODES,
  ENV_PATH_TEMPLATE,
  FINANCE_TEMPLATE,
  GATE_VOCABULARY,
  KILL_SENTINEL_ENTRY,
  KILL_SWITCH_ENTRY,
  LIFE_TEMPLATE,
  PORT_SOURCE_FILES,
  PROXY_TEMPLATE,
  SCHEDULER_TEMPLATE,
  TEMPLATE_SERVICE,
  TRACKED_SUFFIX,
  auditEnvTemplateFiles,
  auditEnvTemplates,
  envFilesByService,
  mapParticularFindings,
  parseEnvTemplate,
  type EnvAuditInput,
  type EnvFindingCode,
} from './envTemplates';
import { KILL_SENTINEL_CONSUMERS } from './composeTemplate';

const ENV_DIR = fileURLToPath(new URL('../../../ops/env', import.meta.url));
const COMPOSE_PATH = fileURLToPath(new URL('../../../ops/docker-compose.yml', import.meta.url));
const SERVER_DIR = fileURLToPath(new URL('../', import.meta.url));

/** Line endings normalized so the mutation anchors below do not depend on the checkout's setting.
 *  The file entry point is exercised separately against the bytes on disk. */
function readNormalized(path: string): string {
  return readFileSync(path, 'utf8').split('\r\n').join('\n');
}

const TEMPLATE_NAMES: readonly string[] = Object.values(ENV_PATH_TEMPLATE).map((v) => v.template);

const BASE: EnvAuditInput = {
  templates: Object.fromEntries(
    TEMPLATE_NAMES.map((name) => [name, readNormalized(`${ENV_DIR}/${name}${TRACKED_SUFFIX}`)]),
  ),
  composeSource: readNormalized(COMPOSE_PATH),
  portSources: Object.fromEntries(PORT_SOURCE_FILES.map((rel) => [rel, readNormalized(`${SERVER_DIR}${rel}`)])),
};

function codesFor(input: EnvAuditInput): readonly EnvFindingCode[] {
  return auditEnvTemplates(input).map((f) => f.code);
}

/** A mutation that must actually change the text, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (text: string) => string {
  return (text) => {
    if (!text.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 80))}`);
    const next = text.replace(from, () => to);
    if (next === text) throw new Error('the mutation left the text unchanged, so the case would prove nothing');
    return next;
  };
}

function inTemplate(name: string, mutate: (text: string) => string): (input: EnvAuditInput) => EnvAuditInput {
  return (input) => {
    const current = input.templates[name];
    if (current === undefined) throw new Error(`no template named ${name}`);
    return { ...input, templates: { ...input.templates, [name]: mutate(current) } };
  };
}

/** An annotated assignment block, appended after a blank line so it parses as its own entry. */
function block(name: string, gate: string, secret: string): string {
  return `\n# what: an entry added by a negative test, and by nothing else\n# gate: ${gate}\n# secret: ${secret}\n${name}=<${name}>\n`;
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan
// forbids and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'bus.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

interface NegativeCase {
  readonly code: EnvFindingCode;
  readonly why: string;
  readonly apply: (input: EnvAuditInput) => EnvAuditInput;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    code: 'ENV_TEMPLATE_OUTSIDE_SUBSET',
    why: 'a line that is neither blank, a comment, nor an assignment is something that was pasted',
    apply: inTemplate(FINANCE_TEMPLATE, (t) => `${t}\nMONEY_WEBHOOK_SECRET\n`),
  },
  {
    code: 'COMPOSE_COMPANION_UNREADABLE',
    why: 'without the topology, how many templates must exist cannot be decided here',
    apply: (input) => ({ ...input, composeSource: '' }),
  },
  {
    code: 'ENV_FILE_PLACEHOLDER_UNMAPPED',
    why: 'a service with a declared env_file and no template is a deployment that cannot start',
    apply: (input) => ({ ...input, composeSource: swap('<BACKUP_ENV_PATH>', '<ARCHIVE_ENV_PATH>')(input.composeSource) }),
  },
  {
    code: 'TEMPLATE_MISSING',
    why: 'the topology declares an env_file for this service and the template behind it is absent',
    apply: (input) => {
      const templates = { ...input.templates };
      delete templates[FINANCE_TEMPLATE];
      return { ...input, templates };
    },
  },
  {
    code: 'TEMPLATE_NOT_DECLARED_BY_COMPOSE',
    why: 'an environment file nothing loads is an environment file nobody maintains',
    apply: (input) => ({
      ...input,
      templates: { ...input.templates, 'router.env': '# contract 12, phase 7 - a template no service reads\n' },
    }),
  },
  {
    code: 'HEADER_OWNERSHIP_MISSING',
    why: 'AC10 and steering §7 - a template that does not name its owner is one nobody can place',
    apply: inTemplate(BUS_TEMPLATE, swap('Contract 12, phase 7.', 'unstated.')),
  },
  {
    code: 'ENTRY_DUPLICATED_IN_FILE',
    why: 'a reader sees the first assignment and an environment reader keeps the last',
    apply: inTemplate(SCHEDULER_TEMPLATE, (t) => `${t}${block(KILL_SWITCH_ENTRY, 'operator', 'no')}`),
  },
  {
    code: 'ENTRY_VALUE_NOT_PLACEHOLDER',
    why: 'steering §0b - no example value, and a resolved value in a tracked file is a particular',
    apply: inTemplate(PROXY_TEMPLATE, swap('DOMAIN=<DOMAIN>', 'DOMAIN=deployment-one')),
  },
  {
    code: 'ENTRY_VALUE_NOT_SELF_NAMED',
    why: 'one thing to resolve per line; a second spelling is a second thing to keep in step',
    apply: inTemplate(PROXY_TEMPLATE, swap('DOMAIN=<DOMAIN>', 'DOMAIN=<PUBLIC_DOMAIN>')),
  },
  {
    code: 'ENTRY_ANNOTATION_MISSING',
    why: 'an entry nobody can trace to a gate is an entry the operator has to guess at',
    apply: inTemplate(PROXY_TEMPLATE, swap('# secret: no\nDOMAIN=', 'DOMAIN=')),
  },
  {
    code: 'ENTRY_GATE_UNKNOWN',
    why: 'G7 is closed as WONT-DO, so naming it attributes a value to a gate that does not exist',
    apply: inTemplate(PROXY_TEMPLATE, swap('# gate: G2\n# secret: no\nDOMAIN=', '# gate: G7\n# secret: no\nDOMAIN=')),
  },
  {
    code: 'ENTRY_SECRET_FLAG_INVALID',
    why: 'a maybe is read as a no by whoever is in a hurry',
    apply: inTemplate(PROXY_TEMPLATE, swap('# secret: no\nDOMAIN=', '# secret: maybe\nDOMAIN=')),
  },
  {
    code: 'ENTRY_SECRECY_UNEXPECTED',
    why: 'a bot token marked not-secret is a value that will be handled as though it were not one',
    apply: inTemplate(FINANCE_TEMPLATE, swap('# secret: yes\nBOT_B_TOKEN=', '# secret: no\nBOT_B_TOKEN=')),
  },
  {
    code: 'REQUIRED_ENTRY_MISSING',
    why: 'an unset entry has no default, so the service fails closed at start-up for no visible reason',
    apply: inTemplate(BACKUP_TEMPLATE, swap('STORAGE_TOKEN_URL=<STORAGE_TOKEN_URL>\n', '')),
  },
  {
    code: 'ENTRY_UNDECLARED',
    why: 'an environment file that quietly grew an entry is an environment file nobody reviewed',
    apply: inTemplate(BUS_TEMPLATE, (t) => `${t}${block('EXTRA_TUNING', 'operator', 'no')}`),
  },
  {
    code: 'ENTRY_SHARED_WITHOUT_REASON',
    why: '§3.2.7 makes one file per service the default and sharing the exception, with a reason',
    apply: inTemplate(SCHEDULER_TEMPLATE, (t) => `${t}${block('SIGNALS_STORE_FILE', 'operator', 'no')}`),
  },
  {
    code: 'SHARED_ENTRY_IS_SECRET',
    why: 'R6 - a secret in two files means one service holds another service\u2019s secret',
    apply: inTemplate(FINANCE_TEMPLATE, swap('# secret: no\nALLOWED_USER_IDS=', '# secret: yes\nALLOWED_USER_IDS=')),
  },
  {
    code: 'SHARED_ENTRY_UNUSED',
    why: 'a recorded reason for a sharing that no longer happens has stopped describing the file',
    apply: inTemplate(LIFE_TEMPLATE, swap('STORE_BUSY_TIMEOUT_MS=<STORE_BUSY_TIMEOUT_MS>\n', '')),
  },
  {
    code: 'FOREIGN_SECRET_IN_FILE',
    why: 'contract 12 T4 - the life file must not contain the finance model key, in either direction',
    apply: inTemplate(LIFE_TEMPLATE, (t) => `${t}${block('OR_KEY_FINANCE', 'G4', 'yes')}`),
  },
  {
    code: 'KILL_SWITCH_ENTRY_MISSING',
    why: 'steering §4 invariant 6 - a halt that reaches only some writers is not a halt',
    apply: inTemplate(BACKUP_TEMPLATE, swap(`${KILL_SWITCH_ENTRY}=<${KILL_SWITCH_ENTRY}>\n`, '')),
  },
  {
    code: 'KILL_SENTINEL_ENTRY_MISSING',
    why: '§8.1 - the per-call sentinel is the form that halts without a restart, and the variable is not a substitute',
    apply: inTemplate(SCHEDULER_TEMPLATE, swap(`${KILL_SENTINEL_ENTRY}=<${KILL_SENTINEL_ENTRY}>\n`, '')),
  },
  {
    code: 'KILL_SWITCH_ENTRY_UNEXPECTED',
    why: 'a halt entry in a service that mounts no sentinel implies a writer that does not exist',
    apply: inTemplate(BUS_TEMPLATE, (t) => `${t}${block(KILL_SWITCH_ENTRY, 'operator', 'no')}`),
  },
  {
    code: 'WEEKLY_CAP_ENTRY_MISSING',
    why: '§6.2 - each agent carries its own ceiling, and one entry may not serve both',
    apply: inTemplate(FINANCE_TEMPLATE, swap('FINANCE_WEEKLY_CAP=<FINANCE_WEEKLY_CAP>\n', '')),
  },
  {
    code: 'PORT_CONFIG_FIELD_ABSENT',
    why: 'a renamed field leaves the template describing an agreement the code no longer makes',
    apply: (input) => ({
      ...input,
      portSources: {
        ...input.portSources,
        'ports/openrouter.ts': swap('readonly apiKeyRef', 'readonly apiKeyName')(input.portSources['ports/openrouter.ts'] ?? ''),
      },
    }),
  },
  {
    code: 'CODE_BOUND_ENTRY_MISSING',
    why: 'the entry name a template declares must be the name the code resolves',
    apply: inTemplate(LIFE_TEMPLATE, swap('WHOOP_ACCESS_TOKEN=<WHOOP_ACCESS_TOKEN>\n', '')),
  },
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    apply: inTemplate(BUS_TEMPLATE, swap('BUS_INTERNAL_ENDPOINT=<BUS_INTERNAL_ENDPOINT>', `BUS_INTERNAL_ENDPOINT=${URL_SHAPED}`)),
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host in any notation',
    apply: inTemplate(BUS_TEMPLATE, swap('BUS_INTERNAL_ENDPOINT=<BUS_INTERNAL_ENDPOINT>', `BUS_INTERNAL_ENDPOINT=${ADDRESS_SHAPED}`)),
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'R24 - write the domain placeholder, never a name',
    apply: inTemplate(BUS_TEMPLATE, swap('BUS_INTERNAL_ENDPOINT=<BUS_INTERNAL_ENDPOINT>', `BUS_INTERNAL_ENDPOINT=${HOSTNAME_SHAPED}`)),
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    apply: inTemplate(LIFE_TEMPLATE, swap('ALLOWED_USER_IDS=<ALLOWED_USER_IDS>', `ALLOWED_USER_IDS=${LONG_DIGIT_RUN}`)),
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, including in a comment',
    apply: inTemplate(FINANCE_TEMPLATE, swap('# gate: G4\n# secret: no\nFINANCE_WEEKLY_CAP=', `# gate: G4\n# secret: no\n# ceiling ${CURRENCY_SHAPED}\nFINANCE_WEEKLY_CAP=`)),
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case is recognized by neither the operator nor task 9.0',
    apply: inTemplate(PROXY_TEMPLATE, swap('DOMAIN=<DOMAIN>', 'DOMAIN=<publicDomain>')),
  },
];

describe('the templates on disk are the shape contract 12 requires', () => {
  it('produces no finding at all', () => {
    const findings = auditEnvTemplates(BASE);
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('supplies exactly one template per service the topology declares an env_file for (§3.2.7)', () => {
    const declared = envFilesByService(BASE.composeSource);
    expect(declared).not.toBeNull();
    const placeholders: string[] = [];
    for (const [service, files] of [...(declared?.entries() ?? [])]) {
      expect(files, `${service} declares exactly one env_file`).toHaveLength(1);
      placeholders.push(...files);
    }
    // Six services, six placeholders, six templates, and no placeholder used twice.
    expect(placeholders).toHaveLength(6);
    expect(new Set(placeholders).size).toBe(6);
    expect([...placeholders].sort()).toEqual(Object.keys(ENV_PATH_TEMPLATE).sort());
    expect(Object.keys(BASE.templates).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  it('sets every value to an <ANGLE_BRACKET> placeholder that is its own entry name (AC09, R24)', () => {
    for (const [name, source] of Object.entries(BASE.templates)) {
      const parsed = parseEnvTemplate(source);
      expect(parsed.entries.length, `${name} declares entries`).toBeGreaterThan(0);
      for (const entry of parsed.entries) {
        expect(entry.value, `${name} ${entry.name}`).toBe(`<${entry.name}>`);
        expect(entry.annotation.what, `${name} ${entry.name} what`).toBeTruthy();
        expect(GATE_VOCABULARY, `${name} ${entry.name} gate`).toContain(entry.annotation.gate);
        expect(['yes', 'no'], `${name} ${entry.name} secret`).toContain(entry.annotation.secret);
      }
    }
  });

  it('lets no secret appear in two files, in either direction (§3.2.7, T4)', () => {
    const where = new Map<string, string[]>();
    for (const [name, source] of Object.entries(BASE.templates)) {
      for (const entry of parseEnvTemplate(source).entries) {
        if (entry.annotation.secret !== 'yes') continue;
        where.set(entry.name, [...(where.get(entry.name) ?? []), name]);
      }
    }
    // Every secret has exactly one home, and the two agents' secrets are disjoint.
    for (const [entryName, files] of where) {
      expect(files, `${entryName} homes`).toHaveLength(1);
    }
    const secretsOf = (template: string): string[] =>
      parseEnvTemplate(BASE.templates[template] ?? '')
        .entries.filter((e) => e.annotation.secret === 'yes')
        .map((e) => e.name);
    const life = secretsOf(LIFE_TEMPLATE);
    const finance = secretsOf(FINANCE_TEMPLATE);
    expect(life.length).toBeGreaterThan(0);
    expect(finance.length).toBeGreaterThan(0);
    expect(life.filter((n) => finance.includes(n))).toEqual([]);
    expect(life).toContain('OR_KEY_LIFE');
    expect(finance).toContain('OR_KEY_FINANCE');
    expect(life).not.toContain('OR_KEY_FINANCE');
    expect(finance).not.toContain('OR_KEY_LIFE');
  });

  it('records a reason for every entry that appears in more than one file, and none is a secret', () => {
    const seen = new Map<string, string[]>();
    for (const [name, source] of Object.entries(BASE.templates)) {
      for (const entry of parseEnvTemplate(source).entries) {
        seen.set(entry.name, [...(seen.get(entry.name) ?? []), name]);
      }
    }
    const shared = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const [entryName] of shared) {
      const spec = ENTRY_SPECS[entryName];
      expect(spec, `${entryName} has a spec`).toBeDefined();
      expect(spec?.why, `${entryName} records why it is shared`).toBeTruthy();
      expect(spec?.secret, `${entryName} is not a secret`).toBe(false);
    }
  });

  it('carries the coarse halt and the per-call sentinel in exactly the four services that mount it', () => {
    const carriers: string[] = [];
    for (const [name, source] of Object.entries(BASE.templates)) {
      const names = parseEnvTemplate(source).entries.map((e) => e.name);
      const hasSwitch = names.includes(KILL_SWITCH_ENTRY);
      const hasSentinel = names.includes(KILL_SENTINEL_ENTRY);
      // Both forms, or neither. One without the other is a halt with a gap in it (§8).
      expect(hasSwitch, `${name} carries both halt forms or neither`).toBe(hasSentinel);
      if (hasSwitch) carriers.push(TEMPLATE_SERVICE[name] ?? name);
    }
    expect(carriers.sort()).toEqual([...KILL_SENTINEL_CONSUMERS].sort());
  });

  it('gives each agent its own weekly ceiling, and no entry serves both (§6.2, R17)', () => {
    for (const [template, cap] of Object.entries(AGENT_CAP_ENTRY)) {
      const names = parseEnvTemplate(BASE.templates[template] ?? '').entries.map((e) => e.name);
      expect(names, `${template} cap`).toContain(cap);
      expect(ENTRY_SPECS[cap]?.owners).toEqual([template]);
    }
    // The two cap entries are different names, so exhaustion can never be shared.
    expect(new Set(Object.values(AGENT_CAP_ENTRY)).size).toBe(Object.keys(AGENT_CAP_ENTRY).length);
  });

  it('declares entry names the code actually resolves, at the field that resolves them', () => {
    expect(CODE_BINDINGS.length).toBeGreaterThan(0);
    for (const binding of CODE_BINDINGS) {
      const source = BASE.portSources[binding.source];
      expect(source, `${binding.source} was read`).toBeTruthy();
      expect(source ?? '', `${binding.source} declares ${binding.field}`).toMatch(
        new RegExp(`readonly\\s+${binding.field}\\b`),
      );
      const owners = ENTRY_SPECS[binding.entry]?.owners ?? [];
      expect(owners.length, `${binding.entry} has an owner`).toBeGreaterThan(0);
      for (const owner of owners) {
        const names = parseEnvTemplate(BASE.templates[owner] ?? '').entries.map((e) => e.name);
        expect(names, `${owner} declares ${binding.entry}`).toContain(binding.entry);
      }
    }
  });

  it('names no webhook path segment in either agent\u2019s file, only in the proxy\u2019s (§2.2.3)', () => {
    for (const template of [LIFE_TEMPLATE, FINANCE_TEMPLATE]) {
      const source = BASE.templates[template] ?? '';
      expect(source).not.toContain('WEBHOOK_PATH');
    }
    const proxy = parseEnvTemplate(BASE.templates[PROXY_TEMPLATE] ?? '').entries.map((e) => e.name);
    expect(proxy).toContain('LIFE_WEBHOOK_PATH');
    expect(proxy).toContain('MONEY_WEBHOOK_PATH');
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c) => [c.code, c.why, c] as const))('%s fires when %s', (code, _why, testCase) => {
    const broken = testCase.apply(BASE);
    expect(broken).not.toBe(BASE);
    expect(codesFor(broken)).toContain(code);
  });

  it('an unreadable template is a finding, never a skip', () => {
    const findings = auditEnvTemplateFiles(`${ENV_DIR}-does-not-exist`, COMPOSE_PATH, SERVER_DIR);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('ENV_TEMPLATE_UNREADABLE');
    // And it does not degrade into a pass: the templates the topology needs are reported missing too.
    expect(codes).toContain('TEMPLATE_MISSING');
  });

  it('a finding from the shared scan that this checker has no code for is reported, never dropped', () => {
    const mapped = mapParticularFindings([{ code: 'BUS_PUBLISHES_PORT', detail: 'a code from the topology checker' }], BUS_TEMPLATE);
    expect(mapped.map((f) => f.code)).toEqual(['PARTICULAR_SCAN_UNMAPPED']);
    expect(mapped[0]?.detail).toContain('BUS_PUBLISHES_PORT');
  });

  it('the file entry point agrees with the text entry point on the real templates', () => {
    expect(auditEnvTemplateFiles(ENV_DIR, COMPOSE_PATH, SERVER_DIR)).toEqual([]);
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([
      ...NEGATIVE_CASES.map((c) => c.code),
      'ENV_TEMPLATE_UNREADABLE',
      'PARTICULAR_SCAN_UNMAPPED',
    ]);
    const uncovered = ENV_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});
