# PFOS task 10.9 — Backup Wiring Implementation Increment

**Date:** 2026-08-24  
**Branch:** `work/backup-wiring-20260824`  
**Classification:** review_before_commit / public-repository safe  
**Scope:** build specification only; no credential, no live Drive call, no host mutation, no gate completion

## Authority

This increment is governed by:

1. `.kiro/steering/two-agent-vps.md`
2. `contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md` — backup/restore and public-repository posture
3. `contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md` — store integrity and money persistence boundary
4. `.kiro/specs/06-two-agent-vps/requirements.md` — R20, R21, R22, R23, R24, R27, R28
5. `.kiro/specs/06-two-agent-vps/tasks.md` — task 10.9 and task 10.13
6. `src/server/ports/drive.ts` — the already-authored server storage boundary
7. `ops/backup/backup.sh` and `ops/restore/restore.sh` — the already-authored mechanism that MUST be wired rather than replaced

## Current facts

- `ops/backup/backup.sh` already owns the snapshot → encrypt → shred → verified upload → retention sequence.
- The shell deliberately calls one executable, `nizam-backup`, for upload verification and pruning.
- `src/server/ports/drive.ts` already defines the required semantic boundary: encrypted upload, post-upload verification, metadata-only listing; no download operation exists.
- `ops/env/backup.env.example` already declares the G5 refresh-token/client configuration, destination folder reference, bounded retention and halt inputs.
- `ops/docker-compose.yml` already declares the isolated backup service, read-only store mounts, one writable scratch volume and its own egress network.
- `ops/IMAGE_BUILD.md` explicitly records `<BACKUP_IMAGE_REF>` as `OWNED_BUILD_PENDING`, blocked by task 10.9 because the uploader executable does not exist.
- No implementation of `nizam-backup` was found in the current repository search.

## Non-negotiable design choices

1. **Do not duplicate the shell backup algorithm.** Node owns storage egress only. Snapshot, encryption and shredding stay in `ops/backup/backup.sh`.
2. **No Drive download path on the host.** Restore remains an operator-machine action; the server adapter implements no byte-returning get.
3. **Only encrypted bytes cross the storage adapter.** The executable receives a ciphertext path plus the local size/digest expectation after the plaintext has already been removed.
4. **Use the narrow user grant.** Token refresh must use the existing G5 owner-user grant entries and request only the scope already governed by the repository; never broaden to full Drive access.
5. **No secret in logs or tracked artifacts.** Errors may name an entry or refusal code, never token/client-secret values or remote identifiers.
6. **Folder creation must be application-created.** If `BACKUP_FOLDER_REF` represents the not-yet-created state defined by the operator flow, the adapter creates the destination under its narrow grant and persists only the resulting opaque reference outside tracked source.
7. **Retention is metadata-only.** Listing may return object metadata; deletion is allowed only for encrypted backup objects selected by the bounded retention policy. The backup host still has no read path for archive bytes.

## Smallest coherent change — five steps

### 1. Add the server-side Drive backup adapter

**Files:**
- `src/server/backup/driveBackupAdapter.ts` — new
- `src/server/backup/driveBackupAdapter.test.ts` — new

**Responsibilities:**
- implement the `DrivePort` semantic boundary with injected `fetch`, clock and token provider;
- refresh an access token from `STORAGE_TOKEN_URL` using `DRIVE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`;
- upload encrypted bytes and attach minimal backup metadata needed for store name / capture order / integrity expectation;
- re-read **metadata only** after upload and return verification success only when remote size + recorded digest match the local expectation;
- enumerate backup metadata for one store and delete only objects chosen for pruning;
- retry only documented retryable provider failures with bounded attempts; no unbounded recursion;
- never expose a method that downloads artifact bytes.

**Blast radius:** server-only; must remain excluded from the browser bundle under AC08b.

**Focused proof:** deterministic fetch fixtures show upload, metadata verification, mismatch refusal, retry bound, refresh-token refusal, metadata-only listing and pruning selection. A negative type/runtime test proves no download method is exposed.

### 2. Add the `nizam-backup` CLI boundary

**Files:**
- `src/server/process/backupCli.ts` — new
- `src/server/process/backupStart.ts` — new
- `src/server/process/backupCli.test.ts` — new

**CLI:**

`nizam-backup upload --artifact <path> --store <label> --expect-size <integer> --expect-digest <sha256>`

- validates the artifact is readable and encrypted-form only;
- validates size is a non-negative safe integer and digest is canonical SHA-256 hex;
- constructs the adapter from the backup service environment;
- uploads then verifies using the DrivePort sequence;
- prints exactly `verified` on success, because `backup.sh` already treats any other stdout as failure;
- emits structured refusal to stderr with no secret, path content or remote identifier.

`nizam-backup prune --retain <integer>`

- validates a positive bounded retain count;
- lists metadata only;
- prunes only backup objects beyond the bound, deterministically oldest first;
- prints no remote identifiers.

`--health`

- validates the service environment and local executable dependencies without making a provider call;
- answers readiness from local configuration/process state only, consistent with R22.

**Blast radius:** backup process only; no change to finance-agent, signal-bus or scheduler process semantics.

**Focused proof:** CLI fixture tests assert exact stdout contract (`verified` only), refusal on malformed digest/size/retain count, no provider call under `--health`, and no secret material in stderr.

### 3. Package the existing shell + new CLI as the owned backup image

**Files:**
- `ops/images/backup/Dockerfile` — new
- `ops/IMAGE_BUILD.md` — update `<BACKUP_IMAGE_REF>` row from `OWNED_BUILD_PENDING` to `BUILT_HERE`
- `src/server/ops/imageOwnership.ts` and its tests — update only if the existing generic audit cannot already admit the new recipe/health command

**Image contents:**
- pinned Node major matching `.nvmrc`;
- production dependencies only;
- `src/`;
- existing `ops/backup/backup.sh`;
- tools the shell already requires (`sqlite3`, `age`, `gpg`, `coreutils`/`sha256sum`/`shred` as supplied by the chosen base/package layer);
- executable shims `nizam-backup` and `<BACKUP_HEALTH_PROBE>` resolving to `backupStart.ts`;
- non-root final user;
- no `ENV`, no real path, no secret, no public port, no `EXPOSE`.

**Entry behavior:** run the existing `backup.sh`; do not reproduce its steps in Node.

**Focused proof:** image-ownership audit must fail if recipe, installed command or declared image state drifts.

### 4. Tighten cross-artifact wiring, without widening configuration

**Files:**
- `ops/backup/backup.sh` — change only if needed to consume a machine-stable CLI error/receipt contract; do not change step order
- `ops/docker-compose.yml` — only if needed to point the health placeholder / entry command at the newly built image semantics; network and mount topology MUST remain unchanged
- `ops/env/backup.env.example` — no new secrets expected; edit only if the executable requires a value that is already contract-authorized and genuinely absent
- `src/server/ops/backupScripts.ts` + tests — extend existing checker only for new cross-artifact command existence/contract, never weaken an existing finding

**Blast radius:** backup service wiring only. No new network, store mount, scope, credential type or human gate.

**Focused proof:** existing snapshot/encrypt/shred/upload/prune order remains byte-for-byte equivalent in the parser/checker; a mutation moving upload before shred must still fail.

### 5. Verify, tamper, then record

**Focused checks, in order:**

1. `npx vitest run src/server/backup/driveBackupAdapter.test.ts src/server/process/backupCli.test.ts src/server/ops/backupScripts.test.ts src/server/ops/imageOwnership.test.ts`
2. `node scripts/verify/toolchain-pin.mjs`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run verify:all -- --all`

**Required tamper proof:** before claiming verification, deliberately mutate one test fixture or temporary in-memory artifact so that at least:
- a digest mismatch causes upload verification to fail; and
- moving the upload step ahead of plaintext shredding causes the backup-script checker to fail.

Revert the tamper and re-run the focused check green.

**Record only after green:**
- mark task 10.9 complete in `.kiro/specs/06-two-agent-vps/tasks.md` with exact observed outputs;
- append the increment to `contracts/pfos/_PFOS_BUILD_LOG.md`;
- update `ops/IMAGE_BUILD.md` as part of the implementation itself;
- update `LIVE_PROGRESS.md` only with observations actually rerun; do not infer L5 from source state;
- do not mark task 10.13 complete until a real backup + off-host restore has been exercised after G5 and G8.

## Verification boundary for this session

The connected GitHub environment exposes repository reads/writes but no shell capable of running the repository, no GitHub Actions workflow exists under `.github/workflows`, and there is no direct OVH shell connector here. Therefore **runtime code for task 10.9 is not being committed from this session**: doing so would violate the repository's own rule that a build increment is not complete without focused checks, the full harness and one tamper proof.

## Next executable action

Open this branch in the operator/desktop development environment that has the repository toolchain, implement steps 1-4 exactly as scoped above, then run step 5 before merging or updating any live-progress state.
