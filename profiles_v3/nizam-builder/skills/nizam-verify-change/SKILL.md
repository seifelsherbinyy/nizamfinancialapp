---
name: nizam-verify-change
description: Verify a NIZAM change without weakening checks or overstating evidence.
version: 1.0.0
author: nizam-owner
disable-model-invocation: true
---

1. Run the narrowest relevant test or check first.
2. Run `npm run typecheck`, `npm run lint`, and `npm run build` when the changed surface requires them.
3. Run `npm run verify:all -- --all` for repository-level handoff.
4. Parse harness results using only column-zero PASS/FAIL lines; indented lines are details.
5. If a check fails, diagnose and fix the cause or report the blocker. Never edit the verifier to hide a failure.
6. Confirm contract/phase headers, deterministic tests, integer money, privacy boundaries, and bundle isolation.
7. Report every command actually run and its observed outcome. Do not claim a green full harness unless it was run and passed.
