# Wave 2 A1 Runtime Reassessment - 2026-08-15

> Status: COMPLETE for A1 only.
> Classification: `review_before_commit`; sanitized evidence.
> Authority: Spec 07 A1 and two-agent steering §1/§2a.

## Decision

- DECISION: Adopt the declared Hermes runtime for the life agent.
- CONDITION: Pin the runtime to the first published release line compatible with the observed host
  Python 3.14 family; do not rely on the newest release resolving on that host.
- SCOPE: No host installation, repository installation, credential, model call, service start, or gate
  action was performed.

## Observed evidence

- FACT: The other repository declares `hermes-agent>=0.12` and assigns three profile names: `nizam-coord`,
  `shura`, and `naqd`.
- FACT: The public package index has no published 0.12 release. The first published compatible line is
  the 0.15 line; later current releases declare a Python upper bound below the observed host family.
- FACT: A wheel-only resolver run targeting Python 3.14 completed successfully for the declared range and
  selected the compatible 0.15 line with its pinned base dependencies and compatible platform wheels.
- FACT: A disposable target install was started outside both repositories and stopped after the package
  wheel transfer stalled. No repository or host state changed.
- FACT: Hermes profiles are independent named homes; the three registry names are valid profile identifiers
  and match the runtime's profile model.

## Required amendments

- A5.1: Replace the fictitious lower-bound-only declaration with an explicit compatible-release range.
- A5.2: Install the base runtime plus only the directly required Telegram library; do not use the broad
  messaging extra.
- A5.3: Keep provider model identifiers fully qualified and tool-capable; this remains a later wiring check.

## Boundary

- MISSING: Coordinator model wiring, relay release, the dangling decision-log persona, and other-repository
  local commit.
- BLOCKED: Any live model call, host installation, credential use, or push remains outside A1.

## Post-A1 installation receipt - 2026-08-15

- PASS: Hermes 0.15.2 installed on the VPS in `/opt/nizam/hermes` with Python 3.14.4 compatibility.
- PASS: Separate `nizam` and `pfos` profile homes created under the Hermes profile directory.
- PASS: NIZAM default model set to `xiaomi/mimo-v2.5`; PFOS default model set to `z-ai/glm-5.2`;
  both profiles select OpenRouter.
- NOT DONE: No model call, gateway start, Telegram token installation, or production key installation was
  performed.
- BLOCKER: The available secret inventory contains one OpenRouter development key, while the governing
  contract requires one isolated key and cap per agent. The existing finance Telegram process also owns its
  current bot polling loop, so Hermes cannot start against that identity without a cutover plan.
