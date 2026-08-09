/**
 * NIZAM · Structural audit of the host topology template (ops/docker-compose.yml)
 * Implemented by: PFOS Contract 12 / Phase 7.1 (spec 06-two-agent-vps)
 * Owning requirements: R6 (isolation), R9 (the bus is never reachable), R22 (health and restart),
 *   R24 (no deployment particular in a tracked file)
 * Binding requirement: ops/BUS_NETWORK_BINDING.md - its six numbered items for task 7.1
 * Depends on: node:fs, for the file entry point only. The audit itself is a pure function over text.
 *
 * WHY THIS EXISTS. The compose template is never executed here (steering §2: writing it is allowed,
 * running it is not), so the only way to know it still says what the contract requires is to READ it.
 * This module reads it. It parses the restricted YAML subset the template is written in and returns a
 * list of findings. `ops/docker-compose.yml` must produce an empty list.
 *
 * It is deliberately a text audit and not a container-tooling call. A tooling call would validate
 * syntax and resolve the file - it would not assert that the bus publishes no port, and it could not
 * run at all without the runtime the wall forbids touching.
 *
 * IT FAILS CLOSED. An unreadable file, a file outside the supported subset, a missing service, a
 * renamed network, an unused volume, and an unrecognized placeholder shape are all findings - not
 * skips. A checker that has only ever been observed passing is not evidence that it checks, so every
 * code below has a negative test in composeTemplate.test.ts that mutates the real template and
 * observes the code fire.
 */

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------------------------
// The parsed shape
// ---------------------------------------------------------------------------------------------

export type YamlValue = string | readonly YamlValue[] | YamlMap;
export interface YamlMap {
  readonly [key: string]: YamlValue;
}

/** Thrown for anything outside the supported subset. The subset is narrow on purpose: a template that
 *  needs anchors, flow collections, or multi-line scalars to say what it means is a template nobody
 *  can audit by eye either. */
export class ComposeSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeSubsetError';
  }
}

// ---------------------------------------------------------------------------------------------
// Parser for the supported subset: two-space block mappings, block sequences of scalars,
// `#` comments, single- or double-quoted scalars. No anchors, no flow collections, no block scalars.
// ---------------------------------------------------------------------------------------------

interface SourceLine {
  readonly indent: number;
  readonly text: string;
  readonly n: number;
}

/** Remove a trailing `# ...` comment that is not inside a quoted scalar. */
function stripInlineComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || text[i - 1] === ' ')) return text.slice(0, i).trimEnd();
  }
  if (quote !== null) throw new ComposeSubsetError(`unterminated quoted scalar in: ${text}`);
  return text;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' || first === "'") && first === last) return t.slice(1, -1);
  }
  return t;
}

function significantLines(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  const raw = source.split(/\r?\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i] ?? '';
    if (line.trim() === '') continue;
    if (/^\s*#/.test(line)) continue;
    if (line.includes('\t')) {
      throw new ComposeSubsetError(`line ${i + 1} contains a tab; the subset is two-space indentation only`);
    }
    const indent = line.length - line.trimStart().length;
    if (indent % 2 !== 0) throw new ComposeSubsetError(`line ${i + 1} is indented by ${indent}, which is not a multiple of two`);
    out.push({ indent, text: stripInlineComment(line.trim()), n: i + 1 });
  }
  return out;
}

interface Cursor {
  i: number;
  readonly lines: readonly SourceLine[];
}

function parseCollection(c: Cursor, indent: number): YamlValue {
  const first = c.lines[c.i];
  if (first === undefined) throw new ComposeSubsetError('unexpected end of document');
  return first.text.startsWith('-') ? parseSequence(c, indent) : parseMapping(c, indent);
}

function parseSequence(c: Cursor, indent: number): readonly YamlValue[] {
  const out: string[] = [];
  while (c.i < c.lines.length) {
    const line = c.lines[c.i];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new ComposeSubsetError(`line ${line.n} is indented deeper than its sequence`);
    if (!line.text.startsWith('-')) break;
    const rest = line.text === '-' ? '' : line.text.slice(1).trimStart();
    if (rest === '') throw new ComposeSubsetError(`line ${line.n} opens a nested collection inside a sequence, which the subset does not support`);
    if (/^[A-Za-z0-9_.-]+:(\s|$)/.test(rest)) {
      throw new ComposeSubsetError(`line ${line.n} nests a mapping inside a sequence, which the subset does not support`);
    }
    out.push(unquote(rest));
    c.i += 1;
  }
  if (out.length === 0) throw new ComposeSubsetError('an empty sequence is not a supported value');
  return out;
}

function parseMapping(c: Cursor, indent: number): YamlMap {
  const map: Record<string, YamlValue> = {};
  while (c.i < c.lines.length) {
    const line = c.lines[c.i];
    if (line === undefined) break;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new ComposeSubsetError(`line ${line.n} is indented deeper than its mapping`);
    if (line.text.startsWith('-')) throw new ComposeSubsetError(`line ${line.n} starts a sequence where a mapping key was expected`);
    const m = /^([^:]+):(?:\s+(.*))?$/.exec(line.text);
    if (m === null) throw new ComposeSubsetError(`line ${line.n} is not a supported mapping entry: ${line.text}`);
    const key = unquote(m[1] ?? '');
    if (key === '') throw new ComposeSubsetError(`line ${line.n} has an empty mapping key`);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new ComposeSubsetError(`line ${line.n} repeats the key "${key}"; a repeated key silently discards one of the two values`);
    }
    const inline = (m[2] ?? '').trim();
    c.i += 1;
    if (inline !== '') {
      map[key] = unquote(inline);
      continue;
    }
    const next = c.lines[c.i];
    if (next === undefined || next.indent <= indent) {
      throw new ComposeSubsetError(`key "${key}" on line ${line.n} has no value; an empty value in a topology template is always a mistake`);
    }
    map[key] = parseCollection(c, next.indent);
  }
  return map;
}

/** Parse the supported subset, or throw `ComposeSubsetError`. */
export function parseComposeSubset(source: string): YamlMap {
  const lines = significantLines(source);
  if (lines.length === 0) throw new ComposeSubsetError('the template is empty');
  const first = lines[0];
  if (first === undefined || first.indent !== 0) throw new ComposeSubsetError('the document does not start at the left margin');
  const cursor: Cursor = { i: 0, lines };
  const doc = parseMapping(cursor, 0);
  if (cursor.i !== lines.length) {
    const stopped = lines[cursor.i];
    throw new ComposeSubsetError(`parsing stopped before the end of the document, at line ${stopped?.n ?? 'unknown'}`);
  }
  return doc;
}

// ---------------------------------------------------------------------------------------------
// What the contract says the topology is. Named constants, so a rename in the template surfaces as a
// finding rather than as a check that quietly stops applying.
// ---------------------------------------------------------------------------------------------

export const PROXY_SERVICE = 'caddy';
export const LIFE_SERVICE = 'life-agent';
export const FINANCE_SERVICE = 'finance-agent';
export const BUS_SERVICE = 'signalbus';
export const SCHEDULER_SERVICE = 'scheduler';
export const BACKUP_SERVICE = 'backup';

/** Contract 12 §2.1. The optional shared router (§2.2.7) is deliberately absent (§6.2). */
export const EXPECTED_SERVICES: readonly string[] = [
  PROXY_SERVICE,
  LIFE_SERVICE,
  FINANCE_SERVICE,
  BUS_SERVICE,
  SCHEDULER_SERVICE,
  BACKUP_SERVICE,
];

export const AGENT_SERVICES: readonly string[] = [LIFE_SERVICE, FINANCE_SERVICE];

export const BUS_NETWORK = 'bus-internal';

/** BUS_NETWORK_BINDING item 4: the agents are the bus's only legitimate clients. Nothing else joins. */
export const BUS_NETWORK_MEMBERS: readonly string[] = [BUS_SERVICE, LIFE_SERVICE, FINANCE_SERVICE];

export const BUS_VOLUME = 'signal-data';

/** volume -> the one service that owns the store on it (contract 12 §3.1, §4.1). */
export const STORE_OWNERS: Readonly<Record<string, string>> = {
  'life-data': LIFE_SERVICE,
  'finance-data': FINANCE_SERVICE,
  [BUS_VOLUME]: BUS_SERVICE,
};

/** The kill sentinel volume (contract 12 §8). Read-only everywhere: no service clears its own halt. */
export const KILL_SENTINEL_VOLUME = 'kill-switch';

/** Services that must honour the kill switch (contract 12 §8, steering §4.6). */
export const KILL_SENTINEL_CONSUMERS: readonly string[] = [
  LIFE_SERVICE,
  FINANCE_SERVICE,
  SCHEDULER_SERVICE,
  BACKUP_SERVICE,
];

/**
 * Capacity floor for the reservation total. Contract 12 §2.2.8: limits may oversubscribe the host,
 * reservations may not. These are capacity constants for the arithmetic, held here rather than in
 * `ops/**` so the template carries no sizing figure at all.
 */
export const HOST_BUDGET = { cpus: 4, memoryMiB: 8192, reservedForHostMiB: 1024 } as const;

const HEALTHCHECK_KEYS: readonly string[] = ['test', 'interval', 'timeout', 'retries', 'start_period'];

/**
 * Log drivers that actually rotate. Contract 12 §2.2.9 requires a size cap AND a file cap, and both
 * are properties of the DRIVER: a driver that does not rotate accepts the two options and ignores
 * them, so a template could declare a perfect cap and still fill the volume. Checked as an allowlist
 * rather than a denylist, because the failure direction is "an unrecognized driver is assumed to
 * rotate", and that is the assumption §2.2.9 exists to remove. Added by task 7.5.
 */
export const ROTATING_LOG_DRIVERS: readonly string[] = ['json-file', 'local'];

/**
 * The bounded total the declared caps must fit inside, in MiB. §2.2.9's stated purpose is that "no log
 * stream can fill the volume that holds a store" — presence of a cap does not establish that, because
 * six services each capped generously still add up. The template's own figures multiply out
 * (size x files x services) and are asserted against this ceiling, so growing a cap or adding a
 * service surfaces as a finding rather than as arithmetic nobody did. Added by task 7.5.
 */
export const LOG_FOOTPRINT_BUDGET_MIB = 1024;

/** A placeholder is upper snake case inside angle brackets, and nothing else (R24). */
const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;
const ANY_ANGLE_TOKEN = /<[^<>\s]*>/g;

/** File suffixes that make a dotted token a path rather than a hostname. */
const PATH_SUFFIXES: readonly string[] = ['env', 'db', 'yml', 'yaml', 'json', 'md', 'ts', 'mjs', 'sock', 'log', 'age'];

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export const COMPOSE_FINDING_CODES = [
  'TEMPLATE_UNREADABLE',
  'TEMPLATE_OUTSIDE_SUBSET',
  'TOP_LEVEL_SECTION_MISSING',
  'SERVICE_SET_UNEXPECTED',
  'RESOURCE_LIMIT_MISSING',
  'RESOURCE_RESERVATION_MISSING',
  'RESOURCE_VALUE_UNPARSEABLE',
  'RESERVATION_EXCEEDS_LIMIT',
  'RESERVATIONS_OVERSUBSCRIBE_HOST',
  'HEALTHCHECK_MISSING',
  'HEALTHCHECK_INCOMPLETE',
  'RESTART_POLICY_MISSING',
  'LOG_ROTATION_MISSING',
  'LOG_ROTATION_DRIVER_NOT_ROTATING',
  'LOG_ROTATION_CAP_NOT_POSITIVE',
  'LOG_ROTATION_FOOTPRINT_UNBOUNDED',
  'BUS_NETWORK_MISSING',
  'BUS_NETWORK_NOT_INTERNAL',
  'BUS_SERVICE_MISSING',
  'BUS_ATTACHED_BEYOND_ITS_NETWORK',
  'BUS_PUBLISHES_PORT',
  'PORT_PUBLISHED_BY_NON_PROXY',
  'PUBLISHED_PORT_NOT_PLACEHOLDER',
  'AGENT_NOT_ON_BUS_NETWORK',
  'AGENT_HAS_NO_PROXY_FACING_NETWORK',
  'BUS_NETWORK_MEMBERSHIP_UNEXPECTED',
  'NON_INTERNAL_NETWORK_HOLDS_BOTH_AGENTS',
  'PROXY_ON_INTERNAL_NETWORK',
  'AGENT_MOUNTS_BUS_VOLUME',
  'AGENT_MOUNTS_FOREIGN_STORE',
  'FOREIGN_STORE_MOUNT_NOT_READ_ONLY',
  'BIND_MOUNT_NOT_READ_ONLY',
  'KILL_SENTINEL_MOUNT_NOT_READ_ONLY',
  'KILL_SENTINEL_NOT_MOUNTED',
  'VOLUME_DRIVER_NOT_LOCAL',
  'VOLUME_DECLARED_BUT_UNUSED',
  'VOLUME_USED_BUT_UNDECLARED',
  'NETWORK_DECLARED_BUT_UNUSED',
  'NETWORK_USED_BUT_UNDECLARED',
  'ENV_FILE_MISSING',
  'ENV_FILE_NOT_PLACEHOLDER',
  'ENV_FILE_SHARED_BETWEEN_SERVICES',
  'IMAGE_NOT_PLACEHOLDER',
  'PLACEHOLDER_MALFORMED',
  'PARTICULAR_URL_SCHEME',
  'PARTICULAR_ADDRESS_LITERAL',
  'PARTICULAR_HOSTNAME',
  'PARTICULAR_LONG_DIGIT_RUN',
  'PARTICULAR_CURRENCY_FIGURE',
] as const;

export type ComposeFindingCode = (typeof COMPOSE_FINDING_CODES)[number];

export interface ComposeFinding {
  readonly code: ComposeFindingCode;
  readonly detail: string;
}

// ---------------------------------------------------------------------------------------------
// Accessors that narrow without throwing
// ---------------------------------------------------------------------------------------------

function asMap(v: YamlValue | undefined): YamlMap | null {
  if (v === undefined || typeof v !== 'object' || v === null) return null;
  if (Array.isArray(v)) return null;
  return v as YamlMap;
}

function asScalarList(v: YamlValue | undefined): readonly string[] | null {
  if (v === undefined || !Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

function asScalar(v: YamlValue | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

function cpuValue(raw: string): number | null {
  return /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

function memoryMiB(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([kKmMgG])?[bB]?$/.exec(raw.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  if (unit === 'k') return n / 1024;
  if (unit === 'g') return n * 1024;
  return n;
}

interface Mount {
  readonly source: string;
  readonly target: string;
  readonly readOnly: boolean;
  readonly raw: string;
}

function parseMount(raw: string): Mount | null {
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const source = parts[0] ?? '';
  const target = parts[1] ?? '';
  const mode = parts[2] ?? '';
  if (source === '' || target === '') return null;
  return { source, target, readOnly: mode === 'ro', raw };
}

function isBindSource(source: string): boolean {
  return source.startsWith('/') || source.startsWith('.') || source.startsWith('<');
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

/**
 * Audit the template text. An empty array means every structural property the contract requires is
 * present. Any finding is a failure; there is no severity ladder, because none of these rules is
 * advisory.
 */
export function auditComposeTemplate(source: string): readonly ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  const note = (code: ComposeFindingCode, detail: string): void => {
    findings.push({ code, detail });
  };

  let doc: YamlMap;
  try {
    doc = parseComposeSubset(source);
  } catch (e) {
    note('TEMPLATE_OUTSIDE_SUBSET', e instanceof Error ? e.message : String(e));
    return findings;
  }

  const services = asMap(doc.services);
  const networks = asMap(doc.networks);
  const volumes = asMap(doc.volumes);
  if (services === null) note('TOP_LEVEL_SECTION_MISSING', 'there is no `services` mapping');
  if (networks === null) note('TOP_LEVEL_SECTION_MISSING', 'there is no `networks` mapping');
  if (volumes === null) note('TOP_LEVEL_SECTION_MISSING', 'there is no `volumes` mapping');
  if (services === null || networks === null || volumes === null) return findings;

  // --- the service set is exactly what the contract's topology names -------------------------
  const declared = Object.keys(services).sort();
  const expected = [...EXPECTED_SERVICES].sort();
  if (declared.join(',') !== expected.join(',')) {
    note('SERVICE_SET_UNEXPECTED', `services are [${declared.join(', ')}]; contract 12 §2.1 names [${expected.join(', ')}]`);
  }

  // --- per-service properties ----------------------------------------------------------------
  const networksOf = new Map<string, readonly string[]>();
  const mountsOf = new Map<string, readonly Mount[]>();
  const envFileOf = new Map<string, readonly string[]>();
  let reservedCpus = 0;
  let reservedMemory = 0;
  /** Task 7.5: the bounded total of every declared cap, in MiB (§2.2.9). */
  let logFootprintMiB = 0;

  for (const name of Object.keys(services)) {
    const svc = asMap(services[name]);
    if (svc === null) {
      note('SERVICE_SET_UNEXPECTED', `service "${name}" is not a mapping`);
      continue;
    }

    // image is a placeholder, never a resolvable registry reference (R24, §10.1's no-exception rule)
    const image = asScalar(svc.image);
    if (image === null || !PLACEHOLDER.test(image)) {
      note('IMAGE_NOT_PLACEHOLDER', `service "${name}" declares image ${image ?? '(absent)'}; it must be an <ANGLE_BRACKET> placeholder`);
    }

    // restart policy: per service, so a crash loop is contained (§3.2.6, §7.3)
    if (asScalar(svc.restart) === null) note('RESTART_POLICY_MISSING', `service "${name}" declares no restart policy`);

    // health check: actual readiness, polled with interval, timeout, retries and a grace period (§7.3)
    const health = asMap(svc.healthcheck);
    if (health === null) {
      note('HEALTHCHECK_MISSING', `service "${name}" declares no healthcheck, so the orchestrator cannot restart it on unhealthy (R22)`);
    } else {
      const missing = HEALTHCHECK_KEYS.filter((k) => health[k] === undefined);
      if (missing.length > 0) {
        note('HEALTHCHECK_INCOMPLETE', `service "${name}" healthcheck is missing ${missing.join(', ')}`);
      }
    }

    // log rotation: size cap AND file cap, so no stream can fill a store's volume (§2.2.9).
    // Task 7.5 strengthened this from presence to effect: the driver must be one that rotates, each
    // cap must parse to a POSITIVE figure, and the totals must fit a stated budget (below). A cap of
    // zero is the engine's spelling of "unlimited", so presence alone never established §2.2.9.
    const logging = asMap(svc.logging);
    const logOptions = logging === null ? null : asMap(logging.options);
    const maxSize = logOptions === null ? null : asScalar(logOptions['max-size']);
    const maxFile = logOptions === null ? null : asScalar(logOptions['max-file']);
    if (maxSize === null || maxFile === null) {
      note('LOG_ROTATION_MISSING', `service "${name}" does not cap both log size and log file count`);
    } else {
      const driver = logging === null ? null : asScalar(logging.driver);
      if (driver === null || !ROTATING_LOG_DRIVERS.includes(driver)) {
        note(
          'LOG_ROTATION_DRIVER_NOT_ROTATING',
          `service "${name}" declares log driver ${driver ?? '(absent)'}; a driver that does not rotate accepts max-size and max-file and ignores them, so the cap would be declared and not in force (§2.2.9)`,
        );
      }
      const sizeMiB = memoryMiB(maxSize);
      const files = /^\d+$/.test(maxFile.trim()) ? Number(maxFile.trim()) : null;
      if (sizeMiB === null || sizeMiB <= 0) {
        note(
          'LOG_ROTATION_CAP_NOT_POSITIVE',
          `service "${name}" declares max-size "${maxSize}", which is not a positive size; zero is the engine's spelling of "unlimited", so this caps nothing (§2.2.9)`,
        );
      }
      if (files === null || files <= 0) {
        note(
          'LOG_ROTATION_CAP_NOT_POSITIVE',
          `service "${name}" declares max-file "${maxFile}", which is not a positive count of files, so the number of rotated files is unbounded (§2.2.9)`,
        );
      }
      if (sizeMiB !== null && sizeMiB > 0 && files !== null && files > 0) {
        logFootprintMiB += sizeMiB * files;
      }
    }

    // resource ceilings: a limit AND a reservation, for every service including the bus (§2.2.8)
    const resources = asMap(asMap(svc.deploy)?.resources);
    const limits = asMap(resources?.limits);
    const reservations = asMap(resources?.reservations);
    const limitCpuRaw = limits === null ? null : asScalar(limits.cpus);
    const limitMemRaw = limits === null ? null : asScalar(limits.memory);
    const resCpuRaw = reservations === null ? null : asScalar(reservations.cpus);
    const resMemRaw = reservations === null ? null : asScalar(reservations.memory);
    if (limitCpuRaw === null || limitMemRaw === null) {
      note('RESOURCE_LIMIT_MISSING', `service "${name}" does not declare both a cpu and a memory limit`);
    }
    if (resCpuRaw === null || resMemRaw === null) {
      note('RESOURCE_RESERVATION_MISSING', `service "${name}" does not declare both a cpu and a memory reservation; a limit without a reservation lets another service starve it`);
    }
    const limitCpu = limitCpuRaw === null ? null : cpuValue(limitCpuRaw);
    const limitMem = limitMemRaw === null ? null : memoryMiB(limitMemRaw);
    const resCpu = resCpuRaw === null ? null : cpuValue(resCpuRaw);
    const resMem = resMemRaw === null ? null : memoryMiB(resMemRaw);
    for (const [label, raw, parsed] of [
      ['cpu limit', limitCpuRaw, limitCpu],
      ['memory limit', limitMemRaw, limitMem],
      ['cpu reservation', resCpuRaw, resCpu],
      ['memory reservation', resMemRaw, resMem],
    ] as const) {
      if (raw !== null && parsed === null) {
        note('RESOURCE_VALUE_UNPARSEABLE', `service "${name}" has an unreadable ${label}: ${raw}`);
      }
    }
    if (limitCpu !== null && resCpu !== null && resCpu > limitCpu) {
      note('RESERVATION_EXCEEDS_LIMIT', `service "${name}" reserves ${resCpu} cpu but is limited to ${limitCpu}`);
    }
    if (limitMem !== null && resMem !== null && resMem > limitMem) {
      note('RESERVATION_EXCEEDS_LIMIT', `service "${name}" reserves ${resMem}MiB but is limited to ${limitMem}MiB`);
    }
    reservedCpus += resCpu ?? 0;
    reservedMemory += resMem ?? 0;

    // exactly one environment file, and no service reads another's (§3.2.7, T4)
    const envFiles = asScalarList(svc.env_file);
    if (envFiles === null || envFiles.length !== 1) {
      note('ENV_FILE_MISSING', `service "${name}" must declare exactly one env_file entry`);
    } else {
      envFileOf.set(name, envFiles);
      for (const entry of envFiles) {
        if (!PLACEHOLDER.test(entry)) {
          note('ENV_FILE_NOT_PLACEHOLDER', `service "${name}" env_file "${entry}" is not an <ANGLE_BRACKET> placeholder`);
        }
      }
    }

    const attached = asScalarList(svc.networks) ?? [];
    if (attached.length === 0) {
      note('NETWORK_USED_BUT_UNDECLARED', `service "${name}" attaches to no network`);
    }
    networksOf.set(name, attached);
    for (const net of attached) {
      if (networks[net] === undefined) {
        note('NETWORK_USED_BUT_UNDECLARED', `service "${name}" attaches to undeclared network "${net}"`);
      }
    }

    const mountList = asScalarList(svc.volumes) ?? [];
    const mounts: Mount[] = [];
    for (const raw of mountList) {
      const mount = parseMount(raw);
      if (mount === null) {
        note('VOLUME_USED_BUT_UNDECLARED', `service "${name}" has an unreadable volume entry "${raw}"`);
        continue;
      }
      mounts.push(mount);
      if (isBindSource(mount.source)) {
        if (!mount.readOnly) {
          note('BIND_MOUNT_NOT_READ_ONLY', `service "${name}" binds host path ${mount.source} read-write; a bind mount is configuration only and must be :ro`);
        }
      } else if (volumes[mount.source] === undefined) {
        note('VOLUME_USED_BUT_UNDECLARED', `service "${name}" mounts undeclared volume "${mount.source}"`);
      }
    }
    mountsOf.set(name, mounts);

    // published ports: the proxy only, and every value a placeholder (§2.2.1, R24)
    const ports = asScalarList(svc.ports);
    if (ports !== null) {
      if (name === BUS_SERVICE) {
        note('BUS_PUBLISHES_PORT', 'the bus declares a ports entry; BUS_NETWORK_BINDING item 3 permits none, not even bound to a loopback address');
      } else if (name !== PROXY_SERVICE) {
        note('PORT_PUBLISHED_BY_NON_PROXY', `service "${name}" publishes a port; contract 12 §2.2.1 permits exactly one public entry point`);
      }
      for (const entry of ports) {
        const segments = entry.split(':');
        if (!segments.every((s) => PLACEHOLDER.test(s))) {
          note('PUBLISHED_PORT_NOT_PLACEHOLDER', `service "${name}" publishes "${entry}"; every port segment must be an <ANGLE_BRACKET> placeholder`);
        }
      }
    }
  }

  if (reservedCpus > HOST_BUDGET.cpus) {
    note('RESERVATIONS_OVERSUBSCRIBE_HOST', `reservations total ${reservedCpus} cpu, above the host budget of ${HOST_BUDGET.cpus}`);
  }
  const reservableMemory = HOST_BUDGET.memoryMiB - HOST_BUDGET.reservedForHostMiB;
  if (reservedMemory > reservableMemory) {
    note('RESERVATIONS_OVERSUBSCRIBE_HOST', `reservations total ${reservedMemory}MiB, above the reservable ${reservableMemory}MiB`);
  }

  // §2.2.9's actual purpose, arithmetic rather than presence (task 7.5). Every declared cap multiplied
  // out must fit a stated ceiling, so a generous cap on one service or a seventh service cannot quietly
  // reintroduce the risk the caps were added to remove.
  if (logFootprintMiB > LOG_FOOTPRINT_BUDGET_MIB) {
    note(
      'LOG_ROTATION_FOOTPRINT_UNBOUNDED',
      `the declared log caps total ${logFootprintMiB}MiB across all services, above the ${LOG_FOOTPRINT_BUDGET_MIB}MiB budget; §2.2.9 requires that no log stream can fill the volume that holds a store, which presence of a cap does not establish on its own`,
    );
  }

  // --- environment files are not shared -----------------------------------------------------
  const seenEnv = new Map<string, string>();
  for (const [name, files] of envFileOf) {
    for (const file of files) {
      const owner = seenEnv.get(file);
      if (owner !== undefined) {
        note('ENV_FILE_SHARED_BETWEEN_SERVICES', `${owner} and ${name} both read ${file}; one service must never read another's environment file`);
      } else {
        seenEnv.set(file, name);
      }
    }
  }

  // --- the bus network ----------------------------------------------------------------------
  const busNetwork = asMap(networks[BUS_NETWORK]);
  if (busNetwork === null) {
    note('BUS_NETWORK_MISSING', `no network named "${BUS_NETWORK}" is declared; BUS_NETWORK_BINDING item 1 requires one`);
  } else if (asScalar(busNetwork.internal) !== 'true') {
    note('BUS_NETWORK_NOT_INTERNAL', `network "${BUS_NETWORK}" does not carry internal: true; the flag is the mechanism, not a label (BUS_NETWORK_BINDING item 1)`);
  }

  // --- the bus service ---------------------------------------------------------------------
  if (services[BUS_SERVICE] === undefined) {
    note('BUS_SERVICE_MISSING', `no service named "${BUS_SERVICE}"; without it every bus assertion below would pass vacuously`);
  } else {
    const busNets = networksOf.get(BUS_SERVICE) ?? [];
    const beyond = busNets.filter((n) => n !== BUS_NETWORK);
    if (beyond.length > 0) {
      note('BUS_ATTACHED_BEYOND_ITS_NETWORK', `the bus is attached to ${beyond.join(', ')} as well as ${BUS_NETWORK}; BUS_NETWORK_BINDING item 2 permits the internal network and nothing else`);
    }
    if (!busNets.includes(BUS_NETWORK)) {
      note('BUS_ATTACHED_BEYOND_ITS_NETWORK', `the bus is not attached to ${BUS_NETWORK}`);
    }
  }

  // --- bus network membership is exactly the bus and the two agents (item 4) ----------------
  const busMembers = [...networksOf.entries()].filter(([, nets]) => nets.includes(BUS_NETWORK)).map(([svc]) => svc).sort();
  const expectedMembers = [...BUS_NETWORK_MEMBERS].sort();
  if (busMembers.join(',') !== expectedMembers.join(',')) {
    note('BUS_NETWORK_MEMBERSHIP_UNEXPECTED', `${BUS_NETWORK} holds [${busMembers.join(', ')}]; the agents are the bus's only legitimate clients, so it must hold exactly [${expectedMembers.join(', ')}]`);
  }

  // --- each agent: on the bus network, and on a proxy-facing network of its own -------------
  const internalNetworks = new Set(
    Object.keys(networks).filter((n) => asScalar(asMap(networks[n])?.internal) === 'true'),
  );
  for (const agent of AGENT_SERVICES) {
    const nets = networksOf.get(agent);
    if (nets === undefined) continue;
    if (!nets.includes(BUS_NETWORK)) {
      note('AGENT_NOT_ON_BUS_NETWORK', `${agent} is not attached to ${BUS_NETWORK}; BUS_NETWORK_BINDING item 4 requires it in addition to its proxy-facing network`);
    }
    if (!nets.some((n) => !internalNetworks.has(n))) {
      note('AGENT_HAS_NO_PROXY_FACING_NETWORK', `${agent} has no non-internal network, so the proxy cannot reach it and it has no egress`);
    }
  }

  // --- no non-internal network holds both agents (steering §4.2: the bus is the only channel)
  for (const net of Object.keys(networks)) {
    if (internalNetworks.has(net)) continue;
    const both = AGENT_SERVICES.every((a) => (networksOf.get(a) ?? []).includes(net));
    if (both) {
      note('NON_INTERNAL_NETWORK_HOLDS_BOTH_AGENTS', `network "${net}" is not internal and holds both agents, so they could address each other outside the bus`);
    }
  }

  // --- the proxy is on no internal network, so no proxy rule can reach the bus (item 2) -----
  for (const net of networksOf.get(PROXY_SERVICE) ?? []) {
    if (internalNetworks.has(net)) {
      note('PROXY_ON_INTERNAL_NETWORK', `the proxy is attached to internal network "${net}"; a proxy that shares a network with the bus is one rule away from publishing it`);
    }
  }

  // --- stores and the sentinel -------------------------------------------------------------
  for (const [name, mounts] of mountsOf) {
    for (const mount of mounts) {
      const owner = STORE_OWNERS[mount.source];
      if (owner !== undefined && owner !== name) {
        if (mount.source === BUS_VOLUME && AGENT_SERVICES.includes(name)) {
          note('AGENT_MOUNTS_BUS_VOLUME', `${name} mounts ${BUS_VOLUME}; BUS_NETWORK_BINDING item 5 forbids it, read-only or otherwise`);
        } else if (AGENT_SERVICES.includes(name)) {
          note('AGENT_MOUNTS_FOREIGN_STORE', `${name} mounts ${mount.source}, which belongs to ${owner}; R6 requires the file not be present in its namespace at all`);
        }
        if (!mount.readOnly) {
          note('FOREIGN_STORE_MOUNT_NOT_READ_ONLY', `${name} mounts ${mount.source} read-write but ${owner} owns it; contract 12 §3.2.2 permits read-only cross-store mounts only`);
        }
      }
      if (mount.source === KILL_SENTINEL_VOLUME && !mount.readOnly) {
        note('KILL_SENTINEL_MOUNT_NOT_READ_ONLY', `${name} mounts ${KILL_SENTINEL_VOLUME} read-write; no service may clear its own halt (contract 12 §8)`);
      }
    }
  }
  for (const consumer of KILL_SENTINEL_CONSUMERS) {
    if (services[consumer] === undefined) continue;
    const mounts = mountsOf.get(consumer) ?? [];
    if (!mounts.some((m) => m.source === KILL_SENTINEL_VOLUME)) {
      note('KILL_SENTINEL_NOT_MOUNTED', `${consumer} does not mount ${KILL_SENTINEL_VOLUME}, so the per-call sentinel check has no path to examine (contract 12 §8)`);
    }
  }

  // --- volumes: local driver, all used, none dangling (§3.2.5) ------------------------------
  const mountedSources = new Set([...mountsOf.values()].flat().map((m) => m.source));
  for (const volume of Object.keys(volumes)) {
    const spec = asMap(volumes[volume]);
    if (spec === null || asScalar(spec.driver) !== 'local') {
      note('VOLUME_DRIVER_NOT_LOCAL', `volume "${volume}" does not declare the local driver; a store on a network or synchronizing filesystem can be corrupted`);
    }
    if (!mountedSources.has(volume)) {
      note('VOLUME_DECLARED_BUT_UNUSED', `volume "${volume}" is declared but mounted nowhere`);
    }
  }
  const attachedNetworks = new Set([...networksOf.values()].flat());
  for (const net of Object.keys(networks)) {
    if (!attachedNetworks.has(net)) {
      note('NETWORK_DECLARED_BUT_UNUSED', `network "${net}" is declared but no service attaches to it`);
    }
  }

  findings.push(...scanForParticulars(source));
  return findings;
}

/**
 * Audit the template at `path`. An unreadable file is a finding, never a skip: the whole value of this
 * check is that it cannot pass by not running.
 */
export function auditComposeTemplateFile(path: string): readonly ComposeFinding[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return [{ code: 'TEMPLATE_UNREADABLE', detail: `${path} could not be read: ${e instanceof Error ? e.message : String(e)}` }];
  }
  return auditComposeTemplate(text);
}

/**
 * The no-deployment-particular scan over the raw text (R24, contract 12 §10.1). Deliberately over the
 * TEXT rather than the parse tree, so a particular hiding in a comment is caught too - a comment is a
 * tracked file just as much as a value is.
 *
 * Every forbidden token is assembled from fragments, so this module neither self-matches nor trips the
 * other scanners in the harness.
 */
export function scanForParticulars(source: string): readonly ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  const scheme = new RegExp('h' + 't' + 'tps?' + ':' + '\\/\\/', 'i');
  if (scheme.test(source)) {
    findings.push({ code: 'PARTICULAR_URL_SCHEME', detail: 'the template contains an absolute URL; every endpoint is injected at run time' });
  }
  const address = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.exec(source);
  if (address !== null) {
    findings.push({ code: 'PARTICULAR_ADDRESS_LITERAL', detail: 'the template contains an address literal' });
  }
  const longRun = /(?<![\d.])\d{7,}(?![\d.])/.exec(source);
  if (longRun !== null) {
    findings.push({
      code: 'PARTICULAR_LONG_DIGIT_RUN',
      detail: 'the template contains a long digit run, which is the shape of a messaging user identifier',
    });
  }
  const currency = new RegExp('(?:\\bUS' + 'D\\b|\\bEG' + 'P\\b|[\\u0024\\u00A3\\u20AC]\\s?\\d)', 'i').exec(source);
  if (currency !== null) {
    findings.push({ code: 'PARTICULAR_CURRENCY_FIGURE', detail: 'the template contains a currency-shaped figure' });
  }
  for (const token of source.matchAll(/(?<![A-Za-z0-9<>_-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?![A-Za-z0-9>])/g)) {
    const candidate = token[1] ?? '';
    const labels = candidate.split('.');
    const last = (labels[labels.length - 1] ?? '').toLowerCase();
    if (!/^[a-z]{2,}$/.test(last)) continue;
    if (PATH_SUFFIXES.includes(last)) continue;
    findings.push({ code: 'PARTICULAR_HOSTNAME', detail: `"${candidate}" reads as a hostname; write <DOMAIN> instead` });
  }
  for (const token of source.matchAll(ANY_ANGLE_TOKEN)) {
    const raw = token[0];
    if (!PLACEHOLDER.test(raw)) {
      findings.push({ code: 'PLACEHOLDER_MALFORMED', detail: `"${raw}" is not an upper-snake-case placeholder` });
    }
  }
  return findings;
}
