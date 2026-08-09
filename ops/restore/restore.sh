#!/usr/bin/env bash
# NIZAM - the restore drill, run OFF the host. TEMPLATE ONLY. NOTHING HERE IS EXECUTED BY AN AGENT.
#
# Owning contract: PFOS 12 - Two-Agent VPS Deployment & Operations, contract 12, phase 7:
#   §7.2.1  retrieve the encrypted artifact
#   §7.2.2  decrypt it OFF THE HOST, with the private half that exists only off the host (gate G8)
#   §7.2.3  run the engine's integrity check on the decrypted store - THIS GATE PRECEDES TRUST (R21)
#   §7.2.4  boot a throwaway instance and confirm the required pragmas are in force
#   §7.2    a failing artifact is DISCARDED and ESCALATED, never repaired and used; a restore NEVER
#           overwrites a live store in place, and promotion is a separate, deliberate step
#   §7.5    the rebuild path: secrets are re-provisioned, never restored
#   §7.6    this path
# Spec: .kiro/specs/06-two-agent-vps/ - task 7.4. Requirements R21, R23, R24.
# Steering: two-agent-vps.md §2 (writing this file is permitted, RUNNING IT IS NOT), §7 (placeholders
#   only), §0b (no deployment particular in a tracked file).
# Audited by: src/server/ops/backupScripts.ts, which reads this text on every test run.
#
# ---------------------------------------------------------------------------------------------
# WHERE THIS RUNS, AND WHY THAT IS THE WHOLE DESIGN
# ---------------------------------------------------------------------------------------------
#
# On the OPERATOR MACHINE. Never on the deployment host. The backup path under ops/backup/ encrypts
# to a public recipient and holds no private half, so the host can create an archive it cannot read.
# Putting a decrypt step on that host would hand it back the ability the design removed. The identity
# is referenced here by the environment entry gate G8 records, as a PATH to a file that lives in the
# operator's secure store - never as key material in this text, and never through a passphrase
# parameter. This script takes no parameter at all, for the same reason the backup path does not.
#
# ---------------------------------------------------------------------------------------------
# VERIFY BEFORE TRUST, AND VERIFY BEFORE WRITE
# ---------------------------------------------------------------------------------------------
#
# A restore that writes a corrupt store over a good one is worse than no restore at all: it converts
# a recoverable outage into permanent loss, and it does so at the moment nobody has spare attention.
# So the order below is the point of the file, not an implementation detail. In order, and each step
# aborts before the next begins:
#
#   1. THE TARGET IS FRESH. A target that already exists is refused. There is no in-place path here
#      and no promotion step at all - promotion is a separate, deliberate operator action (§7.2), so
#      nothing this script can do reaches a live store.
#   2. THE CIPHERTEXT MATCHES ITS RECEIPT. Size and digest are compared against the values the
#      verified upload recorded, BEFORE the identity is spent on it. A truncated or substituted
#      artifact is refused here, where the failure costs nothing.
#   3. DECRYPT, into the fresh target only.
#   4. THE ENGINE'S INTEGRITY CHECK. This is the gate R21 names. Nothing downstream of it runs until
#      it answers ok.
#   5. REFERENTIAL INTEGRITY. A store can be structurally sound and still carry orphaned rows;
#      contract 06 §2.2 enforces foreign keys on every connection, so a restored store that violates
#      one was already broken when it was snapshotted.
#   6. A THROWAWAY INSTANCE OPENS IT. The connection factory applies the required pragmas and reads
#      each one back, so a store that cannot prove its engine contract fails here rather than in
#      production. Only after this does the artifact count as good.
#
# On ANY failure the decrypted copy is shredded, the target is removed, and the failure is escalated
# with a non-zero exit. Nothing is repaired. There is no recovery, salvage, or partial-import path in
# this file, because "better than nothing" is how a subtly wrong ledger becomes the ledger.

set -euo pipefail

# A parameter is the only way a passphrase could arrive. There is no parameter.
if [ "$#" -ne 0 ]; then
  printf '%s\n' 'restore refused: this script takes no parameter, so there is no way to hand it a passphrase' >&2
  exit 64
fi

# ---------------------------------------------------------------------------------------------
# What the operator sets before running this
# ---------------------------------------------------------------------------------------------
# These entries are the drill's own. They are NOT a service environment file: no service runs this,
# so ops/env/ declares nothing for it (§3.2.7 gives each SERVICE one file, and this is not one).
#
#   RESTORE_ARTIFACT         the retrieved ciphertext, on the operator machine
#   RESTORE_TARGET_DIR       a directory that must NOT already exist; the restored copy goes here
#   EXPECTED_ARTIFACT_SIZE   the size the verified upload recorded for this artifact
#   EXPECTED_ARTIFACT_DIGEST the digest the verified upload recorded for this artifact
#   AGE_IDENTITY_FILE        a PATH to the off-host private half (gate G8). Never key material here
#   BACKUP_ENCRYPTION_SCHEME the same vocabulary the backup path uses: the tool of record, or the
#                            documented fallback
readonly REQUIRED_ENTRIES='RESTORE_ARTIFACT RESTORE_TARGET_DIR EXPECTED_ARTIFACT_SIZE EXPECTED_ARTIFACT_DIGEST AGE_IDENTITY_FILE BACKUP_ENCRYPTION_SCHEME'

# The health probe the finance image provides (spec task 7.5). It reports ACTUAL readiness: the store
# opens, the required pragmas are in force, and the migration version is the expected one.
readonly PROBE='nizam-health-probe'

# Named inputs and outputs, in place of parameters.
MESSAGE=''
RESTORED_STORE=''
ACTUAL_SIZE=''
ACTUAL_DIGEST=''
INTEGRITY_VERDICT=''
ORPHAN_ROWS=''

# ---------------------------------------------------------------------------------------------
# Failure, in two flavours, because they mean different things
# ---------------------------------------------------------------------------------------------
# reads: MESSAGE. Refuses before anything was written. Nothing to clean up.
refuse() {
  printf 'restore refused: %s\n' "${MESSAGE}" >&2
  exit 1
}

# reads: MESSAGE, RESTORED_STORE, RESTORE_TARGET_DIR. The artifact was decrypted and then failed a
# gate. The plaintext is removed, the target is removed, and a human is told. The artifact is NOT
# repaired and NOT used: §7.2 discards it and escalates.
discard_and_escalate() {
  if [ -n "${RESTORED_STORE}" ] && [ -e "${RESTORED_STORE}" ]; then
    if ! shred --remove --zero --iterations=1 "${RESTORED_STORE}"; then
      printf '%s\n' 'ESCALATE: the decrypted store could not be shredded; a human must clear the target directory' >&2
      exit 1
    fi
  fi
  rm -rf -- "${RESTORE_TARGET_DIR}"
  printf 'ESCALATE: %s\n' "${MESSAGE}" >&2
  printf '%s\n' 'this artifact is discarded. Do not repair it, do not partially import it, and do not promote it. Try the next archive and record the failure as a failing control.' >&2
  exit 1
}

# reads: REQUIRED_ENTRIES.
assert_environment_present() {
  for ENTRY_NAME in ${REQUIRED_ENTRIES}; do
    if [ -z "${!ENTRY_NAME+set}" ] || [ -z "${!ENTRY_NAME}" ]; then
      MESSAGE="${ENTRY_NAME} is unset or empty; the drill needs every one of ${REQUIRED_ENTRIES}"
      refuse
    fi
  done
  if [ ! -r "${RESTORE_ARTIFACT}" ]; then
    MESSAGE="${RESTORE_ARTIFACT} cannot be read"
    refuse
  fi
  if [ ! -r "${AGE_IDENTITY_FILE}" ]; then
    MESSAGE="the off-host identity at ${AGE_IDENTITY_FILE} cannot be read; gate G8 stores it in the operator's secure store, and without it every archive is permanently unreadable by design"
    refuse
  fi
  case "${BACKUP_ENCRYPTION_SCHEME}" in
    age | gpg) ;;
    *)
      MESSAGE="BACKUP_ENCRYPTION_SCHEME is ${BACKUP_ENCRYPTION_SCHEME}; the drill decrypts only what the backup path encrypts"
      refuse
      ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# 1. The target is fresh: a restore never overwrites a live store in place (§7.2)
# ---------------------------------------------------------------------------------------------
# reads: RESTORE_TARGET_DIR. sets: RESTORED_STORE.
assert_target_is_fresh() {
  if [ -e "${RESTORE_TARGET_DIR}" ]; then
    MESSAGE="${RESTORE_TARGET_DIR} already exists; a restore targets a fresh path, and promotion is a separate deliberate step, so this script will not write anywhere something already lives"
    refuse
  fi
  mkdir -p -m 0700 "${RESTORE_TARGET_DIR}"
  RESTORED_STORE="${RESTORE_TARGET_DIR}/restored.db"
}

# ---------------------------------------------------------------------------------------------
# 2. The ciphertext matches what the verified upload recorded, before the identity is spent
# ---------------------------------------------------------------------------------------------
# reads: RESTORE_ARTIFACT, EXPECTED_ARTIFACT_SIZE, EXPECTED_ARTIFACT_DIGEST.
# sets: ACTUAL_SIZE, ACTUAL_DIGEST.
verify_artifact_integrity() {
  ACTUAL_SIZE="$(stat --format='%s' "${RESTORE_ARTIFACT}")"
  if [ "${ACTUAL_SIZE}" != "${EXPECTED_ARTIFACT_SIZE}" ]; then
    MESSAGE="the artifact is ${ACTUAL_SIZE} bytes and the receipt records ${EXPECTED_ARTIFACT_SIZE}; a size that disagrees is a truncated or substituted archive"
    refuse
  fi
  ACTUAL_DIGEST="$(sha256sum "${RESTORE_ARTIFACT}" | cut -d' ' -f1)"
  if [ "${ACTUAL_DIGEST}" != "${EXPECTED_ARTIFACT_DIGEST}" ]; then
    MESSAGE='the artifact digest disagrees with the receipt; both properties are checked, and either mismatch stops the drill here'
    refuse
  fi
}

# ---------------------------------------------------------------------------------------------
# 3. Decrypt, off the host, into the fresh target only (§7.2.2)
# ---------------------------------------------------------------------------------------------
# reads: RESTORE_ARTIFACT, RESTORED_STORE, AGE_IDENTITY_FILE, BACKUP_ENCRYPTION_SCHEME.
# The identity is referenced as a path, from the environment. There is no passphrase parameter and no
# inline key material, here or anywhere in this repository.
decrypt_artifact() {
  case "${BACKUP_ENCRYPTION_SCHEME}" in
    age)
      if ! age --decrypt --identity "${AGE_IDENTITY_FILE}" --output "${RESTORED_STORE}" "${RESTORE_ARTIFACT}"; then
        MESSAGE='decryption failed; the identity does not match the recipient this archive was encrypted to, or the archive is damaged'
        discard_and_escalate
      fi
      ;;
    gpg)
      if ! gpg --batch --yes --decrypt --output "${RESTORED_STORE}" "${RESTORE_ARTIFACT}"; then
        MESSAGE='decryption failed with the documented fallback'
        discard_and_escalate
      fi
      ;;
  esac
  if [ ! -s "${RESTORED_STORE}" ]; then
    MESSAGE='decryption produced no store'
    discard_and_escalate
  fi
}

# ---------------------------------------------------------------------------------------------
# 4. The engine's integrity check. THIS GATE PRECEDES TRUST (§7.2.3, R21)
# ---------------------------------------------------------------------------------------------
# reads: RESTORED_STORE. sets: INTEGRITY_VERDICT.
check_store_integrity() {
  INTEGRITY_VERDICT="$(sqlite3 "${RESTORED_STORE}" 'PRAGMA integrity_check')"
  if [ "${INTEGRITY_VERDICT}" != 'ok' ]; then
    MESSAGE="the restored store failed the engine's integrity check: ${INTEGRITY_VERDICT}"
    discard_and_escalate
  fi
}

# ---------------------------------------------------------------------------------------------
# 5. Referential integrity, which the structural check does not cover
# ---------------------------------------------------------------------------------------------
# reads: RESTORED_STORE. sets: ORPHAN_ROWS.
check_referential_integrity() {
  ORPHAN_ROWS="$(sqlite3 "${RESTORED_STORE}" 'PRAGMA foreign_key_check')"
  if [ -n "${ORPHAN_ROWS}" ]; then
    MESSAGE='the restored store carries rows that violate a declared relationship; contract 06 enforces them on every connection, so this store was already broken when it was snapshotted'
    discard_and_escalate
  fi
}

# ---------------------------------------------------------------------------------------------
# 6. A throwaway instance opens it and answers (§7.2.4)
# ---------------------------------------------------------------------------------------------
# reads: RESTORED_STORE. The probe opens the store through the one connection factory, which applies
# the required pragmas and READS EACH ONE BACK - a pragma that was set but did not take is
# indistinguishable from one that was never set unless it is read back (contract 06 §2.2).
boot_throwaway_instance() {
  if ! "${PROBE}" --store "${RESTORED_STORE}" --throwaway; then
    MESSAGE='a throwaway instance could not open the restored store with the required pragmas in force'
    discard_and_escalate
  fi
  printf '%s\n' 'restore drill passed: integrity check ok, relationships intact, a throwaway instance opened it.'
  printf '%s\n' 'the artifact is now considered good. Promotion is a SEPARATE, deliberate step and is not part of this drill.'
}

# ---------------------------------------------------------------------------------------------
# The sequence. The order is the requirement (R21), so the audit reads this list and fails the file
# if a step moves ahead of a gate that must precede it.
# ---------------------------------------------------------------------------------------------
main() {
  assert_environment_present
  assert_target_is_fresh
  verify_artifact_integrity
  decrypt_artifact
  check_store_integrity
  check_referential_integrity
  boot_throwaway_instance
}

main
