/**
 * NIZAM · The environment loader — the one place a configured value is resolved, per agent
 * Implemented by: PFOS Contract 12 / Phase 4.5 (spec 06-two-agent-vps, task prompt §3.1)
 * Owning requirements: R11 (the token guard is configured, never defaulted), R12 (the allowlist,
 *   where empty means nobody), R17 (per-agent cap isolation — one agent's key and cap are not
 *   reachable from the other's configuration), R23 (every value traces to a human gate),
 *   R24 (no deployment particular in a tracked file)
 * Depends on: ../ports/telegram (types + the mode vocabulary), ../telegram/auth
 *   (`secretTokenIsConfigured` — the provider's own token rule, consumed and never restated),
 *   ../../features/routing/spendLedger (the two agent identities, type + guard)
 *
 * WHY THIS FILE EXISTS. Every entry in `ops/env/*.env.example` was declared and audited, and
 * nothing read any of them: `process.env` appeared in no non-test file under `src/`. So the
 * string-to-value shape of every entry was undecided, which is the finding recorded as O1 and F1.
 * This module is the decision, and it is the ONLY module permitted to read the environment —
 * `environment.test.ts` asserts that by scanning the tree, so the property cannot decay into a
 * comment.
 *
 * FIVE PROPERTIES, EACH MECHANICAL RATHER THAN DOCUMENTED.
 *
 *  1. **No default for anything (§5.2, §5.3).** Every required entry that is absent, empty, or
 *     still holding its own `<ANGLE_BRACKET>` placeholder is a startup failure carrying a named
 *     code. There is no fallback endpoint, no fallback mode, no fallback bound, and no fallback
 *     allowlist. An unconfigured guard must not be an open door, so this loader refuses to
 *     produce a configuration a guard would then have to refuse every request under.
 *  2. **The allowlist's empty case is a refusal, not an opening (§5.3, R12).** An absent, empty,
 *     or whitespace-only `ALLOWED_USER_IDS` parses to an EMPTY array rather than to a failure,
 *     because `senderIsAllowlisted` already treats an empty list as nobody. The composition is
 *     what matters and it is what the test asserts: a boot with no allowlist reaches a guard that
 *     refuses every sender, including one that would otherwise be authorised.
 *  3. **The provider's token rule is consumed, never re-implemented.** The configured value is
 *     handed STRAIGHT to {@link secretTokenIsConfigured}, which owns the 1-256 length bound and
 *     the `[A-Za-z0-9_-]` alphabet. This module contains no length number and no alphabet, so it
 *     cannot soften either, and the value is deliberately NOT trimmed on the way through: padding
 *     a secret is a value the provider can never echo, and quietly removing the padding would
 *     turn an un-echoable token into an apparently valid one.
 *  4. **Per-agent independence is structural (R17, contract 12 T4).** The entry names an agent's
 *     configuration is built from are read out of {@link AGENT_ENTRY_NAMES}, keyed by the agent
 *     identity. `OR_KEY_LIFE` and `LIFE_WEEKLY_CAP` are reachable only under `life`;
 *     `OR_KEY_FINANCE` and `FINANCE_WEEKLY_CAP` only under `finance`. Handing this loader an
 *     environment that carries BOTH agents' entries therefore cannot produce a configuration
 *     holding the other agent's key or bound — not because a check rejects it, but because the
 *     other agent's entry name is never looked up. That is the same shape gate G4's own negative
 *     verification asserts over the two environment FILES, held here over the two CONFIGURATIONS.
 *  5. **No value is ever logged.** This module writes nothing: it holds no `console` call and no
 *     sink. {@link describeConfiguredPresence} exists so an operator can see WHICH entries are
 *     configured without any of them being rendered — every field of its result is a boolean, and
 *     the type says so, which is stronger than a formatting habit.
 *
 * WHAT A SECRET IS ALLOWED TO BECOME HERE. Exactly one secret value is resolved into a returned
 * object: the webhook secret token, which becomes `expectedSecretToken`, because the constant-time
 * comparison happens in this agent and needs the value (`ops/env/proxy.env.example`, "what is
 * deliberately absent", item 2). Every other secret is referenced by ENTRY NAME and never read
 * into a returned value — {@link AgentModelBinding.apiKeyRef} is the name of the entry that holds
 * the model key, which is the convention `ports/openrouter.ts` established.
 *
 * NO DEPLOYMENT PARTICULAR (R24, steering §0b). No host, no domain, no path segment, no bot, no
 * sender identifier, and no cap number appears below. The only literals are entry names, the
 * transport scheme prefix, and the two identifier shapes.
 */
import { SPEND_AGENTS, isSpendAgent, type SpendAgent } from '../../features/routing/spendLedger';
import {
  TELEGRAM_TRANSPORT_MODES,
  type TelegramTransportConfig,
  type TelegramTransportMode,
} from '../ports/telegram';
import { secretTokenIsConfigured } from '../telegram/auth';

// ---------------------------------------------------------------------------------------------
// The environment, as a value this module is handed
// ---------------------------------------------------------------------------------------------

/**
 * The environment as this loader sees it. Injected, so every test runs against a synthetic record
 * and nothing in the suite depends on the machine it runs on.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The one bridge to the ambient process environment, isolated in a single expression so the tree
 * scan in `environment.test.ts` has exactly one permitted hit to find.
 */
export function processEnvSource(): EnvSource {
  return process.env;
}

// ---------------------------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------------------------

/**
 * Discriminator for every refusal this loader raises. A caller discriminates on `code`; the
 * message is free to change. Each code names ONE failure mode, so "an unset entry is a startup
 * failure with a named error" is answerable without reading a string.
 */
export const ENV_CONFIG_ERROR_CODES = [
  'ENV_AGENT_UNKNOWN',
  'ENV_ENTRY_ABSENT',
  'ENV_ENTRY_EMPTY',
  'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
  'ENV_API_BASE_NOT_TRANSPORT_SECURED',
  'ENV_MODE_UNKNOWN',
  'ENV_MAX_WORK_ITEMS_NOT_POSITIVE_INTEGER',
  'ENV_WEEKLY_CAP_NOT_POSITIVE_INTEGER',
  'ENV_WEBHOOK_SECRET_UNUSABLE',
  'ENV_ALLOWLIST_ENTRY_MALFORMED',
  'ENV_BOT_IDENTITY_EMPTY',
] as const;

export type EnvConfigErrorCode = (typeof ENV_CONFIG_ERROR_CODES)[number];

/**
 * A typed startup refusal.
 *
 * `entry` is the NAME of the offending environment entry, never its value, and the message is
 * assembled from the name alone — so an error that reaches a log carries what an operator needs
 * to fix it and nothing that would disclose what was configured (§5.2 rule 5, R24).
 */
export class EnvConfigError extends Error {
  readonly code: EnvConfigErrorCode;
  /** The entry at fault, or `null` for a failure that belongs to no single entry. */
  readonly entry: string | null;

  constructor(code: EnvConfigErrorCode, entry: string | null, why: string) {
    super(`NIZAM environment: ${entry === null ? why : `${entry} ${why}`}`);
    this.name = 'EnvConfigError';
    this.code = code;
    this.entry = entry;
  }
}

// ---------------------------------------------------------------------------------------------
// The entry names, split by agent identity so one agent cannot reach the other's
// ---------------------------------------------------------------------------------------------

/** Entries both agents declare (`ENV_SPECS`' shared, non-secret rows). */
export const SHARED_ENTRIES = {
  allowedSenderIds: 'ALLOWED_USER_IDS',
  apiBase: 'MSG_API_BASE',
  mode: 'TELEGRAM_MODE',
  maxWorkItems: 'MAX_WORK_ITEMS',
} as const;

/** The entries that belong to exactly ONE agent. Never a union, never a lookup by string. */
export interface AgentEntryNames {
  /** This agent's bot token (G3). Referenced, never resolved into a returned value. */
  readonly botTokenEntry: string;
  /** The token the provider echoes to THIS agent (G6). The one secret value resolved here. */
  readonly webhookSecretEntry: string;
  /** This agent's own model key (G4). Referenced by name only. */
  readonly modelKeyEntry: string;
  /** This agent's own weekly bound (G4). Never one entry for both agents (§6.2, R17). */
  readonly weeklyCapEntry: string;
}

/**
 * Agent identity to its own entry names, read from `ops/env/life.env.example` and
 * `ops/env/finance.env.example` rather than from any table. The two rows share no entry name, and
 * that is the whole of property 4 in the module note: a `finance` load never spells `OR_KEY_LIFE`.
 */
export const AGENT_ENTRY_NAMES: Readonly<Record<SpendAgent, AgentEntryNames>> = {
  life: {
    botTokenEntry: 'BOT_A_TOKEN',
    webhookSecretEntry: 'LIFE_WEBHOOK_SECRET',
    modelKeyEntry: 'OR_KEY_LIFE',
    weeklyCapEntry: 'LIFE_WEEKLY_CAP',
  },
  finance: {
    botTokenEntry: 'BOT_B_TOKEN',
    webhookSecretEntry: 'MONEY_WEBHOOK_SECRET',
    modelKeyEntry: 'OR_KEY_FINANCE',
    weeklyCapEntry: 'FINANCE_WEEKLY_CAP',
  },
};

/** Read one agent's entry names, refusing an identity outside the enumerated set. */
export function agentEntryNames(agent: SpendAgent): AgentEntryNames {
  if (!isSpendAgent(agent)) {
    throw new EnvConfigError(
      'ENV_AGENT_UNKNOWN',
      null,
      `an agent identity must be one of ${SPEND_AGENTS.join(', ')}; an unknown identity is refused rather than defaulted, because defaulting it would resolve one agent's configuration under the other's name`,
    );
  }
  return AGENT_ENTRY_NAMES[agent];
}

// ---------------------------------------------------------------------------------------------
// Reading one entry
// ---------------------------------------------------------------------------------------------

/**
 * A value still holding its own template placeholder. `ops/env/*.env.example` sets every entry to
 * `<ITS_OWN_NAME>`, so a deployment that copied a template without filling it in presents exactly
 * this shape. Treating it as configured would be the open door §5.2 forbids, dressed as a value.
 */
const UNSUBSTITUTED_PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

/** The scheme prefix a credential-bearing provider call is permitted to travel over. */
const SECURED_TRANSPORT_PREFIX = 'https://';

/** A single provider-rendered account identifier: a bare run of digits. See D-ALLOWLIST. */
const ALLOWLIST_ELEMENT = /^[0-9]+$/;

/**
 * **D-ALLOWLIST, as specified.** The separator between allowlist elements: a comma, a semicolon,
 * or any run of whitespace, in any combination. This is a strict SUPERSET of the operator's
 * interim shape — one bare digit run with no quotes, brackets, or spaces — so a value already
 * written by hand keeps parsing to the same single-element list under this rule. Recorded as an
 * EARS criterion plus a decision note in `.kiro/specs/06-two-agent-vps/requirements.md`, and
 * AWAITING OWNER CONFIRMATION: the delimiter is an owner decision, and this constant is the
 * proposal it is recorded against, not a settled ruling.
 */
export const ALLOWLIST_DELIMITER = /[,;\s]+/;

/** The raw value, or a named failure. No trimming: the caller decides whether padding is legal. */
function readRaw(env: EnvSource, entry: string): string {
  const raw = env[entry];
  if (raw === undefined) {
    throw new EnvConfigError(
      'ENV_ENTRY_ABSENT',
      entry,
      'is not set, and this loader supplies no default; an unset entry is a startup failure rather than a guess (contract 12 §5.2, §5.3)',
    );
  }
  if (UNSUBSTITUTED_PLACEHOLDER.test(raw.trim())) {
    throw new EnvConfigError(
      'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
      entry,
      'still holds the angle-bracket placeholder its template ships with, so the template was copied but never filled in',
    );
  }
  return raw;
}

/** The trimmed value of an entry whose value carries no significant padding. */
function readTrimmed(env: EnvSource, entry: string): string {
  const trimmed = readRaw(env, entry).trim();
  if (trimmed.length === 0) {
    throw new EnvConfigError(
      'ENV_ENTRY_EMPTY',
      entry,
      'is set but empty; an empty value is not a configured value, and there is no default to fall back to',
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------------------------
// The four per-entry shapes
// ---------------------------------------------------------------------------------------------

/**
 * `ALLOWED_USER_IDS` to the `readonly string[]` the guard consumes (R12).
 *
 * Absent, empty, and whitespace-only all yield an EMPTY array rather than a failure, because an
 * empty allowlist is a meaningful configuration: it means nobody. The refusal that follows is the
 * guard's, not this parser's — `environment.test.ts` asserts the composition rather than only the
 * parse, because a parser proved correct in isolation is not evidence that nobody gets in.
 *
 * An element that is not a bare digit run is a startup failure instead of a silent lockout.
 * `senderIsAllowlisted` compares by exact string identity, so a stray quote or bracket would
 * refuse the only sender on the list with a refusal deliberately indistinguishable from a wrong
 * token (`TELEGRAM_VALUE_LEDGER.md` F1). Failing loudly at boot is the only way that mistake is
 * ever diagnosable.
 */
export function parseAllowedSenderIds(raw: string | undefined, entry: string = SHARED_ENTRIES.allowedSenderIds): readonly string[] {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (UNSUBSTITUTED_PLACEHOLDER.test(trimmed)) {
    throw new EnvConfigError(
      'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
      entry,
      'still holds the angle-bracket placeholder its template ships with; an unfilled allowlist is not an empty allowlist, because one is a mistake and the other is a decision',
    );
  }
  const elements = trimmed.split(ALLOWLIST_DELIMITER).filter((part) => part.length > 0);
  for (const element of elements) {
    if (!ALLOWLIST_ELEMENT.test(element)) {
      throw new EnvConfigError(
        'ENV_ALLOWLIST_ENTRY_MALFORMED',
        entry,
        'contains an element that is not a bare run of digits; a quote, a bracket, or any other stray character would refuse the only sender on the list with a refusal indistinguishable from a wrong token, so it is refused at startup instead',
      );
    }
  }
  return Object.freeze([...elements]);
}

/** `TELEGRAM_MODE` to the port's own vocabulary. A case variant is not a member of it. */
export function parseTransportMode(env: EnvSource, entry: string = SHARED_ENTRIES.mode): TelegramTransportMode {
  const value = readTrimmed(env, entry);
  for (const mode of TELEGRAM_TRANSPORT_MODES) {
    if (mode === value) return mode;
  }
  throw new EnvConfigError(
    'ENV_MODE_UNKNOWN',
    entry,
    `must be spelled exactly as the port spells it — one of ${TELEGRAM_TRANSPORT_MODES.join(', ')} — and a case variant is not a member of that set; a mode nobody recognises would otherwise select a transport nobody guarded`,
  );
}

/** A bare run of digits, read as a positive safe integer, or a named failure. */
function readPositiveInteger(env: EnvSource, entry: string, code: EnvConfigErrorCode, why: string): number {
  const value = readTrimmed(env, entry);
  if (!/^[0-9]+$/.test(value)) throw new EnvConfigError(code, entry, why);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new EnvConfigError(code, entry, why);
  return parsed;
}

/** `MAX_WORK_ITEMS` (§5.5.5). Zero is not a bound, it is a queue nothing drains. */
export function parseMaxWorkItems(env: EnvSource, entry: string = SHARED_ENTRIES.maxWorkItems): number {
  return readPositiveInteger(
    env,
    entry,
    'ENV_MAX_WORK_ITEMS_NOT_POSITIVE_INTEGER',
    'must be a positive integer written as a bare run of digits; zero, a negative, a decimal, an exponent, and a non-numeric value are all refused, because zero is not a bound but a queue nothing drains',
  );
}

/**
 * `MSG_API_BASE`. The provider's own documented base is resolved by the operator, so this loader
 * names no host — it asserts only that the address a credential-bearing call would travel to is
 * transport-secured, which is the one property a plaintext base would silently give away.
 */
export function parseApiBase(env: EnvSource, entry: string = SHARED_ENTRIES.apiBase): string {
  const value = readTrimmed(env, entry);
  if (!value.startsWith(SECURED_TRANSPORT_PREFIX)) {
    throw new EnvConfigError(
      'ENV_API_BASE_NOT_TRANSPORT_SECURED',
      entry,
      `must begin with ${SECURED_TRANSPORT_PREFIX}; a bot token is sent on every call to it, so an unsecured base discloses the credential to every hop in between`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// The transport configuration, per agent
// ---------------------------------------------------------------------------------------------

/**
 * What the loader needs that the environment does not supply.
 *
 * `botId` is here rather than read from an entry because **no entry declares it**: it is absent
 * from all three templates, from `ENTRY_SPECS`, and from the `CODE_BINDINGS` table, and the two
 * ways to obtain it — reading the bot token or calling the provider's identity endpoint — are a
 * secret read and an outbound call, both of which belong to a gate (steering §2). So it is
 * injected by whoever holds that answer, and this loader asserts only that it is not empty: the
 * per-bot half of the de-duplication key is worthless if it is blank (§5.4.1, R14).
 */
export interface TransportLoadInput {
  readonly agent: SpendAgent;
  readonly env: EnvSource;
  readonly botId: string;
}

/**
 * Resolve {@link TelegramTransportConfig} for ONE agent.
 *
 * Every field comes from that agent's own entry names plus the shared, non-secret ones. There is
 * no branch on which agent is loading beyond the entry-name lookup, and no field can be satisfied
 * from the other agent's entries, because the other agent's entry names are never spelled.
 */
export function loadTelegramTransportConfig(input: TransportLoadInput): TelegramTransportConfig {
  const names = agentEntryNames(input.agent);
  const { env } = input;

  if (input.botId.trim().length === 0) {
    throw new EnvConfigError(
      'ENV_BOT_IDENTITY_EMPTY',
      null,
      'the bot identity must be supplied and non-empty; it is the per-bot half of the de-duplication key, and a blank half would let one bot\'s update be dropped as a duplicate of the other\'s (contract 12 §5.4.1, R14)',
    );
  }

  // Handed straight through, untrimmed, to the module that owns the provider's token rule.
  const expectedSecretToken = readRaw(env, names.webhookSecretEntry);
  if (!secretTokenIsConfigured({ expectedSecretToken, allowedSenderIds: [] })) {
    throw new EnvConfigError(
      'ENV_WEBHOOK_SECRET_UNUSABLE',
      names.webhookSecretEntry,
      'is not a value the provider could ever echo back, so a handler holding it would refuse every request; the length bound and the alphabet belong to the transport guard and are neither restated nor relaxed here',
    );
  }

  return {
    botId: input.botId,
    expectedSecretToken,
    allowedSenderIds: parseAllowedSenderIds(env[SHARED_ENTRIES.allowedSenderIds]),
    apiBaseUrlRef: parseApiBase(env),
    mode: parseTransportMode(env),
    maxConcurrentWorkItems: parseMaxWorkItems(env),
  };
}

// ---------------------------------------------------------------------------------------------
// The model binding, per agent (R17, contract 12 T4)
// ---------------------------------------------------------------------------------------------

/**
 * One agent's model-side configuration: the NAME of the entry holding its key, and its own weekly
 * bound. There is no `apiKey` field, so no call site can be handed a key by this loader, and there
 * is no field that spans both agents, so no bound can be shared. `ports/openrouter.ts` established
 * both conventions; this type consumes them rather than restating them.
 */
export interface AgentModelBinding {
  readonly agent: SpendAgent;
  /** The entry name, exactly as `OpenRouterPortConfig.apiKeyRef` expects it. Never a value. */
  readonly apiKeyRef: string;
  /** This agent's bound, in the ledger's integer micro-USD (`spendLedger`, §6.1). */
  readonly weeklyCapMicroUsd: number;
}

/**
 * Resolve ONE agent's model binding, and prove its key entry is configured without reading the key
 * into anything that is returned or logged.
 *
 * The bound is read as an integer in the spend ledger's own unit, because that ledger is what
 * enforces it and a second unit on the same number is how two halves of one cap come to disagree.
 * A decimal is refused rather than rounded: there is no floating-point money in this repository,
 * and provider accounting is no exception.
 */
export function loadAgentModelBinding(input: { readonly agent: SpendAgent; readonly env: EnvSource }): AgentModelBinding {
  const names = agentEntryNames(input.agent);
  // Presence only. The value is not returned, not logged, and not carried anywhere.
  readTrimmed(input.env, names.modelKeyEntry);
  return {
    agent: input.agent,
    apiKeyRef: names.modelKeyEntry,
    weeklyCapMicroUsd: readPositiveInteger(
      input.env,
      names.weeklyCapEntry,
      'ENV_WEEKLY_CAP_NOT_POSITIVE_INTEGER',
      "must be a positive integer in the spend ledger's own accounting unit, written as a bare run of digits; a decimal is refused rather than rounded, and a zero bound would refuse every call rather than bound them",
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Presence, as booleans and nothing else
// ---------------------------------------------------------------------------------------------

/**
 * Which of one agent's entries are configured. Every field is a boolean, so this result is safe to
 * log in full and there is no shape in which a value could ride along (§5.2 rule 5, R19, R24).
 *
 * It answers the operator's actual question — "which entry am I missing" — which is exactly the
 * question a loader that refuses on the FIRST missing entry answers one item at a time.
 */
export type ConfiguredPresence = Readonly<Record<string, boolean>>;

/** True when the entry is set, non-blank, and not still holding its template placeholder. */
function entryIsConfigured(env: EnvSource, entry: string): boolean {
  const raw = env[entry];
  if (raw === undefined) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return !UNSUBSTITUTED_PLACEHOLDER.test(trimmed);
}

/**
 * Presence of every entry one agent's configuration depends on, keyed by entry name. The bot token
 * is included because it is the one G3 entry this loader cannot consume — the port declares no
 * field for it, so the adapter that makes provider calls is what will read it — and an entry that
 * nothing observes is an entry whose absence surfaces as a runtime mystery.
 */
export function describeConfiguredPresence(agent: SpendAgent, env: EnvSource): ConfiguredPresence {
  const names = agentEntryNames(agent);
  const entries = [
    names.botTokenEntry,
    names.webhookSecretEntry,
    names.modelKeyEntry,
    names.weeklyCapEntry,
    SHARED_ENTRIES.allowedSenderIds,
    SHARED_ENTRIES.apiBase,
    SHARED_ENTRIES.mode,
    SHARED_ENTRIES.maxWorkItems,
  ];
  const out: Record<string, boolean> = {};
  for (const entry of entries) out[entry] = entryIsConfigured(env, entry);
  return Object.freeze(out);
}
