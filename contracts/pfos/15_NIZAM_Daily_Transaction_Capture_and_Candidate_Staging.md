# NIZAM Daily Transaction Capture and Candidate Staging

> **PROVENANCE: NIZAM-DERIVED.** Authored 2026-09-02 to govern a surface the owner requested and
> that no existing contract covered. The requirement, in the owner's words, is to ensure
> "the agentic Hermes asks and captures the latest daily transactional information" (owner
> decision D7, 2026-09-02).
>
> **Derived from:** PFOS Contract 02 §5 (ingestion paths, transaction state model, deduplication),
> Contract 03 (the deterministic engine as the sole source of monetary truth), Contract 05 §3.1 and
> §8 (knowledge classes and the tool boundary), Contract 06 (`finance.db` schema and the money
> persistence boundary), Contract 12 §5 (transport guards, allowlist-before-parsing, dedup on the
> pair), Contract 14 §5 (deterministic-first routing; an LLM may explain a routed result but may not
> choose a monetary figure), ADR-0003 AD-4 and AD-6, `money-rules.md`, and `drive-db.md`.
>
> **Status:** IN FORCE for the daily capture surface only. It does **not** supersede Contract 02's
> state model, Contract 06's schema, Contract 12's isolation, Contract 14's ingress drawing, or any
> money/Drive invariant. It grants **no** new authority over canonical ledger data — see §8.
>
> **Why it had to be authored before code.** The capability is absent from every tier of
> `ops/HERMES_CAPABILITY_EXPANSION_REGISTER.md`: it is not Tier 1 (no existing contract covers an
> agent-originated transaction write), not Tier 2 or 3 (no entry existed), and not Tier 4 (it is not
> forbidden — only "production spend / transfer" and "database schema migration" are). An ungoverned
> area may not be implemented; `AGENTS.md` requires the contract first.
>
> **Money rule.** Nothing in this contract computes, sources, infers, interpolates, rounds, converts
> or is the source of truth for a monetary value. The owner states an amount; a deterministic parser
> converts it to integer milliunits or **refuses**. There is no third outcome.
>
> **Privacy.** Architecture, grammar and refusal codes only. No hostnames, workspace or channel
> identifiers, member identifiers, Drive identifiers, webhook paths, secrets, account numbers, or
> ledger figures appear here. Every example is synthetic.

---

## §1 Purpose and the problem it solves

NIZAM's intake priority order (ADR-0003 AD-6) begins with **manual entry**, and manual entry is
exactly what does not happen daily. A day's small cash and card movements are the rows most likely
to be lost, and they are lost by omission rather than by error: nobody opens an app to record a
EGP 45 coffee. The consequence is not a cosmetic gap. Uncaptured outflows make every downstream
deterministic answer — safe-to-spend, budget variance, obligation cover, forecast — confidently
wrong, and a confidently wrong finance answer is worse than an absent one.

This contract makes the *asking* a property of the system rather than of the owner's discipline,
and makes the *capturing* deterministic enough that an agent may hold the conversation without ever
holding financial authority.

### §1.1 North star

At the end of each owner-local day, the owner has been asked once, in the existing conversational
window, what moved. Whatever the owner replies is preserved verbatim and durably. Anything that can
be read without judgement becomes a reviewable candidate. Anything that cannot is refused with a
reason and one clarifying question. No figure reaches an engine without the owner's explicit
promotion.

---

## §2 Where this sits — the pipeline is extended, not bypassed

ADR-0003 AD-6 fixes the intake pipeline as:

```text
capture -> parser -> normalized candidate -> deterministic validation -> dedupe -> review
        -> canonical ledger -> reconciliation
```

Daily capture is the **first stage only**. It adds a new *channel* to `capture`; it changes no later
stage, and it introduces no path that skips one.

```text
[ §6 ASK ]      deterministic daily prompt, no model call, idempotent per owner-local day
     |
[ §3 CAPTURE ]  owner's reply stored VERBATIM as one source_events row; nothing interpreted
     |
[ §5 PARSE ]    deterministic grammar; every amount through strict milliunit parse; refuse on doubt
     |
[ §4 STAGE ]    zero or more rows in the ENGINE-EXCLUDED transactionCandidates collection
     |
[ §4.3 REVIEW ] owner promotes, edits or discards -- the ONLY path to canonical
     |
canonical transactions[]  ->  reconciliation   (both unchanged, and out of this contract's scope)
```

### §2.1 This is not a tool the model may call

The capture path is **deterministic ingestion, not an agent capability**, for a reason that is
already mechanical in this repository: `src/server/hermes/runtimeAdapter.ts` refuses any bounded
tool input whose payload key matches `amount|balance|currency|milliunit|money|price|cost|financial`.
A monetary field is therefore *unrepresentable* across the Hermes tool boundary today. Adding a
capture tool would have required weakening that guard. It is not weakened, and no tool name is added
to `HERMES_TOOL_NAMES` by this contract.

The model's role is bounded to what Contract 14 §5 already allows: it may deliver the prompt text it
was handed, and it may explain a refusal. It may not compose an amount, choose a currency, infer a
direction, resolve an account, or decide that a malformed line "probably meant" something.

---

## §3 The capture stage

### §3.1 One row per reply, verbatim

Each owner reply is appended to the existing `source_events` table (Contract 06; implemented at
`src/server/db/repositories/sourceEventsRepository.ts`) with:

| Column | Value |
|---|---|
| `channel` | a fixed capture-channel constant. One channel, so a count answers "how many days replied". |
| `idempotency_key` | derived from the owner-local capture date and the reply sequence within that date. |
| `content_hash` | `sha256` of the reply's exact bytes. |
| `raw_payload` | the reply, **verbatim and unmodified**, so a parser change can be replayed (Contract 06 §8.2). |
| `parse_state` | `pending` on arrival. |

### §3.2 Idempotency is structural, not procedural

`source_events` carries `UNIQUE (channel, idempotency_key)` and the repository's `append` is a
conflict-ignoring insert. Re-sending the same reply is therefore a no-op that **cannot be raced**,
and the caller learns which happened from `appended`. This contract adds no check-then-insert.

### §3.3 The same key with different bytes is a finding, never an overwrite

The repository already reports this through `contentHashMatches`. This contract inherits that rule
unchanged: the stored row is left exactly as it was, and the disagreement is surfaced to the owner.
Silently keeping either version would be a decision about the owner's data that this layer has no
standing to make.

### §3.4 Capture interprets nothing

At this stage no amount is parsed, no account resolved, no currency assigned, no direction inferred.
A reply that is pure prose, an emoji, or "nothing today" is a perfectly valid capture. Capture
durability and parse success are independent, deliberately: a reply that cannot be parsed must still
survive, because the bytes are the owner's and a future parser may read them.

---

## §4 The staging invariant

### §4.1 Candidates only. Never canonical.

Parsing produces rows in `transactionCandidates` (`src/lib/db/schema.ts`, `SCHEMA_VERSION 6`) and
**never** in `transactions[]`. The isolation is structural — a separate collection that no engine
function reads — not a flag. `approved` is `false` on every row this path creates and this path has
no code that sets it true.

### §4.2 Engine exclusion is asserted, not asserted-to

The existing exclusion test ("transactionCandidates never affect any engine") is the fence. This
contract adds rows to a collection that fence already guards; it does not create a second staging
tier, and it may not be implemented by widening any engine's input.

### §4.3 Promotion is the owner's, and only the owner's

Only an explicit owner review action promotes a candidate. Promotion is out of this contract's
scope. No schedule, threshold, confidence score, streak, "obvious" case, or repetition of a
previously promoted payee may promote anything automatically. An agent may *present* candidates and
may *explain* them. It may not promote one, and it may not batch-promote.

### §4.4 Fixed field values at capture

| Field | Value at capture | Why it is not inferred |
|---|---|---|
| `approved` | `false`, always | §4.1. Approval is the review action, not a parse outcome. |
| `cleared` | `uncleared`, always | A conversational report is not a bank confirmation. `cleared` and `reconciled` are statements about the bank's record, which this path has not seen. |
| `categoryId` | `null`, always | Categorization is a budgeting decision (Contract 03), not a reading of the owner's words. A guessed category silently misstates budget variance. |
| `splits` | `null`, always | A split must sum exactly to its parent; deriving legs from prose would invent the arithmetic. |
| `transferAccountId` / `transferTransactionId` | `null`, always | A transfer has two legs and a peer account. Capturing one leg as a transfer would create a half-transfer, which is worse than an uncategorized outflow. |
| `duplicateStatus` | `ambiguous` unless the dedup key proves otherwise | Fail-closed: `unique` is a claim that dedup ran and found nothing. |

---

## §5 The money origination boundary

This section is the reason the contract exists. It is the narrowest surface in it and the least
negotiable.

### §5.1 The owner states the amount; the machine converts or refuses

The amount is **owner-originated data**, not a model output and not a derived value. The runtime's
only job is conversion into integer milliunits, performed by the existing strict parser
(`fromDecimalStrict`, `src/lib/money/money.ts`), which already refuses a grouping separator, a
non-decimal token, more than three fractional digits, and anything outside safe-integer milliunits.
This contract adds no second parser and no forgiving fallback for this path.

### §5.2 The capture line grammar

Deterministic, positional, and small enough to be typed on a phone. One movement per line:

```text
<direction> <amount> <currency> acct:<alias> <payee>[ @YYYY-MM-DD][ | <memo>]
```

```text
out 85.500 EGP acct:main-card Coffee shop
in 12000 EGP acct:salary-acct Monthly salary | September
out 240 EGP acct:cash Groceries @2026-09-01 | forgot yesterday
```

| Token | Rule |
|---|---|
| `direction` | Exactly one of `out` / `in`, case-insensitive, first token. **Never inferred.** Direction carries the sign, and a wrong sign is a double-magnitude error. |
| `amount` | An unsigned magnitude. Parsed by `fromDecimalStrict`. Must be strictly positive; zero and negative are refused, because a signed amount here would compete with `direction` for authority over the sign. |
| `currency` | An explicit three-uppercase-letter code, checked against a caller-supplied known-currency set. **Never defaulted, including not to the account's own currency** — Contract 6 I1.2 states currency is required and never inferred from the account, and a foreign purchase on a domestic card is precisely the case that makes the inference wrong. |
| `acct:<alias>` | Resolved against a caller-supplied alias-to-identifier map. An unknown or ambiguous alias is refused. There is no "the usual account". |
| `payee` | Free text, must be non-empty. Stored verbatim; normalization is a review-time concern. |
| `@YYYY-MM-DD` | Optional back-date for a movement the owner is reporting late. Must be a well-formed date and must not be later than the capture date. Absent means the capture date. |
| `| <memo>` | Optional free text. Carries no financial meaning. |

### §5.3 Refusal is a first-class outcome

Every failure is a typed refusal naming the line and the reason. A refusal produces **zero**
candidates for that line, leaves the `source_events` row intact, and yields one clarifying question.
The runtime never partially accepts a line, and never "does its best".

| Refusal | Raised when |
|---|---|
| `CAPTURE_LINE_EMPTY` | the line has no content after trimming |
| `CAPTURE_DIRECTION_MISSING` | the first token is not `out` or `in` |
| `CAPTURE_AMOUNT_MISSING` | there is no second token to read as an amount |
| `CAPTURE_AMOUNT_UNPARSEABLE` | the strict parser refused; its own reason code is carried through, not flattened |
| `CAPTURE_AMOUNT_NOT_POSITIVE` | the magnitude is zero or negative |
| `CAPTURE_CURRENCY_MISSING` | no currency token is present |
| `CAPTURE_CURRENCY_UNKNOWN` | the code is malformed or outside the known-currency set |
| `CAPTURE_ACCOUNT_MISSING` | no `acct:` token is present |
| `CAPTURE_ACCOUNT_UNKNOWN` | the alias resolves to no account, or to more than one |
| `CAPTURE_PAYEE_MISSING` | nothing remains to read as a payee |
| `CAPTURE_DATE_MALFORMED` | the `@` override is not a well-formed calendar date |
| `CAPTURE_DATE_IN_FUTURE` | the date is later than the capture date |
| `CAPTURE_TOO_MANY_LINES` | the reply exceeds the per-reply line bound |

### §5.4 What the parser may never do

- Convert between currencies, or attach an FX rate. No capture-time FX, ever. A foreign amount is
  stored in its own stated currency and converted only by the deterministic engine at read time
  (owner decision D3-A, derive-on-read).
- Round, truncate, or absorb precision. Three fractional digits is the limit and a fourth is refused,
  because a rounded amount is indistinguishable from a measured one once stored.
- Accept a floating-point money value anywhere, in any intermediate, at any boundary.
- Infer a missing token from a previous line, a previous day, or a frequent pattern.
- Ask a model to disambiguate a figure. A model may phrase the clarifying question; the owner answers
  it, and the answer re-enters at §3 as a new capture.

---

## §6 The asking half

### §6.1 The prompt is deterministic and costs nothing

The daily prompt is composed from a fixed template plus the owner-local date. **No model call is
required to produce it**, so the asking half spends nothing against any cap and cannot fail because a
provider is unreachable, degraded, or rate-limited. This mirrors the pattern already established by
`ops/hermes/daily_owner_checkin.py`, which is deterministic and reads only confirmed owner
preferences.

### §6.2 Bounded, idempotent, declinable

- **Once per owner-local day.** The prompt's identity is the owner-local date, so a restart, a
  redeploy, a duplicated scheduler tick, or two schedulers cannot ask twice.
- **Owner-local, not UTC.** The boundary of "today" is the owner's day. A UTC boundary would ask at
  the wrong hour and would split a single evening across two capture dates.
- **Declinable without penalty.** A day with nothing is recorded by replying exactly the single
  declination token the prompt states verbatim (`none`, matched after trimming and case-folding).
  It is one fixed token rather than a keyword list on purpose: deciding that some phrase "means
  nothing today" is the inference this contract exists to forbid, and the prompt names the token so
  the owner never has to guess. A declination is a complete, valid, recorded reply. There is no
  streak, no score, no escalation, and no second nudge beyond the configured bound.
- **Carries no figures.** The prompt states no balance, no total, no remaining budget, and no
  yesterday-comparison. It asks; it does not report. A prompt that reported a figure would put a
  monetary value on the model's path for no benefit.
- **Never a channel other than the owner's own window.** Contract 14's allowlist and channel
  restrictions apply unchanged.

### §6.3 A missed day is a gap, not a hole to fill

If a day is not replied to, the day has no candidates. Nothing is estimated, averaged, carried
forward, or back-filled from a pattern. The `@YYYY-MM-DD` override in §5.2 exists so the owner can
supply a missed day *themselves*, which is the only mechanism this contract offers.

---

## §7 Provenance and deduplication

### §7.1 Provenance is recorded honestly, including its limits

Each candidate carries `importInfo` with:

| Field | Value | Note |
|---|---|---|
| `extractionMethod` | `manual` | Honest: the owner typed it. It is not a parser reading a bank artifact, and labelling it `parser` would overstate its verification level. |
| `sourceType` | `manual` | See the finding in §10.1 — a dedicated `chat` value would be a schema widening and needs owner sign-off. |
| `confidenceScore` | `1` | The owner stated it directly. This is a statement about *provenance*, not about correctness, and it does not authorize promotion. |
| `confidenceReason` | fixed text naming this contract and the strict parse | No free-form model text. |
| `contentHash` | `sha256` over the financially consequential fields only | Date, direction, magnitude, currency, account, payee. Deliberately excludes `memo` and `categoryId`, so a later edit cannot change the fingerprint. |
| `duplicateKey` | the same content hash | Gives the existing dedup path a stable key independent of arrival order. |
| `sourceFile` | the `source_events` row reference | There is no file. The capture row is the honest provenance anchor, and it is a synthetic internal reference. |
| `parserVersion` | the capture grammar version | So a re-parse at a newer grammar is detectable rather than silent. |

### §7.2 Dedup is fail-closed

`duplicateStatus` starts at `ambiguous`. It becomes `unique` only when the dedup comparison has
actually run against the existing candidate and canonical sets and found no match on the content
hash. A same-day, same-amount, same-payee repeat is genuinely possible — two coffees — so a hash
collision is surfaced for owner review and **never auto-discarded**. Contract 02 §5.2's rule that a
suspected duplicate is never deleted automatically applies unchanged.

---

## §8 What this contract does NOT authorize

Stated explicitly so that no later increment can read a permission into it.

- **No canonical write.** Nothing here writes, edits, voids, supersedes or reconciles a row in
  `transactions[]` or in the server tier's `transactions` table.
- **No promotion.** See §4.3.
- **No approval.** `approved: true` is never set by this path.
- **No schema migration.** No table, column, collection, `SCHEMA_VERSION`, or enum is changed by this
  contract. The register lists database schema migration as permanently human-only, and §10.1 records
  the one widening this path would have liked, unapplied.
- **No new Hermes tool.** `HERMES_TOOL_NAMES` is unchanged. See §2.1.
- **No transfer, payment, spend or movement of real money.** Recording that something happened is not
  making it happen.
- **No new credential, scope, provider, endpoint or outbound integration.** The capture channel is the
  conversational window Contract 14 already governs.
- **No human gate.** G1-G8 are untouched, uncompleted, untested and unsubstituted by this contract.
- **No change to `money-rules.md` or `drive-db.md`.** Both are preserved exactly.
- **No FX.** See §5.4.

---

## §9 Acceptance

### §9.1 Offline, machine-checked (this is the bar for "done")

1. A well-formed line produces exactly one candidate whose `amount` is integer milliunits with the
   sign taken from `direction`.
2. Every fixed field in §4.4 holds its stated value on every produced candidate.
3. Each refusal in §5.3 is provoked by a purpose-built input and produces **zero** candidates.
4. A float money value, a grouping separator, and a four-fractional-digit amount are each refused —
   not rounded, not stripped, not accepted.
5. A currency omission is refused, and is **not** defaulted to the account's currency.
6. An unknown account alias is refused, and an alias that resolves to two accounts is refused.
7. A future-dated line is refused; a validly back-dated line is accepted at the stated date.
8. The same reply captured twice appends once; the second call reports `appended: false`.
9. The same idempotency key with different bytes appends nothing and reports the disagreement.
10. The daily prompt is byte-identical for the same owner-local date and contains no digit that could
    be read as a monetary figure.
10a. The declination token is accepted as a whole reply, produces zero candidates and zero refusals,
    and a reply that merely *contains* the token is not treated as a declination.
11. No produced candidate reaches any engine: the existing exclusion test still passes with candidates
    present.
12. **Negative control (tamper test).** Introducing a default currency, a sign inferred from a keyword,
    an auto-promotion, or a lenient amount parse must each make a test fail. A guard that cannot be
    made to fail is not a guard.

### §9.2 Live — human, later, and not by an agent

Scheduling the prompt in the live window, and any operation touching a credential, a channel, a host
or a gate, is a human action under Contract 12 §9 and `ops/DEPLOYMENT_CONTROL.md`. This contract
completes, tests, substitutes into and marks complete **nothing** in either.

---

## §10 Findings recorded rather than invented

### §10.1 `sourceType` has no value for a conversational capture

`ImportInfo.sourceType` is a closed optional enum: `csv | telegram | sms | email | manual`. The
honest value for this path would be a new `chat` member. Adding one widens what validates and is a
schema change, which Contract 06 and the capability register both place under explicit owner
sign-off. **Nothing is widened here.** `manual` is used, which is defensible — the owner typed it —
and the preferred widening is recorded as an owner decision this contract does not take. Note also
that `telegram` is now a dead value for live traffic per Contract 14 v2; retiring it is a separate
migration and is likewise not done here.

### §10.2 The capability register's contract numbering had drifted

`ops/HERMES_CAPABILITY_EXPANSION_REGISTER.md` recommended authoring "Contract 14 — Calendar
Integration" and "Contract 15 — External Data Integrations". Both numbers were already taken: 14 by
the single-window ingress contract (2026-08-24) and 15 by this one. The register is a supporting
document and contracts outrank it, so the register's numbers were corrected to 16 and 17 rather than
this contract taking a colliding number.

### §10.3 The account alias map is a caller input, not a stored table

This contract resolves `acct:<alias>` against a map the caller supplies. It deliberately does not
create an alias registry: that would be a new stored entity, and the accounts collection already
exists. Where the map comes from is an implementation concern of the calling process, and a stale map
produces `CAPTURE_ACCOUNT_UNKNOWN` — a refusal — rather than a wrong account.
