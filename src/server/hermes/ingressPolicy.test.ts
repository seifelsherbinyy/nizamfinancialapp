/**
 * Single-window ingress policy tests.
 * Owning authority: PFOS Contract 14 (v2); Contracts 06, 12, and 13; money rules.
 * Phase 14 — single-window Slack ingress surface.
 * Depends on: ingressPolicy.ts and profilePolicy.ts.
 */
import { describe, expect, it } from 'vitest';
import { assertProfileIsolation, HERMES_PROFILE_POLICIES } from './profilePolicy.ts';
import {
  DEPRECATED_PENDING_REVOKE,
  INGRESS_POLICY,
  REVOKED_TELEGRAM_ALIASES,
  SLACK_BOT_TOKEN_ALIAS,
  SLACK_APP_TOKEN_ALIAS,
  SLACK_ALLOWED_USERS_ALIAS,
  assertIngressKeepsInternalIsolation,
  assertRevokedTelegramAliasesNotPresent,
  isRevokedTelegramAlias,
  mapIngressAlias,
  profileForIngressTool,
  toolsReachableFromIngress,
} from './ingressPolicy.ts';

describe('single-window ingress policy (Slack v2)', () => {
  it('names three live Slack aliases and marks all Telegram aliases revoked', () => {
    expect(INGRESS_POLICY.slackBotTokenEntry).toBe(SLACK_BOT_TOKEN_ALIAS);
    expect(INGRESS_POLICY.slackAppTokenEntry).toBe(SLACK_APP_TOKEN_ALIAS);
    expect(INGRESS_POLICY.slackAllowedUsersEntry).toBe(SLACK_ALLOWED_USERS_ALIAS);
    expect(REVOKED_TELEGRAM_ALIASES).toContain('BOT_NIZAM_TOKEN');
    expect(REVOKED_TELEGRAM_ALIASES).toContain('BOT_A_TOKEN');
    expect(REVOKED_TELEGRAM_ALIASES).toContain('BOT_B_TOKEN');
    expect(REVOKED_TELEGRAM_ALIASES).toContain('TELEGRAM_BOT_TOKEN');
    expect(REVOKED_TELEGRAM_ALIASES).toContain('TELEGRAM_ALLOWED_CHATS');
    expect(DEPRECATED_PENDING_REVOKE).toBe('DEPRECATED_PENDING_REVOKE');
  });

  it('keeps internal nizam/pfos isolation after Slack replaces Telegram', () => {
    expect(() => assertProfileIsolation(HERMES_PROFILE_POLICIES.nizam, HERMES_PROFILE_POLICIES.pfos)).not.toThrow();
    expect(() => assertIngressKeepsInternalIsolation()).not.toThrow();
    expect(INGRESS_POLICY.openRouterKeyEntry).not.toBe(INGRESS_POLICY.financeOpenRouterKeyEntry);
    expect(INGRESS_POLICY.weeklyCapEntry).not.toBe(INGRESS_POLICY.financeWeeklyCapEntry);
    expect(INGRESS_POLICY.storeEntry).not.toBe(INGRESS_POLICY.financeStoreEntry);
  });

  it('refuses to treat any revoked Telegram alias as still live', () => {
    expect(isRevokedTelegramAlias('BOT_NIZAM_TOKEN')).toBe(true);
    expect(isRevokedTelegramAlias('BOT_A_TOKEN')).toBe(true);
    expect(isRevokedTelegramAlias('TELEGRAM_BOT_TOKEN')).toBe(true);
    expect(isRevokedTelegramAlias(SLACK_BOT_TOKEN_ALIAS)).toBe(false);
    expect(() => assertRevokedTelegramAliasesNotPresent([SLACK_BOT_TOKEN_ALIAS])).not.toThrow();
    expect(() => assertRevokedTelegramAliasesNotPresent(['BOT_NIZAM_TOKEN', SLACK_BOT_TOKEN_ALIAS])).toThrow(
      'HERMES_REVOKED_TELEGRAM_ALIAS_STILL_LIVE',
    );
    expect(() => assertRevokedTelegramAliasesNotPresent(['BOT_A_TOKEN'])).toThrow(
      'HERMES_REVOKED_TELEGRAM_ALIAS_STILL_LIVE',
    );
  });

  it('maps NIZAM aliases onto Hermes env-var names without values', () => {
    expect(mapIngressAlias('slackBotToken')).toBe('SLACK_BOT_TOKEN');
    expect(mapIngressAlias('slackAppToken')).toBe('SLACK_APP_TOKEN');
    expect(mapIngressAlias('allowlist')).toBe('ALLOWED_USER_IDS');
    expect(mapIngressAlias('hermesAllowedUsers')).toBe('SLACK_ALLOWED_USERS');
    expect(JSON.stringify(INGRESS_POLICY)).not.toMatch(/xoxb-[A-Za-z0-9_-]+/);
    expect(JSON.stringify(INGRESS_POLICY)).not.toMatch(/xapp-[A-Za-z0-9_-]+/);
  });

  it('can reach both tool families from ingress without merging their owning profiles', () => {
    const tools = toolsReachableFromIngress();
    expect(tools).toContain('nizamcore.append_journal_entry');
    expect(tools).toContain('pfos.run_deterministic_analysis');
    expect(profileForIngressTool('nizamcore.append_journal_entry')).toBe('nizam');
    expect(profileForIngressTool('pfos.read_financial_snapshot')).toBe('pfos');
  });
});
