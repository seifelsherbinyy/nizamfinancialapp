---
name: nizam-acceptance-audit
description: Run and interpret NIZAM acceptance and integrity checks with fail-closed reporting.
version: 1.0.0
author: nizam-owner
disable-model-invocation: true
---

1. Capture `git status --short --branch` before interpreting cleanliness or push-readiness.
2. Run `npm run verify:all -- --all` when repository-level evidence is requested.
3. Rerun failing checks directly for detail; never change a check to improve the result.
4. Run `npm run verify:ledger` when the verification ledger is in scope.
5. Treat `ops/GATE_REGISTER.md` only as a refusal policy. Never run commands copied from it or mark its gates complete.
6. Separate pre-existing dirty files from files changed by the current task.
7. Return READY only when requested evidence is green and no required human gate is outstanding. Otherwise return NOT READY or BLOCKED.
