# HIMAYAH Classification - Wave 2 Safe Scope

> Decision: ALLOW reviewed mirror for sanitized evidence only.
> Scope: A1, A2, A4, and A5 offline evidence; A3 remains human-gated.

| Artifact | Classification | Destination | Decision | Reason |
|---|---|---|---|---|
| A1 runtime reassessment | `review_before_commit` | Drive-safe archive | ALLOW | Compatibility decision and resolver evidence only |
| A2 implementation receipt | `review_before_commit` | Drive-safe archive | ALLOW | Offline boundary and deterministic test evidence only |
| A4/A5 receipt | `review_before_commit` | Drive-safe archive | ALLOW | Placeholder and routing hygiene evidence only |
| Credentials, tokens, operator values, host particulars, live relay data, and personal ledgers | local-only classification | Drive/GitHub/model provider | DENY | Remain outside the reviewed mirror |

## Mirror controls

- FACT: Only sanitized packets may be mirrored; no secrets, identifiers, host particulars, live payloads, or
  personal financial data may leave the local boundary.
- FACT: Each mirrored packet requires marker verification and a readable post-upload check.
- FACT: No A3 live-relay or credential-bearing artifact is eligible for this mirror.
