# NIZAM workspace instructions

These instructions are loaded by Aki profiles through `{workspace}/AGENTS.md`.

## Project identity

NIZAM is a private, single-user, offline-first personal-finance application for the owner. It uses React, TypeScript, Vite, Zustand, Dexie/IndexedDB, deterministic finance engines, and Google Drive with the `drive.file` scope. The current active work includes PFOS, offline engines, database/server design, agent/bot boundaries, operations templates, knowledge ingestion, and release work.

## Authority

Read the relevant `.kiro/steering` files before acting. Use `two-agent-vps.md` for server, agent, bot, ingestion, and deployment work; use `pfos-current.md` for PFOS work; preserve `money-rules.md` and `drive-db.md` in all areas. Then read the applicable contract and `.kiro/specs/<spec>/{requirements,design,tasks}.md`. Contracts and steering outrank supporting docs and stale recommendations.

## Non-negotiable rules

- Money is integer milliunits: 1 EGP = 1000 milliunits. Never use floating-point money.
- Deterministic engines are the financial source of truth. LLM, benchmark, and routing code never computes or sources monetary values.
- Google Drive access remains `drive.file` only. Drive stores encrypted data, never keys or secrets.
- Every changed file under `src/` and `tests/` declares its owning contract and phase in the first 20 lines.
- Benchmark and routing modules stay out of the application bundle.
- Use synthetic fixtures and redacted identifiers. Never track real ledgers, secrets, credentials, hostnames, IPs, Drive IDs, webhook paths, Telegram IDs, or deployment particulars.
- Existing user modifications and untracked files are protected. Never reset, clean, overwrite, or revert them.

## Human gates

`ops/DEPLOYMENT_CONTROL.md` is the active human-only control record. Never execute, test, substitute values into, or mark complete anything from it. Never perform G1-G8, mint or rotate credentials, complete OAuth consent, register webhooks, mutate DNS, provision/mutate a host, spend against a production key, commit, or push without explicit owner authorization and applicable project authority. Never weaken an acceptance check to make it pass.

## Verification

Use focused checks while developing, then the repository gate:

```text
npm run typecheck
npm run lint
npm test -- --run <relevant-test-file-or-pattern>
npm run build
npm run verify:all -- --all
```

Report only commands actually run and observed results. The current acceptance harness is expected to report 20 of 20 checks when the repository baseline is healthy.
