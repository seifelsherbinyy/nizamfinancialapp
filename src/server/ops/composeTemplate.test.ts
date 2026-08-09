// @vitest-environment node
/**
 * NIZAM · The host topology template says what the contract requires, and the checker fires
 * Implemented by: PFOS Contract 12 / Phase 7.1 (spec 06-two-agent-vps)
 * Owning requirements: R6 (isolation), R9 (the bus is never reachable), R22 (health and restart),
 *   R24 (no deployment particular)
 * Binding requirement: ops/BUS_NETWORK_BINDING.md, "What Phase 7 must do (7.1)", items 1-6
 * Depends on: ./composeTemplate, ops/docker-compose.yml (read from disk as text)
 *
 * Two halves, and the second is the one that matters.
 *
 * POSITIVE. The template on disk produces no finding, and each of the six numbered items in
 * BUS_NETWORK_BINDING is asserted separately off the parse tree, so a reader can see the requirement
 * and its evidence in the same place.
 *
 * NEGATIVE. Every finding code has a row in NEGATIVE_CASES that takes the real template, breaks one
 * property, and observes that code fire. A checker that has only ever been observed passing is not
 * evidence that it checks. The coverage test at the end fails if a code is added without a row, so the
 * negative half cannot fall behind the positive half.
 *
 * Nothing here executes the template. It is read as text and parsed in process (steering §2).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AGENT_SERVICES,
  BUS_NETWORK,
  BUS_NETWORK_MEMBERS,
  BUS_SERVICE,
  BUS_VOLUME,
  COMPOSE_FINDING_CODES,
  EXPECTED_SERVICES,
  HOST_BUDGET,
  LOG_FOOTPRINT_BUDGET_MIB,
  PROXY_SERVICE,
  ROTATING_LOG_DRIVERS,
  auditComposeTemplate,
  auditComposeTemplateFile,
  parseComposeSubset,
  type ComposeFindingCode,
  type YamlMap,
} from './composeTemplate';

const TEMPLATE_PATH = fileURLToPath(new URL('../../../ops/docker-compose.yml', import.meta.url));
/** Line endings are normalized so the mutation anchors below do not depend on the checkout's setting.
 *  The file entry point is exercised separately against the bytes on disk, whatever they are. */
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8').split('\r\n').join('\n');

function codesFor(source: string): readonly ComposeFindingCode[] {
  return auditComposeTemplate(source).map((f) => f.code);
}

/** A mutation that must actually change the template, so a rotted anchor fails loudly. */
function swap(from: string, to: string): (t: string) => string {
  return (t) => {
    if (!t.includes(from)) throw new Error(`negative-test anchor no longer present: ${JSON.stringify(from.slice(0, 70))}`);
    const next = t.replace(from, () => to);
    if (next === t) throw new Error('the mutation left the template unchanged, so the case would prove nothing');
    return next;
  };
}

// Shapes assembled from fragments, so this file never holds a contiguous copy of what the scan forbids
// and never trips the other scanners in the harness.
const URL_SHAPED = 'ht' + 'tp' + '://' + 'internal-probe';
const ADDRESS_SHAPED = ['198', '51', '100', '7'].join('.');
const HOSTNAME_SHAPED = 'money.' + 'exam' + 'ple' + '.' + 'inva' + 'lid';
const LONG_DIGIT_RUN = '12345' + '678';
const CURRENCY_SHAPED = 'US' + 'D' + ' 5.00';

interface NegativeCase {
  readonly code: ComposeFindingCode;
  readonly why: string;
  readonly apply: (template: string) => string;
}

const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    code: 'TEMPLATE_OUTSIDE_SUBSET',
    why: 'a repeated top-level key silently discards one of the two values',
    apply: (t) => `${t}\nservices:\n  smuggled:\n    image: "<SMUGGLED_IMAGE_REF>"\n`,
  },
  {
    code: 'TOP_LEVEL_SECTION_MISSING',
    why: 'the volumes section is renamed away',
    apply: swap('\nvolumes:\n', '\nvolume_definitions:\n'),
  },
  {
    code: 'SERVICE_SET_UNEXPECTED',
    why: 'a service the contract topology does not name appears',
    apply: swap('\n  scheduler:\n', '\n  timekeeper:\n'),
  },
  {
    code: 'RESOURCE_LIMIT_MISSING',
    why: 'the bus declares a reservation with no ceiling, so it could take the host down',
    apply: swap('        limits:\n          cpus: "0.25"\n          memory: 256M\n', ''),
  },
  {
    code: 'RESOURCE_RESERVATION_MISSING',
    why: 'a ceiling with no floor lets another service starve this one',
    apply: swap('        reservations:\n          cpus: "0.10"\n          memory: 64M\n', ''),
  },
  {
    code: 'RESOURCE_VALUE_UNPARSEABLE',
    why: 'an unreadable figure must fail, not be treated as absent',
    apply: swap('          cpus: "0.25"\n          memory: 256M', '          cpus: "a quarter"\n          memory: 256M'),
  },
  {
    code: 'RESERVATION_EXCEEDS_LIMIT',
    why: 'reserving more than the ceiling is a service that can never start',
    apply: swap('          cpus: "0.25"\n          memory: 256M', '          cpus: "0.05"\n          memory: 256M'),
  },
  {
    code: 'RESERVATIONS_OVERSUBSCRIBE_HOST',
    why: 'contract 12 §2.2.8 - limits may oversubscribe the host, reservations may not',
    apply: swap('          memory: 512M', `          memory: ${HOST_BUDGET.memoryMiB}M`),
  },
  {
    code: 'HEALTHCHECK_MISSING',
    why: 'without a health check the orchestrator cannot restart an unhealthy service (R22)',
    apply: swap('    healthcheck:\n', '    health_check:\n'),
  },
  {
    code: 'HEALTHCHECK_INCOMPLETE',
    why: 'a check with no start-up grace period restarts a service that is merely still starting',
    apply: swap('      start_period: 20s\n', '      grace_period: 20s\n'),
  },
  {
    code: 'RESTART_POLICY_MISSING',
    why: 'restart policy is per service so a crash loop stays contained (§3.2.6)',
    apply: swap('    restart: unless-stopped\n', ''),
  },
  {
    code: 'LOG_ROTATION_MISSING',
    why: 'an uncapped log stream can fill the volume that holds a store (§2.2.9)',
    apply: swap('        max-file: "5"\n', ''),
  },
  {
    code: 'LOG_ROTATION_DRIVER_NOT_ROTATING',
    why: 'a driver that does not rotate accepts both caps and ignores them, so the cap is declared and not in force (§2.2.9)',
    apply: swap('      driver: json-file\n', '      driver: syslog\n'),
  },
  {
    code: 'LOG_ROTATION_CAP_NOT_POSITIVE',
    why: 'zero is the engine spelling of unlimited, so a present size cap can still cap nothing (§2.2.9)',
    apply: swap('        max-size: 10m\n', '        max-size: 0\n'),
  },
  {
    code: 'LOG_ROTATION_CAP_NOT_POSITIVE',
    why: 'a file count of zero leaves the number of rotated files unbounded (§2.2.9)',
    apply: swap('        max-file: "5"\n', '        max-file: "0"\n'),
  },
  {
    code: 'LOG_ROTATION_FOOTPRINT_UNBOUNDED',
    why: '§2.2.9 requires that no stream can fill a store volume, and six generous caps still add up',
    apply: swap('        max-size: 10m\n', '        max-size: 4096m\n'),
  },
  {
    code: 'BUS_NETWORK_MISSING',
    why: 'the network BUS_NETWORK_BINDING item 1 requires is gone',
    apply: swap('  bus-internal:\n    driver: bridge\n    internal: true\n', '  bus-net:\n    driver: bridge\n    internal: true\n'),
  },
  {
    code: 'BUS_NETWORK_NOT_INTERNAL',
    why: 'dropping the internal flag turns refusal at the network layer into a reachable port',
    apply: swap('    internal: true\n', '    internal: false\n'),
  },
  {
    code: 'BUS_SERVICE_MISSING',
    why: 'without the bus service every bus assertion would pass vacuously',
    apply: swap('\n  signalbus:\n', '\n  bus:\n'),
  },
  {
    code: 'BUS_ATTACHED_BEYOND_ITS_NETWORK',
    why: 'BUS_NETWORK_BINDING item 2 - the bus joins the internal network and nothing else',
    apply: swap(
      '    networks:\n      - bus-internal\n    volumes:\n      - "signal-data:/data"',
      '    networks:\n      - bus-internal\n      - edge-life\n    volumes:\n      - "signal-data:/data"',
    ),
  },
  {
    code: 'BUS_PUBLISHES_PORT',
    why: 'BUS_NETWORK_BINDING item 3 - no ports entry at all, not even on a loopback address',
    apply: swap(
      '    networks:\n      - bus-internal\n    volumes:\n      - "signal-data:/data"',
      '    ports:\n      - "<BUS_PORT>:<BUS_PORT>"\n    networks:\n      - bus-internal\n    volumes:\n      - "signal-data:/data"',
    ),
  },
  {
    code: 'PORT_PUBLISHED_BY_NON_PROXY',
    why: 'contract 12 §2.2.1 - exactly one public entry point',
    apply: swap(
      '    volumes:\n      - "finance-data:/data"',
      '    ports:\n      - "<FINANCE_PORT>:<FINANCE_PORT>"\n    volumes:\n      - "finance-data:/data"',
    ),
  },
  {
    code: 'PUBLISHED_PORT_NOT_PLACEHOLDER',
    why: 'a resolved port assignment is a deployment particular (R24)',
    apply: swap('"<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"', '"8443:8443"'),
  },
  {
    code: 'AGENT_NOT_ON_BUS_NETWORK',
    why: 'BUS_NETWORK_BINDING item 4 - each agent joins the bus network as well as its own',
    apply: swap('      - edge-life\n      - bus-internal\n      - ops-internal\n', '      - edge-life\n      - ops-internal\n'),
  },
  {
    code: 'AGENT_HAS_NO_PROXY_FACING_NETWORK',
    why: 'an agent with no non-internal network cannot be reached by the proxy and has no egress',
    apply: swap('      - edge-life\n      - bus-internal\n      - ops-internal\n', '      - bus-internal\n      - ops-internal\n'),
  },
  {
    code: 'BUS_NETWORK_MEMBERSHIP_UNEXPECTED',
    why: 'BUS_NETWORK_BINDING item 4 - the agents are the bus\u2019s only legitimate clients',
    apply: swap('    networks:\n      - ops-internal\n', '    networks:\n      - ops-internal\n      - bus-internal\n'),
  },
  {
    code: 'NON_INTERNAL_NETWORK_HOLDS_BOTH_AGENTS',
    why: 'steering §4.2 - the bus is the only channel, so the agents share no reachable network',
    apply: swap('      - edge-money\n      - bus-internal\n', '      - edge-life\n      - bus-internal\n'),
  },
  {
    code: 'PROXY_ON_INTERNAL_NETWORK',
    why: 'a proxy adjacent to the bus is one rule away from publishing it (item 2)',
    apply: swap('    networks:\n      - edge-life\n      - edge-money\n', '    networks:\n      - edge-life\n      - edge-money\n      - bus-internal\n'),
  },
  {
    code: 'AGENT_MOUNTS_BUS_VOLUME',
    why: 'BUS_NETWORK_BINDING item 5 - no agent mounts the bus volume, read-only or otherwise',
    apply: swap('      - "finance-data:/data"\n', '      - "finance-data:/data"\n      - "signal-data:/signals:ro"\n'),
  },
  {
    code: 'AGENT_MOUNTS_FOREIGN_STORE',
    why: 'R6 - the other agent\u2019s store must not be present in the namespace at all',
    apply: swap('      - "finance-data:/data"\n', '      - "finance-data:/data"\n      - "life-data:/other:ro"\n'),
  },
  {
    code: 'FOREIGN_STORE_MOUNT_NOT_READ_ONLY',
    why: 'contract 12 §3.2.2 - the only cross-store mounts are read-only',
    apply: swap('      - "signal-data:/stores/signal:ro"\n', '      - "signal-data:/stores/signal"\n'),
  },
  {
    code: 'BIND_MOUNT_NOT_READ_ONLY',
    why: 'a bind mount carries configuration only and must never be writable',
    apply: swap('"<PROXY_CONFIG_FILE>:/etc/caddy/Caddyfile:ro"', '"<PROXY_CONFIG_FILE>:/etc/caddy/Caddyfile"'),
  },
  {
    code: 'KILL_SENTINEL_MOUNT_NOT_READ_ONLY',
    why: 'contract 12 §8 - no service may clear its own halt',
    apply: swap('      - "kill-switch:/run/nizam-kill:ro"\n', '      - "kill-switch:/run/nizam-kill"\n'),
  },
  {
    code: 'KILL_SENTINEL_NOT_MOUNTED',
    why: 'a per-call sentinel check needs a path to examine',
    apply: swap('      - "kill-switch:/run/nizam-kill:ro"\n', ''),
  },
  {
    code: 'VOLUME_DRIVER_NOT_LOCAL',
    why: 'a write-ahead-logged store on a network filesystem can be corrupted (§3.2.5)',
    apply: swap('  signal-data:\n    driver: local\n', '  signal-data:\n    driver: remote\n'),
  },
  {
    code: 'VOLUME_DECLARED_BUT_UNUSED',
    why: 'a dangling volume is either a leftover or a mount someone forgot to wire',
    apply: swap('  backup-work:\n    driver: local\n', '  backup-work:\n    driver: local\n  orphan-data:\n    driver: local\n'),
  },
  {
    code: 'VOLUME_USED_BUT_UNDECLARED',
    why: 'an undeclared volume name is created implicitly, outside the declared topology',
    apply: swap('      - "finance-data:/data"\n', '      - "finance-ledger:/data"\n'),
  },
  {
    code: 'NETWORK_DECLARED_BUT_UNUSED',
    why: 'a dangling network hides a service that was meant to join it',
    apply: swap('  egress-backup:\n    driver: bridge\n', '  egress-backup:\n    driver: bridge\n  orphan-net:\n    driver: bridge\n'),
  },
  {
    code: 'NETWORK_USED_BUT_UNDECLARED',
    why: 'an undeclared network is created implicitly, with defaults nobody reviewed',
    apply: swap('    networks:\n      - ops-internal\n    volumes:', '    networks:\n      - ops-jobs\n    volumes:'),
  },
  {
    code: 'ENV_FILE_MISSING',
    why: 'contract 12 §3.2.7 - one environment file per service, outside the repository',
    apply: swap('    env_file:\n      - "<BUS_ENV_PATH>"\n', ''),
  },
  {
    code: 'ENV_FILE_NOT_PLACEHOLDER',
    why: 'a resolved configuration path is a deployment particular (R24)',
    apply: swap('"<BUS_ENV_PATH>"', '"/etc/somewhere/bus.env"'),
  },
  {
    code: 'ENV_FILE_SHARED_BETWEEN_SERVICES',
    why: 'test T4 - no service reads another service\u2019s environment file',
    apply: swap('"<FINANCE_ENV_PATH>"', '"<LIFE_ENV_PATH>"'),
  },
  {
    code: 'IMAGE_NOT_PLACEHOLDER',
    why: 'a resolvable image reference reveals how the deployment is assembled (R24)',
    apply: swap('image: "<BUS_IMAGE_REF>"', 'image: "signalbus:1"'),
  },
  {
    code: 'PLACEHOLDER_MALFORMED',
    why: 'a placeholder that is not upper snake case will not be recognized by the operator or by 9.0',
    apply: swap('<STACK_NAME>', '<stackName>'),
  },
  {
    code: 'PARTICULAR_URL_SCHEME',
    why: 'R24 - every endpoint is injected at run time, never written down',
    apply: swap('"<PROXY_HEALTH_PROBE>"', `"${URL_SHAPED}"`),
  },
  {
    code: 'PARTICULAR_ADDRESS_LITERAL',
    why: 'R24 - no address of the host in any notation',
    apply: swap('"<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>"', `"${ADDRESS_SHAPED}:<PROXY_TLS_CONTAINER_PORT>"`),
  },
  {
    code: 'PARTICULAR_HOSTNAME',
    why: 'R24 - write <DOMAIN>, never a name',
    apply: swap('"<PROXY_HEALTH_PROBE>"', `"${HOSTNAME_SHAPED}"`),
  },
  {
    code: 'PARTICULAR_LONG_DIGIT_RUN',
    why: 'R24 - a long digit run is the shape of a messaging user identifier',
    apply: swap('      retries: 3\n', `      retries: ${LONG_DIGIT_RUN}\n`),
  },
  {
    code: 'PARTICULAR_CURRENCY_FIGURE',
    why: 'R24 - no real monetary figure, including in a comment',
    apply: swap('\nservices:\n', `\n# weekly cap ${CURRENCY_SHAPED}\nservices:\n`),
  },
];

describe('the template on disk is the shape contract 12 requires', () => {
  it('parses as the supported subset and declares the three top-level sections', () => {
    const doc = parseComposeSubset(TEMPLATE);
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(['name', 'networks', 'volumes', 'services']));
  });

  it('produces no finding at all', () => {
    const findings = auditComposeTemplate(TEMPLATE);
    expect(findings.map((f) => `${f.code}: ${f.detail}`)).toEqual([]);
  });

  it('declares exactly the service set of contract 12 §2.1, and no shared router (§2.2.7, §6.2)', () => {
    const services = parseComposeSubset(TEMPLATE).services as YamlMap;
    expect(Object.keys(services).sort()).toEqual([...EXPECTED_SERVICES].sort());
    expect(Object.keys(services)).not.toContain('router');
  });

  it('gives every service a cpu and memory limit AND reservation (§2.2.8), including the bus', () => {
    const services = parseComposeSubset(TEMPLATE).services as YamlMap;
    for (const name of Object.keys(services)) {
      const resources = ((services[name] as YamlMap).deploy as YamlMap).resources as YamlMap;
      const limits = resources.limits as YamlMap;
      const reservations = resources.reservations as YamlMap;
      expect(typeof limits.cpus, `${name} cpu limit`).toBe('string');
      expect(typeof limits.memory, `${name} memory limit`).toBe('string');
      expect(typeof reservations.cpus, `${name} cpu reservation`).toBe('string');
      expect(typeof reservations.memory, `${name} memory reservation`).toBe('string');
    }
  });

  it('gives every service a health check the orchestrator can act on (§7.3, R22)', () => {
    const services = parseComposeSubset(TEMPLATE).services as YamlMap;
    for (const name of Object.keys(services)) {
      const health = (services[name] as YamlMap).healthcheck as YamlMap;
      expect(Object.keys(health).sort(), `${name} healthcheck`).toEqual(['interval', 'retries', 'start_period', 'test', 'timeout']);
    }
  });

  it('caps every log stream with a rotating driver and positive figures that total inside a budget (§2.2.9)', () => {
    // Task 7.5. §2.2.9 requires that no log stream can FILL the volume that holds a store, which the
    // presence of two option keys does not establish: a non-rotating driver ignores them, and zero is
    // the engine's spelling of "unlimited". So the effect is asserted, and the totals are arithmetic.
    const services = parseComposeSubset(TEMPLATE).services as YamlMap;
    let totalMiB = 0;
    for (const name of Object.keys(services)) {
      const logging = (services[name] as YamlMap).logging as YamlMap;
      expect(ROTATING_LOG_DRIVERS, `${name} log driver rotates`).toContain(logging.driver as string);
      const options = logging.options as YamlMap;
      const size = /^(\d+)m$/.exec(options['max-size'] as string);
      const files = /^(\d+)$/.exec(options['max-file'] as string);
      expect(size, `${name} max-size is a positive size in MiB`).not.toBeNull();
      expect(files, `${name} max-file is a positive count`).not.toBeNull();
      const sizeMiB = Number(size?.[1] ?? 0);
      const fileCount = Number(files?.[1] ?? 0);
      expect(sizeMiB, `${name} max-size`).toBeGreaterThan(0);
      expect(fileCount, `${name} max-file`).toBeGreaterThan(0);
      totalMiB += sizeMiB * fileCount;
    }
    expect(totalMiB).toBeGreaterThan(0);
    expect(totalMiB).toBeLessThanOrEqual(LOG_FOOTPRINT_BUDGET_MIB);
  });
});

describe('ops/BUS_NETWORK_BINDING.md, the six numbered items for task 7.1', () => {
  const doc = parseComposeSubset(TEMPLATE);
  const services = doc.services as YamlMap;
  const networks = doc.networks as YamlMap;
  const bus = services[BUS_SERVICE] as YamlMap;

  it('1. the bus network carries the internal flag, which is the mechanism and not a label', () => {
    expect((networks[BUS_NETWORK] as YamlMap).internal).toBe('true');
  });

  it('2. the bus is attached to that network and to nothing else - in particular not the proxy\u2019s', () => {
    expect(bus.networks).toEqual([BUS_NETWORK]);
    const proxyNets = (services[PROXY_SERVICE] as YamlMap).networks as readonly string[];
    expect(proxyNets).not.toContain(BUS_NETWORK);
  });

  it('3. the bus publishes no port - there is no ports key at all', () => {
    expect(bus.ports).toBeUndefined();
    expect(Object.keys(bus)).not.toContain('ports');
  });

  it('4. each agent is on the bus network in addition to its own proxy-facing network, and nothing else is', () => {
    const members = Object.keys(services).filter((s) => ((services[s] as YamlMap).networks as readonly string[]).includes(BUS_NETWORK));
    expect(members.sort()).toEqual([...BUS_NETWORK_MEMBERS].sort());
    for (const agent of AGENT_SERVICES) {
      const nets = (services[agent] as YamlMap).networks as readonly string[];
      const nonInternal = nets.filter((n) => (networks[n] as YamlMap).internal !== 'true');
      expect(nonInternal.length, `${agent} proxy-facing networks`).toBe(1);
    }
  });

  it('5. the bus volume is mounted into the bus service, and no agent mounts it in any mode', () => {
    expect(bus.volumes).toEqual([`${BUS_VOLUME}:/data`]);
    for (const agent of AGENT_SERVICES) {
      const mounts = (services[agent] as YamlMap).volumes as readonly string[];
      expect(mounts.some((m) => m.startsWith(`${BUS_VOLUME}:`)), `${agent} must not mount ${BUS_VOLUME}`).toBe(false);
    }
  });

  it('6. the bus has its own cpu and memory limit and reservation, like every other service', () => {
    const resources = (bus.deploy as YamlMap).resources as YamlMap;
    expect(Object.keys(resources).sort()).toEqual(['limits', 'reservations']);
  });
});

describe('every check fires - the negative half', () => {
  it.each(NEGATIVE_CASES.map((c) => [c.code, c.why, c] as const))('%s fires when %s', (code, _why, testCase) => {
    const broken = testCase.apply(TEMPLATE);
    expect(broken).not.toBe(TEMPLATE);
    expect(codesFor(broken)).toContain(code);
  });

  it('an unreadable template is a finding, never a skip', () => {
    const findings = auditComposeTemplateFile(`${TEMPLATE_PATH}.does-not-exist`);
    expect(findings.map((f) => f.code)).toEqual(['TEMPLATE_UNREADABLE']);
  });

  it('the file entry point agrees with the text entry point on the real template', () => {
    expect(auditComposeTemplateFile(TEMPLATE_PATH)).toEqual([]);
  });

  it('every finding code has a negative case, so the negative half cannot fall behind', () => {
    const covered = new Set<string>([...NEGATIVE_CASES.map((c) => c.code), 'TEMPLATE_UNREADABLE']);
    const uncovered = COMPOSE_FINDING_CODES.filter((c) => !covered.has(c));
    expect(uncovered).toEqual([]);
  });
});
