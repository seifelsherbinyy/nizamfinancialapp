// @vitest-environment node
/**
 * NIZAM · The environment loader's fail-closed matrix, and the compositions that matter
 * Implemented by: PFOS Contract 12 / Phase 4.5 (spec 06-two-agent-vps, task prompt §3.1)
 * Owning requirements: R11 (the token guard is configured, never defaulted), R12 (an empty
 *   allowlist means nobody), R17 (per-agent key and cap isolation), R24 (no deployment particular)
 * Depends on: ./environment, ../telegram/auth, ../ports/telegram, node:fs (the tree scan only)
 *
 * Three kinds of assertion, and the second kind is the one that carries the weight.
 *
 *  1. **The per-entry matrix.** For every entry the loader resolves: absent, empty, malformed, and
 *     valid. Each refusal is asserted on its named `code`, never on a message, so a reworded
 *     failure does not silently become an unasserted one.
 *  2. **Compositions, not parses.** A parser proved correct in isolation is not evidence that
 *     nobody gets in. So an empty allowlist is carried through {@link authorizeDelivery} and
 *     observed refusing a sender that is otherwise perfectly authorised, and an unusable expected
 *     token is observed refusing a request carrying the very value it was configured with.
 *  3. **Structural properties, asserted by scanning the tree.** That the loader is the only reader
 *     of the ambient environment, and that it renders no value, are properties a comment cannot
 *     hold. They are read out of the source here so they cannot decay.
 *
 * Every value below is synthetic (R24, steering §0b): no real token, identifier, bot, host, or
 * domain appears, and the two allowlist identifiers are two- and three-digit stand-ins chosen to
 * look nothing like a provider-issued one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TELEGRAM_TRANSPORT_MODES, type TelegramTransportMode } from '../ports/telegram';
import {
  authorizeDelivery as authorizeDeliveryInMode,
  type TelegramAuthPolicy,
  type TelegramAuthDecision,
  type TelegramAuthSubject,
} from '../telegram/auth';
import {
  AGENT_ENTRY_NAMES,
  ALLOWLIST_DELIMITER,
  EnvConfigError,
  SHARED_ENTRIES,
  agentEntryNames,
  describeConfiguredPresence,
  loadAgentModelBinding,
  loadTelegramTransportConfig,
  parseAllowedSenderIds,
  type EnvConfigErrorCode,
  type EnvSource,
} from './environment';

const LOADER_SOURCE_PATH = 'src/server/config/environment.ts';

const BOT = 'bot-under-test';
const OTHER_BOT = 'bot-under-test-two';
const SENDER = '101';
const SECOND_SENDER = '202';
const OUTSIDER = '303';
const LIFE_TOKEN = 'tok-test-life';
const FINANCE_TOKEN = 'tok-test-finance';
const LIFE_KEY = 'key-test-life';
const FINANCE_KEY = 'key-test-finance';
const API_BASE = 'https://provider.invalid';
const MODE: TelegramTransportMode = 'webhook';

/**
 * The loader assertions below are about the values a `webhook` deployment resolves, so the mode the
 * guard applies (R26, Phase 10.5) is bound to `webhook` here rather than restated at each call.
 * `longPoll`'s applicable-gate set is asserted in `telegram/modeAwareGuard.negative.test.ts`, and
 * the loader itself is mode-agnostic: it refuses an unusable webhook secret in BOTH modes, which is
 * deliberate — an entry the owner must fill even where nothing reads it (task 10.3).
 */
function authorizeDelivery(subject: TelegramAuthSubject, policy: TelegramAuthPolicy): TelegramAuthDecision {
  return authorizeDeliveryInMode(subject, policy, MODE);
}

/** A complete, valid finance environment. Every case below is this, minus or plus one entry. */
function financeEnv(overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {
    MONEY_WEBHOOK_SECRET: FINANCE_TOKEN,
    OR_KEY_FINANCE: FINANCE_KEY,
    FINANCE_WEEKLY_CAP: '5000000',
    [SHARED_ENTRIES.allowedSenderIds]: SENDER,
    [SHARED_ENTRIES.apiBase]: API_BASE,
    [SHARED_ENTRIES.mode]: MODE,
    [SHARED_ENTRIES.maxWorkItems]: '2',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

function lifeEnv(overrides: Readonly<Record<string, string | undefined>> = {}): EnvSource {
  const base: Record<string, string | undefined> = {
    LIFE_WEBHOOK_SECRET: LIFE_TOKEN,
    OR_KEY_LIFE: LIFE_KEY,
    LIFE_WEEKLY_CAP: '5000000',
    [SHARED_ENTRIES.allowedSenderIds]: SENDER,
    [SHARED_ENTRIES.apiBase]: API_BASE,
    [SHARED_ENTRIES.mode]: MODE,
    [SHARED_ENTRIES.maxWorkItems]: '2',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

/** Run a loader call and return the code it refused with, or `null` if it did not refuse. */
function refusalCode(run: () => unknown): EnvConfigErrorCode | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof EnvConfigError) return e.code;
    throw e;
  }
}

function loadFinance(env: EnvSource, botId: string = BOT) {
  return loadTelegramTransportConfig({ agent: 'finance', env, botId });
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

describe('the environment loader: no default for anything (contract 12 §5.2, §5.3)', () => {
  it('resolves a complete environment into the port configuration, field for field', () => {
    const config = loadFinance(financeEnv());
    expect(config).toEqual({
      botId: BOT,
      expectedSecretToken: FINANCE_TOKEN,
      allowedSenderIds: [SENDER],
      apiBaseUrlRef: API_BASE,
      mode: MODE,
      maxConcurrentWorkItems: 2,
    });
  });

  it('refuses every required entry when it is absent, and names the entry it is missing', () => {
    for (const entry of ['MONEY_WEBHOOK_SECRET', SHARED_ENTRIES.apiBase, SHARED_ENTRIES.mode, SHARED_ENTRIES.maxWorkItems]) {
      let captured: EnvConfigError | null = null;
      try {
        loadFinance(financeEnv({ [entry]: undefined }));
      } catch (e) {
        captured = e instanceof EnvConfigError ? e : null;
      }
      expect(captured, `${entry} absent must refuse`).not.toBeNull();
      expect(captured?.entry).toBe(entry);
    }
  });

  it('refuses an entry that is set but empty, which is not a configured value', () => {
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.apiBase]: '' })))).toBe('ENV_ENTRY_EMPTY');
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.mode]: '   ' })))).toBe('ENV_ENTRY_EMPTY');
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.maxWorkItems]: '' })))).toBe('ENV_ENTRY_EMPTY');
    expect(refusalCode(() => loadFinance(financeEnv({ MONEY_WEBHOOK_SECRET: '' })))).toBe('ENV_WEBHOOK_SECRET_UNUSABLE');
  });

  it('refuses a template that was copied but never filled in, on every entry that ships as a placeholder', () => {
    for (const entry of ['MONEY_WEBHOOK_SECRET', SHARED_ENTRIES.apiBase, SHARED_ENTRIES.mode, SHARED_ENTRIES.maxWorkItems, SHARED_ENTRIES.allowedSenderIds]) {
      expect(refusalCode(() => loadFinance(financeEnv({ [entry]: `<${entry}>` }))), `${entry} unsubstituted`).toBe(
        'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
      );
    }
  });

  it('refuses an unsecured provider base, because a bot token rides on every call to it', () => {
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.apiBase]: 'http://provider.invalid' })))).toBe(
      'ENV_API_BASE_NOT_TRANSPORT_SECURED',
    );
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.apiBase]: 'provider.invalid' })))).toBe(
      'ENV_API_BASE_NOT_TRANSPORT_SECURED',
    );
  });

  it('refuses a blank bot identity, because it is half of the de-duplication key (§5.4.1, R14)', () => {
    expect(refusalCode(() => loadFinance(financeEnv(), ''))).toBe('ENV_BOT_IDENTITY_EMPTY');
    expect(refusalCode(() => loadFinance(financeEnv(), '   '))).toBe('ENV_BOT_IDENTITY_EMPTY');
  });
});

describe('MAX_WORK_ITEMS is a positive integer, and nothing else (§5.5.5)', () => {
  it('accepts a bare run of digits', () => {
    expect(loadFinance(financeEnv({ [SHARED_ENTRIES.maxWorkItems]: '1' })).maxConcurrentWorkItems).toBe(1);
    expect(loadFinance(financeEnv({ [SHARED_ENTRIES.maxWorkItems]: '16' })).maxConcurrentWorkItems).toBe(16);
  });

  it('refuses zero, a negative, a non-numeric value, a decimal, and an exponent', () => {
    for (const bad of ['0', '-1', 'two', '1.5', '1e3', '0x10', '+2', '2 ', ' 2']) {
      const code = refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.maxWorkItems]: bad })));
      // A padded value trims to a valid one; every other case is refused by name.
      if (bad.trim() === '2') expect(code, `"${bad}"`).toBeNull();
      else expect(code, `"${bad}"`).toBe('ENV_MAX_WORK_ITEMS_NOT_POSITIVE_INTEGER');
    }
  });

  it('refuses an absent bound rather than choosing one', () => {
    expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.maxWorkItems]: undefined })))).toBe('ENV_ENTRY_ABSENT');
  });
});

describe('TELEGRAM_MODE admits exactly the two literals the port declares', () => {
  it('constructs under both modes, with the same guards either way', () => {
    for (const mode of TELEGRAM_TRANSPORT_MODES) {
      const config = loadFinance(financeEnv({ [SHARED_ENTRIES.mode]: mode }));
      expect(config.mode).toBe(mode);
      expect(config.expectedSecretToken).toBe(FINANCE_TOKEN);
      expect(config.allowedSenderIds).toEqual([SENDER]);
    }
  });

  it('refuses an unknown mode at startup, including a case variant of a known one', () => {
    for (const bad of ['Webhook', 'WEBHOOK', 'longpoll', 'LongPoll', 'poll', 'webhook ']) {
      const expected = bad.trim() === 'webhook' ? null : 'ENV_MODE_UNKNOWN';
      expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.mode]: bad }))), `"${bad}"`).toBe(expected);
    }
  });
});

describe('the expected secret token is handed to the guard, not re-implemented', () => {
  it('refuses a value the provider could never echo, without restating the rule', () => {
    for (const bad of ['tok with space', 'tok.with.dot', 'tok/with/slash', 'a'.repeat(257)]) {
      expect(refusalCode(() => loadFinance(financeEnv({ MONEY_WEBHOOK_SECRET: bad })))).toBe('ENV_WEBHOOK_SECRET_UNUSABLE');
    }
  });

  it('does not trim the secret, because removing padding would invent a value nobody configured', () => {
    expect(refusalCode(() => loadFinance(financeEnv({ MONEY_WEBHOOK_SECRET: ` ${FINANCE_TOKEN} ` })))).toBe(
      'ENV_WEBHOOK_SECRET_UNUSABLE',
    );
  });

  it('holds no length bound and no alphabet of its own, so it cannot soften either', () => {
    // Prose may NAME the rule; code may not restate it. Comment lines are therefore stripped
    // first, the same way the money invariant checker treats its own two bans.
    const code = readFileSync(LOADER_SOURCE_PATH, 'utf8')
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
      })
      .join('\n');
    expect(code).not.toContain('256');
    expect(code).not.toContain('A-Za-z0-9_-');
    expect(code).toContain('secretTokenIsConfigured');
  });
});

describe('ALLOWED_USER_IDS: the delimiter is a superset of the operator interim shape (D-ALLOWLIST)', () => {
  it('parses the interim shape — one bare digit run, no quotes, brackets, or spaces', () => {
    expect(parseAllowedSenderIds(SENDER)).toEqual([SENDER]);
  });

  it('accepts a comma, a semicolon, and whitespace as separators, in any combination', () => {
    const expected = [SENDER, SECOND_SENDER];
    expect(parseAllowedSenderIds(`${SENDER},${SECOND_SENDER}`)).toEqual(expected);
    expect(parseAllowedSenderIds(`${SENDER};${SECOND_SENDER}`)).toEqual(expected);
    expect(parseAllowedSenderIds(`${SENDER} ${SECOND_SENDER}`)).toEqual(expected);
    expect(parseAllowedSenderIds(`${SENDER}, ${SECOND_SENDER}`)).toEqual(expected);
    expect(parseAllowedSenderIds(` ${SENDER} , ; ${SECOND_SENDER} `)).toEqual(expected);
    expect(ALLOWLIST_DELIMITER.test(',')).toBe(true);
    expect(ALLOWLIST_DELIMITER.test(';')).toBe(true);
    expect(ALLOWLIST_DELIMITER.test(' ')).toBe(true);
  });

  it('yields an empty list when absent, empty, or whitespace-only', () => {
    expect(parseAllowedSenderIds(undefined)).toEqual([]);
    expect(parseAllowedSenderIds('')).toEqual([]);
    expect(parseAllowedSenderIds('   ')).toEqual([]);
    expect(loadFinance(financeEnv({ [SHARED_ENTRIES.allowedSenderIds]: undefined })).allowedSenderIds).toEqual([]);
  });

  it('refuses a malformed element at startup instead of locking the operator out at run time', () => {
    for (const bad of [`"${SENDER}"`, `[${SENDER}]`, `${SENDER}'`, 'not-a-digit-run', `${SENDER},x`]) {
      expect(refusalCode(() => loadFinance(financeEnv({ [SHARED_ENTRIES.allowedSenderIds]: bad }))), `"${bad}"`).toBe(
        'ENV_ALLOWLIST_ENTRY_MALFORMED',
      );
    }
  });

  it('returns a frozen list, so a caller cannot widen the allowlist after it was resolved', () => {
    const list = parseAllowedSenderIds(SENDER);
    expect(Object.isFrozen(list)).toBe(true);
  });
});

describe('composition: the guard is what refuses, and an empty list means nobody (§5.3, R12)', () => {
  const subject = (senderId: string, token: string | null): TelegramAuthSubject => ({
    botId: BOT,
    senderId,
    secretTokenHeader: token,
  });

  it('authorises the allowlisted sender carrying the configured token', () => {
    const config = loadFinance(financeEnv());
    expect(authorizeDelivery(subject(SENDER, FINANCE_TOKEN), config).authorized).toBe(true);
  });

  it('refuses that same sender and that same token once the allowlist is absent', () => {
    const config = loadFinance(financeEnv({ [SHARED_ENTRIES.allowedSenderIds]: undefined }));
    expect(config.allowedSenderIds).toEqual([]);
    expect(authorizeDelivery(subject(SENDER, FINANCE_TOKEN), config).authorized).toBe(false);
  });

  it('refuses a sender outside a populated allowlist', () => {
    const config = loadFinance(financeEnv());
    expect(authorizeDelivery(subject(OUTSIDER, FINANCE_TOKEN), config).authorized).toBe(false);
  });

  it('refuses a request carrying the correct token when the expected token was never configured', () => {
    // The loader will not build such a configuration at all, which is the first belt.
    expect(refusalCode(() => loadFinance(financeEnv({ MONEY_WEBHOOK_SECRET: undefined })))).toBe('ENV_ENTRY_ABSENT');
    // And if one is hand-assembled past the loader, the guard is the second belt.
    const unconfigured = { expectedSecretToken: undefined, allowedSenderIds: [SENDER] as readonly string[] };
    expect(authorizeDelivery(subject(SENDER, FINANCE_TOKEN), unconfigured).authorized).toBe(false);
    expect(authorizeDelivery(subject(SENDER, ''), { ...unconfigured, expectedSecretToken: '' }).authorized).toBe(false);
  });

  it('refuses an absent token header under an otherwise complete configuration', () => {
    const config = loadFinance(financeEnv());
    expect(authorizeDelivery(subject(SENDER, null), config).authorized).toBe(false);
  });
});

describe('per-agent independence: one agent cannot carry the other agent key or bound (R17, T4)', () => {
  it('gives the two agents disjoint entry names', () => {
    const life = Object.values(AGENT_ENTRY_NAMES.life);
    const finance = Object.values(AGENT_ENTRY_NAMES.finance);
    expect(life.filter((name) => finance.includes(name))).toEqual([]);
    expect(agentEntryNames('life')).toEqual(AGENT_ENTRY_NAMES.life);
    expect(agentEntryNames('finance')).toEqual(AGENT_ENTRY_NAMES.finance);
  });

  it('does not surface the life key or bound when finance loads from an environment holding both', () => {
    const both = { ...financeEnv(), OR_KEY_LIFE: LIFE_KEY, LIFE_WEEKLY_CAP: '9000000', LIFE_WEBHOOK_SECRET: LIFE_TOKEN };
    const binding = loadAgentModelBinding({ agent: 'finance', env: both });
    expect(binding).toEqual({ agent: 'finance', apiKeyRef: 'OR_KEY_FINANCE', weeklyCapMicroUsd: 5_000_000 });
    expect(JSON.stringify(binding)).not.toContain(LIFE_KEY);
    expect(JSON.stringify(binding)).not.toContain('LIFE');
    const config = loadTelegramTransportConfig({ agent: 'finance', env: both, botId: BOT });
    expect(config.expectedSecretToken).toBe(FINANCE_TOKEN);
    expect(JSON.stringify(config)).not.toContain(LIFE_TOKEN);
  });

  it('does not surface the finance key or bound when life loads from an environment holding both', () => {
    const both = { ...lifeEnv(), OR_KEY_FINANCE: FINANCE_KEY, FINANCE_WEEKLY_CAP: '9000000', MONEY_WEBHOOK_SECRET: FINANCE_TOKEN };
    const binding = loadAgentModelBinding({ agent: 'life', env: both });
    expect(binding).toEqual({ agent: 'life', apiKeyRef: 'OR_KEY_LIFE', weeklyCapMicroUsd: 5_000_000 });
    expect(JSON.stringify(binding)).not.toContain(FINANCE_KEY);
    expect(JSON.stringify(binding)).not.toContain('FINANCE');
    const config = loadTelegramTransportConfig({ agent: 'life', env: both, botId: OTHER_BOT });
    expect(config.expectedSecretToken).toBe(LIFE_TOKEN);
    expect(JSON.stringify(config)).not.toContain(FINANCE_TOKEN);
  });

  it('never returns the model key value, only the name of the entry that holds it', () => {
    const binding = loadAgentModelBinding({ agent: 'finance', env: financeEnv() });
    expect(Object.values(binding)).not.toContain(FINANCE_KEY);
    expect(binding.apiKeyRef).toBe(AGENT_ENTRY_NAMES.finance.modelKeyEntry);
  });

  it('refuses an agent whose own key entry is absent, empty, or unfilled', () => {
    expect(refusalCode(() => loadAgentModelBinding({ agent: 'finance', env: financeEnv({ OR_KEY_FINANCE: undefined }) }))).toBe(
      'ENV_ENTRY_ABSENT',
    );
    expect(refusalCode(() => loadAgentModelBinding({ agent: 'finance', env: financeEnv({ OR_KEY_FINANCE: '' }) }))).toBe(
      'ENV_ENTRY_EMPTY',
    );
    expect(
      refusalCode(() => loadAgentModelBinding({ agent: 'finance', env: financeEnv({ OR_KEY_FINANCE: '<OR_KEY_FINANCE>' }) })),
    ).toBe('ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER');
  });

  it('refuses a bound that is absent, zero, negative, or a decimal, per agent', () => {
    for (const bad of [undefined, '', '0', '-1', '2.5', 'five']) {
      const code = refusalCode(() => loadAgentModelBinding({ agent: 'finance', env: financeEnv({ FINANCE_WEEKLY_CAP: bad }) }));
      expect(code, `"${String(bad)}"`).not.toBeNull();
    }
    expect(refusalCode(() => loadAgentModelBinding({ agent: 'finance', env: financeEnv({ FINANCE_WEEKLY_CAP: '0' }) }))).toBe(
      'ENV_WEEKLY_CAP_NOT_POSITIVE_INTEGER',
    );
  });

  it('refuses an identity outside the enumerated agent set rather than defaulting to one', () => {
    const notAnAgent = 'both' as unknown as 'life';
    expect(refusalCode(() => agentEntryNames(notAnAgent))).toBe('ENV_AGENT_UNKNOWN');
  });
});

describe('presence is a boolean, and a value is never rendered (§5.2 rule 5, R19, R24)', () => {
  it('reports which entries are configured without disclosing any of them', () => {
    const presence = describeConfiguredPresence('finance', financeEnv({ BOT_B_TOKEN: 'tok-test-bot' }));
    expect(presence.BOT_B_TOKEN).toBe(true);
    expect(presence.MONEY_WEBHOOK_SECRET).toBe(true);
    expect(presence.OR_KEY_FINANCE).toBe(true);
    for (const value of Object.values(presence)) expect(typeof value).toBe('boolean');
    const rendered = JSON.stringify(presence);
    for (const secret of [FINANCE_TOKEN, FINANCE_KEY, 'tok-test-bot', SENDER, API_BASE]) {
      expect(rendered).not.toContain(secret);
    }
  });

  it('reports an unfilled placeholder as not configured, because a placeholder is not a value', () => {
    const presence = describeConfiguredPresence('finance', financeEnv({ MONEY_WEBHOOK_SECRET: '<MONEY_WEBHOOK_SECRET>' }));
    expect(presence.MONEY_WEBHOOK_SECRET).toBe(false);
    expect(presence.BOT_B_TOKEN).toBe(false);
  });

  it('holds no writer of any kind, so no value can be logged from it', () => {
    const source = readFileSync(LOADER_SOURCE_PATH, 'utf8');
    for (const writer of ['console.', 'process.stdout', 'process.stderr', 'writeFile']) {
      expect(source.includes(writer), `loader must not reference ${writer}`).toBe(false);
    }
  });
});

describe('the loader is the only reader of the ambient environment', () => {
  it('is the single non-test module under src that reaches the process environment', () => {
    const token = ['process', 'env'].join('.');
    const readers = walkSource('src')
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').includes(token));
    expect(readers).toEqual([LOADER_SOURCE_PATH]);
  });
});
