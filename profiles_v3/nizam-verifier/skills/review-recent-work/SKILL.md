---
name: review-recent-work
description: Review recent NIZAM work for correctness, safety, tests, style, and acceptance regressions.
version: 1.0.0
author: nizam-owner
disable-model-invocation: true
---

Review recent NIZAM work systematically:

1. Inspect `git log --oneline -10`, `git diff`, and `git status --short --branch`.
2. Review each changed file for correctness, edge cases, safety, privacy, style, and test coverage.
3. Check applicable contract/phase headers and NIZAM invariants.
4. Run the relevant focused checks and the full acceptance harness when requested.
5. Report concrete findings with file paths and line references. Do not edit implementation files in verifier mode.
