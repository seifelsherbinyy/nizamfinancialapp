# LOOP.prompt.md — self-prompting build loop for spec 06

ROLE: build-loop operator in `C:\Users\selsherb\NIZAM`. Close `.kiro/specs/06-two-agent-vps/tasks.md`.
Authority order: steering `money-rules` + `drive-db` > `two-agent-vps` > `pfos-current` > this prompt.

LOOP — one task per cycle:
1. ORIENT (never infer state): `awk '/^## Waiting on user input/{exit} /^- \[( |-)\]/{print}' .kiro/specs/06-two-agent-vps/tasks.md`; `git status --porcelain`. Hash both = STATE_HASH.
2. SELECT one item: lowest `[-]`, else lowest `[ ]`. Items under "Waiting on user input" (G1-G8) are enumerated, never attempted, never ticked.
3. BUILD the smallest complete increment. New `src/`+`tests/` files declare owning contract + phase in the first 20 lines.
4. PROVE ABSENCE: every gate gets a negative case asserting its named finding code, shown firing. A tamper reporting 0 changes is a false PASS. A crash is not a fired gate.
5. GATE: `npm run verify:all -- --all` must print `HARNESS PASSED`, 19 of 19.
6. FIX -> RE-GATE, max 3 attempts. Then stop and escalate as ONE specific question.
7. RECORD: tick the box; append Work / Verification / Honest scope note / Still gated to `contracts/pfos/_PFOS_BUILD_LOG.md` (never add `| Cn.n | gate: PASS` rows to `contracts/_BUILD_LOG.md`); ledger quartet via `node scripts/loop/record.mjs`: PRODUCE(builder) -> VERIFY(gate-runner) -> APPROVE(reviewer) -> CERTIFY(reviewer, RESOLVED/VERIFIED), same `--files`; re-PRODUCE if files changed; never hand-edit the ledger.
8. RATCHET the `--min` floor in `scripts/verify/all.mjs` to the proven test count. Up only.
9. COMMIT the green increment. Push only with explicit authorization; otherwise record it as pending.
10. SELF-PROMPT: rewrite this prompt with the new state into `.loop/tmp/NEXT_PROMPT.md` (gitignored) and execute it.

STOP only when all four hold in one cycle: (T1) no `[ ]`/`[-]` above "Waiting on user input"; (T2) 19/19 `HARNESS PASSED`; (T3) `node scripts/loop/verify-ledger.mjs` exits 0; (T4) `ops/GATE_REGISTER.md` complete plus a final report naming exactly ONE next human action. Three of four is red.

NEVER: invent a secret or deployment particular (domain, address, drive id, numeric user id, real figure); lower a floor, delete or skip a test, loosen an assertion, or allowlist a scanner to pass; tick a gated item; call the network from a server process or use a production secret; clone or edit the other repository (emit `ops/nizamcore-patches/NNN-*.patch`); force-push or rewrite history; claim a run you did not show.

BOUNDS: 40 cycles. Identical STATE_HASH twice = NO_PROGRESS -> escalate, do not spin.

RESUME: 7.6 is red — `src/server/ops/runbookTemplate.test.ts` proves 49 finding codes still have no negative case; then 8.1-8.4, 9.0-9.4, Gate block. 1550 tests, floor 331.

PER CYCLE PRINT: cycle · task · what changed · gate n/19 · tests N (floor M) · commit · next task.
