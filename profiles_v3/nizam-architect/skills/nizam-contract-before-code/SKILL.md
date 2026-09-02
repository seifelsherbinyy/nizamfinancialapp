---
name: nizam-contract-before-code
description: Create an evidence-grounded NIZAM contract or specification before implementing ungoverned policy.
version: 1.0.0
author: nizam-owner
disable-model-invocation: true
---

1. Identify the requested capability and repository area.
2. Search contracts, PFOS contracts, `.kiro/steering`, and `.kiro/specs` for existing authority.
3. Resolve precedence conflicts explicitly.
4. If authority is missing, draft a NIZAM-derived contract with scope, non-goals, invariants, data ownership, failure behavior, human gates, and acceptance criteria.
5. Create or update matching `requirements.md`, `design.md`, and `tasks.md` with numbered leaf tasks.
6. Add an ADR when the choice changes runtime, persistence, security, money handling, external boundaries, or a standing decision.
7. Include exact verification commands, including `npm run verify:all -- --all` where repository acceptance applies.
8. Hand the plan to the builder; do not hide new policy only in implementation code.
