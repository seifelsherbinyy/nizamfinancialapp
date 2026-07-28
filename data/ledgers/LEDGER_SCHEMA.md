# NIZAM Ledger Schema (canonical)

> Grounded in the existing `master_ledger_jul2025_jul_2026.csv` (1,216 rows, 25 columns) from the 47_NIZAM BANKING Drive folder. This is the authoritative row contract for import + Drive DB.

| # | column | type | notes |
|---|--------|------|-------|
| 1 | transaction_date | date (ISO) | txn date |
| 2 | posting_date | date (ISO) | bank post date |
| 3 | payee | string | normalized payee |
| 4 | merchant | string | raw merchant |
| 5 | description | string | statement narrative |
| 6 | category | string | budget category |
| 7 | transaction_type | enum | charge/payment/fee/interest/transfer/salary |
| 8 | outflow | int(milliunits) | >=0 |
| 9 | inflow | int(milliunits) | >=0 |
| 10 | amount | int(milliunits) | signed |
| 11 | direction | enum | in/out |
| 12 | currency | string | EGP |
| 13 | balance | int(milliunits) | running (if present) |
| 14 | account | string | display account |
| 15 | account_identifier | string | last-4 / id (REDACT in UI) |
| 16 | statement_date | date | period close |
| 17 | statement_month | string | YYYY-MM |
| 18 | source_file | string | provenance |
| 19 | source_page_or_sheet | string | provenance |
| 20 | extraction_method | enum | parser/ocr/manual |
| 21 | confidence_score | float | 0..1 |
| 22 | confidence_reason | string | why |
| 23 | duplicate_key | string | dedup hash |
| 24 | is_duplicate | bool | dedup flag |
| 25 | memo | string | user note |

**Money rule:** store all money as INTEGER milliunits (1 EGP = 1000). Never floats. See `.kiro/steering/money-rules.md`.
