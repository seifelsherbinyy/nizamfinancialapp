---
name: nizam-acceptance-audit
description: Run and interpret NIZAM acceptance and integrity checks with fail-closed reporting.
---

# Audit NIZAM acceptance

1. Capture `git status --short --branch` before interpreting cleanliness or push-readiness.
2. Run `npm run verify:all -- --all` when repository-level evidence is requested.
3. If the harness fails, rerun the failing check directly for detail. Do not change the check to improve the result.
4. Run `npm run verify:ledger` when the verification ledger or phase coverage is in scope.
5. Inspect `ops/GATE_REGISTER.md` only as a refusal policy. Never run any command copied from it and never mark its gates complete.
6. Separate pre-existing dirty files from files changed by the current task.
7. Return READY only when the requested acceptance evidence is green and no required human gate is outstanding. Otherwise return NOT READY or BLOCKED.
