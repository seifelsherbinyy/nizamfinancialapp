# Spec 07 tasks - Bot bring-up v1.0

> Read `README.md` first. Rules that bind every task below:
> **never invent a secret value**, **never commit a real secret**, **never weaken a guard to make a
> test pass**, **never mark a gated item done**, **never tick a gate box you have not observed**, and
> **never lower the test floor**. A task that cannot be finished honestly is recorded as blocked with
> the exact next action, not softened.
>
> Every task that adds behaviour adds negative tests, and a negative test must be **shown failing**
> before it is trusted. A gate only ever observed passing is unproven.

## Wave 0 - stop the bleeding

- [ ] 0.1 Commit the untracked ladder directory so the harness is green again. It currently fails two
      named checks, both from one uncommitted entry, and the build loop's own stop rule forbids
      stopping on a red harness. Confirm with a full run, not a single check.
- [ ] 0.2 Record **F18** on the register as an open finding with its measured blast radius (606
      extensionless relative specifiers across 142 files under `src/server`) and the v1.0 decision
      **D-F18-SCOPE**: bypassed by a resolve hook for a non-container deployment, not fixed. Name the
      three images that cannot start until it is fixed properly.
- [ ] 0.3 Correct the two stale claims in the spec 06 final report rather than leaving them to be
      re-read as current: the harness figure and the "every increment pushed" line. Keep them as
      dated records and state the live figure beside each, in the style that document already uses.

## Wave 1 - the owner's rulings

- [ ] 1.1 Put **D-LIFE-RUNTIME**, **D-F18-SCOPE** and **D-BENCH** to the owner as three questions with
      a recommendation each, in one pass. Proceed on the recommendation while waiting. Record each
      ruling with its date where the other decisions are recorded.
- [ ] 1.2 If D-LIFE-RUNTIME resolves to option A, amend the steering file that assigns the life agent
      to the other repository, and cite the ruling. Do not amend it silently and do not amend it
      before the ruling.

## Wave 2 - agent identity

- [ ] 2.1 Parameterise the assembly by agent identity (**S7**). Resolve the per-agent entry names
      through the existing helper rather than a second mapping, so the two cannot drift. Refuse an
      identity outside the enumerated set instead of defaulting it, and negative-test that refusal.
- [ ] 2.2 Prove isolation for the pair, not just for one: two processes started together must each
      open only their own store, hold only their own key, and consume only their own periodic
      allowance. Assert a process **cannot** open the other's store, in both directions.

## Wave 3 - the network seams

- [ ] 3.1 **S1 inbound.** Long-poll `getUpdates` against the configured base, bounded body, offset
      advanced even when a delivery is refused, so a refusal cannot become a loop. Negative-test:
      a non-success status stops rather than retries forever; an over-length body is refused rather
      than buffered.
- [ ] 3.2 **S2 outbound.** `sendMessage` through the existing retry and rate-limit refusal policy.
      Negative-test the rate-limit refusal and the bounded retry budget. Assert no message text and
      no credential reaches a log line.
- [ ] 3.3 Observe **L3'** end to end against one bot: a real message in, a real answer out, from the
      developer machine first, using the owner's own identifier as the only allowlisted sender.
      Then assert the unlisted-sender refusal is still silent about which check failed.
- [ ] 3.4 Prove exactly-once across a restart: kill the agent mid-work, restart, and show the
      in-flight update completes once. Assert against the stored offset and the queue, not against
      the reply.

## Wave 4 - the model seams

- [ ] 4.1 **S3 model port.** A real completion call that honours the per-agent cap before it spends,
      records reported cost, tokens, latency and schema validity, and carries **no prompt text** into
      telemetry. Negative-test the cap refusal and the four telemetry layers independently.
- [ ] 4.2 **S4 request planner.** Turn plus facts to a request against a pinned slug. A slug absent
      from the registry is refused rather than substituted.
- [ ] 4.3 **S5 turn facts.** A real extraction step so a turn can classify above the no-model tier.
      The no-model tier must still hold no capability to reach a model: keep that a type-level
      guarantee, do not replace it with a runtime branch.
- [ ] 4.4 **S6 deterministic answers.** Replace the bare identifier reply with a human sentence for
      each deterministic intent. Thin on purpose: this is not the budgeting pipeline, it is the
      difference between a reply and a UUID.
- [ ] 4.5 Observe **L4'**: drive one agent's ledger to its cap, show the next call refuses, show a
      deterministic alert still fires with the model tier off, show the other agent unaffected. Then
      the sentinel file, then the halt-all entry across a restart.

## Wave 5 - the measured registry (gated on D-BENCH)

- [ ] 5.1 `BLOCKED - awaiting owner` until **D-BENCH** is authorised. Run the pre-flight estimate,
      which spends nothing, and report the estimate and the ceiling side by side.
- [ ] 5.2 One pass, once, from the developer machine, on the sanitized eval set. Do not retry a
      refusal in a loop. A partial run falls back to the fixture path rather than emitting a
      half-measured registry.
- [ ] 5.3 Emit through the witnessed path and assert the result: not provisional, one entry per graded
      model, entry count equal to the models actually run. Negative-test: remove one case from a
      model's answers and show the emission **refuses** rather than emitting.

## Wave 6 - the host (gated on G1, G3-placement, G4)

- [ ] 6.1 `BLOCKED - awaiting human` on **G1**. Work the register's G1 steps to the end, finishing with
      the root-owned configuration directory. Record the observation, never the value.
- [ ] 6.2 `BLOCKED - awaiting human` on **G3 placement** and **G4**. Place the two bot tokens and the
      two model keys into the per-agent configuration files at mode-restricted, root-owned paths.
      Verify by count, never by printing a value.
- [ ] 6.3 Author the service-manager units, one per agent identity, running under the resolve hook per
      D-F18-SCOPE. No published port. Restart on failure. Environment loaded from the per-agent file
      only. Include the halt-all entry so a halt survives a restart.
- [ ] 6.4 Install and start both agents on the host. Observe **V1**, **V2**, **V4** and **V7** there,
      not on the developer machine. A rung observed only locally is recorded as observed locally.

## Wave 7 - close out

- [ ] 7.1 Optional and cheap: start the webapp mode on loopback and reach it over the administrative
      tunnel. Confirm it publishes no host port and that the bind cannot be widened by configuration.
- [ ] 7.2 Write `LIVE_PROGRESS.md` for this spec: one row per condition V1 to V8, per ladder rung, per
      seam S1 to S7, and per gate this spec needs. `State` is exactly one of `OBSERVED`,
      `BLOCKED - awaiting human`, `BLOCKED - awaiting build`, `NOT STARTED`. Evidence is mandatory for
      `OBSERVED`: a row with no evidence is `NOT STARTED` no matter how finished the code looks.
      Close with three lines: what is live, the single next blocking action and whose it is, and the
      count of section 1's eight conditions observed, as a count out of eight.
- [ ] 7.3 Ratchet the test floor to the count this spec's tests actually produce. Up only.
- [ ] 7.4 Full harness run, green, tree committed. Do not stop on a red harness and do not stop with an
      unwritten progress record.

## Waiting on the owner

Do not tick these. They are observations a human makes, recorded in the gate register.

- [ ] G1 provision and harden the host
- [ ] G3 placement of the two bot tokens
- [ ] G4 two model keys with periodic caps
- [ ] D-LIFE-RUNTIME ruling
- [ ] D-BENCH authorisation

## Dependency graph

```json
{
  "waves": [
    { "wave": 0, "tasks": ["0.1", "0.2", "0.3"] },
    { "wave": 1, "tasks": ["1.1", "1.2"] },
    { "wave": 2, "tasks": ["2.1", "2.2"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "wave": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "wave": 5, "tasks": ["5.1", "5.2", "5.3"] },
    { "wave": 6, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "wave": 7, "tasks": ["7.1", "7.2", "7.3", "7.4"] }
  ],
  "notes": [
    "Wave 3 is the shortest path to a bot that answers, and it does not depend on wave 5.",
    "Wave 5 gates condition V3 only. Waves 3 and 4 can be observed with deterministic answers first.",
    "Wave 6 is the only wave that cannot start until a human has worked G1."
  ]
}
```
