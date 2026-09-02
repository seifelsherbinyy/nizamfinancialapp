# NIZAM v1.4 Production Controller Delta

> Status: WAVE 1 ARTIFACT - proposed delta; it does not supersede the v1.3 master contract until
> separately accepted by the owner as a contract revision.
>
> Provenance: NIZAM-derived from the owner's 2026-08-15 production-controller prompt, the
> Drive-safe v1.3 master contract, `.kiro/steering/two-agent-vps.md`, `.kiro/steering/pfos-current.md`,
> `money-rules.md`, `drive-db.md`, PFOS Contracts 06 and 12, and the observed Phase 0 inventory.
>
> Privacy class: `private_github` / `review_before_commit`. This artifact contains architecture and
> redacted evidence only. It contains no secrets, identifiers, hostnames, addresses, Drive IDs, bot IDs,
> webhook paths, personal ledgers, or plaintext private data.

## 1. Purpose

This delta records the owner's newer production direction while preserving the existing v1.3 authority
until the delta is explicitly accepted. It resolves the intended two-agent topology without weakening the
single-writer financial, privacy, or human-authority boundaries.

## 2. Authority and hierarchy

1. NIZAM is the user-facing commander, integrator, guardian, memory-facing layer, and final synthesis
   layer.
2. PFOS/MAL is the financial specialist and the sole authoritative financial writer.
3. NIZAM may request bounded PFOS analysis; it may not calculate, overwrite, or reinterpret financial truth.
4. A newer explicit owner decision may supersede a v1.3 design choice, but it does not make an unverified
   implementation live.
5. `BUILT`, `INSTALLED`, `RUNNING`, `VERIFIED`, and `SYNCED` are separate evidence states.

## 3. Two-agent topology

The target production shape is:

```text
USER
 ├─ NIZAM Telegram bot → Hermes profile `nizam`
 └─ PFOS Telegram bot  → Hermes profile `pfos`

Both profiles → NIZAMCORE governed ports
                 ├─ HIMAYAH / SUKOON / router / audit / THABAT
                 ├─ MemoryPort / ResearchPort
                 └─ PFOS ports

Telegram is an interface only. The two agents communicate through bounded backend ports and the
consent-controlled signal bus, never through bot-to-bot Telegram messages.
```

Each profile has its own credential set, store, memory, cap, process, and transport identity. Shared
governance does not mean shared mutable canonical state.

## 4. Financial and data invariants

- Money remains integer milliunits; deterministic PFOS engines remain the only source of monetary truth.
- The LLM, benchmark, router, Hermes profile, and NIZAMCORE code may explain or route but may not source
  balances, totals, due dates, safe-to-spend, debt, forecasts, or net-worth values.
- `life.db`, `finance.db`, and `signals.db` remain separate. Cross-database attachment is prohibited.
- Cross-agent payloads carry bounded typed state, not balances, dates, account identifiers, ledger rows, or
  unrestricted narrative.
- `strict_local_maximum` has no egress path and is not mirrored to Drive, GitHub, or model providers.

## 5. Memory and Google Drive

1. L0 is the current conversation.
2. L1 is profile-local memory.
3. L2 is NIZAM operational memory.
4. L3 is authoritative domain storage, including PFOS ledgers.
5. L4 is reviewed, encrypted, Drive-safe durable memory/archive.
6. L5 is archive.

Google Drive is never the live transactional database. A mirror is eligible only after HIMAYAH
classification, sanitization, encryption policy checks where required, an append-only receipt, and
destination read-back containing the expected version marker.

## 6. External authority and human gates

The following remain human-only: host/DNS mutation, credential creation or rotation, consent completion,
webhook registration, payment/transfer/spend, habit completion, `Decision Made?`, `Calendar Approved`,
commits, and pushes. Wave approval authorizes implementation within scope; it does not complete any of
these gates.

## 7. Acceptance delta for v1.4

The v1.4 release should not be called complete until all of the following have observed evidence:

- both isolated Hermes profiles operate through NIZAMCORE;
- both Telegram agents authenticate, deduplicate, recover, and respect the allowlist;
- OpenRouter routing is connected under approved privacy policy and isolated caps;
- PFOS remains the single financial writer and deterministic financial tests pass;
- local memory retrieval and Drive-safe mirroring work with read-back receipts;
- strict-local leakage, signal tampering, cap exhaustion, restart, restore, and duplicate-message tests
  fail closed as designed;
- audit and THABAT records exist for each release wave;
- the repository gate passes on an intentionally clean, owner-approved tree.

## 8. Supersession rule

Until the owner accepts this delta as v1.4, v1.3 remains the governing product contract. This file is a
reviewable, non-superseding change proposal and evidence anchor for the approved Wave 1 implementation.
