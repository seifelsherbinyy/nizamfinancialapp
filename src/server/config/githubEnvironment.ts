/**
 * NIZAM · GitHub read-only capability environment loader.
 * Owning contract: PFOS Contract 05 §5.2–§5.3 (credential handling, repository allowlist).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./environment (the injected EnvSource).
 *
 * Follows the same fail-closed, opaque-secret pattern as knowledgeEnvironment.ts:
 * - Absence is deliberate: the agent may boot offline without GitHub. An absent GitHub
 *   config means the capability is disabled, not broken.
 * - A partial configuration (PAT present but repos absent, or repos present but PAT absent)
 *   is refused — the two entries are co-dependent.
 * - A placeholder value (`<GITHUB_PAT>`) is detected and refused.
 * - The PAT is wrapped in GitHubSecret so it cannot be serialised to its raw value.
 */
import type { EnvSource } from './environment.ts';

export const GITHUB_ENV_ENTRIES = Object.freeze({
  pat: 'GITHUB_PAT',
  repos: 'GITHUB_REPOS',
} as const);

export type GitHubEnvEntry = (typeof GITHUB_ENV_ENTRIES)[keyof typeof GITHUB_ENV_ENTRIES];

export class GitHubEnvironmentError extends Error {
  readonly entry: GitHubEnvEntry | null;

  constructor(entry: GitHubEnvEntry | null, message: string) {
    super(`NIZAM GitHub environment: ${message}`);
    this.name = 'GitHubEnvironmentError';
    this.entry = entry;
  }
}

/** Opaque secret — reveals only to authorised callers via revealGitHubSecret(). */
export interface GitHubSecret {
  readonly entry: GitHubEnvEntry;
  toString(): string;
  toJSON(): string;
}

const secretValues = new WeakMap<GitHubSecret, string>();

function secret(entry: GitHubEnvEntry, value: string): GitHubSecret {
  const holder = Object.freeze({
    entry,
    toString: (): string => '[redacted]',
    toJSON: (): string => '[redacted]',
  }) as GitHubSecret;
  secretValues.set(holder, value);
  return holder;
}

export function revealGitHubSecret(value: GitHubSecret): string {
  const resolved = secretValues.get(value);
  if (resolved === undefined) throw new GitHubEnvironmentError(value.entry, 'the secret was not produced by the GitHub loader');
  return resolved;
}

/** Parsed GitHub configuration. repos is a non-empty list of owner/repo specs. */
export interface GitHubConfig {
  readonly pat: GitHubSecret;
  /** Validated `owner/repo` specs from GITHUB_REPOS. Empty list not allowed. */
  readonly repos: readonly string[];
}

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function present(env: EnvSource, entry: GitHubEnvEntry): string | null {
  const value = env[entry];
  if (value === undefined || value.trim().length === 0) return null;
  if (/^<[A-Z][A-Z0-9_]*>$/.test(value.trim())) {
    throw new GitHubEnvironmentError(entry, `${entry} still carries its template placeholder`);
  }
  return value;
}

/**
 * Load GitHub configuration from the environment.
 *
 * Returns null when both entries are absent (offline mode).
 * Throws when exactly one entry is present (partial config is refused — Contract 05 §5.3).
 */
export function loadGitHubConfig(env: EnvSource): GitHubConfig | null {
  const patValue = present(env, GITHUB_ENV_ENTRIES.pat);
  const reposValue = present(env, GITHUB_ENV_ENTRIES.repos);

  if (patValue === null && reposValue === null) return null;

  if (patValue === null) {
    throw new GitHubEnvironmentError(GITHUB_ENV_ENTRIES.pat, 'GITHUB_REPOS is set but GITHUB_PAT is absent — partial GitHub config refused');
  }
  if (reposValue === null) {
    throw new GitHubEnvironmentError(GITHUB_ENV_ENTRIES.repos, 'GITHUB_PAT is set but GITHUB_REPOS is absent — partial GitHub config refused');
  }

  const repos = reposValue
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  if (repos.length === 0) {
    throw new GitHubEnvironmentError(GITHUB_ENV_ENTRIES.repos, 'GITHUB_REPOS is present but contains no valid repo specs');
  }

  for (const repo of repos) {
    if (!OWNER_REPO_PATTERN.test(repo)) {
      throw new GitHubEnvironmentError(GITHUB_ENV_ENTRIES.repos, `repo spec "${repo}" is not a valid owner/repo format`);
    }
  }

  return Object.freeze({
    pat: secret(GITHUB_ENV_ENTRIES.pat, patValue),
    repos: Object.freeze(repos),
  });
}

export function describeGitHubPresence(env: EnvSource): Readonly<Record<GitHubEnvEntry, boolean>> {
  return Object.freeze(Object.fromEntries(Object.values(GITHUB_ENV_ENTRIES).map((entry) => [entry, present(env, entry) !== null])) as Record<GitHubEnvEntry, boolean>);
}
