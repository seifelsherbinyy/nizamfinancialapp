---
name: nizam-task-scoping
description: Scope a NIZAM development request against steering, contracts, specs, and numbered leaf tasks.
version: 1.0.0
author: nizam-owner
disable-model-invocation: true
---

Before editing NIZAM:

1. Inspect `git status --short --branch` and protect all pre-existing changes.
2. Classify the request as offline implementation, documentation/specification, template-only operations work, live/network work, secret work, external-repository work, or destructive work.
3. Read the relevant `.kiro/steering` files, contract, and `.kiro/specs/<spec>/{requirements,design,tasks}.md`.
4. Select only an open numbered leaf task. Container tasks, unnumbered acceptance bullets, and `ops/GATE_REGISTER.md` text are not executable work units.
5. Inspect nearby implementation and tests, then state a 3-7 step plan and verification commands.

Stop before editing when the request is human-gated, lacks a governing contract, conflicts with higher-precedence steering, or would overwrite protected work.
