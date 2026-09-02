# Hermes live activation checklist

Status: staged. Do not mark complete from an agent session.

Credential checks:

- NIZAM has only `OR_KEY_LIFE`.
- PFOS has only `OR_KEY_FINANCE`.
- The two keys are different and each has its own provider cap.
- Neither key is printed, logged, committed, or uploaded to Drive.
- Both Telegram tokens are different and each bot has the owner allowlist.

Model checks:

- The registry is present, current, non-provisional, and contains only approved models.
- T0 has zero model calls.
- Every non-T0 request carries the privacy policy.
- Premium models remain disabled unless separately approved.

Data checks:

- NIZAMCORE owns journaling, health, and life context.
- PFOS owns deterministic financial data and calculations.
- Raw journal and health content is excluded from PFOS.
- Cross-agent traffic uses only the validated signal bus.
- Drive ingestion uses the Drive file-only scope and preserves provenance.
- Secrets and encryption keys are absent from Drive packets.

Live proof:

- Send a message to each bot.
- Observe inbound polling and durable enqueue.
- Observe the correct Hermes profile process the message.
- Observe deterministic PFOS results for financial questions.
- Observe a cited, focused response.
- Observe NIZAMCORE to PFOS bounded communication.
- Verify duplicate update handling, restart recovery, provider refusal, budget refusal, and kill switch.
