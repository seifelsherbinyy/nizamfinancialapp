/**
 * Presence-only secret alias broker tests.
 * Owning authority: PFOS Contract 14 (v2); Contracts 12 and 13; secrets plan.
 * Phase 14 — single-window Slack ingress surface.
 * Depends on: secretBroker.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  SecretBrokerError,
  assertNoSecretInAudit,
  inspectSecretAlias,
  mapApprovedAliasToHermesEntry,
} from './secretBroker.ts';

const ENV = {
  SLACK_BOT_TOKEN: 'synthetic-present',
  SLACK_APP_TOKEN: 'synthetic-app-present',
  ALLOWED_USER_IDS: 'synthetic-allow',
  OR_KEY_LIFE: '<OR_KEY_LIFE>',
};

describe('secret alias broker (Slack v2)', () => {
  it('reports presence of the live Slack bot token without returning the value', () => {
    const result = inspectSecretAlias('SLACK_BOT_TOKEN', ENV, 'ingress-test');
    expect(result.configured).toBe(true);
    expect(result.hermesEntry).toBe('SLACK_BOT_TOKEN');
    expect(JSON.stringify(result)).not.toContain('synthetic-present');
    expect(() => assertNoSecretInAudit(result.audit)).not.toThrow();
  });

  it('reports presence of the Slack app token without returning the value', () => {
    const result = inspectSecretAlias('SLACK_APP_TOKEN', ENV, 'ingress-test');
    expect(result.configured).toBe(true);
    expect(result.hermesEntry).toBe('SLACK_APP_TOKEN');
    expect(JSON.stringify(result)).not.toContain('synthetic-app-present');
  });

  it('treats unsubstituted placeholders as absent', () => {
    expect(inspectSecretAlias('OR_KEY_LIFE', ENV, 'ingress-test').configured).toBe(false);
  });

  it('maps approved aliases and refuses revoked Telegram or unknown ones', () => {
    expect(mapApprovedAliasToHermesEntry('ALLOWED_USER_IDS', 'ingress-test').hermesEntry).toBe('SLACK_ALLOWED_USERS');
    expect(mapApprovedAliasToHermesEntry('SLACK_BOT_TOKEN', 'ingress-test').hermesEntry).toBe('SLACK_BOT_TOKEN');
    // All Telegram aliases must throw SECRET_ALIAS_REVOKED
    for (const alias of ['BOT_NIZAM_TOKEN', 'BOT_A_TOKEN', 'BOT_B_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS']) {
      expect(() => inspectSecretAlias(alias, ENV, 'ingress-test')).toThrow(SecretBrokerError);
      try {
        inspectSecretAlias(alias, ENV, 'ingress-test');
      } catch (error) {
        expect(error).toBeInstanceOf(SecretBrokerError);
        expect((error as SecretBrokerError).code).toBe('SECRET_ALIAS_REVOKED');
      }
    }
    // Unknown alias must throw SECRET_ALIAS_UNAUTHORIZED
    expect(() => inspectSecretAlias('VPS_PASSWORD', ENV, 'ingress-test')).toThrow(SecretBrokerError);
    try {
      inspectSecretAlias('VPS_PASSWORD', ENV, 'ingress-test');
    } catch (error) {
      expect(error).toBeInstanceOf(SecretBrokerError);
      expect((error as SecretBrokerError).code).toBe('SECRET_ALIAS_UNAUTHORIZED');
    }
  });

  it('assertNoSecretInAudit refuses Slack token prefixes in the audit record', () => {
    const fakeAudit = {
      alias: 'SLACK_BOT_TOKEN',
      caller: 'test',
      operation: 'presence-check' as const,
      outcome: 'present' as const,
      at: '1970-01-01T00:00:00Z',
    };
    expect(() => assertNoSecretInAudit(fakeAudit)).not.toThrow();
    const leakyAudit = { ...fakeAudit, alias: 'xoxb-123456789012-synthetic-token' };
    expect(() => assertNoSecretInAudit(leakyAudit)).toThrow(SecretBrokerError);
  });
});
