/**
 * NIZAM · DrivePort — the host can create a backup it cannot read
 * Implemented by: PFOS Contract 12 / Phase 2.1 (spec 06-two-agent-vps)
 * Owning requirements: R20 (backup), and it deliberately does not serve R21 (restore) — see below
 * Depends on: none
 *
 * Contract 12 §7.1 in interface form, with the three required properties expressed as types
 * rather than as steps someone remembers to perform in order.
 *
 * What cannot be written down here:
 *
 *  1. **A plaintext upload.** There is no generic `upload(path)` and no `putFile(bytes)` member.
 *     The only way in is {@link DrivePort.uploadEncryptedSnapshot}, whose argument must be an
 *     {@link EncryptedSnapshotArtifact}. A plaintext snapshot is not a permitted value of a field;
 *     it is a call that does not exist.
 *  2. **An artifact whose plaintext still exists.** `plaintextShredded` is the literal `true`, not
 *     a boolean. §7.1.3 requires the intermediate snapshot to be shredded in the same operation as
 *     the encryption, including on the failure path, because a plaintext snapshot that outlives its
 *     encryption is the largest unencrypted concentration of financial data the system ever makes.
 *  3. **An artifact encrypted to a key whose private half is on the box.** `privateKeyPresentOnHost`
 *     is the literal `false`. §7.1.2: the private key lives in the operator's off-host store (gate
 *     G8), so a host compromise yields ciphertext and nothing else.
 *  4. **A file copy passed off as a snapshot.** `source` is the literal `engine_snapshot`. §7.1.1: a
 *     file copy of a write-ahead-logged store that is being written is not a database — it is a
 *     fragment that may restore, may fail, or may restore *wrongly*.
 *  5. **A download.** There is no member that returns snapshot bytes. §7.2 runs the restore drill
 *     **off the host**, with the private key that only exists off the host, and the integrity check
 *     precedes trust. Giving this port a read path would be giving the host the ability to decrypt
 *     what it was designed not to be able to decrypt.
 *
 * `verifyUploadedSnapshot` is a separate, required step, not an optional courtesy: §7.1 states that
 * an upload that is not verified is not a backup.
 *
 * The narrow per-file grant is the owner's, never a service identity's (§7.1, the documented trap:
 * an identity with no personal storage quota cannot own files in a personal store, so uploads fail
 * or orphan). No storage identifier, address, or scope literal appears in this module (R24).
 */

/** §7.1.2. `age` is the tool of record; `gpg` is the documented fallback. */
export const SNAPSHOT_ENCRYPTION_SCHEMES = ['age', 'gpg'] as const;
export type SnapshotEncryptionScheme = (typeof SNAPSHOT_ENCRYPTION_SCHEMES)[number];

/** Content digest used for post-upload verification. One algorithm, so there is nothing to negotiate. */
export interface SnapshotDigest {
  readonly algorithm: 'sha256';
  readonly hex: string;
}

export interface SnapshotEncryption {
  readonly scheme: SnapshotEncryptionScheme;
  /** A REFERENCE to the recipient public key, resolved from the host. Never key material. */
  readonly recipientPublicKeyRef: string;
  /** Literal `false` (§7.1.2). `true` is not a value this type admits. */
  readonly privateKeyPresentOnHost: false;
}

/**
 * The only thing this port will upload. Every field that could have been a promise in a comment
 * is instead a literal the compiler checks.
 */
export interface EncryptedSnapshotArtifact {
  /** Which store this is a snapshot of. One store per artifact; no combined payloads. */
  readonly storeName: string;
  readonly capturedAt: string;
  /** Literal: produced by the engine's own snapshot statement, not by copying files (§7.1.1). */
  readonly source: 'engine_snapshot';
  readonly encryption: SnapshotEncryption;
  /** The ciphertext. There is no sibling field for the plaintext. */
  readonly ciphertext: Uint8Array;
  readonly sizeBytes: number;
  readonly digest: SnapshotDigest;
  /** Literal `true` (§7.1.3): the intermediate plaintext is already gone, failure path included. */
  readonly plaintextShredded: true;
  /**
   * Literal `false`. §7.1 last line: backups contain data. No key, no token, and no environment
   * file is ever part of a payload — secrets are re-provisioned, not restored.
   */
  readonly containsSecrets: false;
}

export interface SnapshotUploadReceipt {
  /** An opaque reference to the remote object. Never a real storage identifier in a tracked file. */
  readonly remoteRef: string;
  readonly uploadedAt: string;
  readonly sizeBytes: number;
  readonly digest: SnapshotDigest;
}

/** What the remote copy must match. Both properties are checked; either mismatch fails the backup. */
export interface SnapshotIntegrityExpectation {
  readonly sizeBytes: number;
  readonly digest: SnapshotDigest;
}

/**
 * §7.1: size and digest are verified after upload. The union keeps a mismatch legible rather than
 * folding it into a boolean, so an operator learns *which* property disagreed.
 */
export type SnapshotVerification =
  | { readonly verified: true; readonly remoteRef: string }
  | { readonly verified: false; readonly remoteRef: string; readonly mismatch: 'size' | 'digest' };

/** Metadata only. Used for bounded retention; it returns no bytes, by design. */
export interface SnapshotListing {
  readonly remoteRef: string;
  readonly storeName: string;
  readonly capturedAt: string;
  readonly sizeBytes: number;
  readonly digest: SnapshotDigest;
}

export interface SnapshotListQuery {
  readonly storeName: string;
  readonly limit: number;
}

/** The backup egress boundary. Three members: put, verify, enumerate. No get. */
export interface DrivePort {
  uploadEncryptedSnapshot(artifact: EncryptedSnapshotArtifact): Promise<SnapshotUploadReceipt>;
  verifyUploadedSnapshot(
    receipt: SnapshotUploadReceipt,
    expected: SnapshotIntegrityExpectation,
  ): Promise<SnapshotVerification>;
  listSnapshots(query: SnapshotListQuery): Promise<readonly SnapshotListing[]>;
}

/**
 * Injected configuration. The folder reference is resolved from the host at run time; no real
 * identifier and no address appears in this repository (steering §0b, R24).
 */
export interface DrivePortConfig {
  readonly folderRef: string;
  /**
   * Single-member literal. §7.1's documented trap: the grant model is a user grant, because a
   * service identity with no personal storage quota cannot own files in a personal store.
   */
  readonly grantModel: 'owner_user_grant';
  /** Bounded retention (§7.1). Injected, so the policy is configuration and not a constant here. */
  readonly retainCount: number;
}
