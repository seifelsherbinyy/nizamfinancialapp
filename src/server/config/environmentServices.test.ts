// @vitest-environment node
/**
 * NIZAM · The environment loader over all six services, and the aggregate refusal
 * Implemented by: PFOS Contract 12 / Phase 10, task 10.2 (spec 06-two-agent-vps, mandate §6.1)
 * Owning requirements: R27 (six services, one process-environment bridge, every missing entry in a
 *   single message, no default for anything, an unsubstituted placeholder is a failure rather than
 *   a value), R25 (an absent allowlist is a decision, an unfilled one is a mistake),
 *   R24 (no deployment particular in a tracked file), R17 (per-service independence)
 * Depends on: ./environment, ../ops/envTemplates (`parseEnvTemplate`, reused rather than
 *   re-derived), node:fs (reading the six templates and the topology only)
 *
 * FOUR KINDS OF ASSERTION, AND THE THIRD IS THE HEADLINE.
 *
 *  1. **The table is the templates.** `ops/env/*.env.example` is the source of truth for entry
 *     names, so the six groups in the loader are compared against the six parsed templates set for
 *     set, in BOTH directions, plus their exact counts. An entry invented in code or renamed in a
 *     template is a failing test rather than a loader that quietly stops matching the deployment.
 *  2. **Independence is structural.** Each service's group is checked to exclude the entries that
 *     belong to another service — which is the same property the two-agent suite asserts, held over
 *     six identities instead of two, and an unknown identity is refused rather than defaulted.
 *  3. **The aggregate names EVERY finding.** Removing ONE entry proves nothing: a loader that
 *     refuses on the first thing it meets passes that test too. So every case here removes or
 *     breaks MORE THAN ONE and reads the single message for all of them.
 *  4. **No message carries a value.** Every synthetic value below is a recognizable marker, and the
 *     messages are searched for every one of them.
 *
 * Every value is synthetic and obviously so (R24, steering §0b): no real token, identifier, bot,
 * host, domain, or path of any deployment appears, and the `syn-` prefix says as much on sight.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseEnvTemplate } from '../ops/envTemplates';
import {
  ABSENCE_IS_A_DECISION,
  DEPLOYMENT_SERVICES,
  EnvConfigAggregateError,
  EnvConfigError,
  KILL_SENTINEL_ENTRY,
  KILL_SENTINEL_MOUNT_TARGET,
  KILL_SENTINEL_SERVICES,
  SERVICE_ENTRY_NAMES,
  SHARED_ENTRIES,
  SHARED_ENTRY_AGREEMENTS,
  classifyEntry,
  collectCrossServiceFindings,
  collectDeploymentFindings,
  collectForeignEntryFindings,
  collectKillSentinelFindings,
  collectServiceFindings,
  collectSharedEntryDisagreements,
  describeServiceConfiguredPresence,
  isDeploymentService,
  requireCrossServiceAgreement,
  requireDeploymentEnvironment,
  requireServiceEnvironment,
  serviceEntryNames,
  type DeploymentService,
  type EnvByService,
  type EnvSource,
} from './environment';

const LOADER_SOURCE_PATH = 'src/server/config/environment.ts';
const TEMPLATE_DIR = 'ops/env';
const COMPOSE_PATH = 'ops/docker-compose.yml';

/** The entry count each template was authored with. A count is the one assertion a renamed entry
 *  cannot satisfy by accident, so it is written out rather than derived. */
const AUTHORED_ENTRY_COUNT: Readonly<Record<DeploymentService, number>> = {
  life: 19,
  finance: 17,
  proxy: 6,
  bus: 3,
  scheduler: 5,
  backup: 12,
};

const SENTINEL_PATH = `${KILL_SENTINEL_MOUNT_TARGET}/halt`;
const SYNTHETIC_BASE = 'https://provider.invalid';
const SYNTHETIC_SENDER = '101';

/**
 * A synthetic value for one entry, derived from the entry NAME so a value shared between two
 * services is identical in both without a table saying so. A handful of entries have a shape the
 * loader or its guards insist on, and those are spelled out.
 */
function syntheticValue(entry: string): string {
  if (entry === SHARED_ENTRIES.allowedSenderIds) return SYNTHETIC_SENDER;
  if (entry === SHARED_ENTRIES.mode) return 'longPoll';
  if (entry === SHARED_ENTRIES.maxWorkItems) return '2';
  if (entry === KILL_SENTINEL_ENTRY) return SENTINEL_PATH;
  if (entry === 'NIZAM_KILL_ALL') return '0';
  if (entry.endsWith('_API_BASE') || entry.endsWith('_TOKEN_URL')) return SYNTHETIC_BASE;
  if (entry.endsWith('_WEEKLY_CAP')) return '2500000';
  if (entry.endsWith('_CONTAINER_PORT')) return '9000';
  if (entry.endsWith('_RETAIN_COUNT') || entry.endsWith('_TIMEOUT_MS')) return '3';
  return `syn-${entry.toLowerCase()}`;
}

/** A complete, valid environment for one service, minus or plus whatever a case overrides. */
function envFor(service: DeploymentService, overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {};
  for (const entry of SERVICE_ENTRY_NAMES[service]) base[entry] = syntheticValue(entry);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

/** A complete environment for every one of the six services. */
function deploymentEnv(): EnvByService {
  const out: Partial<Record<DeploymentService, EnvSource>> = {};
  for (const service of DEPLOYMENT_SERVICES) out[service] = envFor(service);
  return out;
}

/** One service's environment and no other's, so a cross-service rule is read in isolation. */
function only(service: DeploymentService, env: EnvSource): EnvByService {
  const out: Partial<Record<DeploymentService, EnvSource>> = {};
  out[service] = env;
  return out;
}

/** The aggregate a call refused with, or `null` if it did not refuse. */
function aggregate(run: () => unknown): EnvConfigAggregateError | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof EnvConfigAggregateError) return e;
    throw e;
  }
}

function templateEntryNames(service: DeploymentService): readonly string[] {
  const source = readFileSync(join(TEMPLATE_DIR, `${service}.env.example`), 'utf8');
  return parseEnvTemplate(source).entries.map((entry) => entry.name);
}

/** Every `.ts`/`.tsx` file under a root, repo-relative and forward-slashed. */
function walkSource(root: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name).split('\\').join('/');
    if (entry.isDirectory()) out.push(...walkSource(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('the six service groups are the six templates, in both directions (R27)', () => {
  it('names every service the deployment declares, and nothing else', () => {
    expect([...DEPLOYMENT_SERVICES]).toEqual(['life', 'finance', 'proxy', 'bus', 'scheduler', 'backup']);
    expect(Object.keys(SERVICE_ENTRY_NAMES).sort()).toEqual([...DEPLOYMENT_SERVICES].sort());
  });

  it('declares exactly the entries its own template declares, per service', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      const fromTemplate = [...templateEntryNames(service)].sort();
      const fromLoader = [...serviceEntryNames(service)].sort();
      expect(fromLoader, `${service}: loader group must equal ops/env/${service}.env.example`).toEqual(fromTemplate);
    }
  });

  it('carries the authored entry count for each template, so a rename cannot pass unnoticed', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      expect(serviceEntryNames(service).length, service).toBe(AUTHORED_ENTRY_COUNT[service]);
      expect(templateEntryNames(service).length, `${service} template`).toBe(AUTHORED_ENTRY_COUNT[service]);
    }
  });

  it('declares no entry twice within a service', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      const names = serviceEntryNames(service);
      expect(new Set(names).size, service).toBe(names.length);
    }
  });

  it('gives MAX_CONNECTIONS no home at all, because it belongs to no file (finding F2)', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      expect(serviceEntryNames(service), service).not.toContain('MAX_CONNECTIONS');
    }
  });
});

describe('per-service independence is structural: one service never spells another entry (R17)', () => {
  it('keeps each agent secret out of the other agent group', () => {
    for (const lifeOnly of ['BOT_A_TOKEN', 'LIFE_WEBHOOK_SECRET', 'OR_KEY_LIFE', 'LIFE_WEEKLY_CAP', 'WHOOP_ACCESS_TOKEN']) {
      expect(serviceEntryNames('finance'), lifeOnly).not.toContain(lifeOnly);
    }
    for (const financeOnly of ['BOT_B_TOKEN', 'MONEY_WEBHOOK_SECRET', 'OR_KEY_FINANCE', 'FINANCE_WEEKLY_CAP']) {
      expect(serviceEntryNames('life'), financeOnly).not.toContain(financeOnly);
    }
  });

  it('keeps every bot token and expected secret token out of the proxy group', () => {
    for (const agentSecret of ['BOT_A_TOKEN', 'BOT_B_TOKEN', 'LIFE_WEBHOOK_SECRET', 'MONEY_WEBHOOK_SECRET']) {
      expect(serviceEntryNames('proxy'), agentSecret).not.toContain(agentSecret);
    }
  });

  it('keeps both webhook path segments out of both agent groups', () => {
    for (const path of ['LIFE_WEBHOOK_PATH', 'MONEY_WEBHOOK_PATH']) {
      expect(serviceEntryNames('life'), path).not.toContain(path);
      expect(serviceEntryNames('finance'), path).not.toContain(path);
    }
  });

  it('keeps every credential out of the bus and the scheduler', () => {
    for (const service of ['bus', 'scheduler'] as const) {
      for (const credential of ['BOT_A_TOKEN', 'BOT_B_TOKEN', 'OR_KEY_LIFE', 'OR_KEY_FINANCE', 'DRIVE_REFRESH_TOKEN']) {
        expect(serviceEntryNames(service), `${service}/${credential}`).not.toContain(credential);
      }
    }
  });

  it('refuses an identity outside the enumerated set rather than defaulting to one', () => {
    const notAService = 'router' as unknown as DeploymentService;
    let captured: EnvConfigError | null = null;
    try {
      serviceEntryNames(notAService);
    } catch (e) {
      captured = e instanceof EnvConfigError ? e : null;
    }
    expect(captured?.code).toBe('ENV_SERVICE_UNKNOWN');
    expect(isDeploymentService('router')).toBe(false);
    for (const service of DEPLOYMENT_SERVICES) expect(isDeploymentService(service)).toBe(true);
  });
});

describe('the aggregate refusal names EVERY missing entry in one message (R27, ladder L0)', () => {
  it('accepts a complete environment for every one of the six services', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      expect(collectServiceFindings(service, envFor(service)), service).toEqual([]);
      expect(() => requireServiceEnvironment({ service, env: envFor(service) })).not.toThrow();
    }
    expect(() => requireDeploymentEnvironment(deploymentEnv())).not.toThrow();
  });

  it('names all three when three are wrong, in one message, each with its own code', () => {
    const broken = envFor('finance', {
      OR_KEY_FINANCE: undefined,
      MONEY_WEBHOOK_SECRET: '   ',
      FINANCE_DATA_DIR: '<FINANCE_DATA_DIR>',
    });
    const refusal = aggregate(() => requireServiceEnvironment({ service: 'finance', env: broken }));
    expect(refusal).not.toBeNull();
    expect(refusal?.findings.length).toBe(3);
    expect([...(refusal?.entries ?? [])].sort()).toEqual(['FINANCE_DATA_DIR', 'MONEY_WEBHOOK_SECRET', 'OR_KEY_FINANCE']);
    for (const entry of ['OR_KEY_FINANCE', 'MONEY_WEBHOOK_SECRET', 'FINANCE_DATA_DIR']) {
      expect(refusal?.message, entry).toContain(entry);
    }
    // A code PER FINDING, never one umbrella code: an absent entry and an unusable one stay
    // distinguishable when there is more than one thing to say.
    expect([...(refusal?.codes ?? [])].sort()).toEqual([
      'ENV_ENTRY_ABSENT',
      'ENV_ENTRY_EMPTY',
      'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
    ]);
    const byEntry = new Map((refusal?.findings ?? []).map((f) => [f.entry, f.code]));
    expect(byEntry.get('OR_KEY_FINANCE')).toBe('ENV_ENTRY_ABSENT');
    expect(byEntry.get('MONEY_WEBHOOK_SECRET')).toBe('ENV_ENTRY_EMPTY');
    expect(byEntry.get('FINANCE_DATA_DIR')).toBe('ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER');
  });

  it('names every missing entry when a whole template was copied and never filled in', () => {
    const unfilled: Record<string, string> = {};
    for (const entry of serviceEntryNames('backup')) unfilled[entry] = `<${entry}>`;
    const refusal = aggregate(() => requireServiceEnvironment({ service: 'backup', env: unfilled }));
    expect(refusal?.findings.length).toBe(AUTHORED_ENTRY_COUNT.backup);
    for (const entry of serviceEntryNames('backup')) expect(refusal?.message, entry).toContain(entry);
    expect(refusal?.codes).toEqual(['ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER']);
  });

  it('names findings from several services in the same message', () => {
    const env = deploymentEnv() as Record<DeploymentService, EnvSource>;
    const refusal = aggregate(() =>
      requireDeploymentEnvironment({
        ...env,
        finance: envFor('finance', { OR_KEY_FINANCE: undefined }),
        proxy: envFor('proxy', { DOMAIN: undefined, ACME_CONTACT: '' }),
        bus: envFor('bus', { SIGNALS_DATA_DIR: undefined }),
      }),
    );
    expect(refusal?.findings.length).toBe(4);
    for (const entry of ['OR_KEY_FINANCE', 'DOMAIN', 'ACME_CONTACT', 'SIGNALS_DATA_DIR']) {
      expect(refusal?.message, entry).toContain(entry);
    }
    expect(new Set((refusal?.findings ?? []).map((f) => f.service))).toEqual(new Set(['finance', 'proxy', 'bus']));
  });

  it('supplies no default for any entry: removing one alone names exactly that entry', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      for (const entry of serviceEntryNames(service)) {
        if (ABSENCE_IS_A_DECISION.includes(entry)) continue;
        const findings = collectServiceFindings(service, envFor(service, { [entry]: undefined }));
        expect(findings.map((f) => f.entry), `${service}/${entry}`).toEqual([entry]);
        expect(findings[0]?.code, `${service}/${entry}`).toBe('ENV_ENTRY_ABSENT');
      }
    }
  });

  it('refuses to build an aggregate with no finding, because that is a refusal with no reason', () => {
    expect(() => new EnvConfigAggregateError([], 'nothing')).toThrow();
  });
});

describe('an absent allowlist is a decision; an unfilled one is a mistake (R25)', () => {
  it('is the only entry whose absence is not a finding', () => {
    expect([...ABSENCE_IS_A_DECISION]).toEqual([SHARED_ENTRIES.allowedSenderIds]);
  });

  it('reports nothing when the allowlist is absent, empty, or whitespace-only', () => {
    for (const value of [undefined, '', '   ']) {
      const findings = collectServiceFindings('finance', envFor('finance', { [SHARED_ENTRIES.allowedSenderIds]: value }));
      expect(findings, `"${String(value)}"`).toEqual([]);
    }
  });

  it('reports the unfilled placeholder, because a template nobody completed is not an empty list', () => {
    const findings = collectServiceFindings(
      'finance',
      envFor('finance', { [SHARED_ENTRIES.allowedSenderIds]: `<${SHARED_ENTRIES.allowedSenderIds}>` }),
    );
    expect(findings.map((f) => f.code)).toEqual(['ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER']);
    expect(classifyEntry({}, SHARED_ENTRIES.allowedSenderIds)).toBeNull();
  });
});

describe('the cross-file rules the deployment ledger asserts (mandate §4)', () => {
  it('agrees with the topology on where the halt sentinel is mounted', () => {
    const compose = readFileSync(COMPOSE_PATH, 'utf8');
    const mounts = compose.split('\n').filter((line) => line.includes('kill-switch:'));
    const mountLines = mounts.filter((line) => line.trim().startsWith('-'));
    expect(mountLines.length).toBe(KILL_SENTINEL_SERVICES.length);
    for (const line of mountLines) expect(line).toContain(`kill-switch:${KILL_SENTINEL_MOUNT_TARGET}:ro`);
  });

  it('reports a shared entry that does not carry the same value in every file that shares it', () => {
    const env = deploymentEnv() as Record<DeploymentService, EnvSource>;
    const findings = collectSharedEntryDisagreements({
      ...env,
      proxy: envFor('proxy', { FINANCE_CONTAINER_PORT: '9001' }),
      life: envFor('life', { [SHARED_ENTRIES.allowedSenderIds]: '202' }),
    });
    expect(findings.map((f) => f.entry).sort()).toEqual(['ALLOWED_USER_IDS', 'FINANCE_CONTAINER_PORT']);
    for (const finding of findings) expect(finding.code).toBe('ENV_SHARED_ENTRY_DISAGREES');
  });

  it('reports nothing when every shared entry agrees, and skips a rule whose services are absent', () => {
    expect(collectSharedEntryDisagreements(deploymentEnv())).toEqual([]);
    expect(collectSharedEntryDisagreements({ finance: envFor('finance') })).toEqual([]);
  });

  it('holds the transport mode OUT of the agreement set, because phase 1 runs one agent', () => {
    const shared = SHARED_ENTRY_AGREEMENTS.map((rule) => rule.entry);
    expect(shared).not.toContain(SHARED_ENTRIES.mode);
    expect(shared).not.toContain(SHARED_ENTRIES.maxWorkItems);
    expect(shared).toContain(KILL_SENTINEL_ENTRY);
    const sentinelRule = SHARED_ENTRY_AGREEMENTS.find((rule) => rule.entry === KILL_SENTINEL_ENTRY);
    expect([...(sentinelRule?.services ?? [])].sort()).toEqual([...KILL_SENTINEL_SERVICES].sort());
  });

  it('reports a sentinel path outside the halt mount, in every service that honours the halt', () => {
    for (const service of KILL_SENTINEL_SERVICES) {
      const outside = collectKillSentinelFindings(only(service, envFor(service, { [KILL_SENTINEL_ENTRY]: '/tmp/halt' })));
      expect(outside.map((f) => f.code), service).toEqual(['ENV_KILL_SENTINEL_OUTSIDE_MOUNT']);
      expect(outside[0]?.service, service).toBe(service);
    }
  });

  it('reports a sentinel path that could climb out of the mount', () => {
    const climbing = collectKillSentinelFindings(
      only('finance', envFor('finance', { [KILL_SENTINEL_ENTRY]: `${KILL_SENTINEL_MOUNT_TARGET}/../halt` })),
    );
    expect(climbing.map((f) => f.code)).toEqual(['ENV_KILL_SENTINEL_OUTSIDE_MOUNT']);
  });

  it('reports the mount itself without a file under it, which names no sentinel', () => {
    const bare = collectKillSentinelFindings(only('finance', envFor('finance', { [KILL_SENTINEL_ENTRY]: KILL_SENTINEL_MOUNT_TARGET })));
    expect(bare.map((f) => f.code)).toEqual(['ENV_KILL_SENTINEL_OUTSIDE_MOUNT']);
    expect(collectKillSentinelFindings(deploymentEnv())).toEqual([]);
  });

  it('leaves an absent or unfilled sentinel to the completeness sweep, so it is named once', () => {
    for (const value of [undefined, '', `<${KILL_SENTINEL_ENTRY}>`]) {
      expect(collectKillSentinelFindings(only('finance', envFor('finance', { [KILL_SENTINEL_ENTRY]: value })))).toEqual([]);
    }
    expect(collectServiceFindings('finance', envFor('finance', { [KILL_SENTINEL_ENTRY]: undefined })).length).toBe(1);
  });

  it('reports a service holding an entry that belongs to another service', () => {
    const lifeHoldingFinance = collectForeignEntryFindings('life', envFor('life', { OR_KEY_FINANCE: 'syn-or_key_finance' }));
    expect(lifeHoldingFinance.map((f) => f.entry)).toEqual(['OR_KEY_FINANCE']);
    expect(lifeHoldingFinance[0]?.code).toBe('ENV_FOREIGN_ENTRY_PRESENT');

    const financeHoldingLife = collectForeignEntryFindings('finance', envFor('finance', { BOT_A_TOKEN: 'syn-bot_a_token' }));
    expect(financeHoldingLife.map((f) => f.entry)).toEqual(['BOT_A_TOKEN']);

    const proxyHoldingToken = collectForeignEntryFindings('proxy', envFor('proxy', { BOT_B_TOKEN: 'syn-bot_b_token' }));
    expect(proxyHoldingToken.map((f) => f.entry)).toEqual(['BOT_B_TOKEN']);

    const agentHoldingPath = collectForeignEntryFindings('finance', envFor('finance', { MONEY_WEBHOOK_PATH: 'syn-money_webhook_path' }));
    expect(agentHoldingPath.map((f) => f.entry)).toEqual(['MONEY_WEBHOOK_PATH']);
  });

  it('reports nothing for an ambient variable that belongs to no service', () => {
    expect(collectForeignEntryFindings('finance', envFor('finance', { SOME_AMBIENT_VARIABLE: 'syn-ambient' }))).toEqual([]);
    for (const service of DEPLOYMENT_SERVICES) {
      expect(collectForeignEntryFindings(service, envFor(service)), service).toEqual([]);
    }
  });

  it('collects every cross-service finding into one message', () => {
    const env = deploymentEnv() as Record<DeploymentService, EnvSource>;
    const refusal = aggregate(() =>
      requireCrossServiceAgreement({
        ...env,
        proxy: envFor('proxy', { LIFE_CONTAINER_PORT: '9002' }),
        finance: envFor('finance', { [KILL_SENTINEL_ENTRY]: '/tmp/halt', OR_KEY_LIFE: 'syn-or_key_life' }),
      }),
    );
    expect(refusal).not.toBeNull();
    expect([...(refusal?.codes ?? [])].sort()).toEqual([
      'ENV_FOREIGN_ENTRY_PRESENT',
      'ENV_KILL_SENTINEL_OUTSIDE_MOUNT',
      'ENV_SHARED_ENTRY_DISAGREES',
    ]);
    for (const entry of ['LIFE_CONTAINER_PORT', KILL_SENTINEL_ENTRY, 'OR_KEY_LIFE']) {
      expect(refusal?.message, entry).toContain(entry);
    }
    expect(collectCrossServiceFindings(deploymentEnv())).toEqual([]);
  });
});

describe('no refusal and no presence report carries a configured value (R24, §5.2 rule 5)', () => {
  /**
   * Every distinctive value a synthetic environment holds. A one- or four-character numeric value
   * is not distinctive — a message that counts its own findings contains digits for that reason —
   * so the sweep is over values long enough for a match to mean something.
   */
  function everySyntheticValue(): readonly string[] {
    const values = new Set<string>();
    for (const service of DEPLOYMENT_SERVICES) {
      for (const entry of SERVICE_ENTRY_NAMES[service]) values.add(syntheticValue(entry));
    }
    return [...values].filter((value) => value.length >= 6);
  }

  it('names entries and codes in the aggregate message, and no value at all', () => {
    const broken = envFor('finance', { OR_KEY_FINANCE: '', MONEY_WEBHOOK_SECRET: '', BOT_B_TOKEN: '' });
    const refusal = aggregate(() => requireServiceEnvironment({ service: 'finance', env: broken }));
    expect(refusal?.findings.length).toBe(3);
    expect(refusal?.message).not.toContain('syn-');
    for (const value of everySyntheticValue()) expect(refusal?.message, value).not.toContain(value);
  });

  it('names the halt mount but never the configured sentinel value', () => {
    const outside = collectKillSentinelFindings({ finance: envFor('finance', { [KILL_SENTINEL_ENTRY]: '/tmp/syn-halt-value' }) });
    const refusal = new EnvConfigAggregateError(outside, 'the deployment environment');
    expect(refusal.message).toContain(KILL_SENTINEL_MOUNT_TARGET);
    expect(refusal.message).not.toContain('syn-halt-value');
  });

  it('names a disagreeing entry and its services, and neither of the two values', () => {
    const env = deploymentEnv() as Record<DeploymentService, EnvSource>;
    const findings = collectSharedEntryDisagreements({
      ...env,
      proxy: envFor('proxy', { FINANCE_CONTAINER_PORT: 'syn-proxy-side-value' }),
      finance: envFor('finance', { FINANCE_CONTAINER_PORT: 'syn-agent-side-value' }),
    });
    const refusal = new EnvConfigAggregateError(findings, 'the deployment environment');
    expect(refusal.message).toContain('FINANCE_CONTAINER_PORT');
    expect(refusal.message).toContain('proxy');
    expect(refusal.message).not.toContain('syn-proxy-side-value');
    expect(refusal.message).not.toContain('syn-agent-side-value');
  });

  it('reports presence for every service as booleans, disclosing none of the values', () => {
    for (const service of DEPLOYMENT_SERVICES) {
      const presence = describeServiceConfiguredPresence(service, envFor(service));
      expect(Object.keys(presence).sort(), service).toEqual([...serviceEntryNames(service)].sort());
      for (const value of Object.values(presence)) expect(typeof value).toBe('boolean');
      const rendered = JSON.stringify(presence);
      for (const entry of serviceEntryNames(service)) {
        expect(presence[entry], `${service}/${entry}`).toBe(true);
        expect(rendered, `${service}/${entry}`).not.toContain(syntheticValue(entry));
      }
    }
  });

  it('reports an unfilled entry as not configured, because a placeholder is not a value', () => {
    const presence = describeServiceConfiguredPresence('bus', envFor('bus', { SIGNALS_STORE_FILE: '<SIGNALS_STORE_FILE>' }));
    expect(presence.SIGNALS_STORE_FILE).toBe(false);
    expect(presence.SIGNALS_DATA_DIR).toBe(true);
  });
});

describe('six services did not become six bridges to the ambient environment (R27)', () => {
  it('still leaves exactly one non-test module under src reaching the process environment', () => {
    const token = ['process', 'env'].join('.');
    const readers = walkSource('src')
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').includes(token));
    expect(readers).toEqual([LOADER_SOURCE_PATH]);
    expect(readers.length).toBe(1);
  });

  it('takes the environment as an argument on every six-service entry point', () => {
    const source = readFileSync(LOADER_SOURCE_PATH, 'utf8');
    for (const writer of ['console.', 'process.stdout', 'process.stderr', 'writeFile']) {
      expect(source.includes(writer), `loader must not reference ${writer}`).toBe(false);
    }
    // Every collector below is a pure function of an injected environment: called with an empty
    // record it reports, and it does not reach for anything ambient to fill the gap.
    expect(collectDeploymentFindings({ bus: {} }).map((f) => f.entry).sort()).toEqual([...serviceEntryNames('bus')].sort());
  });
});
