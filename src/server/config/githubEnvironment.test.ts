/**
 * NIZAM · GitHub environment loader tests.
 * Owning contract: PFOS Contract 05 §5.2–§5.3 (credential handling, repository allowlist).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./githubEnvironment.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  loadGitHubConfig,
  revealGitHubSecret,
  describeGitHubPresence,
  GitHubEnvironmentError,
} from './githubEnvironment.ts';

describe('loadGitHubConfig — offline mode', () => {
  it('returns null when both entries are absent', () => {
    expect(loadGitHubConfig({})).toBeNull();
  });

  it('returns null when entries are present but empty', () => {
    expect(loadGitHubConfig({ GITHUB_PAT: '', GITHUB_REPOS: '  ' })).toBeNull();
  });
});

describe('loadGitHubConfig — partial config is refused (Contract 05 §5.3)', () => {
  it('throws when PAT is present but REPOS is absent', () => {
    expect(() => loadGitHubConfig({ GITHUB_PAT: 'ghp_synthetic_pat_value_abc123' })).toThrow(
      GitHubEnvironmentError,
    );
  });

  it('throws when REPOS is present but PAT is absent', () => {
    expect(() => loadGitHubConfig({ GITHUB_REPOS: 'synthetic-owner/synthetic-repo' })).toThrow(
      GitHubEnvironmentError,
    );
  });

  it('throws on a template placeholder in PAT', () => {
    expect(() =>
      loadGitHubConfig({ GITHUB_PAT: '<GITHUB_PAT>', GITHUB_REPOS: 'synthetic-owner/synthetic-repo' }),
    ).toThrow(/template placeholder/);
  });
});

describe('loadGitHubConfig — valid config', () => {
  const validEnv = {
    GITHUB_PAT: 'ghp_syntheticPatValueForTests123',
    GITHUB_REPOS: 'synthetic-owner/synthetic-repo,synthetic-owner/second-repo',
  };

  it('returns a frozen config with two repos', () => {
    const cfg = loadGitHubConfig(validEnv);
    expect(cfg).not.toBeNull();
    expect(cfg!.repos).toHaveLength(2);
    expect(cfg!.repos[0]).toBe('synthetic-owner/synthetic-repo');
  });

  it('the PAT is opaque — toString and JSON both return [redacted] (AC-K6)', () => {
    const cfg = loadGitHubConfig(validEnv)!;
    expect(String(cfg.pat)).toBe('[redacted]');
    expect(JSON.stringify(cfg.pat)).toBe('"[redacted]"');
  });

  it('the PAT can be revealed via revealGitHubSecret', () => {
    const cfg = loadGitHubConfig(validEnv)!;
    expect(revealGitHubSecret(cfg.pat)).toBe('ghp_syntheticPatValueForTests123');
  });

  it('a secret not produced by the loader cannot be revealed', () => {
    const alien = Object.freeze({
      entry: 'GITHUB_PAT' as const,
      toString: () => '[redacted]',
      toJSON: () => '[redacted]',
    });
    expect(() => revealGitHubSecret(alien)).toThrow(/not produced by the GitHub loader/);
  });

  it('trims whitespace from repo specs', () => {
    const cfg = loadGitHubConfig({ ...validEnv, GITHUB_REPOS: '  synthetic-owner/synthetic-repo  ,  other-owner/other-repo  ' });
    expect(cfg!.repos[0]).toBe('synthetic-owner/synthetic-repo');
    expect(cfg!.repos[1]).toBe('other-owner/other-repo');
  });
});

describe('loadGitHubConfig — malformed repo specs refused', () => {
  it('rejects a repo spec without a slash', () => {
    expect(() =>
      loadGitHubConfig({ GITHUB_PAT: 'ghp_syntheticPatValueForTests123', GITHUB_REPOS: 'no-slash-here' }),
    ).toThrow(GitHubEnvironmentError);
  });

  it('rejects an empty repos string', () => {
    expect(() =>
      loadGitHubConfig({ GITHUB_PAT: 'ghp_syntheticPatValueForTests123', GITHUB_REPOS: ',,,  ' }),
    ).toThrow(/no valid repo specs/);
  });
});

describe('describeGitHubPresence', () => {
  it('reports both absent', () => {
    const p = describeGitHubPresence({});
    expect(p['GITHUB_PAT']).toBe(false);
    expect(p['GITHUB_REPOS']).toBe(false);
  });

  it('reports both present', () => {
    const p = describeGitHubPresence({
      GITHUB_PAT: 'ghp_syntheticPatValueForTests123',
      GITHUB_REPOS: 'synthetic-owner/synthetic-repo',
    });
    expect(p['GITHUB_PAT']).toBe(true);
    expect(p['GITHUB_REPOS']).toBe(true);
  });
});
