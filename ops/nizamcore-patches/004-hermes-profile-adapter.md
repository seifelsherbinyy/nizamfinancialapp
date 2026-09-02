# Cross-repository change 004: Hermes profile adapter

Target repository: the owner-provided nizamcore repository
Target branch: owner-selected review branch
Source commit inspected: 071e54c
Status: locally tested in a temporary clone, not committed and not pushed

## Purpose

The nizamcore relay registry already names Hermes profiles, but its coordinator still used a
deterministic agent stub. This change adds an explicit, fail-closed one-shot Hermes boundary.

## Files

Add the Hermes adapter module and its Hermes adapter test module under the relay tree.

Update the relay coordinator module so that:

1. The existing local capture path remains active unless `NIZAM_HERMES_LIVE=1` is present in a
   protected environment file.
2. A live request uses the configured absolute Hermes profile home and model name.
3. The request body is supplied over stdin, never as a process argument.
4. The command uses the OpenRouter provider, a configured model, and a maximum of three tool turns.
5. Missing profiles, invalid models, timeouts, process failures, empty output, and secret-like output
   produce a truthful unavailable response and do not become model evidence.
6. The coordinator ledger records only a status such as `local_capture`, `ok`, or `unavailable`.

## Protected environment contract

The target service supplies these names through its protected environment file:

`NIZAM_HERMES_LIVE`
`NIZAM_HERMES_PROFILE_HOME`
`NIZAM_HERMES_MODEL`
`NIZAM_HERMES_EXECUTABLE`

No key value belongs in source, arguments, logs, this patch note, or Drive. The provider key remains
owned by the Hermes profile environment loader.

## Verification performed

The finance architecture note records a baseline of 55 passing tests for the target repository;
this session did not observe that baseline. In the local clone, `python -m unittest discover -s
NIZAM__system -p 'test_*.py'` passed 60 tests.
The new tests cover live-flag refusal, stdin-only request delivery, non-shell execution, profile-home
validation, secret-pattern refusal, and coordinator handoff. No remote mutation was performed.

## Apply and deploy gate

Apply this change in the nizamcore repository, run its full test suite, and inspect the resulting
diff before any commit or push. On the VPS, install the service environment only after the profile
has its own key and cap, the model registry is approved, and Telegram polling ownership has been
cut over without a second poller.
