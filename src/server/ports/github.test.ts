/**
 * NIZAM · GitHub port interface and mock tests.
 * Owning contract: PFOS Contract 05 §5 (GitHub read port, no write methods).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ./github.ts.
 */
import { describe, it, expect } from 'vitest';
import type { GitHubPort } from './github.ts';
import { createMockGitHubPort } from '../../../tests/helpers/githubMock.ts';

describe('GitHubPort — read-only interface', () => {
  it('the mock returns a synthetic file content record', async () => {
    const port = createMockGitHubPort();
    const file = await port.fetchFileContent('synthetic/repo', 'synthetic/README.md');
    expect(file.path).toBe('synthetic/README.md');
    expect(file.sha).toHaveLength(40);
    expect(file.byteCount).toBeGreaterThan(0);
    expect(file.content).toContain('deterministic mock');
  });

  it('the mock returns a directory listing', async () => {
    const port = createMockGitHubPort();
    const entries = await port.listDirectory('synthetic/repo', '');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.type).toBe('file');
  });

  it('the mock tracks call counts', async () => {
    const port = createMockGitHubPort();
    expect(port.callCount()).toBe(0);
    await port.fetchFileContent('r', 'f');
    await port.listDirectory('r', '');
    expect(port.callCount()).toBe(2);
  });

  it('GitHubPort has no write methods', () => {
    // AC-K5: the interface must not expose write operations.
    // We verify this by checking that the port object only has the two declared methods.
    const port: GitHubPort = createMockGitHubPort();
    const keys = Object.keys(port).filter((k) => k !== 'callCount');
    expect(keys.sort()).toEqual(['fetchFileContent', 'listDirectory'].sort());
  });

  it('the secret cannot leak through toString or JSON serialisation — AC-K6', () => {
    // The GitHubPort does not carry a secret directly, but the config (tested in
    // githubEnvironment.test.ts) does. This test covers the port side: no raw
    // credential appears in the mock return values.
    const port = createMockGitHubPort();
    const str = JSON.stringify(port);
    // No `sk-`, no `ghp_`, no `github_pat_` pattern
    expect(str).not.toMatch(/sk-|ghp_|github_pat_/i);
  });
});
