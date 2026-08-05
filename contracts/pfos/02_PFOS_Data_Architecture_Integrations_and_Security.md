# PFOS Data Architecture, Integrations, and Security Contract

## Document purpose

Define the low-cost, single-user technical architecture for the Personal Financial Operating System. This contract separates financial truth from documents, AI memory, and behavioral context; specifies ingestion and reconciliation; and defines deployment, backup, security, and integration tasks.

---

## 1. Architecture recommendation

```text
iPhone SMS / Manual Input / Gmail / Statements / Receipts
                         │
                         ▼
                 Ingestion Gateway
                         │
             Parse → Validate → Fingerprint
                         │
                         ▼
               Immutable Event Inbox
                         │
              Reconcile / Deduplicate
                         │
                         ▼
              Deterministic Ledger API
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
 Safe-to-Spend      Forecast/Risk       Document Index
       │                 │                  │
       └──────────── Evidence Package ──────┘
                         │
                         ▼
             Hermes Financial Orchestrator
                         │
          OpenRouter task-routed LLM calls
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
        Telegram                  Web Dashboard
```

### Recommended low-cost stack

| Layer | Initial choice | Upgrade condition |
|---|---|---|
| VPS | One low-cost Linux VPS | Resource pressure or reliability requirement |
| Backend | Python + FastAPI | Keep unless major performance issue |
| Ledger | SQLite with transactions and WAL | Move to PostgreSQL for multi-process write contention or multi-user scope |
| Jobs | Cron/APScheduler | Move to task queue when job volume becomes complex |
| Agent | Hermes | Replace/extend only if tool isolation or orchestration is insufficient |
| Models | OpenRouter task routing | Add local model if economical and secure |
| Documents | Google Drive | Remain archive/knowledge/backup, not live ledger |
| Dashboard | Next.js/React or lightweight equivalent | PWA/mobile wrapper later |
| Authentication | Telegram user ID allowlist + dashboard passkey/strong auth | Hardware key or VPN for stronger security |
| Monitoring | Structured logs + health checks | Add hosted monitoring only if needed |

SQLite is suitable for a single-user transactional ledger because it provides atomic transactions and a portable database file. The live database must remain on the VPS local filesystem, not inside a synchronizing Google Drive folder. Backups should be created through database-safe snapshots.

---

## 2. Data-domain separation

### 2.1 Financial facts

Authoritative and deterministic:

- Accounts.
- Balances.
- Transactions.
- Liabilities.
- Payment schedules.
- Rates and fees.
- Statements.
- Assets and valuations.
- Reconciliation state.
- Decision outcomes.

Storage: SQLite/PostgreSQL.

### 2.2 Policy and rules

Version-controlled:

- Priority matrix.
- Safe-to-spend rules.
- Buffer rules.
- Risk limits.
- Approval boundaries.
- Model-routing policies.
- Notification thresholds.

Storage: Git repository and mirrored Google Drive documents.

### 2.3 Documents and knowledge

- Statements.
- Receipts.
- Contracts.
- Financial research.
- Provider terms.
- Monthly reports.
- Exported snapshots.

Storage: Google Drive, indexed by metadata in the database.

### 2.4 Personal context

- Goals.
- Life events.
- Explanations.
- Preferences.
- Decision rationale.
- Employment context.

Storage: controlled memory files plus structured database records.

### 2.5 Behavioral and health context

- Journal-derived labels.
- WHOOP recovery, sleep, and strain.
- User-approved behavioral features.

Storage: separate encrypted schema or database namespace. Financial decisions reference only explicitly permitted feature summaries.

---

## 3. Ingestion strategy

### 3.1 iPhone path A — Shortcuts

Potential event-driven flow:

1. iPhone receives bank message.
2. Personal Automation extracts message text where supported.
3. Shortcut sends HTTPS POST to a private ingestion endpoint or sends formatted text to the Telegram bot.
4. Backend authenticates source and writes raw event to inbox.
5. Parser extracts fields.
6. User receives confirmation only when confidence is low or event is material.

This path requires validation on the user's current iOS version because trigger behavior, confirmation requirements, message-content availability, and background execution can change.

### 3.2 iPhone path B — Gmail relay

1. Shortcut or user forwards transaction message to a dedicated Gmail label/address.
2. Agent checks only the dedicated label or sender pattern.
3. Message ID is stored as an idempotency key.
4. Parsed transaction enters the same ingestion pipeline.

Gmail should be treated as a transport fallback, not the ledger.

### 3.3 iPhone path C — Weekly export

1. Export or copy messages in a normalized file.
2. Upload to Drive or Telegram.
3. Bulk parser creates candidate transactions.
4. Reconciliation compares against existing SMS/manual entries and statements.
5. Exceptions go to review.

### 3.4 Statements

- PDF statement upload into a dedicated Drive folder.
- File hash prevents duplicate processing.
- Text extraction first.
- Table parser second.
- OCR only when necessary.
- Password handling must not store plaintext passwords in Drive.
- Bank-specific templates may be added after a generic parser.
- Statement line items are treated as posted/verified evidence.

### 3.5 Manual and receipts

Telegram must support:

- “Spent 450 at X using CIB.”
- Correct merchant/category/account.
- Split a transaction.
- Mark transfer.
- Add cash transaction.
- Add future obligation.
- Upload receipt.
- Explain or justify a purchase.

---

## 4. Transaction state model

Each transaction must have:

- `transaction_id`
- `source_event_id`
- `source_type`
- `account_id`
- `occurred_at`
- `posted_at`
- `amount`
- `currency`
- `direction`
- `merchant_raw`
- `merchant_normalized`
- `category_id`
- `transaction_type`
- `status`
- `verification_level`
- `category_confidence`
- `duplicate_probability`
- `statement_reference`
- `created_at`
- `updated_at`
- `supersedes_transaction_id`
- `audit_version`

### Verification levels

1. `observed` — SMS, receipt, or manual claim.
2. `provisional` — parsed and plausible.
3. `matched` — matched to another independent source.
4. `posted` — found in a bank/card statement or trusted feed.
5. `reconciled` — included in a closed statement period.

### Statuses

- pending
- posted
- reversed
- refunded
- disputed
- cancelled
- installment
- transfer
- cash_withdrawal
- fee
- interest
- payment
- correction

---

## 5. Deduplication and reconciliation

### 5.1 Exact idempotency

Reject exact duplicates using:

- Telegram update ID.
- Gmail message ID.
- File hash.
- Source event ID.
- Provider reference number.

### 5.2 Probabilistic matching

Candidate duplicate score should consider:

- Amount.
- Currency.
- Account.
- Time distance.
- Merchant similarity.
- Transaction direction/type.
- Card last four digits.
- Authorization/reference number.
- Pending-to-posted relationship.

Never delete a suspected duplicate automatically. Link records and retain the original source.

### 5.3 Reconciliation rules

- Match pending SMS authorization to posted statement entry.
- Handle differences caused by FX conversion, tips, fees, or settlement date.
- Treat credit-card payment as a transfer, not expense.
- Treat cash withdrawal as movement to a cash account; later cash spending is expense.
- Treat refund as linkage to original expense where possible.
- Treat installments as liability schedule plus principal/fee components.
- Close a statement period only after balance equation checks pass or exceptions are accepted.

---

## 6. Account and obligation model

### Account types

- Current/checking.
- Savings.
- Cash.
- Credit card.
- Personal loan.
- BNPL.
- Family loan.
- Investment.
- Foreign currency.
- Asset.
- Liability.
- Receivable.

### Obligation fields

- Creditor.
- Amount due.
- Minimum due.
- Due date.
- Grace date.
- Frequency.
- Priority.
- Penalty.
- Interest.
- Autopay state.
- Verification source.
- Confidence.
- Protected reserve amount.

---

## 7. Google Drive information architecture

Suggested folder:

```text
PFOS_Personal_CFO/
├── 00_Governance/
├── 01_Product_Blueprints/
├── 02_Financial_Knowledge/
│   ├── Budgeting/
│   ├── Debt/
│   ├── Forecasting/
│   ├── Risk/
│   ├── Egypt_Macro/
│   └── Provider_Terms/
├── 03_Statements/
│   ├── HSBC/
│   ├── CIB/
│   ├── NBE/
│   ├── Credit_Cards/
│   └── BNPL/
├── 04_Receipts/
├── 05_Reports/
│   ├── Daily/
│   ├── Weekly/
│   └── Monthly/
├── 06_Decision_Records/
├── 07_Exports_and_Backups/
└── 08_Behavioral_Context/
```

Drive is the durable document archive and knowledge store. The database stores file IDs, hashes, versions, processing status, and links.

---

## 8. Agent and model architecture

### 8.1 Recommended principle

Start with one orchestrator and deterministic services. Avoid unnecessary autonomous “agent swarms” in the MVP.

Logical specialists may exist as isolated prompts/tools:

- Ledger and reconciliation.
- Budget and cash flow.
- Debt recovery.
- Forecast and simulation.
- Evidence retrieval.
- Macro intelligence.
- Behavioral analysis.
- Reporting.

### 8.2 Model routing

- Regex/rules first for standard SMS formats.
- Cheap model for merchant normalization and categorization.
- Medium model for ambiguous classification.
- Strong reasoning model for purchase decisions, debt trade-offs, and monthly strategy.
- No LLM for arithmetic that deterministic code can perform.
- Cache stable research and normalized merchant results.
- Store prompt version, model, token usage, and result confidence.

### 8.3 Debate mechanism

For material decisions, the system may generate independent analyses from liquidity, debt, growth, behavioral, and macro perspectives. A deterministic policy gate must run before and after synthesis. “Debate” is advisory reasoning, not authority over hard constraints.

---

## 9. Security architecture

### Core controls

- Telegram user ID allowlist.
- Secret webhook path or signed ingestion request.
- TLS only.
- Environment secrets outside repository and Drive.
- Minimal OAuth scopes.
- Read-only Google Drive access where possible; limited write folder where needed.
- Dedicated Gmail label and restricted query.
- Database encryption at rest or encrypted filesystem.
- Encrypted offsite backups.
- Redacted logs.
- No bank passwords, card CVV, or full card numbers.
- Rotate bot and API keys.
- Rate limits and replay protection.
- Audit every external tool call and financial record mutation.
- Restore drill at defined intervals.

### Threats to model

- Telegram account compromise.
- Stolen VPS credentials.
- Malicious statement/receipt prompt injection.
- Poisoned financial knowledge document.
- Duplicate/replayed SMS.
- LLM hallucinated amount or due date.
- Over-permissioned Drive/Gmail access.
- Behavioral data exposed to finance prompts.
- Backup corruption.
- Unauthorized dashboard access.

### Prompt-injection rule

Documents are untrusted data. Text inside statements, emails, receipts, or research cannot issue tool instructions. Only system-owned policies and authenticated user commands can authorize actions.

---

## 10. Reliability and failure handling

- Raw events are retained before parsing.
- Parsing is retryable and idempotent.
- Ledger writes occur inside database transactions.
- Failed model calls do not lose source events.
- Safe-to-spend displays data freshness and last successful reconciliation.
- When data is stale, the system reduces confidence and does not issue false precision.
- If Telegram is unavailable, dashboard and scheduled ingestion continue.
- If Drive is unavailable, ledger continues and document jobs queue.
- If OpenRouter is unavailable, deterministic financial status remains available.
- Backups are validated, not merely created.

---

## 11. Phased implementation tasks

### Phase A — Infrastructure

- Provision hardened VPS.
- Configure domain/TLS or secure tunnel.
- Deploy FastAPI service.
- Initialize repository, secrets, logs, health checks.
- Configure SQLite and migration framework.
- Create backup and restore procedure.

### Phase B — Financial data model

- Implement account, obligation, transaction, source-event, statement, asset, decision, and audit tables.
- Add currencies and exchange-rate table.
- Seed known financial accounts and providers.
- Add immutable event inbox.

### Phase C — Ingestion

- Telegram manual entry.
- iOS Shortcut proof of concept.
- Gmail fallback.
- PDF statement upload and generic extraction.
- Merchant normalization and categorization.
- Review queue.

### Phase D — Reconciliation

- Exact idempotency.
- Probabilistic match scoring.
- Pending-to-posted linking.
- Transfer/refund/installment handling.
- Statement closing and balance validation.

### Phase E — Interfaces

- Telegram commands and conversational actions.
- Dashboard API.
- Responsive command-center UI.
- Document and exception review.

### Phase F — Hardening

- Security review.
- Backup restore test.
- Failure injection.
- Prompt-injection tests.
- Reconciliation benchmark.
- Privacy boundary validation.

---

## 12. Research backlog

1. Validate iOS 26 Shortcuts behavior for incoming-message automation on the user's device.
2. Collect sanitized examples of every relevant bank and financing SMS format.
3. Collect representative monthly statements from each provider.
4. Compare SQLite versus PostgreSQL after realistic concurrent job testing.
5. Review Hermes tool isolation, memory behavior, and scheduling.
6. Verify OpenRouter data-retention settings and provider routing policies.
7. Compare low-cost VPS vendors from Egypt for latency, billing, disk reliability, and backup.
8. Research Egypt-specific data-protection and financial-advice implications.
9. Determine reliable Egypt inflation, FX, interest, and banking-policy sources.
10. Test Drive OAuth scopes and folder-level operational boundaries.

---

## Source notes

The architecture uses a transactional local database because SQLite transactions are atomic and serializable, while Google Drive is designed as file/document storage with API quotas and file semantics rather than relational transaction semantics. Relevant primary references:

- SQLite transactions: https://www.sqlite.org/lang_transaction.html
- SQLite transactional guarantees: https://www.sqlite.org/transactional.html
- SQLite file/WAL behavior: https://www.sqlite.org/fileformat.html
- Google Drive folders and limits: https://developers.google.com/workspace/drive/api/guides/folder
- Google Drive API limits: https://developers.google.com/workspace/drive/api/guides/limits
- Telegram Bot API: https://core.telegram.org/bots/api
- Apple Shortcuts guide: https://support.apple.com/guide/shortcuts/welcome/ios

---

## Machine-executable contract

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "pfos://contracts/data-architecture.schema.json",
  "title": "PFOS Data Architecture Contract",
  "type": "object",
  "required": ["components", "data_domains", "ingestion", "security", "phases"],
  "properties": {
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "responsibility", "technology", "failure_mode"],
        "properties": {
          "name": {"type": "string"},
          "responsibility": {"type": "string"},
          "technology": {"type": "string"},
          "failure_mode": {"type": "string"}
        }
      }
    },
    "data_domains": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["domain", "authoritative_store", "sensitivity"],
        "properties": {
          "domain": {"enum": ["financial_facts", "policies", "documents", "personal_context", "behavioral_health"]},
          "authoritative_store": {"type": "string"},
          "sensitivity": {"enum": ["high", "very_high", "restricted"]}
        }
      }
    },
    "ingestion": {
      "type": "object",
      "required": ["sources", "idempotency", "verification_levels"],
      "properties": {
        "sources": {"type": "array", "items": {"enum": ["telegram", "ios_shortcuts", "gmail", "sms_export", "pdf_statement", "receipt", "manual"]}},
        "idempotency": {"type": "array", "items": {"type": "string"}},
        "verification_levels": {"type": "array", "items": {"enum": ["observed", "provisional", "matched", "posted", "reconciled"]}}
      }
    },
    "security": {
      "type": "object",
      "required": ["authentication", "encryption", "secret_management", "audit", "prompt_injection"],
      "properties": {
        "authentication": {"type": "array", "items": {"type": "string"}},
        "encryption": {"type": "array", "items": {"type": "string"}},
        "secret_management": {"type": "array", "items": {"type": "string"}},
        "audit": {"type": "array", "items": {"type": "string"}},
        "prompt_injection": {"const": "documents_are_untrusted_data"}
      }
    },
    "phases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "tasks", "acceptance_tests"],
        "properties": {
          "id": {"pattern": "^[A-F]$"},
          "tasks": {"type": "array", "items": {"type": "string"}},
          "acceptance_tests": {"type": "array", "items": {"type": "string"}}
        }
      }
    }
  }
}
```
