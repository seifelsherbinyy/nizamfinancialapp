# Rollback runbook - reverting a deployment, with and without a migration

> **Owning contract:** PFOS Contract 12 - Two-Agent VPS Deployment & Operations, **§7.4** (rollback), with
> **§7.2** (the restore drill this document routes through) and **§8** (the halt).
> **Spec:** `.kiro/specs/06-two-agent-vps/` - task **7.6**. Requirements **R20**, **R21**, **R22**,
> **R23**, **R24**.
> **Steering:** `two-agent-vps.md` §2 (writing this file is permitted, RUNNING IT IS NOT), §7
> (placeholders only), §0b (no deployment particular in a tracked file).
> **Phase:** 7 (ops artifacts, text only).
> **Audited by:** `src/server/ops/runbookTemplate.ts`, which reads this text on every test run and
> fires a named finding per governed property. Every finding has a negative test that mutates this
> file and observes the check fire.
>
> **THIS IS A TEMPLATE AND A RUNBOOK. NOTHING HERE IS EXECUTED BY AN AGENT.** Not to test it, not to
> check whether it would work, not with a placeholder substituted. Every command is written for a
> human operator and every value in it is an `<ANGLE_BRACKET>` placeholder that resolves only in the
> operator's own session or in the host's secret store.
>
> **Companion documents:** `DISASTER_RECOVERY.md` (the rebuild path, which reuses §7.2 the same way
> this document does) and `RATE_LIMIT_POSTURE.md` (the outbound posture and the degraded mode).

## What this document is

A rollback is a **re-deployment of a previously known-good, immutably tagged image**. It is not a
patch, not a revert commit, and not a repair of the running container. §7.4's first line fixes that
shape, and the reason is that a rollback happens at the worst moment the deployment ever has: the
operator needs one action with a known outcome, not a diagnosis.

There are exactly two paths below, and which one applies is decided by a single question: **did the
deployment being reverted apply a schema migration?**

- **No migration** - re-deploy the previous tag. Steps 1 to 5. Minutes.
- **A migration** - the store must be restored from a snapshot taken before it, through the restore
  drill, integrity check included. Steps 6 to 12. Longer, and deliberately so.

The second path is longer because **a migration is never reversed** (§7.4, contract 06 §5). That is
not a gap in the tooling. It is the model: migrations are append-only and forward-only, so there is
no reverse statement to run, and writing one would create a second definition of every schema it
touched.

- **Latest applied migration version:** 008
- The audit compares that number against the migration series in `src/server/db/migrations.ts` and
  fires if they disagree, so adding a migration without revisiting this document is a gate failure
  rather than a surprise on the day it matters.

## When to roll back, and when not to

Roll back when the deployed build is wrong and the previous one was right. Do **not** roll back:

- to clear a halt - the halt is cleared by the operator removing the sentinel, and nothing else
  (§8, and no code path removes it);
- to work around an unhealthy service that is unhealthy for an environment reason - a readiness
  failure naming an absent entry is fixed by the entry, and a rollback hides it;
- to "get past" a failed integrity check - a store that fails one is discarded and escalated
  (§7.2, **R21**), never restored into service under an older image.

A restart is not a fix either, and repeated restarts are surfaced rather than absorbed (§7.3).

## Rollback without a migration

### Step 1 - Halt the writers before changing anything

The halt stops model spend and outbound writes; it does not stop the deterministic obligation
alerts, and it never deletes anything (§8).

```
# on the host, as the operator
touch "${KILL_SENTINEL_PATH}"
```

**VERIFY:** the sentinel path is present, and one full poll interval later the orchestrator reports
every service still running - halting is not a shutdown, so nothing should have exited.

### Step 2 - Establish the previously known-good tag

Image references are placeholders resolved from the host environment; the topology declares one per
service (`<LIFE_IMAGE_REF>`, `<FINANCE_IMAGE_REF>`, `<PROXY_IMAGE_REF>`, `<BUS_IMAGE_REF>`,
`<SCHEDULER_IMAGE_REF>`, `<BACKUP_IMAGE_REF>`). Tags are immutable, so the previous tag still names
the same bytes it named when it was serving.

```
# list the tags the registry holds for the service being reverted
# record the tag being LEFT and the tag being RETURNED TO, in that order
```

**VERIFY:** both tags resolve to a digest, the two digests differ, and the returned-to tag is one
this deployment previously ran - never a tag that has only ever been built.

### Step 3 - Re-deploy the previous tag for the affected service only

One service, not the stack. §3.2.6 makes restart policy, health check, and resource limits per
service precisely so that one agent can be reverted while the other keeps serving.

```
# point the service's image reference at the returned-to tag in the host environment,
# then recreate that ONE service from ops/docker-compose.yml
```

**VERIFY:** the reverted service is running the returned-to digest, the other agent's container has
the same identifier it had before Step 1, and the signal bus was not recreated.

### Step 4 - Confirm readiness, not liveness

§7.3 requires the health endpoint to report **actual** readiness - the store opens, the required
pragmas are in force, the migration version is the expected one, and the queue worker is alive - and
forbids reporting success merely because the process is running.

```
# the orchestrator's own exec probe, as ops/docker-compose.yml declares it per service
nizam-health-probe --store "${FINANCE_STORE_FILE}"
```

**VERIFY:** the probe reports ready, and the schema version it reports is the one the returned-to
image expects. A ready answer with an unexpected version means this was the migration path all
along - stop here and go to Step 6.

### Step 5 - Clear the halt, last

```
rm "${KILL_SENTINEL_PATH}"
```

**VERIFY:** one deterministic alert path and one model-bearing path each behave normally, and the
spend ledger for the reverted agent shows no entry written while the halt was in force.

## Rollback across a migration

Steps 1 and 2 above still apply first. Then:

### Step 6 - Establish which schema version the returned-to image expects

```
# read the migration series the returned-to image was built from; the expected version is the
# highest version in that series, never a number typed by hand
```

**VERIFY:** the expected version is strictly lower than the version now recorded in the live store.
If they are equal, the deployment applied no migration and the short path above was correct.

### Step 7 - Refuse the reversal

**A schema migration is not rolled back by reversing it** (§7.4). Do not write a down migration, do
not hand-edit the bookkeeping table, and do not drop a column to make an older image start. An
applied migration is never edited (contract 06 §5); the store goes back, the schema does not.

**VERIFY:** the migration series in the repository is unchanged by this operation - no file under
`src/server/db/` is edited during a rollback, and the recorded version in the live store is
untouched until Step 11 replaces the store outright.

### Step 8 - Locate the snapshot taken before the migration

Deployment order for a change that includes a migration is **snapshot, migrate, deploy** (§7.4), so
that snapshot exists by construction. If it does not, the deployment did not follow the order and
this is a data-loss event, not a rollback - escalate rather than improvise.

**VERIFY:** the artifact's recorded creation instant is strictly before the migration's recorded
application instant, and its size and digest match what was recorded at upload
(`${EXPECTED_ARTIFACT_SIZE}`, `${EXPECTED_ARTIFACT_DIGEST}`). An artifact that cannot be matched is
not the artifact.

### Step 9 - Run the restore drill, off the host, against a fresh target

The drill is `ops/restore/`, and it runs **off the host** with the private half of the backup
keypair that only exists off the host (§7.2.2, gate **G8**). Its steps and their order belong to the
drill, not to this document. Quoted here so an operator can follow along, and compared by the audit
against the template itself so the two cannot drift:

**Drill sequence:** `assert_environment_present` -> `assert_target_is_fresh` ->
`verify_artifact_integrity` -> `decrypt_artifact` -> `check_store_integrity` ->
`check_referential_integrity` -> `boot_throwaway_instance`

Every gate precedes the step that would otherwise trust its result. That ordering is the requirement,
not a detail of it.

```
# on the operator machine: export the drill's declared entries, then invoke the drill under
# ops/restore/ with NO argument - it refuses arguments outright, so there is no parameter
# through which an identity file or a passphrase could arrive
```

**VERIFY:** the drill exits reporting that the integrity check passed, relationships are intact, and
a throwaway instance opened the store - its own closing line. `${RESTORE_TARGET_DIR}` must have been
fresh: the drill refuses an existing target rather than writing into one.

### Step 10 - Trust nothing until the integrity check has passed

**The integrity check precedes trust** (§7.2.3, **R21**). An artifact that fails it is **discarded
and escalated** - not repaired, not partially imported, and not used because it is better than
nothing. There is no salvage path in the drill and none is to be added.

**VERIFY:** the drill's integrity verdict was the reason the copy was accepted. If the drill
escalated, the correct outcome of this rollback is an escalation, and the previous image stays
undeployed.

### Step 11 - Promote deliberately, as a separate step

Restoring **never** overwrites a live store in place (§7.2). The drill wrote to a fresh path and has
no promotion step at all; promotion is an operator action taken with the writers halted.

```
# with the halt still in force from Step 1, and one writer per store (§3.2.4):
# move the live store aside, put the verified copy in its place, leave the aside copy in place
```

**VERIFY:** the store the service will open is the verified copy, the displaced store is still
present under a distinct name, and no service was running while the swap happened.

### Step 12 - Re-deploy the returned-to tag against the promoted store

**VERIFY:** the probe of Step 4 reports ready and reports the version of Step 6; then clear the halt
as in Step 5. Record the rollback as described below before considering it finished.

## The write-ahead-log sidecar determination

**OPEN CONSTRAINT, carried forward from task 7.4 rather than papered over.** Every rollback across a
migration depends on a pre-migration snapshot existing, so the constraint on producing one belongs
here, where an operator meets it.

The engine documents that a reader of a write-ahead-logged database must be able to write that
database's shared-memory index sidecar. The backup service's store mounts are **read-only**, without
exception (§3.2.2), and a read-only mount does not permit that write. The two rules meet at the
snapshot step, and the snapshot step in `ops/backup/` therefore **aborts loudly on a refused open**
instead of degrading.

This is an **operator determination**, to be made once, before the first real backup, and recorded in
`ops/GATE_REGISTER.md`. It has exactly two acceptable outcomes, and they are **ranked**:

1. **Outcome B is the documented default: issue the snapshot statement from inside the owning
   service**, which already holds the sidecar as the single writer (§3.2.4), and hand the resulting
   file to the backup service's scratch directory. The backup service then never opens a store at
   all. **Why this is the default:** it needs no write grant, so it resolves the constraint without
   widening a mount. §3.2.2's read-only guarantee survives intact rather than surviving with an
   exception carved into it, and the smaller change is the one to prefer when both are correct.
2. **Outcome A is the fallback: grant the backup service write access to the sidecar and to nothing
   else.** The store file itself stays read-only; only the sidecar is writable. This keeps the
   snapshot in the backup service and keeps §3.2.2's guarantee for the data. It remains acceptable
   and remains bounded - but it does widen a mount, which is precisely what the default avoids, so
   take it only when outcome B is not available.

Both are recorded because the default can turn out to be unavailable in a particular deployment; the
ranking states which to reach for first, not which is permitted.

**What is not acceptable, under any circumstance, is falling back to a file copy.** A copy of a
write-ahead-logged store that is being written is not a database: it is a fragment that may restore,
may fail to restore, or - the case that matters - may restore **wrongly** and look fine. Copying the
sidecars alongside it does not help, because the copy is not atomic across the set. §7.1.1 forbids
it, `ops/backup/` contains no copy tool, and the audit fails that template if one appears.

Until this determination is made and recorded, treat every rollback across a migration as **blocked
on a human**, not as available.

## Deployment order for a change that includes a migration

**Snapshot, migrate, deploy.** In that order, every time (§7.4).

Never deploy code that assumes a migration that has not yet been applied. The order is what makes
Step 8 possible: it guarantees that a snapshot from before the migration exists, which is the only
thing that makes a rollback across a migration a procedure rather than a loss.

## Recording the rollback

A rollback is recorded with **what was reverted and why** (§7.4). Record, in the operator's own
notes and never in this repository:

- the tag left and the tag returned to, as digests;
- whether the migration path was taken, and if so which artifact was restored, matched by size and
  digest rather than by name;
- the integrity verdict that justified trusting the copy;
- the halt window - when it was set and when it was cleared;
- what prompted the rollback, in one sentence.

Record **observations, never values** (**R24**): "artifact matched its recorded size and digest",
not the digest.

## What this document never does

- It does not reverse a migration, and it does not permit one to be written.
- It does not repair a store that failed an integrity check, or import part of one.
- It does not overwrite a live store in place; promotion is always a separate, halted step.
- It does not mint, read, or place a secret. Secrets are re-issued by their gate, never restored.
- It does not name a host, an address, a bot, a storage reference, or a real figure (**R24**).
- It is not executed by an automated agent, at any point, for any reason (steering §2).
