/**
 * NIZAM · GitHub read-only port interface.
 * Owning contract: PFOS Contract 05 §5 (Agent Orchestration, Skill Execution, and Knowledge Integration).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: nothing — pure interface declarations only.
 *
 * This file contains interface declarations and type exports only.
 * No functions, no arrow functions, no return statements.
 * The deterministic mock lives in tests/helpers/githubMock.ts per the ports interface-only rule.
 *
 * ## No write methods (AC-K5)
 *
 * The interface has no createFile, updateFile, deleteFile, openPullRequest, or any other
 * mutating method. A consumer that holds a GitHubPort can only read.
 */

/** A single file returned from a GitHub repository read. */
export interface GitHubFileContent {
  /** Synthetic path — never a real path literal in this module. */
  readonly path: string;
  /** Raw decoded content of the file. */
  readonly content: string;
  /** SHA-1 blob hash (GitHub native). Used for change detection, not security. */
  readonly sha: string;
  /** Byte count of the decoded content. */
  readonly byteCount: number;
  /** ISO-8601 timestamp of the last commit to this file, when available. */
  readonly lastModifiedAt: string | null;
}

/** One entry in a repository directory listing. */
export interface GitHubDirectoryEntry {
  readonly path: string;
  readonly type: 'file' | 'dir' | 'symlink' | 'submodule';
  readonly sha: string;
  readonly byteCount: number | null;
}

/**
 * The GitHub read-only port.
 *
 * Contract 05 §5.5: no write methods. This interface exposes only read operations.
 * The methods below are the complete and exhaustive list — no write path exists.
 */
export interface GitHubPort {
  /**
   * Read the content of a single file from an authorised repository.
   * @param repo  `owner/repo` spec — validated against the allowlist by the caller.
   * @param path  File path inside the repository.
   * @param ref   Git ref (branch, tag, or commit SHA). Defaults to the default branch.
   */
  fetchFileContent(repo: string, path: string, ref?: string): Promise<GitHubFileContent>;

  /**
   * List the immediate children of a directory path.
   * @param repo  `owner/repo` spec.
   * @param path  Directory path (empty string for root).
   * @param ref   Git ref. Defaults to the default branch.
   */
  listDirectory(repo: string, path: string, ref?: string): Promise<readonly GitHubDirectoryEntry[]>;
}
