/**
 * NIZAM · GitHub knowledge client tests.
 * Owning contract: PFOS Contract 05 §5 (GitHub read port, knowledge client).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: githubKnowledgeClient.ts, ../ports/github.ts, ../db/repositories/testStore.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { openTestStore, type TestStore } from '../db/repositories/testStore.ts';
import { createMockGitHubPort } from '../../../tests/helpers/githubMock.ts';
import { pullGitHubKnowledge, buildGitHubReference, deriveContentHash } from './githubKnowledgeClient.ts';
import type { GitHubConfig } from '../config/githubEnvironment.ts';
import { loadGitHubConfig } from '../config/githubEnvironment.ts';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

/** Synthetic GitHubConfig for tests — no real credentials. */
function syntheticConfig(): GitHubConfig {
  const cfg = loadGitHubConfig({
    GITHUB_PAT: 'ghp_syntheticPatValueForTests123',
    GITHUB_REPOS: 'synthetic-owner/synthetic-repo',
  });
  if (cfg === null) throw new Error('Expected config');
  return cfg;
}

describe('buildGitHubReference', () => {
  it('produces a github:// URI from repo and path', () => {
    expect(buildGitHubReference('owner/repo', 'path/to/file.md')).toBe('github://owner/repo/path/to/file.md');
  });

  it('strips leading slashes from path', () => {
    expect(buildGitHubReference('owner/repo', '/path/to/file.md')).toBe('github://owner/repo/path/to/file.md');
  });
});

describe('deriveContentHash', () => {
  it('returns a 64-char lowercase hex string', () => {
    const hash = deriveContentHash('some content');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('differs for different content bytes', () => {
    const h1 = deriveContentHash('same content');
    const h2 = deriveContentHash('different content');
    expect(h1).not.toBe(h2);
  });
});

describe('pullGitHubKnowledge — with mock port', () => {
  it('classifies mock files as github_content and indexes them', async () => {
    store = openTestStore('nizam-github-');
    const port = createMockGitHubPort();
    const config = syntheticConfig();

    // The mock returns a 'synthetic/README.md' file in the directory listing.
    // Its reference will be github://synthetic-owner/synthetic-repo/synthetic/README.md
    // which matches the github_content pattern /^github:\/\/[^/]+\/[^/]+\// .
    // BUT the mock listDirectory returns type:'file' for the first entry.
    const report = await pullGitHubKnowledge(store.ctx, port, config);

    expect(report.repos).toBe(1);
    expect(report.filesConsidered).toBeGreaterThan(0);
    // The mock file should classify and be indexed
    expect(report.indexReport.indexed).toBe(1);
    expect(report.repoResults).toHaveLength(1);
  });

  it('respects maxFilesPerRepo', async () => {
    store = openTestStore('nizam-github-limit-');
    const port = createMockGitHubPort();
    const config = syntheticConfig();
    const report = await pullGitHubKnowledge(store.ctx, port, config, { maxFilesPerRepo: 0 });
    expect(report.filesConsidered).toBe(0);
    expect(report.indexReport.indexed).toBe(0);
  });

  it('a re-pull of the same content is a no-op (idempotent)', async () => {
    store = openTestStore('nizam-github-idem-');
    const port = createMockGitHubPort();
    const config = syntheticConfig();

    const first = await pullGitHubKnowledge(store.ctx, port, config);
    const second = await pullGitHubKnowledge(store.ctx, port, config);

    expect(second.indexReport.alreadyIndexed).toBe(first.indexReport.indexed);
    expect(second.indexReport.indexed).toBe(0);
  });
});
