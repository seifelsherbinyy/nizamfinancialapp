# NIZAM — Master Index
Private YNAB-style personal-finance webapp · Google Drive as database · built by KIRO from contracts.

## Start here
- `README.md` — what NIZAM is + how to run (post-build)
- `BUILD_PLAN.md` — the plan KIRO follows
- `contracts/_CONTRACT_INDEX.md` — the 5 contracts + status
- `contracts/_KIRO_LOOP_PROTOCOL.md` — the engineering loop

## Contracts (`contracts/`)
1. `CONTRACT_1_foundation.md` — toolchain + money core + types
2. `CONTRACT_2_drive_data_layer.md` — Drive-as-database + sync + import
3. `CONTRACT_3_budget_engine.md` — YNAB zero-based engine
4. `CONTRACT_4_ui_ynab.md` — YNAB-style UI
5. `CONTRACT_5_reports_release.md` — reports + rescue analytics + release

## KIRO-native (`.kiro/`)
- `steering/` — product, tech, structure, money-rules, drive-db, loop-protocol (always-on guidance)
- `specs/01..05/` — requirements (EARS) · design · tasks per contract

## App source (`src/`) — placeholders, filled by KIRO
- `lib/money` money core · `lib/drive` Drive-as-DB · `lib/db` schema/cache · `lib/ledger` read model
- `features/` budget · accounts · transactions · reconciliation · reports · import
- `app/` router+providers · `state/` store · `styles/` theme

## Data & docs
- `data/ledgers/LEDGER_SCHEMA.md` — authoritative 25-col ledger contract
- `data/seed/` — category + limits seeds (placeholders)
- `docs/architecture/`, `docs/adr/` — design docs (placeholders)
- `docs/research/` — the research corpus from 47_NIZAM BANKING (design source of truth)

## Two-agent VPS deployment — operator state (`06-two-agent-vps` tier)
- `docs/OPERATOR_HANDOFF_2026-08-09.md` — human-facing: where the deployment stands + decisions owed
- `.kiro/specs/06-two-agent-vps/OPERATOR_STATE_2026-08-09.md` — machine-readable gate snapshot + build findings (O1 no images/entrypoint)
- `ops/GATE_REGISTER.md` — the G1–G8 human-gate register (authority; carries a 2026-08-09 G1 observation)
- `.kiro/specs/06-two-agent-vps/FINAL_REPORT.md` — the build's own what-is-built / what-is-gated report
- deployment particulars are **untracked** by design (R24): see `outputs/*.local.md` on the operator machine

## Build tooling (not committed to app)
Generators live outside the repo at `~/.nizam_build/`.
