# NIZAM Wave 2 A2 Drive-safe Packet - 2026-08-15

> Classification: `review_before_commit`; eligible for reviewed archive.
> Authority: A2 offline implementation only; v1.3 remains authoritative.

## Receipt markers

- `WAVE=2`
- `WAVE_STATUS=A2_IMPLEMENTED_UNCOMMITTED`
- `A2=HERMES_BOUNDARY_WITH_FAIL_CLOSED_PROVIDER_AND_BUDGET`
- `FOCUSED_TESTS=26_PASS`
- `BROAD_TESTS=59_PASS`
- `NEXT_WAVE=A3_RELAY_DRY_RUN`

## Sanitized facts

- FACT: The coordinator now makes the privacy decision before the model request and preserves the
  deterministic governor as sole ledger writer.
- FACT: Provider refusal, budget refusal, and privacy refusal were all observed in tests.
- FACT: No credential, model call, host mutation, source-control mutation, identifier, host particular,
  ledger, journal, or strict-local content is included.
- FACT: The other-repository changes remain local and uncommitted by explicit owner instruction.
