# Kiro kickoff - Two-Agent VPS Tier

Paste the block below into Kiro with this repo open. Everything it needs is in-repo; it takes no arguments.

---

## THE PROMPT

```
Build the two-agent VPS tier for NIZAM and keep going until it is offline-complete.

READ FIRST, IN THIS ORDER
1. .kiro/steering/two-agent-vps.md      <- AUTHORITATIVE for this area; read it before anything else
2. .kiro/steering/pfos-current.md       <- still authoritative everywhere else
3. .kiro/specs/06-two-agent-vps/{requirements,design,tasks}.md
4. docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md   <- full rationale + verified sources

FIRST ACTION
Run `npm run verify:all -- --all` and prove the baseline passes. If it does not, stop and report.

WHAT YOU ARE BUILDING
Two logically isolated Telegram agents on one VPS sharing one OpenRouter account: "life"
(journaling/recovery/WHOOP, lives in the separate nizamcore repo) and "finance" (budgeting/
transactions/forecasting/safe-to-spend, lives here). You build the finance side plus every
shared/text artifact, and you emit a patch series for the life side.

AUTONOMY CONTRACT
- Work tasks.md top to bottom. Do NOT ask permission between tasks or phases. Just proceed.
- The steering file is signed off and IN FORCE. Task 0.1 is already satisfied; start at 0.2.
- After EVERY phase: run the gate, tick the boxes, append to contracts/pfos/_PFOS_BUILD_LOG.md, commit, push.
- If a gate is red: diagnose, fix, re-run. Never advance on red. Never weaken or skip a check to make it pass.
- Stop ONLY for: (a) a genuine human gate (G1-G6, G8), or (b) three consecutive failed attempts at the
  same fix - then report precisely what you tried. Note G7 (repo privatization) is CLOSED as WONT-DO.
- "It needs the VPS" is NOT a reason to stop. Build it behind an injected port with a deterministic mock,
  test the mock path, record the live step in ops/GATE_REGISTER.md, and move on. That is the whole method.

HARD RULES
- No network call from a server process. The ONLY permitted live call is the Phase-1 benchmark from the
  dev machine using the existing dev key (steering section 3). If it is absent, use recorded fixtures and
  mark the registry provisional.
- Never invent, print, commit, or guess a secret. ops/ carries <ANGLE_BRACKET> placeholders only.
- The repo is PUBLIC by owner decision. No tracked file may hold a deployment particular: no real domain,
  IP, Drive id, numeric Telegram id, bot username, or real monetary figure. Synthetic fixtures only.
  Add the fail-closed harness check for this (task 9.0).
- One money implementation. Reuse src/lib/money and the Stage 1-4 engines verbatim. Never write a second one.
- Do not clone, modify, or push nizamcore. Emit ops/nizamcore-patches/*.patch instead.
- Every gate you add gets a NEGATIVE test that proves it fires. A check only ever seen passing is not evidence.
- Author contract 06 and 12 BEFORE writing code in their area, and keep AC12 (index vs log) agreeing.
- Tests ratchet up only: raise the AC04 --min floor as the count grows.

RESUMABILITY
Progress state is the tasks.md checkboxes plus the build log. If a session ends mid-flight, re-read this
prompt, re-read tasks.md, run the gate, and continue at the first unticked task. Do not restart completed work.

DEFINITION OF DONE (offline-complete)
- Every non-gated task in tasks.md ticked.
- Gate passes all checks with a ratcheted test floor.
- ops/GATE_REGISTER.md lists every human step with exact commands and a verification line.
- Contracts 06 and 12 authored; index and build log agree.
- Final report: what is built, what is gated, and the single next human action.

Begin at Phase 0 task 0.1.
```

---

## Why it is shaped this way

Four things would otherwise stop Kiro on the first turn, and each is handled above:

1. **Its own steering forbade the area.** `pfos-current.md` says "do NOT build ... no server / hosting / bot /
   ingestion until the VPS is provisioned." A compliant agent refuses everything. The new steering file
   relocates that wall from *the area* to *the network and secret boundary*, so the logic is buildable now and
   only the live calls stay gated.
2. **A circular precondition.** The wall allowed runtime work only after a Phase-1 benchmark passed, but the
   benchmark itself needs live model calls, which the wall forbade. Steering section 3 breaks the loop with an
   explicit dev-key carve-out and a `provisional` registry fallback.
3. **An unsettled decision gated the first line of code.** Steering now rules: finance server is Node/TypeScript
   so the 333 existing tests and the single money core are reused; life stays Python because its 55 tests already
   are. Contract 02's "Python + FastAPI" is overridden for the finance agent only, with the reason recorded.
4. **The repo is public, so the invariant moved.** Owner-authorized. The design may be public; a deployment
   particular may not. Enforced by a fail-closed harness check rather than by repository visibility.
5. **"Until full completion" is unreachable as literally stated.** Provisioning, DNS, BotFather, key minting,
   OAuth consent, and webhook registration are irreducibly human. So DONE is redefined as **offline-complete**:
   everything behind mocked ports, with the human remainder enumerated as a gate register. Without that
   redefinition the agent either stalls or fabricates progress.

Two further notes:

- **The autonomy clause matters more than the task list.** Agents stall by asking. The prompt pre-authorizes
  continuation and names the only three legitimate stop conditions.
- **Kiro edits one repo.** The life-side changes ship as a patch series, applied later in a second Kiro
  session opened on `nizamcore`.

## Before you paste

Nothing. The steering is signed off, G7 is closed, and the gate is green at 19/19. Paste and let it run.

If you later disagree with a line in `.kiro/steering/two-agent-vps.md`, edit it and tell Kiro to re-read it.
