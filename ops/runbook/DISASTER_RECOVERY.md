# Disaster-recovery runbook - rebuilding the deployment from templates and one verified backup

> **Owning contract:** PFOS Contract 12 - Two-Agent VPS Deployment & Operations, **§7.5** (disaster recovery),
> with **§7.2** (the restore drill), **§2.3** (the degraded mode) and **§9** (the gate register).
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
> **Companion documents:** `ROLLBACK.md` (which owns the write-ahead-log sidecar determination this
> document depends on) and `RATE_LIMIT_POSTURE.md` (which owns the degraded mode's outbound posture).

## What this document is

The procedure for the case a rollback cannot address: **the host is gone**, or is compromised, or is
in a state nobody should try to reason about. It rebuilds the deployment from two things and nothing
else - the templates in this repository, and one encrypted artifact that has passed the restore
drill.

It is deliberately the same restore path as `ROLLBACK.md` Step 9. There is one restore procedure, it
is `ops/restore/`, and the worst day is not the day to meet a second one.

## Blast radius

**One host is one failure domain.** That is accepted rather than engineered away - a second host
would double the attack surface and the operating cost of a single-operator system - and it is
mitigated by four things, each of which exists for this paragraph (§7.5):

1. **Bounded per-service resources.** Every service declares a CPU and memory limit and a
   reservation, so one agent's failure cannot starve the other into failing with it (§2.2.8).
2. **The internal-only bus.** The consent channel has no route to the proxy and no route out, so a
   compromise of the public entry point does not reach it (§2.2.5, **R9**).
3. **Off-host backup keys.** The private half of the backup keypair never exists on the host (gate
   **G8**), so a host compromise yields ciphertext and nothing else.
4. **A rebuild path that does not depend on the failed host.** Everything below runs from the
   operator machine and a fresh host. Nothing is read off the casualty.

What the blast radius does **not** include: family-tier content, which is excluded from this
deployment entirely (**R10**, steering §4.4). There is nothing to recover there because there was
never anything to lose.

## Recovery objective

**What is unrecoverable is what was never backed up.** The objective is therefore stated in terms of
the **backup cadence**, and the cadence is a configuration value rather than a hope (§7.5).

- The cadence is `${BACKUP_SCHEDULE}`, declared in the backup service's environment template.
- The worst-case data loss is therefore one cadence interval plus the time to notice, and it is
  **not** a number this document may improve by asserting a smaller one.
- Retention is bounded by `${BACKUP_RETAIN_COUNT}`, with a cold copy at a lower frequency in a
  second location (§7.1). The cold copy is what makes a recovery survive a bad artifact.
- A drill that has not been run recently is treated as a **failing control**, not an unknown one
  (§7.2). If the last recorded drill is stale, the recovery objective is unknown, which is worse than
  a long one.

State the objective as an interval derived from the configured cadence. Do not state it as a target
that the cadence does not support.

## The rebuild path

The order is §7.5's, and each step is gated where the contract gates it. Steps 1, 3 and 5 are
**human gates** from `ops/GATE_REGISTER.md` and must not be attempted by an automated agent, nor
reported as done (**R23**).

### Step 1 - Provision a fresh host and harden it (gate G1)

The whole hardening checklist, to the end, finishing with the root-owned configuration directory
that will hold the environment files. G1 is the trust root; a rebuild that skips part of it produces
a host that is running but not trustworthy, which is the harder failure to notice.

**VERIFY:** every line of the G1 verification block in `ops/GATE_REGISTER.md` holds on the new host,
including the negative one - a password login attempt from another machine is refused rather than
prompted.

### Step 2 - Restore the encrypted artifacts through the restore drill

Off the host, with the off-host private half, for **each** store the environment templates declare -
`${LIFE_STORE_FILE}`, `${FINANCE_STORE_FILE}`, `${SIGNALS_STORE_FILE}`. One artifact per store; there
is no combined payload.

```
# on the operator machine, once per store: export the drill's declared entries, then invoke the
# drill under ops/restore/ with NO argument
```

**VERIFY:** the drill reports, for each store, that the integrity check passed, relationships are
intact, and a throwaway instance opened it. An artifact that fails is **discarded and escalated**,
and the next candidate is the cold copy - never a repair of the failed one (**R21**).

### Step 3 - Re-provision every secret into fresh environment files (gates G3, G4, G5, G8)

**Secrets are re-issued, never restored.** No key, no token, and no environment file was ever part of
a backup payload (§7.1), so there is nothing to restore even if it were permitted. Mint new bot
tokens (**G3**), new model keys with their periodic caps (**G4**), a new storage grant (**G5**), and -
if the old private half is not intact off-host - a new backup keypair (**G8**).

One environment file per service, root-owned and mode-restricted, outside the repository (§3.2.7).
No service reads another service's file.

**VERIFY:** each file exists with owner `root` and restrictive mode; the life file contains no
finance key and the finance file contains no life key; and every entry each service declares is
present. A missing entry surfaces as a readiness failure in Step 4 rather than as a silent default.

### Step 4 - Bring the services up from the templates

`ops/docker-compose.yml` unchanged from this repository, with `ops/Caddyfile` as the proxy
configuration. Nothing is edited during a recovery: if a template needs changing, that is a commit,
reviewed, not a live edit on a fresh host.

**VERIFY:** every service reports **ready** through its own probe - the store opens, the required
pragmas are in force, the migration version is the expected one, and the queue worker is alive
(§7.3, **R22**). The bus answers on the internal network and refuses a connection from anywhere
else, at the network layer (§2.2.6).

### Step 5 - Re-register both webhooks (gate G6)

New secret path segments and new secret tokens, generated on the new host, narrowed update types, a
low connection ceiling, and pending updates dropped on this first registration. The posture and the
reasons are `RATE_LIMIT_POSTURE.md`.

**VERIFY:** the five negative cases in the G6 verification block - missing secret token, wrong secret
token, sender absent from the allowlist, the same update identifier twice, and the two bots emitting
the same update identifier - behave as **R11** to **R14** require, against the live path this time.

### Step 6 - Confirm the recovery, then record it

**VERIFY:** one deterministic obligation alert reaches the owner; one model-bearing turn completes
within the new cap; the spend ledger shows the new keys and no carried-over total; and the first
backup on the new host completes, uploads, and **verifies** against its recorded size and digest.
Until that first verified backup exists, the recovery is not finished - a running deployment with no
backup is the state this document exists to get out of.

## Degraded operation while the endpoint is unavailable

If the hostname, the certificate, or the public endpoint is unavailable, the documented fallback is
the provider's **long-poll** mode, which needs no public endpoint (§2.3).

- It is a **mode**, selected by configuration - `${TELEGRAM_MODE}`, one of the transport modes the
  port declares - and not a second code path.
- **Every guard in §5 stays intact:** the constant-time secret comparison, the operator allowlist,
  the per-bot de-duplication, and accept-fast/process-async. Failing over must never disable one.
- It is a bridge, not a destination. Steps 1 to 5 continue while it carries traffic.

The outbound posture, the documented limits it respects, and the refusal handling are all
`RATE_LIMIT_POSTURE.md`.

## What is unrecoverable

- Anything written after the last successful backup. This is the recovery objective, restated as the
  thing it actually costs.
- Every archive, if the backup private half is lost. That is the deliberate trade of gate **G8**: the
  host cannot read its own backups, and neither can anyone who takes the host. Two copies of the
  identity, in two locations, is the mitigation, and it is an operator responsibility.
- Nothing else. Secrets are re-issued, templates are in the repository, and the schema is the
  migration series.

## The drill is the prerequisite, not the recovery

**Recovery must not be the moment a guard is first tested** (§7.5). The restore drill of §7.2 exists
so that every step above is familiar before it is needed:

- the drill is scheduled, and its outcome is recorded;
- a stale drill is a failing control - fix the control, do not wait for the recovery to reveal it;
- **a backup is not a backup until a restore has been exercised.** An untested backup is an
  assumption, and this document is not the place to discover which kind it was.

The write-ahead-log sidecar determination in `ROLLBACK.md` is part of that prerequisite: until it is
made and recorded, snapshots are blocked on a human, and a recovery objective stated over a cadence
that cannot run is fiction.

## What this document never does

- It does not restore a secret. Secrets are re-issued by their gate.
- It does not repair an artifact that failed its integrity check, or import part of one.
- It does not read anything off the failed host.
- It does not edit a template in place during a recovery.
- It does not attempt, complete, or report as done any human gate (**R23**).
- It does not name a host, an address, a bot, a storage reference, or a real figure (**R24**).
- It is not executed by an automated agent, at any point, for any reason (steering §2).
