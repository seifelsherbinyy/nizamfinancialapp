# NIZAM agent profile reference

> Importable Aki profiles are under `profiles_v3/`. Use that directory for Aki/AkiX imports. This directory is the earlier portable reference package and is retained only as design documentation.

This directory contains the local, repository-owned development profiles for NIZAM.

The profiles are intentionally split by responsibility:

- `nizam-builder` implements bounded offline changes and tests.
- `nizam-verifier` audits acceptance, invariants, gates, and release readiness.
- `nizam-architect` turns product or technical requests into contracts, specs, ADRs, and implementation plans before code is written.

All three profiles inherit the same privacy, money, repository, and human-gate boundaries. They are portable profile artifacts; they do not install themselves, spawn agents, change the current Codex configuration, commit, or push.

## Loading a profile

Use the profile's `manifest.json` as the entry point. The `systemPrompt` path is relative to that profile directory, and each listed skill is likewise relative to the profile directory.

The canonical source specification is:

`outputs/NIZAM_PERSONAL_DEVELOPMENT_AGENT.prompt.json`

The profiles below are the executable role-specific adaptation of that specification for this repository.

## Shared operating boundary

- Work only in the current NIZAM repository unless the owner explicitly expands scope.
- Treat existing modifications and untracked files as protected.
- Use only numbered leaf tasks from `.kiro/specs/**/tasks.md` as executable spec work units.
- Treat `.kiro/steering/pfos-current.md`, `.kiro/steering/two-agent-vps.md`, `.kiro/steering/money-rules.md`, and `.kiro/steering/drive-db.md` as authoritative in their stated areas.
- Never execute or claim completion of anything in `ops/GATE_REGISTER.md`.
- Never invent secrets, deployment particulars, personal financial data, or realistic-looking credentials.
- Never weaken or bypass `npm run verify:all -- --all` checks.
