/**
 * NIZAM · The backup uploader CLI — `nizam-backup upload|prune`
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning requirements: R20 (verified upload, bounded retention), R24 (no particular in this file)
 * Depends on: ../ports/drive (the egress boundary type), ../config/environment (the ONE ambient
 *   bridge). Nothing else.
 *
 * This is the command `ops/backup/backup.sh` invokes as `nizam-backup`. It is installed in the
 * backup image at `/usr/local/bin/nizam-backup`. It implements the egress half of the backup
 * path: upload an encrypted artifact, verify the remote copy matches the local size and digest,
 * and prune beyond the retention count.
 *
 * ## Why this is a separate command and not part of backupMain
 *
 * `backup.sh` is a shell script that runs as a subprocess. It calls `nizam-backup upload ...`
 * and `nizam-backup prune ...` as external commands, because the shell script owns the snapshot,
 * encryption and shred steps, and handing it the upload as an external command keeps the
 * responsibilities separated: the script can be audited for what it reads and writes, and this
 * command can be audited for what it sends.
 *
 * ## What this module does NOT hold
 *
 * No storage address, no identifier, no token literal, no folder reference, and no key material.
 * Every one of those arrives from the environment at run time (gate G5). The only output to stdout
 * is the single word `verified` on success, which is what `backup.sh` checks.
 *
 * ## The live adapter is behind a gate
 *
 * The live implementation of the Drive port (the one that actually sends bytes to the storage
 * provider) is gated on G5. Until that gate is observed, this command refuses to run and prints a
 * message naming the gate. The refusal is structural: the adapter module does not exist yet, and
 * this file imports nothing that would call the network. What exists here is the CLI grammar, the
 * argument parsing, and the contract with `backup.sh`.
 */
import nodeProcess from 'node:process';

// ---------------------------------------------------------------------------------------------
// CLI grammar
// ---------------------------------------------------------------------------------------------

export const UPLOADER_COMMAND_NAME = 'nizam-backup';

export interface UploadArgs {
  readonly command: 'upload';
  readonly artifactPath: string;
  readonly storeName: string;
  readonly expectSize: string;
  readonly expectDigest: string;
}

export interface PruneArgs {
  readonly command: 'prune';
  readonly retainCount: number;
}

export type UploaderArgs = UploadArgs | PruneArgs;

/** Parse the CLI arguments. Returns null with a message on invalid input. */
export function parseUploaderArgs(argv: readonly string[]): { args: UploaderArgs } | { error: string } {
  const command = argv[0];
  if (command === 'upload') {
    const artifactIdx = argv.indexOf('--artifact');
    const storeIdx = argv.indexOf('--store');
    const sizeIdx = argv.indexOf('--expect-size');
    const digestIdx = argv.indexOf('--expect-digest');
    if (artifactIdx === -1 || storeIdx === -1 || sizeIdx === -1 || digestIdx === -1) {
      return { error: 'upload requires --artifact, --store, --expect-size, --expect-digest' };
    }
    const artifactPath = argv[artifactIdx + 1] ?? '';
    const storeName = argv[storeIdx + 1] ?? '';
    const expectSize = argv[sizeIdx + 1] ?? '';
    const expectDigest = argv[digestIdx + 1] ?? '';
    if (!artifactPath || !storeName || !expectSize || !expectDigest) {
      return { error: 'upload: all flag values must be non-empty' };
    }
    return { args: { command: 'upload', artifactPath, storeName, expectSize, expectDigest } };
  }
  if (command === 'prune') {
    const retainIdx = argv.indexOf('--retain');
    if (retainIdx === -1) return { error: 'prune requires --retain' };
    const raw = argv[retainIdx + 1] ?? '';
    const retainCount = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(retainCount) || retainCount < 1) {
      return { error: `prune: --retain must be a positive integer, got: ${raw}` };
    }
    return { args: { command: 'prune', retainCount } };
  }
  return { error: `unknown command: ${command ?? '(none)'}; expected upload or prune` };
}

// ---------------------------------------------------------------------------------------------
// The gate-aware runner
// ---------------------------------------------------------------------------------------------

/**
 * The live adapter is gated on G5. Until that gate is observed, this command refuses to proceed.
 * When the adapter exists, this function will import it and dispatch the operation. For now it
 * prints 'verified' for upload (the contract with backup.sh) when the adapter is wired, and
 * exits 0 for prune.
 *
 * THIS IS THE WIRING POINT. The live adapter will be a module that implements DrivePort using
 * the OAuth2 refresh token from G5 and the narrow per-file grant. It will be imported here
 * dynamically or statically once it exists.
 */
export async function runUploaderCommand(args: UploaderArgs): Promise<{ exitCode: number; stdout: string }> {
  // Gate G5 supplies the live adapter. Until it exists, the command refuses.
  // When the adapter is ready, this will dispatch to it. For now, the structural
  // wiring is complete: backup.sh -> nizam-backup -> this module -> DrivePort adapter.
  //
  // The adapter is not built here because it requires network access (steering section 2 wall).
  // What IS proven: the CLI grammar, the argument shapes, and the contract with backup.sh.
  void args;
  return { exitCode: 78, stdout: 'nizam-backup: the live storage adapter is gated on G5; this command cannot proceed until the adapter is wired' };
}

// ---------------------------------------------------------------------------------------------
// The entrypoint
// ---------------------------------------------------------------------------------------------

export async function uploaderMain(argv: readonly string[]): Promise<number> {
  const parsed = parseUploaderArgs(argv);
  if ('error' in parsed) {
    nodeProcess.stderr.write(`${UPLOADER_COMMAND_NAME}: ${parsed.error}\n`);
    return 64;
  }
  const result = await runUploaderCommand(parsed.args);
  if (result.stdout) nodeProcess.stdout.write(`${result.stdout}\n`);
  return result.exitCode;
}

// Direct execution
const exitCode = await uploaderMain(nodeProcess.argv.slice(2));
nodeProcess.exitCode = exitCode;
