/**
 * NIZAM · GitHub port deterministic mock for tests.
 * Owning contract: PFOS Contract 05 §5 (GitHub read port interface).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ../../src/server/ports/github.
 *
 * Mock lives in tests/helpers/ per the ports interface-only rule (src/server/ports/*.ts
 * must contain only declarations — no functions, no arrows, no return statements).
 * This file IS an implementation, and that is expected here.
 *
 * All fixtures are synthetic. No real repository name, file path, or owner name appears.
 */
import type { GitHubFileContent, GitHubDirectoryEntry, GitHubPort } from '../../src/server/ports/github.ts';

const MOCK_FILE_CONTENT: GitHubFileContent = {
  path: 'synthetic/README.md',
  content: '# Synthetic repository\n\nThis is a deterministic mock fixture for NIZAM tests.\nNo real content is present.',
  sha: 'a'.repeat(40),
  byteCount: 108,
  lastModifiedAt: '2026-08-01T00:00:00Z',
};

const MOCK_DIRECTORY: readonly GitHubDirectoryEntry[] = [
  { path: 'synthetic/README.md', type: 'file', sha: 'a'.repeat(40), byteCount: 108 },
  { path: 'synthetic/contracts', type: 'dir', sha: 'b'.repeat(40), byteCount: null },
  { path: 'synthetic/schemas', type: 'dir', sha: 'c'.repeat(40), byteCount: null },
];

/**
 * Create a deterministic GitHub port mock.
 *
 * All calls return synthetic fixtures. Call counts are tracked so tests can
 * assert that the port was or was not invoked.
 */
export function createMockGitHubPort(): GitHubPort & { callCount: () => number } {
  let calls = 0;

  return {
    async fetchFileContent(_repo: string, _path: string, _ref?: string): Promise<GitHubFileContent> {
      calls += 1;
      return { ...MOCK_FILE_CONTENT };
    },
    async listDirectory(_repo: string, path: string, _ref?: string): Promise<readonly GitHubDirectoryEntry[]> {
      calls += 1;
      return path.length === 0 ? MOCK_DIRECTORY : [];
    },
    callCount: (): number => calls,
  };
}
