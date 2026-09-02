/**
 * NIZAM Hermes gateway wiring audit.
 * Implemented by: PFOS Contract 12 / Wave 2 Hermes gateway wiring.
 * Owning authority: PFOS Contracts 12, 13, and 14 (v2), money rules, and the two-agent deployment plan.
 * Phase 14 — single-window Slack ingress surface.
 * This is a text audit only; it never starts a service or resolves a protected value.
 * v2: Ingress profile audited for Slack credentials; internal profiles audited for minimal entries only.
 */
import { INGRESS_PROFILE_NAME, type HermesIngressProfileName } from './ingressPolicy.ts';
import { modelForTier, type HermesProfileName } from './profilePolicy.ts';

export const HERMES_GATEWAY_ARGUMENTS = Object.freeze(['gateway', 'run'] as const);

export type HermesGatewayProfileName = HermesProfileName | HermesIngressProfileName;

export interface HermesGatewayWiringInput {
  readonly profile: HermesGatewayProfileName;
  readonly serviceTemplate: string;
  readonly environmentTemplate: string;
  readonly configTemplate: string;
}

export interface HermesGatewayWiringFinding {
  readonly code:
    | 'GATEWAY_COMMAND_MISSING'
    | 'PROFILE_HOME_BINDING_MISSING'
    | 'ENV_FILE_BINDING_MISSING'
    | 'HERMES_HARDENING_MISSING'
    | 'PROFILE_ENV_ENTRY_MISSING'
    | 'PROFILE_ENV_ENTRY_NOT_PLACEHOLDER'
    | 'PROFILE_MODEL_MISMATCH'
    | 'PROFILE_PROVIDER_MISMATCH';
  readonly detail: string;
}

/**
 * Ingress (Slack) profile: requires all Slack credentials plus OpenRouter key and kill switch.
 * Internal profiles (nizam/pfos): require only HERMES_HOME, OpenRouter key, and kill switch —
 * no platform credentials, since they are invoked by the ingress coordinator, not as live gateways.
 */
const INGRESS_ENV_ENTRIES = [
  'HERMES_HOME',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'OPENROUTER_API_KEY',
  'SLACK_ALLOWED_USERS',
  'SLACK_HOME_CHANNEL',
  'SLACK_ALLOWED_CHANNELS',
  'NIZAM_KILL_ALL',
] as const;
type IngressTemplateEntry = (typeof INGRESS_ENV_ENTRIES)[number];

const INTERNAL_ENV_ENTRIES = ['HERMES_HOME', 'OPENROUTER_API_KEY', 'NIZAM_KILL_ALL'] as const;
type InternalTemplateEntry = (typeof INTERNAL_ENV_ENTRIES)[number];

const INGRESS_PROFILE_ENV_PLACEHOLDERS: Readonly<Record<IngressTemplateEntry, string>> = Object.freeze({
  HERMES_HOME: '<NIZAM_INGRESS_HERMES_HOME>',
  SLACK_BOT_TOKEN: '<SLACK_BOT_TOKEN>',
  SLACK_APP_TOKEN: '<SLACK_APP_TOKEN>',
  OPENROUTER_API_KEY: '<OR_KEY_LIFE>',
  SLACK_ALLOWED_USERS: '<ALLOWED_USER_IDS>',
  SLACK_HOME_CHANNEL: '<SLACK_HOME_CHANNEL>',
  SLACK_ALLOWED_CHANNELS: '<SLACK_ALLOWED_CHANNELS>',
  NIZAM_KILL_ALL: '<NIZAM_KILL_ALL>',
});

const INTERNAL_PROFILE_ENV_PLACEHOLDERS: Readonly<Record<string, Readonly<Record<InternalTemplateEntry, string>>>> = Object.freeze({
  nizam: Object.freeze({
    HERMES_HOME: '<NIZAM_HERMES_HOME>',
    OPENROUTER_API_KEY: '<OR_KEY_LIFE>',
    NIZAM_KILL_ALL: '<NIZAM_KILL_ALL>',
  }),
  pfos: Object.freeze({
    HERMES_HOME: '<PFOS_HERMES_HOME>',
    OPENROUTER_API_KEY: '<OR_KEY_FINANCE>',
    NIZAM_KILL_ALL: '<NIZAM_KILL_ALL>',
  }),
});

function profilePrefix(profile: HermesGatewayProfileName): 'NIZAM' | 'PFOS' | 'NIZAM_INGRESS' {
  if (profile === 'nizam') return 'NIZAM';
  if (profile === 'pfos') return 'PFOS';
  return 'NIZAM_INGRESS';
}

function modelProfile(profile: HermesGatewayProfileName): HermesProfileName {
  return profile === 'pfos' ? 'pfos' : 'nizam';
}

function hasLine(source: string, line: string): boolean {
  return source.split(/\r?\n/).some((candidate) => candidate.trim() === line);
}

/** Audit the three tracked template families against the gateway contract. */
export function auditHermesGatewayWiring(input: HermesGatewayWiringInput): readonly HermesGatewayWiringFinding[] {
  const findings: HermesGatewayWiringFinding[] = [];
  const prefix = profilePrefix(input.profile);
  const homePlaceholder = `<${prefix}_HERMES_HOME>`;
  const envPathPlaceholder = `<${prefix}_HERMES_ENV_PATH>`;

  if (!hasLine(input.serviceTemplate, 'ExecStart=<HERMES_EXECUTABLE> gateway run')) {
    findings.push({ code: 'GATEWAY_COMMAND_MISSING', detail: 'the service must invoke the Hermes gateway with the exact gateway run argument pair' });
  }
  if (!hasLine(input.serviceTemplate, `Environment=HERMES_HOME=${homePlaceholder}`) || !hasLine(input.serviceTemplate, `ReadWritePaths=${homePlaceholder}`)) {
    findings.push({ code: 'PROFILE_HOME_BINDING_MISSING', detail: 'the unit must bind HERMES_HOME and its writable profile home to the same placeholder' });
  }
  if (!hasLine(input.serviceTemplate, `EnvironmentFile=${envPathPlaceholder}`)) {
    findings.push({ code: 'ENV_FILE_BINDING_MISSING', detail: 'the unit must read exactly the protected environment file for its profile' });
  }
  for (const line of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectHome=true', 'ProtectSystem=strict']) {
    if (!hasLine(input.serviceTemplate, line)) {
      findings.push({ code: 'HERMES_HARDENING_MISSING', detail: `the unit is missing ${line}` });
    }
  }

  const isIngress = input.profile === INGRESS_PROFILE_NAME;
  const entries: readonly string[] = isIngress ? INGRESS_ENV_ENTRIES : INTERNAL_ENV_ENTRIES;
  const placeholders: Readonly<Record<string, string>> = isIngress
    ? INGRESS_PROFILE_ENV_PLACEHOLDERS
    : (INTERNAL_PROFILE_ENV_PLACEHOLDERS[input.profile] ?? {});

  const assignments = new Map<string, string>();
  for (const line of input.environmentTemplate.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match !== null && match[1] !== undefined && match[2] !== undefined) assignments.set(match[1], match[2]);
  }
  for (const entry of entries) {
    const expected = placeholders[entry];
    const value = assignments.get(entry);
    if (value === undefined) {
      findings.push({ code: 'PROFILE_ENV_ENTRY_MISSING', detail: `${entry} is absent from the protected profile template` });
    } else if (expected !== undefined && value !== expected) {
      findings.push({ code: 'PROFILE_ENV_ENTRY_NOT_PLACEHOLDER', detail: `${entry} must remain its self-named placeholder in the tracked template` });
    }
  }

  const expectedModel = modelForTier(modelProfile(input.profile), 'T1');
  if (expectedModel === null || !hasLine(input.configTemplate, `default: ${expectedModel}`)) {
    findings.push({ code: 'PROFILE_MODEL_MISMATCH', detail: 'the profile config default does not match its governed T1 model' });
  }
  if (!hasLine(input.configTemplate, 'provider: openrouter')) {
    findings.push({ code: 'PROFILE_PROVIDER_MISMATCH', detail: 'the profile config must select the OpenRouter provider explicitly' });
  }

  return Object.freeze(findings);
}
