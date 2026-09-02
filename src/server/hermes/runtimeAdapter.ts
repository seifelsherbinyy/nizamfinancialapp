/**
 * Execution-only Hermes runtime adapter.
 * Owning contract: UPOI task 4.2; PFOS Contract 05, 06, 12, and 13.
 * Phase: Phase 4.2 execution-only Hermes boundary.
 * Depends on: profilePolicy.ts and toolBoundary.ts.
 *
 * This module is a server-only port. It has no provider, socket, process, store, policy,
 * grant-issuing, financial, or human-gate implementation. Governance supplies a verified
 * grant; an injected synthetic executor performs one already-authorized bounded operation.
 */
import {
  HERMES_PROFILE_NAMES,
  getHermesProfilePolicy,
  type HermesProfileName,
} from './profilePolicy.ts';
import {
  HERMES_TOOL_NAMES,
  HERMES_TOOLS_BY_PROFILE,
  isHermesToolAllowed,
  type HermesToolName,
} from './toolBoundary.ts';

export const HERMES_RUNTIME_STATES = ['BUILT', 'INSTALLED', 'RUNNING', 'VERIFIED', 'SYNCED'] as const;
export type HermesRuntimeState = (typeof HERMES_RUNTIME_STATES)[number];

export const HERMES_RUNTIME_ERROR_CODES = [
  'HERMES_PROFILE_INVALID',
  'HERMES_TOOL_NOT_ALLOWED',
  'HERMES_TOOL_AUTHORITY_FORBIDDEN',
  'HERMES_GRANT_INVALID',
  'HERMES_GRANT_PROFILE_MISMATCH',
  'HERMES_GRANT_NOT_VERIFIED',
  'HERMES_GRANT_SCOPE_MISMATCH',
  'HERMES_INPUT_INVALID',
  'HERMES_EXECUTOR_UNAVAILABLE',
  'HERMES_RESULT_INVALID',
] as const;
export type HermesRuntimeErrorCode = (typeof HERMES_RUNTIME_ERROR_CODES)[number];

export class HermesRuntimeError extends Error {
  readonly code: HermesRuntimeErrorCode;

  constructor(code: HermesRuntimeErrorCode) {
    super(code);
    this.name = 'HermesRuntimeError';
    this.code = code;
  }
}

export interface HermesToolGrant {
  readonly profile: HermesProfileName;
  readonly tool: HermesToolName;
  readonly grantRef: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly issuedBy: 'governance';
}

export interface HermesGrantVerificationContext {
  readonly profile: HermesProfileName;
  readonly tool: HermesToolName;
  readonly now: string;
}

export interface HermesGrantVerifier {
  /** Governance-owned verification. The runtime never creates or widens this grant. */
  verify(grant: HermesToolGrant, context: HermesGrantVerificationContext): boolean;
}

export type HermesBoundedScalar = string | number | boolean | null;
export interface HermesBoundedInput {
  readonly requestRef: string;
  readonly payload: Readonly<Record<string, HermesBoundedScalar>>;
}

export type HermesToolExecutor = (input: HermesBoundedInput, grant: HermesToolGrant) => Promise<unknown>;
export type HermesToolExecutors = Readonly<
  Partial<Record<HermesProfileName, Partial<Record<HermesToolName, HermesToolExecutor>>>>
>;

export interface HermesCapability {
  readonly profile: HermesProfileName;
  readonly tool: HermesToolName;
  readonly requiresGrant: true;
  readonly executionOnly: true;
  readonly authoritative: false;
}

export interface HermesRuntimeReadiness {
  readonly profile: HermesProfileName;
  readonly state: HermesRuntimeState;
  readonly executionOnly: true;
  readonly capabilities: readonly HermesCapability[];
  readonly configuredExecutorCount: number;
}

export interface HermesRuntimeAdapter {
  invoke(profile: HermesProfileName, grant: HermesToolGrant, input: HermesBoundedInput): Promise<unknown>;
  listCapabilities(profile: HermesProfileName): readonly HermesCapability[];
  readiness(profile: HermesProfileName): HermesRuntimeReadiness;
}

export interface HermesRuntimeAdapterOptions {
  readonly grantVerifier: HermesGrantVerifier;
  readonly executors: HermesToolExecutors;
  readonly now: () => string;
  readonly readiness?: Partial<Record<HermesProfileName, HermesRuntimeState>>;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;
const SECRET_PATTERN = /(?:api[_-]?key|token|secret|private key|sk-or-)/iu;
const AUTHORITY_KEY = /(?:amount|balance|currency|milliunit|money|price|cost|financial|policy|grant|gate|approval|authorize|decision)/iu;
const PROFILE_KEY = /(?:^|_)(?:profile|sourceProfile|targetProfile)(?:$|_)/u;
const MAX_REQUEST_REF = 128;
const MAX_INPUT_STRING = 2_000;
const MAX_RESULT_DEPTH = 4;
const MAX_RESULT_ITEMS = 64;

const DENIED_AUTHORITY_TOOLS = new Set<string>([
  'nizamcore.request_pfos_analysis',
  'pfos.read_financial_snapshot',
  'pfos.run_deterministic_analysis',
]);

function isProfile(value: unknown): value is HermesProfileName {
  return typeof value === 'string' && (HERMES_PROFILE_NAMES as readonly string[]).includes(value);
}

function isTool(value: unknown): value is HermesToolName {
  return typeof value === 'string' && (HERMES_TOOL_NAMES as readonly string[]).includes(value);
}

function isRuntimeState(value: unknown): value is HermesRuntimeState {
  return typeof value === 'string' && (HERMES_RUNTIME_STATES as readonly string[]).includes(value);
}

function denyAuthorityTool(tool: string): boolean {
  return DENIED_AUTHORITY_TOOLS.has(tool) || /(?:grant|policy|decision|human[_-]?gate|approval|authorize)/iu.test(tool);
}

function failIfProfileInvalid(profile: unknown): asserts profile is HermesProfileName {
  if (!isProfile(profile)) throw new HermesRuntimeError('HERMES_PROFILE_INVALID');
}

function assertUtc(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
}

function assertGrant(grant: unknown): asserts grant is HermesToolGrant {
  if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  const candidate = grant as Record<string, unknown>;
  const expectedKeys = ['expiresAt', 'grantRef', 'issuedBy', 'profile', 'scope', 'tool'];
  if (Object.keys(candidate).sort().join('\u0000') !== expectedKeys.join('\u0000')) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  if (!isProfile(candidate.profile) || !isTool(candidate.tool)) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  if (candidate.issuedBy !== 'governance' || typeof candidate.grantRef !== 'string' || candidate.grantRef.trim() === '') {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  assertUtc(candidate.expiresAt);
  if (candidate.scope === null || typeof candidate.scope !== 'object' || Array.isArray(candidate.scope)) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  const scope = candidate.scope as Record<string, unknown>;
  const scopeKeys = Object.keys(scope);
  if (scopeKeys.length === 0 || scopeKeys.length > 8 || scopeKeys.some((key) => key.trim() === '' || key.includes('*') || AUTHORITY_KEY.test(key) || PROFILE_KEY.test(key))) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  if (typeof scope.requestRef !== 'string' || scope.requestRef.trim() === '' || scope.requestRef.length > MAX_REQUEST_REF) {
    throw new HermesRuntimeError('HERMES_GRANT_INVALID');
  }
  for (const value of Object.values(scope)) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > 200 || SECRET_PATTERN.test(value)) {
      throw new HermesRuntimeError('HERMES_GRANT_INVALID');
    }
  }
}

function assertScalar(value: unknown): asserts value is HermesBoundedScalar {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return;
  if (typeof value === 'string' && value.length <= MAX_INPUT_STRING && !SECRET_PATTERN.test(value)) return;
  throw new HermesRuntimeError('HERMES_INPUT_INVALID');
}

function assertInput(input: unknown): asserts input is HermesBoundedInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  }
  const candidate = input as Record<string, unknown>;
  if (Object.keys(candidate).sort().join('\u0000') !== 'payload\u0000requestRef') {
    throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  }
  if (typeof candidate.requestRef !== 'string' || candidate.requestRef.trim() === '' || candidate.requestRef.length > MAX_REQUEST_REF) {
    throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  }
  if (candidate.payload === null || typeof candidate.payload !== 'object' || Array.isArray(candidate.payload)) {
    throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  }
  for (const [key, value] of Object.entries(candidate.payload as Record<string, unknown>)) {
    if (key.trim() === '' || key.length > 64 || AUTHORITY_KEY.test(key) || PROFILE_KEY.test(key)) {
      throw new HermesRuntimeError('HERMES_INPUT_INVALID');
    }
    assertScalar(value);
  }
  try {
    if (JSON.stringify(candidate).length > 16_384) throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  } catch (error) {
    if (error instanceof HermesRuntimeError) throw error;
    throw new HermesRuntimeError('HERMES_INPUT_INVALID');
  }
}

function assertSafeResult(value: unknown, profile: HermesProfileName, depth = 0): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_STRING || SECRET_PATTERN.test(value)) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
    return;
  }
  if (depth >= MAX_RESULT_DEPTH || typeof value !== 'object') throw new HermesRuntimeError('HERMES_RESULT_INVALID');
  if (Array.isArray(value)) {
    if (value.length > MAX_RESULT_ITEMS) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
    for (const item of value) assertSafeResult(item, profile, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length > MAX_RESULT_ITEMS) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
  for (const [key, item] of Object.entries(record)) {
    if (AUTHORITY_KEY.test(key)) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
    if (PROFILE_KEY.test(key) && item !== profile) throw new HermesRuntimeError('HERMES_RESULT_INVALID');
    assertSafeResult(item, profile, depth + 1);
  }
}

function capability(profile: HermesProfileName, tool: HermesToolName): HermesCapability {
  return Object.freeze({ profile, tool, requiresGrant: true, executionOnly: true, authoritative: false });
}

export function executionCapabilities(profile: HermesProfileName): readonly HermesCapability[] {
  failIfProfileInvalid(profile);
  return Object.freeze(
    HERMES_TOOLS_BY_PROFILE[profile]
      .filter((tool) => !denyAuthorityTool(tool))
      .map((tool) => capability(profile, tool)),
  );
}

export function createHermesRuntimeAdapter(options: HermesRuntimeAdapterOptions): HermesRuntimeAdapter {
  return {
    async invoke(profile: HermesProfileName, grant: HermesToolGrant, input: HermesBoundedInput): Promise<unknown> {
      failIfProfileInvalid(profile);
      assertGrant(grant);
      assertInput(input);
      if (grant.profile !== profile) throw new HermesRuntimeError('HERMES_GRANT_PROFILE_MISMATCH');
      if (grant.scope.requestRef !== input.requestRef) throw new HermesRuntimeError('HERMES_GRANT_SCOPE_MISMATCH');
      if (denyAuthorityTool(grant.tool)) throw new HermesRuntimeError('HERMES_TOOL_AUTHORITY_FORBIDDEN');
      if (!isHermesToolAllowed(profile, grant.tool)) {
        throw new HermesRuntimeError('HERMES_TOOL_NOT_ALLOWED');
      }
      if (grant.expiresAt <= options.now()) throw new HermesRuntimeError('HERMES_GRANT_NOT_VERIFIED');
      let verified = false;
      try {
        verified = options.grantVerifier.verify(grant, { profile, tool: grant.tool, now: options.now() });
      } catch {
        verified = false;
      }
      if (!verified) throw new HermesRuntimeError('HERMES_GRANT_NOT_VERIFIED');

      const executor = options.executors[profile]?.[grant.tool];
      if (executor === undefined || denyAuthorityTool(grant.tool)) {
        throw new HermesRuntimeError('HERMES_EXECUTOR_UNAVAILABLE');
      }
      const result = await executor(input, grant);
      assertSafeResult(result, profile);
      return result;
    },

    listCapabilities(profile: HermesProfileName): readonly HermesCapability[] {
      return executionCapabilities(profile);
    },

    readiness(profile: HermesProfileName): HermesRuntimeReadiness {
      failIfProfileInvalid(profile);
      const configuredExecutorCount = executionCapabilities(profile).filter(
        (entry) => options.executors[profile]?.[entry.tool] !== undefined,
      ).length;
      const configuredState = options.readiness?.[profile] ?? 'BUILT';
      if (!isRuntimeState(configuredState)) throw new HermesRuntimeError('HERMES_PROFILE_INVALID');
      return Object.freeze({
        profile,
        state: configuredState,
        executionOnly: getHermesProfilePolicy(profile).executionOnly,
        capabilities: executionCapabilities(profile),
        configuredExecutorCount,
      });
    },
  };
}
