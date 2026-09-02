# NIZAM Deployment Control Record

> **Active authority:** PFOS Contract 12 and the current Phase 0/Wave 2 evidence artifacts.
> **Replacement:** This file supersedes the deleted legacy gate-register path for current
> repository checks. It records human-only gates and their evidence requirements; it does not execute
> commands, install secrets, mutate hosts, register webhooks, or mark gates complete.
> **Current evidence:** `ops/PHASE0_RUNTIME_INVENTORY_2026-08-15.md`,
> `ops/PHASE0_GAP_MATRIX_2026-08-15.md`, and the THABAT/Wave receipts in `ops/`.
>
> Contract 12 remains the governing product and deployment contract. The v1.4 controller delta is
> evidence/planning input until separately accepted as a contract revision. No human gate is inferred
> complete from local build or test results.

# NIZAM Deployment Control Record - human-gated operations (G1-G8)

> **Owning contract:** PFOS 12 - Two-Agent VPS Deployment & Operations, §9 (the human deployment control record).
> **Authority detail:** Contract 12 §9 and the workspace authority instructions provide the active gate and evidence rules.
> **Phase:** 0 (authored before the area is built).

## SINGLE NEXT HUMAN ACTION

**Start at G1.** Provision the host and work its hardening checklist to the end, finishing with the
root-owned configuration directory `/etc/<CONFIG_DIR>`. G1 has no prerequisite, it is the trust root of
the deployment, and four other gates (G3, G4, G5, G8) each end by writing a secret into a file that only
G1 creates - so doing them first produces secrets with nowhere to live. G3 and G4 can technically be done
in any order relative to G1, but there is no reason to mint a production secret before there is a
hardened place to put it.

Everything in this repository that does not require a human is already built or is being built behind an
injected port with a deterministic mock. Nothing below is waiting on the build.

## THIS FILE IS A TEMPLATE AND A REGISTER. NOTHING HERE IS EXECUTED BY AN AGENT.

No automated agent runs any command in this file. Not to test it, not to "check whether it would work",
not with a placeholder substituted. Every command below is written **for a human operator** and every
value in it is an `<ANGLE_BRACKET>` placeholder that resolves only in the operator's own session or in
the host's secret store. A placeholder in this file never resolves to real data in a tracked file.

Steering §2 relocated the wall: it is no longer "do not build this area", it is a **network and secret
boundary**. Everything behind that boundary is buildable now and is being built. Everything **on** it is
in this register, and is blocked pending a human.

## Gate discipline (binding - steering §2/§7, contract 12 §9)

1. **Never invent a secret value.** Not to unblock a test, not as an example, not as a placeholder that
   looks real. A realistic-looking fake secret is worse than no secret, because it gets copied.
2. **Never commit a real secret.** Only environment-template-shaped files are tracked.
3. **Never place a key in the data-backup storage.** Keys and the data they protect are kept apart on
   purpose (`docs/PFOS_SECRETS_PLAN.md` §1, §5). The backup storage is not a secret tier.
4. **Never weaken a gate to make it pass.** A gate that can be satisfied by weakening it was not a gate.
5. **Never claim a gated item is done.** Record it as blocked with the exact next human action. Marking
   a gated item complete is the single most damaging thing possible here: it converts a known gap into
   an invisible one.
6. A gated item that is blocking progress is escalated to the owner as **one specific request**, not as
   a general status complaint.

## Public-repository constraint on this file (R24, steering §0b)

Both repositories are public by owner decision (2026-08-06). This file may describe the *shape* of every
human step; it may not contain a single **deployment particular**. Never here, not even as an example:

- a real hostname - write `<LIFE_HOSTNAME>`, `<MONEY_HOSTNAME>`
- an address of the host, in any notation
- a secret webhook path segment - generated at deploy time, resident only in the host environment
- a bot name, a bot identifier, or a numeric messaging user identifier - write `<BOT_A_TOKEN>`, `<ALLOWED_USER_IDS>`
- a storage folder identifier, file identifier, or account address - write `<BACKUP_FOLDER_REF>`
- an administrative access port, or the backup public key
- any real amount, balance, account identifier, payee, or ledger excerpt
- any organization-specific term

The threat model this buys: **an attacker knows the architecture exactly and still cannot reach the
system, because every particular is injected at run time.** That is the standard posture for
open-source self-hosted software, and it holds only while the invariant holds without exception.

**No exceptions, including the obvious one.** A provider's own public API endpoint is arguably harmless -
it is documented, identical for every user of that provider, and reveals nothing about this deployment.
It is still a placeholder here (see the glossary below). The reason is not that the endpoint is dangerous;
it is that "which domains are harmless" is a judgement call, and an invariant that admits one judgement
call admits the next. So when spec task 9.0 adds the no-deployment-particular scanner, it needs **no
allowlist entry at all** for this file. An empty exception list cannot erode (contract 12 §10.2).

## Completion status of this document (spec task 0.5 seeds it, task 9.3 completes it)

Spec task **0.5** seeds this register: every gate present, with why it needs a human, the step shape, a
verification line, and a status. Spec task **9.3** completes it - "every human step with exact commands
and a verification line" - once Phase 7 has authored the `ops/` templates the steps refer to, so the
paths, file names, and environment variable names quoted below match the artifacts that exist rather
than the ones that were planned.

9.3 is therefore a **fill-in, not a rewrite**. Its edits are confined to:

- resolving intended paths (written below as "intended path `ops/...`") to the real authored paths;
- aligning environment variable names with the tracked `ops/env/` templates as authored;
- adding any step or verification line that Phase 7 reveals is missing;
- nothing else. 9.3 must not renumber a gate, remove a gate, soften a verification line, reopen G7, or
  change any `Status:` away from `BLOCKED - awaiting human` (see "What an agent may write in this file").

If 9.3 finds a gate whose steps cannot be made exact without a deployment particular, the step stays a
placeholder and the gap is recorded as a note - **not** resolved by inventing a value (R24).

**What 9.3 resolved, recorded so a reader can tell a fill-in from a rewrite.** Every gate is still
here, still numbered as it was, still `BLOCKED - awaiting human`, and G7 is still closed. What changed:

- Four "intended path" phrasings became the authored paths. One of them named a path that **does not
  exist** and was corrected to what Phase 7 actually delivered rather than to a file invented to match
  the promise - see the correction recorded under G1's "Already built and waiting".
- Nine entries that the tracked `ops/env/` templates attribute to a gate had no step telling the operator to
  set them. Each gate now names its own: G1 five, G2 one, G4 two, G5 two. G5's existing verification
  line already *used* two of them, which is how a human following this file would have discovered the
  gap - at the first unattended token refresh.
- G6's step 2 said to store each webhook secret "beside the path". The templates deliberately put the
  **paths** in the proxy's file and the **secrets** in the two agents' files, in opposite directions;
  the step now says so, and a negative verification line asserts each file lacks the other's value.
- Two entries that a gate's steps **already** named carried no verification line of their own: G3's
  allowlist entry and G4's life-agent key. Neither was found by re-reading the document - both were
  found by the completeness checker 9.3 added, which is the argument for having written it. Each now
  has a counting line, and G4's records why the per-key read-back above it does not cover the second
  key.
- Each added step has a verification line, and every added line reports a **count**, never a value.

Nothing was renumbered, removed, softened, reopened, or marked satisfied, and no placeholder here
resolves to anything real.

## How to use this register

- Work top to bottom; the ordering is a dependency ordering (see the summary table).
- After completing a gate, run its **VERIFICATION** line and record the *observation*, never the value.
- Change `Status:` only after the verification line passes. `BLOCKED - awaiting human` is the only
  status an agent may ever write.
- Secret-valued placeholders are supplied by **environment reference** (`${BOT_A_TOKEN}`) sourced from
  the host secret store, so the value never enters shell history, a proxy log, or an agent context.

### Placeholder glossary for third-party endpoints

Provider API endpoints are placeholders too. They are not deployment particulars, but the invariant in
R24 admits no judgement calls about which domains are "harmless", so the register carries none at all.
The operator resolves each from the provider's own published API documentation before running a command:

| Placeholder | Resolves to |
|---|---|
| `<MSG_API_BASE>` | the messaging provider's documented bot API base URL |
| `<MODEL_API_BASE>` | the model provider's documented API base URL |
| `<STORAGE_TOKEN_URL>` | the storage provider's documented OAuth token endpoint |

Everything else in `<ANGLE_BRACKETS>` is a value the operator generates, is issued, or chooses.

---

## Summary

| Gate | Blocked on a human because | Depends on | Releases |
|---|---|---|---|
| **G1** provision + harden the host | creates the trust root of the deployment | - | every runtime item; G4/G5/G6/G8 placement |
| **G2** records for the two hostnames | changes a public record outside this repo | G1 | TLS issuance; G6 |
| **G3** create the two bots | interactive provider session; mints secrets | - | G6; live transport |
| **G4** mint the two model keys + caps | mints secrets; sets the spend ceiling | - | live routing; non-provisional registry |
| **G5** storage consent grant | an interactive consent click | G1 | verified backup upload |
| **G6** register both webhooks | needs production tokens; makes the host reachable | G1, G2, G3 | live delivery |
| **G8** backup keypair, private half off the host | the step that makes the backup guarantee true | G1 | backup + restore drill |
| ~~G7~~ | **CLOSED - WONT-DO** (see below) | - | - |

### Ordering

```
G1  provision + harden  ──┬──> G2 records ──┐
   (the trust root)       │                 ├──> G6 register webhooks ──> live delivery
                          │   G3 two bots ──┘
                          │
                          ├──> G5 storage consent ──┐
                          │                         ├──> first real backup ──> restore drill
                          └──> G8 backup keypair ───┘

G4  mint the two keys + caps   (independent of G1-G3; needed before live routing)
```

Three things this ordering encodes, each for a reason:

- **G1 precedes everything.** It is the trust root. G4 is the one gate that can be done in parallel,
  because minting a key touches no host - but its keys have nowhere to live until G1 exists.
- **G6 is last of the reachability chain.** It needs a name that resolves and terminates TLS (G2) and
  production tokens (G3). Registering a webhook before either is how a deployment ends up publicly
  reachable and broken at the same time.
- **G8 precedes the first real backup, not the first backup script.** An archive produced before the
  keypair exists off-host is not a backup; it is plaintext with a filename. Ordering G8 after the first
  archive would void the guarantee retroactively for that archive.

### Ordering - which gate blocks which

Read as "must precede":

- **G1 before G3, G4, G5, G8** - each of those ends by writing a secret into `/etc/<CONFIG_DIR>`, which
  G1 creates root-owned and mode-restricted. Minting a secret before its home exists means holding it
  somewhere unmanaged in the meantime.
- **G1 before G2** - the address record must point at a host that exists and that already denies by
  default. Publishing a name for an unhardened host advertises it.
- **G1, G2 and G3 all before G6** - webhook registration needs a resolving name that terminates TLS (G2
  on G1) *and* the production bot tokens (G3). All three, not any one.
- **G8 before any real backup** - and this one is absolute. A backup taken before the keypair exists is
  either unencrypted or encrypted to a key that was generated on the host, and the second case voids the
  "a host compromise yields ciphertext only" guarantee **retroactively, for every archive**. There is no
  catching up later.
- **G5 before the upload step of the backup path**, but G5 is independent of G8: the grant governs *where*
  an archive goes, the keypair governs *whether it is readable*. Neither substitutes for the other, and
  the backup path is not complete with only one.
- **G4 before live routing.** Not before the eligibility registry, which the dev-key carve-out can produce
  in provisional form (see the carve-out note below) - but before any of it routes.

Two gates have no prerequisite at all: **G3** and **G4**. They are still sequenced after G1 above, for
the storage reason, not for a technical dependency.

---

## G1 - Provision and harden the host

**Status: BLOCKED - awaiting human**

### Why a human is required

This gate creates the trust root of the entire deployment. No code may create the host it will run on:
there is no prior authority for it to authenticate with, and any agent able to provision a host is also
able to provision a host the owner did not ask for. Hardening choices (who may log in, what the firewall
denies) are the security policy itself - they are not derivable from the repository.

### Steps (human operator, on the provider console then over an administrative session)

1. Create the instance with the chosen provider `<VPS_PROVIDER>`, size `<INSTANCE_SIZE>`, region `<REGION>`.
2. Create a non-root operator account and give it administrative escalation:
   ```
   adduser <OPERATOR_USER>
   usermod -aG sudo <OPERATOR_USER>
   install -d -m 700 -o <OPERATOR_USER> -g <OPERATOR_USER> /home/<OPERATOR_USER>/.ssh
   ```
3. Install the operator public key, then disable password and root administrative login:
   ```
   # in the administrative daemon configuration
   PermitRootLogin no
   PasswordAuthentication no
   PubkeyAuthentication yes
   AllowUsers <OPERATOR_USER>
   ```
4. Default-deny firewall; allow only the TLS port and the administrative port:
   ```
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow <TLS_PORT>/tcp
   ufw allow <ADMIN_PORT>/tcp
   ufw enable
   ```
5. Enable intrusion blocking on the administrative service and unattended security updates.
6. Install the container runtime and its compose plugin; confirm the service is enabled at boot.
7. Create swap sized `<SWAP_SIZE>` (the box is small; the model client and the proxy must not be reaped).
8. Create the root-owned configuration directory that will hold the environment files:
   ```
   install -d -m 700 -o root -g root /etc/<CONFIG_DIR>
   ```
   Each environment file inside it is `chmod 600`, owner `root` (`docs/PFOS_SECRETS_PLAN.md` §3, option A).
   One file per service, read by no other service (contract 12 §3.2.7). `ops/docker-compose.yml`
   names each of them by placeholder - `<LIFE_ENV_PATH>`, `<FINANCE_ENV_PATH>`, `<BUS_ENV_PATH>`,
   `<SCHEDULER_ENV_PATH>`, `<PROXY_ENV_PATH>`, `<BACKUP_ENV_PATH>` - and those are the names the
   verification lines below and in the other gates use.
9. Record the five entries **this gate supplies**, each in the file of the service that owns it. They
   are directory and path decisions, so they belong to the gate that creates the host, and a
   deployment that skips this step fails at first start on an unset entry - there is no default for
   any of them (the tracked `ops/env/` templates, "no default for anything"):
   - `LIFE_DATA_DIR` in `<LIFE_ENV_PATH>`, `FINANCE_DATA_DIR` in `<FINANCE_ENV_PATH>`,
     `SIGNALS_DATA_DIR` in `<BUS_ENV_PATH>` - one store directory per service, and no file names
     another service's (contract 12 §3.2.1).
   - `BACKUP_WORK_DIR` in `<BACKUP_ENV_PATH>` - the scratch directory for the snapshot-encrypt-shred
     sequence, and never a store.
   - `KILL_SENTINEL_PATH` in all four halt-honouring files - `<LIFE_ENV_PATH>`, `<FINANCE_ENV_PATH>`,
     `<SCHEDULER_ENV_PATH>`, `<BACKUP_ENV_PATH>` - as a path inside the sentinel mount the topology
     declares. It is the **same** path in each by construction, because that volume is mounted at one
     target in every consumer, read-only, so no service can clear its own halt (contract 12 §8).

### VERIFICATION

```
# every line must hold, run from the operator session
ufw status verbose            # -> default deny incoming; only <TLS_PORT> and <ADMIN_PORT> allowed
sshd -T | grep -E 'permitrootlogin|passwordauthentication'   # -> no / no
stat -c '%U %G %a' /etc/<CONFIG_DIR>                          # -> root root 700
systemctl is-enabled <CONTAINER_RUNTIME_SERVICE>              # -> enabled
swapon --show                                                 # -> a swap device is present
id <OPERATOR_USER>                                            # -> exists, non-zero uid
```
A password login attempt from another machine must be **refused**, not merely rejected after prompting.

Then step 9, one line per entry this gate supplies. `-c` counts a matching assignment and prints no
value, which is the only form a verification line in this file may take (R24):

```
grep -c '^LIFE_DATA_DIR='       <LIFE_ENV_PATH>       # -> 1
grep -c '^FINANCE_DATA_DIR='    <FINANCE_ENV_PATH>    # -> 1
grep -c '^SIGNALS_DATA_DIR='    <BUS_ENV_PATH>        # -> 1
grep -c '^BACKUP_WORK_DIR='     <BACKUP_ENV_PATH>     # -> 1
grep -c '^KILL_SENTINEL_PATH='  <LIFE_ENV_PATH> <FINANCE_ENV_PATH> <SCHEDULER_ENV_PATH> <BACKUP_ENV_PATH>
# -> 1 for each of the four, and the four values are identical
```
And the negative, which is the isolation half: neither agent's file names the other's store directory -
`grep -c FINANCE_DATA_DIR <LIFE_ENV_PATH>` -> `0`, and the same test in the other direction.

### Unblocks

Everything runtime. Directly: the placement steps of G4, G5, G6, G8; spec Phase 7 execution
(tasks 7.1-7.6) and the live verification of **R20**, **R21**, **R22**.

### Already built and waiting

Nothing yet - G1 is the trust root, so it precedes every code path. What it will consume is the whole
`ops/` template set, authored as text in spec Phase 7 and never executed here:
`ops/docker-compose.yml` (task 7.1), `ops/Caddyfile` (task 7.2), the six tracked `ops/env/`
templates (task 7.3), `ops/backup/backup.sh` and the drill under `ops/restore/` (task 7.4), and the
three runbooks under `ops/runbook/` (task 7.6).

**Correction, recorded rather than quietly dropped (spec task 9.3).** The seed of this section named a
fifth intended path, a unit-file directory under `ops/`. **No such directory was authored, and none is
needed.** Task 7.5 - "health endpoints, structured redacted logging, log rotation" - delivered those
three things in the two places they actually belong rather than as unit files: the per-service health
probe and the redacted structured logger under `src/server/ops/`, and, in `ops/docker-compose.yml`, one
`healthcheck` block per service plus one log-rotation block per service with a fixed size and file
count. The container runtime is what starts and restarts these services, and step 6 above confirms it
is enabled at boot, so there is nothing for a unit file to do. The reference is corrected to what
exists; no file was invented to satisfy it.

### Recorded observation - a host now exists (2026-08-09)

**Status: BLOCKED - awaiting human**

A host has been created at the chosen provider and reports active. This meets only the *precondition*
of G1 - that there be a machine to harden - and settles nothing else. The hardening checklist in the
steps above (the operator account, key-only login, default-deny firewall, container runtime, swap, and
the root-owned `/etc/<CONFIG_DIR>` that four other gates write into) has not been worked, so G1 stays
`BLOCKED - awaiting human`. No particular of that host - its address, its name, its region, any
credential - is written here or in any tracked file (R24); those are recorded in an untracked operator
file outside the tracked tree, and the operator resolves them from there when running the steps.

**The certificate-challenge port, settled (spec task 10.8, finding F12, owning requirement R30).** Step
4 above is correct as written and needs no correction: the firewall allows `<TLS_PORT>` and
`<ADMIN_PORT>`, and **no cleartext challenge port is required**. The resolution chosen is
**TLS-ALPN-01 on `<TLS_PORT>` alone**, and it is recorded here because R30 requires the resolution to
be recorded in this file rather than inferred from either artifact on its own.

An earlier observation in this section advised opening a second port for the cleartext challenge. That
advice was wrong in a way worth naming, because it is the reason R30 exists: `ops/docker-compose.yml`
binds exactly one host port, so a firewall opened for a challenge the topology never binds fails
**while the firewall looks correct** - the artifact an operator would check to diagnose it is the one
that is right. The two artifacts now agree in both directions, and `ops/Caddyfile` already switches
that challenge off on both sites, so issuance is deterministic on the TLS port instead of resting on a
failed attempt and a retry. The reasoning, the criterion it was decided on and the alternative that
was rejected are in `ops/IMAGE_BUILD.md`; `src/server/ops/imageOwnership.ts` re-reads all three
artifacts on every test run and reports a finding if any one of them stops agreeing.

Nothing in phase 1 depends on this: it ships on long polling, publishes no host port and needs no
certificate at all. The resolution binds phase 2, which is why R30 asks for it to be closed **before**
phase 2 begins rather than during it.

A second observation, recorded so it is not mistaken for the backup guarantee: the provider offers its
own snapshot and automated backup, and both may be left enabled for host rebuild. Neither satisfies G8.
They are readable by the provider and are not encrypted to a recipient whose private half is off the
host, so they are a convenience, not the "a host compromise yields ciphertext only" guarantee G8 makes.
G8 is still required in full.

### Recorded observation - container runtime confirmed, configuration directory created empty (2026-08-12)

**Status: BLOCKED - awaiting human**

Two lines of the VERIFICATION block above now hold on the live host. `systemctl is-enabled
<CONTAINER_RUNTIME_SERVICE>` reports `enabled`, the service is active now, and the compose plugin
is present alongside it, so step 6 is done. `stat -c '%U %G %a' /etc/<CONFIG_DIR>` reports
`root root 700`, matching the install command in step 8 exactly, so the directory half of step 8 is
also done.

Nothing else in this checklist was re-checked this pass, and this observation makes no claim about
the operator account, key-only login, the firewall, intrusion blocking, unattended updates or swap
either way. The directory itself is empty - no environment file exists inside it yet - so the second
half of step 8 (one `chmod 600` file per service) and all of step 9 (the five data-directory and
sentinel-path entries, which have nowhere to be written without those files) remain outstanding, and
the `grep -c` lines later in the VERIFICATION block above would all still return `0`. G1 stays
`BLOCKED - awaiting human`. As with the observation above, no particular of the host or of the
directory name chosen is written here or in any tracked file (R24); that stays in the untracked
operator file outside the tracked tree.

---

## G2 - Records for the two hostnames

**Status: BLOCKED - awaiting human**

### Why a human is required

It changes a public record outside this repository's control, using registrar credentials that are
deliberately not in any secret tier the build can reach. A wrong record is publicly visible and cached.

### Steps

1. At each dynamic-DNS provider - potentially two different providers, since the two hostnames need not
   share a domain - create or update the address record for each site:
   - `<LIFE_HOSTNAME>` -> `<HOST_ADDRESS>`
   - `<MONEY_HOSTNAME>` -> `<HOST_ADDRESS>`
2. Set `<TTL>` low until the deployment is stable, then raise it.
3. Do **not** create a record for the signal bus. The bus is internal-network-only and must never be
   resolvable or proxied (contract 12 §12, requirement **R9**). The full binding requirement - what the
   compose file must declare, what the proxy template must never contain, and how both are verified - is
   `ops/BUS_NETWORK_BINDING.md`, authored in spec Phase 3.3 and binding on tasks 7.1 and 7.2.
4. Record the entries **this gate supplies**: `LIFE_HOSTNAME=<LIFE_HOSTNAME>` and
   `MONEY_HOSTNAME=<MONEY_HOSTNAME>` in `<PROXY_ENV_PATH>`. They are the only entries the proxy template
   attributes to G2, and the two site addresses in `ops/Caddyfile` are derived from them directly - so
   the two records created in step 1 and the values recorded here cannot be allowed to disagree. No
   agent's environment file carries either; the proxy is the only service that routes by hostname.

### VERIFICATION

```
dig +short <LIFE_HOSTNAME>   # -> resolves to the host; record the fact, never the value
dig +short <MONEY_HOSTNAME>  # -> resolves to the same host
dig +short <BUS_HOSTNAME_THAT_MUST_NOT_EXIST>   # -> empty, and stays empty
grep -c '^LIFE_HOSTNAME=' <PROXY_ENV_PATH>      # -> 1
grep -c '^MONEY_HOSTNAME=' <PROXY_ENV_PATH>     # -> 1
```
Then, after the proxy is up, a TLS handshake to each hostname must present a valid certificate for that
name. Record "certificate valid for both names, issued `<DATE>`" - not the certificate.

### Unblocks

Automatic certificate issuance for both hostnames; **G6** (the webhook URL cannot be registered before
the name resolves and terminates TLS).

### Already built and waiting

The proxy template `ops/Caddyfile` (spec task 7.2), which already carries the two host blocks -
`<LIFE_HOSTNAME>` and `<MONEY_HOSTNAME>` - and the two secret webhook paths as placeholders, and
deliberately carries **no** route
to the signal bus.

---

## G3 - Create the two bots

**Status: BLOCKED - awaiting human**

### Why a human is required

Creating a bot is an interactive session with the messaging provider, and it **mints production
secrets**. An agent that could create a bot could create one the owner does not know about, and would
necessarily hold its token.

### Steps

1. In the provider's bot-creation conversation, create the life agent bot; record its token as
   `<BOT_A_TOKEN>`.
2. Create the finance agent bot; record its token as `<BOT_B_TOKEN>`.
3. Disable group joining and privacy-mode exposure for both; this is a single-operator system and
   neither bot has any reason to be in a group.
4. Place both tokens in the host secret store only:
   ```
   # /etc/<CONFIG_DIR>/life.env      -> BOT_A_TOKEN=<BOT_A_TOKEN>
   # /etc/<CONFIG_DIR>/finance.env   -> BOT_B_TOKEN=<BOT_B_TOKEN>
   chmod 600 /etc/<CONFIG_DIR>/*.env
   chown root:root /etc/<CONFIG_DIR>/*.env
   ```
5. Record the owner's own messaging identifier into `ALLOWED_USER_IDS=<ALLOWED_USER_IDS>` in each file.
   The allowlist is never empty and never widened; an empty allowlist must refuse everyone
   (requirement **R12**, contract 12 T20).

### VERIFICATION

```
# from the host, tokens read from the environment - never typed inline
curl -sS "<MSG_API_BASE>/bot${BOT_A_TOKEN}/getMe"   # -> ok:true, is_bot:true
curl -sS "<MSG_API_BASE>/bot${BOT_B_TOKEN}/getMe"   # -> ok:true, is_bot:true, a different id
stat -c '%U %G %a' /etc/<CONFIG_DIR>/life.env                 # -> root root 600
```
Record only "two distinct bots authenticate" - never the returned name or identifier (R24).

Then the entry **step 5 supplies**, in both files. It was the one entry this gate placed and never
confirmed, and the asymmetry is what makes that dangerous: an allowlist present in one file and
absent from the other refuses the owner on one bot while the other has no allowlist to consult at
all. A count answers presence without printing the identifier (R24):

```
grep -c '^ALLOWED_USER_IDS=' <LIFE_ENV_PATH> <FINANCE_ENV_PATH>   # -> 1 for each of the two
```
Presence is necessary and not sufficient here: an empty allowlist must refuse **everyone**
(requirement **R12**, contract 12 T20), so confirm the value is non-empty by observing that the
refusal path below rejects an absent sender - never by reading the value back.

### Unblocks

**G6**; and the production path of the transport already built and tested against mocks in spec Phase 4
(**R11**-**R15**).

### Already built and waiting

The transport itself: the constant-time token compare and allowlist ported from the other repository's
relay auth, the per-bot dedup index keyed `(bot_id, update_id)`, and the accept-fast/process-async
handler (spec tasks 4.1-4.4). All of it runs today against the deterministic `TelegramPort` mock (task
2.2). Clearing G3 swaps the mock for the live adapter; no logic changes.

### Recorded observation - both bots still authenticate, re-confirmed (2026-08-12)

**Status: BLOCKED - awaiting human**

The VERIFICATION line above was run again and holds: both getMe calls against `<MSG_API_BASE>`
still return `ok:true, is_bot:true`, and the two ids are still distinct. This re-confirms the same
check recorded once already (2026-08-09, in the untracked operator file this file's own rule keeps
particulars out of); it is not a new grant and does not narrow what is left. As with that file's
disclosure note, the tokens are still unrotated - by decision D-ROTATE, rotation is deferred to the
final acceptance test, not before - and neither name nor identifier is written here (R24).

Step 4 (placing both tokens in the host secret store) still cannot be done: `/etc/<CONFIG_DIR>`
exists now (recorded under G1 above) but holds no environment files yet, so there is nowhere on the
host to place them, and step 5's allowlist entry has the same dependency. G3 stays
`BLOCKED - awaiting human` on the human step above, not on this check.

---

## G4 - Mint the two runtime model keys and their periodic caps

**Status: BLOCKED - awaiting human**

### Why a human is required

It mints production secrets and it sets the **spend ceiling** that the second belt of the cost model
depends on. An agent that could mint a key with a cap could mint one without a cap. Steering forbids
raising, bypassing, or temporarily lifting a cap under any circumstance, so the cap must be set by the
party who owns the money.

### Steps

1. Create a management/provisioning key in the provider console. It stays on the operator machine only;
   it is never placed on the host.
2. Mint the two runtime keys, one per agent, each with its own periodic limit:
   ```
   curl -sS <MODEL_API_BASE>/api/v1/keys \
     -H "Authorization: Bearer <PROVISIONING_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name":"<LIFE_KEY_NAME>","limit":<LIFE_WEEKLY_CAP>,"limit_reset":"weekly"}'

   curl -sS <MODEL_API_BASE>/api/v1/keys \
     -H "Authorization: Bearer <PROVISIONING_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name":"<FINANCE_KEY_NAME>","limit":<FINANCE_WEEKLY_CAP>,"limit_reset":"weekly"}'
   ```
   `<FINANCE_WEEKLY_CAP>` must equal the value already encoded in the offline policy module, so the
   provider-side ceiling and the in-process ledger agree. Per-key caps **are** the isolation: a runaway
   loop in one agent cannot spend the other's allocation (requirement **R17**).
3. Set the account-level privacy posture once, applying to both keys: training opt-out on, prefer
   providers that decline data collection, zero-retention where offered (requirement **R19**).
4. Place each key in its own environment file - `OR_KEY_LIFE=<OR_KEY_LIFE>` in the life file,
   `OR_KEY_FINANCE=<OR_KEY_FINANCE>` in the finance file. Neither file contains the other agent's key
   (contract 12 T4).
5. Record the two cap entries **this gate also supplies**, each beside its own key:
   `LIFE_WEEKLY_CAP=<LIFE_WEEKLY_CAP>` in `<LIFE_ENV_PATH>` and
   `FINANCE_WEEKLY_CAP=<FINANCE_WEEKLY_CAP>` in `<FINANCE_ENV_PATH>`. Each must equal the
   provider-side limit set for that agent's key in step 2, because these are the values the in-process
   ledger enforces against and the two ceilings are meant to agree rather than to be belt and braces
   that disagree. Neither file carries the other agent's cap: a cap that spanned both agents would make
   one agent's runaway loop the other agent's outage (**R17**).

### VERIFICATION

```
# per key, value read from the environment
curl -sS <MODEL_API_BASE>/api/v1/key -H "Authorization: Bearer ${OR_KEY_FINANCE}"
# -> limit == <FINANCE_WEEKLY_CAP>, limit_reset == "weekly", usage present

# the recorded cap agrees with the provider-side limit just read back, in each file
grep -c '^FINANCE_WEEKLY_CAP=' <FINANCE_ENV_PATH>   # -> 1
grep -c '^LIFE_WEEKLY_CAP='    <LIFE_ENV_PATH>      # -> 1

# and each key is where step 4 put it. The read-back above is run per key, so the life key needs
# its own placement line: step 4 places two keys and only one of them was ever confirmed present.
grep -c '^OR_KEY_FINANCE=' <FINANCE_ENV_PATH>       # -> 1
grep -c '^OR_KEY_LIFE='    <LIFE_ENV_PATH>          # -> 1
```
Then, in the console, confirm the training opt-out is on. Finally confirm the negatives, run in both
directions: the life environment file contains no finance key and no finance cap, and vice versa -
`grep -c OR_KEY_FINANCE /etc/<CONFIG_DIR>/life.env` -> `0`, and
`grep -c FINANCE_WEEKLY_CAP /etc/<CONFIG_DIR>/life.env` -> `0`.

### Unblocks

Live routing (spec Phase 5, **R16**-**R19**) and the promotion of a **non-provisional** eligibility
registry (task 6.3, **R18**). Until G4 is done, routing may run only against mocks and recorded
fixtures.

### Already built and waiting

The most complete of the set. The `src/features/routing/` policy module (the model-selection and periodic
budget policy) and `src/features/benchmark/` (dataset, runner, scoring, cost, eligibility) are built and
under test now. The per-agent spend ledger (task 1.4) and the router/scorer that consumes the policy
(task 5.2) sit behind the `OpenRouterPort` mock. Clearing G4 supplies the two production keys and the
provider-side ceiling that the in-process ledger is designed to agree with.

---

## G5 - Storage consent grant for the backup path

**Status: BLOCKED - awaiting human**

### Why a human is required

It is an interactive consent click in a browser session belonging to the owner's account. It cannot be
simulated and must not be: a consent flow an agent can complete unattended is not consent. A service
identity is **not** an acceptable substitute here - a service identity has no personal storage quota and
its uploads either fail or become orphaned, so the backup path uses a narrow-scope **user** grant
(architecture §1.9).

### Steps

1. On the operator machine, run the desktop consent flow for the backup client, requesting the
   per-file scope only - never the full-storage scope (steering `drive-db.md`, harness check AC08).
2. Complete the consent screen in the browser as the owner.
3. Exchange the authorization code for a refresh token and place it in the backup environment file as
   `DRIVE_REFRESH_TOKEN=<DRIVE_REFRESH_TOKEN>`, `chmod 600`, owner `root`.
4. Record the destination folder reference as `BACKUP_FOLDER_REF=<BACKUP_FOLDER_REF>` in the same file.
   The reference is a deployment particular: it lives in the host environment and nowhere else.
5. Record the client the grant was issued to, in the same file and nowhere else:
   `GOOGLE_CLIENT_ID=<GOOGLE_CLIENT_ID>` and `GOOGLE_CLIENT_SECRET=<GOOGLE_CLIENT_SECRET>`. Both are
   attributed to this gate by the backup template, and the refresh in the verification line below
   **cannot be performed without them** - a deployment that placed only the refresh token would find
   that out at the first unattended refresh, which is the worst moment to find it out. The operator
   also resolves `STORAGE_TOKEN_URL=<STORAGE_TOKEN_URL>` in the same file from the storage provider's
   published documentation, per the placeholder glossary above.
6. Confirm the grant can write to that folder and read nothing else.

### VERIFICATION

```
# refresh the grant without any interactive prompt
curl -sS <STORAGE_TOKEN_URL> \
  -d "client_id=<GOOGLE_CLIENT_ID>" \
  -d "client_secret=<GOOGLE_CLIENT_SECRET>" \
  -d "refresh_token=${DRIVE_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token"
# -> an access token is returned and its scope is the per-file scope ONLY
```
The four entries this gate supplies must each be present in the backup file before that refresh is
attempted, and the endpoint the operator resolved with them:

```
grep -c '^DRIVE_REFRESH_TOKEN=' <BACKUP_ENV_PATH>   # -> 1
grep -c '^BACKUP_FOLDER_REF='   <BACKUP_ENV_PATH>   # -> 1
grep -c '^GOOGLE_CLIENT_ID='    <BACKUP_ENV_PATH>   # -> 1
grep -c '^GOOGLE_CLIENT_SECRET=' <BACKUP_ENV_PATH>  # -> 1
grep -c '^STORAGE_TOKEN_URL='   <BACKUP_ENV_PATH>   # -> 1
```

Then upload a small synthetic probe file to `<BACKUP_FOLDER_REF>`, confirm it appears, delete it, and
confirm a listing of any folder the grant did not create is **refused**. Record "per-file scope
confirmed, out-of-scope listing refused".

### Unblocks

The verified-upload step of the backup path (task 7.4, **R20**). Until G5 is done, the backup script may
be written and unit-tested against a mock storage port, but never run against real storage.

### Already built and waiting

The `DrivePort` interface and its deterministic mock (tasks 2.1-2.2), plus the snapshot-encrypt-shred
script `ops/backup/backup.sh` (task 7.4), whose uploader step resolves this grant from the backup
environment file and refuses any verdict other than a verified one. The per-file-scope posture is already asserted by
the existing harness check AC08, so the grant this gate produces is checked against a rule that predates
it.

---

## G6 - Register both webhooks

**Status: BLOCKED - awaiting human**

### Why a human is required

It requires the production bot tokens (G3) and it is the moment the deployment becomes **publicly
reachable**. It also fixes the secret path segments, which are generated at deploy time and must exist
only in the host environment - if an agent generated and registered them, they would have to pass
through the agent's context.

### Steps

1. Generate a high-entropy random path segment per bot, on the host, and store both in the **proxy's**
   environment file: `LIFE_WEBHOOK_PATH=<LIFE_WEBHOOK_PATH>` and
   `MONEY_WEBHOOK_PATH=<MONEY_WEBHOOK_PATH>` in `<PROXY_ENV_PATH>`. Use a random segment, **not** the
   bot token, so the token never appears in a proxy log. Routing by the segment is the proxy's own job
   (contract 12 §2.2.3) and neither agent ever needs to know its own, so neither agent's file carries
   one.
2. Generate a secret token per bot within the provider's documented character set, and store each in
   **that agent's own** file, not beside the path: `LIFE_WEBHOOK_SECRET=<LIFE_WEBHOOK_SECRET>` in
   `<LIFE_ENV_PATH>`, `MONEY_WEBHOOK_SECRET=<MONEY_WEBHOOK_SECRET>` in `<FINANCE_ENV_PATH>`. The split
   is deliberate and is the opposite way round from the paths: the proxy passes the provider's
   secret-token header through untouched and neither checks nor consumes it, and the constant-time
   comparison **R11** requires lives in the agent. A proxy that held the value could compare it, and
   the comparison would then exist somewhere no test covers.
3. Register each webhook, from the host, with values sourced from the environment:
   ```
   curl -sS "<MSG_API_BASE>/bot${BOT_A_TOKEN}/setWebhook" \
     --data-urlencode "url=https://<LIFE_HOSTNAME>/tg/<LIFE_WEBHOOK_PATH>" \
     --data-urlencode "secret_token=<LIFE_WEBHOOK_SECRET>" \
     --data-urlencode 'allowed_updates=["message","callback_query"]' \
     --data-urlencode "max_connections=<MAX_CONNECTIONS>" \
     --data-urlencode "drop_pending_updates=true"
   # repeat with ${BOT_B_TOKEN} -> <MONEY_HOSTNAME>/tg/<MONEY_WEBHOOK_PATH> + <MONEY_WEBHOOK_SECRET>
   ```
   Notes that are policy, not preference: the URL terminates on the TLS port, which the provider
   documents as one of a closed permitted set; `allowed_updates` is narrowed to the two kinds the
   agents handle; `<MAX_CONNECTIONS>` is set low because a single-operator system needs almost nothing;
   `drop_pending_updates=true` on **first** registration only, so a backlog is not replayed.
4. Confirm the proxy routes each secret path to its own agent and routes **nothing** to the signal bus.

### VERIFICATION

```
curl -sS "<MSG_API_BASE>/bot${BOT_A_TOKEN}/getWebhookInfo"
# -> url matches the expected host and path, has_custom_certificate:false,
#    allowed_updates is the narrowed pair, max_connections == <MAX_CONNECTIONS>,
#    pending_update_count == 0, and NO last_error_date / last_error_message
```
Then the placement, in both directions, because step 1 and step 2 put their values in opposite files:

```
grep -c '^LIFE_WEBHOOK_PATH='    <PROXY_ENV_PATH>     # -> 1
grep -c '^MONEY_WEBHOOK_PATH='   <PROXY_ENV_PATH>     # -> 1
grep -c '^LIFE_WEBHOOK_SECRET='  <LIFE_ENV_PATH>      # -> 1
grep -c '^MONEY_WEBHOOK_SECRET=' <FINANCE_ENV_PATH>   # -> 1
grep -c WEBHOOK_PATH             <LIFE_ENV_PATH> <FINANCE_ENV_PATH>   # -> 0 in each
grep -c WEBHOOK_SECRET           <PROXY_ENV_PATH>                     # -> 0
```

Then the negative cases, which are the point of the gate:
- a request to the correct path **without** the secret-token header is refused (**R11**);
- a request with a wrong secret token is refused, and the response distinguishes nothing about which
  check failed (**R11**);
- a request from a sender absent from the allowlist is refused before any parsing (**R12**);
- the same update identifier delivered twice produces one side effect (**R13**);
- the two bots emitting the *same* update identifier are **both** processed (**R14**).

### Unblocks

Live delivery to both agents; the production path of spec Phase 4 (**R11**-**R15**).

### Already built and waiting

Everything G3 lists, plus the proxy template's two secret-path routes (task 7.2) and the health endpoints
the orchestrator restarts on (task 7.5, **R22**). The five negative cases above are already automated
against mocks in task 4.4; clearing G6 re-runs them against the live path, which is the only way to learn
whether the proxy, not just the handler, refuses them.

---

## G8 - Backup keypair, with the private half off the host

**Status: BLOCKED - awaiting human**

### Why a human is required

This is the one step that makes the backup guarantee **true** rather than merely stated. The guarantee is
"a host compromise yields ciphertext only". If an agent generated this keypair on the host, the private
half would have existed on the host - and the guarantee would be void from that moment, retroactively,
for every backup ever taken. Generation must happen somewhere the host cannot see, by someone who can
be responsible for where the private half ends up.

### Steps

1. On the **operator machine** - never on the host - generate the identity:
   ```
   age-keygen -o <AGE_IDENTITY_FILE>
   ```
2. Store `<AGE_IDENTITY_FILE>` in the operator's secure store, plus one offline copy in a second
   location. If this file is lost, every encrypted backup is permanently unreadable; that is the
   intended trade and it must be a deliberate one.
3. Derive the public recipient:
   ```
   age-keygen -y <AGE_IDENTITY_FILE>
   ```
4. Place **only** the public recipient on the host, in the backup environment file:
   `AGE_PUBLIC_KEY=<AGE_PUBLIC_KEY>`, `chmod 600`, owner `root`.
5. Confirm no identity file was ever copied to the host, and that no backup archive and no key share the
   same storage location (`docs/PFOS_SECRETS_PLAN.md` §1).
6. Run the **restore drill** before trusting any of it: fetch one encrypted archive, decrypt it with the
   off-host identity, run an integrity check, and boot a throwaway instance against the result. A
   restored store is trusted only **after** the integrity check passes; a store that fails the check is
   discarded and escalated, never repaired and used (**R21**).

### VERIFICATION

```
# on the host: the private half must be absent, everywhere
sudo grep -rIl -e 'AGE-SECRET-KEY' /etc /root /home /opt /srv /var/lib 2>/dev/null   # -> no output
grep -c AGE_PUBLIC_KEY /etc/<CONFIG_DIR>/backup.env                                  # -> 1

# off the host, on the operator machine, for one real archive
age -d -i <AGE_IDENTITY_FILE> -o <RESTORED_DB> <ARCHIVE>.age
sqlite3 <RESTORED_DB> 'PRAGMA integrity_check;'                                      # -> ok
shred -u <RESTORED_DB>
```
The empty output of the first command is the whole gate. Record "no identity material present on host,
restore drill passed `<DATE>`".

### Unblocks

The encrypt-and-upload path (task 7.4, **R20**) and the restore drill (**R21**). Until G8 is done, the
backup script may be written and tested against a mock, and no archive may be treated as a backup.

### Already built and waiting

The two scripts `ops/backup/backup.sh` and the drill under `ops/restore/` (task 7.4). The first takes
the public recipient from `AGE_PUBLIC_KEY` in the backup environment file and never contains it, reads
no identity file and no passphrase, and takes **no parameter at all** - so there is no parameter through
which private key material could be introduced. The second references the off-host identity as a path,
from `AGE_IDENTITY_FILE`, runs on the operator machine only, and carries the integrity check that gates
trust in a restored store (**R21**). Both are text until G1 and G8 clear.

### The write-ahead-log sidecar determination, at the first-backup step

**Status: BLOCKED - awaiting human. One decision, made once, before the first real backup.**

The engine documents that a reader of a write-ahead-logged store must be able to write that store's
shared-memory index sidecar. The backup service's store mounts are **read-only**, without exception
(contract 12 §3.2.2), and a read-only mount does not permit that write. The two rules meet at the
snapshot step, so the snapshot step **aborts loudly on a refused open** rather than degrading.

There are **exactly two acceptable outcomes**, and they are **ranked**:

| | Outcome | Standing | Why |
|---|---|---|---|
| **B** | Issue the snapshot statement from inside the **owning service**, which already holds the sidecar as its single writer (§3.2.4), and hand the artifact to the backup service's scratch directory. The backup service never opens a store at all. | **DOCUMENTED DEFAULT - choose this** | It needs **no write grant**, so it resolves the constraint **without widening a mount**. §3.2.2's read-only guarantee survives intact rather than with an exception carved into it. |
| **A** | Grant the backup service write access to the **sidecar only**. The store file itself stays read-only. | **Fallback** | Still acceptable and still bounded, but it widens a mount - which is exactly what the default avoids. Take it only when B is unavailable. |

**Neither outcome is a file copy, and a file copy is not available as a third answer.** A copy of a
write-ahead-logged store that is being written is not a database: it is a fragment that may restore,
may fail to restore, or - the case that matters - may restore **wrongly** and look fine. Copying the
sidecars alongside it does not help, because the copy is not atomic across the set. `ops/backup/`
contains no copy tool and the audit fails that template if one appears.

The same ranking is stated in `ops/backup/backup.sh` and in `ops/runbook/ROLLBACK.md`, and
`src/server/ops/runbookTemplate.ts` fails closed (`WAL_DEFAULT_OUTCOME_NOT_RANKED`) if the runbook
stops naming outcome B as the default or outcome A as the fallback.

**Record here when decided:** "sidecar determination: outcome `<SIDECAR_OUTCOME>` (B or A) taken on `<DATE>`; if A, the
sidecar-only grant is `<PATH>` and no store file was made writable." Until it is recorded, every
rollback across a migration is **blocked on a human**, not available.

---

## G7 - CLOSED, WONT-DO. Not a gate. Do not re-raise.

**Status: CLOSED - WONT-DO (owner decision, 2026-08-06)**

Repository privatization was previously tracked as gate G7. The owner authorized keeping both
repositories **public** on 2026-08-06 (steering §0b, architecture Appendix A / D0). It is therefore:

- **not** a gate,
- **not** an open decision,
- **not** to be raised again by any agent or in any status report.

It is recorded here for exactly one reason: a reader who finds G1-G6 and G8 must not conclude that G7
was lost or silently dropped.

**What replaced it.** Privatization would have protected deployment particulars by hiding the whole
repository. That protection is now provided instead by a **hard invariant, enforced by the harness**:
the repository may contain the *design*, but never a *deployment particular* (requirement **R24**,
contract 12 §10). Nothing in a tracked file may reveal how to reach or impersonate the running system.

This is a stronger position than privatization was, for two reasons. First, it holds even if the
repository leaks, is forked, or is made public later by accident - privatization protected nothing
against a copy that had already been taken. Second, it is **checkable**: a scanner over `ops/**` and
every fixture can fail closed on a bare domain, an address literal, a storage identifier, a numeric
messaging identifier, or a real monetary figure, and it has a negative test proving it fires
(spec task 9.0). "The repository is private" was an assertion about a setting; "no tracked file contains
a particular" is an assertion the build re-proves on every run.

---

## Context: the dev-key carve-out, and why it does not release G4

Steering §3 resolves a deadlock: the wall forbade live model calls, but the Phase-1 benchmark that the
wall required needed live calls. The carve-out is narrow and deliberately awkward to widen.

- A **dev-tier** model key already exists outside the repository (gitignored, its own small periodic cap,
  `docs/PFOS_SECRETS_PLAN.md` §4). It is not a production secret and its blast radius is about one
  currency unit per period.
- The **Phase-1 benchmark** may make live calls **from the developer machine only**, using the **dev**
  key, on the **sanitized** eval set, never against real financial or journal data. These are the
  **single** permitted network exception, and only to produce the eligibility registry.
- If the dev key is **absent or exhausted**, the harness runs against **recorded fixtures** and marks the
  registry `provisional: true` (task 6.2).
- **A provisional registry may never promote a model for live routing** (**R18**, contract 12 T32/T33).
  Absence of a provisional flag is not read as "not provisional"; a missing, unparseable, or unmarked
  registry fails closed.

Therefore the carve-out does **not** release **G4**. G4 remains the gate for live routing, because live
routing needs a production key with a provider-side cap, and the dev key is neither. The carve-out buys
one artifact - the registry - and nothing else.

If the benchmark ends up running against fixtures, record that fact here when the status is next
updated: "registry provisional as of `<DATE>` - dev key absent or exhausted; live routing still gated on
G4".

### Recorded observation - registry is PROVISIONAL as of 2026-08-07

**Status: BLOCKED - awaiting human**

Spec task 6.3 ran its pre-flight determination and did **not** make a live call. The eligibility
registry therefore remains the fixture-backed, `provisional: true` document emitted by task 6.2, and
live routing is still gated on **G4**.

**Correction to the sentence above, which the register should carry rather than hide.** The carve-out is
written as a binary - the dev key is either present and usable, or "absent or exhausted". There is a
**third** state, and it is the one this deployment is actually in: the dev key is *present*, the run is
*affordable*, and the run is still impossible. Three of the four preconditions hold and a fourth, which
the carve-out never names, does not:

| Precondition | Held? | Observation (no value recorded) |
|---|---|---|
| Dev credential present and non-empty | **yes** | file present, non-empty; existence checked only, never read |
| Estimated run cost strictly below the stated ceiling | **yes** | estimate is about a third of the ceiling for both models over the whole eval set |
| Run scoped to the default-allowed model pair only | **yes** | premium models refused by a gate with no opt-in parameter |
| Eval set passes its completeness and sanitization audits | **yes** | both task 6.1 gates green |
| **An environment entry resolves the model provider base URL** | **NO** | no such entry exists in the developer environment, in any form |

The fourth line is the one that closed the branch. `OpenRouterPortConfig` (spec task 2.1) states the
rule it rests on - "there is no default endpoint" - so the base URL arrives as the NAME of an
environment entry and an unresolved name fails closed. Resolving `<MODEL_API_BASE>` is an **operator**
step by this register's own placeholder glossary, so an agent supplying it would be manufacturing the
precondition rather than finding it satisfied, which is gate discipline rule 4.

Nothing was weakened to reach this outcome and nothing was invented to avoid it. The refusal is a typed
one that a test drives in both directions.

### The blocked item - task 6.3's live benchmark run

**Status: BLOCKED - awaiting human**

#### Why a human is required

Two reasons, and the second is the one that cannot be delegated:

1. The provider base URL must be resolved from the provider's published API documentation and placed in
   the developer environment. Per the glossary above, that resolution belongs to the operator.
2. The run **spends the owner's money**. The pre-flight estimate is about one third of the dev key's
   whole periodic allowance for a single pass over both models, and the remaining allowance for the
   current period cannot be determined without a network call - so "within its cap" is not fully
   answerable offline. A spend of that size, on a model roster no offline check can confirm still
   exists at the provider, is a decision for whoever owns the money.

#### Precondition that was not met

The environment entry naming the model provider base URL is absent. There is no default and no fallback.

#### Steps (human operator, on the developer machine only - never on the host)

1. Resolve `<MODEL_API_BASE>` from the provider's published API documentation.
2. Place it, and a reference to the existing dev credential, in the **developer** environment - never in
   a tracked file, and never in the host secret store (this is the dev tier, per
   `docs/PFOS_SECRETS_PLAN.md` §4):
   ```
   # developer environment only, git-ignored
   NIZAM_BENCH_MODEL_API_BASE=<MODEL_API_BASE>
   NIZAM_BENCH_DEV_KEY_FILE=<DEV_CREDENTIAL_FILE>
   ```
3. Confirm the roster the frozen pricing snapshot names still exists at the provider, since contract 09
   puts live model metadata first in its source precedence. A model absent from the provider cannot be
   graded, and grading a substitute under the requested name is refused by the adapter.
4. Supply the one artifact this repository deliberately does **not** contain: a transport that performs
   the request. The live adapter holds no request function, no request module and no scheme literal -
   asserted by a test - so the network capability is injected at the moment of the run and exists
   nowhere in the repository. Its only privileged act is to read the credential through the single named
   chokepoint while building the authorization header.
5. Run the two default-allowed models over the sanitized eval set, from the developer machine, once.
   Do **not** retry a refusal in a loop: the adapter stops on the first non-success status, and a
   partial run must fall back to the fixture path rather than emit a half-measured registry.
6. Emit the registry through the witnessed path. A run that did not answer every case cannot produce a
   non-provisional document, and there is no flag that overrides that.

#### VERIFICATION

```
# 1. the pre-flight gate, which spends nothing
#    -> reports the estimate and the ceiling side by side, and refuses unless strictly below
# 2. after the run, on the emitted document:
#    -> "provisional": false, and one entry per graded model
#    -> the entry count equals the number of models actually run, never more
#    -> every entry's "developerBuild" is false (see below - this is correct, not a fault)
# 3. the actual reported spend is recorded, and is at or below the pre-flight estimate
# 4. the negative: re-run the emission with one case removed from a model's answers
#    -> it must REFUSE, not emit
```
Record only the observation - "registry measured as of `<DATE>`, N models graded, actual spend within
estimate" - never the credential, never the endpoint.

#### What clearing this does NOT do

It does not release **G4**, and it does not make contract 10's **T4** tier routable. Contract 09 grades
developer/build work "based on code benchmark and repository tests, **separate from live finance
eligibility**", so a run over the FINANCE eval set leaves the developer verdict `unmeasured` - which
`developerBuildPasses` answers `false` for, by design. A fully measured registry still has
`developerBuild: false` on every entry, and `T4` still resolves to no eligible model. That is contract
09 being honoured, not a gap; making T4 routable needs a code benchmark, which is a separate exercise
against a separate corpus.

#### Already built and waiting

All of it except step 4. The pre-flight estimate and its two gates, the live adapter with its
developer-machine capability and its non-printable credential holder, the response reader that fails
closed on a bad status, a missing usage block, a non-integer cost and a substituted model, the grader
that refuses an unanswered case instead of scoring it correct, and the witnessed emission that produces
`provisional: false` only downstream of a complete run. Every one of those runs today, under test,
against an in-memory transport - with no key, no endpoint and no network.

---

## What an agent may write in this file

Only: a `Status:` of `BLOCKED - awaiting human`, an added or corrected step, a corrected verification
line, or a recorded observation that contains no value. An agent may **not** mark a gate satisfied, may
not remove a gate, may not soften a verification line, and may not add a placeholder that resolves to
anything real.
