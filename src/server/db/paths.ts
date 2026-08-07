/**
 * NIZAM · Server store path guard — one agent, one data directory
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: errors.ts
 *
 * Contract 06 §2.1.2 (owning requirements R1, R6): the finance process resolves its
 * store path from a single injected configuration value and never constructs a path
 * to another agent's file. An attempt to resolve outside its own data directory is a
 * typed error, NOT a fallback to some default location.
 *
 * The guard is containment, not pattern matching: a traversal segment, an absolute
 * override, or a symlink pointing out of the directory all fail the same single
 * check, so there is no denylist to keep up to date.
 */
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, dirname, basename } from 'node:path';
import { StorePathError } from './errors';

/** Canonicalize when the path exists; otherwise leave it resolved-but-unvisited. */
function canonical(candidate: string): string {
  try {
    return existsSync(candidate) ? realpathSync(candidate) : candidate;
  } catch {
    return candidate;
  }
}

/**
 * Canonicalize a store file path: the file itself may not exist yet, but its parent
 * directory does, and the parent is where a symlink escape would hide.
 */
function canonicalFile(candidate: string): string {
  const parent = canonical(dirname(candidate));
  return resolve(parent, basename(candidate));
}

/** True when `child` lies inside `root`. `root` itself does not count as inside. */
function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolve `fileName` inside `dataDir`, or throw a typed {@link StorePathError}.
 *
 * @param dataDir  The agent's own data directory. Must be absolute and must exist;
 *                 this module never creates it, because inventing a directory is the
 *                 fallback behaviour §2.1.2 forbids.
 * @param fileName The store file, relative to `dataDir`.
 */
export function resolveStorePath(dataDir: string, fileName: string): string {
  if (typeof dataDir !== 'string' || dataDir.trim() === '' || !isAbsolute(dataDir)) {
    throw new StorePathError(
      'STORE_DATA_DIR_INVALID',
      `NIZAM store: the configured data directory must be a non-empty absolute path, got "${String(dataDir)}"`,
      { dataDir: String(dataDir), requested: String(fileName) },
    );
  }
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    throw new StorePathError('STORE_FILE_NAME_INVALID', 'NIZAM store: the configured store file name is empty', {
      dataDir,
      requested: String(fileName),
    });
  }

  const root = canonical(resolve(dataDir));
  if (!existsSync(root)) {
    throw new StorePathError(
      'STORE_DATA_DIR_MISSING',
      `NIZAM store: the configured data directory does not exist: ${root}. Mount it; this process will not choose another location.`,
      { dataDir: root, requested: fileName },
    );
  }

  const resolved = canonicalFile(resolve(root, fileName));
  if (!isInside(root, resolved)) {
    throw new StorePathError(
      'STORE_PATH_ESCAPES_DATA_DIR',
      `NIZAM store: "${fileName}" resolves to ${resolved}, which is outside the configured data directory ${root}. Contract 06 §2.1.2 forbids opening a path outside this agent's own data directory — no other agent's store, and no fallback.`,
      { dataDir: root, requested: fileName, resolved },
    );
  }
  return resolved;
}

/**
 * True when `fileName` resolves inside `dataDir`. Convenience for callers that want
 * to test a candidate without catching; the write path always uses the throwing form
 * so a rejection can never be mistaken for a location choice.
 */
export function isWithinDataDir(dataDir: string, fileName: string): boolean {
  try {
    resolveStorePath(dataDir, fileName);
    return true;
  } catch {
    return false;
  }
}
