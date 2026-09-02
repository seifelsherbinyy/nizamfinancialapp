---
name: nizam-start-task
description: Scope and begin a NIZAM implementation task from repository authority and a numbered leaf task.
---

# Start a NIZAM task

Use this skill before changing application, test, or build-tooling code.

1. Capture the current branch and worktree state.
2. Classify the request as offline implementation, documentation/specification, template-only operations work, live/network work, secret work, external-repository work, or destructive work.
3. Identify the governing steering file, contract, and spec. For server/agent/bot/ingestion/deployment work, read `two-agent-vps.md`; for PFOS work, read `pfos-current.md`; always preserve `money-rules.md` and `drive-db.md`.
4. Find the smallest numbered open leaf task in the relevant `tasks.md`. Read its parent context and acceptance bullets.
5. Locate the nearest existing implementation and tests. Reuse established conventions.
6. Write a short plan of 3-7 files or actions, including the verification command.

Stop before editing when the work is gated, lacks a governing contract, conflicts with a higher-precedence steering rule, or would overwrite protected user changes.
