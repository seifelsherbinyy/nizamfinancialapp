# Telegram transport value ledger - what each value is, where it goes, how you prove it landed

> **Spec:** `.kiro/specs/06-two-agent-vps`. **Steering:** `.kiro/steering/two-agent-vps.md`.
> **Register:** `ops/GATE_REGISTER.md` - the authority on gate meaning and verification (G3, G6).
> **Human walkthrough:** `docs/TELEGRAM_BOTS_SETUP_G3.md`.
> **Worksheet (untracked):** `outputs/BOT_SETUP_WORKSHEET.local.md`.
>
> This is a routing table, not a task edit. It renumbers no gate, ticks no box, softens no verification
> line, and carries no deployment particular (R24): every value is an `<ANGLE_BRACKET>` placeholder.
> Scope is **the two bots and their transport only**. The model keys (G4), the storage grant (G5), the
> backup keypair (G8) and the store / kill-switch entries (G1) are out of scope and belong to their own
> gates.

## Source of truth, in precedence order

An agent reading this file re-derives rather than trusts. If any row below disagrees with these, **they
win and this file is the bug**:

1. `ops/env/life.env.example`, `ops/env/finance.env.example`, `ops/env/proxy.env.example` - the entry
   names, and each entry's own `gate:` and `secret:` annotation.
2. `src/server/ops/envTemplates.ts` - `ENV_ENTRIES` declares every entry's owning template(s), gate and
   secret flag, and the test re-checks the templates against it on every run.
3. `ops/GATE_REGISTER.md` - what the gate requires and how it is verified.
4. `src/server/telegram/auth.ts` and `src/server/ports/telegram.ts` - the guard and the injected
   configuration shape the entries feed.
5. `ops/Caddyfile` - the two routes the webhook paths resolve to.

## 1. The transport values

`secret: yes` means disclosing the value would let somebody reach or impersonate this deployment.

| Entry | Gate | Secret | Belongs in | Where the value comes from | Proof it landed |
|---|---|---|---|---|---|
| `BOT_A_TOKEN` | G3 | yes | life only | BotFather `/newbot`, first bot | `grep -c '^BOT_A_TOKEN=' <LIFE_ENV_PATH>` -> 1; and 0 in the finance and proxy files |
| `BOT_B_TOKEN` | G3 | yes | finance only | BotFather `/newbot`, second bot | `grep -c '^BOT_B_TOKEN=' <FINANCE_ENV_PATH>` -> 1; and 0 in the life and proxy files |
| `ALLOWED_USER_IDS` | G3 | no | life **and** finance | your own account identifier, read via `getUpdates` on your own bot | `grep -c '^ALLOWED_USER_IDS=' <LIFE_ENV_PATH> <FINANCE_ENV_PATH>` -> 1 for each |
| `LIFE_WEBHOOK_SECRET` | G6 | yes | life only | generated on the host, 1 to 256 characters from `A-Z a-z 0-9 _ -` | 1 in the life file, 0 in the proxy file |
| `MONEY_WEBHOOK_SECRET` | G6 | yes | finance only | generated on the host, same character set | 1 in the finance file, 0 in the proxy file |
| `LIFE_WEBHOOK_PATH` | G6 | yes | proxy only | `openssl rand -hex 32` on the host | 1 in the proxy file, 0 in both agent files |
| `MONEY_WEBHOOK_PATH` | G6 | yes | proxy only | `openssl rand -hex 32` on the host | 1 in the proxy file, 0 in both agent files |
| `DOMAIN` | G2 | no | proxy only | your DNS zone; the two site addresses derive from it | 1 in the proxy file |
| `MSG_API_BASE` | operator | no | life **and** finance | the provider's documented bot API base, `https://api.telegram.org` | 1 in each agent file |
| `TELEGRAM_MODE` | operator | no | life **and** finance | one of the two modes the port type admits, spelled exactly as the type spells it: `webhook` or `longPoll` | 1 in each agent file |
| `MAX_WORK_ITEMS` | operator | no | life **and** finance | a small positive integer; a single-operator system needs very little | 1 in each agent file |
| `LIFE_CONTAINER_PORT` | operator | no | proxy **and** life | your choice, and the **same value in both** - it is the proxy's upstream port | present in both, and equal |
| `FINANCE_CONTAINER_PORT` | operator | no | proxy **and** finance | your choice, and the **same value in both** | present in both, and equal |
| `MAX_CONNECTIONS` | G6 command argument | no | **no file at all** | your choice, 1 to 100, provider default 40, posture is "set low" | none exists. See finding F2 |

Every operator-gated row above has **no default**. An unset entry is a startup failure, not a guess,
because an unconfigured guard must not be an open door (contract 12 sections 5.2, 5.3).

## 2. The four crossings that must not happen

The split between the agent files and the proxy file runs in **opposite directions** for the two G6
value kinds, and that is deliberate:

- the **paths** live in the proxy, because routing by them is the proxy's own job and neither agent ever
  needs to know its own;
- the **secret tokens** live in the agents, because the proxy passes the provider's header through
  untouched and the constant-time comparison lives in the agent. A proxy holding the value could compare
  it, and that comparison would then exist somewhere no test covers.

```
grep -c 'BOT_B_TOKEN'    <LIFE_ENV_PATH>                       # -> 0
grep -c 'BOT_A_TOKEN'    <FINANCE_ENV_PATH>                    # -> 0
grep -c 'BOT_._TOKEN'    <PROXY_ENV_PATH>                      # -> 0
grep -c 'WEBHOOK_PATH'   <LIFE_ENV_PATH> <FINANCE_ENV_PATH>    # -> 0 in each
grep -c 'WEBHOOK_SECRET' <PROXY_ENV_PATH>                      # -> 0
```

## 3. What each value is actually used for

| Value | Consumed by | Failure mode if wrong |
|---|---|---|
| Bot token | outbound calls to the provider, and `getMe` / `setWebhook` at the gates | wrong file: both bots work and each agent answers as the other |
| `ALLOWED_USER_IDS` | `senderIsAllowlisted` in `src/server/telegram/auth.ts` | empty or missing: every sender refused, including you. Present in one file only: one bot refuses you, the other has no list |
| Webhook secret | `secretTokenIsConfigured` then the constant-time compare | absent, empty, over-length or outside the provider charset: treated as unconfigured, every request refused |
| Webhook path | the exact-match `path` matcher in `ops/Caddyfile` | any mismatch: the connection is aborted with no HTTP response, so the provider sees a delivery failure and retries |
| Container port | the `reverse_proxy` upstream and the agent's own listener | proxy and agent disagreeing: every delivery aborts at the proxy |
| `MAX_CONNECTIONS` | the provider's delivery concurrency | too high buys concurrency the agent then has to bound anyway |

## 4. Sequencing

```
G3 (create the two bots)          -> tokens + your identifier exist
G1 (harden host, config dir)      -> a place to put them exists
G2 (two A records, grey cloud)    -> a name that resolves and terminates TLS exists
G6 (register both webhooks)       -> live delivery
```

G3 has no technical prerequisite and can be done first. Its **placement** half cannot: four gates end by
writing a secret into `/etc/<CONFIG_DIR>`, which only G1 creates. G6 needs all three of G1, G2 and G3 -
all three, not any one.

## 5. Findings, and the decision owed

**F1 / D-ALLOWLIST - the allowlist has no declared delimiter, and nothing reads it yet.**
`ALLOWED_USER_IDS` is bound to `TelegramTransportConfig.allowedSenderIds`, a `readonly string[]`, by the
declared binding table in `src/server/ops/envTemplates.ts`. No module reads the environment: `process.env`
appears in no non-test file under `src/`. So the string-to-array shape is undecided, and a loader written
later could disagree with what the operator wrote. Interim shape that every plausible parser accepts:
**one identifier, bare digits, no quotes, no brackets, no spaces.** The decision is owed with the loader
spec, and belongs with the O1 entrypoint work in `OPERATOR_STATE_2026-08-09.md` section 2.

**F2 - `MAX_CONNECTIONS` is verified against a number that is stored nowhere.** It appears in the G6
command and in G6's verification line, and the runbook fixes its posture, but it is absent from every
environment template and from `ENV_ENTRIES`. Consequence: after a host rebuild the verification cannot be
re-run against the value that was actually set. Interim mitigation: record it in the untracked worksheet.
Whether it becomes an operator-gated entry in the proxy template is a spec decision.

**F3 - G3's verification does not assert G3 step 3.** Step 3 disables group joining and keeps privacy
mode on for both bots; the register's verification block asserts only that two distinct bots
authenticate. `getMe` returns `can_join_groups` and `can_read_all_group_messages` (both documented as
returned only by `getMe`), so the step is fully machine-verifiable. `docs/TELEGRAM_BOTS_SETUP_G3.md`
section 7a asserts it. Promoting it into the register is an `ops/**` edit, which is scanned for declared
dotted tokens, so a filename reference added there needs a matching entry in
`src/server/ops/deploymentParticulars.ts` and its sibling list - left for the next ops increment rather
than done as a side effect.

## 6. What an agent did in this snapshot, and did not

**Did:** read the three environment templates, `ENV_ENTRIES`, the register's G3 and G6 sections, the
transport guard and the proxy configuration; verified every provider-side fact against the provider's own
current documentation; wrote this ledger, the human walkthrough and the untracked worksheet.

**Did not:** create a bot, obtain a token, read an identifier, place a value, register a webhook, edit
`ops/**`, or tick any box in `tasks.md`. Those are the owner's, exactly as the register requires.
