#!/usr/bin/env bash
# NIZAM - the host creates a backup it cannot read. TEMPLATE ONLY. NOTHING HERE IS EXECUTED BY AN AGENT.
#
# Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, contract 12, phase 7:
#   §7.1.1  a transactionally consistent snapshot, by the engine's own snapshot statement, NEVER a copy
#   §7.1.2  public-key encryption to a recipient whose private half is absent from this host (gate G8)
#   §7.1.3  shred the plaintext in the same operation, INCLUDING on the failure path
#   §7.1    narrow per-file storage grant (gate G5), verified upload, bounded retention, no secret in
#           any payload
#   §3.2.2  every store mount here is READ-ONLY; this is the one service with a cross-store view
#   §8      the halt, in both forms, checked before a run begins and never cached
#   §7.6    this path
# Spec: .kiro/specs/06-two-agent-vps/ - task 7.4. Requirements R6, R20, R23, R24.
# Steering: two-agent-vps.md §2 (writing this file is permitted, RUNNING IT IS NOT), §7 (placeholders
#   only), §0b (no deployment particular in a tracked file - the recipient key included).
# Audited by: src/server/ops/backupScripts.ts, which reads this text on every test run and fires a
#   named finding for each property below. Every one of those findings has a negative test that
#   mutates this file and observes the check fire.
#
# ---------------------------------------------------------------------------------------------
# THE ONE PROPERTY EVERYTHING ELSE SERVES: THIS HOST CANNOT READ WHAT IT WROTE.
# ---------------------------------------------------------------------------------------------
#
# Encryption is to a PUBLIC recipient. Gate G8 generates the keypair on the operator machine and
# moves the private half to an off-host store, so a host compromise yields ciphertext and nothing
# else. That guarantee is only true while the private half is absent, which is why this script is
# built so that there is nowhere for one to enter:
#
#   1. It reads no identity file, no secret key, and no passphrase. Not from the environment, not
#      from a file, not from a prompt.
#   2. IT TAKES NO PARAMETER. The first statement below refuses any argument at all, and no function
#      in this file uses a positional parameter either - each one reads named variables the caller
#      sets. That is not a style preference: a script with no parameter has no parameter through
#      which an identity file or a passphrase could be introduced, so the absence is structural
#      rather than stated. The audit asserts it.
#   3. It performs no decryption. There is no reverse path here at all. Restore lives under
#      ops/restore/ and runs OFF this host (§7.2.2), because giving the host a read path would give
#      it the ability to read exactly what it was designed not to be able to read.
#
# ---------------------------------------------------------------------------------------------
# WHY A FILE COPY IS NOT A SNAPSHOT (§7.1.1)
# ---------------------------------------------------------------------------------------------
#
# All three stores use write-ahead logging (contract 06 §2.2). In that mode the committed state of
# the database is the main file PLUS whatever is still in the write-ahead log, and the two are
# consistent only at instants the engine knows about. Copying the main file of a store that is
# being written therefore does not produce a database: it produces a fragment that may restore, may
# fail to restore, or - the case that matters - may restore WRONGLY and look fine. Copying the
# sidecars alongside it does not fix this, because the copy is not atomic across the set.
#
# The engine's snapshot statement is the documented answer. It takes a read transaction over the
# live store, so it observes one committed instant, and writes a COMPLETE, self-consistent database
# to a new file. There is no torn read to reason about. This script uses that statement and nothing
# else; the audit fails the file if a copy, archive, or stream of a store path ever appears here.
#
# One store per artifact. There is no combined payload, and no cross-store view is ever expressed as
# a query: this script never joins two stores, for any purpose (contract 06 §2.1.3).
#
# OPEN CONSTRAINT, recorded here rather than papered over. The engine documents that a reader of a
# write-ahead-logged database must be able to write that database's shared-memory index sidecar. A
# read-only mount does not permit that, and §3.2.2 requires the mount to be read-only. The two rules
# meet here. The resolution is an operator determination at the first-backup step of
# ops/DEPLOYMENT_CONTROL.md, and it has exactly two acceptable outcomes, now RANKED:
#
#   OUTCOME B - THE DOCUMENTED DEFAULT. The snapshot statement is issued from inside the owning
#   service, which already holds the shared-memory sidecar as its single writer, and the resulting
#   artifact is handed to this script's scratch directory. Choose this one unless there is a reason
#   not to. It needs NO write grant, so it resolves the constraint without widening a mount: the
#   store mounts here stay read-only with no exception carved into them, and this service never
#   opens a store at all. The narrower change is the better one.
#
#   OUTCOME A - THE FALLBACK. This service is granted write access to the sidecar and to nothing
#   else; the store file itself stays read-only. It is still acceptable, and it is still bounded,
#   but it does widen a mount, so it is the second choice rather than the first.
#
# What is NOT acceptable, under any circumstance, is falling back to a copy. So the snapshot step
# here aborts loudly on a refused open instead of degrading.

set -euo pipefail

# A parameter is the only way key material could arrive. There is no parameter.
if [ "$#" -ne 0 ]; then
  printf '%s\n' 'backup refused: this script takes no parameter, so there is no way to hand it an identity file or a passphrase' >&2
  exit 64
fi

# ---------------------------------------------------------------------------------------------
# Topology, not configuration (§3.2.2)
# ---------------------------------------------------------------------------------------------
# ops/docker-compose.yml mounts all three stores READ-ONLY into this service at these targets, and
# gives it exactly one writable path. The targets are constants here on purpose: naming them in the
# environment file would create a second place a read-only mount could be described as writable.
# The audit checks these three strings against the `:ro` mount targets the topology declares.
readonly STORE_DIR_LIFE='/stores/life'
readonly STORE_DIR_FINANCE='/stores/finance'
readonly STORE_DIR_SIGNAL='/stores/signal'

# The kill sentinel volume, mounted read-only into every writer (§8): no service clears its own halt.
readonly KILL_MOUNT='/run/nizam-kill'

# The uploader and the pruner are entry points the backup image provides. They implement the egress
# boundary declared in src/server/ports/drive.ts, which has a put, a verify, and an enumerate member
# and deliberately NO get. They own the storage endpoint and the narrow per-file grant from gate G5;
# this script owns the snapshot, the encryption, the shred, and the verdict it will accept.
readonly UPLOADER='nizam-backup'

# Every entry this script reads. Each one is declared in ops/env/backup.env with a what, a gate, and
# a secrecy annotation, and each is resolved from the host environment - never assigned here, so no
# default can arrive that nobody reviewed.
readonly REQUIRED_ENTRIES='BACKUP_WORK_DIR AGE_PUBLIC_KEY BACKUP_ENCRYPTION_SCHEME BACKUP_RETAIN_COUNT KILL_SENTINEL_PATH NIZAM_KILL_ALL'

# Named inputs and outputs, in place of parameters. Declared here so a reader can see the whole
# communication surface between the steps in one place.
MESSAGE=''
WORK_RUN_DIR=''
STORE_DIR=''
STORE_LABEL=''
STORE_FILE=''
SNAPSHOT_PATH=''
CIPHERTEXT_PATH=''
ARTIFACT_SIZE=''
ARTIFACT_DIGEST=''
UPLOAD_VERDICT=''

# ---------------------------------------------------------------------------------------------
# Failure
# ---------------------------------------------------------------------------------------------
# reads: MESSAGE. Aborts. The exit trap below still runs, which is what makes the shred cover the
# failure path (§7.1.3) rather than only the happy one.
fail() {
  printf 'backup aborted: %s\n' "${MESSAGE}" >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------
# The halt, both forms, before anything else happens (§8)
# ---------------------------------------------------------------------------------------------
# Fail closed on ambiguity: an entry that is unset, a sentinel that is present, and a sentinel mount
# that cannot be examined all read as "halted". Nothing here is cached - the check runs per run, and
# the run is the unit of work this service performs.
assert_not_halted() {
  if [ -z "${NIZAM_KILL_ALL+set}" ]; then
    MESSAGE='NIZAM_KILL_ALL is unset, and an unreadable halt reads as halted'
    fail
  fi
  if [ "${NIZAM_KILL_ALL}" = '1' ]; then
    MESSAGE='the coarse halt NIZAM_KILL_ALL is engaged; nothing is deleted and nothing is uploaded'
    fail
  fi
  if [ -z "${KILL_SENTINEL_PATH+set}" ]; then
    MESSAGE='KILL_SENTINEL_PATH is unset, so the per-call halt cannot be examined, which reads as halted'
    fail
  fi
  if [ ! -d "${KILL_MOUNT}" ]; then
    MESSAGE="the kill sentinel mount ${KILL_MOUNT} is absent, so the halt cannot be examined, which reads as halted"
    fail
  fi
  if [ -e "${KILL_SENTINEL_PATH}" ]; then
    MESSAGE='the kill sentinel is present; the system is halted by the operator'
    fail
  fi
}

# reads: REQUIRED_ENTRIES. Every entry present and non-empty, or the run does not start. An
# unconfigured guard must not be an open door (§5.2's rule, applied to this service).
assert_environment_present() {
  for ENTRY_NAME in ${REQUIRED_ENTRIES}; do
    if [ -z "${!ENTRY_NAME+set}" ] || [ -z "${!ENTRY_NAME}" ]; then
      MESSAGE="${ENTRY_NAME} is unset or empty; ops/env/backup.env declares it and this run needs it"
      fail
    fi
  done
  case "${BACKUP_ENCRYPTION_SCHEME}" in
    age | gpg) ;;
    *)
      MESSAGE="BACKUP_ENCRYPTION_SCHEME is ${BACKUP_ENCRYPTION_SCHEME}; §7.1.2 names one tool of record and one documented fallback, and nothing else encrypts a payload here"
      fail
      ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# The scratch directory, and the shred that covers every exit from it (§7.1.3)
# ---------------------------------------------------------------------------------------------
# reads: BACKUP_WORK_DIR. sets: WORK_RUN_DIR.
prepare_work_dir() {
  WORK_RUN_DIR="${BACKUP_WORK_DIR}/run"
  if [ -e "${WORK_RUN_DIR}" ]; then
    MESSAGE="${WORK_RUN_DIR} already exists; a previous run either did not finish or did not shred, and both need a human"
    fail
  fi
  mkdir -p -m 0700 "${WORK_RUN_DIR}"
}

# reads: WORK_RUN_DIR. Registered on EXIT, so it runs on success, on a failure, and on an interrupt.
# A plaintext snapshot that outlives its encryption is the largest unencrypted concentration of
# financial data this system ever creates, so a shred that could not complete is ESCALATED - it is
# never absorbed into a successful exit.
shred_plaintext_on_exit() {
  if [ -z "${WORK_RUN_DIR}" ] || [ ! -d "${WORK_RUN_DIR}" ]; then
    return
  fi
  if ! find "${WORK_RUN_DIR}" -type f -name '*.db' -exec shred --remove --zero --iterations=1 -- {} +; then
    printf '%s\n' 'ESCALATE: plaintext may survive under the scratch directory; a human must clear it before the next run' >&2
    exit 1
  fi
  rmdir "${WORK_RUN_DIR}"
}
trap shred_plaintext_on_exit EXIT

# ---------------------------------------------------------------------------------------------
# Step one: the snapshot (§7.1.1)
# ---------------------------------------------------------------------------------------------
# reads: STORE_DIR, WORK_RUN_DIR. sets: STORE_LABEL, STORE_FILE, SNAPSHOT_PATH.
snapshot_one_store() {
  STORE_LABEL="$(basename "${STORE_DIR}")"
  if [ ! -d "${STORE_DIR}" ]; then
    MESSAGE="${STORE_DIR} is not mounted; a backup that silently skips a store is not a backup"
    fail
  fi
  STORE_FILE=''
  for CANDIDATE in "${STORE_DIR}"/*.db; do
    if [ -f "${CANDIDATE}" ]; then
      if [ -n "${STORE_FILE}" ]; then
        MESSAGE="more than one store file under ${STORE_DIR}; exactly one store lives on each mount"
        fail
      fi
      STORE_FILE="${CANDIDATE}"
    fi
  done
  if [ -z "${STORE_FILE}" ]; then
    MESSAGE="no store file under ${STORE_DIR}; the mount is present but empty, which a human must explain"
    fail
  fi

  SNAPSHOT_PATH="${WORK_RUN_DIR}/${STORE_LABEL}.db"

  # THE SNAPSHOT STATEMENT. A read transaction over the live store, one committed instant, a complete
  # database written to a new file. The source is opened read-only, so this step cannot alter a store
  # even by accident. A refused open aborts the run - see the OPEN CONSTRAINT in the header - and
  # under no circumstance is it retried as a copy.
  if ! sqlite3 "file:${STORE_FILE}?mode=ro" "VACUUM INTO '${SNAPSHOT_PATH}'"; then
    MESSAGE="the engine refused to write a consistent snapshot of ${STORE_FILE}; this run produces no artifact rather than an artifact nobody can trust"
    fail
  fi

  # A snapshot that cannot pass its own integrity check is not worth encrypting, uploading, or
  # counting against retention. Catching it here means the restore drill is not the first place a
  # corrupt store is noticed.
  if [ "$(sqlite3 "${SNAPSHOT_PATH}" 'PRAGMA integrity_check')" != 'ok' ]; then
    MESSAGE="the snapshot of ${STORE_FILE} failed the engine's integrity check and is discarded"
    fail
  fi
}

# ---------------------------------------------------------------------------------------------
# Step two: encryption to a recipient this host cannot decrypt for (§7.1.2)
# ---------------------------------------------------------------------------------------------
# reads: SNAPSHOT_PATH, AGE_PUBLIC_KEY, BACKUP_ENCRYPTION_SCHEME. sets: CIPHERTEXT_PATH.
# Note what is NOT here: no identity, no secret key, no passphrase, and no flag that could carry
# one. The recipient is a PUBLIC key, read from the environment entry gate G8 writes.
encrypt_one_snapshot() {
  CIPHERTEXT_PATH="${SNAPSHOT_PATH}.age"
  case "${BACKUP_ENCRYPTION_SCHEME}" in
    age)
      if ! age --encrypt --recipient "${AGE_PUBLIC_KEY}" --output "${CIPHERTEXT_PATH}" "${SNAPSHOT_PATH}"; then
        MESSAGE="encryption of ${SNAPSHOT_PATH} failed; the plaintext is shredded on the way out"
        fail
      fi
      ;;
    gpg)
      if ! gpg --batch --yes --encrypt --trust-model always --recipient "${AGE_PUBLIC_KEY}" \
        --output "${CIPHERTEXT_PATH}" "${SNAPSHOT_PATH}"; then
        MESSAGE="encryption of ${SNAPSHOT_PATH} failed with the documented fallback; the plaintext is shredded on the way out"
        fail
      fi
      ;;
  esac
  if [ ! -s "${CIPHERTEXT_PATH}" ]; then
    MESSAGE="encryption produced no ciphertext for ${SNAPSHOT_PATH}"
    fail
  fi
}

# ---------------------------------------------------------------------------------------------
# Step three: shred the plaintext, in the same operation (§7.1.3)
# ---------------------------------------------------------------------------------------------
# reads: SNAPSHOT_PATH. The failure of this step is NOT swallowed: there is no `|| true`, the error
# stream is not discarded, and a plaintext that survives the shred aborts the run. The exit trap
# above covers the paths that never reach this function.
shred_plaintext_now() {
  if ! shred --remove --zero --iterations=1 "${SNAPSHOT_PATH}"; then
    MESSAGE="the plaintext snapshot ${SNAPSHOT_PATH} could not be shredded; this is escalated, not retried"
    fail
  fi
  if [ -e "${SNAPSHOT_PATH}" ]; then
    MESSAGE="the plaintext snapshot ${SNAPSHOT_PATH} survived its shred"
    fail
  fi
}

# ---------------------------------------------------------------------------------------------
# Step four: verified upload through the narrow per-file grant (§7.1, gate G5)
# ---------------------------------------------------------------------------------------------
# reads: CIPHERTEXT_PATH, STORE_LABEL. sets: ARTIFACT_SIZE, ARTIFACT_DIGEST, UPLOAD_VERDICT.
# An upload that is not verified is not a backup, so the size and the digest are measured locally
# first and the uploader is required to answer that the remote copy matches BOTH. Anything other
# than a verified verdict is a failed backup, never a warning.
#
# The payload is one encrypted store snapshot and nothing else. No key, no token, and no environment
# file is ever part of it (§7.1's closing rule); on the rebuild path secrets are re-provisioned, not
# restored (§7.5). That is why this function names no credential entry at all - the uploader resolves
# the grant from its own environment, and this script never handles it.
upload_and_verify() {
  ARTIFACT_SIZE="$(stat --format='%s' "${CIPHERTEXT_PATH}")"
  ARTIFACT_DIGEST="$(sha256sum "${CIPHERTEXT_PATH}" | cut -d' ' -f1)"
  UPLOAD_VERDICT="$("${UPLOADER}" upload \
    --artifact "${CIPHERTEXT_PATH}" \
    --store "${STORE_LABEL}" \
    --expect-size "${ARTIFACT_SIZE}" \
    --expect-digest "${ARTIFACT_DIGEST}")"
  if [ "${UPLOAD_VERDICT}" != 'verified' ]; then
    MESSAGE="the uploader answered ${UPLOAD_VERDICT} for ${STORE_LABEL}; size and digest must both match the local artifact before a run counts as a backup"
    fail
  fi
}

# ---------------------------------------------------------------------------------------------
# Step five: bounded retention (§7.1)
# ---------------------------------------------------------------------------------------------
# reads: BACKUP_RETAIN_COUNT. Retention is bounded, and the bound is configuration rather than a
# constant here (§7.5: the cadence is a configuration value, not a hope). Pruning is metadata work
# in the uploader; it returns no bytes, so nothing is decrypted to decide what to drop.
prune_retention() {
  if ! "${UPLOADER}" prune --retain "${BACKUP_RETAIN_COUNT}"; then
    MESSAGE='retention pruning failed; an unbounded archive set is a finding, not a tidiness problem'
    fail
  fi
}

# ---------------------------------------------------------------------------------------------
# The sequence, in the order §7.1 requires
# ---------------------------------------------------------------------------------------------
# Halt first, then one pass per store: snapshot, encrypt, shred, verified upload. Retention last,
# because a prune that ran before a failed upload could drop the archive that was still the newest
# good one. The audit reads this list and fails the file if the order changes.
main() {
  assert_not_halted
  assert_environment_present
  prepare_work_dir
  for STORE_DIR in "${STORE_DIR_LIFE}" "${STORE_DIR_FINANCE}" "${STORE_DIR_SIGNAL}"; do
    snapshot_one_store
    encrypt_one_snapshot
    shred_plaintext_now
    upload_and_verify
  done
  prune_retention
}

main
