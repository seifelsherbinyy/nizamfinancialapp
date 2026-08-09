# Owner fill-in sheet - every value you supply, once, in one pass

> **Task:** 10.3 of `.kiro/specs/06-two-agent-vps/tasks.md`. **Authority:** `KIRO_SHIP_LIVE.prompt.md`
> §8 step 3 - "every entry the owner must supply, grouped by env file, each with its gate, its
> `secret` flag, and its proof command. One pass, not six round trips."
>
> **This is a worksheet, not a task edit.** It renumbers no gate, ticks no box, softens no
> verification line, and carries no deployment particular (R24): every value below is an
> `<ANGLE_BRACKET>` placeholder. `ops/GATE_REGISTER.md` remains the authority on what a gate
> requires and how it is verified - where a proof command here disagrees with the register's own
> verification block, **the register wins and this sheet is the bug**.

## Read this before you type anything

**Where the values go.** Each value is **typed** into `/etc/<CONFIG_DIR>/<service>.env` over the
administrative session, `root:root`, mode `600`, **one file per service and read by no other**
(mandate §3.2; contract 12 §3.2.7). `install -d -m 700 -o root -g root /etc/<CONFIG_DIR>` is a G1
step and it is what makes a place to put them exist, which is why **G1 comes before G3, G4, G5 and
G8** - each of those four ends by writing into that directory.

**Three things never happen.** A value is never **copied up** from the laptop, never **appended from
a shell whose history is kept**, and never **committed**. `.secrets/**` and `outputs/**` stay on the
laptop and reach neither the host, nor the off-host storage, nor the repository (mandate §3.4).

**Nothing has a default.** Every entry named below is required of its service: absent, blank, or
still holding its `<ANGLE_BRACKET>` placeholder is a **startup refusal**, not a guess
(`collectServiceFindings` in `src/server/config/environment.ts`). The one documented exception is
`ALLOWED_USER_IDS`, where **absence is a decision** meaning nobody and the guard then refuses every
sender including you - but an **unfilled placeholder is still a refusal**, because that is a template
nobody completed rather than a list somebody emptied (`ABSENCE_IS_A_DECISION`, R25).

**Proof reports a count, never a value.** Every proof command below is a `grep -c` returning `1`
(or `0` for the negatives). That is the only form R24 permits: it answers "did the value land" without
putting the value in a terminal, a log, a message or a report.

**Phase 1 is `longPoll` and it needs no domain.** Each entry below is marked with when it is needed:

| Marker | Meaning |
|---|---|
| **phase 1** | needed now, for the deployment that ships on `longPoll` |
| **phase 1 - fill, unused** | the loader requires it or the boot refuses, but nothing in `longPoll` reads it. Fill it; do not agonise over the value |
| **phase 2** | not needed until a domain exists. **Do not** be asked for it now, and do not invent one |

**Three rulings change what you type.** Carried here because they do:

- **D-CAP.** Your ceiling is a hard **USD 5.00 per week in total**, so G4 mints **two keys at 2.50
  each** and `LIFE_WEEKLY_CAP` / `FINANCE_WEEKLY_CAP` are **2.50 each**. **Mind the unit** - see the
  unit note under `finance.env` below, because the entry does not take a decimal.
- **D-G5.** The consent screen is published to **In production**, not left in Testing (a Testing
  screen issues a 7-day refresh token and the unattended uploader dies silently on day 8; the
  per-file scope is non-sensitive so publishing needs no review). And **`BACKUP_FOLDER_REF` is not a
  value you pick by hand** - see its row.
- **D-ROTATE.** **Nothing is rotated.** The tokens that already exist are the tokens this deployment
  uses. Rotation becomes the final acceptance test after you have used the thing and reported it
  working.

**Order.** Work the files top to bottom in the order they appear. It is gate order and phase order at
once: the finance agent is the one process phase 1 runs (option **(b)** of mandate §7), the bus and
the scheduler are what it talks to, the backup file is durability, and the last two files belong to
work that has not started.

---

## 1. `finance.env` -> `/etc/<CONFIG_DIR>/finance.env`

The agent this repository owns, and **the only agent running in phase 1**. Seventeen entries.

**THE UNIT NOTE, and it is the one place a wrong number boots successfully and then misbehaves.**
`FINANCE_WEEKLY_CAP` is read by `loadAgentModelBinding` as `weeklyCapMicroUsd` - **a bare run of
digits in the spend ledger's own micro-USD accounting unit**. A decimal is **refused rather than
rounded**, so `2.50` typed literally is a startup refusal. Convert: USD × `MICRO_USD_PER_USD` from
`src/features/routing/spendLedger.ts`. The same D-CAP figure appears in a **second** unit in G4's key
creation command, where the provider's own `limit` field takes the decimal - see finding **F13**
below, which is why this note is here rather than left to be discovered.

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `FINANCE_DATA_DIR` | G1 | no | phase 1 | the absolute directory you created for this agent's own volume; its store is mounted nowhere else | `grep -c '^FINANCE_DATA_DIR=' <FINANCE_ENV_PATH>` -> 1 |
| `FINANCE_STORE_FILE` | operator | no | phase 1 | your choice of store file name within that directory | `grep -c '^FINANCE_STORE_FILE=' <FINANCE_ENV_PATH>` -> 1 |
| `STORE_BUSY_TIMEOUT_MS` | operator | no | phase 1 | your choice, milliseconds a writer waits on the lock. **Per-process**, deliberately not forced equal to the life agent's | `grep -c '^STORE_BUSY_TIMEOUT_MS=' <FINANCE_ENV_PATH>` -> 1 |
| `FINANCE_CONTAINER_PORT` | operator | no | **phase 1 - fill, unused** | your choice. In `longPoll` this agent **binds no port at all**; the entry is still required or the boot refuses, and in phase 2 it must equal the proxy file's copy | `grep -c '^FINANCE_CONTAINER_PORT=' <FINANCE_ENV_PATH>` -> 1 |
| `BOT_B_TOKEN` | G3 | **yes** | phase 1 | the second bot's token, from the messaging provider's bot-creation conversation. **D-ROTATE: the existing token, not a new one** | `grep -c '^BOT_B_TOKEN=' <FINANCE_ENV_PATH>` -> 1 |
| `MONEY_WEBHOOK_SECRET` | G6 | **yes** | **phase 1 - fill, unused** | **you generate it on the host** - it is not issued by the provider and needs no domain. 1 to 256 characters from `A-Za-z0-9_-`. Its *use* is deferred with G6; the loader requires the entry today | `grep -c '^MONEY_WEBHOOK_SECRET=' <FINANCE_ENV_PATH>` -> 1 |
| `ALLOWED_USER_IDS` | G3 | no | phase 1 | your own account identifier, read from your own bot's updates. **Bare digits, no quotes, no brackets** (D-ALLOWLIST / R25) | `grep -c '^ALLOWED_USER_IDS=' <FINANCE_ENV_PATH>` -> 1 |
| `MSG_API_BASE` | operator | no | phase 1 | the messaging provider's documented bot API base, from its own documentation. Must begin `https://` or the loader refuses | `grep -c '^MSG_API_BASE=' <FINANCE_ENV_PATH>` -> 1 |
| `TELEGRAM_MODE` | operator | no | phase 1 | **`longPoll`**, spelled exactly as the port spells it. A case variant is not a member of the set | `grep -c '^TELEGRAM_MODE=' <FINANCE_ENV_PATH>` -> 1 |
| `MAX_WORK_ITEMS` | operator | no | phase 1 | a small positive integer; a single-operator system needs very little. Zero is refused - it is not a bound, it is a queue nothing drains | `grep -c '^MAX_WORK_ITEMS=' <FINANCE_ENV_PATH>` -> 1 |
| `OR_KEY_FINANCE` | G4 | **yes** | phase 1 | the model key minted for **this agent only**, with its own weekly provider-side limit | `grep -c '^OR_KEY_FINANCE=' <FINANCE_ENV_PATH>` -> 1 |
| `MODEL_API_BASE` | operator | no | phase 1 | the model provider's documented API base, from its own documentation | `grep -c '^MODEL_API_BASE=' <FINANCE_ENV_PATH>` -> 1 |
| `FINANCE_WEEKLY_CAP` | G4 | no | phase 1 | **D-CAP: 2.50, converted to the micro-USD integer** per the unit note above | `grep -c '^FINANCE_WEEKLY_CAP=' <FINANCE_ENV_PATH>` -> 1 |
| `MODEL_ELIGIBILITY_REGISTRY_PATH` | build | no | phase 1 | the path the build emits the registry to. It is **`provisional: true`** today and a provisional registry **refuses** live routing (R18) | `grep -c '^MODEL_ELIGIBILITY_REGISTRY_PATH=' <FINANCE_ENV_PATH>` -> 1 |
| `BUS_INTERNAL_ENDPOINT` | operator | no | phase 1 | your choice of internal-network address. **Must equal the bus file's copy**, or this client dials nothing | `grep -c '^BUS_INTERNAL_ENDPOINT=' <FINANCE_ENV_PATH>` -> 1 |
| `KILL_SENTINEL_PATH` | G1 | no | phase 1 | a path **inside** `/run/nizam-kill/`. **Identical in all four honouring files.** A path outside the mount is a kill switch that silently does nothing | `grep -c '^KILL_SENTINEL_PATH=' <FINANCE_ENV_PATH>` -> 1 |
| `NIZAM_KILL_ALL` | operator | no | phase 1 | the coarse halt: `1` halts, `0` does not. Restart-scoped, so it is not a panic stop | `grep -c '^NIZAM_KILL_ALL=' <FINANCE_ENV_PATH>` -> 1 |

**Negatives for this file, and they matter as much as the rows above:**

```
grep -c BOT_A_TOKEN     <FINANCE_ENV_PATH>   # -> 0   no life bot token
grep -c OR_KEY_LIFE     <FINANCE_ENV_PATH>   # -> 0   no life model key
grep -c LIFE_WEEKLY_CAP <FINANCE_ENV_PATH>   # -> 0   no life bound
grep -c WHOOP_          <FINANCE_ENV_PATH>   # -> 0   no recovery credential: a band crosses the bus, never a provider call
grep -c WEBHOOK_PATH    <FINANCE_ENV_PATH>   # -> 0   no path segment; routing by it is the proxy's job
```

---

## 2. `bus.env` -> `/etc/<CONFIG_DIR>/bus.env`

The narrowest file in the deployment, and the one place both agents' state meets - which is why it
holds **no credential of any kind**. Three entries.

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `SIGNALS_DATA_DIR` | G1 | no | phase 1 | the absolute directory you created for the append-only signal store and its audit mirror | `grep -c '^SIGNALS_DATA_DIR=' <BUS_ENV_PATH>` -> 1 |
| `SIGNALS_STORE_FILE` | operator | no | phase 1 | your choice of store file name within that directory | `grep -c '^SIGNALS_STORE_FILE=' <BUS_ENV_PATH>` -> 1 |
| `BUS_INTERNAL_ENDPOINT` | operator | no | phase 1 | the same internal address you typed into the agent file. **The three copies must agree** | `grep -c '^BUS_INTERNAL_ENDPOINT=' <BUS_ENV_PATH>` -> 1 |

```
grep -c 'BOT_._TOKEN\|OR_KEY_\|DRIVE_REFRESH_TOKEN\|GOOGLE_CLIENT' <BUS_ENV_PATH>   # -> 0
```

---

## 3. `scheduler.env` -> `/etc/<CONFIG_DIR>/scheduler.env`

A clock. It reads no store, holds no credential, and makes no outbound call, which is why two of its
five entries are the halt.

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `LIFE_TICK_ENDPOINT` | operator | no | **phase 1 - fill, unused** | the internal address the life agent would accept a tick on. Under option **(b)** the life agent is idle in phase 1, so nothing answers it | `grep -c '^LIFE_TICK_ENDPOINT=' <SCHEDULER_ENV_PATH>` -> 1 |
| `FINANCE_TICK_ENDPOINT` | operator | no | phase 1 | the internal address the finance agent accepts a tick on | `grep -c '^FINANCE_TICK_ENDPOINT=' <SCHEDULER_ENV_PATH>` -> 1 |
| `SCHEDULER_TICK_INTERVAL` | operator | no | phase 1 | your choice of tick cadence | `grep -c '^SCHEDULER_TICK_INTERVAL=' <SCHEDULER_ENV_PATH>` -> 1 |
| `KILL_SENTINEL_PATH` | G1 | no | phase 1 | **the same path, character for character**, as in the other three honouring files | `grep -c '^KILL_SENTINEL_PATH=' <SCHEDULER_ENV_PATH>` -> 1 |
| `NIZAM_KILL_ALL` | operator | no | phase 1 | `1` halts the scheduler, `0` does not | `grep -c '^NIZAM_KILL_ALL=' <SCHEDULER_ENV_PATH>` -> 1 |

```
grep -c 'BOT_._TOKEN\|OR_KEY_\|_WEEKLY_CAP\|DATA_DIR\|BUS_INTERNAL_ENDPOINT' <SCHEDULER_ENV_PATH>   # -> 0
```

---

## 4. `backup.env` -> `/etc/<CONFIG_DIR>/backup.env`

Twelve entries, and the file where **what is absent is the security property**. Needs G5 and G8.

**`BACKUP_FOLDER_REF` is not a value you choose (D-G5).** The storage grant is per-file scope, which
reaches **only what the application itself created**, so a folder you make by hand in the storage
web interface is **unreachable** and the uploader would fail against it. The folder is created by
**the uploader on its first run** and the reference it returns is what goes here. So: leave it until
the first run has happened, then type what the run reports. Do not invent a reference.

**The `age` private key reaches none of the three destinations.** G8 generates the keypair on your
machine and the private half goes to your password manager plus one offline copy. Only
`AGE_PUBLIC_KEY` reaches the host. That is what makes "this host creates a backup it cannot read"
true rather than merely stated - and it is why G8's verification is that a search of the host for
private key material returns **nothing**, with the empty output being the gate.

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `BACKUP_WORK_DIR` | G1 | no | phase 1 | the scratch directory you created. **Never a store, and never retained** | `grep -c '^BACKUP_WORK_DIR=' <BACKUP_ENV_PATH>` -> 1 |
| `BACKUP_SCHEDULE` | operator | no | phase 1 | your choice of cadence. The recovery objective is stated in terms of it | `grep -c '^BACKUP_SCHEDULE=' <BACKUP_ENV_PATH>` -> 1 |
| `AGE_PUBLIC_KEY` | G8 | no | phase 1 | the **public** half of the keypair G8 generates. A placeholder in the repository even though it is public, because a reader holding it knows which archives were written for this deployment | `grep -c '^AGE_PUBLIC_KEY=' <BACKUP_ENV_PATH>` -> 1 |
| `BACKUP_ENCRYPTION_SCHEME` | operator | no | phase 1 | the tool of record or its one documented fallback. `backup.sh` refuses **anything else** | `grep -c '^BACKUP_ENCRYPTION_SCHEME=' <BACKUP_ENV_PATH>` -> 1 |
| `BACKUP_RETAIN_COUNT` | operator | no | phase 1 | how many encrypted artifacts to keep before the oldest is dropped | `grep -c '^BACKUP_RETAIN_COUNT=' <BACKUP_ENV_PATH>` -> 1 |
| `BACKUP_FOLDER_REF` | G5 | no | phase 1, **after** the first uploader run | **the uploader creates the folder on first run** and reports the reference. Not hand-picked - see the note above | `grep -c '^BACKUP_FOLDER_REF=' <BACKUP_ENV_PATH>` -> 1 |
| `DRIVE_REFRESH_TOKEN` | G5 | **yes** | phase 1 | the long-lived grant from the consent click, with the screen **published to production** (D-G5) | `grep -c '^DRIVE_REFRESH_TOKEN=' <BACKUP_ENV_PATH>` -> 1 |
| `GOOGLE_CLIENT_ID` | G5 | no | phase 1 | the client identifier the grant was issued to | `grep -c '^GOOGLE_CLIENT_ID=' <BACKUP_ENV_PATH>` -> 1 |
| `GOOGLE_CLIENT_SECRET` | G5 | **yes** | phase 1 | the client credential the grant was issued with | `grep -c '^GOOGLE_CLIENT_SECRET=' <BACKUP_ENV_PATH>` -> 1 |
| `STORAGE_TOKEN_URL` | operator | no | phase 1 | the storage provider's documented token endpoint, from its own documentation | `grep -c '^STORAGE_TOKEN_URL=' <BACKUP_ENV_PATH>` -> 1 |
| `KILL_SENTINEL_PATH` | G1 | no | phase 1 | **the same path**, character for character, as the other three | `grep -c '^KILL_SENTINEL_PATH=' <BACKUP_ENV_PATH>` -> 1 |
| `NIZAM_KILL_ALL` | operator | no | phase 1 | `1` halts the backup service before a run begins | `grep -c '^NIZAM_KILL_ALL=' <BACKUP_ENV_PATH>` -> 1 |

```
grep -c 'PRIVATE KEY\|AGE_IDENTITY\|IDENTITY_FILE' <BACKUP_ENV_PATH>   # -> 0   the private half is never here
grep -c 'BOT_._TOKEN\|OR_KEY_\|WEBHOOK'            <BACKUP_ENV_PATH>   # -> 0   backups hold data; secrets are re-provisioned, not restored
```

---

## 5. `life.env` -> `/etc/<CONFIG_DIR>/life.env`

**Nineteen entries, and none of them is needed for phase 1 under option (b).** The life agent is
Python and lives in the other repository; its three change specifications are written and unapplied.
Phase 1 ships the finance agent on bot B only, and **bot A stays created, hardened and idle**. Fill
this file when the life agent follows - it is listed here in full so you never work it twice.

Every entry mirrors the finance file's row of the same name, with these differences:

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `LIFE_DATA_DIR` | G1 | no | with the life agent | its own directory; the finance volume is not mounted into it | `grep -c '^LIFE_DATA_DIR=' <LIFE_ENV_PATH>` -> 1 |
| `LIFE_STORE_FILE` | operator | no | with the life agent | your choice | `grep -c '^LIFE_STORE_FILE=' <LIFE_ENV_PATH>` -> 1 |
| `LIFE_CONTAINER_PORT` | operator | no | with the life agent | must equal the proxy file's copy in phase 2 | `grep -c '^LIFE_CONTAINER_PORT=' <LIFE_ENV_PATH>` -> 1 |
| `BOT_A_TOKEN` | G3 | **yes** | with the life agent | the first bot's token. **D-ROTATE: the existing one** | `grep -c '^BOT_A_TOKEN=' <LIFE_ENV_PATH>` -> 1 |
| `LIFE_WEBHOOK_SECRET` | G6 | **yes** | phase 2 | you generate it on the host, same character set as the finance one | `grep -c '^LIFE_WEBHOOK_SECRET=' <LIFE_ENV_PATH>` -> 1 |
| `OR_KEY_LIFE` | G4 | **yes** | with the life agent | the **other** key G4 mints. Never the finance one | `grep -c '^OR_KEY_LIFE=' <LIFE_ENV_PATH>` -> 1 |
| `LIFE_WEEKLY_CAP` | G4 | no | with the life agent | **D-CAP: 2.50**, in the same micro-USD integer unit as the finance cap | `grep -c '^LIFE_WEEKLY_CAP=' <LIFE_ENV_PATH>` -> 1 |
| `WHOOP_API_BASE` | operator | no | with the life agent | the recovery provider's documented API base | `grep -c '^WHOOP_API_BASE=' <LIFE_ENV_PATH>` -> 1 |
| `WHOOP_ACCESS_TOKEN` | operator | **yes** | with the life agent | the recovery provider credential. **This agent only** | `grep -c '^WHOOP_ACCESS_TOKEN=' <LIFE_ENV_PATH>` -> 1 |
| `ALLOWED_USER_IDS` | G3 | no | with the life agent | **the same identifier as the finance file.** Present in one file only means one bot refuses you and the other has no list | `grep -c '^ALLOWED_USER_IDS=' <LIFE_ENV_PATH>` -> 1 |
| `STORE_BUSY_TIMEOUT_MS`, `MSG_API_BASE`, `TELEGRAM_MODE`, `MAX_WORK_ITEMS`, `MODEL_API_BASE`, `MODEL_ELIGIBILITY_REGISTRY_PATH`, `BUS_INTERNAL_ENDPOINT`, `KILL_SENTINEL_PATH`, `NIZAM_KILL_ALL` | as the finance file | no | with the life agent | as the finance file's rows. `MSG_API_BASE`, `MODEL_API_BASE`, `MODEL_ELIGIBILITY_REGISTRY_PATH`, `BUS_INTERNAL_ENDPOINT` and `KILL_SENTINEL_PATH` must **equal** the finance copies; `TELEGRAM_MODE`, `MAX_WORK_ITEMS` and `STORE_BUSY_TIMEOUT_MS` need not | one `grep -c` each -> 1 |

```
grep -c BOT_B_TOKEN        <LIFE_ENV_PATH>   # -> 0
grep -c OR_KEY_FINANCE     <LIFE_ENV_PATH>   # -> 0
grep -c FINANCE_WEEKLY_CAP <LIFE_ENV_PATH>   # -> 0
grep -c WEBHOOK_PATH       <LIFE_ENV_PATH>   # -> 0
```

---

## 6. `proxy.env` -> `/etc/<CONFIG_DIR>/proxy.env`

**Nothing in this file is needed for phase 1. Do not fill any of it yet.** The `caddy` service stays
down under `longPoll`, `<TLS_PORT>` is not bound, and no host port is published at all. Two of the
six entries are gated on G2, which is **blocked on a domain you have not bought** - measured, the
account holds zero zones - and two more on G6, which is deferred with it. Deferred is **not
cancelled**: every entry keeps its gate, and phase 2 is a configuration change rather than a rewrite.

| Entry | Gate | Secret | When | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `DOMAIN` | G2 | no | **phase 2** | your DNS zone, once one exists. The two site addresses derive from it | `grep -c '^DOMAIN=' <PROXY_ENV_PATH>` -> 1 |
| `ACME_CONTACT` | operator | no | **phase 2** | the address the certificate authority registers for expiry notices | `grep -c '^ACME_CONTACT=' <PROXY_ENV_PATH>` -> 1 |
| `LIFE_WEBHOOK_PATH` | G6 | **yes** | **phase 2** | a high-entropy segment generated on the host. **Not** the bot token, so the token never reaches a proxy log | `grep -c '^LIFE_WEBHOOK_PATH=' <PROXY_ENV_PATH>` -> 1 |
| `MONEY_WEBHOOK_PATH` | G6 | **yes** | **phase 2** | the same, generated separately | `grep -c '^MONEY_WEBHOOK_PATH=' <PROXY_ENV_PATH>` -> 1 |
| `LIFE_CONTAINER_PORT` | operator | no | **phase 2** | **the same value as in `life.env`**. If they disagree, every delivery aborts at the proxy | `grep -c '^LIFE_CONTAINER_PORT=' <PROXY_ENV_PATH> <LIFE_ENV_PATH>` -> 1 each, **and equal** |
| `FINANCE_CONTAINER_PORT` | operator | no | **phase 2** | **the same value as in `finance.env`** | `grep -c '^FINANCE_CONTAINER_PORT=' <PROXY_ENV_PATH> <FINANCE_ENV_PATH>` -> 1 each, **and equal** |

```
grep -c 'BOT_._TOKEN'    <PROXY_ENV_PATH>   # -> 0   the proxy holds no bot token
grep -c WEBHOOK_SECRET   <PROXY_ENV_PATH>   # -> 0   the constant-time compare lives in the agent
grep -c KILL_SENTINEL    <PROXY_ENV_PATH>   # -> 0   the proxy writes nothing, so it has nothing to halt
grep -c BUS_             <PROXY_ENV_PATH>   # -> 0   the proxy is on neither internal network
```

`MAX_CONNECTIONS` is **not** in this file and is not an entry anywhere today (finding **F2**). It is
an argument to the G6 registration command, and it is irrelevant in `longPoll` because the provider
delivers nothing for it to bound. `DEPLOYMENT_VALUE_LEDGER.md` §6 records where it should live in
phase 2.

---

## What this sheet did not do

No value was obtained, read, generated or placed. No gate was attempted and no checkbox ticked. No
environment file was created on any host, and no template under `ops/env/` was edited. Every entry
name, gate attribution and secrecy flag above was read from `src/server/ops/envTemplates.ts`
(`ENTRY_SPECS`), `src/server/config/environment.ts` (`SERVICE_ENTRY_NAMES`) and the six
`ops/env/*.env.example` templates, and the disagreements found between those sources and the two
shell scripts are recorded in `DEPLOYMENT_VALUE_LEDGER.md` §7 rather than silently reconciled here.
