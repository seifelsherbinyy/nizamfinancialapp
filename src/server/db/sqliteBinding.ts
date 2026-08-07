/**
 * NIZAM · The runtime's built-in SQLite binding, resolved without a bundler
 * Implemented by: PFOS Contract 06 / Phase 1.1 (spec 06-two-agent-vps)
 * Depends on: node:module (types from node:sqlite, erased at compile time)
 *
 * Contract 06 §2.2 requires the runtime's BUILT-IN binding: no third-party driver, no
 * ORM, no native compilation step, because this store holds financial facts and must add
 * zero supply-chain surface. This module is that requirement, and nothing else.
 *
 * Why the binding is required through CJS rather than imported statically:
 * `node:sqlite` is a PREFIX-ONLY builtin — it exists only under the `node:` specifier and
 * is absent from `module.builtinModules` without it. Bundlers that detect builtins by
 * stripping the prefix therefore conclude that a package called "sqlite" must be
 * installed, and fail to resolve it. Requiring it here keeps the specifier out of any
 * bundler's module graph and lets the runtime resolve its own builtin. The type-only
 * import below is erased at compile time, so it adds no runtime specifier either.
 *
 * This is a resolution detail, not a dependency: no package is installed, and the code
 * that runs is the runtime's own binding.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

/** The subset of the binding this tier uses. */
interface SqliteBinding {
  readonly DatabaseSync: new (location: string) => DatabaseSync;
}

const requireBuiltin = createRequire(import.meta.url);

export const sqlite: SqliteBinding = requireBuiltin('node:sqlite') as SqliteBinding;

/** An open connection to the store. Re-exported so callers need no direct specifier. */
export type SqliteDatabase = DatabaseSync;
