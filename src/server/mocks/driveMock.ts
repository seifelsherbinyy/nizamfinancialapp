/**
 * NIZAM · Deterministic DrivePort mock — an upload that can be caught lying
 * Implemented by: PFOS Contract 12 / Phase 2.2 (spec 06-two-agent-vps)
 * Owning requirements: R20 (backup); deliberately not R21 (restore) — the port has no read path
 * Depends on: ../ports/drive, ../ports/errors, ./invocationRecorder, ./failure
 *
 * The BUILD half of the backup boundary (steering §2). The live half needs the owner's consent
 * click (G5) and the off-host key (G8), so nothing here reaches a network, names a storage
 * address, or holds an identifier: `folderRef` on {@link DrivePortConfig} is a reference the host
 * resolves at run time (R24).
 *
 * Determinism. No clock of its own — `uploadedAt` comes from the injected `now`. No randomness:
 * `remoteRef` is the store name and a per-mock upload counter, so two identical scripts produce
 * identical references. No filesystem: the "remote" is an in-memory list of metadata rows, which
 * is all the port can ask for anyway, because §7.2 keeps the restore drill off the host and gives
 * this boundary no member that returns bytes.
 *
 * Why the receipt reports the REMOTE's numbers rather than echoing the artifact's. §7.1 says an
 * upload that is not verified is not a backup, and a verification step that compares an artifact
 * with itself would always pass. So a stored row carries what the remote has, the receipt reports
 * that, and {@link DrivePort.verifyUploadedSnapshot} compares it against the caller's expectation.
 * `corruptRemote` makes the two disagree on purpose, which is the only way a test can prove the
 * check fires.
 *
 * The failure paths a caller can drive:
 *   - **an unusable grant** (§7.1's documented trap: an identity with no personal storage quota
 *     cannot own files in a personal store, so uploads fail or orphan);
 *   - **a failed upload**;
 *   - **a size mismatch** and **a digest mismatch**, kept as distinct outcomes so an operator
 *     learns which property disagreed rather than reading a bare boolean.
 */
import type { PortFailureCode } from '../ports/errors.ts';
import type {
  DrivePort,
  DrivePortConfig,
  EncryptedSnapshotArtifact,
  SnapshotDigest,
  SnapshotIntegrityExpectation,
  SnapshotListQuery,
  SnapshotListing,
  SnapshotUploadReceipt,
  SnapshotVerification,
} from '../ports/drive.ts';
import { MockPortFailure } from './failure.ts';
import type { InvocationRecorder } from './invocationRecorder.ts';

export interface DriveMockConfig {
  readonly config: DrivePortConfig;
  readonly recorder: InvocationRecorder;
  /** Injected clock. This mock reads no ambient time. */
  readonly now: () => string;
  /** §7.1's grant trap: the per-file grant is unusable, so nothing can be uploaded. */
  readonly grantUnusable?: boolean;
  readonly uploadFails?: boolean;
  /** Make the stored copy disagree with the artifact, so verification has something to catch. */
  readonly corruptRemote?: 'size' | 'digest';
}

export interface DriveMock {
  readonly port: DrivePort;
  /** Metadata rows the mock believes the remote holds, oldest first. Never bytes. */
  readonly remote: readonly SnapshotListing[];
  readonly recorder: InvocationRecorder;
}

/** Flip one hex digit, deterministically, so a corrupted digest differs by exactly one place. */
function alteredDigest(digest: SnapshotDigest): SnapshotDigest {
  const head = digest.hex.slice(0, 1) === '0' ? '1' : '0';
  return { algorithm: digest.algorithm, hex: `${head}${digest.hex.slice(1)}` };
}

export function createDriveMock(mockConfig: DriveMockConfig): DriveMock {
  const { config, recorder, now } = mockConfig;
  const remote: SnapshotListing[] = [];
  let uploadSeq = 0;

  function reject(code: PortFailureCode, why: string): never {
    throw new MockPortFailure(code, `NIZAM drive mock: ${why}`, null);
  }

  const port: DrivePort = {
    async uploadEncryptedSnapshot(artifact: EncryptedSnapshotArtifact): Promise<SnapshotUploadReceipt> {
      recorder.record('drive', 'uploadEncryptedSnapshot', {
        folderRef: config.folderRef,
        storeName: artifact.storeName,
        capturedAt: artifact.capturedAt,
        scheme: artifact.encryption.scheme,
        sizeBytes: artifact.sizeBytes,
        digestHex: artifact.digest.hex,
      });

      if (mockConfig.grantUnusable === true) {
        reject('BACKUP_GRANT_UNUSABLE', 'the per-file grant cannot own an object in the destination');
      }
      if (mockConfig.uploadFails === true) reject('BACKUP_UPLOAD_FAILED', 'the upload did not complete');

      uploadSeq += 1;
      const stored: SnapshotListing = {
        remoteRef: `snapshot:${artifact.storeName}:${uploadSeq}`,
        storeName: artifact.storeName,
        capturedAt: artifact.capturedAt,
        sizeBytes: mockConfig.corruptRemote === 'size' ? artifact.sizeBytes + 1 : artifact.sizeBytes,
        digest: mockConfig.corruptRemote === 'digest' ? alteredDigest(artifact.digest) : artifact.digest,
      };
      remote.push(stored);

      return {
        remoteRef: stored.remoteRef,
        uploadedAt: now(),
        sizeBytes: stored.sizeBytes,
        digest: stored.digest,
      };
    },

    async verifyUploadedSnapshot(
      receipt: SnapshotUploadReceipt,
      expected: SnapshotIntegrityExpectation,
    ): Promise<SnapshotVerification> {
      recorder.record('drive', 'verifyUploadedSnapshot', {
        remoteRef: receipt.remoteRef,
        expectedSizeBytes: expected.sizeBytes,
        expectedDigestHex: expected.digest.hex,
      });

      const stored = remote.find((entry) => entry.remoteRef === receipt.remoteRef);
      if (stored === undefined) {
        reject('BACKUP_UPLOAD_FAILED', 'the remote holds no object under that reference');
      }
      // Both properties are checked; either mismatch fails the backup (§7.1).
      if (stored.sizeBytes !== expected.sizeBytes) {
        return { verified: false, remoteRef: receipt.remoteRef, mismatch: 'size' };
      }
      if (stored.digest.hex !== expected.digest.hex) {
        return { verified: false, remoteRef: receipt.remoteRef, mismatch: 'digest' };
      }
      return { verified: true, remoteRef: receipt.remoteRef };
    },

    async listSnapshots(query: SnapshotListQuery): Promise<readonly SnapshotListing[]> {
      recorder.record('drive', 'listSnapshots', {
        storeName: query.storeName,
        limit: query.limit,
        retainCount: config.retainCount,
      });
      // Newest first, which is insertion order reversed — a stable order with no clock read.
      return remote
        .filter((entry) => entry.storeName === query.storeName)
        .reverse()
        .slice(0, query.limit);
    },
  };

  return {
    port,
    get remote() {
      return [...remote];
    },
    recorder,
  };
}
