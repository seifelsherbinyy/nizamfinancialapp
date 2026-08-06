# Design - Two-Agent VPS Tier

> Full rationale, comparisons, and verified source citations: `docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md`.
> This file is the build-facing summary. Steering: `.kiro/steering/two-agent-vps.md`.

## Shape

```
Telegram --443--> caddy --/tg/<secret-a>--> life-agent    (nizamcore, Python)   -> life.db
                        \-/tg/<secret-b>--> finance-agent (this repo, Node/TS)  -> finance.db
                                                  \                /
                                                   signalbus (internal only)    -> signals.db
                          scheduler | backup | (optional shared router)
```

Isolation: separate process, DB file, volume, bot token, and OpenRouter key per agent. Shared: the host, the
OpenRouter **account** (two keys), and the signal bus schema.

## Repo layout added by this spec (finance side)

```
src/server/                 # Node/TS server tier (NOT in the browser bundle)
  db/                       # node:sqlite, WAL, migrations, repositories
  telegram/                 # webhook handler behind a port + deterministic mock
  routing/                  # classifier, router, spend ledger, telemetry
  signals/                  # bus client + consent gate + envelope validation
  ports/                    # every external boundary as an interface + mock
ops/                        # TEXT ONLY, placeholders only, never executed by Kiro
  docker-compose.yml  Caddyfile  env/*.env.example  systemd/*  backup/*  restore/*
  GATE_REGISTER.md          # the human-gated items, with exact steps
  nizamcore-patches/        # patch series for the OTHER repo (steering §6)
```

`src/server/**` must never be imported by `App.tsx` or the browser router, exactly as
`src/features/benchmark/**` and `src/features/routing/**` are already excluded.

## Key decisions

1. **Ports and mocks everywhere.** Every external boundary (Telegram, OpenRouter, Drive, WHOOP, bus) is an
   injected interface with a deterministic mock. This is what makes the tier fully buildable and testable with
   no VPS and no secret, and it is already the house pattern.
2. **Reuse, do not rewrite.** `nizamcore/NIZAM__system/relay/auth.py` and `dedup.py` already implement
   constant-time secret-token comparison, the allowlist, and update dedup, with tests. The finance agent ports
   that *logic* to TypeScript; it does not invent a new scheme. The money core and Stage 1-4 engines are reused
   verbatim, which is why the finance runtime is Node (steering §1).
3. **Dedup must be namespaced per bot (R14).** `dedup.py` keys a single shared state file by update id only.
   Update ids are per-bot sequences, so two bots collide. Correct key is `(bot_id, update_id)`, and in SQLite
   it becomes `INSERT OR IGNORE` on a UNIQUE index, which also removes the read-modify-write race that the
   JSON file has under concurrent webhook delivery.
4. **Acknowledge fast, process async (R15).** The current handler processes inline; a slow model call would
   exceed Telegram's tolerance and trigger redelivery. Accept, enqueue, return promptly.
5. **Consent by absence (R7).** The signal envelope has no field capable of carrying a figure or free-form
   narrative. Leakage is prevented by the schema lacking the field, not by a runtime filter that could be
   bypassed. Negative tests assert rejection.
6. **Two keys, one account.** OpenRouter supports many keys per account, each with its own `limit` and
   `limit_reset` (daily/weekly/monthly). One key per agent gives platform-enforced budget isolation on top of
   the in-app cap.
7. **Kill switch as a file sentinel, not only an env var.** An env var cannot be flipped without a restart.
   Check a sentinel path per call so a single touch halts every writer immediately; keep `NIZAM_KILL_ALL` as
   the coarse form.

## Testing strategy

- Pure functions and repositories: unit tests over an in-memory or temp-file SQLite.
- Every gate gets a **negative** test that proves it fires: bad token, wrong user, duplicate update, colliding
  update ids across two bots, over-cap spend, a signal carrying a figure, a `producer_only` signal, a
  provisional registry attempting promotion, a cross-agent DB open.
- A test that has only ever been observed passing is not evidence. Each negative test must be shown failing
  the guarded operation, not merely returning a value.
