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

> **Decision note - D-ALLOWLIST (AWAITING OWNER CONFIRMATION).** Raised as F1 in
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

## Out of scope
Provisioning, DNS, bot creation, key minting, OAuth consent, webhook registration, age keypair generation.
All are gate-register entries. Repo privatization is closed as WONT-DO (steering §0b).

## Definition of DONE (offline-complete)
All phases ticked; the acceptance gate passes with a ratcheted test floor; every gated item enumerated in
`ops/GATE_REGISTER.md`; contracts 06 and 12 authored and reconciled with the contract index and build log.
