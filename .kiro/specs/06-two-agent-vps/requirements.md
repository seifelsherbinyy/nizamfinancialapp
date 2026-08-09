# Requirements - Two-Agent VPS Tier (life + finance)

> Owning contracts: **06** (Database & Knowledge Model) + **12** (Two-Agent VPS Deployment & Operations),
> both to be authored in Phase 0. Steering: `.kiro/steering/two-agent-vps.md` (authoritative for this area).
> Design source: `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`.

## Scope

Two Telegram agents on one VPS, logically isolated, sharing one OpenRouter account:
**life** (journaling, recovery, WHOOP context - lives in `nizamcore`) and **finance** (budgeting,
transactions, forecasting, safe-to-spend - lives in this repo).

This spec covers only what is buildable **without a VPS and without a production secret** (steering §2),
plus the text artifacts and the gate register needed to hand the remainder to a human.

## EARS acceptance criteria

### Data layer (Contract 06)
- **R1** WHEN the finance server opens its store, THEN it SHALL use a local SQLite file with `journal_mode=WAL`
  and `foreign_keys=ON`, and SHALL NOT open any file belonging to another agent.
- **R2** WHEN a monetary value is persisted, THEN it SHALL be an integer number of milliunits, and any
  non-integer SHALL be rejected at the boundary with a typed error.
- **R3** WHEN a migration runs, THEN it SHALL be idempotent and SHALL record its version, so a re-run is a no-op.
- **R4** WHERE the server derives a figure the browser also derives, THEN both SHALL produce a bit-identical
  result from the same inputs (one money implementation only).
- **R5** WHEN a model call completes, THEN its actual reported cost SHALL be appended to a spend ledger
  keyed by agent, and the weekly total SHALL be readable as a pure function.

### Isolation and consent (Contract 12)
- **R6** WHEN either agent attempts to read the other agent's database file, THEN the attempt SHALL fail.
- **R7** WHEN a signal is published, THEN it SHALL validate against the signal envelope schema, and a payload
  containing a balance, a due date, an account identifier, or free text over 120 characters SHALL be rejected.
- **R8** WHEN a subscriber requests a signal whose `consent_scope` is `producer_only`, THEN the bus SHALL refuse it.
- **R9** WHEN the signal bus is addressed from outside the internal network, THEN the connection SHALL be refused.
- **R10** WHERE content classifies as `strict_local_maximum`, THEN no artifact in this tier SHALL reference,
  store, or transmit it.

### Transport (Contract 12)
- **R11** WHEN a webhook request arrives without the secret-token header, or with a mismatched token, THEN the
  handler SHALL reject it, and the comparison SHALL be constant-time.
- **R12** WHEN a webhook request arrives from a user id absent from the allowlist, THEN the handler SHALL reject it.
- **R13** WHEN the same update identifier is delivered twice, THEN the second delivery SHALL produce no side effect.
- **R14** WHERE two bots run on one host, THEN dedup state SHALL be namespaced per bot, because update
  identifiers are per-bot sequences and would otherwise collide.
- **R15** WHEN an update is accepted, THEN the handler SHALL acknowledge promptly and process asynchronously,
  so a slow downstream call cannot cause a delivery retry.
- **R25** WHEN the environment loader reads `ALLOWED_USER_IDS`, THEN it SHALL separate elements on any run of
  commas, semicolons, or whitespace in any combination; SHALL accept an element only if it is a bare run of
  digits; SHALL yield an empty list when the entry is absent, empty, or whitespace-only; and SHALL refuse a
  malformed element or an unsubstituted placeholder as a startup failure with a named error code rather than
  admitting it and refusing the sender at delivery time.

> **Decision note - D-ALLOWLIST (SETTLED 2026-08-10; see "Decision note - the seven owner rulings" below).**
> The ruling is comma-separated, surrounding whitespace trimmed, a single bare identifier must parse. R25's
> delimiter is a strict superset of it, so **R25 is unchanged by the ruling** and the analysis below still
> holds as written. Raised as F1 in
> `TELEGRAM_VALUE_LEDGER.md` §5 and as **D-ALLOWLIST** in `OPERATOR_STATE_2026-08-09.md` §3. The operator's
> interim shape is one identifier, bare digits, no quotes, no brackets, no spaces. R25's delimiter is a strict
> **superset** of that shape, so a value already written by hand keeps parsing to the same one-element list.
> Alternatives rejected, and why:
> - **A JSON array.** The environment template subset refuses a quoted value outright
>   (`src/server/ops/envTemplates.ts`, `parseEnvTemplate`), so the file this entry lives in cannot hold one.
> - **Comma only, or whitespace only.** Neither is a superset of the other, and an operator adding a second
>   identifier will reach for whichever the rule excluded. That element then fails the digit shape and the
>   boot is refused - safe, but for a reason the operator did not cause.
> - **Accepting any non-empty element.** `senderIsAllowlisted` resolves membership by exact string identity, so
>   a stray quote or bracket refuses the only sender on the list with a refusal that §5.2 makes deliberately
>   indistinguishable from a wrong secret token. Refusing at startup is the only form of that mistake anybody
>   can diagnose.
> - **Stripping quotes or brackets leniently.** That silently rewrites an identifier the operator typed, and the
>   exact-string comparison then cannot tell a rewritten identifier from a correct one.
>
> An **absent** entry still yields an empty list rather than a startup failure, because an empty allowlist is a
> meaningful configuration - it means nobody - and `senderIsAllowlisted` already refuses every sender under it.
> An **unfilled placeholder** is refused, because that is a mistake rather than a decision.

- **R26** WHERE the transport mode is `longPoll`, THEN the secret-token check SHALL be **not applicable** -
  there being no inbound HTTP request and therefore no `X-Telegram-Bot-Api-Secret-Token` header to consult -
  AND the allowlist SHALL be the whole of the guard, so a sender absent from the allowlist SHALL still be
  refused and an empty allowlist SHALL still refuse every sender; WHERE the transport mode is `webhook`, THEN
  an absent, empty, over-length, or out-of-charset expected token SHALL continue to refuse every request
  exactly as R11 requires, and no clause of this requirement SHALL be read as relaxing it; AND the refusal
  SHALL remain indistinguishable as to which check failed in both modes.
- **R26.1** WHEN an update is delivered in either mode, THEN de-duplication SHALL be resolved on the
  `(bot, update)` pair per R13 and R14 in both modes; AND WHERE the mode is `longPoll`, THEN the read offset
  SHALL advance **only after the update is durably enqueued**, so a crash before the enqueue commits
  re-delivers the update rather than losing it.

> **Trap note - R26 (the reason this requirement is mode-aware rather than shared).** Owner mandate
> `KIRO_SHIP_LIVE.prompt.md` §2 records this as the failure that costs a day if missed, and it is a property
> of the code as it stands rather than a hypothetical. `authorizeDelivery` in `src/server/telegram/auth.ts`
> evaluates all three gates unconditionally and then reads the verdicts in the order configuration, token,
> allowlist - so `secretTokenIsConfigured` is consulted **first**, and an expected token that is absent,
> empty, over-length, or outside `[A-Za-z0-9_-]` refuses **every** request, including one carrying what a
> reader would think is the right token. That is correct and deliberate for `webhook`: it is R11's fail-closed
> clause, and it stays.
>
> `longPoll` is outbound only. The agent calls the provider and reads updates back; there is no inbound
> request, so there is no header, so `subject.secretTokenHeader` is `null` and there is no expected token for
> it to match. Reusing the webhook guard unchanged therefore refuses **every** message the owner sends, and
> presents as a bot that was created, hardened, verified live, and is silently broken - a failure whose
> symptom is identical to a wrong token, which is by design (§5.2 rule 4) and is what makes it expensive.
>
> What "not applicable" does **not** mean, stated because the distinction is the whole requirement:
> - It is **not** a default that opens a door. The allowlist becomes the entire guard, and the allowlist
>   refuses by default: `senderIsAllowlisted` returns false for an empty list and for an empty sender
>   identifier, so an unconfigured `longPoll` deployment admits nobody, exactly as an unconfigured `webhook`
>   deployment admits nobody.
> - It is **not** one code path serving both modes. The mandate is explicit that the webhook path is not to
>   be relaxed so a single branch can cover both, and R26's two `WHERE` clauses are deliberately asymmetric
>   so a shared implementation cannot satisfy both halves by weakening one.
> - It is **not** a claim that `longPoll` is as strong as `webhook`. It is weaker by exactly one gate, and
>   that is the price of shipping without a domain. The compensating control is that `longPoll` publishes no
>   host port at all, so the attack surface the secret token defends - an unauthenticated inbound request
>   from anywhere on the internet - does not exist in this mode.

### Model routing (Contracts 09/10/11, extended)
- **R16** WHEN a turn is classified `T0`, THEN no model SHALL be invoked.
- **R17** WHEN the weekly cap for an agent is exhausted, THEN model calls for that agent SHALL be refused, the
  other agent SHALL be unaffected, AND deterministic obligation alerts SHALL still be produced.
- **R18** WHEN a model is selected, THEN it SHALL be present in the eligibility registry, and a registry marked
  `provisional` SHALL NOT permit live routing.
- **R19** WHEN a model call is issued, THEN the request SHALL carry the provider privacy policy, and no prompt
  text SHALL be written to any log.

### Public-repository posture (steering §0b)
- **R24** WHERE the repository is public, THEN no tracked file SHALL contain a deployment particular (a real
  domain, IP, Drive identifier, numeric Telegram user id, bot username, or real monetary figure), AND a
  harness check SHALL fail closed if one appears.

### Operations (Contract 12)
- **R20** WHEN a backup runs, THEN it SHALL produce a transactionally consistent snapshot, encrypt it to a public
  key whose private half is not present on the host, and shred the plaintext.
- **R21** WHEN a restore is exercised, THEN the restored database SHALL pass an integrity check before being trusted.
- **R22** WHEN a service becomes unhealthy, THEN its health endpoint SHALL report failure and the orchestrator
  SHALL restart it.
- **R23** WHERE an operation requires a human (steering §2 G1-G8), THEN it SHALL appear in a gate register with
  the exact steps, and SHALL NOT be attempted or reported as done.

### Configuration, process and images (Contract 12, added by Phase 10)

- **R27** WHEN the environment loader resolves a configuration, THEN it SHALL cover all six services the
  deployment declares - life, finance, proxy, bus, scheduler, backup - rather than the two agents alone;
  SHALL preserve exactly **one** bridge to the ambient process environment in the whole of `src/`, so the
  tree scan that asserts it keeps exactly one permitted hit; SHALL name **every** missing, empty, or
  unsubstituted entry in a **single** message rather than refusing on the first one it meets; SHALL supply
  **no default** for any entry, so an unset entry is a startup failure and never a guess; AND SHALL treat a
  value still holding its own `<ANGLE_BRACKET>` placeholder as a failure rather than as a value, because a
  copied-but-unfilled template is a mistake rather than a decision.
- **R28** WHERE the repository owns a container image the deployment runs, THEN a Dockerfile for that image
  SHALL exist in this repository, AND a documented build path SHALL produce the exact tag
  `ops/docker-compose.yml` references for it; AND no image reference in that file SHALL remain a placeholder
  that nothing builds.
- **R29** WHEN the finance-agent process starts, THEN it SHALL refuse to boot on an incomplete environment
  rather than boot degraded; SHALL honour the kill sentinel in **both** of its forms - the sentinel file at
  `KILL_SENTINEL_PATH` and `NIZAM_KILL_ALL=1` - halting model calls, model-path writes and bus publishes;
  WHERE the transport mode is `longPoll`, THEN it SHALL bind **no** public port; AND WHERE the transport mode
  is `webhook`, THEN it SHALL listen on `FINANCE_CONTAINER_PORT` and on no other.
- **R30** WHERE the host firewall opens a port for the deployment, THEN `ops/docker-compose.yml` SHALL bind
  that same port, and WHERE compose binds a port, THEN the firewall posture recorded for the host SHALL
  admit it; AND the resolution chosen for the certificate-challenge port SHALL be **recorded** in
  `ops/GATE_REGISTER.md` rather than left to be inferred from either artifact alone.

> **Finding note - R28 closes O1.** `OPERATOR_STATE_2026-08-09.md` §2 records, and §4 re-proves by count,
> that **no** `Dockerfile` or `Containerfile` exists anywhere in the tree, while `ops/docker-compose.yml`
> carries **six** `<*_IMAGE_REF>` placeholders. The consequence is the one worth stating plainly: even after
> G1 through G8 all clear, `docker compose up` cannot run, because nothing in either repository builds the
> six images the compose file names, and the finance-agent image would have no server process to run inside
> it. R28 is the requirement that closes the image half; R29 closes the process half. Neither is a human
> gate - both are buildable behind the existing port and mock boundary, which is why O1 was recorded as a
> build-side finding and not added to the gate register.

> **Finding note - R30 closes F12, and does not choose the resolution.** The gap is that two individually
> true statements are together insufficient. `ops/docker-compose.yml` publishes exactly one host port,
> `<TLS_PORT>:<PROXY_TLS_CONTAINER_PORT>` on the `caddy` service, and **no other service has a `ports:` key
> at all** - the `signalbus` service comments the absence as deliberate. Separately, the G1 correction in
> `ops/GATE_REGISTER.md` says to open port 80 in the host firewall for the certificate challenge. Opening 80
> in the firewall reaches nothing if compose never binds it, so an HTTP-01 challenge fails **while the
> firewall looks correct** - which is the expensive shape of this class of defect, because the artifact an
> operator would check to diagnose it is the one that is right.
>
> Two resolutions are admissible, and exactly one must be chosen and recorded:
> 1. **Publish 80 as a second port on `caddy`**, so the firewall and the bindings agree on two ports.
> 2. **Rely on TLS-ALPN-01 on `<TLS_PORT>` alone**, and state in `ops/GATE_REGISTER.md` that 80 is then
>    **not** required - which makes the firewall advice wrong as written and obliges the correction.
>
> **This requirement does not choose between them.** The choice belongs to task 10.8, which decides it,
> records it in the register, and makes the two artifacts agree. R30 is the assertion that they must agree
> and that the choice must be written down; it is deliberately not the choice. Nothing in phase 1 is blocked
> by it, because `longPoll` publishes no port at all and needs no certificate.

## Decision note - the seven owner rulings, settled

> **Authority and date.** `KIRO_SHIP_LIVE.prompt.md` rev 2, 2026-08-10, §1. That file carries owner
> authority and states its own precedence: where it disagrees with `ops/GATE_REGISTER.md` on **how a gate is
> verified** the register wins; where it disagrees with anything on **what the owner has decided** it wins.
> The seven rows below are the second kind. They are recorded here as **settled**, not proposed, and they are
> not to be re-raised. Each names the artifact that must change for the ruling to be carried out, because a
> decision recorded in only one file is a decision the next session will reopen in good faith.

| Id | Ruling, as settled | What it obliges |
|---|---|---|
| **D-ROTATE** | **Deferred.** No credential is rotated until the deployment has been tested in practical use and the owner reports it working. Rotation then becomes the **final acceptance test** rather than a skipped step, and `getWebhookInfo` is checked on every run for as long as the disclosed tokens are live. | Task 10.1 edits `.kiro/steering/cloudflare-dns.md` item 3 to record the deferral, because that item currently reads as an instruction to rotate and steering is what a session loads first. |
| **F11** | **Reads free, mutations owner-in-the-loop.** The standing permission covers reads; a mutation that spends money, publishes a public record, or grants a third party access still comes to the owner first. | Task 10.1 adds the read-only carve-out to `.kiro/steering/two-agent-vps.md` §2 and cites it from `.kiro/steering/cloudflare-dns.md` item 5, so the two canonical files stop disagreeing. |
| **D-CAP** | **USD 5.00 per week in total**, not per agent. Two keys at **2.50** each. `WEEKLY_BUDGET_USD = 5` stays as the total. | Task 10.10 adds the per-agent companion the code lacks; G4 mints two keys at 2.50. Resolves the D-CAP question left open in `OPERATOR_STATE_2026-08-09.md` §3. |
| **D-WAL** | **Outcome B**, the documented default: the owning service snapshots and hands the artifact over, widening **no** mount. | The backup service keeps its read-only store mounts. Unblocks rollback across a migration, which was blocked on this determination. |
| **D-BENCH** | **Authorized.** One Phase-1 pass on the **dev** key, from the development machine only, on the sanitized eval set, to lift the eligibility registry off `provisional: true`. | Uses the steering §3 dev-key carve-out and no production secret. Until that run happens the registry stays provisional and R18 keeps live routing refused. |
| **D-ALLOWLIST** | **Comma-separated, surrounding whitespace trimmed, and a single bare identifier must parse.** | **No change to R25.** R25's declared delimiter - any run of commas, semicolons, or whitespace in any combination - is a strict **superset** of this ruling, so every value the ruling admits already parses to the same list under R25, and the ruling forbids nothing R25 accepts. Recorded rather than re-specified. |
| **D-G5** | The OAuth consent screen is **published to production**, not left in Testing; and `BACKUP_FOLDER_REF` is a folder the **uploader creates on first run**. | Both are G5 steps. A Testing screen issues a 7-day refresh token and the unattended uploader dies silently on day 8; `drive.file` reaches only what the app created, so a hand-made folder is unreachable. `drive.file` is non-sensitive, so publishing needs no review. |

### Phasing, recorded so a later session does not read a deferral as a cancellation

**Phase 1 is `longPoll`.** It needs no domain, no DNS record, no certificate, no public port and no reverse
proxy, because it is outbound only. The consequences, each stated as a positive obligation rather than an
absence:

- **G1, G3, G4, G5 and G8 suffice for phase 1.** **G2 (DNS), G6 (webhook registration) and the entire proxy
  path are DEFERRED, not cancelled.** No gate is renumbered, softened, reopened or closed by this phasing,
  and G7 stays **CLOSED - WONT-DO** per steering §0b.
- **In phase 1 the `caddy` service stays down and `<TLS_PORT>` is not bound.** No host port is published at
  all, which is the compensating control named in R26's trap note.
- **Nothing built in phase 1 is discarded in phase 2**, because the guards are identical either way: R26
  makes the one difference explicit and mode-scoped, so flipping `TELEGRAM_MODE` to `webhook` and registering
  under G6 is a configuration change rather than a rewrite.
- **F12 (R30) must be closed before phase 2 begins**, not during it, because it is the phase-2 prerequisite
  that currently looks satisfied and is not.

## Out of scope
Provisioning, DNS, bot creation, key minting, OAuth consent, webhook registration, age keypair generation.
All are gate-register entries. Repo privatization is closed as WONT-DO (steering §0b).

## Definition of DONE (offline-complete)
All phases ticked; the acceptance gate passes with a ratcheted test floor; every gated item enumerated in
`ops/GATE_REGISTER.md`; contracts 06 and 12 authored and reconciled with the contract index and build log.
