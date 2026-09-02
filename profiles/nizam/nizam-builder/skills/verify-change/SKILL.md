---
name: nizam-verify-change
description: Verify a NIZAM implementation without weakening gates or overstating evidence.
---

# Verify a NIZAM change

1. Run the narrowest relevant test or check first.
2. Run `npm run typecheck`, `npm run lint`, and `npm run build` when the changed surface requires them.
3. Run `npm run verify:all -- --all` for repository-level handoff. Treat the current harness as the authoritative acceptance gate.
4. Parse harness output using only column-zero PASS/FAIL lines; indented lines are details, not separate checks.
5. If a check fails, diagnose the cause and fix the implementation or report the blocker. Never edit the verifier to hide the failure.
6. Confirm that new source/test files have contract/phase headers, tests remain deterministic, secrets and deployment particulars are absent, and no bundle-isolation rule was violated.
7. Report each command actually run, its observed result, and any pre-existing dirty-tree limitation. Do not claim a full green harness unless it was actually run and passed.
