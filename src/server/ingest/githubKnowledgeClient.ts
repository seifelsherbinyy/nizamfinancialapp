/**
 * NIZAM · GitHub knowledge client — pulls repository content into the knowledge index.
 * Owning contract: PFOS Contract 05 §5 (Agent Orchestration, Skill Execution, and Knowledge Integration).
 * Phase: Phase 2.5 extended knowledge integration.
 * Depends on: ../ports/github, ./knowledgeIndex, ../config/githubEnvironment, node:crypto.
 *
 * The injected port is read-only. This module recursively enumerates bounded repository
 * directories, fetches classified files, hashes their actual decoded bytes with SHA-256,
 * and indexes provenance pointers. It never computes financial values.
 */
import { createHash } from 'node:crypto';
import type { GitHubDirectoryEntry, GitHubPort } from '../ports/github.ts';
import type { GitHubConfig } from '../config/githubEnvironment.ts';
import type { RepositoryContext } from '../db/repositories/support.ts';
import {
  classifyKnowledgeDocument,
  indexKnowledgeDocuments,
  type KnowledgeDocument,
  type KnowledgeIndexReport,
} from './knowledgeIndex.ts';

export interface GitHubPullOptions {
  /** Sub-paths within each repo to traverse. Defaults to [''] (root). */
  readonly paths?: readonly string[];
  /** File extension filter. If absent, all files are considered. */
  readonly extensions?: readonly string[];
  /** Git ref for all repositories. Defaults to the default branch. */
  readonly ref?: string;
  /** Maximum files per repository. Default 200. */
  readonly maxFilesPerRepo?: number;
}

export interface GitHubPullReport {
  readonly repos: number;
  readonly filesConsidered: number;
  readonly indexReport: KnowledgeIndexReport;
  readonly repoResults: readonly GitHubRepoPullResult[];
}

export interface GitHubRepoPullResult {
  readonly repo: string;
  readonly filesConsidered: number;
  readonly filesIndexed: number;
  readonly unclassified: readonly string[];
  readonly refused: readonly string[];
}

export function buildGitHubReference(repo: string, path: string): string {
  return `github://${repo}/${path.replace(/^\/+/, '')}`;
}

/** Hash the actual decoded file bytes so identical bytes deduplicate across references. */
export function deriveContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function matchesExtension(path: string, extensions: readonly string[] | null): boolean {
  return extensions === null || extensions.some((extension) => path.endsWith(extension));
}

/** Enumerate directories breadth-first, bounded by the caller's file limit. */
async function enumerateFiles(
  port: GitHubPort,
  repo: string,
  roots: readonly string[],
  ref: string | undefined,
  extensions: readonly string[] | null,
  maxFiles: number,
): Promise<readonly GitHubDirectoryEntry[]> {
  const queue = [...roots];
  const visited = new Set<string>();
  const files: GitHubDirectoryEntry[] = [];

  while (queue.length > 0 && files.length < maxFiles) {
    const path = queue.shift();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const entries = await port.listDirectory(repo, path, ref);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        queue.push(entry.path);
      } else if (entry.type === 'file' && matchesExtension(entry.path, extensions)) {
        files.push(entry);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}

export async function pullGitHubKnowledge(
  ctx: RepositoryContext,
  port: GitHubPort,
  config: GitHubConfig,
  options: GitHubPullOptions = {},
): Promise<GitHubPullReport> {
  const roots = options.paths ?? [''];
  const extensions = options.extensions ?? null;
  const maxFiles = Math.max(0, options.maxFilesPerRepo ?? 200);
  const repoResults: GitHubRepoPullResult[] = [];
  const allDocuments: KnowledgeDocument[] = [];

  for (const repo of config.repos) {
    const entries = await enumerateFiles(port, repo, roots, options.ref, extensions, maxFiles);
    const repoUnclassified: string[] = [];
    const repoRefused: string[] = [];
    const repoDocs: KnowledgeDocument[] = [];

    for (const entry of entries) {
      const reference = buildGitHubReference(repo, entry.path);
      try {
        if (classifyKnowledgeDocument(reference) === null) {
          repoUnclassified.push(reference);
          continue;
        }
      } catch {
        repoRefused.push(reference);
        continue;
      }

      const file = await port.fetchFileContent(repo, entry.path, options.ref);
      repoDocs.push({
        reference,
        documentRef: reference,
        contentHash: deriveContentHash(file.content),
        byteCount: file.byteCount,
      });
    }

    allDocuments.push(...repoDocs);
    repoResults.push({
      repo,
      filesConsidered: entries.length,
      filesIndexed: repoDocs.length,
      unclassified: repoUnclassified,
      refused: repoRefused,
    });
  }

  const indexReport = indexKnowledgeDocuments(ctx, allDocuments);
  return {
    repos: config.repos.length,
    filesConsidered: repoResults.reduce((total, result) => total + result.filesConsidered, 0),
    indexReport,
    repoResults,
  };
}
