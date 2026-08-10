# Owner gate actions - the ordered walkthrough, top to bottom, one sitting

> **Task:** 10.11 of `.kiro/specs/06-two-agent-vps/tasks.md`. **Authority:**
> `KIRO_SHIP_LIVE.prompt.md` §8 step 7 - "tell the owner exactly which gate steps to perform, with
> the command for each". **An instruction sheet, never an attempt.**
>
> **Two documents, and you will want both open.** This one is the **ordered gate walkthrough**: which
> gate, in what order, with the command and the line that proves it. `OWNER_FILL_IN_SHEET.md` is the
> **value reference**: all 62 entries, grouped by environment file, each with its gate, its `secret`
> flag and its proof command. Work down **this** file; when a step says "type the entries this gate
> supplies", look them up **there**.
>
> `ops/GATE_REGISTER.md` outranks both. Every verification line below is **copied** from it rather
> than reinvented. Where this sheet disagrees with the register on how a gate is verified, the
> register wins and this sheet is the bug.

## START HERE

**G1. Provision and harden the host, and finish by creating `/etc/<CONFIG_DIR>`.**

Nothing else first. G3, G4, G5 and G8 each end by writing a secret into that directory, so doing any
of them before G1 leaves you holding a production secret with nowhere to put it.

## Four ground rules, then the walkthrough

1. **Values are typed, never copied up.** Each value is typed into `/etc/<CONFIG_DIR>/<service>.env`
   over the administrative session - not scp'd from the laptop, not appended from a shell whose
   history is kept, never committed. `.secrets/**` stays on the laptop (mandate §3.2, §3.4).
2. **You record the observation, never the value.** Every verification line below reports a **count**
   or a fact. "Two distinct bots authenticate" is the record; the identifier is not. That is R24, and
   it is the whole reason this repository can be public.
3. **A gate is done when you observe it.** Not when the step is performed - when its verification line
   passes and you have written down that it passed. No checkbox in `ops/GATE_REGISTER.md` or in
   `tasks.md` has been ticked for you, deliberately.
4. **Nothing is rotated (D-ROTATE).** The two bot tokens that already exist are the tokens this
   deployment uses. Rotation is the **final acceptance test**, after you have used the thing and
   reported it working. While the disclosed tokens are live, the compensating control stands:
   `getWebhookInfo` is checked on every run (`.kiro/steering/cloudflare-dns.md` item 3).

Order: **G1 -> G3 (placement) -> G4 -> G5 -> G8.** G3 and G4 have no technical prerequisite, but they
mint or place secrets, so they come after the directory that holds them exists.

---

## G1 - Provision and harden the host, then create `/etc/<CONFIG_DIR>`

**What it is for:** it creates the trust root - who may log in, what the firewall denies, and the one
root-owned directory that every later secret is written into.

A host already exists and reports active (recorded in the register, 2026-08-09). That satisfies only
the *precondition* - that there be a machine to harden. The checklist below has not been worked.

### Commands, in order

Steps 1 and 5 through 7 are provider-console and package-manager work with no single command; the
register states them and they are reproduced here as actions rather than invented as one-liners.

1. Create the instance: provider `<VPS_PROVIDER>`, size `<INSTANCE_SIZE>`, region `<REGION>`.
2. Operator account with administrative escalation:
   ```
   adduser <OPERATOR_USER>
   usermod -aG sudo <OPERATOR_USER>
   install -d -m 700 -o <OPERATOR_USER> -g <OPERATOR_USER> /home/<OPERATOR_USER>/.ssh
   ```
3. Install the operator public key, then in the administrative daemon configuration:
   ```
   PermitRootLogin no
   PasswordAuthentication no
   PubkeyAuthentication yes
   AllowUsers <OPERATOR_USER>
   ```
4. Default-deny firewall, allowing only the TLS port and the administrative port:
   ```
   ufw default deny incoming
   ufw default allow outgoing
   ufw allow <TLS_PORT>/tcp
   ufw allow <ADMIN_PORT>/tcp
   ufw enable
   ```
   **Two ports, and no third.** The certificate challenge is TLS-ALPN-01 on `<TLS_PORT>` alone
   (finding F12, settled by task 10.8), so **no cleartext challenge port is required** - the register's
   G1 records this and `ops/docker-compose.yml` binds exactly one host port, so the firewall and the
   topology agree. In phase 1 nothing listens behind the TLS allowance at all, because the proxy stays
   down; an allowed port with nothing bound is not reachable.
5. Enable intrusion blocking on the administrative service, and unattended security updates.
6. Install the container runtime and its compose plugin, and confirm the service is enabled at boot.
7. Create swap sized `<SWAP_SIZE>`. The box is small and the model client and the proxy must not be reaped.
8. Create the directory the four later gates write into:
   ```
   install -d -m 700 -o root -g root /etc/<CONFIG_DIR>
   ```
   One file per service inside it, each `chmod 600`, owner `root`, read by no other service.
9. Type the five entries **this gate supplies**, each into the file of the service that owns it -
   `LIFE_DATA_DIR`, `FINANCE_DATA_DIR`, `SIGNALS_DATA_DIR`, `BACKUP_WORK_DIR`, and
   `KILL_SENTINEL_PATH` in **all four** halt-honouring files. Values and per-entry proof commands are
   in `OWNER_FILL_IN_SHEET.md` §1-§5. There is no default for any of them; an unset entry is a
   startup refusal.

### VERIFICATION (copied from the register)

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

Then step 9, one line per entry:

```
grep -c '^LIFE_DATA_DIR='       <LIFE_ENV_PATH>       # -> 1
grep -c '^FINANCE_DATA_DIR='    <FINANCE_ENV_PATH>    # -> 1
grep -c '^SIGNALS_DATA_DIR='    <BUS_ENV_PATH>        # -> 1
grep -c '^BACKUP_WORK_DIR='     <BACKUP_ENV_PATH>     # -> 1
grep -c '^KILL_SENTINEL_PATH='  <LIFE_ENV_PATH> <FINANCE_ENV_PATH> <SCHEDULER_ENV_PATH> <BACKUP_ENV_PATH>
# -> 1 for each of the four, and the four values are identical
```
And the negative, which is the isolation half: `grep -c FINANCE_DATA_DIR <LIFE_ENV_PATH>` -> `0`, and
the same test in the other direction.

**The four `KILL_SENTINEL_PATH` values must match character for character** and must resolve inside
the sentinel mount (`DEPLOYMENT_VALUE_LEDGER.md` §6.1). A typo there is a kill switch that silently
does nothing, and nothing else in the deployment will tell you.

**Record:** "hardening checklist worked, `/etc/<CONFIG_DIR>` created root-owned 700, password login
refused, five G1 entries present" plus the date. Not a single value.

**Gap worth knowing before you start:** step 5 has **no verification line** in the register. Every
other G1 step does. Confirm intrusion blocking and unattended updates however your distribution
reports them, and record the fact - see the findings section at the end.

---

## G3 - Placement only

**What it is for:** to put the two bot tokens and your own allowlist entry into the host secret store.

**Steps 1 to 3 are already done and are not yours to repeat.** Both bots exist and both were verified
live by read-only probes. Creating them is the half of G3 that is finished; **placement is the half
that is open**, and it is the only thing this section asks of you. **D-ROTATE: use the existing
tokens.** Do not mint new ones.

### Commands

1. Type each token into its own file, and nowhere else:
   ```
   # /etc/<CONFIG_DIR>/life.env      -> BOT_A_TOKEN=<BOT_A_TOKEN>
   # /etc/<CONFIG_DIR>/finance.env   -> BOT_B_TOKEN=<BOT_B_TOKEN>
   chmod 600 /etc/<CONFIG_DIR>/*.env
   chown root:root /etc/<CONFIG_DIR>/*.env
   ```
   Under option **(b)** - phase 1 ships the finance agent on bot B only - `life.env` is not read by
   anything yet. Place `BOT_A_TOKEN` anyway if you are doing this in one pass; bot A stays created,
   hardened and idle.
2. Type your own messaging identifier into `ALLOWED_USER_IDS` in **each** agent file. Bare digits, no
   quotes, no brackets (D-ALLOWLIST). The allowlist is never empty and never widened; an empty
   allowlist must refuse everyone (R12).

### VERIFICATION (copied from the register)

```
# from the host, tokens read from the environment - never typed inline
curl -sS "<MSG_API_BASE>/bot${BOT_A_TOKEN}/getMe"   # -> ok:true, is_bot:true
curl -sS "<MSG_API_BASE>/bot${BOT_B_TOKEN}/getMe"   # -> ok:true, is_bot:true, a different id
stat -c '%U %G %a' /etc/<CONFIG_DIR>/life.env                 # -> root root 600
```
Record only "two distinct bots authenticate" - never the returned name or identifier.

```
grep -c '^ALLOWED_USER_IDS=' <LIFE_ENV_PATH> <FINANCE_ENV_PATH>   # -> 1 for each of the two
```
Presence is necessary and not sufficient: confirm the value is non-empty by observing that the
refusal path rejects an absent sender, **never** by reading the value back.

**One entry in one file only is the dangerous shape**, which is why the count is run over both: it
refuses you on one bot while the other has no list to consult at all.

**Record:** "two bot tokens placed one per file, allowlist present in both, modes 600 root-owned."

---

## G4 - Mint the two model keys and their weekly caps

**What it is for:** it mints the two production model keys and sets the provider-side spend ceiling
that the in-process ledger is designed to agree with.

**D-CAP: your ceiling is a hard USD 5.00 per week in total, met by two keys at 2.50 each.** Per-key
caps *are* the isolation - a runaway loop in one agent cannot spend the other's allocation (R17).

### Read this before you type a number: F13, two units, one figure

The same D-CAP figure is written **two different ways** in two different places, and the wrong one in
the wrong place fails in two different directions:

| Where | Name | Unit | What to type |
|---|---|---|---|
| The provider's key-creation body, step 2 below | `<FINANCE_KEY_LIMIT_USD>` / `<LIFE_KEY_LIMIT_USD>` | decimal USD **text** | the decimal form of 2.50 |
| The environment entry the ledger reads, step 5 below | `FINANCE_WEEKLY_CAP` / `LIFE_WEEKLY_CAP` | **integer micro-USD** | 2.50 converted to a bare run of digits |

The entry `loadAgentModelBinding` reads is `weeklyCapMicroUsd`, and **a decimal is refused rather than
rounded** - there is no floating-point money in this repository. So a literal `2.50` typed into the
environment entry is a **startup refusal**, and the integer form sent to the provider would be a limit
a million times too large. Convert with `MICRO_USD_PER_USD` from `src/features/routing/spendLedger.ts`;
`src/features/routing/agentWeeklyCaps.ts` holds the conversion each way, tested in both directions, and
records why the two spellings deliberately do not share a name.

The register's G4 step 2 still interpolates `<FINANCE_WEEKLY_CAP>` into the provider body. **Read it as
the decimal form there** - the register outranks the code module on gate verification, so task 10.10
recommended the one-line change rather than making it. That is the one place in this walkthrough where
you must supply the reading rather than copy the placeholder.

### Commands

1. Create a provisioning key in the provider console. It stays on the **operator machine** only and is
   never placed on the host.
2. Mint the two runtime keys, one per agent, each with its own weekly limit:
   ```
   curl -sS <MODEL_API_BASE>/api/v1/keys \
     -H "Authorization: Bearer <PROVISIONING_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name":"<LIFE_KEY_NAME>","limit":<LIFE_KEY_LIMIT_USD>,"limit_reset":"weekly"}'

   curl -sS <MODEL_API_BASE>/api/v1/keys \
     -H "Authorization: Bearer <PROVISIONING_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name":"<FINANCE_KEY_NAME>","limit":<FINANCE_KEY_LIMIT_USD>,"limit_reset":"weekly"}'
   ```
3. Set the account-level privacy posture once, applying to both keys: **training opt-out on**, prefer
   providers that decline data collection, zero-retention where offered (R19).
4. Type each key into its own file - `OR_KEY_LIFE` in the life file, `OR_KEY_FINANCE` in the finance
   file. **Neither file holds the other agent's key.**
5. Type the two cap entries beside their own keys - `LIFE_WEEKLY_CAP` in `<LIFE_ENV_PATH>`,
   `FINANCE_WEEKLY_CAP` in `<FINANCE_ENV_PATH>`, **in the integer unit**. Each must equal the
   provider-side limit you set in step 2 for that agent. Neither file carries the other agent's cap: a
   cap spanning both agents would make one agent's runaway loop the other agent's outage.

### VERIFICATION (copied from the register)

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
Then, in the console, confirm the training opt-out is on. Finally the negatives, in both directions:
`grep -c OR_KEY_FINANCE /etc/<CONFIG_DIR>/life.env` -> `0`, and
`grep -c FINANCE_WEEKLY_CAP /etc/<CONFIG_DIR>/life.env` -> `0`.

When you compare the `limit` the provider reports against the entry you typed, compare **the same
unit** - the provider answers in decimal USD, the entry holds integer micro-USD. They agree as values,
not as strings.

**Record:** "two keys minted at the per-agent cap, weekly reset confirmed, training opt-out on, each
key and cap in its own file, both negatives clean" plus the date. Never a key, never a usage figure.

---

## G5 - Storage consent grant, with the screen published to production

**What it is for:** it grants the backup uploader a narrow, per-file write into your own storage, and
gives it a refresh token so it can work unattended.

**D-G5: publish the consent screen to In production.** A screen left in Testing issues a refresh token
that expires in seven days, and the unattended uploader then dies **silently** on day eight. The
per-file scope is non-sensitive, so publishing needs no review. This is the single highest-value
sentence in this section.

### Commands

1. On the **operator machine**, run the provider's documented desktop/installed-app consent flow for
   the backup client, requesting the **per-file scope only** - never the full-storage scope
   (steering `drive-db.md`, harness check AC08). This repository holds no script for this step; the
   flow is the provider's own, run from your laptop, with the desktop OAuth client you already hold
   outside the tracked tree.
2. Complete the consent screen in the browser as yourself, with the screen **published to production**.
3. Exchange the authorization code for a refresh token and type it into the backup file as
   `DRIVE_REFRESH_TOKEN`, `chmod 600`, owner `root`.
4. Type `BACKUP_FOLDER_REF` into the same file. **You do not choose this value** - see the ordering
   note below.
5. Type, in the same file and nowhere else, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` - the
   refresh in the verification line **cannot be performed without them** - and resolve
   `STORAGE_TOKEN_URL` from the storage provider's published documentation.
6. Confirm the grant can write to that folder and read nothing else.

### VERIFICATION (copied from the register)

```
# refresh the grant without any interactive prompt
curl -sS <STORAGE_TOKEN_URL> \
  -d "client_id=<GOOGLE_CLIENT_ID>" \
  -d "client_secret=<GOOGLE_CLIENT_SECRET>" \
  -d "refresh_token=${DRIVE_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token"
# -> an access token is returned and its scope is the per-file scope ONLY
```
The five entries must each be present before that refresh is attempted:

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

### The one step that will not close in this sitting

`BACKUP_FOLDER_REF` **cannot be filled today, and inventing a value is worse than leaving it blank.**
The per-file scope reaches only what the application itself created, so a folder you make by hand in
the storage web interface is unreachable and the uploader would fail against it. D-G5 therefore has the
**uploader create the folder on its first run** and report the reference. The uploader does not exist
yet: `<BACKUP_IMAGE_REF>` is `OWNED_BUILD_PENDING` in `ops/IMAGE_BUILD.md`, blocked on task 10.9.

So: **do steps 1, 2, 3, 5 and 6 now** and record them. Leave step 4 and the two lines that depend on it
(`BACKUP_FOLDER_REF` present, probe upload) until the uploader's first run. G5 stays
`BLOCKED - awaiting human` until then, which is honest rather than tidy.

**Record:** "consent screen published to production, refresh token placed, unattended refresh returns
the per-file scope only, out-of-scope listing refused. `BACKUP_FOLDER_REF` pending the uploader's first
run (task 10.9)."

---

## G8 - Backup keypair, private half off the host

**What it is for:** it is the one step that makes the backup guarantee **true** rather than stated -
"a host compromise yields ciphertext only". Generate this keypair on the host and the guarantee is
void from that moment, retroactively, for every archive ever taken.

### Commands

1. On the **operator machine**, never on the host:
   ```
   age-keygen -o <AGE_IDENTITY_FILE>
   ```
2. Store `<AGE_IDENTITY_FILE>` in your password manager, **plus one offline copy in a second
   location**. If this file is lost, every encrypted backup is permanently unreadable. That is the
   intended trade and it must be a deliberate one.
3. Derive the public recipient:
   ```
   age-keygen -y <AGE_IDENTITY_FILE>
   ```
4. Place **only** the public recipient on the host: `AGE_PUBLIC_KEY` in the backup file, `chmod 600`,
   owner `root`.
5. Confirm no identity file was ever copied to the host, and that no backup archive and no key share
   the same storage location.
6. Run the **restore drill** before trusting any of it - see the ordering note below.

### VERIFICATION (copied from the register)

```
# on the host: the private half must be absent, everywhere
sudo grep -rIl -e 'AGE-SECRET-KEY' /etc /root /home /opt /srv /var/lib 2>/dev/null   # -> no output
grep -c AGE_PUBLIC_KEY /etc/<CONFIG_DIR>/backup.env                                  # -> 1

# off the host, on the operator machine, for one real archive
age -d -i <AGE_IDENTITY_FILE> -o <RESTORED_DB> <ARCHIVE>.age
sqlite3 <RESTORED_DB> 'PRAGMA integrity_check;'                                      # -> ok
shred -u <RESTORED_DB>
```
**The empty output of the first command is the whole gate.** Record "no identity material present on
host, restore drill passed `<DATE>`".

### The drill needs an archive, so step 6 lands later

Steps 1 to 5 close in this sitting. Step 6 needs **one real archive**, which needs the backup path
running, which needs task 10.9 and `BACKUP_FOLDER_REF`. That is the register's own ordering - "until G8
is done, no archive may be treated as a backup" - so nothing is out of sequence; the drill simply
arrives with rung **L5** (task 10.13). `ops/restore/restore.sh` is what runs it: it reads
`AGE_IDENTITY_FILE` as a **path**, runs on your machine only, writes into a `RESTORE_TARGET_DIR` that
**must not already exist**, and carries the integrity check that gates trust in a restored store. A
store that fails the check is discarded and escalated, never repaired and used (R21).

**Record:** "keypair generated off-host, private half in password manager plus one offline copy, only
the public recipient on the host, host-wide search for private key material returns nothing. Drill
pending the first archive."

---

## Not now, and why. Do not go looking for these

**G2 - records for the two hostnames. DEFERRED, not cancelled.** Phase 1 ships on `TELEGRAM_MODE=longPoll`,
which is outbound only: **no domain, no DNS record, no certificate, no public port, no reverse proxy.**
G2 is additionally blocked on a domain you have not bought - measured, the account holds **zero zones**
- so there is nothing to point anywhere. Do not create a record. Do not fill `DOMAIN` or `ACME_CONTACT`.

**G6 - register both webhooks. DEFERRED with it.** Long polling has no inbound request, so there is no
webhook to register. **Do not run `setWebhook`.** Two entries the loader still requires today -
`MONEY_WEBHOOK_SECRET` in the finance file, and its life-side twin - are marked
*fill, unused* in `OWNER_FILL_IN_SHEET.md`: you generate them on the host, from `A-Za-z0-9_-`, and
nothing in phase 1 reads them. Fill them and move on; do not agonise over the value.

Both keep their gate numbers and every verification line. Phase 2 is a configuration change - flip the
mode entry, register both webhooks, name the phase-2 profile - not a rewrite, because the guards are
identical either way.

**G7 - CLOSED, WONT-DO.** Repository privatization. You authorized keeping both repositories public on
2026-08-06. It is not a gate, not an open decision, and not to be raised again. What replaced it is
stronger and is re-proved on every run: no tracked file contains a deployment particular (R24), scanned
and failing closed. It is listed in the register only so a reader who finds G1-G6 and G8 does not
conclude G7 was lost.

---

## Then the stack comes up - and how far it gets today

### Commands

1. **Build the one image this repository owns**, from the repository root on the host, after a
   `git pull` (never a copy of the working tree, so nothing gitignored rides along):
   ```
   docker build --file ops/images/finance-agent/Dockerfile --tag <FINANCE_IMAGE_REF> .
   ```
   Resolve `<FINANCE_IMAGE_REF>` once, in your own untracked operator file, as
   `<IMAGE_NAMESPACE>/<IMAGE_NAME>:<IMAGE_TAG>`. **The tag must be immutable** - derived from the
   source revision, never a word like *latest* - because `ops/runbook/ROLLBACK.md` reverts by naming a
   previous tag and relies on it still naming the same bytes. Record the digest from
   `docker image inspect` in that same operator file, beside every other particular.
2. **Materialize the six environment files** at `/etc/<CONFIG_DIR>/{life,finance,proxy,bus,scheduler,backup}.env`
   from the `ops/env/*.env.example` templates, `root:root`, mode `600`, one per service. Every entry is
   in `OWNER_FILL_IN_SHEET.md`. Nothing has a default: absent, blank, or still holding its
   `<ANGLE_BRACKET>` placeholder is a **startup refusal**, and the loader names **every** missing entry
   at once rather than one per restart.
3. **Substitute the resolved image reference and the six env paths** into your materialized copy of
   `ops/docker-compose.yml`. One value, two consumers - the build above and the `image:` entry - so they
   cannot disagree.
4. **Start the stack without the phase-2 profile:**
   ```
   docker compose --file <COMPOSE_FILE> up --detach
   ```
   **That is the whole of "keep the proxy down".** `caddy` carries `profiles: [phase2]` and is the only
   service with a `ports:` key, so a bare start binds **no host port at all**. It is a property of the
   file now, not something to remember. Phase 2 adds `--profile phase2`, deliberately, which is the
   point at which publishing a port becomes a decision somebody made.

### What becomes observable, and what does not

| Rung | What it proves | Standing after this sitting |
|---|---|---|
| **L0** config | The loader refuses an incomplete environment and names every missing entry | Runnable now, no gate needed |
| **L1** guards | `longPoll` refuses an unlisted sender and accepts you with no secret-token header; `webhook` still refuses an absent, empty, over-length and out-of-charset token; the same update twice produces one effect | Runnable now, no gate needed |
| **L2** compose | The stack stands up, every service healthy, no host port published, each env file mounted into exactly one service | **Blocked on build work in this repository** - see below |
| **L3** transport | Both bots reachable; kill the agent mid-work, restart, the in-flight update completes exactly once | Blocked with L2 |
| **L4** routing and safety | A turn routes to a pinned slug, the cap **refuses** rather than overspends, the sentinel halts model calls and bus publishes, `NIZAM_KILL_ALL=1` halts on restart | Needs L2/L3 plus G4, which you have just done |
| **L5** durability | `backup.sh` runs, the artifact is encrypted, retention drops the oldest, `restore.sh` rebuilds a store into a scratch location that matches the source | Blocked on task 10.9, then G5 step 4 and G8 step 6 |

**The honest ceiling, and it is not yours to clear.** Even with G1, G3-placement, G4, G5 and G8 all
observed, `docker compose up` still cannot bring the stack up, because three of the six image
references build nothing: `<BUS_IMAGE_REF>` and `<SCHEDULER_IMAGE_REF>` are `OWNED_BUILD_PENDING`
(finding **O2** - owned here in library form, with no process to package) and `<BACKUP_IMAGE_REF>` is
`OWNED_BUILD_PENDING` on task 10.9. And `finance-agent` declares
`depends_on: signalbus: condition: service_healthy`, so it will not start without a healthy bus.

`<LIFE_IMAGE_REF>` is `EXTERNAL` and stays down under option **(b)**, which is expected. The bus is
not: it is the one missing image that stands between a fully gated host and a bot that answers. So the
gate work below is necessary and, on its own, not sufficient - **L2 and L3 are blocked on this
repository, not on you.**

---

## How you know it worked

Three observations, in this order, and none of them is "the code looks right":

1. **You message bot B and get a reply.** The finance agent is the one process phase 1 runs. That
   single round trip is rung **L3**, and it is the answer to "can I converse with it".
2. **An unlisted sender is refused.** From any account that is not in `ALLOWED_USER_IDS`. The
   allowlist is the whole guard in `longPoll` - there is no secret-token header to check, because there
   is no inbound request.
3. **The refusal reveals nothing about which check failed.** Not the token, not the allowlist, not the
   mode. A refusal that distinguishes between them tells an attacker which half to work on. This is
   already automated against mocks; on the live path it is something you read with your own eyes.

Then, and only then: `npm run verify:all -- --all` at 20 of 20, the tree committed, and
`LIVE_PROGRESS.md` updated with the count of the seven conditions in mandate §5 you have actually
observed - as a count out of seven, so it cannot be inflated by partial credit.

---

## Findings - what this walkthrough could not make exact, reported rather than invented

Four, and the register is right to be read alongside them rather than patched by this sheet.

1. **G1 step 5 has no verification line.** "Enable intrusion blocking on the administrative service and
   unattended security updates" is a step; the VERIFICATION block covers the firewall, the daemon
   configuration, the configuration directory, the container runtime, swap, the operator account and the
   nine step-9 entries, and **not** this. Every other G1 step is covered. Recorded here rather than
   invented, because the command differs by distribution and guessing one would be a verification line
   that passes on the wrong machine.
2. **G4 step 3's verification is a console observation, not a runnable command.** "Then, in the console,
   confirm the training opt-out is on." That is checkable by a human and not by a line, and the register
   names no provider endpoint that reports the account-level posture. Acceptable as written; noted so
   nobody later mistakes it for something a script covers.
3. **G5 step 1 has no command anywhere in this repository.** The register says to "run the desktop
   consent flow for the backup client"; no such script is tracked, and writing one was not this task.
   The flow is the provider's own documented installed-app flow, run from your laptop. Not a defect in
   the register - it is an interactive flow by design - but it is the one step in this walkthrough where
   you supply the mechanism.
4. **G5's `BACKUP_FOLDER_REF` verification line cannot pass in the same sitting as the rest of G5**, and
   G8's step 6 cannot either. Both wait on the uploader that task 10.9 owns. This is the only thing that
   stops the walkthrough completing end to end today, and it is build work in this repository rather
   than anything you can do at a terminal.

## What this sheet did not do

No gate step was performed. No host was provisioned or hardened, no secret placed, no key minted, no
keypair generated, no consent screen clicked, no image built, no stack started, and no outbound network
call made. `ops/GATE_REGISTER.md` was **not** edited: no gate renumbered, removed, softened or
reopened, no `Status:` moved, and no checkbox ticked - in the register, or in `tasks.md`'s waiting list,
or anywhere else. Every value above is an `<ANGLE_BRACKET>` placeholder and none of them resolves to
anything real.
