// @vitest-environment node
/**
 * NIZAM · The Drive mock proves verification fires — contract 12 §7.1 (R20)
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Depends on: ./driveMock, ./invocationRecorder, ./fixtures, ../ports/drive
 *
 * §7.1's central claim is that an upload which is not verified is not a backup. A test can only
 * support that claim if the verification step is capable of failing, which means the stored copy has
 * to be able to disagree with the artifact. `corruptRemote` makes it disagree by exactly one
 * property, so the size mismatch and the digest mismatch are each observed separately and neither
 * is inferred from the other.
 *
 * The artifacts come from the recorded fixture, through `snapshotArtifactFrom`, which is also the
 * only way to obtain one: a plaintext snapshot, an unshredded artifact, a host-resident private key
 * and a file copy are all inexpressible in the port's types.
 */
import { describe, expect, it } from 'vitest';

import { createDriveMock, type DriveMockConfig } from './driveMock';
import { MockPortFailure } from './failure';
import { loadRecordedInteractions, nodeFixtureSource, snapshotArtifactFrom } from './fixtures';
import { createInvocationRecorder } from './invocationRecorder';
import type { DrivePortConfig, EncryptedSnapshotArtifact } from '../ports/drive';

const FIXED_NOW = (): string => '2026-03-02T03:10:00Z';

const CONFIG: DrivePortConfig = {
  folderRef: 'NIZAM_BACKUP_FOLDER_REF',
  grantModel: 'owner_user_grant',
  retainCount: 7,
};

const loaded = loadRecordedInteractions(nodeFixtureSource(), 'two-agent-smoke');

function artifactAt(index: number): EncryptedSnapshotArtifact {
  const recorded = loaded.set.snapshots[index];
  if (recorded === undefined) throw new Error(`the fixture must carry a snapshot at ${index}`);
  return snapshotArtifactFrom(recorded);
}

function mockWith(overrides: Partial<DriveMockConfig> = {}) {
  const recorder = createInvocationRecorder();
  return createDriveMock({ config: CONFIG, recorder, now: FIXED_NOW, ...overrides });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MockPortFailure) return error.code;
    throw error;
  }
  throw new Error('the mock resolved a call it was supposed to refuse');
}

describe('an upload followed by a verification is a backup (§7.1)', () => {
  it('stores the artifact and answers with a deterministic reference and the injected clock', async () => {
    const mock = mockWith();
    const artifact = artifactAt(0);
    const receipt = await mock.port.uploadEncryptedSnapshot(artifact);
    expect(receipt).toEqual({
      remoteRef: 'snapshot:finance:1',
      uploadedAt: FIXED_NOW(),
      sizeBytes: artifact.sizeBytes,
      digest: artifact.digest,
    });
  });

  it('verifies a faithful copy against both properties', async () => {
    const mock = mockWith();
    const artifact = artifactAt(0);
    const receipt = await mock.port.uploadEncryptedSnapshot(artifact);
    await expect(
      mock.port.verifyUploadedSnapshot(receipt, { sizeBytes: artifact.sizeBytes, digest: artifact.digest }),
    ).resolves.toEqual({ verified: true, remoteRef: receipt.remoteRef });
  });

  it('records the upload without holding the ciphertext', async () => {
    const mock = mockWith();
    const artifact = artifactAt(0);
    await mock.port.uploadEncryptedSnapshot(artifact);
    const call = mock.recorder.callsTo('drive', 'uploadEncryptedSnapshot')[0];
    expect(call?.detail).toEqual({
      folderRef: CONFIG.folderRef,
      storeName: 'finance',
      capturedAt: artifact.capturedAt,
      scheme: 'age',
      sizeBytes: artifact.sizeBytes,
      digestHex: artifact.digest.hex,
    });
  });

  it('gives two mocks driven identically the same receipts', async () => {
    const first = await mockWith().port.uploadEncryptedSnapshot(artifactAt(0));
    const second = await mockWith().port.uploadEncryptedSnapshot(artifactAt(0));
    expect(first).toEqual(second);
  });
});

describe('verification is capable of failing, which is what makes it evidence (§7.1)', () => {
  it('reports a SIZE mismatch when the remote holds a different number of bytes', async () => {
    const mock = mockWith({ corruptRemote: 'size' });
    const artifact = artifactAt(0);
    const receipt = await mock.port.uploadEncryptedSnapshot(artifact);
    expect(receipt.sizeBytes).not.toBe(artifact.sizeBytes);
    await expect(
      mock.port.verifyUploadedSnapshot(receipt, { sizeBytes: artifact.sizeBytes, digest: artifact.digest }),
    ).resolves.toEqual({ verified: false, remoteRef: receipt.remoteRef, mismatch: 'size' });
  });

  it('reports a DIGEST mismatch when the bytes count agrees but the content does not', async () => {
    const mock = mockWith({ corruptRemote: 'digest' });
    const artifact = artifactAt(0);
    const receipt = await mock.port.uploadEncryptedSnapshot(artifact);
    expect(receipt.sizeBytes).toBe(artifact.sizeBytes);
    expect(receipt.digest.hex).not.toBe(artifact.digest.hex);
    await expect(
      mock.port.verifyUploadedSnapshot(receipt, { sizeBytes: artifact.sizeBytes, digest: artifact.digest }),
    ).resolves.toEqual({ verified: false, remoteRef: receipt.remoteRef, mismatch: 'digest' });
  });

  it('refuses to verify a reference the remote does not hold', async () => {
    const mock = mockWith();
    const artifact = artifactAt(0);
    expect(
      await codeOf(
        mock.port.verifyUploadedSnapshot(
          { remoteRef: 'snapshot:finance:99', uploadedAt: FIXED_NOW(), sizeBytes: 1, digest: artifact.digest },
          { sizeBytes: 1, digest: artifact.digest },
        ),
      ),
    ).toBe('BACKUP_UPLOAD_FAILED');
  });
});

describe('the upload failure paths', () => {
  it('refuses when the per-file grant cannot own an object in the destination (§7.1 trap)', async () => {
    const mock = mockWith({ grantUnusable: true });
    expect(await codeOf(mock.port.uploadEncryptedSnapshot(artifactAt(0)))).toBe('BACKUP_GRANT_UNUSABLE');
    expect(mock.remote).toEqual([]);
  });

  it('refuses when the upload does not complete, and stores nothing', async () => {
    const mock = mockWith({ uploadFails: true });
    expect(await codeOf(mock.port.uploadEncryptedSnapshot(artifactAt(0)))).toBe('BACKUP_UPLOAD_FAILED');
    expect(mock.remote).toEqual([]);
  });

  it('still records the attempt, so a test can tell a refusal from a call that never happened', async () => {
    const mock = mockWith({ uploadFails: true });
    await codeOf(mock.port.uploadEncryptedSnapshot(artifactAt(0)));
    expect(mock.recorder.isEmpty('drive', 'uploadEncryptedSnapshot')).toBe(false);
  });
});

describe('listing is metadata only, newest first, and returns no bytes', () => {
  it('scopes to one store and honours the caller limit', async () => {
    const mock = mockWith();
    await mock.port.uploadEncryptedSnapshot(artifactAt(0));
    await mock.port.uploadEncryptedSnapshot(artifactAt(1));
    await mock.port.uploadEncryptedSnapshot({ ...artifactAt(0), capturedAt: '2026-03-02T04:00:00Z' });

    const finance = await mock.port.listSnapshots({ storeName: 'finance', limit: 10 });
    expect(finance.map((entry) => entry.remoteRef)).toEqual(['snapshot:finance:3', 'snapshot:finance:1']);
    const signals = await mock.port.listSnapshots({ storeName: 'signals', limit: 10 });
    expect(signals.map((entry) => entry.storeName)).toEqual(['signals']);

    const capped = await mock.port.listSnapshots({ storeName: 'finance', limit: 1 });
    expect(capped.length).toBe(1);
  });

  it('carries no field that could hold snapshot bytes (§7.2 keeps the restore off the host)', async () => {
    const mock = mockWith();
    await mock.port.uploadEncryptedSnapshot(artifactAt(0));
    const listing = (await mock.port.listSnapshots({ storeName: 'finance', limit: 1 }))[0];
    expect(Object.keys(listing ?? {}).sort()).toEqual([
      'capturedAt',
      'digest',
      'remoteRef',
      'sizeBytes',
      'storeName',
    ]);
  });

  it('answers an empty list rather than failing when a store has no snapshot', async () => {
    const mock = mockWith();
    await expect(mock.port.listSnapshots({ storeName: 'finance', limit: 5 })).resolves.toEqual([]);
  });
});
