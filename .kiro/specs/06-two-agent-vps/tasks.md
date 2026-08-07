# Tasks - Two-Agent VPS Tier

> Tick as the loop completes each. Append a section to `contracts/pfos/_PFOS_BUILD_LOG.md` per phase.
> Gate after EVERY phase: `npm run verify:all -- --all` must pass all checks. Never advance on a red gate.
> Steering: `.kiro/steering/two-agent-vps.md`. Requirements/design: this folder.

## Phase 0 - Authorize and author (no code)
- [x] 0.1 Confirm `.kiro/steering/two-agent-vps.md` is signed off by the owner. If not, STOP and ask.
- [x] 0.2 Author `contracts/pfos/06_PFOS_Database_and_Knowledge_Model.md` (NIZAM-derived, marked as such)
- [x] 0.3 Author `contracts/pfos/12_PFOS_Two_Agent_VPS_Deployment_and_Operations.md`
- [x] 0.4 Update `_PFOS_CONTRACT_INDEX.md` + build log so **AC12** still agrees
- [x] 0.5 Create `ops/GATE_REGISTER.md` seeded with G1-G8 from steering §2

## Phase 1 - Data layer (Contract 06) → R1-R5
- [x] 1.1 `src/server/db/` schema + migrations on `node:sqlite`, WAL, `foreign_keys=ON`, idempotent versioning
- [x] 1.2 Repositories for accounts/transactions/obligations/decisions reusing existing types
- [x] 1.3 Integer-milliunit boundary guard (reject non-integer at persist) + parity test vs the browser engines (R4)
- [x] 1.4 Token-spend ledger keyed by agent; weekly total as a pure function feeding `modelPolicy` (R5)
- [x] 1.5 Negative tests: non-integer money rejected; migration re-run is a no-op; cross-agent DB open fails

## Phase 2 - Ports and mocks → foundation for everything gated
- [ ] 2.1 `src/server/ports/` interfaces: TelegramPort, OpenRouterPort, DrivePort, WhoopPort, SignalBusPort
- [ ] 2.2 Deterministic mock per port + a recorded-fixture loader
- [ ] 2.3 Assert `src/server/**` is absent from the browser bundle (extend the existing isolation check)

## Phase 3 - Signal bus and the consent boundary → R7-R10
- [ ] 3.1 Vendor the signal envelope schema; validation module; no field can carry a figure or long text
- [ ] 3.2 Consent gate: `producer_only` refused; tier check; de-identification assertions
- [ ] 3.3 Append-only store + audit mirror; internal-only binding documented in ops
- [ ] 3.4 Negative tests: figure in payload rejected; `producer_only` refused; over-length text rejected;
      `strict_local_maximum` reference rejected

## Phase 4 - Telegram transport (mocked) → R11-R15
- [ ] 4.1 Port `auth` logic from `nizamcore/relay/auth.py`: constant-time token compare + allowlist
- [ ] 4.2 SQLite dedup keyed `(bot_id, update_id)` UNIQUE + `INSERT OR IGNORE` (fixes collision + race)
- [ ] 4.3 Accept-fast / process-async handler with a work queue
- [ ] 4.4 Negative tests: missing token, wrong token, non-allowlisted user, duplicate update, and
      **two bots emitting the same update id must both be processed**

## Phase 5 - Routing, spend, telemetry → R16-R19
- [ ] 5.1 Turn classifier (rules-first) producing T0-T4; T0 provably invokes no model
- [ ] 5.2 Router/scorer consuming `modelPolicy` + the eligibility registry; refuse a `provisional` registry
- [ ] 5.3 Telemetry store: actual reported cost, tokens, latency, schema validity; **no prompt text**
- [ ] 5.4 Negative tests: cap exhausted refuses one agent and not the other; deterministic alerts still fire;
      T0 never calls a model; provisional registry cannot promote

## Phase 6 - Benchmark Phase-1 (dev-key carve-out, steering §3)
- [ ] 6.1 Complete the eval set toward the >=210-case bar; sanitized cases only
- [ ] 6.2 Run against recorded fixtures; emit `model_eligibility_registry.json` marked `provisional: true`
- [ ] 6.3 IF the dev key is present and within its cap: run live from the dev machine only, emit a
      non-provisional registry. ELSE leave provisional and record it in the gate register.

## Phase 7 - Ops artifacts (TEXT ONLY, never executed) → R20-R22
- [ ] 7.1 `ops/docker-compose.yml` with per-service resource limits/reservations + healthchecks + internal network
- [ ] 7.2 `ops/Caddyfile` with the two hosts and secret webhook paths
- [ ] 7.3 `ops/env/*.env.example` for life/finance/scheduler/backup - placeholders only
- [ ] 7.4 `ops/backup/` consistent-snapshot + public-key-encrypt + shred; `ops/restore/` with integrity check
- [ ] 7.5 Health endpoints + structured redacted logging + log rotation config
- [ ] 7.6 Rollback and disaster-recovery runbook; rate-limit posture per Telegram's documented limits

## Phase 8 - Cross-repo handoff (steering §6)
- [ ] 8.1 `ops/nizamcore-patches/001-fastapi-wrapper.patch` (wrap `handle_update`, add health endpoint)
- [ ] 8.2 `ops/nizamcore-patches/002-dedup-per-bot.patch`
- [ ] 8.3 `ops/nizamcore-patches/003-signalbus-egress-target.patch`
- [ ] 8.4 `ops/nizamcore-patches/README.md`: apply order, expected test deltas, how to verify

## Phase 9 - Close out
- [ ] 9.0 Add a harness check: no deployment particular in `ops/**` or any fixture (steering §0b) - no bare
      domain, IP, Drive id, numeric Telegram id, or real monetary figure. Must fail closed.
- [ ] 9.1 Raise the `AC04 --min` floor to the new test count
- [ ] 9.2 Gate passes all checks; commit and push each green increment
- [ ] 9.3 `ops/GATE_REGISTER.md` complete: every human step with exact commands and a verification line
- [ ] 9.4 Final report: what is built, what is gated, and the single next human action

## Gate
- [ ] `npm run verify:all -- --all` passes all checks after every phase
- [ ] Test floor ratcheted up, never down
- [ ] No secret in any tracked file; `ops/` holds placeholders only

## Waiting on user input (do NOT attempt - steering §2)
- [ ] G1 provision + harden the VPS
- [ ] G2 DNS for the two hostnames
- [ ] G3 create the two bots in BotFather
- [ ] G4 mint the two runtime OpenRouter keys + weekly caps
- [ ] G5 Google OAuth consent for the backup grant
- [ ] G6 register both webhooks
- [ ] G8 age keypair; private half stored off the host
