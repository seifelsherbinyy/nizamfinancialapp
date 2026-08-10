/**
 * NIZAM · The environment loader — the one place a configured value is resolved, per service
 * Implemented by: PFOS Contract 12 / Phase 4.5, widened to six services by Phase 10 task 10.2
 *   (spec 06-two-agent-vps, task prompt §3.1 then §6.1)
 * Owning requirements: R11 (the token guard is configured, never defaulted), R12 (the allowlist,
 *   where empty means nobody), R17 (per-agent cap isolation — one agent's key and cap are not
 *   reachable from the other's configuration), R23 (every value traces to a human gate),
 *   R24 (no deployment particular in a tracked file), R25 (the allowlist parse rules),
 *   R27 (all six services, one process-environment bridge, every missing entry in one message,
 *   no default for anything, an unsubstituted placeholder is a failure rather than a value)
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
import { SPEND_AGENTS, isSpendAgent, type SpendAgent } from '../../features/routing/spendLedger.ts';
import {
  TELEGRAM_TRANSPORT_MODES,
  type TelegramTransportConfig,
  type TelegramTransportMode,
} from '../ports/telegram.ts';
import { secretTokenIsConfigured } from '../telegram/auth.ts';

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
  'ENV_SERVICE_UNKNOWN',
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
  'ENV_SHARED_ENTRY_DISAGREES',
  'ENV_KILL_SENTINEL_OUTSIDE_MOUNT',
  'ENV_FOREIGN_ENTRY_PRESENT',
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

/**
 * Any entry whose value is a positive whole number, read by the SAME rule `MAX_WORK_ITEMS` is read
 * by (added by phase 10.7).
 *
 * WHY THIS IS EXPORTED. The six-service pass above asserts COMPLETENESS — set, non-blank, not still
 * a placeholder — and deliberately not shape, because a shape rule belongs to whoever consumes the
 * value. Two of the finance service's entries are consumed by the PROCESS rather than by a typed
 * loader here: `FINANCE_CONTAINER_PORT` and `STORE_BUSY_TIMEOUT_MS`. Exporting the rule keeps one
 * implementation of "a bare run of digits, refusing a decimal and an exponent rather than rounding
 * them", instead of the process growing a second one that could drift from this one.
 */
export function parsePositiveIntegerEntry(env: EnvSource, entry: string, why: string): number {
  return readPositiveInteger(env, entry, 'ENV_MAX_WORK_ITEMS_NOT_POSITIVE_INTEGER', why);
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

// =============================================================================================
// Phase 10, task 10.2 — the same loader, over all six services (R27)
// =============================================================================================
//
// WHAT CHANGES AND WHAT DOES NOT. The deployment declares six services, not two agents:
// `ops/docker-compose.yml` gives each of them exactly one `env_file`, and `ops/env/*.env.example`
// is the entry set behind it. Everything above resolved the two AGENT configurations, which is
// four of the six. This section widens the coverage to all six and adds the one property the
// module did not have — every missing entry named in a SINGLE message — while leaving the two
// properties that were already mechanical exactly as they were:
//
//  * ONE BRIDGE TO THE AMBIENT ENVIRONMENT. {@link processEnvSource} is still the only expression
//    in `src/` that reads it, and the tree scan in the test suite still finds exactly one
//    permitted hit. Six services did NOT become six bridges; they became six entry-name groups
//    behind the one bridge, each group handed an {@link EnvSource} by its caller.
//  * PER-SERVICE INDEPENDENCE IS STRUCTURAL, NOT CHECKED. {@link SERVICE_ENTRY_NAMES} gives each
//    identity its own entry names, exactly as {@link AGENT_ENTRY_NAMES} does for the two agents,
//    and {@link serviceEntryNames} refuses an identity outside the enumerated set rather than
//    defaulting to one. There is no lookup by arbitrary string anywhere below: a `proxy` load can
//    no more spell `OR_KEY_FINANCE` than a `finance` load can spell `OR_KEY_LIFE`.
//
// AND NO DEFAULT FOR ANYTHING, STILL. Every entry named below is required of its service. The one
// documented exception is {@link ABSENCE_IS_A_DECISION}, and it is an exception about ABSENCE
// only: an unfilled placeholder is refused there too, because an empty allowlist is a decision
// (it means nobody, and the guard refuses everyone under it) while an unfilled template is a
// mistake (R25, and its decision note in the requirements).
//
// `MAX_CONNECTIONS` IS DELIBERATELY ABSENT FROM EVERY GROUP BELOW (finding F2 in
// `TELEGRAM_VALUE_LEDGER.md` §5). It is an argument to the gate G6 registration command and to
// G6's own verification line; it belongs to no environment file, and it is IRRELEVANT in the
// `longPoll` mode phase 1 ships on, because in that mode the provider delivers nothing and there
// is no delivery concurrency for it to bound. Inventing a home for it here would create a value
// with two owners that could disagree; task 10.4 records where it does belong for phase 2.

/**
 * The six services the deployment declares, spelled as `ops/env/*.env.example` names them. The two
 * agent identities are members of this set with the same spelling they carry in `SpendAgent`, so an
 * agent-shaped call site keeps working unchanged.
 */
export const DEPLOYMENT_SERVICES = ['life', 'finance', 'proxy', 'bus', 'scheduler', 'backup'] as const;

export type DeploymentService = (typeof DEPLOYMENT_SERVICES)[number];

export function isDeploymentService(value: unknown): value is DeploymentService {
  return typeof value === 'string' && (DEPLOYMENT_SERVICES as readonly string[]).includes(value);
}

/**
 * Each service's own entry names, transcribed from its own template in `ops/env/` and from nowhere
 * else. The test suite parses the six templates with the existing `parseEnvTemplate` and asserts
 * this table equals them set for set, in both directions, so an entry invented here or renamed
 * there is a failing test rather than a loader that quietly stops matching the deployment.
 */
export const SERVICE_ENTRY_NAMES: Readonly<Record<DeploymentService, readonly string[]>> = Object.freeze({
  // ops/env/life.env.example — the life agent, which is Python and lives in the other repository;
  // its entry names are agreed here because this is where the boundary shapes are agreed.
  life: Object.freeze([
    'LIFE_DATA_DIR',
    'LIFE_STORE_FILE',
    'STORE_BUSY_TIMEOUT_MS',
    'LIFE_CONTAINER_PORT',
    'BOT_A_TOKEN',
    'LIFE_WEBHOOK_SECRET',
    'ALLOWED_USER_IDS',
    'MSG_API_BASE',
    'TELEGRAM_MODE',
    'MAX_WORK_ITEMS',
    'OR_KEY_LIFE',
    'MODEL_API_BASE',
    'LIFE_WEEKLY_CAP',
    'MODEL_ELIGIBILITY_REGISTRY_PATH',
    'BUS_INTERNAL_ENDPOINT',
    'WHOOP_API_BASE',
    'WHOOP_ACCESS_TOKEN',
    'KILL_SENTINEL_PATH',
    'NIZAM_KILL_ALL',
  ]),
  // ops/env/finance.env.example — this repository's agent. No life secret, and no recovery
  // credential: a recovery band reaches this agent over the consent bus, never as a provider call.
  finance: Object.freeze([
    'FINANCE_DATA_DIR',
    'FINANCE_STORE_FILE',
    'STORE_BUSY_TIMEOUT_MS',
    'FINANCE_CONTAINER_PORT',
    'BOT_B_TOKEN',
    'MONEY_WEBHOOK_SECRET',
    'ALLOWED_USER_IDS',
    'MSG_API_BASE',
    'TELEGRAM_MODE',
    'MAX_WORK_ITEMS',
    'OR_KEY_FINANCE',
    'MODEL_API_BASE',
    'FINANCE_WEEKLY_CAP',
    'MODEL_ELIGIBILITY_REGISTRY_PATH',
    'BUS_INTERNAL_ENDPOINT',
    'KILL_SENTINEL_PATH',
    'NIZAM_KILL_ALL',
  ]),
  // ops/env/proxy.env.example — holds the two secret path segments, because routing by them is the
  // proxy's own job, and holds no bot token and no expected secret token: the constant-time
  // comparison lives in the agent, and a proxy that held the value could compare it somewhere no
  // test covers. Deferred in phase 1: the proxy stays down under `longPoll`.
  proxy: Object.freeze([
    'DOMAIN',
    'ACME_CONTACT',
    'LIFE_WEBHOOK_PATH',
    'MONEY_WEBHOOK_PATH',
    'LIFE_CONTAINER_PORT',
    'FINANCE_CONTAINER_PORT',
  ]),
  // ops/env/bus.env.example — the narrowest service in the deployment, and the one place both
  // agents' state meets, which is why it holds no credential of any kind.
  bus: Object.freeze(['SIGNALS_DATA_DIR', 'SIGNALS_STORE_FILE', 'BUS_INTERNAL_ENDPOINT']),
  // ops/env/scheduler.env.example — a clock. It reads no store, holds no credential, and makes no
  // outbound call, so two of its five entries are the halt.
  scheduler: Object.freeze([
    'LIFE_TICK_ENDPOINT',
    'FINANCE_TICK_ENDPOINT',
    'SCHEDULER_TICK_INTERVAL',
    'KILL_SENTINEL_PATH',
    'NIZAM_KILL_ALL',
  ]),
  // ops/env/backup.env.example — the PUBLIC recipient key is here; the private half is never on the
  // host, which is what makes "this host creates a backup it cannot read" true rather than stated.
  backup: Object.freeze([
    'BACKUP_WORK_DIR',
    'BACKUP_SCHEDULE',
    'AGE_PUBLIC_KEY',
    'BACKUP_ENCRYPTION_SCHEME',
    'BACKUP_RETAIN_COUNT',
    'BACKUP_FOLDER_REF',
    'DRIVE_REFRESH_TOKEN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'STORAGE_TOKEN_URL',
    'KILL_SENTINEL_PATH',
    'NIZAM_KILL_ALL',
  ]),
});

/** Read one service's entry names, refusing an identity outside the enumerated set. */
export function serviceEntryNames(service: DeploymentService): readonly string[] {
  if (!isDeploymentService(service)) {
    throw new EnvConfigError(
      'ENV_SERVICE_UNKNOWN',
      null,
      `a service identity must be one of ${DEPLOYMENT_SERVICES.join(', ')}; an unknown identity is refused rather than defaulted, because defaulting it would resolve one service's configuration under another's name`,
    );
  }
  return SERVICE_ENTRY_NAMES[service];
}

/**
 * Entries whose ABSENCE is a decision rather than a mistake, and therefore not a finding.
 *
 * `ALLOWED_USER_IDS` is the whole of this list and R25 is why: an absent, empty, or whitespace-only
 * allowlist parses to an EMPTY list, and `senderIsAllowlisted` refuses every sender under it — so
 * the unconfigured case is already closed, and refusing the boot as well would refuse a
 * configuration that means "nobody". An UNFILLED PLACEHOLDER is still a finding here, because that
 * is a template nobody completed rather than a list somebody emptied.
 */
export const ABSENCE_IS_A_DECISION: readonly string[] = Object.freeze([SHARED_ENTRIES.allowedSenderIds]);

// ---------------------------------------------------------------------------------------------
// The aggregate refusal: every finding named in ONE message (R27)
// ---------------------------------------------------------------------------------------------

/**
 * One thing wrong with one entry.
 *
 * `code` is per FINDING, deliberately, rather than one umbrella code on the aggregate: the
 * discriminator that lets a caller tell an absent entry from an unusable one is the whole value of
 * a typed refusal, and an umbrella code would throw it away at exactly the moment there is more
 * than one thing to say.
 *
 * `entry` is a NAME and `service` is an identity. Neither is a value, and there is no field that
 * could carry one — the same reason {@link ConfiguredPresence} is booleans and nothing else.
 */
export interface EnvConfigFinding {
  readonly code: EnvConfigErrorCode;
  readonly service: DeploymentService | null;
  readonly entry: string;
  /** Why, in one clause, assembled from the entry NAME alone. */
  readonly why: string;
}

/**
 * A startup refusal that names EVERY finding at once.
 *
 * WHY THIS TYPE EXISTS. {@link EnvConfigError} refuses on the FIRST thing it meets and carries a
 * single `entry`, which makes an operator with four unfilled entries restart four times to learn
 * four names. Ladder rung L0 is the observation that settles it: remove a required entry and the
 * boot must fail naming that entry AND every other missing one in the same message. A
 * first-failure error passes half of that rung, which is why this is real work rather than a
 * re-confirmation of something the module already did.
 *
 * There is no `code` field. A caller discriminates on the type and then reads {@link findings},
 * where every finding carries its own code; {@link codes} is the de-duplicated set of them, in the
 * order they were first met. The message is assembled from entry names, service identities and
 * codes — never from a value, so an aggregate that reaches a log tells an operator what to fix and
 * discloses nothing about what was configured (R24).
 */
export class EnvConfigAggregateError extends Error {
  readonly findings: readonly EnvConfigFinding[];
  readonly entries: readonly string[];
  readonly codes: readonly EnvConfigErrorCode[];

  constructor(findings: readonly EnvConfigFinding[], what: string) {
    if (findings.length === 0) {
      throw new Error('NIZAM environment: an aggregate refusal with no finding would be a refusal with no reason');
    }
    const lines = findings.map((f) => `${f.service === null ? '' : `${f.service}/`}${f.entry} ${f.why} [${f.code}]`);
    super(
      `NIZAM environment: ${what} is not configured — ${findings.length} ${findings.length === 1 ? 'entry' : 'entries'} to fix, all of them named here so one restart answers the whole question: ${lines.join('; ')}`,
    );
    this.name = 'EnvConfigAggregateError';
    this.findings = Object.freeze([...findings]);
    this.entries = Object.freeze([...new Set(findings.map((f) => f.entry))]);
    this.codes = Object.freeze([...new Set(findings.map((f) => f.code))]);
  }
}

/** Throw the aggregate when there is anything to say, and return quietly when there is not. */
export function refuseOnFindings(findings: readonly EnvConfigFinding[], what: string): void {
  if (findings.length > 0) throw new EnvConfigAggregateError(findings, what);
}

/**
 * Classify ONE entry, or `null` when there is nothing wrong with it. Pure, and it never throws:
 * collecting is what makes naming every finding at once possible, so nothing on this path may
 * refuse early.
 */
export function classifyEntry(env: EnvSource, entry: string, service: DeploymentService | null = null): EnvConfigFinding | null {
  const raw = env[entry];
  const absenceIsADecision = ABSENCE_IS_A_DECISION.includes(entry);
  if (raw === undefined) {
    if (absenceIsADecision) return null;
    return {
      code: 'ENV_ENTRY_ABSENT',
      service,
      entry,
      why: 'is not set, and this loader supplies no default',
    };
  }
  const trimmed = raw.trim();
  if (UNSUBSTITUTED_PLACEHOLDER.test(trimmed)) {
    return {
      code: 'ENV_ENTRY_UNSUBSTITUTED_PLACEHOLDER',
      service,
      entry,
      why: 'still holds the angle-bracket placeholder its template ships with, so the template was copied but never filled in',
    };
  }
  if (trimmed.length === 0) {
    if (absenceIsADecision) return null;
    return {
      code: 'ENV_ENTRY_EMPTY',
      service,
      entry,
      why: 'is set but empty, and an empty value is not a configured value',
    };
  }
  return null;
}

/** Every completeness finding for one service's declared entries, in template order. */
export function collectServiceFindings(service: DeploymentService, env: EnvSource): readonly EnvConfigFinding[] {
  const out: EnvConfigFinding[] = [];
  for (const entry of serviceEntryNames(service)) {
    const finding = classifyEntry(env, entry, service);
    if (finding !== null) out.push(finding);
  }
  return Object.freeze(out);
}

/**
 * Refuse one service's boot on an incomplete environment, naming every finding in one message.
 * Returns quietly when the service's entry set is complete; resolving VALUES stays the job of the
 * typed per-agent loaders above, which is why this returns nothing.
 */
export function requireServiceEnvironment(input: { readonly service: DeploymentService; readonly env: EnvSource }): void {
  refuseOnFindings(collectServiceFindings(input.service, input.env), `the ${input.service} service environment`);
}

/** An environment per service. Partial, because a phase may run a subset of the six. */
export type EnvByService = Readonly<Partial<Record<DeploymentService, EnvSource>>>;

/** The services present in an {@link EnvByService}, in the declared order rather than key order. */
export function servicesPresent(envByService: EnvByService): readonly DeploymentService[] {
  return DEPLOYMENT_SERVICES.filter((service) => envByService[service] !== undefined);
}

/** Completeness across several services at once, still one message for all of them. */
export function collectDeploymentFindings(envByService: EnvByService): readonly EnvConfigFinding[] {
  const out: EnvConfigFinding[] = [];
  for (const service of servicesPresent(envByService)) {
    const env = envByService[service];
    if (env === undefined) continue;
    out.push(...collectServiceFindings(service, env));
  }
  return Object.freeze(out);
}

export function requireDeploymentEnvironment(envByService: EnvByService): void {
  refuseOnFindings(collectDeploymentFindings(envByService), 'the deployment environment');
}

// ---------------------------------------------------------------------------------------------
// The cross-file rules the deployment ledger asserts (owner mandate §4)
// ---------------------------------------------------------------------------------------------

/**
 * Entries that appear in more than one service's file and MUST carry the same value in each.
 *
 * These are the rules a per-service loader cannot see, because each service reads one file: two
 * files can each be individually valid and still disagree, and every row below is a way for that
 * disagreement to be silent at boot and expensive later. The loader is where they become
 * checkable; the ledger task writes them down.
 *
 * Not every shared entry belongs here, and the exclusions are the interesting half:
 *  * `TELEGRAM_MODE` is shared but must NOT be equal — phase 1 ships the finance agent on the
 *    long-poll mode while the life agent stays idle, so forcing agreement would refuse the
 *    phasing the owner mandate chose.
 *  * `MAX_WORK_ITEMS` and `STORE_BUSY_TIMEOUT_MS` are per-process capacity choices. One writer per
 *    store, so each agent legitimately picks its own.
 */
export const SHARED_ENTRY_AGREEMENTS: readonly {
  readonly entry: string;
  readonly services: readonly DeploymentService[];
  readonly why: string;
}[] = Object.freeze([
  Object.freeze({
    entry: 'LIFE_CONTAINER_PORT',
    services: Object.freeze<DeploymentService[]>(['proxy', 'life']),
    why: "is the proxy's upstream port and the port the life agent binds; if the two disagree every delivery aborts at the proxy",
  }),
  Object.freeze({
    entry: 'FINANCE_CONTAINER_PORT',
    services: Object.freeze<DeploymentService[]>(['proxy', 'finance']),
    why: "is the proxy's upstream port and the port the finance agent binds; if the two disagree every delivery aborts at the proxy",
  }),
  Object.freeze({
    entry: SHARED_ENTRIES.allowedSenderIds,
    services: Object.freeze<DeploymentService[]>(['life', 'finance']),
    why: 'is the same single operator on both bots; a value in one file and not the other is a deployment that refuses the owner on one bot and has no list on the other',
  }),
  Object.freeze({
    entry: 'KILL_SENTINEL_PATH',
    services: Object.freeze<DeploymentService[]>(['life', 'finance', 'scheduler', 'backup']),
    why: 'is the one path every honouring service examines; a typo in one of the four is a halt that silently does nothing in that service',
  }),
  Object.freeze({
    entry: 'BUS_INTERNAL_ENDPOINT',
    services: Object.freeze<DeploymentService[]>(['bus', 'life', 'finance']),
    why: 'is where the bus listens and where its only two clients dial; a client dialling elsewhere reaches nothing',
  }),
  Object.freeze({
    entry: 'MODEL_ELIGIBILITY_REGISTRY_PATH',
    services: Object.freeze<DeploymentService[]>(['life', 'finance']),
    why: 'gates both agents on one registry document; two paths would let one agent route on evidence the other rejected',
  }),
  Object.freeze({
    entry: SHARED_ENTRIES.apiBase,
    services: Object.freeze<DeploymentService[]>(['life', 'finance']),
    why: "is the messaging provider's published base, identical for every user of that provider",
  }),
  Object.freeze({
    entry: 'MODEL_API_BASE',
    services: Object.freeze<DeploymentService[]>(['life', 'finance']),
    why: "is the model provider's published base, identical for every user of that provider; the KEYS are what differ, and those are per agent",
  }),
]);

/**
 * Where the halt sentinel volume is mounted inside every honouring container, as
 * `ops/docker-compose.yml` mounts it — read-only, at one target, in exactly the four services that
 * honour the coarse halt. Held here as a constant and asserted against the topology by the test
 * suite, so a change in the compose file surfaces as a failing test rather than as a check that
 * quietly stops applying.
 */
export const KILL_SENTINEL_MOUNT_TARGET = '/run/nizam-kill';

/** The entry that names the sentinel file, and the four services that honour it. */
export const KILL_SENTINEL_ENTRY = 'KILL_SENTINEL_PATH';
export const KILL_SENTINEL_SERVICES: readonly DeploymentService[] = Object.freeze<DeploymentService[]>([
  'life',
  'finance',
  'scheduler',
  'backup',
]);

/**
 * Every shared entry that disagrees across the services that share it. The finding names the entry
 * and the services, and never renders either value — knowing WHICH entry disagrees is the whole of
 * what an operator needs, and rendering the two values would put a configured value in a message.
 */
export function collectSharedEntryDisagreements(envByService: EnvByService): readonly EnvConfigFinding[] {
  const out: EnvConfigFinding[] = [];
  for (const rule of SHARED_ENTRY_AGREEMENTS) {
    const holders = rule.services.filter((service) => envByService[service] !== undefined);
    if (holders.length < 2) continue;
    const values = new Map<DeploymentService, string | undefined>();
    for (const service of holders) values.set(service, envByService[service]?.[rule.entry]?.trim());
    const distinct = new Set(values.values());
    if (distinct.size <= 1) continue;
    out.push({
      code: 'ENV_SHARED_ENTRY_DISAGREES',
      service: null,
      entry: rule.entry,
      why: `${rule.why}, and it does not carry the same value in ${holders.join(' and ')}`,
    });
  }
  return Object.freeze(out);
}

/**
 * The sentinel path must resolve INSIDE the mount, in every service that honours the halt. A path
 * outside it names a file the operator's halt never creates, so the sentinel check reads an absence
 * for ever and the halt is a halt that does nothing. A relative segment is refused for the same
 * reason it is refused anywhere else: a path that can climb out of the mount is a path that does.
 */
export function collectKillSentinelFindings(envByService: EnvByService): readonly EnvConfigFinding[] {
  const out: EnvConfigFinding[] = [];
  for (const service of KILL_SENTINEL_SERVICES) {
    const env = envByService[service];
    if (env === undefined) continue;
    const raw = env[KILL_SENTINEL_ENTRY];
    if (raw === undefined) continue; // absence is a completeness finding, reported once, over there
    const value = raw.trim();
    if (value.length === 0 || UNSUBSTITUTED_PLACEHOLDER.test(value)) continue; // likewise
    const inside = value.startsWith(`${KILL_SENTINEL_MOUNT_TARGET}/`);
    const climbs = value.split('/').includes('..');
    if (inside && !climbs) continue;
    out.push({
      code: 'ENV_KILL_SENTINEL_OUTSIDE_MOUNT',
      service,
      entry: KILL_SENTINEL_ENTRY,
      why: `must resolve inside the halt mount at ${KILL_SENTINEL_MOUNT_TARGET} and must not climb out of it; a sentinel elsewhere is a file the operator's halt never creates, which is a kill switch that silently does nothing`,
    });
  }
  return Object.freeze(out);
}

/**
 * Entries present in one service's environment that belong to ANOTHER service and not to this one.
 *
 * This is the negative half of the mandate's cross-file rules, expressed once instead of as four
 * separate greps: the life file must hold no finance secret and the reverse, the proxy file must
 * hold no bot token and no expected secret token, and neither agent file may hold a webhook path
 * segment. Each of those is an entry declared by a different service and not by this one, so all of
 * them fall out of one rule.
 *
 * Only entries some service declares are considered, so an ambient variable belonging to no
 * service — the ones every process carries — is not a finding. Reported separately from
 * completeness because it answers a different question: completeness asks whether this service can
 * boot, isolation asks whether it is holding something it was never meant to see.
 */
export function collectForeignEntryFindings(service: DeploymentService, env: EnvSource): readonly EnvConfigFinding[] {
  const own = new Set(serviceEntryNames(service));
  const out: EnvConfigFinding[] = [];
  for (const other of DEPLOYMENT_SERVICES) {
    if (other === service) continue;
    for (const entry of SERVICE_ENTRY_NAMES[other]) {
      if (own.has(entry)) continue;
      if (env[entry] === undefined) continue;
      if (out.some((f) => f.entry === entry)) continue;
      out.push({
        code: 'ENV_FOREIGN_ENTRY_PRESENT',
        service,
        entry,
        why: `belongs to the ${other} service and not to this one; one environment file per service, read by no other, is what keeps a compromise of one file from yielding another service`,
      });
    }
  }
  return Object.freeze(out);
}

/**
 * Every cross-service finding in one pass: the shared entries that disagree, a sentinel outside its
 * mount, and any service holding another's entry. One message for all of them, for the same reason
 * completeness is one message.
 */
export function collectCrossServiceFindings(envByService: EnvByService): readonly EnvConfigFinding[] {
  const out: EnvConfigFinding[] = [
    ...collectSharedEntryDisagreements(envByService),
    ...collectKillSentinelFindings(envByService),
  ];
  for (const service of servicesPresent(envByService)) {
    const env = envByService[service];
    if (env === undefined) continue;
    out.push(...collectForeignEntryFindings(service, env));
  }
  return Object.freeze(out);
}

export function requireCrossServiceAgreement(envByService: EnvByService): void {
  refuseOnFindings(collectCrossServiceFindings(envByService), 'the deployment environment');
}

/**
 * Which of one SERVICE's entries are configured, as booleans and nothing else. The six-service
 * companion to {@link describeConfiguredPresence}, which answers the same question over the
 * narrower set of entries an agent's typed configuration is built from.
 */
export function describeServiceConfiguredPresence(service: DeploymentService, env: EnvSource): ConfiguredPresence {
  const out: Record<string, boolean> = {};
  for (const entry of serviceEntryNames(service)) out[entry] = entryIsConfigured(env, entry);
  return Object.freeze(out);
}
