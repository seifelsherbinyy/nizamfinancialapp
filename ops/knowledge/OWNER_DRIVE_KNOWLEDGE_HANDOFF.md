# Owner-controlled Drive knowledge handoff

Implemented against PFOS Contract 06 §7 and Contract 13 §5. This runbook is an owner-only handoff
for the finance agent's optional knowledge capability. It does not grant the agent unrestricted Drive
access, and it does not authorize writes to Drive.

## Boundary

The finance agent reads a dedicated owner-approved knowledge root and its descendants. It indexes
pointers and hashes locally, keeps retrieved text in a bounded in-memory corpus, labels that text as
untrusted reference data, and ignores instruction-like source lines. Finance excludes journal and
health references before reading them. Authoritative ledger, account, obligation, and transaction
facts remain in the deterministic finance store and ledger pipeline; Drive is not used as a live
transactional database. It never treats Drive text as policy authority, a tool request, or a secret
source.

The browser ledger path and the backup service have separate credentials and scopes. Do not copy the
backup service's Drive grant into the finance service. Do not place a refresh token, client secret, or
other credential in the repository, a commit, a Drive document, or a chat message.

## Human-only setup

1. Select or create a dedicated knowledge root containing only material approved for the finance
   agent. Keep strict-local material outside this root.
2. Authorize a read-only Drive grant for the owner-controlled Google application. The grant must be
   able to list and read the selected root, but must not be used as a general-purpose Drive editor.
3. Obtain the resulting values through the owner's secret-management process. The finance service
   needs exactly these entries:

   - `KNOWLEDGE_DRIVE_ROOT_ID`
   - `KNOWLEDGE_DRIVE_REFRESH_TOKEN`
   - `KNOWLEDGE_DRIVE_CLIENT_ID`
   - `KNOWLEDGE_DRIVE_CLIENT_SECRET`
   - `KNOWLEDGE_DRIVE_TOKEN_URL`

4. Place those values in the root-owned finance runtime environment on the VPS. The AI builder must
   not be given the secret directory or its contents. Restarting the finance service is the human
   deployment action; this coding session does not perform it.

## Acceptance checks

After the owner performs the handoff, verify on the VPS without printing any value:

- all five entries are present and the service starts through its ordinary boot path;
- the startup knowledge refresh reports only an indexed-count outcome through the existing redacted
  logger, or records the bounded `knowledge_refresh_refused` event;
- a test question that matches an approved archive document produces bounded, source-labelled
  reference context in the model request;
- instruction-like text stored in a Drive document is omitted from that context;
- the local knowledge index contains pointers and hashes, not document bodies;
- removing or breaking the grant causes an unavailable/refused result, never a fabricated answer and
  never a secret-bearing log line;
- no Drive write occurs as part of refresh or retrieval.

The owner should review the selected root and the first live agent conversation before adding more
documents or changing scopes. This handoff is intentionally reversible: remove the five optional
entries to return the finance agent to offline-knowledge mode.
