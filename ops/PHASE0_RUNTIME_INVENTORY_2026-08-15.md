# Phase 0 Runtime Inventory - 2026-08-15

> Owning artifact: Wave 1 production-controller discovery.
> Privacy class: `review_before_commit` / Drive-safe after review.
> Scope: redacted architecture and runtime evidence only.

## Evidence discipline

- FACT: The connected Drive contains the final Drive-safe v1.3 master contract dated 2026-08-13.
- FACT: The local repository is on `master` at the same commit as `origin/master` and has uncommitted
  user changes.
- FACT: The latest local verification-ledger receipt predates this inventory.
- INFERENCE: Historical receipts cannot establish the current live deployment state.

## Local repository

- FACT: Deterministic PFOS engines, server-side SQLite abstractions, ports, mocks, routing, signal validation,
  ingestion, and operations templates exist locally.
- FACT: The repository gate was run during this wave and reached 18 of 20 checks.
- FACT: The two failures were working-tree cleanliness and push-readiness; typecheck, lint, tests, build,
  privacy, contract consistency, and deployment-particular checks passed.
- MISSING: A clean owner-approved release tree.

## VPS observation

- FACT: A read-only SSH probe reached the existing OVHcloud host.
- FACT: The host reported a current Linux installation, x86_64 architecture, four CPU workers,
  approximately eight GiB memory, approximately 75 GiB storage, UTC time, Docker, Docker Compose,
  Python, UFW, Fail2ban, and SSH.
- FACT: No JavaScript runtime, Hermes executable, NIZAM/PFOS checkout, NIZAM/PFOS systemd unit, application
  container, or application listener was observed.
- FACT: SSH was the only observed public listener; the HTTPS firewall rule existed but no application was
  listening on it.
- MISSING: Production runtime, local operational stores, scheduler, memory directories, health receipts,
  backup/restore evidence, and live application logs.

## External surfaces

- FACT: Local ignored environment files contain configuration names for Telegram, OpenRouter, Drive,
  allowlists, caps, kill-switch behavior, and service bindings.
- MISSING: Proof that production values are installed and usable on the VPS.
- MISSING: Hermes-owned Telegram transport, live OpenRouter routing, registered webhooks, and live mirror
  read-back.

## Scope boundary

- FACT: No secret values, hostnames, addresses, identifiers, webhook paths, ledger data, or personal case
  history are included in this artifact.
- FACT: `ops/DEPLOYMENT_CONTROL.md` was not edited, executed, substituted, or marked complete during inventory.
