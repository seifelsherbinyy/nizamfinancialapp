# Cross-repo change series for the life agent

> Owning contract: **PFOS Contract 12 - Two-Agent VPS Deployment and Operations**, Phase 8
> (spec `06-two-agent-vps`, tasks 8.1-8.4). Steering: `.kiro/steering/two-agent-vps.md` section 6.
>
> **NOTHING HERE IS EXECUTED BY AN AGENT, AND NOTHING HERE WAS APPLIED.** These are four text
> files. No tool ran them, no repository was cloned, and the target repository was never read.

## What these files are, and what they are not

Four changes are needed in the OTHER repository - the life agent's - before the two-agent
deployment can stand up. Steering section 6 says the agent working in this repository must not
clone, fetch, read, modify or push that repository. So the changes are emitted here, as reviewable
text, and applied later by a human in a session opened on that repository.

| File | Subject | Form |
|---|---|---|
| `001-fastapi-wrapper.patch` | Serve the existing update handler over an ASGI application; add a readiness endpoint | change specification |
| `002-dedup-per-bot.patch` | Key the dedup store on the pair `(bot_id, update_id)` rather than the identifier alone | change specification |
| `003-signalbus-egress-target.patch` | Add a `signalbus` egress target for the two narrow tiers only | change specification |
| `004-hermes-profile-adapter.md` | Replace the coordinator stub with a fail-closed Hermes one-shot boundary | locally tested handoff note |

**They are not applicable diffs, and they do not pretend to be.** A unified diff needs three
things: the target paths, the changed lines, and enough surrounding context to locate each hunk.
The first two can be written from documented interfaces. The third cannot - context lines are a
verbatim quotation of a file this session is forbidden to read.

So each file is an explicitly-labelled **change specification**: exact target path, exact function,
before-and-after intent, and the new code in full. Each opens with a header stating which
repository and branch it targets, that it was authored from documented interfaces rather than from
a checkout, that its context is therefore not reconstructed at all, and what a human must verify
after applying.

Two things you will not find in them, deliberately:

- **No index line, and no blob hash.** Those are content addresses. They cannot be derived from a
  description, only computed from bytes, so writing plausible ones would make an unverified change
  look verified.
- **No claim that anything applies cleanly, compiles, or passes.** Nobody has applied these. Nobody
  has run the target repository's suite against them.

Each file also names, in its header under `NOT VERIFIED`, the specific things that could not be
determined from here - the update handler's return contract, which module each transport guard
actually lives in, the on-disk shape of the persisted dedup ring, the exact key names in the
policy document. Those are the reconciliation points, not afterthoughts.

## Apply order, and why this order

**001, then 002, then 003, then 004.** The numbering is the order. It is not arbitrary and it is not
alphabetical convenience.

**001 first, because it is purely additive.** It creates two new files and adds two dependency
entries. It modifies no existing logic, so it can be applied, tested and reverted on its own, and a
failure in it cannot be confused with a failure in anything else. It also stands up the test
harness that drives the transport end to end, which is what 002's most important test needs in
order to prove the fix through the live path rather than only against the module in isolation.

**002 second, because it is the only change in the series that migrates state.** The persisted
dedup file changes shape, and a format change wants to land when the surface above it is already
settled and green. Applying it before 001 would mean changing a call site inside a request handler
that is about to be replaced - doing the same edit twice, with two chances to get it wrong.

**003 third, for two reasons.** It is independent of the transport entirely: it touches the
governor and the policy document, not the relay, so nothing in 001 or 002 blocks it and nothing in
it blocks them. And it is the only change in the series that **widens what may leave the machine**.
It should land when the two mechanical changes are already green, so that if an egress regression
ever appears, a bisect lands on a one-concern change instead of on a commit that also moved the
transport.

**004 fourth, because it is the final runtime capability boundary.** It replaces the coordinator
stub with a Hermes one-shot adapter only after the relay, deduplication, and egress changes have
been reconciled and tested. The target session must re-read the real files first: this handoff note
was authored without reading that checkout. Its verification must preserve local capture fallback,
fail-closed live mode, stdin-only/non-shell execution, absolute profile validation, model
validation, bounded execution, and secret-free unavailable results.

**Do not reorder to get a green suite faster.** If 002 is applied first, its expected call-site
failures and 001's import questions arrive at the same time, and telling them apart costs more than
the ordering saves. Do not apply 004 before 001-003: its coordinator boundary depends on the
transport and policy behavior being settled first.

## How to apply and verify each one

Do all of this in a session opened on the target repository. One branch per change, one commit per
change, so each can be reverted alone.

### 001 - the ASGI wrapper

```
git switch -c cross-repo/001-fastapi-wrapper
# Create NIZAM__system/relay/asgi_app.py verbatim from section 3.1 of the specification.
# Create NIZAM__system/relay/tests/test_asgi_app.py verbatim from section 3.2.
# Add the two dependency entries from section 3.3, pinned to versions that resolve here.
# Work through section 4 - especially items 1 and 2 - before running anything.
python -m pytest -q
git add NIZAM__system/relay/asgi_app.py NIZAM__system/relay/tests/test_asgi_app.py
git commit -m "feat(relay): serve the update handler over ASGI and add readiness"
```

**Verify:** the seven new tests pass, the pre-existing count is unchanged, and the three
transport guards are reached on the new path - which the first four new tests assert by driving
the route rather than the handler. Then re-read `poller.py` and confirm it is untouched.

### 002 - dedup keyed per bot

```
git switch -c cross-repo/002-dedup-per-bot
# Replace NIZAM__system/relay/dedup.py with section 3.1 of the specification.
# Update the call sites per sections 3.2 and 3.3, then search the whole repository
# for any third call site the documentation did not record.
# Add the seven tests from section 3.4.
python -m pytest -q
git add NIZAM__system/relay/dedup.py NIZAM__system/relay/poller.py \
        NIZAM__system/relay/webhook.py NIZAM__system/relay/tests/test_dedup.py
git commit -m "fix(relay): key update dedup on the bot and identifier pair"
```

**Verify:** `test_two_bots_emitting_the_same_identifier_are_both_processed` passes - and confirm it
FAILS on the parent commit, because a test that cannot fail proves nothing. Confirm the state file
survives a reload, and confirm no call site was made to compile by supplying a default bot
identifier.

### 003 - the signalbus egress target

```
git switch -c cross-repo/003-signalbus-egress-target
# Add the two rows to NIZAM__system/policies/PRIVACY_CLASSIFICATION.json per section 3.1.
# Add the matrix entries and the assertion to the governor per section 3.2.
# Add the five tests from section 3.4.
python -m pytest -q
git add NIZAM__system/policies/PRIVACY_CLASSIFICATION.json \
        NIZAM__system/governor/classifier.py \
        NIZAM__system/governor/tests/test_classifier.py
git commit -m "feat(governor): add a signalbus egress target for the narrow tiers"
```

**Verify:** the bus is reachable from `money_safe` and `life_safe`, blocked from all five
pre-existing tiers, and the family classification still has an **empty** egress set - read the row
itself, not only the test result. Its key appears in 003 as `<FAMILY_CLASSIFICATION>`; substitute it
from the policy document, because this repository is public and does not write that key down.

### 004 - the Hermes profile adapter

```
git switch -c cross-repo/004-hermes-profile-adapter
# Re-read the real coordinator, relay, and test files before editing them.
# Add the adapter and its tests under the relay tree, and update the coordinator per section 3
# of the specification. Preserve the existing local-capture path and status ledger contract.
# Stage only the files actually changed after inspection; do not invent paths or use git add -A.
python -m pytest -q
git commit -m "feat(relay): add the fail-closed Hermes profile adapter"
```

**Verify:** with the live flag absent, the local-capture path still works. With live mode enabled,
the request reaches the subprocess through stdin only, with no shell and no positional arguments;
the profile home is absolute and configured, the model is valid, and timeout, process failure,
empty output, or secret-shaped output yields `unavailable` without model evidence. Confirm the
coordinator ledger records only `local_capture`, `ok`, or `unavailable`, then inspect the diff and
let the owner decide whether to commit or push.

### If you would rather work with a diff

Convert a specification's section 3 into a unified diff **in the target repository**, where the
context is in front of you, and apply it with a three-way merge:

```
git apply --3way cross-repo-001.diff
```

Three-way is not a convenience here. Without it, a hunk whose context has drifted is rejected
wholesale or - worse, with fuzz - applied somewhere plausible and wrong. With it, a hunk that no
longer fits becomes a conflict you resolve. Never use `--unidiff-zero`, and never hand-edit a
rejected hunk into place without re-reading what surrounds it.

## Expected test deltas

**The baseline is 55 passing tests plus 14 subtests.** That figure is what
`docs/NIZAM_TWO_AGENT_VPS_ARCHITECTURE.md` section 0 records for the target repository as of its
own verification date. **This session did not observe it** - it could not, having never read that
repository. Re-read the real count before applying anything, and if it disagrees with 55, treat the
note as stale rather than the suite as wrong.

| Change | Tests added | Existing tests affected | Predicted total |
|---|---|---|---|
| 001 | 7 | **0** - two new files, no existing module touched | 62 |
| 002 | 7 | **not zero** - every existing dedup call site fails until updated to pass the pair | 69 |
| 003 | 5 | **0 for the logic**; any test asserting the complete set of tiers or targets by equality will fail and must be extended | 74 |
| 004 | not asserted from this repository | coordinator and new adapter tests; re-read the target suite first | no predicted total |

Do not predict the 004 total from this repository; re-read the target suite and record the actual
delta after applying and testing it.

Three honest notes on that table:

1. **002's existing delta is expected, not a regression.** Changing the dedup signature breaks
   every one-argument call. How many such calls there are is unknown from here. Each is updated to
   name a bot. Do **not** add a default bot identifier to make the old calls compile - a default is
   precisely the shared namespace this change removes.
2. **003's enumeration failure, if it happens, is fixed by extending the expected set, never by
   weakening the assertion** from equality to containment. An equality assertion over a policy
   enumeration is the mechanism by which an unreviewed tier gets noticed.
3. **Every total in that table is a prediction from a session that could not run the suite.** They
   are there so a human can tell an expected delta from a surprise, not so anyone can report them
   as achieved.
4. **004 is a runtime-boundary change, not a secret-management change.** Its provider credential
   remains supplied through the separately managed Hermes profile environment; no secret belongs
   in the target repository or in this handoff series.

Nothing in any of the four changes may be made green by skipping a test. An unskipped failure is
information; a skipped one is a guard nobody notices is missing.

## Where this is applied

**Not from here.** These four files are authored in `nizamfinancialapp` and applied in a **separate
Kiro session opened on the other repository**. Steering section 6 forbids this repository's agent
from cloning, fetching, reading, modifying or pushing that one, and that boundary is the reason the
series exists as text instead of as commits.

Concretely, that means the session which wrote these files:

- ran no `git clone`, no `git fetch` and no `git apply`;
- made no network request to any code host;
- created no submodule and no vendored checkout;
- read not one byte of the target repository - so every statement above about that repository is
  sourced from documentation in **this** repository, and is labelled as such in each header.

## What must never happen

- **Do not apply these from a session opened on this repository.** Wrong repository, wrong branch,
  and it violates the boundary the series exists to respect.
- **Do not add an `index` line, a blob hash, or a "verified" note to any of these files** unless the
  session doing it has actually read the target repository and computed them.
- **Do not paste a real value into any of these files** - not a token, not a host, not a numeric
  messaging identifier, not a storage identifier, not a figure. They are tracked in a public
  repository. Every particular is `<ANGLE_BRACKET>` or injected at run time.
- **Do not widen the family classification.** Not to make a test pass, not to make a feature work,
  not temporarily. Its egress set is empty; that content is excluded from the deployment rather than
  filtered on the way out. And do not write its key into any tracked file here - 003 carries it as
  `<FAMILY_CLASSIFICATION>` for that reason.
- **Do not drop a transport guard in the course of moving the transport.** A wrapper that reaches
  the handler without the constant-time token comparison, the allowlist, or the dedup call is not a
  wrapper - it is a regression that presents as an open door.
- **Do not report any of these as done here.** Applying them is a human step in another repository;
  until it happens, the correct status of all four is *emitted, unapplied*.
