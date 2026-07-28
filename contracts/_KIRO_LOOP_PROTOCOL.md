# KIRO Loop Protocol (contracts runner)
See also `.kiro/steering/loop-protocol.md`.

## The loop (per phase)
```
for contract in [C1..C5]:
  for phase in contract.phases:
    read(phase + matching .kiro/specs tasks)
    build(phase.tasks)                       # replace placeholders
    while not gate_passes(phase):            # ENGINEER-IN-A-LOOP
        run typecheck / test / build
        diagnose failing gate
        fix
    tick tasks.md ; append to _BUILD_LOG.md
  mark contract DONE in _CONTRACT_INDEX.md
assert full_build_done()                     # build+tests+README+clean repo
```

## Gate commands
- `npm run typecheck` · `npm run test` · `npm run build` · `npm run lint`
- Contract-specific gates are stated in each contract's phases.

## Rules
- Never advance past a red gate. Never fake a gate.
- Money = integer milliunits; Drive scope = drive.file only; header every file with its Contract/Phase.
- Do NOT `git push` until the user provides the GitHub remote and says go (C5 Phase 5.5).
- If a dependency forces out-of-order work, note it in `_BUILD_LOG.md`.
