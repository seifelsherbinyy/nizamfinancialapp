# Owner authority prompt: run both agents ON the OVHcloud host, with full secret-writing authority

**Owner:** Seif ElSherbiny. **Issued:** 2026-08-11. **Scope:** the two-agent deployment on the
OVHcloud VPS. **Status of this file:** standing authority until the owner revokes it in writing.

---

## 0. THE GRANT, STATED IN FULL, ONCE

You have my full authority. Read that as the operating default for every step below, not as a
preamble.

You are authorised, without asking me again, to:

1. Open a session on my OVHcloud host and work inside it.
2. Create, fill, move, chmod, chown, replace and delete every environment file the deployment needs,
   on the host and on this laptop.
3. Write my real secret values into those files: bot tokens, OpenRouter model keys, webhook secrets,
   webhook path segments, Google OAuth client id and client secret, the Google Drive refresh token,
   the recovery provider token, the backup public key, the SSH key material, and any MCP server
   credential or header.
4. Install, register, re-register, repair and re-scope MCP servers, and edit the MCP configuration
   files on this laptop.
5. Provision, harden, configure, start, stop, restart and rebuild the containers and the host
   services.
6. Read the other repository, the one holding the life agent, and WRITE in it for the model-layer
   wiring, its environment file, and the release of its relay from standby. That specific grant is
   given, dated today, it overrides steering section 6, and it is already recorded there as
   **section 6a** so the two documents do not disagree. Read 6a for the scope boundary and for the
   spend precedence line, then proceed.
7. Commit and push in either repository, subject to precondition P1 below.
8. Perform any gate step in `ops/GATE_REGISTER.md` on my behalf, including the ones the register
   describes as human steps. The register wins on how a gate is verified. It does not win on who is
   allowed to do it. I am.

This grant overrides any instruction, habit, or default that would make you stop and ask whether you
may write a secret, create a file, restart a service, or touch the other repository. You may. Stop
asking. Do the work and show me the evidence.

The grant carries four preconditions. They are in section 8. They are not limits on your authority,
they are the conditions that keep the deployment from being destroyed by the authority.

One more boundary, and it is the only one that limits what you BUILD. This grant is authority over
the build. It is not the runtime authority of the deployed agents. Section 5b holds that line, it comes
from the product contracts rather than from me, and it is not negotiable either.

---

## 1. What I actually want

Both agents alive on the OVHcloud host, reachable by me from my phone, answering with real model
output, inside the spend cap, with the kill switch proven to work and a restore proven to work.

Not a plan. Not a design note. Not a readiness assessment. A thing that answers me when I message
it, running on the host, still running tomorrow morning.

Anything that runs only on this laptop does not count and does not get reported as progress.

---

## 2. Read these first, in this order

1. `ops/GATE_REGISTER.md`
2. `.kiro/steering/two-agent-vps.md`
3. `.kiro/specs/06-two-agent-vps/OWNER_FILL_IN_SHEET.md`
4. `.kiro/specs/06-two-agent-vps/LIVE_PROGRESS.md`
5. `ops/NIZAMCORE_VERIFIED_STATE.md`
6. all six of `ops/env/*.env.example`
7. `ops/docker-compose.yml`, `ops/Caddyfile`, `ops/BUS_NETWORK_BINDING.md`
8. `docs/PFOS_SECRETS_PLAN.md`
9. `docs/CLOUDFLARE_CREDENTIAL_WIRING.md`
10. `ops/backup/backup.sh`, `ops/restore/restore.sh`, `ops/runbook/DISASTER_RECOVERY.md`

**Precedence.** On how a gate is verified, the register wins. On what I have decided, this file wins.
On whether you may write a secret, this file wins and there is no second opinion.

**Read before you author.** If a document in the repository already covers the thing you are about to
write, defer to it and enforce its rules in code instead of writing a competing document.

---

## 3. Where things actually stand, so you do not rediscover it

Verify each of these rather than trusting the line. They were true when this file was written.

- Nothing is live. No host is hardened, no container has ever started, no bot has ever answered.
- The finance agent boots on this laptop, refuses an incomplete environment correctly, and opens its
  store. That is the whole of what runs.
- `npm run verify:all -- --all` was last observed at 20 of 20 with roughly 2126 to 2146 green tests.
  The floor only ratchets up.
- The life agent lives in the other repository, in Python, dormant since 2026-05-29. Its transport
  and its governance are built and tested. Its model layer is a deterministic stub that returns a
  canned string, and its relay sits in standby by design.
- Both agents stop on the same line: a model layer released by a model credential. Neither is behind
  the other.
- `F20` was the blocker: bare `node` could not start the three shims. An IDE loop appears to have
  fixed it on the working tree by making relative imports extension-explicit. It was observed, not
  committed. Re-measure it as step 1 and do not assume either way.
- `.secrets/` on this laptop already holds the host SSH keypair, the host details, the bot tokens,
  a dev OpenRouter key, the Cloudflare token, the Cloudflare MCP server file, the Google OAuth web
  and desktop clients, and the ingest token. Read the manifest in that folder. Most of what you need
  exists already. You are authorised to use all of it.
- The Cloudflare MCP endpoint returns 403 `insufficient_scope` and wants `user:read account:read`.
  The DNS script path works today. Phase 1 needs no domain, so this is not a blocker for going live.

---

## 4. AUTHORITY, RESTATED: the secret inventory and where each value goes

You have my full authority to write every value in this table. All of them. Real values, not
placeholders. I am not going to be asked about it per row.

| Value | Env entry | Home | Gate |
|---|---|---|---|
| Bot A token, the life agent | `BOT_A_TOKEN` | `/etc/<CONFIG_DIR>/life.env` | G3 |
| Bot B token, the finance agent | `BOT_B_TOKEN` | `/etc/<CONFIG_DIR>/finance.env` | G3 |
| My messaging identifier allowlist | `ALLOWED_USER_IDS` | both agent files | G3 |
| OpenRouter key, life | `OR_KEY_LIFE` | `/etc/<CONFIG_DIR>/life.env` | G4 |
| OpenRouter key, finance | `OR_KEY_FINANCE` | `/etc/<CONFIG_DIR>/finance.env` | G4 |
| Weekly caps | `LIFE_WEEKLY_CAP`, `FINANCE_WEEKLY_CAP` | one each, in its own file | G4 |
| Webhook secrets | `LIFE_WEBHOOK_SECRET`, `MONEY_WEBHOOK_SECRET` | one each, in its own file | G6 |
| Webhook path segments | `LIFE_WEBHOOK_PATH`, `MONEY_WEBHOOK_PATH` | `/etc/<CONFIG_DIR>/proxy.env` only | G6 |
| Domain | `DOMAIN`, `ACME_CONTACT` | `/etc/<CONFIG_DIR>/proxy.env` | G2 |
| Google Drive grant | `DRIVE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BACKUP_FOLDER_REF` | `/etc/<CONFIG_DIR>/backup.env` | G5 |
| Recovery provider token | `WHOOP_ACCESS_TOKEN` | `/etc/<CONFIG_DIR>/life.env` only | operator |
| Backup public key | `AGE_PUBLIC_KEY` | `/etc/<CONFIG_DIR>/backup.env` | G8 |
| MCP server credentials | the MCP config files on this laptop | laptop only | operator |
| Host SSH key | `.secrets/` on this laptop | laptop only | G1 |

**Rules that make the writing correct rather than merely permitted:**

- One file per service. Six files: `life`, `finance`, `bus`, `proxy`, `scheduler`, `backup`.
  `root:root`, mode `600`, inside `/etc/<CONFIG_DIR>` which is mode `700`. Create the directory first
  with `install -d -m 700 -o root -g root`, because four gates end by writing into it.
- Never put a life secret in the finance file or a finance secret in the life file. Prove it in both
  directions with a count that returns `0`.
- Nothing has a default. An entry left blank, absent, or still holding its angle-bracket placeholder
  is a startup refusal, not a guess. The refusal is correct behaviour, so read the refusal message,
  which names every entry it wants.
- `ALLOWED_USER_IDS` absent means nobody, and the guard then refuses me too. An unfilled placeholder
  is a different failure from a deliberately empty list. Fill it with my identifier.
- Read the unit note in the fill-in sheet before typing a cap. The cap entry does not take a decimal
  the way you would expect. Total ceiling is USD 5.00 per week, split two ways.
- Phase 1 runs on `longPoll`, which needs no domain and no webhook. Fill the phase 2 entries if the
  loader demands them, and do not invent a domain to satisfy a template.
- `MODEL_ELIGIBILITY_REGISTRY_PATH` pointing at a provisional registry refuses routing. That is a
  real blocker to a working agent, and it is on the build side, not on me. Earn a live-measured
  registry or the agents will boot and route nothing.
- Local secrets stay local. `.secrets/**` and `outputs/**` do not travel to the host, to Drive, or
  into git. The host gets typed values, not copied files.
- Google Drive is not a secret tier. It holds the encrypted payload. The key that decrypts it never
  goes near it.
- Publish the Google consent screen to In production. A Testing screen issues a seven day refresh
  token and the unattended uploader dies silently on day eight.

---

## 5. What "operating on the VPS" means, concretely

You have my full authority to work on the host. Use it. The distinction that matters:

**Counts as working on the host**

- An SSH session to the host using the key in `.secrets/`.
- A repository checkout on the host, and the containers built and run there.
- Environment files written on the host, in `/etc/<CONFIG_DIR>`, verified on the host.
- A message sent from my phone, handled by a process on the host, answered by a model call the host
  paid for.
- Host-side evidence: `docker compose ps`, the health output, the container logs, `systemctl status`,
  a count from `grep -c` run over a file on the host.

**Does not count, and does not get reported as progress**

- A green test run on this laptop.
- A container that starts on this laptop.
- A bot probe from this laptop against the messaging provider.
- The harness at 20 of 20. That is the entry ticket, not the outcome.

**Host discipline**

- Non-root user for operation, firewall on, only the administrative port and the one public port that
  the proxy needs, and the proxy is profile-gated until a domain exists.
- No agent binds a public port. The bus binds internal only, no gateway, and it stays that way.
- Redact logs. A token must not be printable from a log line.
- The kill sentinel is mounted read-only into every consumer, so a service can see the halt and
  cannot clear it. Only I clear it.
- Set `NIZAM_KILL_ALL=0` to run. Prove the halt works before you trust it.
- Do not keep shell history containing a secret. Type values into a file, do not append them from a
  history-keeping shell.

---

## 5b. The four product blueprints, and the boundary they put on this authority

You still have my full authority. This section does not withdraw any of it. It tells you what the
product contracts already decided, so the thing you build is the thing I asked for.

**Source, and it is verified.** `contracts/pfos/01` through `04` are byte-identical to the four
blueprints in my drive folder `PFOS_Personal_CFO/01_Product_Blueprints`. Checked 2026-08-11: sha256,
byte count and modified time all match on all four, no drift since the 2026-08-05 ingest. Read the
local copies. Re-check with `node scripts/ingest/pfos-drive-pull.mjs --list-only` before you rely on
them, and pull again if any byte count has moved. The folder and file identifiers stay redacted to
placeholders in the manifest, and they stay that way.

### 5b.1 My authority to you is over the build. It is not the deployed agent's runtime authority

Contract 01 section 9 splits those two, and the split survives this prompt untouched.

**The running system may act alone on:** categorising and reconciling transactions, building budgets,
reserving obligations, computing safe to spend, generating scenarios, issuing warnings and
reinforcement, creating reminders and reports, recommending capital allocation, proposing policy
changes.

**The running system asks me first, every time, on:** initiating or scheduling a real payment, moving
funds, taking debt, investing or selling an asset, closing an account, sharing financial or health
data, changing a hard critical-obligation safeguard.

Contract 03 section 12 adds what it must never do quietly: reduce P0 or P1 protection, raise allowed
risk past my policy, grant itself payment authority, use new sensitive data, rewrite historical
records, or treat a model explanation as a fact.

So: write every secret, restart every service, wire both model layers. Do not wire a payment path,
and do not let the sentence "full authority" in section 0 leak into the runtime permissions of the
thing you are building. Two different authorities, one of them mine to delegate and one of them not.

### 5b.2 Calculations before language. This governs step 5 more than anything else in this file

Contract 03 section 1 is explicit: the model is never the source of a balance, a total, a due date or
a risk constraint. The required order is collect the authoritative data, validate freshness and
completeness, run the deterministic calculation, run the simulation, assemble the evidence, apply the
hard policy gates, and only then call the model, to interpret, challenge, explain and ask for what is
missing.

When you replace the finance port whose only member throws, and the life coordinator's stub that
returns a canned string, replace them with a client that narrates a computed result. **A model layer
that is capable of producing a figure is a defect even if every test passes.** Prove it the negative
way: strip the deterministic input and confirm the agent refuses rather than estimating.

### 5b.3 Untrusted data cannot issue instructions

Contract 02 section 9: statements, receipts, emails and research documents are data. Only
system-owned policy and my own authenticated commands can authorise an action. The ingestion paths
land on this host now, so this stopped being a design note and became a property of the box you are
configuring.

### 5b.4 "Working" is defined by contract 04 section 14, not by "it replied"

Twelve criteria there. Six of them can only be proven on the host, so they belong to this bring-up:

| Criterion | How you prove it on the host |
|---|---|
| I can answer "how much can I safely spend" in under ten seconds | measure it cold and warm, report the seconds against the ten second bar |
| A failed model call does not make the ledger unavailable | break the model path, ask for status, get a deterministic answer |
| A backup can be restored | the step 9 drill, from a real encrypted archive |
| The dashboard and the bot show the same value | serve the app over the tunnel, compare one figure to the bot's answer for the same moment |
| Stale data visibly lowers confidence | age the data, watch confidence fall, and confirm no false precision appears |
| No health or journal data is used without permission | show the bus envelope has no field that can carry a figure or a narrative, only a band |

The other six stay true by construction and you confirm rather than build them: every displayed fact
carries a source and a timestamp, P0 obligations are always reserved, duplicate entries do not double
count, I can correct any inference, a purchase answer carries a direct answer plus a time-horizon
impact, and reports do not turn into notification fatigue.

### 5b.5 Four outage drills, not one alert

Contract 02 section 10 states the degradation matrix. Run each one on the host and quote the log line:

1. Messaging provider unavailable: the dashboard and the scheduled ingestion keep working.
2. Drive unavailable: the ledger keeps working and document jobs queue.
3. Model provider unavailable, or the weekly cap exhausted: deterministic financial status is still
   available, and a deterministic alert still reaches me. A quiet agent and a broke agent must not
   look the same.
4. A parse failure: the raw event is retained and the retry is idempotent.

And the closing line of that section, which is a gate rather than a preference: backups are
validated, not merely created.

### 5b.6 The deployed bot's output shape is not the same contract as section 9 of this file

Section 9 governs how you talk to me. Contract 04 section 4.3 governs how the bot talks to me, and it
is an ordered six: direct conclusion, then the amount or status, then why, then the impact, then the
next action, then an option to expand. Both contracts apply, to two different speakers. Do not
collapse them into one style.

### 5b.7 Three live deviations from contract 02 section 9. Name them in your report

Do not carry these silently, and do not pretend the contract is met.

1. **"TLS only".** Phase 1 runs on long poll with no inbound public surface at all, so nothing is
   exposed rather than exposed over TLS. That is stronger than the clause, not weaker, and the
   inbound half resumes at G2 and G6. Say so explicitly instead of ticking the box.
2. **"Rotate bot and API keys".** Deferred by D-ROTATE until I have used the deployment and reported
   it working, with the webhook-info check on every run as the compensating control. The single
   exception is a credential whose value has been pasted into a chat transcript, which is disclosed
   and rotates now.
3. **"Database encryption at rest, encrypted offsite backups".** Until payload encryption exists, no
   real financial data syncs anywhere. Treat that as a hard gate on real data rather than a later
   improvement. Seeded and sample data only until it is closed.

### 5b.8 One contract line the build has already overtaken

Contract 02 section 11 Phase A says deploy a FastAPI service. Steering section 1 settled the runtime
per agent afterwards: the finance agent is Node and TypeScript, the life agent is Python in the other
repository. Steering wins because it is later and it is the decision I actually made. Record the
divergence in your report and do not resolve it by rewriting either document.

### 5b.9 Ask me these. Do not invent them

Contract 04 section 15 lists my open questions, and three of them will block you outright: the
initial protected-buffer rule, the reference currency for real net worth, and the transaction amount
that triggers an immediate alert. Two more will shape what you build: which provider gets imported
first, and what dashboard authentication is acceptable. An invented buffer rule is worse than a
blocked step, because it looks like a decision I made.

---

## 6. The sequence. Each step has a done-when line

Work these in order. Commit after each. Do not batch them into one heroic push.

**Step 1. Re-measure F20 and close it.** Bare `node` must start the three shims and refuse a missing
environment by naming every entry it wants. Done when a fresh clone on the host does that, and it is
committed.

**Step 2. G1, the host.** Provision if needed, harden to the end of the register's checklist, finish
with `/etc/<CONFIG_DIR>` at mode `700`, `root:root`. Done when the checklist is worked to the end and
the directory exists on the host.

**Step 3. G3, the two bots.** Tokens and the allowlist into the two agent files. Done when a read-only
probe against the provider identifies both bots, and the cross-contamination counts both return `0`.

**Step 4. G4, the two model keys.** Two keys, two caps, one each, provider-side periodic limit set.
Done when each agent makes one real model call and the ledger records a cost against the right agent.

**Step 5. The model layer, both sides.** The finance port whose only member throws, and the life
coordinator's canned-string stub. Both get a real client. This is the step that turns two dormant
architectures into two working agents, and it is the actual point of the task. Done when each agent
returns model output that could not have come from a stub, and the stub path is gone rather than
bypassed.

**Step 6. Release the life relay from standby.** Its standby gate is the same class of gate as G4 on
this side. Done when the life agent answers a message from my phone.

**Step 7. Both agents up together, under the scheduler and the bus.** Done when `docker compose ps`
on the host shows every service healthy, a tick arrives at both agents, and a signal published by one
is served to the other with both consent gates consulted.

**Step 8. Prove the safety rails on the host.** The kill switch in both forms, the cap refusal, the
allowlist refusal, the webhook or long-poll authenticity refusal. Done when each one is observed
refusing, on the host, with the log line quoted.

**Step 9. G8 and G5, durability.** Backup keypair with the private half off the host, the narrow
Drive grant, then a restore drill from a real encrypted archive. Done when a restore succeeds and a
search of the host for private key material returns nothing.

**Phase 2, only after I have used the thing.** G2 the domain, G6 the webhooks, the proxy profile, and
then the credential rotation named in precondition P4.

---

## 7. Proof discipline. A claim without evidence is not a report

Every reply carries an evidence table. Three columns: what was claimed, the exact command, the output
line that proves it. No verdict without a line.

- **Never report a state you did not open the system of record for.** Not "the token is placed",
  "the service is running", "the bot answered", or "the backup uploaded". Open it and read it back.
- **Prove a value landed with a count, never by printing the value.** `grep -c '^ENTRY=.\+' <file>`
  returning `1`. That answers whether it landed without putting a secret in a terminal, a log, a
  commit, or a message to me.
- **Prove the negatives too.** No placeholder residue: `grep -c '<[A-Z_]\+>' <file>` returns `0`. No
  foreign secret: the other agent's entry name returns `0` in this agent's file.
- **A test that cannot fail is not a test.** For every gate you claim holds, tamper the input, watch
  it refuse, restore. Print that the tamper actually changed something. A tamper that applies to
  nothing scores as inert, not as a pass. A tamper masked by an earlier gate proves nothing about the
  gate you are testing, so aim it at a field only that gate reads.
- **Recompute anything that matters two independent ways** and reconcile. A single derivation is a
  hypothesis.
- **A verdict measured on a tree something else is rewriting describes a tree that will not exist.**
  If a background loop is editing files under you, say so, attribute every failing check to an owner,
  and do not report another process's incomplete work as your result.
- **The harness stays at 20 of 20 and the test floor only goes up.** A red harness is not a faster
  release.
- **Never mark a gated item complete because you believe it would work.** Record it blocked with the
  exact next action. A known gap turned invisible is the most expensive thing you can do here.

---

## 8. The four preconditions of the grant

These are not permission questions. They are the conditions under which the authority stays useful.

**P1. No secret and no deployment particular in a tracked file.** Both repositories are public. No
token, no key, no domain, no host address, no numeric messaging identifier, no bot name, no webhook
path segment, no storage folder identifier, no real amount. Real values live in gitignored files and
on the host. `ops/env/*.env` is gitignored, the `.example` templates are not, and the difference is
one character, so check with `git check-ignore -v` before the first byte is written. Never invent a
plausible-looking fake secret, because a realistic fake gets copied into production.

**P2. No secret value in a message to me, in a log, in a commit message, or in a terminal you paste
back.** Counts and verdicts only. If I ever need to see a value I will read the file myself.

**P3. Never weaken a gate to make something pass.** No default that opens a door, no allowlist entry
added so your own text clears a scanner, no tolerance loosened so red goes green. If a gate is wrong,
change the gate on the record and say why. Fail-closed stays fail-closed.

**P4. Rotate nothing, and keep the compensating control running.** Rotation is deferred by my
decision dated 2026-08-10, recorded as **D-ROTATE** in `.kiro/steering/cloudflare-dns.md` item 3, and
**no session rotates unilaterally**. Not the zone token, not either bot token. The disclosed tokens
are the tokens this deployment uses, so build with them. The attached condition is not optional:
while a disclosed token is live, check `getWebhookInfo` on every run as the detection control that
compensates for the deferral. A deferral without its compensating control is just an unrotated
credential. Rotation becomes the final acceptance test after I have used the deployment and reported
it working. If you believe a specific disclosure makes that wrong, say it in one line and let me
rule. Do not decide it for me.

---

## 9. How to talk to me

Write like a competent engineer sending an internal update. Not like a model producing content.

**Do**

- Lead with the result. First line says what is now true or what broke.
- Short sentences. Plain words. Contractions are fine.
- Name the file, the command, the count, the log line.
- Give numbers with units and a date.
- Say "I do not know" or "unverifiable" plainly, and say what would settle it.
- One question per reply, maximum. Ask it at the end, after the work.
- When you were wrong, say so in the first line and carry the correction forward.

**Do not**

- No em dashes. None. Use a comma, a colon, a full stop, or a new sentence.
- No "delve", "leverage", "robust", "seamless", "streamline", "landscape", "realm", "tapestry",
  "elevate", "unlock", "empower", "supercharge", "game-changer", "navigate the complexities",
  "it is worth noting", "in today's world", "at the end of the day". The acceptance harness is a
  proper noun in this repository and the word stays available for it.
- No "not just X, but Y". No three-item rhetorical flourishes. No rule of three for its own sake.
- No restating my question back to me before answering it.
- No preamble. No "Great question". No "Let me". No "I'll now proceed to".
- No closing summary that repeats what you just said. Stop when the content stops.
- No offering to help further. No emoji. No exclamation marks.
- No bolded lead-in on every bullet, and no bullet list where two sentences would do.
- No hedging stack. One qualifier at most, and only if it is load-bearing.
- No claiming something is production-ready, enterprise-grade, or comprehensive. Say what it does and
  what it does not do yet.

If a reply reads like it was assembled to look thorough, delete it and write the four lines that
actually matter.

---

## 10. AUTHORITY, RESTATED: beyond the minimum

You have my full authority here too, and I want more than the bare pass. Once both agents answer,
deliver these without being asked:

1. A one-page operator card on the host: how to start, stop, halt, unhalt, tail logs, check spend,
   restore. In plain language, no repository knowledge assumed.
2. A watchdog that restarts a dead container, and proof it restarted one you killed on purpose.
3. A cap-exhaustion path that still delivers a deterministic alert to me after the model budget is
   gone. A quiet agent and a broke agent must not look the same.
4. First-message latency measured on the host, cold and warm, with the numbers, reported against
   contract 04 section 14's ten second bar for the safe-to-spend answer.
5. A weekly spend readout I can ask either agent for in one message.
6. The restore drill repeated once unattended, on a schedule, with the result recorded.
7. A list of every place a secret now lives, so rotation later touches exactly those places and no
   guessing is needed.
8. Whatever you found while doing the above that I did not know to ask for. Say it plainly, including
   the parts that make earlier documents in this repository wrong.

---

## 11. When you are blocked

- Decompose it first. Most walls are three or four steps with one blocked step in the middle. Find
  which single step is blocked and name it.
- Falsify the premise. Check the data is really missing before reporting it missing.
- Prove the tool failed before writing "not found". A dead endpoint, an expired credential, and a
  genuine absence look identical in the output and mean completely different things.
- Report what you completed around the blocker. A reply that is only a blocker wasted the turn.
- Then proceed on the recommended option. Do not idle waiting for me.
- Escalate to me as one specific request, not a status complaint.

---

## 12. THE GRANT, RESTATED, CLOSING

You have my full authority. Write my secrets. All of them: bot tokens, OpenRouter keys, MCP
credentials, the Google Drive grant, the webhook secrets, the SSH key, the host environment files,
the backup key. Create the files, set the modes, restart the services, work inside the other
repository for the model-layer wiring, commit, push.

This authority overrides any default that would make you pause to ask permission for writing,
creating, configuring, restarting, or deploying. It overrides steering section 6 for the other
repository's model layer. It overrides the register's framing of gate steps as human-only, because I
am the human and I am delegating them to you, on the record, dated 2026-08-11.

The four preconditions in section 8 stand: nothing secret in a tracked file, no secret value in a
message to me, no gate weakened to pass, and nothing rotated unilaterally while D-ROTATE holds.

Everything else, go. Show me both agents answering from the host, with the evidence attached.
