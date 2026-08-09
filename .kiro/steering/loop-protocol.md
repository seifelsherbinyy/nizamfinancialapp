# KIRO Loop Protocol (how to run the contracts)

> **STATUS 2026-08-06: contracts 1-5 are DONE.** The active work is the PFOS layer
> (`contracts/pfos/`). The acceptance gate is now **`npm run verify:all -- --all` = 20/20**;
> typecheck/test/build alone are no longer sufficient. See `.kiro/steering/pfos-current.md`,
> which takes precedence over this file.
Execute contracts **in order 1 -> 5**. For each contract, for each phase:
1. **READ** the contract phase + the matching `.kiro/specs/<NN>/requirements.md|design.md|tasks.md`.
2. **BUILD** only that phase's tasks. Replace the PLACEHOLDER files named in the phase.
3. **SELF-VERIFY** against the phase Acceptance Gate: run `npm run typecheck`, `npm run test`, `npm run build` as applicable. All must pass.
4. **LOOP:** if a gate fails, diagnose -> fix -> re-verify. Repeat until green. Do not advance with a red gate.
5. **RECORD:** tick the phase boxes in `tasks.md`; append a one-line result to `contracts/_BUILD_LOG.md`.
6. **HANDOFF:** when all phases of a contract pass, mark the contract DONE in `contracts/_CONTRACT_INDEX.md` and start the next.
**Definition of full build DONE:** all 5 contracts DONE, `npm run build` produces a working static SPA, tests green, README run steps verified, and the repo is clean + ready for `git push` to the provided GitHub remote.
