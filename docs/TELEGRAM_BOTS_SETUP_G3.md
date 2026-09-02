# Create the two bots (gate G3) - operator walkthrough

> **Control record:** `ops/DEPLOYMENT_CONTROL.md` section G3 is the authority on what this gate means and how it
> is verified. This file is the click-by-click half the register deliberately does not carry.
> **Contract:** PFOS 12 section 5.2 / 5.3 (the two authenticity checks), 3.2.7 (one environment file
> per service, root-owned and mode-restricted).
> **Value ledger:** `.kiro/specs/06-two-agent-vps/TELEGRAM_VALUE_LEDGER.md` - every value this gate and
> G6 produce, its exact entry name, which file it belongs in, and the one command that proves it landed.
> **Worksheet (untracked):** `outputs/BOT_SETUP_WORKSHEET.local.md` - where you record what you did.
> **Public-repository constraint (R24):** no token, no numeric identifier, no domain and no bot name
> appears in this file, and none ever will. Every value is an `<ANGLE_BRACKET>` placeholder.

## BLUF

Both bots can be created today, in about ten minutes, with no host and no domain.

Their tokens cannot be **placed** today. The only legitimate home is `/etc/<CONFIG_DIR>/*.env`, which
gate G1 creates, and G1's hardening is not done. Until that directory exists, both tokens live in your
password manager and nowhere else: not in this repository, not in a note file, not in a chat message,
not in a shell command you type by hand.

Order of work: create the two bots, harden both, read your own numeric identifier, park the tokens,
place them the moment G1's configuration directory exists, and only then G6.

## For an AI agent reading this file

1. **Do not execute anything here.** Every command is written for a human in the operator's own
   session. Steering section 2 gates every outbound call from an agent process.
2. **Never invent a value.** Not a token, not an identifier, not an example of the right shape or
   width. A realistic-looking fake secret is worse than no secret, because it gets copied.
3. **Never ask the operator to paste a secret into a chat, a repository file, or a log.** If you need
   to know whether a value is present, count it (`grep -c '^BOT_A_TOKEN=' <LIFE_ENV_PATH>`) and never
   read it back.
4. **"Is G3 done?" is answered by observation, not by this file.** Two `getMe` responses plus the
   presence counts in section 7, and nothing else. A document asserting a gate is complete is not
   evidence; it is the single most damaging thing this register forbids.
5. **If this file disagrees with `ops/DEPLOYMENT_CONTROL.md`, `ops/env/` templates, or
   `src/server/telegram/auth.ts`, those win** and this file is the bug. Report the disagreement, do
   not reconcile it silently.

## Before you start

| Check | Why it matters |
|---|---|
| You are signed in as the account that should own both bots | Ownership is per account, and transfer is permanent |
| Your password manager is open | Two tokens come out of this and go straight in |
| You accept that these are two separate identities | They must be. One bot serving both agents defeats the per-bot de-duplication key (contract 12 section 5.4) and hands one compromise both surfaces |

## Step 1 - create bot A, the life agent

Open `https://t.me/BotFather` and send `/newbot`.

It asks two things, in this order.

1. **Name.** The display name, shown in contact details. Change it later with `/setname` if you want.
2. **Username.** 5 to 32 characters, Latin letters, digits and underscores only, and it **must end in
   `bot`**. Not case sensitive. **It cannot be changed later.** Choose it as though it were permanent,
   because it is.

It replies with an authentication token shaped `<digits>:<mixed-case-string>`.

**That token is bot A.** Its entry name is `BOT_A_TOKEN`, and `BOT_A_TOKEN` belongs to the **life**
agent's environment file. Put it in your password manager now, labelled so it cannot be confused with
bot B's.

## Step 2 - create bot B, the finance agent

Send `/newbot` again and answer the same two questions with a different name and a different username.

**That token is bot B.** Its entry name is `BOT_B_TOKEN`, and it belongs to the **finance** agent's
environment file.

> **A goes to life. B goes to finance.** This is the single most common way to get this gate wrong,
> and it fails in the least obvious direction: both bots authenticate, both webhooks register, and
> each agent then answers as the other. The templates are the authority -
> `ops/env/life.env.example` carries `BOT_A_TOKEN`, `ops/env/finance.env.example` carries
> `BOT_B_TOKEN`.

## Step 3 - harden both bots

Two settings, both in the same chat, applied **once per bot**.

| Command | Answer | Effect |
|---|---|---|
| `/setjoingroups` | **Disable** | The bot cannot be added to a group at all |
| `/setprivacy` | **Enable** | Privacy mode stays ON, so the bot does not receive general group messages |

Privacy mode is on by default for every bot, so `Enable` is the confirming answer rather than a change.
The exception matters and is the second reason join-groups is off: a bot added to a group **as an
admin** receives every message regardless of privacy mode. This is a single-operator deployment and
neither bot has any reason to be in a group.

Both of these are machine-verifiable. See section 7.

BotFather changes can take a few minutes to take effect, so verify after a short wait rather than
immediately.

## Step 4 - read your own numeric identifier

You need one number: your own account identifier. It goes into `ALLOWED_USER_IDS`.

**First-party method, preferred.** Send `/start` (or any message) to **your own** bot A, then, from the
machine holding that token:

```
curl -sS "${MSG_API_BASE}/bot${BOT_A_TOKEN}/getUpdates"
```

Read `result[].message.from.id`. Those digits are your identifier. `${MSG_API_BASE}` resolves from the
provider's own documentation to `https://api.telegram.org`, and both values are passed by environment
reference so neither enters shell history.

Two constraints on the timing. Do this **before** G6: `getUpdates` does not work for as long as a
webhook is set, and the way back is `deleteWebhook`. And do it on a machine where the token is already
stored, so the token is never typed inline.

**Third-party fallback.** `https://t.me/userinfobot` returns the same number. It is a bot owned by
somebody else, so this hands your identifier to a third party for convenience. The first method costs
one command and hands it to nobody.

That number goes into `ALLOWED_USER_IDS` in **both** agent files. Not one. Both. An allowlist present
in one file and absent from the other refuses you on one bot while the other has no list to consult at
all (requirement R12).

## Step 5 - park the tokens

The configuration directory does not exist yet, so there is nowhere legitimate to place these values.

Do: keep both tokens in the password manager, one entry each, labelled life / bot A and finance / bot B.
Record everything that is **not** a secret in `outputs/BOT_SETUP_WORKSHEET.local.md`, which is
gitignored and never leaves the machine.

Do not: put a token in a repository file (tracked or not), in a note application, in a chat message to
anybody including an assistant, or in a shell command typed by hand.

## Step 6 - place them, once G1's configuration directory exists

```
# /etc/<CONFIG_DIR>/life.env     -> BOT_A_TOKEN=<BOT_A_TOKEN>       ALLOWED_USER_IDS=<ALLOWED_USER_IDS>
# /etc/<CONFIG_DIR>/finance.env  -> BOT_B_TOKEN=<BOT_B_TOKEN>       ALLOWED_USER_IDS=<ALLOWED_USER_IDS>
chown root:root /etc/<CONFIG_DIR>/*.env
chmod 600      /etc/<CONFIG_DIR>/*.env
```

Type them into an editor on the host over your administrative session. Do not copy the files up from
this machine, and do not append them from a shell whose history is kept.

While you are in those two files, the transport entries that are yours to choose are listed in the
value ledger. Every one of them is a startup failure if it is unset: there is no default for anything,
because an unconfigured guard must not be an open door.

## Step 7 - verification, and what to record

Run all of it. Record the **observation**, never the value.

**7a. Two distinct, hardened bots.** Once per token:

```
curl -sS "${MSG_API_BASE}/bot${BOT_A_TOKEN}/getMe"
curl -sS "${MSG_API_BASE}/bot${BOT_B_TOKEN}/getMe"
```

Expect, in each response:

| Field | Expected | What it proves |
|---|---|---|
| `ok` | `true` | The token is valid |
| `result.is_bot` | `true` | It is a bot account |
| `result.id` | **different between the two** | Two identities, which the `(bot, update)` de-duplication key requires |
| `result.can_join_groups` | `false` | Step 3's `/setjoingroups` -> Disable actually applied |
| `result.can_read_all_group_messages` | `false` | Step 3's `/setprivacy` -> Enable actually applied, i.e. privacy mode is on |

The last two fields are documented as returned only by `getMe`, which is what makes step 3 verifiable
rather than merely instructed. The register's own G3 verification does not assert them today; finding
F3 below records that.

Record: "two distinct bots authenticate; both report join-groups off and privacy on". Never the names,
never the identifiers, never the token (R24).

**7b. Placement, once the files exist.**

```
grep -c '^BOT_A_TOKEN='      <LIFE_ENV_PATH>                     # -> 1
grep -c '^BOT_B_TOKEN='      <FINANCE_ENV_PATH>                  # -> 1
grep -c '^ALLOWED_USER_IDS=' <LIFE_ENV_PATH> <FINANCE_ENV_PATH>  # -> 1 for each of the two
stat -c '%U %G %a'           /etc/<CONFIG_DIR>/life.env          # -> root root 600
stat -c '%U %G %a'           /etc/<CONFIG_DIR>/finance.env       # -> root root 600
```

**7c. The crossings that must not exist.**

```
grep -c 'BOT_B_TOKEN' <LIFE_ENV_PATH>     # -> 0
grep -c 'BOT_A_TOKEN' <FINANCE_ENV_PATH>  # -> 0
grep -c 'BOT_._TOKEN' <PROXY_ENV_PATH>    # -> 0   the proxy holds no bot token, ever
```

**Presence is necessary and not sufficient.** An empty allowlist must refuse **everyone**, and a
present-but-empty entry passes a count. Confirm it is non-empty by watching the refusal path reject an
unknown sender when G6 is live, never by printing the value back.

## Traps

1. **A is life, B is finance.** Swapping them is silent.
2. **The token is not the webhook path.** G6 generates random path segments precisely so the token
   never appears in a proxy log. Using the token as the path puts a live credential in access logs.
3. **The allowlist goes in both agent files or in neither.** Asymmetry is worse than absence.
4. **Empty is not open.** `src/server/telegram/auth.ts` treats an absent, empty, over-length or
   out-of-charset expected token as unconfigured and refuses every request, correct token included.
   That is deliberate. If both bots refuse you after G6, suspect a missing entry before a wrong value.
5. **`getUpdates` and a registered webhook are mutually exclusive.** Read your identifier before G6.
6. **Do not add either bot to a group,** even to test. An admin bot receives everything regardless of
   privacy mode.
7. **There is no `/revoke` command.** Rotation is `/token`.
8. **Changes take a few minutes.** Verify after a pause, not instantly.

## Rotation, revocation, deletion

- **Rotate a token:** `/token`, then pick the bot. The previous token stops working immediately, so the
  environment file and the webhook registration must both be updated in the same sitting or that bot
  goes dark.
- **Revoke:** there is no separate revoke. Rotating is the revocation.
- **Delete a bot:** `/deletebot`. This frees the username and cannot be undone.
- **Transfer ownership:** `/mybots`, pick the bot, transfer. Permanent, and no part of this deployment.

## Later, not now: G6

G6 registers both webhooks and is the moment the deployment becomes publicly reachable. It needs all
three of G1 (a hardened host with the configuration directory), G2 (a domain whose two records resolve
to that host and terminate TLS) and G3 (these two tokens). The command and its verification live in the
register's G6 section; the value routing lives in the ledger.

Do not run it early. Registering a webhook before a name resolves and TLS terminates is how a
deployment ends up publicly reachable and broken at the same time.

## Findings raised while writing this file

**F1 - the allowlist has no declared delimiter, and nothing reads it yet.** `ALLOWED_USER_IDS` is
declared in both agent templates and bound to `TelegramTransportConfig.allowedSenderIds` (a
`readonly string[]`) by `src/server/ops/envTemplates.ts`, but no module reads the environment at all:
`process.env` appears in no non-test file under `src/`. So the string-to-array shape - comma-separated,
whitespace-separated, or a serialized array - is undecided. **Recommendation:** write exactly one
identifier as bare digits, with no quotes, no brackets and no spaces, which is the one shape every
plausible parser accepts, and record the delimiter when the loader is specified. Decision owed:
**D-ALLOWLIST**.

**F2 - `MAX_CONNECTIONS` is used by G6 and stored nowhere.** It appears in the register's G6 command and
in its verification line, and `ops/runbook/RATE_LIMIT_POSTURE.md` fixes the posture ("set low"), but it
is in no environment template and in no `ENV_ENTRIES` row. Nothing records the number you chose, so the
verification compares a live value against a number that exists only in your memory, and a rebuild
cannot reproduce it. The provider documents the range as 1 to 100 with a default of 40, and the
architecture note narrows it to the low teens for a single operator. **Recommendation:** record the
chosen value in the untracked worksheet now. Whether it becomes an operator-gated entry is a spec
decision, not an agent's.

**F3 - G3's verification does not check step 3.** Step 3 hardens both bots; the register's verification
block asserts only that two distinct bots authenticate. `getMe` returns `can_join_groups` and
`can_read_all_group_messages`, so both halves of step 3 are machine-verifiable, and section 7a asserts
them here. Adding them to the register is an `ops/` edit and is left for the next ops increment,
because `ops/**` is scanned for declared dotted tokens and a new filename reference there needs a
matching change in `src/server/ops/deploymentParticulars.ts`.

**F4 - correction applied to the untracked worksheet.** `outputs/OPERATOR_URL_WORKSHEET.md` listed
rotation as BotFather `/revoke`. No such command exists in the documented command set; rotation is
`/token`. Corrected there.

## Primary sources

Verified against the provider's own documentation on 2026-08-09, not from memory:

- `https://core.telegram.org/bots/features` - the BotFather guide: `/newbot` and its two prompts, the
  username rules and their permanence, the token shape, `/token` for rotation, `/setjoingroups` and
  `/setprivacy`, privacy mode on by default and the admin exception, `/deletebot`, ownership transfer.
- `https://core.telegram.org/bots/api` - `setWebhook` (`secret_token` 1 to 256 characters from
  `A-Z a-z 0-9 _ -`, echoed in the `X-Telegram-Bot-Api-Secret-Token` header; `max_connections` 1 to 100,
  default 40; supported ports 443, 80, 88, 8443; `drop_pending_updates`), `getUpdates` and its webhook
  exclusion, `WebhookInfo` fields, and the two `getMe`-only fields used in section 7a.
