# Rate-limit posture - the messaging provider's documented limits, and what this deployment does about each

> **Owning contract:** PFOS Contract 12 - Two-Agent VPS Deployment & Operations, **§5.5** (accept fast, process
> asynchronously; the documented per-chat and broadcast limits are respected with backoff), **§2.3**
> (the degraded long-poll fallback), with **§2.2** (one public port) and **§5.4** (per-bot dedup).
> **Spec:** `.kiro/specs/06-two-agent-vps/` - task **7.6**. Requirements **R13**, **R14**, **R15**,
> **R22**, **R23**, **R24**.
> **Steering:** `two-agent-vps.md` §2 (writing this file is permitted, RUNNING IT IS NOT), §7
> (placeholders only), §0b (no deployment particular in a tracked file).
> **Phase:** 7 (ops artifacts, text only).
> **Audited by:** `src/server/ops/runbookTemplate.ts`, which reads this text on every test run and
> fires a named finding per governed property. Every finding has a negative test that mutates this
> file and observes the check fire.
>
> **THIS IS A POSTURE DOCUMENT. NOTHING HERE IS EXECUTED BY AN AGENT, AND NOTHING HERE WAS MEASURED.**
> No request was made to the provider to produce this file. Every number below is quoted from the
> provider's published documentation, and every posture below is a decision recorded in text.
>
> **Companion documents:** `ROLLBACK.md` and `DISASTER_RECOVERY.md`, which route the degraded mode
> here rather than restating it.

## What this document is

Two things, kept separate on purpose:

1. **The documented limits** - what the messaging provider (Telegram) publishes about how often a bot
   may send, how many webhook connections it will open, and how it signals refusal. These are the
   provider's numbers. This deployment does not choose them and cannot change them.
2. **The posture** - what this deployment does so that it stays inside them. These are decisions, and
   each one is written next to the limit it answers, because a posture separated from its reason
   drifts.

A single-operator system is nowhere near any of these ceilings in normal operation. The posture exists
for the abnormal case: a retry storm, a queue drained after an outage, or a loop that nobody meant to
write. In that case the limits are reached in seconds, and the difference between a bounded backoff
and an unbounded retry is whether the bot survives the incident.

## Provenance of every number below

**No live API probe was made, and none is needed.** Steering §2 gates every outbound call from a
server process, and a rate limit is not discovered by exceeding it. The numbers are documentation, and
documentation is read.

- Each limit carries a **Provenance** line saying so explicitly.
- The provider's own API base is a placeholder here, `<MSG_API_BASE>`, resolved by the operator from
  the provider's published documentation (`ops/GATE_REGISTER.md`, placeholder glossary). That is not
  because the endpoint is a secret; it is because "which domains are harmless" is a judgement call and
  the public-repository invariant admits none (**R24**).
- **Re-confirm before relying on a number.** A published limit can change, and this file is a
  snapshot of what was published. The operator re-reads the provider's documentation at gate **G6**
  and corrects any row that has moved. A corrected row is a commit, not a live edit.
- Nothing here is inferred from observed behaviour. A limit that is enforced more tightly than it is
  documented would be visible only as refusals, and the posture below is written to survive that
  without needing to know the tighter number.

## The documented limits, and the posture for each

### Limit 1 - Per-chat send rate

- **Documented:** roughly one message per second to a single chat. Short bursts are tolerated, but
  sustained bursts attract a refusal.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** the outbound path serializes per chat and paces itself to the documented rate.
  There is exactly one operator in the allowlist (`${ALLOWED_USER_IDS}`), so per-chat is effectively
  global for this deployment - which means this is the limit that binds first, and the one the pacing
  is built around.

### Limit 2 - Global send rate across distinct chats

- **Documented:** roughly thirty messages per second in total, across all chats.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** unreachable by design rather than by throttling - two bots serving one operator have
  one chat each. It is recorded because the ceiling is per **bot token**, and the two agents hold
  different tokens (§3.1), so neither can consume the other's allowance. Isolation here is the same
  isolation as everywhere else in this tier: separate credentials, not shared bookkeeping.

### Limit 3 - Per-group send rate

- **Documented:** roughly twenty messages per minute to the same group.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** not applicable, and made structurally so. Group joining is disabled for both bots at
  gate **G3**, and the allowlist admits sender identifiers rather than groups (**R12**). A limit that
  cannot be reached because the feature is off is better than a limit respected by a code path.

### Limit 4 - The refusal signal

- **Documented:** the provider answers an exceeded limit with a too-many-requests status and a
  `retry_after` field, in seconds, inside the error's parameters object.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** the value is **honoured, not estimated**. The outbound path waits at least the
  advertised interval before retrying, and treats the refusal as a **queue** failure with its own
  retry and backoff - never as a transport-level failure (§5.5.4). Turning it into a transport failure
  would make the provider redeliver the update, which converts one refused send into two.
  Retries are bounded; an exhausted retry budget surfaces to the operator instead of looping.

### Limit 5 - Webhook connection ceiling

- **Documented:** the webhook registration accepts a maximum-connections value between one and one
  hundred, defaulting to forty.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** set **low** - `<MAX_CONNECTIONS>` at gate **G6** - because a single-operator system
  needs very little and a high ceiling only buys concurrency the agent then has to bound anyway
  (§5.5.5). Worker concurrency inside the agent is bounded separately by `${MAX_WORK_ITEMS}`. The two
  are different limits and both are set: the ceiling is what the provider may open, the bound is what
  the agent will process at once.
- The registration also narrows update types and drops pending updates on first registration, so a
  backlog accumulated while the endpoint was down is not replayed at the new ceiling (gate **G6**).

### Limit 6 - Long-poll request duration

- **Documented:** the update-fetching method takes a timeout in seconds; a positive value is long
  polling and zero is short polling, which the provider documents as being for testing only.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** when the degraded mode is selected, one poller per bot with a positive timeout, never
  zero. Short polling in production is a busy loop against a rate-limited endpoint, which is how a
  fallback becomes the incident.

### Limit 7 - Acceptable webhook ports

- **Documented:** the provider will deliver only to a closed set of TLS ports, which its
  documentation enumerates.
- **Provenance:** the provider's published bot API documentation. Not measured, not probed.
- **Posture:** the deployment uses the standard TLS one, `<TLS_PORT>`, and no other. No agent process
  binds a public port; the proxy terminates TLS and is the only public listener (§2.2.1, §2.2.2). The
  set is not enumerated here, for the same reason `<MSG_API_BASE>` is a placeholder.

## Refusal handling, in one place

The rule is one sentence and it is worth isolating: **a downstream refusal is a queue failure, never
a transport failure** (§5.5.4).

- The inbound handler authenticates, checks the allowlist, de-duplicates, enqueues, and acknowledges.
  Nothing slow happens before the acknowledgement (§5.5.1, **R15**).
- Therefore a rate-limit refusal is always encountered **after** the acknowledgement, by a worker.
  It has no way to become a delivery failure, because the delivery already succeeded.
- The worker's retry is idempotent per queue item, because a worker can crash mid-item (§5.5.3).
- The halt applies here too: with `${NIZAM_KILL_ALL}` set or `${KILL_SENTINEL_PATH}` present, the
  worker stops sending. It does **not** stop a deterministic obligation alert reaching the owner
  (§6.2, **R17**) - a halted system still tells the owner a payment is due.

## Degraded mode: long polling

§2.3's fallback, stated once here and referenced from both other runbooks.

- Selected by configuration: `${TELEGRAM_MODE}`, whose value is one of the two transport modes the
  port declares - `webhook` (the norm) and `longPoll` (the documented fallback).
- **It is a mode, not a second code path.** The same authentication, the same allowlist, the same
  per-bot de-duplication keyed by bot and update identifier, and the same accept-fast/process-async
  shape. Failing over must never disable a guard in §5.
- The per-bot dedup namespace matters more here, not less: update identifiers are per-bot sequences,
  so two bots polling independently will emit the same identifier, and both must be processed
  (**R14**).
- It needs no public endpoint, which is exactly why it is the fallback: it is available while the
  hostname, the certificate, or the proxy is not.
- It is a bridge. The rebuild path in `DISASTER_RECOVERY.md` continues while it carries traffic.

## What this document never does

- It does not probe the provider to discover or confirm a limit. Documentation is read, not measured.
- It does not raise, bypass, or temporarily lift a limit or a cap.
- It does not turn a rate-limit refusal into a transport failure.
- It does not enumerate the provider's endpoint or port set; both are placeholders (**R24**).
- It does not name a host, an address, a bot, a storage reference, or a real figure (**R24**).
- It is not executed by an automated agent, at any point, for any reason (steering §2).
