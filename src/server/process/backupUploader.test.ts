// @vitest-environment node
/**
 * NIZAM · Backup uploader CLI tests
 * Implemented by: PFOS Contract 12 / Phase 10.9 (spec 06-two-agent-vps)
 * Owning contract: Contract 12; owning requirements R20 and R24.
 * Phase: 10.9 — test the existing backup.sh-side uploader boundary; no live adapter or network.
 *
 * The uploader is deliberately still gated on G5. The tests therefore cover the CLI grammar and
 * prove that both valid command shapes stop at the gate rather than claiming an upload occurred.
 * Negative mutations change a complete command or its required option before asserting refusal.
 */
import { describe, expect, it } from 'vitest';

import {
  parseUploaderArgs,
  runUploaderCommand,
  UPLOADER_COMMAND_NAME,
  type UploaderArgs,
} from './backupUploader.ts';

const ARTIFACT = 'synthetic-artifact-path';
const STORE = 'synthetic-store-name';
const SIZE = 'synthetic-size';
const DIGEST = 'synthetic-digest';

function uploadArgv(): string[] {
  return ['upload', '--artifact', ARTIFACT, '--store', STORE, '--expect-size', SIZE, '--expect-digest', DIGEST];
}

function mutateArgv(argv: readonly string[], from: string, to: string): string[] {
  const index = argv.indexOf(from);
  expect(index).toBeGreaterThanOrEqual(0);
  const mutated = [...argv];
  mutated[index] = to;
  expect(mutated).not.toEqual(argv);
  return mutated;
}

describe('parseUploaderArgs accepts only the backup.sh command contract', () => {
  it('parses the complete upload shape without rewriting any value', () => {
    const parsed = parseUploaderArgs(uploadArgv());
    expect(parsed).toEqual({
      args: {
        command: 'upload',
        artifactPath: ARTIFACT,
        storeName: STORE,
        expectSize: SIZE,
        expectDigest: DIGEST,
      },
    });
  });

  it('parses a positive retention count as a prune command', () => {
    expect(parseUploaderArgs(['prune', '--retain', '3'])).toEqual({ args: { command: 'prune', retainCount: 3 } });
  });

  it.each([
    ['no command', []],
    ['unknown command', ['inspect']],
    ['missing upload flag', ['upload', '--artifact', ARTIFACT, '--store', STORE, '--expect-size', SIZE]],
    ['empty upload value', ['upload', '--artifact', '', '--store', STORE, '--expect-size', SIZE, '--expect-digest', DIGEST]],
    ['missing prune flag', ['prune']],
    ['zero retention', ['prune', '--retain', '0']],
    ['negative retention', ['prune', '--retain', '-1']],
    ['non-integer retention', ['prune', '--retain', 'x1.5']],
    ['non-numeric retention', ['prune', '--retain', 'many']],
  ] as const)('fires for %s', (_why, argv) => {
    const parsed = parseUploaderArgs(argv);
    expect('error' in parsed).toBe(true);
  });

  it('fires when a valid upload command is mutated to remove its digest value', () => {
    const mutated = mutateArgv(uploadArgv(), DIGEST, '');
    const parsed = parseUploaderArgs(mutated);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) expect(parsed.error).toContain('all flag values');
  });
});

describe('runUploaderCommand remains behind the G5 live-storage gate (R20)', () => {
  const validCommands: readonly UploaderArgs[] = [
    { command: 'upload', artifactPath: ARTIFACT, storeName: STORE, expectSize: SIZE, expectDigest: DIGEST },
    { command: 'prune', retainCount: 3 },
  ];

  it.each(validCommands)('refuses a valid %s command without claiming success', async (args) => {
    const result = await runUploaderCommand(args);
    expect(result.exitCode).toBe(78);
    expect(result.stdout).not.toBe('verified');
    expect(result.stdout).toContain('gated on G5');
  });

  it('fires when a valid upload operation is mutated into a missing artifact', async () => {
    const valid: UploaderArgs = {
      command: 'upload', artifactPath: ARTIFACT, storeName: STORE, expectSize: SIZE, expectDigest: DIGEST,
    };
    const mutated: UploaderArgs = { ...valid, artifactPath: '' };
    expect(mutated).not.toEqual(valid);
    const result = await runUploaderCommand(mutated);
    expect(result.exitCode).toBe(78);
    expect(result.stdout).toContain(UPLOADER_COMMAND_NAME === 'nizam-backup' ? 'G5' : '');
  });
});
