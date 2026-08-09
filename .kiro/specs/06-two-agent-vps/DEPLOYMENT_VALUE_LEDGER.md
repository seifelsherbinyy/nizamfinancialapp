# Deployment value ledger - every entry, every crossing that must not happen, and what is mechanically checked

> **Task:** 10.4 of `.kiro/specs/06-two-agent-vps/tasks.md`. **Authority:** `KIRO_SHIP_LIVE.prompt.md`
> §4, which sets four rules this document must satisfy, and §3, whose placement map it records.
> **Extends:** `TELEGRAM_VALUE_LEDGER.md`, whose 14 transport entries become **62 entry-to-file
> assignments over 45 distinct entries across all six services** here. Same table shape, wider
> coverage.
>
> **This is a reference ledger, not a task edit.** It renumbers no gate, ticks no box, softens no
> verification line, edits no template, and carries no deployment particular (R24): every value is an
> `<ANGLE_BRACKET>` placeholder. The owner's one-pass worksheet is a **different document** -
> `OWNER_FILL_IN_SHEET.md` - because it answers a different question for a different reader.

## Source of truth, in precedence order

An agent reading this file re-derives rather than trusts. If any row disagrees with these, **they win
and this file is the bug**:

1. The six `ops/env/*.env.example` templates - the entry names, and each entry's own `what:`,
   `gate:` and `secret:` annotation.
2. `src/server/ops/envTemplates.ts` - `ENTRY_SPECS` declares every entry's owning template(s), gate
   and secrecy, and `CODE_BINDINGS` binds each entry a code path resolves to the field that resolves
   it. Read **gates and secrecy** from here.
3. `src/server/config/environment.ts` - `SERVICE_ENTRY_NAMES` (the six groups),
   `SHARED_ENTRY_AGREEMENTS`, `KILL_SENTINEL_ENTRY`, `KILL_SENTINEL_MOUNT_TARGET`,
   `KILL_SENTINEL_SERVICES`, `ABSENCE_IS_A_DECISION`. Read **entry names and the cross-file rules**
   from here.
4. `ops/GATE_REGISTER.md` - what a gate requires and how it is verified. On gate verification it
   outranks everything below it and this document.
5. `ops/docker-compose.yml` - the `env_file` per service, the mounts and their modes, the one
   published port.
6. `ops/backup/backup.sh` and `ops/restore/restore.sh` - a **third** consumer of these entries, and
   the one whose disagreements are recorded in §7 rather than assumed away.

## 0. Counts, so a later reader can tell whether this ledger still covers the deployment

| Service | Env file | Entries | Notes |
|---|---|---|---|
| `life-agent` | `life.env` | **19** | the largest file; the only one holding a recovery credential |
| `finance-agent` | `finance.env` | **17** | this repository's agent, and the only process phase 1 runs |
| `caddy` | `proxy.env` | **6** | entirely deferred in phase 1; the service stays down |
| `signalbus` | `bus.env` | **3** | the narrowest file, and it holds no credential of any kind |
| `scheduler` | `scheduler.env` | **5** | a clock; two of the five are the halt |
| `backup` | `backup.env` | **12** | the public recipient key is here, the private half never is |
| **total** | six files | **62 assignments / 45 distinct entries** | 13 entries appear in more than one file |

`ENTRY_SPECS` and `SERVICE_ENTRY_NAMES` agree on all 45 and all 62, in both directions, and both are
asserted equal to the templates set-for-set by test - `envTemplates.test.ts` against `ENTRY_SPECS`,
`environmentServices.test.ts` against `SERVICE_ENTRY_NAMES`. **`MAX_CONNECTIONS` is in none of the
three** (§6).

## 1. Every entry has no default. This is the invariant, not a per-row note

**An unset entry is a startup failure, not a guess.** Asserted once here rather than repeated 62
times, because it holds for every row without exception:

- Every entry in a service's group that is **absent**, **blank**, or **still holding its
  `<ANGLE_BRACKET>` placeholder** produces a finding from `classifyEntry`, and
  `collectServiceFindings` collects them all before `refuseOnFindings` throws. There is no fallback
  endpoint, no fallback mode, no fallback bound, and no fallback allowlist.
- **The refusal names every missing entry at once** (R27). A first-failure error would make an
  operator with four unfilled entries restart four times to learn four names.
- **The one documented exception is about absence only.** `ABSENCE_IS_A_DECISION` contains exactly
  `ALLOWED_USER_IDS`: absent, empty or whitespace-only parses to an **empty list**, under which
  `senderIsAllowlisted` refuses **every** sender including the owner. So the unconfigured case is
  already closed and refusing the boot as well would refuse a configuration meaning "nobody". An
  **unfilled placeholder is still a finding** there, because that is a template nobody completed
  rather than a list somebody emptied (R25).

## 2. `finance.env` - 17 entries

| Entry | Gate | Secret | Belongs in | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `FINANCE_DATA_DIR` | G1 | no | finance only | the directory G1 creates for this agent's own volume | `grep -c '^FINANCE_DATA_DIR=' <FINANCE_ENV_PATH>` -> 1; and 0 in the life file |
| `FINANCE_STORE_FILE` | operator | no | finance only | operator choice of store file name | 1 in the finance file |
| `STORE_BUSY_TIMEOUT_MS` | operator | no | life **and** finance | operator choice, per process. **Not** forced equal - §5 | 1 in each agent file |
| `FINANCE_CONTAINER_PORT` | operator | no | proxy **and** finance | operator choice, **equal in both** | present in both, **and equal** |
| `BOT_B_TOKEN` | G3 | **yes** | finance only | the second bot's token from the provider's creation flow | 1 in finance; **0** in life and proxy |
| `MONEY_WEBHOOK_SECRET` | G6 | **yes** | finance only | generated **on the host**, 1-256 chars of `A-Za-z0-9_-` | 1 in finance; **0** in proxy |
| `ALLOWED_USER_IDS` | G3 | no | life **and** finance | the owner's own account identifier, bare digits (R25) | 1 in **each** agent file |
| `MSG_API_BASE` | operator | no | life **and** finance | the messaging provider's documented base; must be `https://` | 1 in each agent file, **and equal** |
| `TELEGRAM_MODE` | operator | no | life **and** finance | `webhook` or `longPoll`, exactly as the port spells it | 1 in each; **deliberately not equal** - §5 |
| `MAX_WORK_ITEMS` | operator | no | life **and** finance | a small positive integer; zero is refused | 1 in each; **not** forced equal - §5 |
| `OR_KEY_FINANCE` | G4 | **yes** | finance only | the key G4 mints for **this agent alone** | 1 in finance; **0** in life |
| `MODEL_API_BASE` | operator | no | life **and** finance | the model provider's documented base | 1 in each, **and equal** |
| `FINANCE_WEEKLY_CAP` | G4 | no | finance only | D-CAP's per-agent half, **in micro-USD integer** - see F13 | 1 in finance; **0** in life |
| `MODEL_ELIGIBILITY_REGISTRY_PATH` | build | no | life **and** finance | the path the build emits the registry to | 1 in each, **and equal** |
| `BUS_INTERNAL_ENDPOINT` | operator | no | bus, life **and** finance | the internal address the bus binds | 1 in each of the three, **and equal** |
| `KILL_SENTINEL_PATH` | G1 | no | the four honourers | a path inside the halt mount - §4 | 1 in each of four, **all identical** |
| `NIZAM_KILL_ALL` | operator | no | the four honourers | `1` halts, `0` does not; restart-scoped | 1 in each of four |

## 3. `life.env` (19), `proxy.env` (6), `bus.env` (3), `scheduler.env` (5), `backup.env` (12)

Rows that repeat a `finance.env` row above are named rather than restated.

| Entry | Gate | Secret | Belongs in | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `LIFE_DATA_DIR` | G1 | no | life only | the directory G1 creates for the life volume | 1 in life; **0** in finance |
| `LIFE_STORE_FILE` | operator | no | life only | operator choice | 1 in life |
| `LIFE_CONTAINER_PORT` | operator | no | proxy **and** life | operator choice, **equal in both** | present in both, **and equal** |
| `BOT_A_TOKEN` | G3 | **yes** | life only | the first bot's token | 1 in life; **0** in finance and proxy |
| `LIFE_WEBHOOK_SECRET` | G6 | **yes** | life only | generated on the host, same character set | 1 in life; **0** in proxy |
| `OR_KEY_LIFE` | G4 | **yes** | life only | the other key G4 mints | 1 in life; **0** in finance |
| `LIFE_WEEKLY_CAP` | G4 | no | life only | D-CAP's other half, same unit - F13 | 1 in life; **0** in finance |
| `WHOOP_API_BASE` | operator | no | life only | the recovery provider's documented base | 1 in life; **0** in finance |
| `WHOOP_ACCESS_TOKEN` | operator | **yes** | life only | the recovery provider credential. A **band** reaches finance over the bus; a provider call never does | 1 in life; **0** in finance |
| `DOMAIN` | G2 | no | proxy only | the DNS zone; the two site addresses derive from it | 1 in proxy |
| `ACME_CONTACT` | operator | no | proxy only | the address the certificate authority registers for expiry notices | 1 in proxy |
| `LIFE_WEBHOOK_PATH` | G6 | **yes** | proxy only | a high-entropy segment generated on the host; **not** the bot token | 1 in proxy; **0** in both agent files |
| `MONEY_WEBHOOK_PATH` | G6 | **yes** | proxy only | the same, generated separately | 1 in proxy; **0** in both agent files |
| `SIGNALS_DATA_DIR` | G1 | no | bus only | the directory G1 creates for the append-only store and its audit mirror | 1 in bus |
| `SIGNALS_STORE_FILE` | operator | no | bus only | operator choice | 1 in bus |
| `LIFE_TICK_ENDPOINT` | operator | no | scheduler only | the internal address the life agent accepts a tick on | 1 in scheduler |
| `FINANCE_TICK_ENDPOINT` | operator | no | scheduler only | the internal address the finance agent accepts a tick on | 1 in scheduler |
| `SCHEDULER_TICK_INTERVAL` | operator | no | scheduler only | operator choice of cadence | 1 in scheduler |
| `BACKUP_WORK_DIR` | G1 | no | backup only | the scratch directory G1 creates. Never a store, never retained | 1 in backup |
| `BACKUP_SCHEDULE` | operator | no | backup only | operator choice; the recovery objective is stated in terms of it | 1 in backup. **Read by neither script** - F15 |
| `AGE_PUBLIC_KEY` | G8 | no | backup only | the **public** half of the G8 keypair | 1 in backup. And **0** hits for private key material anywhere on the host - that empty output is G8's gate |
| `BACKUP_ENCRYPTION_SCHEME` | operator | no | backup only | the tool of record or its one documented fallback; `backup.sh` refuses anything else | 1 in backup |
| `BACKUP_RETAIN_COUNT` | operator | no | backup only | how many artifacts are kept before the oldest is dropped | 1 in backup |
| `BACKUP_FOLDER_REF` | G5 | no | backup only | **the folder the uploader creates on first run** (D-G5). The per-file grant reaches only what the application created, so a hand-made folder is unreachable | 1 in backup |
| `DRIVE_REFRESH_TOKEN` | G5 | **yes** | backup only | the long-lived grant, from a consent screen published to **production** (D-G5) | 1 in backup; **0** in every other file |
| `GOOGLE_CLIENT_ID` | G5 | no | backup only | the client identifier the grant was issued to | 1 in backup |
| `GOOGLE_CLIENT_SECRET` | G5 | **yes** | backup only | the client credential the grant was issued with | 1 in backup; **0** in every other file |
| `STORAGE_TOKEN_URL` | operator | no | backup only | the storage provider's documented token endpoint | 1 in backup |

## 4. Negative rows. Each is a `grep -c` returning 0, and they matter as much as §2 and §3

The mandate names four crossings that must not happen. They are one rule, not four:
`collectForeignEntryFindings` reports any entry present in one service's environment that **another**
service declares and this one does not. All four fall out of it, and so does every future one.

```
grep -c 'OR_KEY_FINANCE\|FINANCE_WEEKLY_CAP\|BOT_B_TOKEN\|MONEY_WEBHOOK_SECRET' <LIFE_ENV_PATH>     # -> 0
grep -c 'OR_KEY_LIFE\|LIFE_WEEKLY_CAP\|BOT_A_TOKEN\|LIFE_WEBHOOK_SECRET'        <FINANCE_ENV_PATH>  # -> 0
grep -c 'WHOOP_ACCESS_TOKEN\|DRIVE_REFRESH_TOKEN\|GOOGLE_CLIENT_SECRET'         <FINANCE_ENV_PATH>  # -> 0
grep -c 'BOT_._TOKEN'                                                           <PROXY_ENV_PATH>    # -> 0
grep -c 'WEBHOOK_SECRET'                                                        <PROXY_ENV_PATH>    # -> 0
grep -c 'WEBHOOK_PATH'                       <LIFE_ENV_PATH> <FINANCE_ENV_PATH>                     # -> 0 in each
```

Five assertions, in the order the mandate states them:

1. **The life file contains no finance secret.** Line 1. This is also gate G4's own negative
   verification line, run in both directions.
2. **The finance file contains no life secret and no recovery credential.** Lines 2 and 3. The
   recovery half is the interesting one: a recovery **band** reaches the finance agent over the
   consent bus, so there is no provider call for it to make and therefore no credential to hold.
3. **The proxy file contains no bot token and no webhook secret.** Lines 4 and 5. The proxy passes
   the provider's secret-token header through untouched; a proxy that held the value **could compare
   it**, and the constant-time comparison R11 requires would then exist somewhere no test covers.
4. **Neither agent file contains a webhook path.** Line 6. Routing by the segment is the proxy's own
   job and neither agent ever needs to know its own.

**The split runs in opposite directions for the two G6 value kinds, and that is deliberate:** the
**paths** live in the proxy because routing is its job; the **secret tokens** live in the agents
because the comparison is theirs.

**Why the halt volume has no negative row:** `proxy.env` and `bus.env` carrying `KILL_SENTINEL_PATH`
or `NIZAM_KILL_ALL` is already a finding - `KILL_SWITCH_ENTRY_UNEXPECTED` in
`auditEnvTemplates`, keyed off the four services `ops/docker-compose.yml` actually mounts the
sentinel into. A halt entry in a service that writes nothing would imply a writer that does not
exist.

## 5. Shared entries must be equal where shared - and the exclusions are the interesting half

`SHARED_ENTRY_AGREEMENTS` is the full set, and `collectSharedEntryDisagreements` is what checks it.
A per-service loader cannot see any of these, because each service reads one file: **two files can
each be individually valid and still disagree**, silently at boot and expensively later.

| Entry | Must be equal across | Why, and what a disagreement costs |
|---|---|---|
| `LIFE_CONTAINER_PORT` | proxy, life | the proxy's upstream port and the port the life agent binds. Disagree and **every delivery aborts at the proxy** |
| `FINANCE_CONTAINER_PORT` | proxy, finance | the same, for the finance agent |
| `ALLOWED_USER_IDS` | life, finance | the same single operator on both bots. In one file and not the other is a deployment that **refuses the owner on one bot and has no list on the other** |
| `KILL_SENTINEL_PATH` | life, finance, scheduler, backup | §4 below. A typo in one of the four is a halt that **silently does nothing in that service** |
| `BUS_INTERNAL_ENDPOINT` | bus, life, finance | where the bus listens and where its only two clients dial. A client dialling elsewhere **reaches nothing** |
| `MODEL_ELIGIBILITY_REGISTRY_PATH` | life, finance | one registry document gates both agents. Two paths would let **one agent route on evidence the other rejected** |
| `MSG_API_BASE` | life, finance | the messaging provider's published base, identical for every user of it |
| `MODEL_API_BASE` | life, finance | the model provider's published base. The **keys** are what differ, and those are per agent |

**The deliberate exclusions, with their reasons. These are shared entries that must NOT be forced
equal:**

- **`TELEGRAM_MODE` must not be equal.** Phase 1 runs the finance agent on `longPoll` while the life
  agent idles under mandate §7 option (b). Forcing agreement would **refuse the phasing the owner
  chose**, and when the life agent follows there is no reason the two must flip modes together.
- **`MAX_WORK_ITEMS` is a per-process capacity choice.** Each agent bounds its own worker
  concurrency; a shared value would make one agent's load shape the other's.
- **`STORE_BUSY_TIMEOUT_MS` is a per-process capacity choice.** One writer per store, so each agent
  legitimately picks its own lock wait.

An exclusion is not an oversight, which is why each is recorded in `SHARED_ENTRY_AGREEMENTS`' own
doc comment beside the rules rather than only here.

## 6. The kill sentinel, and `MAX_CONNECTIONS`

### 6.1 `KILL_SENTINEL_PATH` - identical in all four, and inside the mount

`ops/docker-compose.yml` mounts the `kill-switch` volume at **`/run/nizam-kill`**, **`:ro`**, into
exactly `life-agent`, `finance-agent`, `scheduler` and `backup`. The proxy has none, because it
writes nothing and calls no model. Held as `KILL_SENTINEL_MOUNT_TARGET` and `KILL_SENTINEL_SERVICES`
and asserted against the topology by test, so a change in compose is a failing test rather than a
check that quietly stops applying.

Two properties, both checked by `collectKillSentinelFindings`:

1. **The value resolves inside the mount.** A path outside it names a file **the operator's halt
   never creates**, so the sentinel check reads an absence for ever. **That is a kill switch that
   silently does nothing** - it looks configured, it passes a completeness check, and it fails only
   at the moment it is needed.
2. **It cannot climb out.** A `..` segment is refused for the same reason it is refused anywhere
   else: a path that can climb out of the mount is a path that does.

The **identical-in-all-four** half is `SHARED_ENTRY_AGREEMENTS`' row, checked by
`collectSharedEntryDisagreements`. Both halves are needed: four paths that agree with each other and
sit outside the mount are four halts that do nothing, and four paths inside the mount that disagree
are a halt that reaches some writers and not others. **A halt that reaches only some writers is not a
halt.**

Read-only in every consumer is the third property, and it is topology rather than configuration:
every service can **see** the halt and none can **clear** it. Only the operator does.

### 6.2 `MAX_CONNECTIONS` has no home, and this ledger does not invent one (finding F2)

**Where it is today.** It is an argument to the G6 `setWebhook` registration command and it appears
in G6's own verification line, where `getWebhookInfo` is expected to echo it back. It is in **no**
environment template, **not** in `ENTRY_SPECS`, **not** in `CODE_BINDINGS`, and **not** in any
`SERVICE_ENTRY_NAMES` group - and a test asserts that last absence, so it cannot drift in unnoticed.

**Why it is irrelevant in phase 1.** Phase 1 ships on `longPoll`. In that mode the provider
**delivers nothing** - the agent fetches - so there is no delivery concurrency for the value to
bound. It is not merely unused; it has no referent.

**The consequence that makes it a finding rather than a curiosity.** After a host rebuild, G6's
verification line cannot be re-run against the value that was actually set, because nothing on the
host records it. The interim mitigation is the untracked worksheet, which does not survive a rebuild
either.

**Its home in phase 2, recorded as a recommendation for the task that owns the change:** an
**operator-gated entry in `proxy.env`**. Three reasons. `proxy.env` is already the file whose entire
contents are the phase-2 webhook surface, and it already carries the other two G6-gated entries.
G6 is run from the host by the operator with values sourced from that file, so the registration
command and the recorded value would read from one place. And the proxy is the service whose
availability the number describes, so no agent acquires a value it does not use.

**The alternative and why it is worse:** leaving it a G6-command-only value. That is the status quo,
and it is exactly what makes the verification unrepeatable after a rebuild.

**Nothing is applied by this document.** No template was edited, no entry added to `ENTRY_SPECS` or
`SERVICE_ENTRY_NAMES`, and `ops/GATE_REGISTER.md` was not touched. The change belongs to the phase-2
increment that closes **F12** alongside it, because both are port-and-registration facts that must
agree with the firewall.

## 7. Findings - the disagreements re-reading the six sources turned up

**F13 - one cap entry, two units, and both are individually correct.** `FINANCE_WEEKLY_CAP` and
`LIFE_WEEKLY_CAP` are read by `loadAgentModelBinding` as `weeklyCapMicroUsd`: a **bare run of digits
in the spend ledger's micro-USD accounting unit**, where a decimal is **refused rather than rounded**
because there is no floating-point money in this repository. `ops/GATE_REGISTER.md` G4 step 3
interpolates the **same placeholder** into the provider's key-creation body as `"limit":
<FINANCE_WEEKLY_CAP>`, where the provider's field takes a decimal amount. D-CAP's per-agent figure
therefore cannot satisfy both spellings of one name. Neither artifact is wrong on its own; the
collision is that one placeholder serves two units. **Owner:** task 10.10, which adds the per-agent
cap companion and is the right place to decide whether the register's command grows a second
placeholder or the conversion is stated at the step. `OWNER_FILL_IN_SHEET.md` carries the conversion
in the meantime so the owner does not type a decimal into an entry that refuses one. **The register
was not edited** - this task must not, and the register outranks this document on gate verification.

**F14 - `restore.sh` requires five entries no template declares.** Its `REQUIRED_ENTRIES` names
`RESTORE_ARTIFACT`, `RESTORE_TARGET_DIR`, `EXPECTED_ARTIFACT_SIZE`, `EXPECTED_ARTIFACT_DIGEST` and
`AGE_IDENTITY_FILE`; only `BACKUP_ENCRYPTION_SCHEME` overlaps `backup.env`. **This is correct and
must stay correct**, and it is recorded because a reader counting entries would otherwise think six
were missing: restore runs **on the operator machine**, not in the deployment, and
`AGE_IDENTITY_FILE` is a **path to the off-host private half**, which the placement map (§8) forbids
from ever reaching the host. Adding these five to any template would put the recovery key's location
into the file set a host compromise yields. **No owner - it is a reconciliation, not a defect.** What
it does imply is that the six templates are **not** the whole configuration surface of this
repository, and any future statement that they are is wrong.

**F15 - `backup.sh` asserts six of `backup.env`'s twelve entries.** `REQUIRED_ENTRIES` covers
`BACKUP_WORK_DIR`, `AGE_PUBLIC_KEY`, `BACKUP_ENCRYPTION_SCHEME`, `BACKUP_RETAIN_COUNT`,
`KILL_SENTINEL_PATH` and `NIZAM_KILL_ALL`. The six it does not assert split two ways. Five are the
storage credentials plus `BACKUP_FOLDER_REF`, and the script is **deliberate** about them: it names
no credential entry at all, because the `nizam-backup` uploader resolves them from its own
environment. `BACKUP_SCHEDULE` is read by whatever invokes the script, not by the script. **The
residual gap:** the uploader entry point does not exist yet (**O1**), so **nothing today asserts
those five are present and non-empty before an upload is attempted** - the script's own fail-closed
posture stops at its own boundary. **Owner:** task 10.8 builds the uploader image, and 10.9 wires
these scripts; the uploader must carry the same present-and-non-empty assertion over its six, or
`requireServiceEnvironment('backup', …)` must be called before the run.

**No disagreement was found between `ENTRY_SPECS`, `SERVICE_ENTRY_NAMES` and the six templates.**
All three carry the same 45 entries and the same 62 assignments, and both directions are asserted by
test. Task 10.2's report that both sources of entry truth exist without either being named the
authority is resolved by this ledger's precedence list in the header: **secrecy and gate from
`ENTRY_SPECS`, entry names and cross-file rules from `SERVICE_ENTRY_NAMES`**, and the templates above
both.

## 8. The placement map - three destinations, three different payloads (mandate §3)

Conflating them is how a public repository ends up holding a bot token.

| Destination | What lives there | What must never |
|---|---|---|
| **GitHub** (public, this repository) | all source, contracts, specs, `.kiro/**`; the `ops/**` templates, `Caddyfile`, `docker-compose.yml`, runbooks, `backup.sh`, `restore.sh`; docs, Dockerfiles, the eligibility registry | any token, key, refresh token or secret; any **filled-in** `ops/env/*.env`; any domain, address, zone identifier, numeric identifier or bot name (R24); `.secrets/**`; `outputs/**` |
| **The host** (the only place the deployment runs) | the six env files at `/etc/<CONFIG_DIR>/{life,finance,proxy,bus,scheduler,backup}.env`, `root:root`, `600`, **one service each, read by no other**; the three stores in their own volumes; the halt sentinel; the backup scratch; the proxy state and config; a `git clone` of the repository, updated by **`git pull`** | the `age` **private** key; a copy of the laptop's working tree (a copy carries what is gitignored, which a pull cannot) |
| **The off-host storage** (the backup copy, and nothing else) | **`age`-encrypted** snapshot artifacts, one per store, inside `BACKUP_FOLDER_REF`, at most `BACKUP_RETAIN_COUNT` of them, written under the per-file scope only | any plaintext store, ever; any environment file, plaintext or encrypted; the `age` **private** key; any credential or token; the repository itself |
| **The laptop** | `.secrets/**`, `outputs/**` | nothing from here is copied up. Values are **typed** into `/etc/<CONFIG_DIR>` over the admin session, never appended from a shell whose history is kept |

### 8.1 The ordering rule is the security property

**Encrypt, then upload, then shred the scratch copy. Never upload first and encrypt later.**
`BACKUP_ENCRYPTION_SCHEME` names the tool and `AGE_PUBLIC_KEY` is the recipient. `backup.sh`
implements the sequence per store - snapshot, integrity-check, encrypt, shred, verified upload - with
the shred registered on **exit** so it covers the failure and interrupt paths and not only the happy
one, and **retention last**, because a prune that ran before a failed upload could drop the archive
that was still the newest good one.

An upload that is not verified is not a backup: the size and digest are measured locally first and the
uploader must answer that the remote copy matches **both**.

### 8.2 The `age` private key reaches none of the three destinations

Not GitHub, not the host, not the storage. It lives in the owner's password manager plus one offline
copy. **Only `AGE_PUBLIC_KEY` reaches the host**, in `backup.env`. That is what makes "this host
creates a backup it cannot read" true rather than merely stated: a host compromise yields ciphertext.
G8's verification is that a search of the host for private key material returns **nothing**, and the
empty output is the gate. A private key in the backup path would void the guarantee **retroactively,
for every archive ever taken** - and a backup stored beside the key that opens it is not a backup.

## 9. What is mechanically checked, and what is not

Cited by function name so the document and the code cannot drift apart.

| Rule in this ledger | Checked by | Where |
|---|---|---|
| No entry has a default; absent / blank / unfilled refuses | `classifyEntry`, `collectServiceFindings` | `src/server/config/environment.ts` |
| Every missing entry named in one message (R27) | `refuseOnFindings`, `EnvConfigAggregateError` | same |
| Shared entries equal where shared (§5) | `collectSharedEntryDisagreements` over `SHARED_ENTRY_AGREEMENTS` | same |
| Sentinel inside the mount, no climb (§6.1) | `collectKillSentinelFindings` with `KILL_SENTINEL_MOUNT_TARGET` | same |
| Negative rows: no service holds another's entry (§4) | `collectForeignEntryFindings` | same |
| Entry names equal the six templates, both directions | `environmentServices.test.ts` | test |
| Gate and secrecy equal the templates' annotations, both directions | `auditEnvTemplates` over `ENTRY_SPECS` | `src/server/ops/envTemplates.ts` |
| A halt entry only in the four mounting services | `auditEnvTemplates` (`KILL_SWITCH_ENTRY_UNEXPECTED`) | same |
| Every value in a template is an `<ANGLE_BRACKET>` placeholder | `auditEnvTemplates`, `scanForParticulars` | same, and AC18 |
| No deployment particular in `ops/**` or any fixture | `scripts/verify/no-deployment-particular.mjs` (AC18) | harness |
| `MAX_CONNECTIONS` is in no service's entry set | `environmentServices.test.ts` | test |

### Not yet mechanical - stated plainly rather than implied to be enforced

1. **Nothing checks the six env files as they exist on the host.** Every check above runs over the
   **templates** and over an **injected** `EnvSource`. The `grep -c` proofs in §2, §3 and §4 are
   commands for a human on the host; no harness check runs them, because the harness has no host.
2. **`KILL_SENTINEL_PATH` identical in all four is checked only when all four environments are
   handed in together.** `collectSharedEntryDisagreements` skips a rule with fewer than two holders,
   which is correct for the phasing - phase 1 runs one agent - but it means the four-way agreement is
   **not** asserted in phase 1.
3. **The ordering rule in §8.1 is not asserted by a test.** `backup.sh` implements it and no checker
   reads the script's step order. Ladder rung **L5** is the observation that would prove it, and it
   is `BLOCKED - awaiting human` on G5 and G8.
4. **Nothing asserts the private key is absent from the host or the storage.** That is G8's
   verification line, run by a human, and the empty output is the gate.
5. **F15's gap is open:** no code asserts the five storage entries are present before an upload.
6. **F13 is unresolved.** The two units coexist; the owner of the decision is task 10.10.
7. **`MAX_CONNECTIONS` has no home and none was created here** (§6.2). The recommendation is
   recorded; nothing applies it.
8. **`BACKUP_FOLDER_REF` cannot be validated before the first uploader run**, by construction: the
   value is what that run reports (D-G5).

## 10. What this ledger did not do

No value was obtained, read, generated or placed. No gate was attempted, no checkbox ticked, and
`ops/GATE_REGISTER.md` was not edited - G7 stays **CLOSED - WONT-DO**. No template under `ops/env/`
was changed, no entry was added to `ENTRY_SPECS` or `SERVICE_ENTRY_NAMES`, and no outbound call was
made: nothing was registered, resolved, published or uploaded. The other repository was not touched.
