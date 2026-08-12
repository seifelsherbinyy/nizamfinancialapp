/**
 * NIZAM · Structural audit of the per-service environment templates (ops/env/*.env)
 * Implemented by: PFOS Contract 12 / Phase 7.3 (spec 06-two-agent-vps)
 * Owning requirements: R6 (one environment file per service, and no service holds another's
 *   secret), R11/R12 (the transport guards are configured, never defaulted), R17 (per-agent cap
 *   isolation), R23 (every value traces to a human gate), R24 (no deployment particular)
 * Depends on: node:fs (file entry points only), ./composeTemplate (the topology's own service
 *   names, its kill-sentinel consumer list, its parser, and the shared no-particular scan)
 *
 * WHY THIS EXISTS. The templates are never executed here (steering §2: writing them is allowed,
 * running them is not), so the only way to know they still say what the contract requires is to
 * READ them. This module reads them. Each `ops/env/*.env` template must produce an empty list.
 *
 * It is deliberately a text audit and not an environment load. Loading would resolve values and
 * prove nothing about the properties that matter: that every value is still a placeholder, that no
 * service's file carries another's secret, and that the entry names still match what the code
 * resolves. A loader could not check any of those, and running one is what the wall forbids.
 *
 * THREE COMPANIONS, ALL READ RATHER THAN RESTATED.
 *  1. `ops/docker-compose.yml` declares which services have an `env_file` and under which
 *     placeholder. That set - not this module's opinion - decides how many templates must exist.
 *     A service with a declared `env_file` and no template is a deployment that cannot start.
 *  2. The same file names the four services that mount the kill sentinel, so which templates carry
 *     the halt is read from the topology instead of being asserted twice.
 *  3. The port configuration interfaces under `src/server/ports/` and `src/server/db/` establish
 *     the convention that a secret or an endpoint is referenced by environment-entry NAME, never
 *     by value (`apiKeyRef`, `internalEndpointRef`, `killSwitchSentinelPathRef`, and the rest).
 *     Every entry below that a code path resolves is bound to the field that resolves it, and the
 *     field is checked to still exist - so a rename in code surfaces as a finding rather than as a
 *     template that quietly stops matching the agreement.
 *
 * IT FAILS CLOSED. An unreadable template, an unreadable companion, a line outside the supported
 * subset, a missing template, an extra entry, a missing annotation, and an unrecognized placeholder
 * shape are all findings - not skips. A checker that has only ever been observed passing is not
 * evidence that it checks, so every code below has a negative test in envTemplates.test.ts that
 * mutates a real template and observes the code fire.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BACKUP_SERVICE,
  BUS_SERVICE,
  FINANCE_SERVICE,
  KILL_SENTINEL_CONSUMERS,
  LIFE_SERVICE,
  PROXY_SERVICE,
  SCHEDULER_SERVICE,
  parseComposeSubset,
  scanForParticulars,
  type ComposeFinding,
} from './composeTemplate.ts';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

/** The three annotation lines every assignment carries, as written. */
export interface EnvAnnotation {
  readonly what: string | null;
  readonly gate: string | null;
  readonly secret: string | null;
}

export interface EnvEntry {
  readonly name: string;
  readonly value: string;
  readonly annotation: EnvAnnotation;
  readonly line: number;
}

export interface EnvTemplate {
  /** The first twenty lines, where ownership is declared. */
  readonly head: string;
  readonly entries: readonly EnvEntry[];
}

/** Thrown for anything outside the supported subset. The subset is narrow on purpose: an
 *  environment file that needs quoting, interpolation, or continuation to say what it sets is one
 *  nobody can audit by eye either, and interpolation in particular is how a value acquires a
 *  default that was never reviewed. */
export class EnvSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvSubsetError';
  }
}

const ENTRY_NAME = /^[A-Z][A-Z0-9_]*$/;
/** A placeholder is upper snake case inside angle brackets, and nothing else (R24). */
const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

/**
 * Parse the supported subset: blank lines, `#` comment lines, and `NAME=VALUE` assignments where
 * the value is bare. Anything else throws.
 */
export function parseEnvTemplate(source: string): EnvTemplate {
  const lines = source.split(/\r?\n/);
  const entries: EnvEntry[] = [];
  const recent: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const lineNumber = i + 1;
    if (raw.trim() === '') {
      recent.length = 0;
      continue;
    }
    if (raw.includes('\t')) {
      throw new EnvSubsetError(`line ${lineNumber} contains a tab, which an environment reader does not treat as separation`);
    }
    if (raw.startsWith('#')) {
      recent.push(raw.slice(1).trim());
      continue;
    }
    if (/^\s/.test(raw)) {
      throw new EnvSubsetError(`line ${lineNumber} is indented; an environment file has no nesting, so indentation always means something was pasted`);
    }
    if (/^export\s/.test(raw)) {
      throw new EnvSubsetError(`line ${lineNumber} uses a shell export, which makes the file a script rather than a set of assignments`);
    }
    const at = raw.indexOf('=');
    if (at === -1) {
      throw new EnvSubsetError(`line ${lineNumber} is neither blank, a comment, nor an assignment: ${raw}`);
    }
    const name = raw.slice(0, at);
    const value = raw.slice(at + 1);
    if (!ENTRY_NAME.test(name)) {
      throw new EnvSubsetError(`line ${lineNumber} declares "${name}", which is not an upper-snake-case entry name`);
    }
    if (/["'`]/.test(value)) {
      throw new EnvSubsetError(`line ${lineNumber} quotes its value; the subset is bare values only, because a quote is a chance to hide a character`);
    }
    if (value.includes('$')) {
      throw new EnvSubsetError(`line ${lineNumber} interpolates; a value that refers to another value can acquire a default nobody reviewed`);
    }
    if (value !== value.trim()) {
      throw new EnvSubsetError(`line ${lineNumber} pads its value with whitespace, which an environment reader keeps`);
    }
    const tail = recent.slice(-3);
    entries.push({
      name,
      value,
      annotation: {
        what: annotationOf(tail, 'what'),
        gate: annotationOf(tail, 'gate'),
        secret: annotationOf(tail, 'secret'),
      },
      line: lineNumber,
    });
    recent.length = 0;
  }

  return { head: lines.slice(0, 20).join('\n'), entries };
}

function annotationOf(tail: readonly string[], key: string): string | null {
  for (const line of tail) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// What the contract says the environment files are
// ---------------------------------------------------------------------------------------------

export const PROXY_TEMPLATE = 'proxy.env';
export const LIFE_TEMPLATE = 'life.env';
export const FINANCE_TEMPLATE = 'finance.env';
export const BUS_TEMPLATE = 'bus.env';
export const SCHEDULER_TEMPLATE = 'scheduler.env';
export const BACKUP_TEMPLATE = 'backup.env';

/** The tracked file for each logical template carries an example suffix (steering §7, AC09). */
export const TRACKED_SUFFIX = '.example';

/**
 * `ops/docker-compose.yml` declares one `env_file` per service, as a placeholder. This maps each
 * placeholder to the template that stands behind it, and to the service that must be the one
 * declaring it. Contract 12 §3.2.7: one file per service, read by no other service.
 */
export const ENV_PATH_TEMPLATE: Readonly<Record<string, { readonly template: string; readonly service: string }>> = {
  '<PROXY_ENV_PATH>': { template: PROXY_TEMPLATE, service: PROXY_SERVICE },
  '<LIFE_ENV_PATH>': { template: LIFE_TEMPLATE, service: LIFE_SERVICE },
  '<FINANCE_ENV_PATH>': { template: FINANCE_TEMPLATE, service: FINANCE_SERVICE },
  '<BUS_ENV_PATH>': { template: BUS_TEMPLATE, service: BUS_SERVICE },
  '<SCHEDULER_ENV_PATH>': { template: SCHEDULER_TEMPLATE, service: SCHEDULER_SERVICE },
  '<BACKUP_ENV_PATH>': { template: BACKUP_TEMPLATE, service: BACKUP_SERVICE },
};

/** template -> the one service whose environment it is. The inverse of the map above. */
export const TEMPLATE_SERVICE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(ENV_PATH_TEMPLATE).map((v) => [v.template, v.service]),
);

/** The gate vocabulary. `G7` is absent because it is closed as WONT-DO (contract 12 §9). */
export const GATE_VOCABULARY: readonly string[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G8', 'operator', 'build'];

/** The coarse halt and the per-call sentinel (contract 12 §8, steering §4 invariant 6). */
export const KILL_SWITCH_ENTRY = 'NIZAM_KILL_ALL';
export const KILL_SENTINEL_ENTRY = 'KILL_SENTINEL_PATH';

/** Each agent's own weekly ceiling. Never one entry for both (§6.2, R17). */
export const AGENT_CAP_ENTRY: Readonly<Record<string, string>> = {
  [LIFE_TEMPLATE]: 'LIFE_WEEKLY_CAP',
  [FINANCE_TEMPLATE]: 'FINANCE_WEEKLY_CAP',
};

export interface EntrySpec {
  /** Every template permitted to declare it. More than one requires `why`. */
  readonly owners: readonly string[];
  readonly gate: string;
  readonly secret: boolean;
  /** Why a legitimately shared entry is shared. Required when `owners` names more than one file. */
  readonly why?: string;
}

const AGENTS: readonly string[] = [LIFE_TEMPLATE, FINANCE_TEMPLATE];
const HALT_OWNERS: readonly string[] = [LIFE_TEMPLATE, FINANCE_TEMPLATE, SCHEDULER_TEMPLATE, BACKUP_TEMPLATE];

/**
 * The exact entry set of every template, with its gate and its secrecy. This is the contract the
 * templates are checked against in both directions: a missing entry and an extra one are both
 * findings, because an environment file that quietly grew an entry is an environment file nobody
 * reviewed.
 */
export const ENTRY_SPECS: Readonly<Record<string, EntrySpec>> = {
  // --- the proxy: the two secret path segments, and nothing belonging to an agent -------------
  LIFE_HOSTNAME: { owners: [PROXY_TEMPLATE], gate: 'G2', secret: false },
  MONEY_HOSTNAME: { owners: [PROXY_TEMPLATE], gate: 'G2', secret: false },
  ACME_CONTACT: { owners: [PROXY_TEMPLATE], gate: 'operator', secret: false },
  LIFE_WEBHOOK_PATH: { owners: [PROXY_TEMPLATE], gate: 'G6', secret: true },
  MONEY_WEBHOOK_PATH: { owners: [PROXY_TEMPLATE], gate: 'G6', secret: true },
  LIFE_CONTAINER_PORT: {
    owners: [PROXY_TEMPLATE, LIFE_TEMPLATE],
    gate: 'operator',
    secret: false,
    why: "the proxy's upstream port must equal the port the life agent binds; a second name for one number is how they come to disagree",
  },
  FINANCE_CONTAINER_PORT: {
    owners: [PROXY_TEMPLATE, FINANCE_TEMPLATE],
    gate: 'operator',
    secret: false,
    why: "the proxy's upstream port must equal the port the finance agent binds",
  },

  // --- the life agent ------------------------------------------------------------------------
  LIFE_DATA_DIR: { owners: [LIFE_TEMPLATE], gate: 'G1', secret: false },
  LIFE_STORE_FILE: { owners: [LIFE_TEMPLATE], gate: 'operator', secret: false },
  BOT_A_TOKEN: { owners: [LIFE_TEMPLATE], gate: 'G3', secret: true },
  LIFE_WEBHOOK_SECRET: { owners: [LIFE_TEMPLATE], gate: 'G6', secret: true },
  OR_KEY_LIFE: { owners: [LIFE_TEMPLATE], gate: 'G4', secret: true },
  LIFE_WEEKLY_CAP: { owners: [LIFE_TEMPLATE], gate: 'G4', secret: false },
  WHOOP_API_BASE: { owners: [LIFE_TEMPLATE], gate: 'operator', secret: false },
  WHOOP_ACCESS_TOKEN: { owners: [LIFE_TEMPLATE], gate: 'operator', secret: true },

  // --- the finance agent ---------------------------------------------------------------------
  FINANCE_DATA_DIR: { owners: [FINANCE_TEMPLATE], gate: 'G1', secret: false },
  FINANCE_STORE_FILE: { owners: [FINANCE_TEMPLATE], gate: 'operator', secret: false },
  BOT_B_TOKEN: { owners: [FINANCE_TEMPLATE], gate: 'G3', secret: true },
  MONEY_WEBHOOK_SECRET: { owners: [FINANCE_TEMPLATE], gate: 'G6', secret: true },
  OR_KEY_FINANCE: { owners: [FINANCE_TEMPLATE], gate: 'G4', secret: true },
  FINANCE_WEEKLY_CAP: { owners: [FINANCE_TEMPLATE], gate: 'G4', secret: false },

  // --- shared by both agents, and every one of them not a secret ------------------------------
  STORE_BUSY_TIMEOUT_MS: {
    owners: AGENTS,
    gate: 'operator',
    secret: false,
    why: 'one writer per store (§3.2.4), so the lock wait is a per-process setting each agent needs its own copy of; it names no store and reveals nothing',
  },
  ALLOWED_USER_IDS: {
    owners: AGENTS,
    gate: 'G3',
    secret: false,
    why: 'the same single operator is allowlisted on both bots (gate G3 writes it into each file); it is a deployment particular, so it is a placeholder, but it is not a credential and holding it grants nothing',
  },
  MSG_API_BASE: {
    owners: AGENTS,
    gate: 'operator',
    secret: false,
    why: "the messaging provider's published base is identical for every user of that provider; both agents talk to it, and neither learns anything about the other from it",
  },
  TELEGRAM_MODE: {
    owners: AGENTS,
    gate: 'operator',
    secret: false,
    why: '§2.3 makes the degraded long-poll fallback a mode selected by configuration, with the same guards either way, so both agents need the selector',
  },
  MAX_WORK_ITEMS: {
    owners: AGENTS,
    gate: 'operator',
    secret: false,
    why: '§5.5.5 bounds worker concurrency in both agents; the value is a capacity choice, not a particular',
  },
  MODEL_API_BASE: {
    owners: AGENTS,
    gate: 'operator',
    secret: false,
    why: "the model provider's published base, identical for every user of that provider; the KEYS are what differ, and those are per agent",
  },
  MODEL_ELIGIBILITY_REGISTRY_PATH: {
    owners: AGENTS,
    gate: 'build',
    secret: false,
    why: '§6.3 gates both agents on the same registry document, and a provisional one must refuse routing for both; two paths would let one agent route on evidence the other rejected',
  },

  // --- the consent channel: the bus binds it, the two agents dial it --------------------------
  BUS_INTERNAL_ENDPOINT: {
    owners: [BUS_TEMPLATE, LIFE_TEMPLATE, FINANCE_TEMPLATE],
    gate: 'operator',
    secret: false,
    why: 'the bus listens on it and the two agents are its only clients (BUS_NETWORK_BINDING item 4); it is an internal-network address on a network with no gateway, so it is unreachable from outside by construction rather than by secrecy',
  },

  // --- the bus -------------------------------------------------------------------------------
  SIGNALS_DATA_DIR: { owners: [BUS_TEMPLATE], gate: 'G1', secret: false },
  SIGNALS_STORE_FILE: { owners: [BUS_TEMPLATE], gate: 'operator', secret: false },

  // --- the scheduler -------------------------------------------------------------------------
  LIFE_TICK_ENDPOINT: { owners: [SCHEDULER_TEMPLATE], gate: 'operator', secret: false },
  FINANCE_TICK_ENDPOINT: { owners: [SCHEDULER_TEMPLATE], gate: 'operator', secret: false },
  SCHEDULER_TICK_INTERVAL: { owners: [SCHEDULER_TEMPLATE], gate: 'operator', secret: false },

  // --- the backup --------------------------------------------------------------------------
  BACKUP_WORK_DIR: { owners: [BACKUP_TEMPLATE], gate: 'G1', secret: false },
  BACKUP_SCHEDULE: { owners: [BACKUP_TEMPLATE], gate: 'operator', secret: false },
  AGE_PUBLIC_KEY: { owners: [BACKUP_TEMPLATE], gate: 'G8', secret: false },
  BACKUP_ENCRYPTION_SCHEME: { owners: [BACKUP_TEMPLATE], gate: 'operator', secret: false },
  BACKUP_RETAIN_COUNT: { owners: [BACKUP_TEMPLATE], gate: 'operator', secret: false },
  BACKUP_FOLDER_REF: { owners: [BACKUP_TEMPLATE], gate: 'G5', secret: false },
  DRIVE_REFRESH_TOKEN: { owners: [BACKUP_TEMPLATE], gate: 'G5', secret: true },
  GOOGLE_CLIENT_ID: { owners: [BACKUP_TEMPLATE], gate: 'G5', secret: false },
  GOOGLE_CLIENT_SECRET: { owners: [BACKUP_TEMPLATE], gate: 'G5', secret: true },
  STORAGE_TOKEN_URL: { owners: [BACKUP_TEMPLATE], gate: 'operator', secret: false },

  // --- the halt, in both forms, in exactly the four services that mount the sentinel ---------
  [KILL_SENTINEL_ENTRY]: {
    owners: HALT_OWNERS,
    gate: 'G1',
    secret: false,
    why: '§8 checks the sentinel per call in every writer, and the sentinel volume is mounted at one target in each of them, so the path is identical by construction',
  },
  [KILL_SWITCH_ENTRY]: {
    owners: HALT_OWNERS,
    gate: 'operator',
    secret: false,
    why: '§8.2 names both agents, the scheduler, and the backup service as honourers of the coarse halt; one halt that reaches only some writers is not a halt',
  },
};

/**
 * Entries a code path resolves, bound to the configuration field that resolves them. The field is
 * checked to still exist in its source, so a rename there is a finding rather than a template that
 * silently stops matching the code.
 */
export interface CodeBinding {
  readonly entry: string;
  readonly source: string;
  readonly field: string;
}

export const PORT_SOURCE_FILES: readonly string[] = [
  'ports/telegram.ts',
  'ports/openrouter.ts',
  'ports/signalBus.ts',
  'ports/whoop.ts',
  'ports/drive.ts',
  'db/connection.ts',
];

export const CODE_BINDINGS: readonly CodeBinding[] = [
  { entry: 'MSG_API_BASE', source: 'ports/telegram.ts', field: 'apiBaseUrlRef' },
  { entry: 'LIFE_WEBHOOK_SECRET', source: 'ports/telegram.ts', field: 'expectedSecretToken' },
  { entry: 'MONEY_WEBHOOK_SECRET', source: 'ports/telegram.ts', field: 'expectedSecretToken' },
  { entry: 'ALLOWED_USER_IDS', source: 'ports/telegram.ts', field: 'allowedSenderIds' },
  { entry: 'TELEGRAM_MODE', source: 'ports/telegram.ts', field: 'mode' },
  { entry: 'MAX_WORK_ITEMS', source: 'ports/telegram.ts', field: 'maxConcurrentWorkItems' },
  { entry: 'MODEL_API_BASE', source: 'ports/openrouter.ts', field: 'apiBaseUrlRef' },
  { entry: 'OR_KEY_LIFE', source: 'ports/openrouter.ts', field: 'apiKeyRef' },
  { entry: 'OR_KEY_FINANCE', source: 'ports/openrouter.ts', field: 'apiKeyRef' },
  { entry: 'LIFE_WEEKLY_CAP', source: 'ports/openrouter.ts', field: 'weeklyCapMicroUsd' },
  { entry: 'FINANCE_WEEKLY_CAP', source: 'ports/openrouter.ts', field: 'weeklyCapMicroUsd' },
  { entry: KILL_SENTINEL_ENTRY, source: 'ports/openrouter.ts', field: 'killSwitchSentinelPathRef' },
  { entry: 'MODEL_ELIGIBILITY_REGISTRY_PATH', source: 'ports/openrouter.ts', field: 'eligibilityRegistryPathRef' },
  { entry: 'BUS_INTERNAL_ENDPOINT', source: 'ports/signalBus.ts', field: 'internalEndpointRef' },
  { entry: 'WHOOP_API_BASE', source: 'ports/whoop.ts', field: 'apiBaseUrlRef' },
  { entry: 'WHOOP_ACCESS_TOKEN', source: 'ports/whoop.ts', field: 'accessTokenRef' },
  { entry: 'BACKUP_FOLDER_REF', source: 'ports/drive.ts', field: 'folderRef' },
  { entry: 'BACKUP_RETAIN_COUNT', source: 'ports/drive.ts', field: 'retainCount' },
  { entry: 'AGE_PUBLIC_KEY', source: 'ports/drive.ts', field: 'recipientPublicKeyRef' },
  { entry: 'BACKUP_ENCRYPTION_SCHEME', source: 'ports/drive.ts', field: 'scheme' },
  { entry: 'FINANCE_DATA_DIR', source: 'db/connection.ts', field: 'dataDir' },
  { entry: 'FINANCE_STORE_FILE', source: 'db/connection.ts', field: 'fileName' },
  { entry: 'STORE_BUSY_TIMEOUT_MS', source: 'db/connection.ts', field: 'busyTimeoutMs' },
];

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const ENV_FINDING_CODES = [
  'ENV_TEMPLATE_UNREADABLE',
  'ENV_TEMPLATE_OUTSIDE_SUBSET',
  'COMPOSE_COMPANION_UNREADABLE',
  'ENV_FILE_PLACEHOLDER_UNMAPPED',
  'TEMPLATE_MISSING',
  'TEMPLATE_NOT_DECLARED_BY_COMPOSE',
  'HEADER_OWNERSHIP_MISSING',
  'ENTRY_DUPLICATED_IN_FILE',
  'ENTRY_VALUE_NOT_PLACEHOLDER',
  'ENTRY_VALUE_NOT_SELF_NAMED',
  'ENTRY_ANNOTATION_MISSING',
  'ENTRY_GATE_UNKNOWN',
  'ENTRY_SECRET_FLAG_INVALID',
  'ENTRY_SECRECY_UNEXPECTED',
  'REQUIRED_ENTRY_MISSING',
  'ENTRY_UNDECLARED',
  'ENTRY_SHARED_WITHOUT_REASON',
  'SHARED_ENTRY_IS_SECRET',
  'SHARED_ENTRY_UNUSED',
  'FOREIGN_SECRET_IN_FILE',
  'KILL_SWITCH_ENTRY_MISSING',
  'KILL_SENTINEL_ENTRY_MISSING',
  'KILL_SWITCH_ENTRY_UNEXPECTED',
  'WEEKLY_CAP_ENTRY_MISSING',
  'PORT_CONFIG_FIELD_ABSENT',
  'CODE_BOUND_ENTRY_MISSING',
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_SCAN_UNMAPPED',
] as const;

export type EnvFindingCode = (typeof ENV_FINDING_CODES)[number];

export interface EnvFinding {
  readonly code: EnvFindingCode;
  readonly detail: string;
}

/** The codes the shared no-deployment-particular scan is allowed to produce here. */
const SHARED_PARTICULAR_CODES: readonly string[] = [
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
  'PLACEHOLDER_MALFORMED',
];

/**
 * Re-report the shared scan's findings under this checker's code set. The R24 rule has ONE
 * implementation, in `./composeTemplate`, so a later change to it moves every template at once.
 *
 * A code this checker does not know how to report becomes `PARTICULAR_SCAN_UNMAPPED` rather than
 * being dropped: silently discarding a finding from a scan whose whole job is to fail closed would
 * turn a widened rule into a narrowed one.
 */
export function mapParticularFindings(input: readonly ComposeFinding[], where: string): readonly EnvFinding[] {
  const out: EnvFinding[] = [];
  for (const finding of input) {
    if (SHARED_PARTICULAR_CODES.includes(finding.code)) {
      out.push({ code: finding.code as EnvFindingCode, detail: `${where}: ${finding.detail}` });
    } else {
      out.push({
        code: 'PARTICULAR_SCAN_UNMAPPED',
        detail: `${where}: the shared no-deployment-particular scan reported ${finding.code}, which this checker has no code for: ${finding.detail}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading the companion topology
// ---------------------------------------------------------------------------------------------

/** service -> its declared `env_file` entries, or null when the topology cannot be read. */
export function envFilesByService(composeSource: string): ReadonlyMap<string, readonly string[]> | null {
  let services: unknown;
  try {
    services = parseComposeSubset(composeSource).services;
  } catch {
    return null;
  }
  if (services === undefined || typeof services !== 'object' || services === null || Array.isArray(services)) {
    return null;
  }
  const out = new Map<string, readonly string[]>();
  for (const [name, spec] of Object.entries(services as Record<string, unknown>)) {
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) continue;
    const declared = (spec as Record<string, unknown>).env_file;
    if (!Array.isArray(declared)) continue;
    const files: string[] = [];
    for (const item of declared) if (typeof item === 'string') files.push(item);
    out.set(name, files);
  }
  return out.size === 0 ? null : out;
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

export interface EnvAuditInput {
  /** logical template name (`finance.env`) -> its text. */
  readonly templates: Readonly<Record<string, string>>;
  readonly composeSource: string;
  /** port/db source path (`ports/openrouter.ts`) -> its text. */
  readonly portSources: Readonly<Record<string, string>>;
}

/**
 * Audit the template set. An empty array means every structural property the contract requires is
 * present. Any finding is a failure; there is no severity ladder, because none of these rules is
 * advisory.
 */
export function auditEnvTemplates(input: EnvAuditInput): readonly EnvFinding[] {
  const findings: EnvFinding[] = [];
  const note = (code: EnvFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  // --- the template set is exactly what the topology declares an env_file for ----------------
  const declaredByService = envFilesByService(input.composeSource);
  const requiredTemplates = new Set<string>();
  if (declaredByService === null) {
    note(
      'COMPOSE_COMPANION_UNREADABLE',
      'ops/docker-compose.yml could not be read as a service topology, so how many templates must exist cannot be decided here',
    );
  } else {
    for (const [service, files] of declaredByService) {
      for (const placeholder of files) {
        const mapped = ENV_PATH_TEMPLATE[placeholder];
        if (mapped === undefined) {
          note(
            'ENV_FILE_PLACEHOLDER_UNMAPPED',
            `service "${service}" reads env_file ${placeholder}, which no template stands behind; a service with a declared env_file and no template is a deployment that cannot start`,
          );
          continue;
        }
        if (mapped.service !== service) {
          note(
            'ENV_FILE_PLACEHOLDER_UNMAPPED',
            `service "${service}" reads env_file ${placeholder}, which belongs to ${mapped.service}; contract 12 §3.2.7 permits no service to read another's environment file`,
          );
          continue;
        }
        requiredTemplates.add(mapped.template);
        if (input.templates[mapped.template] === undefined) {
          note('TEMPLATE_MISSING', `service "${service}" reads ${placeholder} but ops/env/${mapped.template}${TRACKED_SUFFIX} was not supplied or could not be read`);
        }
      }
    }
    for (const name of Object.keys(input.templates)) {
      if (!requiredTemplates.has(name)) {
        note(
          'TEMPLATE_NOT_DECLARED_BY_COMPOSE',
          `ops/env/${name}${TRACKED_SUFFIX} exists but no service in ops/docker-compose.yml reads it; an environment file nothing loads is an environment file nobody maintains`,
        );
      }
    }
  }

  // --- per template ------------------------------------------------------------------------
  const seenIn = new Map<string, string[]>();
  const secretIn = new Map<string, string[]>();

  for (const name of Object.keys(input.templates).sort()) {
    const source = input.templates[name] ?? '';
    findings.push(...mapParticularFindings(scanForParticulars(source), name));

    let parsed: EnvTemplate;
    try {
      parsed = parseEnvTemplate(source);
    } catch (e) {
      note('ENV_TEMPLATE_OUTSIDE_SUBSET', `${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (!/contract\s*12/i.test(parsed.head) || !/phase\s*7/i.test(parsed.head)) {
      note('HEADER_OWNERSHIP_MISSING', `${name} does not declare its owning contract and phase in its first twenty lines`);
    }

    const namesHere = new Set<string>();
    for (const entry of parsed.entries) {
      if (namesHere.has(entry.name)) {
        note('ENTRY_DUPLICATED_IN_FILE', `${name} declares ${entry.name} twice; an environment reader keeps the last one, so the value a reader sees is not the value that applies`);
        continue;
      }
      namesHere.add(entry.name);
      auditEntry(name, entry, note);

      const where = seenIn.get(entry.name) ?? [];
      where.push(name);
      seenIn.set(entry.name, where);
      if (entry.annotation.secret === 'yes') {
        const secretWhere = secretIn.get(entry.name) ?? [];
        secretWhere.push(name);
        secretIn.set(entry.name, secretWhere);
      }
    }

    // the exact set, in both directions
    for (const [entryName, spec] of Object.entries(ENTRY_SPECS)) {
      if (spec.owners.includes(name) && !namesHere.has(entryName)) {
        note('REQUIRED_ENTRY_MISSING', `${name} does not declare ${entryName}, which contract 12 requires of it`);
      }
    }

    // the halt, in exactly the services the topology mounts the sentinel into
    const service = TEMPLATE_SERVICE[name];
    const isHaltConsumer = service !== undefined && KILL_SENTINEL_CONSUMERS.includes(service);
    if (isHaltConsumer) {
      if (!namesHere.has(KILL_SWITCH_ENTRY)) {
        note('KILL_SWITCH_ENTRY_MISSING', `${name} does not declare ${KILL_SWITCH_ENTRY}; steering §4 invariant 6 and contract 12 §8.2 require every writer to honour the coarse halt`);
      }
      if (!namesHere.has(KILL_SENTINEL_ENTRY)) {
        note('KILL_SENTINEL_ENTRY_MISSING', `${name} does not declare ${KILL_SENTINEL_ENTRY}; the per-call sentinel is the form that halts without a restart (§8.1), and the coarse variable does not substitute for it`);
      }
    } else {
      for (const halt of [KILL_SWITCH_ENTRY, KILL_SENTINEL_ENTRY]) {
        if (namesHere.has(halt)) {
          note('KILL_SWITCH_ENTRY_UNEXPECTED', `${name} declares ${halt}, but ops/docker-compose.yml mounts the sentinel volume into ${KILL_SENTINEL_CONSUMERS.join(', ')} only; a halt entry in a service that cannot examine the sentinel implies a writer that does not exist`);
        }
      }
    }

    const cap = AGENT_CAP_ENTRY[name];
    if (cap !== undefined && !namesHere.has(cap)) {
      note('WEEKLY_CAP_ENTRY_MISSING', `${name} does not declare ${cap}; steering §4 invariant 6 requires each agent to carry its own weekly ceiling, and §6.2 forbids one entry serving both`);
    }
  }

  // --- sharing: legitimate only, never a secret, and never a stale reason --------------------
  for (const [entryName, where] of seenIn) {
    const spec = ENTRY_SPECS[entryName];
    const unique = [...new Set(where)];
    if (unique.length > 1) {
      if (spec === undefined || spec.why === undefined) {
        note(
          'ENTRY_SHARED_WITHOUT_REASON',
          `${entryName} appears in ${unique.join(' and ')}, and no recorded reason permits it to be shared; contract 12 §3.2.7 makes one file per service the default and sharing the exception`,
        );
      }
      const secretWhere = secretIn.get(entryName);
      if (secretWhere !== undefined) {
        note(
          'SHARED_ENTRY_IS_SECRET',
          `${entryName} appears in ${unique.join(' and ')} and is annotated secret in ${secretWhere.join(', ')}; a secret in two files means one service holds another's secret, which R6 forbids`,
        );
      }
    }
    if (spec !== undefined && spec.owners.length > 1 && unique.length < 2) {
      note(
        'SHARED_ENTRY_UNUSED',
        `${entryName} carries a recorded reason for being shared but appears only in ${unique.join(', ') || 'no template'}; a reason for a sharing that no longer happens is documentation that has stopped describing the file`,
      );
    }
  }

  // --- no file holds a secret that belongs to another service -------------------------------
  for (const [entryName, spec] of Object.entries(ENTRY_SPECS)) {
    if (!spec.secret) continue;
    for (const where of seenIn.get(entryName) ?? []) {
      if (!spec.owners.includes(where)) {
        note(
          'FOREIGN_SECRET_IN_FILE',
          `${where} declares ${entryName}, which belongs to ${spec.owners.join(', ')}; contract 12 T4 requires that no service's environment file carry another's secret`,
        );
      }
    }
  }

  // --- the entry names are the names the code resolves --------------------------------------
  for (const binding of CODE_BINDINGS) {
    const source = input.portSources[binding.source];
    if (source === undefined || !new RegExp(`readonly\\s+${binding.field}\\b`).test(source)) {
      note(
        'PORT_CONFIG_FIELD_ABSENT',
        `src/server/${binding.source} no longer declares a configuration field "${binding.field}", which ${binding.entry} is bound to; a renamed field leaves the template describing an agreement the code no longer makes`,
      );
      continue;
    }
    const owners = ENTRY_SPECS[binding.entry]?.owners ?? [];
    for (const owner of owners) {
      if (input.templates[owner] === undefined) continue;
      if (!(seenIn.get(binding.entry) ?? []).includes(owner)) {
        note(
          'CODE_BOUND_ENTRY_MISSING',
          `${owner} declares no ${binding.entry}, but src/server/${binding.source} resolves it through "${binding.field}"; the entry name a template declares must be the name the code resolves`,
        );
      }
    }
  }

  return findings;
}

function auditEntry(template: string, entry: EnvEntry, note: (code: EnvFindingCode, detail: string) => void): void {
  const at = `${template}:${entry.line} ${entry.name}`;

  if (!PLACEHOLDER.test(entry.value)) {
    note(
      'ENTRY_VALUE_NOT_PLACEHOLDER',
      `${at} is set to something that is not an <ANGLE_BRACKET> placeholder; steering §0b admits no example value, no redacted stand-in of the right length, and no comment showing a value's shape`,
    );
  } else if (entry.value !== `<${entry.name}>`) {
    note(
      'ENTRY_VALUE_NOT_SELF_NAMED',
      `${at} is set to ${entry.value}; every entry's placeholder is its own name, so the operator has one thing to resolve per line and a reader cannot mistake one value for another`,
    );
  }

  const missing = (['what', 'gate', 'secret'] as const).filter((k) => entry.annotation[k] === null || entry.annotation[k] === '');
  if (missing.length > 0) {
    note(
      'ENTRY_ANNOTATION_MISSING',
      `${at} is missing its ${missing.join(', ')} annotation line; an entry nobody can trace to a gate is an entry the operator has to guess at`,
    );
  }

  const gate = entry.annotation.gate;
  if (gate !== null && gate !== '' && !GATE_VOCABULARY.includes(gate)) {
    note(
      'ENTRY_GATE_UNKNOWN',
      `${at} names gate "${gate}", which is not one of ${GATE_VOCABULARY.join(', ')}; G7 is absent on purpose, being closed as WONT-DO (contract 12 §9)`,
    );
  }

  const secret = entry.annotation.secret;
  if (secret !== null && secret !== '' && secret !== 'yes' && secret !== 'no') {
    note('ENTRY_SECRET_FLAG_INVALID', `${at} declares secret "${secret}"; the only answers are yes and no, because a maybe is treated as a no by whoever reads it in a hurry`);
  }

  const spec = ENTRY_SPECS[entry.name];
  if (spec === undefined) {
    note(
      'ENTRY_UNDECLARED',
      `${at} is not an entry contract 12 gives this service; an environment file that quietly grew an entry is an environment file nobody reviewed`,
    );
    return;
  }
  if (!spec.owners.includes(template)) {
    note(
      'ENTRY_UNDECLARED',
      `${at} belongs to ${spec.owners.join(', ')}, not to this file; contract 12 §3.2.7 gives each service its own file and no view of another's`,
    );
  }
  if ((secret === 'yes') !== spec.secret) {
    note(
      'ENTRY_SECRECY_UNEXPECTED',
      `${at} is annotated secret "${secret ?? '(absent)'}" but contract 12 treats it as ${spec.secret ? 'a secret' : 'not a secret'}; a mislabelled secret is either a value handled too loosely or a sharing rule refused for no reason`,
    );
  }
  if (gate !== null && gate !== '' && gate !== spec.gate) {
    note(
      'ENTRY_GATE_UNKNOWN',
      `${at} names gate "${gate}" but ops/GATE_REGISTER.md supplies it at ${spec.gate}; a value attributed to the wrong gate is a value the operator looks for in the wrong place`,
    );
  }
}

/**
 * Audit the templates in `envDir` against the topology at `composePath` and the port sources under
 * `serverDir`. An unreadable file is a finding, never a skip: the whole value of this check is that
 * it cannot pass by not running.
 */
export function auditEnvTemplateFiles(envDir: string, composePath: string, serverDir: string): readonly EnvFinding[] {
  const findings: EnvFinding[] = [];
  const templates: Record<string, string> = {};

  for (const { template } of Object.values(ENV_PATH_TEMPLATE)) {
    const path = join(envDir, `${template}${TRACKED_SUFFIX}`);
    try {
      templates[template] = readFileSync(path, 'utf8').split('\r\n').join('\n');
    } catch (e) {
      findings.push({
        code: 'ENV_TEMPLATE_UNREADABLE',
        detail: `${path} could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  let composeSource = '';
  try {
    composeSource = readFileSync(composePath, 'utf8');
  } catch {
    composeSource = '';
  }

  const portSources: Record<string, string> = {};
  for (const relative of PORT_SOURCE_FILES) {
    try {
      portSources[relative] = readFileSync(join(serverDir, relative), 'utf8');
    } catch {
      // Left absent on purpose: the audit reports PORT_CONFIG_FIELD_ABSENT, which is the same
      // finding a rename would produce, rather than skipping the binding check.
    }
  }

  findings.push(...auditEnvTemplates({ templates, composeSource, portSources }));
  return findings;
}
