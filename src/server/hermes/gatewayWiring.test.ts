/**
 * Hermes gateway wiring tests.
 * Implemented by: PFOS Contract 12 / Wave 2 Hermes gateway wiring.
 * Owning authority: PFOS Contracts 12, 13, and 14.
 * Phase: Phase 2.5 refined Hermes integration; Wave 2 Hermes gateway wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditHermesGatewayWiring } from './gatewayWiring.ts';

const OPS = join(process.cwd(), 'ops', 'hermes');

function read(name: string): string {
  return readFileSync(join(OPS, name), 'utf8').split('\r\n').join('\n');
}

describe('the tracked Hermes gateway templates are wired as two isolated services', () => {
  it.each([
    ['nizam', 'nizam.service.example', 'nizam.env.example', 'nizam.config.yaml.example'],
    ['pfos', 'pfos.service.example', 'pfos.env.example', 'pfos.config.yaml.example'],
    ['nizam-ingress', 'nizam-ingress.service.example', 'nizam-ingress.env.example', 'nizam-ingress.config.yaml.example'],
  ] as const)('%s passes the gateway, profile, env, and model audit', (profile, service, env, config) => {
    expect(auditHermesGatewayWiring({
      profile,
      serviceTemplate: read(service),
      environmentTemplate: read(env),
      configTemplate: read(config),
    })).toEqual([]);
  });

  it('refuses a service that loses the exact gateway command', () => {
    const findings = auditHermesGatewayWiring({
      profile: 'pfos',
      serviceTemplate: read('pfos.service.example').replace('gateway run', 'gateway'),
      environmentTemplate: read('pfos.env.example'),
      configTemplate: read('pfos.config.yaml.example'),
    });
    expect(findings.map((finding) => finding.code)).toContain('GATEWAY_COMMAND_MISSING');
  });

  it('refuses a tracked env template that contains a value instead of a self-named placeholder', () => {
    const findings = auditHermesGatewayWiring({
      profile: 'nizam',
      serviceTemplate: read('nizam.service.example'),
      environmentTemplate: read('nizam.env.example').replace('NIZAM_KILL_ALL=<NIZAM_KILL_ALL>', 'NIZAM_KILL_ALL=0'),
      configTemplate: read('nizam.config.yaml.example'),
    });
    expect(findings.map((finding) => finding.code)).toContain('PROFILE_ENV_ENTRY_NOT_PLACEHOLDER');
  });
});
