# Phase 0 Expected-versus-Actual Gap Matrix - 2026-08-15

> Owning artifact: Wave 1 production-controller discovery.
> Privacy class: `review_before_commit` / Drive-safe after review.
> Status vocabulary: IMPLEMENTED, PARTIAL, MISSING, CONFLICT, UNVERIFIABLE.

| Requirement | Governing authority | Expected state | Observed evidence | Status | Dependency | Privacy impact | Authority impact | Required test | Wave |
|---|---|---|---|---|---|---|---|---|---|
| VPS operational home | Prompt Phase 0; PFOS 12 §§2,7 | NIZAM/PFOS services run on the VPS | Host reachable and hardened; application absent | PARTIAL | G1 | High | Host mutation remains human-only | Health, restart, firewall, restore | 3 |
| Two Hermes profiles | Prompt topology; spec 07 | Isolated `nizam` and `pfos` profiles | Hermes 0.15.2 is installed in `/opt/nizam/hermes`; isolated profile homes exist with model/provider settings and no live gateway | PARTIAL | Wave 1, G1, G4 | High | Profile capabilities must be bounded | Profile isolation and kill switch | 2 |
| Shared NIZAMCORE governance | v1.3 §§4,43,44; PFOS 12 §4 | Common typed governance ports | Finance-side ports exist; live shared runtime absent | PARTIAL | Wave 2 | Critical | Single writers and bounded signals | Signal leakage and tamper refusal | 2 |
| Two Telegram agents | Owner prompt; v1.4 delta | NIZAM commander plus PFOS specialist | Local transport code/mocks; no live agents | PARTIAL | G3, G6 | Critical | No bot-to-bot Telegram channel | Auth, allowlist, dedup, replay | 4 |
| OpenRouter routing | v1.3 §12.6; PFOS 09–11 | Approved provider, isolated caps, privacy policy | Offline/provisional routing only | PARTIAL | G4 | Critical | LLM cannot source financial truth | Cap, timeout, redaction, refusal | 4 |
| PFOS financial truth | v1.3 §§3–5,41,43 | One deterministic financial writer | Engines and SQLite abstractions pass locally; not deployed | PARTIAL | G1, Wave 2 | Critical | No LLM or router ledger authority | Milliunit parity and writer isolation | 3 |
| Separate stores | PFOS 12 §3; Contract 06 §§2–3 | Separate life, finance, and signal stores | Finance-side isolation tests exist; no live stores | PARTIAL | Wave 3 | Critical | Cross-store access prohibited | Cross-store refusal | 3 |
| Memory hierarchy and Drive mirror | v1.3 §§8,20.5,50–55 | Local truth; reviewed encrypted Drive archive | Local Drive layer and backup abstractions; no live read-back | PARTIAL | G5, G8 | Critical | External write requires HIMAYAH | Classification, receipt, read-back, restore | 5 |
| Security boundary | v1.3 §50–51; steering | No secret or personal plaintext egress | Gitignore/scans pass; host firewall and Fail2ban observed | PARTIAL | G1, G4, G5, G8 | Critical | Credential operations remain human-only | Leakage and permissions | 5 |
| Release verification | PFOS 12; v1.3 §55 | Live receipts, recovery, tamper proof, clean gate | Static negative tests pass; live proof absent; fresh gate 18/20 | PARTIAL | All prior waves | High | No runtime claim without evidence | Restart, restore, duplicate, tamper | 6 |

## Wave 1 conclusion

- FACT: Wave 1 reconciles the intended v1.4 direction with the current verified evidence.
- FACT: The delta is non-superseding until separately accepted as a contract revision.
- MISSING: Live deployment and human-gated operations remain outside this wave.

## Wave 2 A1 update - 2026-08-15

- FACT: The Hermes runtime unknown is resolved as a decision: adopt the declared runtime with an explicit
  host-compatible release range.
- FACT: The three named profile identifiers fit the independent-profile model.
- MISSING: Runtime installation, coordinator wiring, relay release, credentials, and host operation remain
  unperformed.

## Wave 2 A2 update - 2026-08-15

- FACT: The other repository has an offline Hermes adapter and coordinator wiring with deterministic tests.
- FACT: Privacy refusal is before model input, provider refusal is fail-closed, and budget refusal is before
  agent invocation.
- PARTIAL: A2 implementation is present locally but uncommitted; no provider call or runtime operation was
  attempted.
- COMPLETE: A4 placeholder hygiene and A5 dangling-agent closure are implemented locally and covered by
  assertions and tamper proofs.
- MISSING: A3 relay dry-run, credentials, and host operation.

## Wave 2 A4/A5 update - 2026-08-15

- FACT: The environment template no longer carries a numeric operator allowlist value.
- FACT: The dangling route/exemplar pair was removed while the persona registry was preserved.
- COMPLETE: A4/A5 safe implementation, focused assertions, tamper proof, restoration proof, and sanitized
  evidence packet.
- MISSING: A3 relay dry-run/standby release and live verification remain human-gated.

## Hermes runtime update - 2026-08-15

- COMPLETE: Hermes 0.15.2 is installed in the isolated VPS virtual environment `/opt/nizam/hermes`.
- COMPLETE: Isolated `nizam` and `pfos` profile homes were created.
- COMPLETE: The NIZAM profile is configured for OpenRouter with `xiaomi/mimo-v2.5` as its default model.
- COMPLETE: The PFOS profile is configured for OpenRouter with `z-ai/glm-5.2` as its default model.
- BLOCKED: Only one OpenRouter development key is available locally. The two-agent contract requires
  separate model keys and caps, so the key is not copied into both profiles.
- BLOCKED: The existing finance Telegram process is already polling its bot. Hermes gateways are not started
  until bot ownership, relay integration, separate credentials, registry eligibility, and duplicate-polling
  checks are complete.
